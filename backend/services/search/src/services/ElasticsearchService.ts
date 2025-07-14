import { Client } from '@elastic/elasticsearch';
import { prisma, logger } from '@reskflow/shared';

interface SearchParams {
  index: string;
  body: any;
  from?: number;
  size?: number;
}

interface IndexMapping {
  properties: {
    [key: string]: any;
  };
}

export class ElasticsearchService {
  private client: Client;
  private readonly indices = {
    items: 'reskflow_items',
    merchants: 'reskflow_merchants',
    cuisines: 'reskflow_cuisines',
  };

  constructor() {
    this.client = new Client({
      node: process.env.ELASTICSEARCH_URL || 'http://localhost:9200',
      auth: {
        username: process.env.ELASTICSEARCH_USERNAME || 'elastic',
        password: process.env.ELASTICSEARCH_PASSWORD || 'changeme',
      },
    });
  }

  async initialize(): Promise<void> {
    try {
      // Check connection
      await this.client.ping();
      logger.info('Connected to Elasticsearch');

      // Create indices if they don't exist
      await this.createIndices();
      
      // Update mappings
      await this.updateMappings();
      
    } catch (error) {
      logger.error('Failed to initialize Elasticsearch:', error);
      throw error;
    }
  }

  async search(params: SearchParams): Promise<any> {
    try {
      const response = await this.client.search(params);
      return response.body;
    } catch (error) {
      logger.error('Elasticsearch search error:', error);
      throw error;
    }
  }

  async index(index: string, id: string, document: any): Promise<void> {
    try {
      await this.client.index({
        index,
        id,
        body: document,
        refresh: true,
      });
    } catch (error) {
      logger.error('Elasticsearch index error:', error);
      throw error;
    }
  }

  async bulkIndex(index: string, documents: Array<{ id: string; data: any }>): Promise<void> {
    if (documents.length === 0) return;

    const body = documents.flatMap(doc => [
      { index: { _index: index, _id: doc.id } },
      doc.data,
    ]);

    try {
      const response = await this.client.bulk({ body, refresh: true });
      
      if (response.body.errors) {
        const errors = response.body.items.filter((item: any) => item.index?.error);
        logger.error('Bulk index errors:', errors);
      }
    } catch (error) {
      logger.error('Elasticsearch bulk index error:', error);
      throw error;
    }
  }

  async updateItem(data: { itemId: string; updates: any }): Promise<void> {
    try {
      await this.client.update({
        index: this.indices.items,
        id: data.itemId,
        body: {
          doc: data.updates,
        },
        refresh: true,
      });
    } catch (error) {
      logger.error('Elasticsearch update error:', error);
      throw error;
    }
  }

  async deleteItem(itemId: string): Promise<void> {
    try {
      await this.client.delete({
        index: this.indices.items,
        id: itemId,
        refresh: true,
      });
    } catch (error) {
      logger.error('Elasticsearch delete error:', error);
      throw error;
    }
  }

  async getSuggestions(query: string): Promise<any[]> {
    try {
      const response = await this.client.search({
        index: this.indices.items,
        body: {
          suggest: {
            item_suggest: {
              prefix: query,
              completion: {
                field: 'suggest',
                size: 10,
                fuzzy: {
                  fuzziness: 'AUTO',
                },
              },
            },
          },
        },
      });

      const suggestions = response.body.suggest.item_suggest[0].options.map((option: any) => ({
        text: option.text,
        score: option._score,
        type: option._source?.type || 'item',
      }));

      return suggestions;
    } catch (error) {
      logger.error('Elasticsearch suggestions error:', error);
      return [];
    }
  }

  async reindexData(type: string): Promise<void> {
    logger.info(`Starting reindex for type: ${type}`);

    switch (type) {
      case 'items':
        await this.reindexItems();
        break;
      case 'merchants':
        await this.reindexMerchants();
        break;
      case 'cuisines':
        await this.reindexCuisines();
        break;
      default:
        throw new Error(`Unknown reindex type: ${type}`);
    }

    logger.info(`Completed reindex for type: ${type}`);
  }

