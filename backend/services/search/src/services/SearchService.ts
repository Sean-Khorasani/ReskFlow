import { RedisClientType } from 'redis';
import { prisma, logger } from '@reskflow/shared';
import { ElasticsearchService } from './ElasticsearchService';
import { DietaryFilterService } from './DietaryFilterService';
import { PreferenceService } from './PreferenceService';
import { SearchAnalyticsService } from './SearchAnalyticsService';
import { RecommendationIntegrationService } from './RecommendationIntegrationService';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface SearchParams {
  query?: string;
  filters?: {
    dietary?: string[];
    allergens?: string[];
    cuisines?: string[];
    priceRange?: { min: number; max: number };
    rating?: number;
    reskflowTime?: number;
    distance?: number;
    merchantTypes?: string[];
  };
  location: {
    latitude: number;
    longitude: number;
  };
  userId: string;
  page: number;
  limit: number;
  sortBy: string;
}

interface SearchResult {
  searchId: string;
  results: Array<{
    type: 'merchant' | 'item' | 'cuisine';
    id: string;
    name: string;
    description?: string;
    image?: string;
    rating?: number;
    price?: number;
    reskflowTime?: number;
    distance?: number;
    matchScore: number;
    highlights: string[];
    dietary?: string[];
    allergens?: string[];
  }>;
  facets: {
    cuisines: Array<{ name: string; count: number }>;
    dietary: Array<{ name: string; count: number }>;
    priceRanges: Array<{ range: string; count: number }>;
  };
  totalResults: number;
  page: number;
  totalPages: number;
  suggestions?: string[];
  appliedFilters: any;
}

interface SearchSuggestion {
  text: string;
  type: 'query' | 'merchant' | 'item' | 'cuisine';
  confidence: number;
}

