import { Client } from '@elastic/elasticsearch';
import { prisma, logger, redis, config } from '@reskflow/shared';
import { MerchantStatus } from '@prisma/client';
import * as geolib from 'geolib';
import { GeolocationService } from './GeolocationService';

interface SearchParams {
  query?: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  radius: number;
  filters: {
    cuisineTypes?: string[];
    dietaryOptions?: string[];
    priceRange?: { min: number; max: number };
    rating?: number;
    reskflowTime?: number;
    freeDelivery?: boolean;
    isOpen?: boolean;
    hasPromo?: boolean;
  };
  page: number;
  limit: number;
  sortBy: 'relevance' | 'rating' | 'reskflowTime' | 'distance' | 'price';
}

interface SearchResult {
  merchants: any[];
  total: number;
  page: number;
  totalPages: number;
  facets: {
    cuisineTypes: Record<string, number>;
    dietaryOptions: Record<string, number>;
    priceRanges: Record<string, number>;
  };
}

export class SearchService {
  private esClient: Client;
  private geolocationService: GeolocationService;
  private indexName = 'merchants';

  constructor() {
    this.esClient = new Client({
      node: config.elasticsearch?.url || 'http://localhost:9200',
    });
    this.geolocationService = new GeolocationService();
  }

  async initializeIndex(): Promise<void> {
    try {
      const indexExists = await this.esClient.indices.exists({
        index: this.indexName,
      });

      if (!indexExists) {
        await this.esClient.indices.create({
          index: this.indexName,
          body: {
            mappings: {
              properties: {
                id: { type: 'keyword' },
                name: { type: 'text', analyzer: 'standard' },
                slug: { type: 'keyword' },
                type: { type: 'keyword' },
                status: { type: 'keyword' },
                description: { type: 'text' },
                cuisineTypes: { type: 'keyword' },
                dietaryOptions: { type: 'keyword' },
                rating: { type: 'float' },
                totalOrders: { type: 'integer' },
                preparationTime: { type: 'integer' },
                minOrderAmount: { type: 'float' },
                reskflowFee: { type: 'float' },
                isOpen: { type: 'boolean' },
                location: { type: 'geo_point' },
                reskflowRadius: { type: 'float' },
                createdAt: { type: 'date' },
                menuItems: {
                  type: 'nested',
                  properties: {
                    id: { type: 'keyword' },
                    name: { type: 'text' },
                    description: { type: 'text' },
                    price: { type: 'float' },
                    isVegetarian: { type: 'boolean' },
                    isVegan: { type: 'boolean' },
                    isGlutenFree: { type: 'boolean' },
                    allergens: { type: 'keyword' },
                  },
                },
              },
            },
          },
        });

        logger.info('Elasticsearch index created');

        // Index existing merchants
        await this.indexAllMerchants();
      }
    } catch (error) {
      logger.error('Failed to initialize search index', error);
    }
  }

