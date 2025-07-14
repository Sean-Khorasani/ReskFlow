import { 
  AutocompleteRequest,
  AutocompleteResult,
  SearchSuggestion,
  CategorySuggestion,
  MerchantSuggestion,
  PopularSuggestion,
  SuggestionType
} from '../types/search.types';
import { ElasticsearchService } from './ElasticsearchService';
import { redisClient } from '../utils/redis';
import { logger } from '../utils/logger';

export class AutocompleteService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly SUGGESTION_LIMIT = 10;

  constructor(private elasticsearchService: ElasticsearchService) {}

  async getAutocompleteSuggestions(request: AutocompleteRequest): Promise<AutocompleteResult> {
    try {
      const cacheKey = this.generateCacheKey(request);
      const cached = await this.getCachedResult(cacheKey);
      
      if (cached) {
        return cached;
      }

      const [
        suggestions,
        categories,
        merchants,
        popular
      ] = await Promise.all([
        this.getQuerySuggestions(request.query, request.limit),
        this.getCategorySuggestions(request.query),
        this.getMerchantSuggestions(request.query, request.location),
        this.getPopularSuggestions(request.query, request.location)
      ]);

      const result: AutocompleteResult = {
        suggestions: suggestions.slice(0, request.limit || this.SUGGESTION_LIMIT),
        categories: categories.slice(0, 5),
        merchants: merchants.slice(0, 3),
        popular: popular.slice(0, 3)
      };

      await this.cacheResult(cacheKey, result);

      return result;

    } catch (error) {
      logger.error('Autocomplete failed', {
        error: error.message,
        request: JSON.stringify(request, null, 2)
      });
      
      return {
        suggestions: [],
        categories: [],
        merchants: [],
        popular: []
      };
    }
  }

  async getQuerySuggestions(query: string, limit: number = 10): Promise<SearchSuggestion[]> {
    if (!query || query.length < 2) {
      return [];
    }

    try {
      const searchParams = {
        index: this.getItemsIndexName(),
        body: {
          suggest: {
            name_suggest: {
              prefix: query,
              completion: {
                field: 'name.suggest',
                size: limit,
                skip_duplicates: true
              }
            },
            description_suggest: {
              prefix: query,
              completion: {
                field: 'searchKeywords',
                size: Math.floor(limit / 2),
                skip_duplicates: true
              }
            }
          },
          size: 0
        }
      };

      const response = await this.elasticsearchService.search(searchParams);
      const suggestions: SearchSuggestion[] = [];

      // Process name suggestions
      if (response.suggest?.name_suggest?.[0]?.options) {
        response.suggest.name_suggest[0].options.forEach((option: any) => {
          suggestions.push({
            text: option.text,
            type: SuggestionType.ITEM,
            score: option._score || 1,
            category: option._source?.cuisineType
          });
        });
      }

      // Process description suggestions
      if (response.suggest?.description_suggest?.[0]?.options) {
        response.suggest.description_suggest[0].options.forEach((option: any) => {
          suggestions.push({
            text: option.text,
            type: SuggestionType.QUERY,
            score: option._score || 0.8
          });
        });
      }

      // Remove duplicates and sort by score
      const uniqueSuggestions = suggestions.reduce((acc, suggestion) => {
        const existing = acc.find(s => s.text.toLowerCase() === suggestion.text.toLowerCase());
        if (!existing) {
          acc.push(suggestion);
        } else if (suggestion.score > existing.score) {
          existing.score = suggestion.score;
          existing.type = suggestion.type;
        }
        return acc;
      }, [] as SearchSuggestion[]);

      return uniqueSuggestions
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    } catch (error) {
      logger.error('Failed to get query suggestions', {
        error: error.message,
        query,
        limit
      });
      return [];
    }
  }

  async getCategorySuggestions(query: string): Promise<CategorySuggestion[]> {
    if (!query || query.length < 2) {
      return this.getPopularCategories();
    }

    try {
      const searchParams = {
        index: this.getItemsIndexName(),
        body: {
          query: {
            bool: {
              should: [
                {
                  match: {
                    cuisineType: {
                      query,
                      fuzziness: 'AUTO',
                      boost: 2
                    }
                  }
                },
                {
                  match: {
                    categories: {
                      query,
                      fuzziness: 'AUTO'
                    }
                  }
                }
              ],
              minimum_should_match: 1
            }
          },
          aggs: {
            cuisine_types: {
              terms: {
                field: 'cuisineType',
                size: 10
              }
            },
            categories: {
              terms: {
                field: 'categories',
                size: 10
              }
            }
          },
          size: 0
        }
      };

      const response = await this.elasticsearchService.search(searchParams);
      const suggestions: CategorySuggestion[] = [];

      // Process cuisine types
      if (response.aggregations?.cuisine_types?.buckets) {
        response.aggregations.cuisine_types.buckets.forEach((bucket: any) => {
          if (bucket.key.toLowerCase().includes(query.toLowerCase())) {
            suggestions.push({
              name: bucket.key,
              count: bucket.doc_count,
              icon: this.getCuisineIcon(bucket.key)
            });
          }
        });
      }

      // Process categories
      if (response.aggregations?.categories?.buckets) {
        response.aggregations.categories.buckets.forEach((bucket: any) => {
          if (bucket.key.toLowerCase().includes(query.toLowerCase())) {
            suggestions.push({
              name: bucket.key,
              count: bucket.doc_count,
              icon: this.getCategoryIcon(bucket.key)
            });
          }
        });
      }

      return suggestions
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

    } catch (error) {
      logger.error('Failed to get category suggestions', {
        error: error.message,
        query
      });
      return [];
    }
  }

  async getMerchantSuggestions(query: string, location?: { latitude: number; longitude: number }): Promise<MerchantSuggestion[]> {
    if (!query || query.length < 2) {
      return [];
    }

    try {
      const searchParams: any = {
        index: this.getMerchantsIndexName(),
        body: {
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query,
                    fields: ['name^2', 'cuisineTypes'],
                    type: 'best_fields',
                    fuzziness: 'AUTO'
                  }
                }
              ]
            }
          },
          size: 5,
          _source: ['id', 'name', 'cuisineTypes', 'rating', 'isOpen', 'location']
        }
      };

      // Add location filter if provided
      if (location) {
        searchParams.body.query.bool.filter = [
          {
            geo_distance: {
              distance: '20km',
              location: {
                lat: location.latitude,
                lon: location.longitude
              }
            }
          }
        ];

        // Add distance sorting
        searchParams.body.sort = [
          {
            _geo_distance: {
              location: {
                lat: location.latitude,
                lon: location.longitude
              },
              order: 'asc',
              unit: 'km'
            }
          }
        ];
      }

      const response = await this.elasticsearchService.search(searchParams);
      const suggestions: MerchantSuggestion[] = [];

      if (response.hits?.hits) {
        response.hits.hits.forEach((hit: any) => {
          const source = hit._source;
          suggestions.push({
            id: source.id,
            name: source.name,
            cuisineType: Array.isArray(source.cuisineTypes) ? source.cuisineTypes[0] : source.cuisineTypes,
            rating: source.rating || 0,
            isOpen: source.isOpen || false
          });
        });
      }

      return suggestions;

    } catch (error) {
      logger.error('Failed to get merchant suggestions', {
        error: error.message,
        query,
        location
      });
      return [];
    }
  }

  async getPopularSuggestions(query: string, location?: { latitude: number; longitude: number }): Promise<PopularSuggestion[]> {
    try {
      // Get popular queries from analytics
      const analyticsKey = location 
        ? `popular_queries:${Math.round(location.latitude * 10)}:${Math.round(location.longitude * 10)}`
        : 'popular_queries:global';

      const popularQueries = await redisClient.zrevrange(analyticsKey, 0, 9, 'WITHSCORES');
      const suggestions: PopularSuggestion[] = [];

      for (let i = 0; i < popularQueries.length; i += 2) {
        const queryText = popularQueries[i];
        const searchCount = parseInt(popularQueries[i + 1], 10);

        if (queryText.toLowerCase().includes(query.toLowerCase()) || query.length < 3) {
          suggestions.push({
            query: queryText,
            searchCount,
            category: this.inferCategory(queryText)
          });
        }
      }

      return suggestions
        .sort((a, b) => b.searchCount - a.searchCount)
        .slice(0, 5);

    } catch (error) {
      logger.error('Failed to get popular suggestions', {
        error: error.message,
        query,
        location
      });
      return [];
    }
  }

  private async getPopularCategories(): Promise<CategorySuggestion[]> {
    try {
      const searchParams = {
        index: this.getItemsIndexName(),
        body: {
          aggs: {
            popular_cuisines: {
              terms: {
                field: 'cuisineType',
                size: 10,
                order: { _count: 'desc' }
              }
            }
          },
          size: 0
        }
      };

      const response = await this.elasticsearchService.search(searchParams);
      const suggestions: CategorySuggestion[] = [];

      if (response.aggregations?.popular_cuisines?.buckets) {
        response.aggregations.popular_cuisines.buckets.forEach((bucket: any) => {
          suggestions.push({
            name: bucket.key,
            count: bucket.doc_count,
            icon: this.getCuisineIcon(bucket.key)
          });
        });
      }

      return suggestions;

    } catch (error) {
      logger.error('Failed to get popular categories', { error: error.message });
      return [];
    }
  }

  private getCuisineIcon(cuisine: string): string {
    const icons: Record<string, string> = {
      'italian': '🍝',
      'chinese': '🥡',
      'japanese': '🍜',
      'mexican': '🌮',
      'indian': '🍛',
      'thai': '🍲',
      'american': '🍔',
      'french': '🥐',
      'mediterranean': '🥗',
      'korean': '🍜',
      'pizza': '🍕',
      'seafood': '🐟',
      'vegetarian': '🥕',
      'dessert': '🍰',
      'coffee': '☕',
      'breakfast': '🥞'
    };

    return icons[cuisine.toLowerCase()] || '🍽️';
  }

  private getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      'appetizer': '🥗',
      'main_course': '🍽️',
      'dessert': '🍰',
      'beverage': '🥤',
      'side': '🍟',
      'salad': '🥗',
      'soup': '🍲',
      'sandwich': '🥪',
      'burger': '🍔',
      'pizza': '🍕',
      'pasta': '🍝',
      'sushi': '🍣',
      'seafood': '🐟',
      'meat': '🥩',
      'vegetarian': '🥕',
      'vegan': '🌱',
      'healthy': '💚'
    };

    return icons[category.toLowerCase()] || '🍽️';
  }

  private inferCategory(query: string): string | undefined {
    const categoryKeywords: Record<string, string> = {
      'pizza': 'Italian',
      'burger': 'American',
      'sushi': 'Japanese',
      'taco': 'Mexican',
      'curry': 'Indian',
      'pasta': 'Italian',
      'ramen': 'Japanese',
      'pho': 'Vietnamese',
      'pad thai': 'Thai',
      'kebab': 'Mediterranean',
      'burrito': 'Mexican',
      'sandwich': 'American',
      'salad': 'Healthy',
      'coffee': 'Beverage',
      'dessert': 'Dessert'
    };

    const queryLower = query.toLowerCase();
    for (const [keyword, category] of Object.entries(categoryKeywords)) {
      if (queryLower.includes(keyword)) {
        return category;
      }
    }

    return undefined;
  }

  private generateCacheKey(request: AutocompleteRequest): string {
    const key = {
      query: request.query,
      types: request.types,
      location: request.location ? {
        lat: Math.round(request.location.latitude * 100) / 100,
        lon: Math.round(request.location.longitude * 100) / 100
      } : null,
      limit: request.limit
    };

    return `autocomplete:${Buffer.from(JSON.stringify(key)).toString('base64')}`;
  }

  private async getCachedResult(cacheKey: string): Promise<AutocompleteResult | null> {
    try {
      const cached = await redisClient.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logger.error('Failed to get cached autocomplete result', {
        error: error.message,
        cacheKey
      });
      return null;
    }
  }

  private async cacheResult(cacheKey: string, result: AutocompleteResult): Promise<void> {
    try {
      await redisClient.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));
    } catch (error) {
      logger.error('Failed to cache autocomplete result', {
        error: error.message,
        cacheKey
      });
    }
  }

  private getItemsIndexName(): string {
    return process.env.ELASTICSEARCH_ITEMS_INDEX || 'reskflow_items';
  }

  private getMerchantsIndexName(): string {
    return process.env.ELASTICSEARCH_MERCHANTS_INDEX || 'reskflow_merchants';
  }
}