export class SearchService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly RECENT_SEARCHES_LIMIT = 10;

  constructor(
    private elasticsearchService: ElasticsearchService,
    private dietaryFilterService: DietaryFilterService,
    private preferenceService: PreferenceService,
    private searchAnalyticsService: SearchAnalyticsService,
    private recommendationIntegrationService: RecommendationIntegrationService,
    private redisClient: RedisClientType
  ) {}

  async search(params: SearchParams): Promise<SearchResult> {
    const searchId = uuidv4();
    const cacheKey = this.generateCacheKey(params);

    // Check cache
    const cached = await this.getCachedResults(cacheKey);
    if (cached) {
      await this.trackSearch(searchId, params, cached);
      return { ...cached, searchId };
    }

    // Get user preferences
    const userPreferences = await this.preferenceService.getUserPreferences(params.userId);
    
    // Merge filters with user preferences
    const mergedFilters = this.mergeFiltersWithPreferences(params.filters, userPreferences);

    // Build Elasticsearch query
    const esQuery = this.buildElasticsearchQuery(params.query, mergedFilters, params.location);

    // Execute search
    const esResults = await this.elasticsearchService.search({
      index: 'reskflow_items',
      body: esQuery,
      from: (params.page - 1) * params.limit,
      size: params.limit,
    });

    // Apply dietary filters
    let filteredResults = esResults.hits.hits;
    if (mergedFilters.dietary || mergedFilters.allergens) {
      filteredResults = await this.applyDietaryFilters(
        filteredResults,
        mergedFilters.dietary,
        mergedFilters.allergens
      );
    }

    // Enhance with personalization
    const personalizedResults = await this.personalizeResults(
      filteredResults,
      params.userId,
      userPreferences
    );

    // Format results
    const formattedResults = this.formatSearchResults(
      personalizedResults,
      params.query || ''
    );

    // Get facets
    const facets = this.extractFacets(esResults.aggregations);

    // Get suggestions if few results
    let suggestions: string[] | undefined;
    if (formattedResults.length < 5 && params.query) {
      suggestions = await this.generateAlternativeSuggestions(params.query, params.location);
    }

    const result: SearchResult = {
      searchId,
      results: formattedResults,
      facets,
      totalResults: esResults.hits.total.value,
      page: params.page,
      totalPages: Math.ceil(esResults.hits.total.value / params.limit),
      suggestions,
      appliedFilters: mergedFilters,
    };

    // Cache results
    await this.cacheResults(cacheKey, result);

    // Track search
    await this.trackSearch(searchId, params, result);

    // Save to recent searches
    await this.saveRecentSearch(params.userId, params.query || '');

    return result;
  }

  async getSuggestions(params: {
    query: string;
    location: { latitude: number; longitude: number };
    userId: string;
  }): Promise<SearchSuggestion[]> {
    if (!params.query || params.query.length < 2) {
      return [];
    }

    // Get user's search history for personalization
    const userHistory = await this.getUserSearchHistory(params.userId);

    // Get suggestions from multiple sources
    const [
      elasticSuggestions,
      popularSearches,
      userHistorySuggestions,
    ] = await Promise.all([
      this.elasticsearchService.getSuggestions(params.query),
      this.searchAnalyticsService.getPopularSearchesNear(params.location),
      this.generateHistoryBasedSuggestions(params.query, userHistory),
    ]);

    // Combine and rank suggestions
    const combinedSuggestions = this.combineSuggestions(
      elasticSuggestions,
      popularSearches,
      userHistorySuggestions
    );

    // Apply NLP to improve suggestions
    const enhancedSuggestions = await this.enhanceSuggestionsWithNLP(
      combinedSuggestions,
      params.query
    );

    return enhancedSuggestions.slice(0, 10);
  }

  async getRecentSearches(userId: string): Promise<string[]> {
    const key = `recent_searches:${userId}`;
    const searches = await this.redisClient.lRange(key, 0, this.RECENT_SEARCHES_LIMIT - 1);
    return searches;
  }

  async searchByDietary(params: {
    dietary: string[];
    allergens?: string[];
    location: { latitude: number; longitude: number };
    userId: string;
    page?: number;
    limit?: number;
  }): Promise<SearchResult> {
    // Special search focused on dietary requirements
    const searchParams: SearchParams = {
      filters: {
        dietary: params.dietary,
        allergens: params.allergens,
      },
      location: params.location,
      userId: params.userId,
      page: params.page || 1,
      limit: params.limit || 20,
      sortBy: 'dietary_match',
    };

    return this.search(searchParams);
  }

  async searchNearby(params: {
    location: { latitude: number; longitude: number };
    radius?: number;
    userId: string;
    page?: number;
    limit?: number;
  }): Promise<SearchResult> {
    const searchParams: SearchParams = {
      filters: {
        distance: params.radius || 5, // 5km default
      },
      location: params.location,
      userId: params.userId,
      page: params.page || 1,
      limit: params.limit || 20,
      sortBy: 'distance',
    };

    return this.search(searchParams);
  }

  private buildElasticsearchQuery(
    query: string | undefined,
    filters: any,
    location: { latitude: number; longitude: number }
  ): any {
    const must: any[] = [];
    const filter: any[] = [];
    const should: any[] = [];

    // Text search
    if (query) {
      must.push({
        multi_match: {
          query,
          fields: [
            'name^3',
            'description^2',
            'category',
            'cuisine',
            'tags',
          ],
          type: 'best_fields',
          fuzziness: 'AUTO',
        },
      });

      // Boost exact matches
      should.push({
        match_phrase: {
          name: {
            query,
            boost: 2,
          },
        },
      });
    }

    // Location filter
    filter.push({
      geo_distance: {
        distance: `${filters.distance || 10}km`,
        location: {
          lat: location.latitude,
          lon: location.longitude,
        },
      },
    });

    // Price range filter
    if (filters.priceRange) {
      filter.push({
        range: {
          price: {
            gte: filters.priceRange.min,
            lte: filters.priceRange.max,
          },
        },
      });
    }

    // Rating filter
    if (filters.rating) {
      filter.push({
        range: {
          rating: { gte: filters.rating },
        },
      });
    }

    // Cuisine filter
    if (filters.cuisines && filters.cuisines.length > 0) {
      filter.push({
        terms: { cuisine: filters.cuisines },
      });
    }

    // Merchant type filter
    if (filters.merchantTypes && filters.merchantTypes.length > 0) {
      filter.push({
        terms: { merchant_type: filters.merchantTypes },
      });
    }

    // Build aggregations
    const aggs = {
      cuisines: {
        terms: { field: 'cuisine.keyword', size: 20 },
      },
      dietary: {
        terms: { field: 'dietary_tags.keyword', size: 20 },
      },
      price_ranges: {
        range: {
          field: 'price',
          ranges: [
            { to: 10, key: 'Under $10' },
            { from: 10, to: 20, key: '$10-$20' },
            { from: 20, to: 30, key: '$20-$30' },
            { from: 30, key: 'Over $30' },
          ],
        },
      },
    };

    // Add sorting
    const sort: any[] = [];
    
    switch (filters.sortBy || 'relevance') {
      case 'distance':
        sort.push({
          _geo_distance: {
            location: {
              lat: location.latitude,
              lon: location.longitude,
            },
            order: 'asc',
            unit: 'km',
          },
        });
        break;
      case 'rating':
        sort.push({ rating: { order: 'desc' } });
        break;
      case 'price_low':
        sort.push({ price: { order: 'asc' } });
        break;
      case 'price_high':
        sort.push({ price: { order: 'desc' } });
        break;
      case 'reskflow_time':
        sort.push({ estimated_reskflow_time: { order: 'asc' } });
        break;
      default:
        sort.push({ _score: { order: 'desc' } });
    }

    return {
      query: {
        bool: {
          must,
          filter,
          should,
        },
      },
      aggs,
      sort,
      track_scores: true,
      _source: true,
    };
  }

  private async applyDietaryFilters(
    results: any[],
    dietaryRequirements?: string[],
    allergens?: string[]
  ): Promise<any[]> {
    if (!dietaryRequirements?.length && !allergens?.length) {
      return results;
    }

    const filteredResults = [];

    for (const result of results) {
      const item = result._source;
      
      // Check dietary compatibility
      if (dietaryRequirements) {
        const isCompatible = await this.dietaryFilterService.checkCompatibility(
          item.dietary_tags || [],
          dietaryRequirements
        );
        if (!isCompatible) continue;
      }

      // Check allergens
      if (allergens) {
        const hasAllergens = await this.dietaryFilterService.checkAllergens(
          item.allergens || [],
          allergens
        );
        if (hasAllergens) continue;
      }

      filteredResults.push(result);
    }

    return filteredResults;
  }

  private async personalizeResults(
    results: any[],
    userId: string,
    preferences: any
  ): Promise<any[]> {
    // Get user's order history for personalization
    const orderHistory = await this.getUserOrderHistory(userId);
    
    // Score each result based on user preferences
    const scoredResults = results.map(result => {
      let personalScore = result._score || 0;
      const item = result._source;

      // Boost based on cuisine preferences
      if (preferences.cuisinePreferences?.includes(item.cuisine)) {
        personalScore *= 1.2;
      }

      // Boost based on past orders
      const orderedBefore = orderHistory.some(order => 
        order.items.some((orderItem: any) => orderItem.id === item.id)
      );
      if (orderedBefore) {
        personalScore *= 1.1;
      }

      // Boost based on dietary match
      const dietaryMatch = this.calculateDietaryMatch(
        item.dietary_tags || [],
        preferences.dietaryRestrictions || []
      );
      personalScore *= (1 + dietaryMatch * 0.3);

      return {
        ...result,
        _score: personalScore,
      };
    });

    // Re-sort by personalized score
    return scoredResults.sort((a, b) => b._score - a._score);
  }

  private formatSearchResults(results: any[], query: string): any[] {
    return results.map(result => {
      const source = result._source;
      const highlights = this.extractHighlights(source, query);

      return {
        type: source.type || 'item',
        id: source.id,
        name: source.name,
        description: source.description,
        image: source.image_url,
        rating: source.rating,
        price: source.price,
        reskflowTime: source.estimated_reskflow_time,
        distance: result.sort?.[0], // Distance from sort
        matchScore: result._score,
        highlights,
        dietary: source.dietary_tags,
        allergens: source.allergens,
      };
    });
  }

  private extractHighlights(item: any, query: string): string[] {
    const highlights: string[] = [];
    const queryTerms = query.toLowerCase().split(' ');

    // Check name
    if (item.name && queryTerms.some(term => item.name.toLowerCase().includes(term))) {
      highlights.push(this.highlightText(item.name, queryTerms));
    }

    // Check description
    if (item.description && queryTerms.some(term => item.description.toLowerCase().includes(term))) {
      const snippet = this.extractSnippet(item.description, queryTerms);
      highlights.push(this.highlightText(snippet, queryTerms));
    }

    return highlights;
  }

  private highlightText(text: string, terms: string[]): string {
    let highlighted = text;
    terms.forEach(term => {
      const regex = new RegExp(`(${term})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    });
    return highlighted;
  }

  private extractSnippet(text: string, terms: string[]): string {
    const words = text.split(' ');
    const termPositions = terms.flatMap(term => 
      words.map((word, index) => word.toLowerCase().includes(term) ? index : -1)
    ).filter(pos => pos !== -1);

    if (termPositions.length === 0) return text.slice(0, 100) + '...';

    const start = Math.max(0, Math.min(...termPositions) - 10);
    const end = Math.min(words.length, Math.max(...termPositions) + 10);
    
    return words.slice(start, end).join(' ') + '...';
  }

  private extractFacets(aggregations: any): any {
    return {
      cuisines: aggregations?.cuisines?.buckets?.map((bucket: any) => ({
        name: bucket.key,
        count: bucket.doc_count,
      })) || [],
      dietary: aggregations?.dietary?.buckets?.map((bucket: any) => ({
        name: bucket.key,
        count: bucket.doc_count,
      })) || [],
      priceRanges: aggregations?.price_ranges?.buckets?.map((bucket: any) => ({
        range: bucket.key,
        count: bucket.doc_count,
      })) || [],
    };
  }

  private mergeFiltersWithPreferences(filters: any, preferences: any): any {
    const merged = { ...filters };

    // Add user's dietary restrictions if not overridden
    if (!merged.dietary && preferences.dietaryRestrictions?.length > 0) {
      merged.dietary = preferences.dietaryRestrictions;
    }

    // Add user's allergens if not overridden
    if (!merged.allergens && preferences.allergens?.length > 0) {
      merged.allergens = preferences.allergens;
    }

    // Apply price range preference if not specified
    if (!merged.priceRange && preferences.priceRange) {
      merged.priceRange = preferences.priceRange;
    }

    return merged;
  }

  private async generateAlternativeSuggestions(
    query: string,
    location: { latitude: number; longitude: number }
  ): Promise<string[]> {
    // Get similar queries that yielded better results
    const similarQueries = await this.searchAnalyticsService.getSimilarSuccessfulQueries(
      query,
      location
    );

    // Generate variations
    const variations = [
      query.split(' ').slice(0, -1).join(' '), // Remove last word
      query.split(' ').slice(1).join(' '), // Remove first word
      ...this.generateTypoCorrections(query),
    ].filter(v => v && v !== query);

    return [...similarQueries, ...variations].slice(0, 5);
  }

  private generateTypoCorrections(query: string): string[] {
    // Simple typo corrections - in production, use a proper spell checker
    const corrections: string[] = [];
    
    const commonMisspellings: Record<string, string> = {
      'piza': 'pizza',
      'burgur': 'burger',
      'sandwitch': 'sandwich',
      'chiken': 'chicken',
      'cofee': 'coffee',
    };

    const words = query.toLowerCase().split(' ');
    for (let i = 0; i < words.length; i++) {
      if (commonMisspellings[words[i]]) {
        const corrected = [...words];
        corrected[i] = commonMisspellings[words[i]];
        corrections.push(corrected.join(' '));
      }
    }

    return corrections;
  }

  private async getUserSearchHistory(userId: string): Promise<any[]> {
    const searches = await prisma.searchHistory.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    return searches;
  }

  private async getUserOrderHistory(userId: string): Promise<any[]> {
    const orders = await prisma.order.findMany({
      where: { customer_id: userId },
      include: {
        orderItems: {
          include: { item: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: 20,
    });
    return orders;
  }

  private generateHistoryBasedSuggestions(
    query: string,
    history: any[]
  ): SearchSuggestion[] {
    const queryLower = query.toLowerCase();
    const suggestions: SearchSuggestion[] = [];

    history.forEach(search => {
      if (search.query.toLowerCase().startsWith(queryLower) && search.click_count > 0) {
        suggestions.push({
          text: search.query,
          type: 'query',
          confidence: Math.min(search.click_count / 10, 1),
        });
      }
    });

    return suggestions;
  }

  private combineSuggestions(
    elastic: any[],
    popular: any[],
    history: SearchSuggestion[]
  ): SearchSuggestion[] {
    const combined = new Map<string, SearchSuggestion>();

    // Add elastic suggestions
    elastic.forEach(suggestion => {
      combined.set(suggestion.text.toLowerCase(), {
        text: suggestion.text,
        type: suggestion.type || 'query',
        confidence: suggestion.score / 100,
      });
    });

    // Add popular searches
    popular.forEach(search => {
      const key = search.query.toLowerCase();
      if (combined.has(key)) {
        combined.get(key)!.confidence += 0.2;
      } else {
        combined.set(key, {
          text: search.query,
          type: 'query',
          confidence: 0.5,
        });
      }
    });

    // Add history suggestions
    history.forEach(suggestion => {
      const key = suggestion.text.toLowerCase();
      if (combined.has(key)) {
        combined.get(key)!.confidence += 0.3;
      } else {
        combined.set(key, suggestion);
      }
    });

    // Sort by confidence
    return Array.from(combined.values())
      .sort((a, b) => b.confidence - a.confidence);
  }

  private async enhanceSuggestionsWithNLP(
    suggestions: SearchSuggestion[],
    originalQuery: string
  ): Promise<SearchSuggestion[]> {
    // In production, use advanced NLP for better suggestions
    // For now, just ensure variety and relevance
    
    const enhanced = suggestions.map(suggestion => {
      // Boost suggestions that are extensions of the query
      if (suggestion.text.toLowerCase().startsWith(originalQuery.toLowerCase())) {
        suggestion.confidence *= 1.2;
      }
      
      return suggestion;
    });

    return enhanced.sort((a, b) => b.confidence - a.confidence);
  }

  private calculateDietaryMatch(itemTags: string[], userRestrictions: string[]): number {
    if (userRestrictions.length === 0) return 0;
    
    const matches = userRestrictions.filter(restriction => 
      itemTags.includes(restriction)
    );
    
    return matches.length / userRestrictions.length;
  }

  private generateCacheKey(params: SearchParams): string {
    const key = {
      q: params.query,
      f: params.filters,
      l: params.location,
      s: params.sortBy,
      p: params.page,
    };
    return `search:${JSON.stringify(key)}`;
  }

  private async getCachedResults(key: string): Promise<any | null> {
    try {
      const cached = await this.redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Cache get error:', error);
      return null;
    }
  }

  private async cacheResults(key: string, results: any): Promise<void> {
    try {
      await this.redisClient.setEx(key, this.CACHE_TTL, JSON.stringify(results));
    } catch (error) {
      logger.error('Cache set error:', error);
    }
  }

  private async trackSearch(
    searchId: string,
    params: SearchParams,
    results: SearchResult
  ): Promise<void> {
    await this.searchAnalyticsService.trackSearch({
      searchId,
      userId: params.userId,
      query: params.query,
      filters: params.filters,
      location: params.location,
      resultCount: results.totalResults,
      timestamp: new Date(),
    });
  }

  private async saveRecentSearch(userId: string, query: string): Promise<void> {
    if (!query) return;
    
    const key = `recent_searches:${userId}`;
    
    // Remove if exists and add to front
    await this.redisClient.lRem(key, 0, query);
    await this.redisClient.lPush(key, query);
    await this.redisClient.lTrim(key, 0, this.RECENT_SEARCHES_LIMIT - 1);
    await this.redisClient.expire(key, 30 * 24 * 60 * 60); // 30 days
  }
}