  async searchMerchants(params: SearchParams): Promise<SearchResult> {
    const { query, location, radius, filters, page, limit, sortBy } = params;
    const from = (page - 1) * limit;

    // Build search query
    const must: any[] = [
      { term: { status: MerchantStatus.ACTIVE } },
    ];

    const should: any[] = [];
    const filter: any[] = [];

    // Text search
    if (query) {
      should.push(
        { match: { name: { query, boost: 2 } } },
        { match: { description: query } },
        { match: { cuisineTypes: query } },
        {
          nested: {
            path: 'menuItems',
            query: {
              match: { 'menuItems.name': query },
            },
          },
        }
      );
    }

    // Location filter
    if (location) {
      filter.push({
        geo_distance: {
          distance: `${radius}km`,
          location: {
            lat: location.latitude,
            lon: location.longitude,
          },
        },
      });
    }

    // Apply filters
    if (filters.cuisineTypes?.length) {
      filter.push({
        terms: { cuisineTypes: filters.cuisineTypes },
      });
    }

    if (filters.dietaryOptions?.length) {
      filter.push({
        terms: { dietaryOptions: filters.dietaryOptions },
      });
    }

    if (filters.rating) {
      filter.push({
        range: { rating: { gte: filters.rating } },
      });
    }

    if (filters.priceRange) {
      filter.push({
        range: {
          minOrderAmount: {
            gte: filters.priceRange.min,
            lte: filters.priceRange.max,
          },
        },
      });
    }

    if (filters.reskflowTime) {
      filter.push({
        range: { preparationTime: { lte: filters.reskflowTime } },
      });
    }

    if (filters.freeDelivery) {
      filter.push({ term: { reskflowFee: 0 } });
    }

    if (filters.isOpen !== undefined) {
      filter.push({ term: { isOpen: filters.isOpen } });
    }

    // Build sort
    const sort = this.buildSort(sortBy, location);

    // Execute search
    try {
      const response = await this.esClient.search({
        index: this.indexName,
        body: {
          from,
          size: limit,
          query: {
            bool: {
              must,
              should: should.length > 0 ? should : undefined,
              filter,
              minimum_should_match: should.length > 0 ? 1 : undefined,
            },
          },
          sort,
          aggs: {
            cuisineTypes: {
              terms: { field: 'cuisineTypes', size: 20 },
            },
            dietaryOptions: {
              terms: { field: 'dietaryOptions', size: 10 },
            },
            priceRanges: {
              range: {
                field: 'minOrderAmount',
                ranges: [
                  { key: 'budget', to: 10 },
                  { key: 'moderate', from: 10, to: 20 },
                  { key: 'premium', from: 20 },
                ],
              },
            },
          },
        },
      });

      const total = response.hits.total as any;
      const merchants = await this.enrichSearchResults(
        response.hits.hits,
        location
      );

      return {
        merchants,
        total: total.value,
        page,
        totalPages: Math.ceil(total.value / limit),
        facets: {
          cuisineTypes: this.extractBuckets(response.aggregations?.cuisineTypes),
          dietaryOptions: this.extractBuckets(response.aggregations?.dietaryOptions),
          priceRanges: this.extractRangeBuckets(response.aggregations?.priceRanges),
        },
      };
    } catch (error) {
      logger.error('Search query failed', error);
      throw error;
    }
  }

