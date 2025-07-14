import { Request, Response } from 'express';
import { SearchService } from '../services/SearchService';
import { 
  SearchRequest as SearchRequestType,
  AutocompleteRequest,
  SearchConfiguration,
  ElasticsearchDocument
} from '../types/search.types';
import { validateSearchRequest, validateAutocompleteRequest } from '../middleware/validation';
import { logger } from '../utils/logger';

export class SearchController {
  constructor(private searchService: SearchService) {}

  async search(req: Request, res: Response): Promise<void> {
    try {
      const searchRequest: SearchRequestType = {
        query: req.query.q as string || '',
        filters: {
          cuisineTypes: this.parseArrayParam(req.query.cuisineTypes),
          dietaryRestrictions: this.parseArrayParam(req.query.dietaryRestrictions),
          priceRange: req.query.priceMin || req.query.priceMax ? {
            min: req.query.priceMin ? parseFloat(req.query.priceMin as string) : undefined,
            max: req.query.priceMax ? parseFloat(req.query.priceMax as string) : undefined
          } : undefined,
          ratings: req.query.minRating ? {
            min: parseFloat(req.query.minRating as string)
          } : undefined,
          deliveryTime: req.query.maxDeliveryTime ? {
            max: parseInt(req.query.maxDeliveryTime as string, 10),
            unit: 'minutes' as any
          } : undefined,
          availability: req.query.availability ? req.query.availability === 'true' : undefined,
          openNow: req.query.openNow ? req.query.openNow === 'true' : undefined,
          distance: req.query.maxDistance ? {
            max: parseFloat(req.query.maxDistance as string),
            unit: 'km' as any
          } : undefined,
          categories: this.parseArrayParam(req.query.categories),
          tags: this.parseArrayParam(req.query.tags),
          allergens: req.query.excludeAllergens ? {
            exclude: this.parseArrayParam(req.query.excludeAllergens)
          } : undefined,
          nutritionalInfo: this.parseNutritionalFilters(req.query)
        },
        location: req.query.lat && req.query.lon ? {
          latitude: parseFloat(req.query.lat as string),
          longitude: parseFloat(req.query.lon as string),
          radius: req.query.radius ? parseFloat(req.query.radius as string) : undefined
        } : undefined,
        pagination: {
          page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
          limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20
        },
        sorting: req.query.sortBy ? {
          field: req.query.sortBy as any,
          order: (req.query.sortOrder as any) || 'desc'
        } : undefined,
        preferences: {
          userId: req.user?.id
        }
      };

      const result = await this.searchService.search(searchRequest, req.user?.id);

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Search request failed', {
        error: error.message,
        stack: error.stack,
        query: req.query,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Search failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async autocomplete(req: Request, res: Response): Promise<void> {
    try {
      const autocompleteRequest: AutocompleteRequest = {
        query: req.query.q as string || '',
        types: req.query.types ? this.parseArrayParam(req.query.types) as any : undefined,
        location: req.query.lat && req.query.lon ? {
          latitude: parseFloat(req.query.lat as string),
          longitude: parseFloat(req.query.lon as string)
        } : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 10
      };

      const result = await this.searchService.autocomplete(autocompleteRequest);

      res.status(200).json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Autocomplete request failed', {
        error: error.message,
        stack: error.stack,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: 'Autocomplete failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async suggestions(req: Request, res: Response): Promise<void> {
    try {
      const query = req.query.q as string || '';
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;

      const suggestions = await this.searchService.getSearchSuggestions(query, limit);

      res.status(200).json({
        success: true,
        data: { suggestions },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Suggestions request failed', {
        error: error.message,
        stack: error.stack,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: 'Suggestions failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async indexItems(req: Request, res: Response): Promise<void> {
    try {
      const items = req.body.items as ElasticsearchDocument[];

      if (!Array.isArray(items) || items.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Items array is required and must not be empty',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await this.searchService.indexItems(items);

      res.status(200).json({
        success: true,
        message: `Successfully indexed ${items.length} items`,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Index items request failed', {
        error: error.message,
        stack: error.stack,
        itemCount: req.body.items?.length
      });

      res.status(500).json({
        success: false,
        error: 'Indexing failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async updateItem(req: Request, res: Response): Promise<void> {
    try {
      const itemId = req.params.itemId;
      const updates = req.body;

      if (!itemId) {
        res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Item ID is required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await this.searchService.updateItem(itemId, updates);

      res.status(200).json({
        success: true,
        message: 'Item updated successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Update item request failed', {
        error: error.message,
        stack: error.stack,
        itemId: req.params.itemId
      });

      res.status(500).json({
        success: false,
        error: 'Update failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async deleteItem(req: Request, res: Response): Promise<void> {
    try {
      const itemId = req.params.itemId;

      if (!itemId) {
        res.status(400).json({
          success: false,
          error: 'Invalid request',
          message: 'Item ID is required',
          timestamp: new Date().toISOString()
        });
        return;
      }

      await this.searchService.deleteItem(itemId);

      res.status(200).json({
        success: true,
        message: 'Item deleted successfully',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Delete item request failed', {
        error: error.message,
        stack: error.stack,
        itemId: req.params.itemId
      });

      res.status(500).json({
        success: false,
        error: 'Delete failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async getAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const filters = {
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        userId: req.query.userId as string
      };

      const analytics = await this.searchService.getSearchAnalytics(filters);

      res.status(200).json({
        success: true,
        data: analytics,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Analytics request failed', {
        error: error.message,
        stack: error.stack,
        filters: req.query
      });

      res.status(500).json({
        success: false,
        error: 'Analytics failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async getPopularQueries(req: Request, res: Response): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const popularQueries = await this.searchService.getPopularQueries(limit);

      res.status(200).json({
        success: true,
        data: { popularQueries },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Popular queries request failed', {
        error: error.message,
        stack: error.stack
      });

      res.status(500).json({
        success: false,
        error: 'Popular queries failed',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date().toISOString()
      });
    }
  }

  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const health = await this.searchService.healthCheck();

      res.status(health.overall ? 200 : 503).json({
        success: health.overall,
        data: health,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Health check failed', {
        error: error.message,
        stack: error.stack
      });

      res.status(503).json({
        success: false,
        error: 'Health check failed',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  private parseArrayParam(param: unknown): string[] | undefined {
    if (!param) return undefined;
    
    if (typeof param === 'string') {
      return param.split(',').map(s => s.trim()).filter(s => s.length > 0);
    }
    
    if (Array.isArray(param)) {
      return param.map(String).filter(s => s.length > 0);
    }
    
    return undefined;
  }

  private parseNutritionalFilters(query: any): any {
    const nutritional: any = {};
    
    if (query.maxCalories) {
      nutritional.maxCalories = parseFloat(query.maxCalories);
    }
    
    if (query.minProtein) {
      nutritional.minProtein = parseFloat(query.minProtein);
    }
    
    if (query.maxSodium) {
      nutritional.maxSodium = parseFloat(query.maxSodium);
    }
    
    if (query.maxSugar) {
      nutritional.maxSugar = parseFloat(query.maxSugar);
    }
    
    if (query.maxFat) {
      nutritional.maxFat = parseFloat(query.maxFat);
    }
    
    if (query.minFiber) {
      nutritional.minFiber = parseFloat(query.minFiber);
    }
    
    return Object.keys(nutritional).length > 0 ? nutritional : undefined;
  }
}