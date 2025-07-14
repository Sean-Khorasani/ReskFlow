import express from 'express';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { SearchService } from './services/SearchService';
import { DietaryFilterService } from './services/DietaryFilterService';
import { PreferenceService } from './services/PreferenceService';
import { SearchAnalyticsService } from './services/SearchAnalyticsService';
import { RecommendationIntegrationService } from './services/RecommendationIntegrationService';
import { ElasticsearchService } from './services/ElasticsearchService';
import { createClient } from 'redis';

const app = express();
app.use(express.json());

// Initialize Redis
const redisClient = createClient({
  url: `redis://${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || '6379'}`,
});

redisClient.on('error', (err) => logger.error('Redis Client Error', err));

// Initialize queues
const searchQueue = new Bull('search-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const indexQueue = new Bull('index-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const elasticsearchService = new ElasticsearchService();
const dietaryFilterService = new DietaryFilterService();
const preferenceService = new PreferenceService();
const searchAnalyticsService = new SearchAnalyticsService(searchQueue);
const recommendationIntegrationService = new RecommendationIntegrationService();
const searchService = new SearchService(
  elasticsearchService,
  dietaryFilterService,
  preferenceService,
  searchAnalyticsService,
  recommendationIntegrationService,
  redisClient
);

// Search routes
app.post('/api/search', authMiddleware, async (req, res) => {
  try {
    const {
      query,
      filters,
      location,
      page = 1,
      limit = 20,
      sortBy = 'relevance',
    } = req.body;

    const results = await searchService.search({
      query,
      filters,
      location,
      userId: req.user.id,
      page,
      limit,
      sortBy,
    });

    res.json(results);
  } catch (error) {
    logger.error('Search error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/search/suggestions', authMiddleware, async (req, res) => {
  try {
    const { query, location } = req.query;

    const suggestions = await searchService.getSuggestions({
      query: query as string,
      location: location as string,
      userId: req.user.id,
    });

    res.json(suggestions);
  } catch (error) {
    logger.error('Suggestions error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/search/recent', authMiddleware, async (req, res) => {
  try {
    const recent = await searchService.getRecentSearches(req.user.id);
    res.json(recent);
  } catch (error) {
    logger.error('Recent searches error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Dietary filter routes
app.get('/api/dietary/filters', async (req, res) => {
  try {
    const filters = await dietaryFilterService.getAvailableFilters();
    res.json(filters);
  } catch (error) {
    logger.error('Dietary filters error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/dietary/allergens', async (req, res) => {
  try {
    const allergens = await dietaryFilterService.getAllergens();
    res.json(allergens);
  } catch (error) {
    logger.error('Allergens error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/dietary/analyze-item', authMiddleware, async (req, res) => {
  try {
    const { itemId } = req.body;
    
    const analysis = await dietaryFilterService.analyzeItemCompatibility(
      itemId,
      req.user.id
    );
    
    res.json(analysis);
  } catch (error) {
    logger.error('Item analysis error:', error);
    res.status(400).json({ error: error.message });
  }
});

// User preference routes
app.get('/api/preferences', authMiddleware, async (req, res) => {
  try {
    const preferences = await preferenceService.getUserPreferences(req.user.id);
    res.json(preferences);
  } catch (error) {
    logger.error('Get preferences error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.put('/api/preferences', authMiddleware, async (req, res) => {
  try {
    const { dietaryRestrictions, allergens, cuisinePreferences, priceRange } = req.body;
    
    const updated = await preferenceService.updateUserPreferences(req.user.id, {
      dietaryRestrictions,
      allergens,
      cuisinePreferences,
      priceRange,
    });
    
    res.json(updated);
  } catch (error) {
    logger.error('Update preferences error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/preferences/learn', authMiddleware, async (req, res) => {
  try {
    const { action, data } = req.body;
    
    await preferenceService.learnFromBehavior(req.user.id, action, data);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Learn preferences error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Analytics routes
app.get('/api/search/analytics/popular', async (req, res) => {
  try {
    const { location, timeframe = '24h' } = req.query;
    
    const popular = await searchAnalyticsService.getPopularSearches({
      location: location as string,
      timeframe: timeframe as string,
    });
    
    res.json(popular);
  } catch (error) {
    logger.error('Popular searches error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/search/analytics/trends', async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    
    const trends = await searchAnalyticsService.getSearchTrends(period as string);
    
    res.json(trends);
  } catch (error) {
    logger.error('Search trends error:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/search/analytics/conversion', authMiddleware, async (req, res) => {
  try {
    const { searchId } = req.query;
    
    const conversion = await searchAnalyticsService.getConversionRate(
      searchId as string
    );
    
    res.json(conversion);
  } catch (error) {
    logger.error('Conversion analytics error:', error);
    res.status(400).json({ error: error.message });
  }
});

// Admin routes for managing search
app.post('/api/admin/search/reindex', authMiddleware, async (req, res) => {
  try {
    // Check admin permission
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { type } = req.body;
    
    await indexQueue.add('reindex', { type });
    
    res.json({ success: true, message: 'Reindexing queued' });
  } catch (error) {
    logger.error('Reindex error:', error);
    res.status(500).json({ error: 'Failed to queue reindex' });
  }
});

app.post('/api/admin/search/synonyms', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const { synonyms } = req.body;
    
    await elasticsearchService.updateSynonyms(synonyms);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Update synonyms error:', error);
    res.status(500).json({ error: 'Failed to update synonyms' });
  }
});

// Process queues
searchQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'track-search':
      await searchAnalyticsService.trackSearch(data);
      break;
    case 'track-click':
      await searchAnalyticsService.trackClick(data);
      break;
    case 'track-conversion':
      await searchAnalyticsService.trackConversion(data);
      break;
    case 'generate-insights':
      await searchAnalyticsService.generateInsights(data);
      break;
  }
});

indexQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'reindex':
      await elasticsearchService.reindexData(data.type);
      break;
    case 'update-item':
      await elasticsearchService.updateItem(data);
      break;
    case 'delete-item':
      await elasticsearchService.deleteItem(data.itemId);
      break;
  }
});

// Health check
app.get('/health', async (req, res) => {
  const esHealth = await elasticsearchService.checkHealth();
  res.json({ 
    status: 'ok', 
    service: 'search',
    elasticsearch: esHealth,
  });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3021;

async function start() {
  try {
    await connectDB();
    await redisClient.connect();
    await elasticsearchService.initialize();
    
    app.listen(PORT, () => {
      logger.info(`Search service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();