  async getAutocompleteSuggestions(
    query: string,
    latitude?: number,
    longitude?: number,
    limit: number = 10
  ): Promise<any[]> {
    if (!query || query.length < 2) {
      return [];
    }

    // Check cache first
    const cacheKey = `autocomplete:${query}:${latitude}:${longitude}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    try {
      const response = await this.esClient.search({
        index: this.indexName,
        body: {
          size: limit,
          query: {
            bool: {
              must: [
                { term: { status: MerchantStatus.ACTIVE } },
                {
                  multi_match: {
                    query,
                    fields: ['name^3', 'cuisineTypes^2', 'menuItems.name'],
                    type: 'phrase_prefix',
                  },
                },
              ],
            },
          },
          _source: ['id', 'name', 'cuisineTypes', 'logo'],
        },
      });

      const suggestions = response.hits.hits.map((hit: any) => ({
        id: hit._source.id,
        name: hit._source.name,
        type: 'merchant',
        cuisineTypes: hit._source.cuisineTypes,
        logo: hit._source.logo,
      }));

      // Cache for 1 hour
      await redis.set(cacheKey, JSON.stringify(suggestions), 'EX', 3600);

      return suggestions;
    } catch (error) {
      logger.error('Autocomplete failed', error);
      return [];
    }
  }

  async getMerchantDetails(
    merchantId: string,
    latitude?: number,
    longitude?: number
  ): Promise<any> {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: {
          locations: true,
          operatingHours: true,
          menus: {
            where: { isActive: true },
            include: {
              categories: {
                where: { isActive: true },
                include: {
                  items: {
                    where: { status: 'AVAILABLE' },
                  },
                },
              },
            },
          },
          reviews: {
            take: 5,
            orderBy: { createdAt: 'desc' },
          },
          promotions: {
            where: {
              isActive: true,
              validFrom: { lte: new Date() },
              validTo: { gte: new Date() },
            },
          },
        },
      });

      if (!merchant) {
        return null;
      }

      // Calculate distance if location provided
      let distance: number | undefined;
      let reskflowTime: number | undefined;

      if (latitude && longitude && merchant.locations[0]) {
        distance = geolib.getDistance(
          { latitude, longitude },
          {
            latitude: merchant.locations[0].latitude,
            longitude: merchant.locations[0].longitude,
          }
        ) / 1000; // Convert to km

        // Estimate reskflow time (15 min base + 3 min per km)
        reskflowTime = Math.round(15 + distance * 3);
      }

      return {
        ...merchant,
        distance,
        reskflowTime,
      };
    } catch (error) {
      logger.error('Failed to get merchant details', error);
      throw error;
    }
  }

  async indexMerchant(merchantId: string): Promise<void> {
    try {
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
        include: {
          locations: true,
          menuItems: {
            where: { status: 'AVAILABLE' },
            select: {
              id: true,
              name: true,
              description: true,
              price: true,
              isVegetarian: true,
              isVegan: true,
              isGlutenFree: true,
              allergens: true,
            },
          },
        },
      });

      if (!merchant || !merchant.locations[0]) {
        return;
      }

      const primaryLocation = merchant.locations[0];

      await this.esClient.index({
        index: this.indexName,
        id: merchant.id,
        body: {
          id: merchant.id,
          name: merchant.name,
          slug: merchant.slug,
          type: merchant.type,
          status: merchant.status,
          description: merchant.description,
          cuisineTypes: merchant.cuisineTypes,
          dietaryOptions: merchant.dietaryOptions,
          rating: merchant.rating,
          totalOrders: merchant.totalOrders,
          preparationTime: merchant.preparationTime,
          minOrderAmount: merchant.minOrderAmount,
          reskflowFee: merchant.reskflowFee,
          isOpen: merchant.isOpen,
          location: {
            lat: primaryLocation.latitude,
            lon: primaryLocation.longitude,
          },
          reskflowRadius: merchant.reskflowRadius,
          createdAt: merchant.createdAt,
          menuItems: merchant.menuItems,
        },
      });

      logger.info(`Merchant ${merchantId} indexed`);
    } catch (error) {
      logger.error(`Failed to index merchant ${merchantId}`, error);
    }
  }

  private async indexAllMerchants(): Promise<void> {
    const merchants = await prisma.merchant.findMany({
      where: { status: MerchantStatus.ACTIVE },
    });

    for (const merchant of merchants) {
      await this.indexMerchant(merchant.id);
    }

    logger.info(`Indexed ${merchants.length} merchants`);
  }

  private buildSort(
    sortBy: string,
    location?: { latitude: number; longitude: number }
  ): any[] {
    const sort: any[] = [];

    switch (sortBy) {
      case 'distance':
        if (location) {
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
        }
        break;
      case 'rating':
        sort.push({ rating: { order: 'desc' } });
        break;
      case 'reskflowTime':
        sort.push({ preparationTime: { order: 'asc' } });
        break;
      case 'price':
        sort.push({ minOrderAmount: { order: 'asc' } });
        break;
      case 'relevance':
      default:
        sort.push({ _score: { order: 'desc' } });
    }

    // Always add secondary sort by rating
    sort.push({ rating: { order: 'desc' } });

    return sort;
  }

  private async enrichSearchResults(
    hits: any[],
    location?: { latitude: number; longitude: number }
  ): Promise<any[]> {
    return Promise.all(
      hits.map(async (hit) => {
        const merchant = hit._source;
        
        // Calculate distance and reskflow time
        if (location && merchant.location) {
          merchant.distance = geolib.getDistance(
            location,
            {
              latitude: merchant.location.lat,
              longitude: merchant.location.lon,
            }
          ) / 1000; // Convert to km

          merchant.reskflowTime = Math.round(15 + merchant.distance * 3);
        }

        return merchant;
      })
    );
  }

  private extractBuckets(aggregation: any): Record<string, number> {
    if (!aggregation?.buckets) return {};
    
    return aggregation.buckets.reduce((acc: any, bucket: any) => {
      acc[bucket.key] = bucket.doc_count;
      return acc;
    }, {});
  }

  private extractRangeBuckets(aggregation: any): Record<string, number> {
    if (!aggregation?.buckets) return {};
    
    return aggregation.buckets.reduce((acc: any, bucket: any) => {
      acc[bucket.key] = bucket.doc_count;
      return acc;
    }, {});
  }
}