import { Router } from 'express';
import { SearchController } from '../controllers/SearchController';
import { SearchService } from '../services/SearchService';
import { ElasticsearchService } from '../services/ElasticsearchService';
import { SearchAnalyticsService } from '../services/SearchAnalyticsService';
import { AutocompleteService } from '../services/AutocompleteService';
import { SearchConfiguration } from '../types/search.types';
import {
  validateSearchRequest,
  validateAutocompleteRequest,
  validateIndexItems,
  validateUpdateItem,
  validateItemId,
  validateAnalyticsFilters
} from '../middleware/validation';
import {
  authenticateUser,
  authenticateService,
  requireAdmin,
  requireService
} from '../middleware/auth';
import { rateLimitMiddleware } from '../middleware/rateLimiter';

// Initialize services
const searchConfig: SearchConfiguration = {
  indices: {
    items: process.env.ELASTICSEARCH_ITEMS_INDEX || 'reskflow_items',
    merchants: process.env.ELASTICSEARCH_MERCHANTS_INDEX || 'reskflow_merchants',
    categories: process.env.ELASTICSEARCH_CATEGORIES_INDEX || 'reskflow_categories',
    analytics: process.env.ELASTICSEARCH_ANALYTICS_INDEX || 'reskflow_analytics'
  },
  defaultLimit: parseInt(process.env.SEARCH_DEFAULT_LIMIT || '20', 10),
  maxLimit: parseInt(process.env.SEARCH_MAX_LIMIT || '100', 10),
  cacheTimeout: parseInt(process.env.SEARCH_CACHE_TIMEOUT || '300', 10), // 5 minutes
  suggestionLimit: parseInt(process.env.SEARCH_SUGGESTION_LIMIT || '10', 10),
  popularityWeight: parseFloat(process.env.SEARCH_POPULARITY_WEIGHT || '1.0'),
  locationWeight: parseFloat(process.env.SEARCH_LOCATION_WEIGHT || '1.0'),
  ratingWeight: parseFloat(process.env.SEARCH_RATING_WEIGHT || '1.0'),
  availabilityWeight: parseFloat(process.env.SEARCH_AVAILABILITY_WEIGHT || '1.0')
};

const searchService = new SearchService(searchConfig);

// Initialize the search service
searchService.initialize().catch(error => {
  console.error('Failed to initialize search service:', error);
});

const searchController = new SearchController(searchService);

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticateUser);
router.use(authenticateService);

// Public search endpoints
router.get(
  '/',
  rateLimitMiddleware,
  validateSearchRequest,
  searchController.search.bind(searchController)
);

router.get(
  '/autocomplete',
  rateLimitMiddleware,
  validateAutocompleteRequest,
  searchController.autocomplete.bind(searchController)
);

router.get(
  '/suggestions',
  rateLimitMiddleware,
  searchController.suggestions.bind(searchController)
);

router.get(
  '/popular',
  rateLimitMiddleware,
  searchController.getPopularQueries.bind(searchController)
);

// Administrative endpoints (require admin or service authentication)
router.post(
  '/index',
  requireService,
  validateIndexItems,
  searchController.indexItems.bind(searchController)
);

router.put(
  '/items/:itemId',
  requireService,
  validateItemId,
  validateUpdateItem,
  searchController.updateItem.bind(searchController)
);

router.delete(
  '/items/:itemId',
  requireService,
  validateItemId,
  searchController.deleteItem.bind(searchController)
);

// Analytics endpoints (require admin access)
router.get(
  '/analytics',
  requireAdmin,
  validateAnalyticsFilters,
  searchController.getAnalytics.bind(searchController)
);

// Health check endpoint
router.get(
  '/health',
  searchController.healthCheck.bind(searchController)
);

export default router;