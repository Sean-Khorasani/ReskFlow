import express from 'express';
import { config, logger, connectDatabase, prisma } from '@reskflow/shared';
import { SearchService } from './services/SearchService';
import { GeolocationService } from './services/GeolocationService';
import { RecommendationService } from './services/RecommendationService';
import { FilterService } from './services/FilterService';

const app = express();
app.use(express.json());

let searchService: SearchService;
let geolocationService: GeolocationService;
let recommendationService: RecommendationService;
let filterService: FilterService;

async function startService() {
  try {
    await connectDatabase();
    logger.info('Discovery service: Database connected');

    // Initialize services
    searchService = new SearchService();
    geolocationService = new GeolocationService();
    recommendationService = new RecommendationService();
    filterService = new FilterService();

    // Initialize search index
    await searchService.initializeIndex();

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'discovery' });
    });

    // Search endpoints
    app.post('/search', async (req, res) => {
      try {
        const {
          query,
          location,
          radius = 5,
          filters = {},
          page = 1,
          limit = 20,
          sortBy = 'relevance',
        } = req.body;

        const results = await searchService.searchMerchants({
          query,
          location,
          radius,
          filters,
          page,
          limit,
          sortBy,
        });

        res.json(results);
      } catch (error) {
        logger.error('Search failed', error);
        res.status(500).json({ error: 'Search failed' });
      }
    });

    // Autocomplete/suggestions
    app.get('/autocomplete', async (req, res) => {
      try {
        const { q, lat, lng, limit = 10 } = req.query;

        const suggestions = await searchService.getAutocompleteSuggestions(
          q as string,
          lat ? parseFloat(lat as string) : undefined,
          lng ? parseFloat(lng as string) : undefined,
          parseInt(limit as string)
        );

        res.json(suggestions);
      } catch (error) {
        logger.error('Autocomplete failed', error);
        res.status(500).json({ error: 'Autocomplete failed' });
      }
    });

    // Browse by category
    app.get('/categories', async (req, res) => {
      try {
        const { lat, lng } = req.query;

        const categories = await filterService.getCategories(
          lat ? parseFloat(lat as string) : undefined,
          lng ? parseFloat(lng as string) : undefined
        );

        res.json(categories);
      } catch (error) {
        logger.error('Failed to get categories', error);
        res.status(500).json({ error: 'Failed to get categories' });
      }
    });

    // Nearby merchants
    app.post('/nearby', async (req, res) => {
      try {
        const { latitude, longitude, radius = 5, limit = 20 } = req.body;

        const merchants = await geolocationService.getNearbyMerchants(
          latitude,
          longitude,
          radius,
          limit
        );

        res.json(merchants);
      } catch (error) {
        logger.error('Failed to get nearby merchants', error);
        res.status(500).json({ error: 'Failed to get nearby merchants' });
      }
    });

    // Get merchant details
    app.get('/merchants/:merchantId', async (req, res) => {
      try {
        const { merchantId } = req.params;
        const { lat, lng } = req.query;

        const merchant = await searchService.getMerchantDetails(
          merchantId,
          lat ? parseFloat(lat as string) : undefined,
          lng ? parseFloat(lng as string) : undefined
        );

        if (!merchant) {
          return res.status(404).json({ error: 'Merchant not found' });
        }

        res.json(merchant);
      } catch (error) {
        logger.error('Failed to get merchant details', error);
        res.status(500).json({ error: 'Failed to get merchant details' });
      }
    });

    // Personalized recommendations
    app.get('/recommendations/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        const { lat, lng, limit = 10 } = req.query;

        const recommendations = await recommendationService.getPersonalizedRecommendations(
          userId,
          lat ? parseFloat(lat as string) : undefined,
          lng ? parseFloat(lng as string) : undefined,
          parseInt(limit as string)
        );

        res.json(recommendations);
      } catch (error) {
        logger.error('Failed to get recommendations', error);
        res.status(500).json({ error: 'Failed to get recommendations' });
      }
    });

    // Popular merchants
    app.get('/popular', async (req, res) => {
      try {
        const { lat, lng, timeRange = 'week', limit = 20 } = req.query;

        const popular = await recommendationService.getPopularMerchants(
          lat ? parseFloat(lat as string) : undefined,
          lng ? parseFloat(lng as string) : undefined,
          timeRange as string,
          parseInt(limit as string)
        );

        res.json(popular);
      } catch (error) {
        logger.error('Failed to get popular merchants', error);
        res.status(500).json({ error: 'Failed to get popular merchants' });
      }
    });

    // New merchants
    app.get('/new', async (req, res) => {
      try {
        const { lat, lng, days = 30, limit = 20 } = req.query;

        const newMerchants = await recommendationService.getNewMerchants(
          lat ? parseFloat(lat as string) : undefined,
          lng ? parseFloat(lng as string) : undefined,
          parseInt(days as string),
          parseInt(limit as string)
        );

        res.json(newMerchants);
      } catch (error) {
        logger.error('Failed to get new merchants', error);
        res.status(500).json({ error: 'Failed to get new merchants' });
      }
    });

    // Filter options
    app.get('/filters', async (req, res) => {
      try {
        const filters = await filterService.getAvailableFilters();
        res.json(filters);
      } catch (error) {
        logger.error('Failed to get filters', error);
        res.status(500).json({ error: 'Failed to get filters' });
      }
    });

    // Dietary preferences search
    app.post('/dietary', async (req, res) => {
      try {
        const {
          preferences,
          location,
          radius = 5,
          limit = 20,
        } = req.body;

        const results = await filterService.searchByDietaryPreferences(
          preferences,
          location,
          radius,
          limit
        );

        res.json(results);
      } catch (error) {
        logger.error('Dietary search failed', error);
        res.status(500).json({ error: 'Dietary search failed' });
      }
    });

    // Geocoding
    app.post('/geocode', async (req, res) => {
      try {
        const { address } = req.body;

        const location = await geolocationService.geocodeAddress(address);
        
        if (!location) {
          return res.status(404).json({ error: 'Address not found' });
        }

        res.json(location);
      } catch (error) {
        logger.error('Geocoding failed', error);
        res.status(500).json({ error: 'Geocoding failed' });
      }
    });

    // Reverse geocoding
    app.post('/reverse-geocode', async (req, res) => {
      try {
        const { latitude, longitude } = req.body;

        const address = await geolocationService.reverseGeocode(latitude, longitude);
        
        res.json(address);
      } catch (error) {
        logger.error('Reverse geocoding failed', error);
        res.status(500).json({ error: 'Reverse geocoding failed' });
      }
    });

    // Delivery zones
    app.post('/check-reskflow-zone', async (req, res) => {
      try {
        const { merchantId, latitude, longitude } = req.body;

        const inZone = await geolocationService.checkDeliveryZone(
          merchantId,
          latitude,
          longitude
        );

        res.json({ inDeliveryZone: inZone });
      } catch (error) {
        logger.error('Delivery zone check failed', error);
        res.status(500).json({ error: 'Delivery zone check failed' });
      }
    });

    const PORT = 3009;
    app.listen(PORT, () => {
      logger.info(`🔍 Discovery service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start discovery service', error);
    process.exit(1);
  }
}

startService();