  async updateSynonyms(synonyms: Array<{ term: string; synonyms: string[] }>): Promise<void> {
    const synonymText = synonyms.map(s => 
      `${s.term},${s.synonyms.join(',')}`
    ).join('\n');

    try {
      // Update synonym filter
      await this.client.indices.close({ index: this.indices.items });
      
      await this.client.indices.putSettings({
        index: this.indices.items,
        body: {
          analysis: {
            filter: {
              synonym_filter: {
                type: 'synonym',
                synonyms: synonymText.split('\n'),
              },
            },
          },
        },
      });
      
      await this.client.indices.open({ index: this.indices.items });
      
      logger.info('Updated synonyms successfully');
    } catch (error) {
      logger.error('Error updating synonyms:', error);
      throw error;
    }
  }

  async checkHealth(): Promise<any> {
    try {
      const health = await this.client.cluster.health();
      return health.body;
    } catch (error) {
      logger.error('Elasticsearch health check error:', error);
      return { status: 'red', error: error.message };
    }
  }

  private async createIndices(): Promise<void> {
    for (const [key, indexName] of Object.entries(this.indices)) {
      try {
        const exists = await this.client.indices.exists({ index: indexName });
        
        if (!exists.body) {
          await this.client.indices.create({
            index: indexName,
            body: this.getIndexSettings(key),
          });
          logger.info(`Created index: ${indexName}`);
        }
      } catch (error) {
        logger.error(`Error creating index ${indexName}:`, error);
      }
    }
  }

  private async updateMappings(): Promise<void> {
    // Update item mappings
    await this.client.indices.putMapping({
      index: this.indices.items,
      body: this.getItemMapping(),
    });

    // Update merchant mappings
    await this.client.indices.putMapping({
      index: this.indices.merchants,
      body: this.getMerchantMapping(),
    });
  }

  private getIndexSettings(type: string): any {
    const baseSettings = {
      settings: {
        number_of_shards: 1,
        number_of_replicas: 1,
        analysis: {
          analyzer: {
            autocomplete: {
              tokenizer: 'autocomplete',
              filter: ['lowercase'],
            },
            autocomplete_search: {
              tokenizer: 'lowercase',
            },
            text_analyzer: {
              tokenizer: 'standard',
              filter: ['lowercase', 'synonym_filter', 'stop'],
            },
          },
          tokenizer: {
            autocomplete: {
              type: 'edge_ngram',
              min_gram: 2,
              max_gram: 10,
              token_chars: ['letter', 'digit'],
            },
          },
          filter: {
            synonym_filter: {
              type: 'synonym',
              synonyms: [
                'burger,hamburger',
                'pizza,pizzas',
                'coffee,cafe,caffeine',
                'soda,pop,soft drink',
                'fries,french fries',
              ],
            },
          },
        },
      },
    };

    return baseSettings;
  }

