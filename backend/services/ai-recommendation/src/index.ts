import express from 'express';
import { config, logger, connectDatabase, prisma, redis } from '@reskflow/shared';
import { RecommendationEngine } from './services/RecommendationEngine';
import { UserProfileService } from './services/UserProfileService';
import { CollaborativeFilteringService } from './services/CollaborativeFilteringService';
import { ContentBasedService } from './services/ContentBasedService';
import { HybridRecommendationService } from './services/HybridRecommendationService';
import { ModelTrainingService } from './services/ModelTrainingService';
import { authenticate } from '@reskflow/shared';
import Bull from 'bull';
import * as cron from 'node-cron';

const app = express();
app.use(express.json());

let recommendationEngine: RecommendationEngine;
let userProfileService: UserProfileService;
let collaborativeFiltering: CollaborativeFilteringService;
let contentBased: ContentBasedService;
let hybridRecommendation: HybridRecommendationService;
let modelTraining: ModelTrainingService;

// Initialize queues
const trainingQueue = new Bull('model-training', {
  redis: config.redis.url,
});

const profileUpdateQueue = new Bull('profile-updates', {
  redis: config.redis.url,
});

async function startService() {
  try {
    await connectDatabase();
    logger.info('AI Recommendation service: Database connected');

    // Initialize services
    userProfileService = new UserProfileService();
    collaborativeFiltering = new CollaborativeFilteringService();
    contentBased = new ContentBasedService();
    hybridRecommendation = new HybridRecommendationService(
      collaborativeFiltering,
      contentBased
    );
    recommendationEngine = new RecommendationEngine(
      userProfileService,
      hybridRecommendation
    );
    modelTraining = new ModelTrainingService(trainingQueue);

    // Load models
    await recommendationEngine.initialize();

    // Process queues
    trainingQueue.process(async (job) => {
      return modelTraining.processTrainingJob(job.data);
    });

    profileUpdateQueue.process(async (job) => {
      return userProfileService.updateUserProfile(job.data.userId);
    });

    // Schedule model retraining
    cron.schedule('0 2 * * *', async () => {
      logger.info('Starting scheduled model retraining');
      await modelTraining.scheduleFullRetrain();
    });

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'ai-recommendation' });
    });

    // Get personalized recommendations
    app.get('/recommendations/:userId', authenticate, async (req, res) => {
      try {
        const { userId } = req.params;
        const {
          latitude,
          longitude,
          limit = 20,
          offset = 0,
          context,
        } = req.query;

        const recommendations = await recommendationEngine.getRecommendations({
          userId,
          location: latitude && longitude ? {
            latitude: parseFloat(latitude as string),
            longitude: parseFloat(longitude as string),
          } : undefined,
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          context: context as string,
        });

        res.json(recommendations);
      } catch (error) {
        logger.error('Failed to get recommendations', error);
        res.status(500).json({ error: 'Failed to get recommendations' });
      }
    });

    // Get similar items
    app.get('/items/:itemId/similar', async (req, res) => {
      try {
        const { itemId } = req.params;
        const { limit = 10 } = req.query;

        const similarItems = await contentBased.getSimilarItems(
          itemId,
          parseInt(limit as string)
        );

        res.json(similarItems);
      } catch (error) {
        logger.error('Failed to get similar items', error);
        res.status(500).json({ error: 'Failed to get similar items' });
      }
    });

    // Get trending items
    app.get('/trending', async (req, res) => {
      try {
        const {
          latitude,
          longitude,
          timeRange = 'day',
          limit = 20,
        } = req.query;

        const trending = await recommendationEngine.getTrendingItems({
          location: latitude && longitude ? {
            latitude: parseFloat(latitude as string),
            longitude: parseFloat(longitude as string),
          } : undefined,
          timeRange: timeRange as string,
          limit: parseInt(limit as string),
        });

        res.json(trending);
      } catch (error) {
        logger.error('Failed to get trending items', error);
        res.status(500).json({ error: 'Failed to get trending items' });
      }
    });

    // Get personalized categories
    app.get('/categories/:userId/personalized', authenticate, async (req, res) => {
      try {
        const { userId } = req.params;

        const categories = await recommendationEngine.getPersonalizedCategories(userId);
        res.json(categories);
      } catch (error) {
        logger.error('Failed to get personalized categories', error);
        res.status(500).json({ error: 'Failed to get personalized categories' });
      }
    });

    // Update user interaction
    app.post('/interactions', authenticate, async (req, res) => {
      try {
        const { userId, itemId, interactionType, context } = req.body;

        await userProfileService.recordInteraction({
          userId,
          itemId,
          interactionType,
          context,
          timestamp: new Date(),
        });

        // Queue profile update
        await profileUpdateQueue.add('update-profile', { userId });

        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to record interaction', error);
        res.status(500).json({ error: 'Failed to record interaction' });
      }
    });

    // Get recommendation explanation
    app.get('/recommendations/:userId/explain/:itemId', authenticate, async (req, res) => {
      try {
        const { userId, itemId } = req.params;

        const explanation = await recommendationEngine.explainRecommendation(
          userId,
          itemId
        );

        res.json(explanation);
      } catch (error) {
        logger.error('Failed to get recommendation explanation', error);
        res.status(500).json({ error: 'Failed to get explanation' });
      }
    });

    // Admin endpoints
    app.post('/admin/retrain', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const { modelType } = req.body;
        await modelTraining.triggerRetrain(modelType);

        res.json({ success: true, message: 'Retraining scheduled' });
      } catch (error) {
        logger.error('Failed to trigger retraining', error);
        res.status(500).json({ error: 'Failed to trigger retraining' });
      }
    });

    app.get('/admin/metrics', authenticate, async (req, res) => {
      try {
        if (req.user!.role !== 'ADMIN') {
          return res.status(403).json({ error: 'Forbidden' });
        }

        const metrics = await recommendationEngine.getMetrics();
        res.json(metrics);
      } catch (error) {
        logger.error('Failed to get metrics', error);
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });

    // A/B testing endpoints
    app.post('/experiments/:experimentId/assign', authenticate, async (req, res) => {
      try {
        const { experimentId } = req.params;
        const { userId } = req.body;

        const variant = await recommendationEngine.assignToExperiment(
          userId,
          experimentId
        );

        res.json({ variant });
      } catch (error) {
        logger.error('Failed to assign to experiment', error);
        res.status(500).json({ error: 'Failed to assign to experiment' });
      }
    });

    app.post('/experiments/:experimentId/track', authenticate, async (req, res) => {
      try {
        const { experimentId } = req.params;
        const { userId, event, value } = req.body;

        await recommendationEngine.trackExperimentEvent(
          experimentId,
          userId,
          event,
          value
        );

        res.json({ success: true });
      } catch (error) {
        logger.error('Failed to track experiment event', error);
        res.status(500).json({ error: 'Failed to track event' });
      }
    });

    const PORT = 3013;
    app.listen(PORT, () => {
      logger.info(`🤖 AI Recommendation service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start AI recommendation service', error);
    process.exit(1);
  }
}

startService();