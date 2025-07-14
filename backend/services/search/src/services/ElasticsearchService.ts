import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import {
  SearchRequest,
  SearchResult,
  ElasticsearchDocument,
  SearchConfiguration,
  BulkIndexRequest,
  BulkIndexResult,
  ItemType,
  SortField,
  SortOrder,
  Location
} from '../types/search.types';
import { logger } from '../utils/logger';

export class ElasticsearchService {
  private client: ElasticsearchClient;
  private config: SearchConfiguration;

  constructor(config: SearchConfiguration) {
    this.config = config;
    this.client = new ElasticsearchClient({
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      auth: process.env.ELASTICSEARCH_AUTH ? {
        username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
        password: process.env.ELASTICSEARCH_PASSWORD || 'password',
      } : undefined,
      maxRetries: 3,
      requestTimeout: 30000,
      sniffOnStart: true,
    });
  }

  async initializeIndices(): Promise<void> {
    try {
      await this.createItemsIndex();
      await this.createMerchantsIndex();
      await this.createAnalyticsIndex();
      logger.info('Elasticsearch indices initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Elasticsearch indices', { error: error.message });
      throw error;
    }
  }

  private async createItemsIndex(): Promise<void> {
    const indexName = this.config.indices.items;
    
    const indexExists = await this.client.indices.exists({ index: indexName });
    if (indexExists) {
      logger.info(`Index ${indexName} already exists`);
      return;
    }

    const mapping = {
      properties: {
        id: { type: 'keyword' },
        type: { type: 'keyword' },
        name: {
          type: 'text',
          analyzer: 'standard',
          fields: {
            keyword: { type: 'keyword' },
            suggest: {
              type: 'completion',
              analyzer: 'simple',
              preserve_separators: true,
              preserve_position_increments: true,
              max_input_length: 50
            }
          }
        },
        description: {
          type: 'text',
          analyzer: 'standard'
        },
        merchant: {
          properties: {
            id: { type: 'keyword' },
            name: {
              type: 'text',
              fields: {
                keyword: { type: 'keyword' }
              }
            },
            type: { type: 'keyword' },
            rating: { type: 'float' },
            isVerified: { type: 'boolean' },
            location: { type: 'geo_point' },
            cuisineTypes: { type: 'keyword' },
            isOpen: { type: 'boolean' }
          }
        },
        location: { type: 'geo_point' },
        price: {
          properties: {
            amount: { type: 'float' },
            currency: { type: 'keyword' }
          }
        },
        rating: {
          properties: {
            average: { type: 'float' },
            count: { type: 'integer' }
          }
        },
        availability: {
          properties: {
            isAvailable: { type: 'boolean' },
            stockLevel: { type: 'keyword' }
          }
        },
        cuisineType: { type: 'keyword' },
        categories: { type: 'keyword' },
        tags: { type: 'keyword' },
        allergens: { type: 'keyword' },
        dietaryLabels: { type: 'keyword' },
        nutritionalInfo: {
          properties: {
            calories: { type: 'float' },
            protein: { type: 'float' },
            carbohydrates: { type: 'float' },
            fat: { type: 'float' },
            fiber: { type: 'float' },
            sugar: { type: 'float' },
            sodium: { type: 'float' },
            cholesterol: { type: 'float' },
            servingSize: { type: 'text' }
          }
        },
        deliveryTime: {
          properties: {
            min: { type: 'integer' },
            max: { type: 'integer' }
          }
        },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
        searchKeywords: {
          type: 'text',
          analyzer: 'standard'
        },
        popularity: { type: 'float' },
        isPromoted: { type: 'boolean' }
      }
    };

    await this.client.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 3,
          number_of_replicas: 1,
          analysis: {
            analyzer: {
              search_analyzer: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'stop', 'snowball']
              }
            }
          }
        },
        mappings: mapping
      }
    });

    logger.info(`Created items index: ${indexName}`);
  }

  private async createMerchantsIndex(): Promise<void> {
    const indexName = this.config.indices.merchants;
    
    const indexExists = await this.client.indices.exists({ index: indexName });
    if (indexExists) {
      logger.info(`Index ${indexName} already exists`);
      return;
    }

    const mapping = {
      properties: {
        id: { type: 'keyword' },
        name: {
          type: 'text',
          analyzer: 'standard',
          fields: {
            keyword: { type: 'keyword' },
            suggest: { type: 'completion' }
          }
        },
        type: { type: 'keyword' },
        location: { type: 'geo_point' },
        rating: { type: 'float' },
        reviewCount: { type: 'integer' },
        isVerified: { type: 'boolean' },
        isOpen: { type: 'boolean' },
        cuisineTypes: { type: 'keyword' },
        categories: { type: 'keyword' },
        deliveryFee: { type: 'float' },
        minimumOrder: { type: 'float' },
        businessHours: {
          properties: {
            dayOfWeek: { type: 'integer' },
            openTime: { type: 'keyword' },
            closeTime: { type: 'keyword' },
            isOpen: { type: 'boolean' }
          }
        },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' }
      }
    };

    await this.client.indices.create({
      index: indexName,
      body: {
        settings: {
          number_of_shards: 2,
          number_of_replicas: 1
        },
        mappings: mapping
      }
    });

    logger.info(`Created merchants index: ${indexName}`);
  }

  private async createAnalyticsIndex(): Promise<void> {
    const indexName = this.config.indices.analytics;
    
    const indexExists = await this.client.indices.exists({ index: indexName });
    if (indexExists) {
      logger.info(`Index ${indexName} already exists`);
      return;
    }

    const mapping = {
      properties: {
        query: {
          type: 'text',
          fields: {
            keyword: { type: 'keyword' }
          }
        },
        filters: { type: 'object' },
        resultsCount: { type: 'integer' },
        searchTime: { type: 'float' },
        userId: { type: 'keyword' },
        location: { type: 'geo_point' },
        timestamp: { type: 'date' },
        clickedResults: { type: 'keyword' },
        noResultsFound: { type: 'boolean' }
      }
    };

    await this.client.indices.create({
      index: indexName,
      body: {
        mappings: mapping
      }
    });

    logger.info(`Created analytics index: ${indexName}`);
  }

  async search(request: SearchRequest): Promise<SearchResult> {
    try {
      const startTime = Date.now();
      
      const query = this.buildSearchQuery(request);
      const sort = this.buildSortQuery(request.sorting, request.location);
      const aggregations = this.buildAggregations();

      const searchParams: any = {
        index: this.config.indices.items,
        body: {
          query,
          sort,
          aggregations,
          size: request.pagination?.limit || this.config.defaultLimit,
          from: this.calculateOffset(request.pagination),
          highlight: {
            fields: {
              name: {},
              description: {},
              'merchant.name': {}
            }
          }
        }
      };

      const response = await this.client.search(searchParams);
      const searchTime = Date.now() - startTime;

      return this.transformSearchResponse(response, request, searchTime);

    } catch (error) {
      logger.error('Elasticsearch search failed', {
        error: error.message,
        request: JSON.stringify(request, null, 2)
      });
      throw new Error(`Search failed: ${error.message}`);
    }
  }

  private buildSearchQuery(request: SearchRequest): any {
    const must: any[] = [];
    const filter: any[] = [];
    const should: any[] = [];

    // Main search query
    if (request.query && request.query.trim()) {
      const query = request.query.trim();
      
      must.push({
        multi_match: {
          query,
          fields: [
            'name^3',
            'description^2',
            'merchant.name^2',
            'searchKeywords^2',
            'categories',
            'tags',
            'cuisineType'
          ],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });

      // Boost exact matches
      should.push({
        match_phrase: {
          name: {
            query,
            boost: 5
          }
        }
      });
    } else {
      // If no query, match all but apply filters
      must.push({ match_all: {} });
    }

    // Apply filters
    if (request.filters) {
      this.addFiltersToQuery(request.filters, filter, request.location);
    }

    // Location-based search
    if (request.location) {
      should.push({
        geo_distance: {
          distance: `${request.location.radius || 10}km`,
          location: {
            lat: request.location.latitude,
            lon: request.location.longitude
          }
        }
      });
    }

    // Boost popular and promoted items
    should.push(
      { range: { popularity: { gte: 0.7, boost: 1.5 } } },
      { term: { isPromoted: { value: true, boost: 2.0 } } },
      { range: { 'rating.average': { gte: 4.0, boost: 1.2 } } }
    );

    const query: any = {
      bool: {
        must,
        filter,
        should,
        minimum_should_match: request.query ? 1 : 0
      }
    };

    return query;
  }

  private addFiltersToQuery(filters: any, filterArray: any[], location?: Location): void {
    // Cuisine types
    if (filters.cuisineTypes?.length) {
      filterArray.push({
        terms: { cuisineType: filters.cuisineTypes }
      });
    }

    // Dietary restrictions
    if (filters.dietaryRestrictions?.length) {
      filterArray.push({
        terms: { dietaryLabels: filters.dietaryRestrictions }
      });
    }

    // Price range
    if (filters.priceRange) {
      const priceFilter: any = {};
      if (filters.priceRange.min !== undefined) {
        priceFilter.gte = filters.priceRange.min;
      }
      if (filters.priceRange.max !== undefined) {
        priceFilter.lte = filters.priceRange.max;
      }
      if (Object.keys(priceFilter).length > 0) {
        filterArray.push({
          range: { 'price.amount': priceFilter }
        });
      }
    }

    // Rating filter
    if (filters.ratings) {
      const ratingFilter: any = {};
      if (filters.ratings.min !== undefined) {
        ratingFilter.gte = filters.ratings.min;
      }
      if (filters.ratings.max !== undefined) {
        ratingFilter.lte = filters.ratings.max;
      }
      if (Object.keys(ratingFilter).length > 0) {
        filterArray.push({
          range: { 'rating.average': ratingFilter }
        });
      }
    }

    // Delivery time
    if (filters.deliveryTime) {
      const timeFilter: any = {};
      if (filters.deliveryTime.max !== undefined) {
        timeFilter.lte = filters.deliveryTime.max;
      }
      if (Object.keys(timeFilter).length > 0) {
        filterArray.push({
          range: { 'deliveryTime.max': timeFilter }
        });
      }
    }

    // Availability
    if (filters.availability !== undefined) {
      filterArray.push({
        term: { 'availability.isAvailable': filters.availability }
      });
    }

    // Open now
    if (filters.openNow) {
      filterArray.push({
        term: { 'merchant.isOpen': true }
      });
    }

    // Categories
    if (filters.categories?.length) {
      filterArray.push({
        terms: { categories: filters.categories }
      });
    }

    // Tags
    if (filters.tags?.length) {
      filterArray.push({
        terms: { tags: filters.tags }
      });
    }

    // Allergen exclusion
    if (filters.allergens?.exclude?.length) {
      filterArray.push({
        bool: {
          must_not: {
            terms: { allergens: filters.allergens.exclude }
          }
        }
      });
    }

    // Distance filter
    if (filters.distance && location) {
      filterArray.push({
        geo_distance: {
          distance: `${filters.distance.max}${filters.distance.unit === 'miles' ? 'mi' : 'km'}`,
          location: {
            lat: location.latitude,
            lon: location.longitude
          }
        }
      });
    }

    // Nutritional filters
    if (filters.nutritionalInfo) {
      if (filters.nutritionalInfo.maxCalories) {
        filterArray.push({
          range: { 'nutritionalInfo.calories': { lte: filters.nutritionalInfo.maxCalories } }
        });
      }
      if (filters.nutritionalInfo.minProtein) {
        filterArray.push({
          range: { 'nutritionalInfo.protein': { gte: filters.nutritionalInfo.minProtein } }
        });
      }
      if (filters.nutritionalInfo.maxSodium) {
        filterArray.push({
          range: { 'nutritionalInfo.sodium': { lte: filters.nutritionalInfo.maxSodium } }
        });
      }
    }

    // Promotion filter
    if (filters.promotion?.hasPromotion) {
      filterArray.push({
        term: { isPromoted: true }
      });
    }
  }

  private buildSortQuery(sorting?: any, location?: Location): any[] {
    if (!sorting) {
      return [
        { _score: { order: 'desc' } },
        { popularity: { order: 'desc' } },
        { 'rating.average': { order: 'desc' } }
      ];
    }

    const sortArray: any[] = [];

    switch (sorting.field) {
      case SortField.RELEVANCE:
        sortArray.push({ _score: { order: 'desc' } });
        break;
      case SortField.PRICE:
        sortArray.push({ 'price.amount': { order: sorting.order || SortOrder.ASC } });
        break;
      case SortField.RATING:
        sortArray.push({ 'rating.average': { order: sorting.order || SortOrder.DESC } });
        break;
      case SortField.DISTANCE:
        if (location) {
          sortArray.push({
            _geo_distance: {
              location: {
                lat: location.latitude,
                lon: location.longitude
              },
              order: sorting.order || SortOrder.ASC,
              unit: 'km'
            }
          });
        }
        break;
      case SortField.DELIVERY_TIME:
        sortArray.push({ 'deliveryTime.max': { order: sorting.order || SortOrder.ASC } });
        break;
      case SortField.POPULARITY:
        sortArray.push({ popularity: { order: sorting.order || SortOrder.DESC } });
        break;
      case SortField.NEWEST:
        sortArray.push({ createdAt: { order: sorting.order || SortOrder.DESC } });
        break;
      case SortField.ALPHABETICAL:
        sortArray.push({ 'name.keyword': { order: sorting.order || SortOrder.ASC } });
        break;
    }

    // Always add a tiebreaker
    sortArray.push({ _id: { order: 'asc' } });

    return sortArray;
  }

  private buildAggregations(): any {
    return {
      cuisineTypes: {
        terms: {
          field: 'cuisineType',
          size: 20
        }
      },
      categories: {
        terms: {
          field: 'categories',
          size: 30
        }
      },
      priceRanges: {
        range: {
          field: 'price.amount',
          ranges: [
            { key: '$', to: 10 },
            { key: '$$', from: 10, to: 25 },
            { key: '$$$', from: 25, to: 50 },
            { key: '$$$$', from: 50 }
          ]
        }
      },
      ratings: {
        range: {
          field: 'rating.average',
          ranges: [
            { key: '4+ stars', from: 4 },
            { key: '3+ stars', from: 3, to: 4 },
            { key: '2+ stars', from: 2, to: 3 },
            { key: '1+ stars', from: 1, to: 2 }
          ]
        }
      },
      dietaryLabels: {
        terms: {
          field: 'dietaryLabels',
          size: 15
        }
      },
      deliveryTimes: {
        range: {
          field: 'deliveryTime.max',
          ranges: [
            { key: '0-30 min', to: 30 },
            { key: '30-60 min', from: 30, to: 60 },
            { key: '60+ min', from: 60 }
          ]
        }
      },
      merchants: {
        terms: {
          field: 'merchant.name.keyword',
          size: 10
        }
      }
    };
  }

  private calculateOffset(pagination?: any): number {
    if (!pagination) return 0;
    return ((pagination.page || 1) - 1) * (pagination.limit || this.config.defaultLimit);
  }

  private transformSearchResponse(response: any, request: SearchRequest, searchTime: number): SearchResult {
    const hits = response.body.hits;
    const aggregations = response.body.aggregations;

    const results = hits.hits.map((hit: any) => {
      const source = hit._source;
      const score = hit._score;
      
      // Calculate distance if location is provided
      let distance: number | undefined;
      if (request.location && source.location) {
        distance = this.calculateDistance(
          request.location.latitude,
          request.location.longitude,
          source.location.lat,
          source.location.lon
        );
      }

      return {
        id: source.id,
        type: source.type,
        name: source.name,
        description: source.description,
        merchant: {
          id: source.merchant.id,
          name: source.merchant.name,
          type: source.merchant.type,
          rating: source.merchant.rating,
          reviewCount: 0, // This would come from merchant service
          isVerified: source.merchant.isVerified,
          deliveryFee: 0, // This would come from merchant service
          minimumOrder: 0, // This would come from merchant service
          estimatedDeliveryTime: {
            min: source.deliveryTime.min,
            max: source.deliveryTime.max,
            unit: 'minutes'
          },
          isOpen: source.merchant.isOpen,
          cuisineTypes: source.merchant.cuisineTypes,
          businessHours: []
        },
        location: {
          latitude: source.location.lat,
          longitude: source.location.lon
        },
        price: {
          amount: source.price.amount,
          currency: source.price.currency
        },
        rating: {
          average: source.rating.average,
          count: source.rating.count
        },
        availability: {
          isAvailable: source.availability.isAvailable,
          stockLevel: source.availability.stockLevel
        },
        cuisineType: source.cuisineType,
        categories: source.categories,
        tags: source.tags,
        images: [], // This would come from a separate service
        nutritionalInfo: source.nutritionalInfo,
        allergens: source.allergens,
        dietaryLabels: source.dietaryLabels,
        deliveryTime: {
          min: source.deliveryTime.min,
          max: source.deliveryTime.max,
          unit: 'minutes'
        },
        distance,
        relevanceScore: score,
        isPromoted: source.isPromoted,
        promotions: []
      };
    });

    const total = hits.total.value;
    const limit = request.pagination?.limit || this.config.defaultLimit;
    const page = request.pagination?.page || 1;

    return {
      results,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrev: page > 1
      },
      aggregations: this.transformAggregations(aggregations),
      suggestions: [],
      filters: request.filters,
      searchTime,
      totalResults: total
    };
  }

  private transformAggregations(aggregations: any): any {
    if (!aggregations) return {};

    const transformed: any = {};

    Object.keys(aggregations).forEach(key => {
      const agg = aggregations[key];
      
      if (agg.buckets) {
        transformed[key] = agg.buckets.map((bucket: any) => ({
          key: bucket.key,
          count: bucket.doc_count
        }));
      }
    });

    return transformed;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
  }

  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  async indexDocument(document: ElasticsearchDocument): Promise<void> {
    try {
      await this.client.index({
        index: this.config.indices.items,
        id: document.id,
        body: document
      });

      logger.debug('Document indexed successfully', { documentId: document.id });
    } catch (error) {
      logger.error('Failed to index document', {
        error: error.message,
        documentId: document.id
      });
      throw error;
    }
  }

  async bulkIndex(request: BulkIndexRequest): Promise<BulkIndexResult> {
    try {
      const body: any[] = [];
      
      request.items.forEach(item => {
        body.push({
          index: {
            _index: request.index,
            _id: item.id
          }
        });
        body.push(item);
      });

      const response = await this.client.bulk({
        body,
        refresh: request.refresh
      });

      const result: BulkIndexResult = {
        indexed: 0,
        failed: 0,
        errors: [],
        took: response.body.took
      };

      response.body.items.forEach((item: any) => {
        if (item.index.error) {
          result.failed++;
          result.errors.push(item.index.error);
        } else {
          result.indexed++;
        }
      });

      logger.info('Bulk indexing completed', {
        indexed: result.indexed,
        failed: result.failed,
        took: result.took
      });

      return result;
    } catch (error) {
      logger.error('Bulk indexing failed', { error: error.message });
      throw error;
    }
  }

  async deleteDocument(id: string): Promise<void> {
    try {
      await this.client.delete({
        index: this.config.indices.items,
        id
      });

      logger.debug('Document deleted successfully', { documentId: id });
    } catch (error) {
      logger.error('Failed to delete document', {
        error: error.message,
        documentId: id
      });
      throw error;
    }
  }

  async updateDocument(id: string, updates: Partial<ElasticsearchDocument>): Promise<void> {
    try {
      await this.client.update({
        index: this.config.indices.items,
        id,
        body: {
          doc: updates
        }
      });

      logger.debug('Document updated successfully', { documentId: id });
    } catch (error) {
      logger.error('Failed to update document', {
        error: error.message,
        documentId: id
      });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.cluster.health();
      return response.body.status !== 'red';
    } catch (error) {
      logger.error('Elasticsearch health check failed', { error: error.message });
      return false;
    }
  }

  async getIndexStats(): Promise<any> {
    try {
      const response = await this.client.indices.stats({
        index: Object.values(this.config.indices)
      });
      return response.body;
    } catch (error) {
      logger.error('Failed to get index stats', { error: error.message });
      throw error;
    }
  }
}