  private getItemMapping(): IndexMapping {
    return {
      properties: {
        id: { type: 'keyword' },
        name: {
          type: 'text',
          analyzer: 'text_analyzer',
          fields: {
            keyword: { type: 'keyword' },
            autocomplete: {
              type: 'text',
              analyzer: 'autocomplete',
              search_analyzer: 'autocomplete_search',
            },
          },
        },
        description: {
          type: 'text',
          analyzer: 'text_analyzer',
        },
        category: {
          type: 'text',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        cuisine: {
          type: 'text',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        price: { type: 'float' },
        merchant_id: { type: 'keyword' },
        merchant_name: {
          type: 'text',
          fields: {
            keyword: { type: 'keyword' },
          },
        },
        location: { type: 'geo_point' },
        rating: { type: 'float' },
        dietary_tags: {
          type: 'keyword',
          normalizer: 'lowercase',
        },
        allergens: {
          type: 'keyword',
          normalizer: 'lowercase',
        },
        tags: {
          type: 'keyword',
          normalizer: 'lowercase',
        },
        is_available: { type: 'boolean' },
        preparation_time: { type: 'integer' },
        popularity_score: { type: 'float' },
        image_url: { type: 'keyword' },
        suggest: {
          type: 'completion',
          analyzer: 'simple',
          preserve_separators: true,
          preserve_position_increments: true,
          max_input_length: 50,
        },
        created_at: { type: 'date' },
        updated_at: { type: 'date' },
      },
    };
  }

  private getMerchantMapping(): IndexMapping {
    return {
      properties: {
        id: { type: 'keyword' },
        name: {
          type: 'text',
          analyzer: 'text_analyzer',
          fields: {
            keyword: { type: 'keyword' },
            autocomplete: {
              type: 'text',
              analyzer: 'autocomplete',
              search_analyzer: 'autocomplete_search',
            },
          },
        },
        description: {
          type: 'text',
          analyzer: 'text_analyzer',
        },
        cuisine_types: {
          type: 'keyword',
          normalizer: 'lowercase',
        },
        location: { type: 'geo_point' },
        address: { type: 'text' },
        rating: { type: 'float' },
        review_count: { type: 'integer' },
        price_range: { type: 'keyword' },
        is_active: { type: 'boolean' },
        reskflow_time: { type: 'integer' },
        minimum_order: { type: 'float' },
        tags: {
          type: 'keyword',
          normalizer: 'lowercase',
        },
        operating_hours: { type: 'object', enabled: false },
        suggest: {
          type: 'completion',
          analyzer: 'simple',
        },
      },
    };
  }

  private async reindexItems(): Promise<void> {
    const batchSize = 100;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const items = await prisma.item.findMany({
        skip: offset,
        take: batchSize,
        include: {
          merchant: true,
          dietary_info: true,
        },
      });

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      const documents = items.map(item => ({
        id: item.id,
        data: {
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
          cuisine: item.merchant.cuisine_type,
          price: item.price,
          merchant_id: item.merchant_id,
          merchant_name: item.merchant.name,
          location: {
            lat: item.merchant.latitude,
            lon: item.merchant.longitude,
          },
          rating: item.rating || item.merchant.rating,
          dietary_tags: item.dietary_info?.tags || [],
          allergens: item.dietary_info?.allergens || [],
          tags: item.tags || [],
          is_available: item.is_available,
          preparation_time: item.preparation_time,
          popularity_score: item.order_count || 0,
          image_url: item.image_url,
          suggest: {
            input: [item.name, item.category, item.merchant.name],
            weight: item.order_count || 1,
          },
          created_at: item.created_at,
          updated_at: item.updated_at,
        },
      }));

      await this.bulkIndex(this.indices.items, documents);
      
      offset += batchSize;
      logger.info(`Reindexed ${offset} items`);
    }
  }

  private async reindexMerchants(): Promise<void> {
    const batchSize = 50;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const merchants = await prisma.merchant.findMany({
        skip: offset,
        take: batchSize,
        include: {
          _count: {
            select: { reviews: true },
          },
        },
      });

      if (merchants.length === 0) {
        hasMore = false;
        break;
      }

      const documents = merchants.map(merchant => ({
        id: merchant.id,
        data: {
          id: merchant.id,
          name: merchant.name,
          description: merchant.description,
          cuisine_types: [merchant.cuisine_type],
          location: {
            lat: merchant.latitude,
            lon: merchant.longitude,
          },
          address: merchant.address,
          rating: merchant.rating,
          review_count: merchant._count.reviews,
          price_range: merchant.price_range,
          is_active: merchant.is_active,
          reskflow_time: merchant.estimated_reskflow_time,
          minimum_order: merchant.minimum_order,
          tags: merchant.tags || [],
          operating_hours: merchant.operating_hours,
          suggest: {
            input: [merchant.name, merchant.cuisine_type],
            weight: merchant._count.reviews || 1,
          },
        },
      }));

      await this.bulkIndex(this.indices.merchants, documents);
      
      offset += batchSize;
      logger.info(`Reindexed ${offset} merchants`);
    }
  }

  private async reindexCuisines(): Promise<void> {
    // Get unique cuisines from merchants
    const cuisines = await prisma.merchant.findMany({
      select: { cuisine_type: true },
      distinct: ['cuisine_type'],
    });

    const cuisineCount = await prisma.merchant.groupBy({
      by: ['cuisine_type'],
      _count: true,
    });

    const countMap = new Map(
      cuisineCount.map(c => [c.cuisine_type, c._count])
    );

    const documents = cuisines.map(cuisine => ({
      id: cuisine.cuisine_type.toLowerCase().replace(/\s+/g, '_'),
      data: {
        name: cuisine.cuisine_type,
        popularity: countMap.get(cuisine.cuisine_type) || 0,
        suggest: {
          input: [cuisine.cuisine_type],
          weight: countMap.get(cuisine.cuisine_type) || 1,
        },
      },
    }));

    await this.bulkIndex(this.indices.cuisines, documents);
    logger.info(`Reindexed ${documents.length} cuisines`);
  }
}