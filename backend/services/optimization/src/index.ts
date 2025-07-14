import express from 'express';
import { config, logger, connectDatabase } from '@reskflow/shared';
import { RouteOptimizer } from './services/RouteOptimizer';
import { DeliveryPredictor } from './services/DeliveryPredictor';
import { DemandForecaster } from './services/DemandForecaster';
import { ClusteringService } from './services/ClusteringService';
import { setupOptimizationQueue } from './queues/optimizationQueue';
import { trainModels } from './training/modelTraining';

const app = express();
app.use(express.json());

let routeOptimizer: RouteOptimizer;
let reskflowPredictor: DeliveryPredictor;
let demandForecaster: DemandForecaster;
let clusteringService: ClusteringService;

async function startService() {
  try {
    // Connect to database
    await connectDatabase();
    logger.info('Optimization service: Database connected');

    // Initialize services
    routeOptimizer = new RouteOptimizer();
    reskflowPredictor = new DeliveryPredictor();
    demandForecaster = new DemandForecaster();
    clusteringService = new ClusteringService();

    // Load or train models
    await trainModels();

    // Setup queue processing
    setupOptimizationQueue();

    // API endpoints
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', service: 'optimization' });
    });

    // Route optimization endpoint
    app.post('/optimize-route', async (req, res) => {
      try {
        const { driverId, reskflowIds, startLocation, constraints } = req.body;
        
        const result = await routeOptimizer.optimizeRoute({
          driverId,
          reskflowIds,
          startLocation,
          constraints,
        });

        res.json(result);
      } catch (error) {
        logger.error('Route optimization failed', error);
        res.status(500).json({ error: 'Optimization failed' });
      }
    });

    // Delivery time prediction
    app.post('/predict-reskflow-time', async (req, res) => {
      try {
        const { origin, destination, packageDetails, timeOfDay, traffic } = req.body;
        
        const prediction = await reskflowPredictor.predictDeliveryTime({
          origin,
          destination,
          packageDetails,
          timeOfDay,
          traffic,
        });

        res.json(prediction);
      } catch (error) {
        logger.error('Delivery prediction failed', error);
        res.status(500).json({ error: 'Prediction failed' });
      }
    });

    // Demand forecasting
    app.post('/forecast-demand', async (req, res) => {
      try {
        const { region, timeframe, historicalData } = req.body;
        
        const forecast = await demandForecaster.forecastDemand({
          region,
          timeframe,
          historicalData,
        });

        res.json(forecast);
      } catch (error) {
        logger.error('Demand forecast failed', error);
        res.status(500).json({ error: 'Forecast failed' });
      }
    });

    // Delivery clustering
    app.post('/cluster-deliveries', async (req, res) => {
      try {
        const { deliveries, numClusters } = req.body;
        
        const clusters = await clusteringService.clusterDeliveries(
          deliveries,
          numClusters
        );

        res.json(clusters);
      } catch (error) {
        logger.error('Clustering failed', error);
        res.status(500).json({ error: 'Clustering failed' });
      }
    });

    // Start server
    const PORT = 3002;
    app.listen(PORT, () => {
      logger.info(`🤖 Optimization service ready at http://localhost:${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to start optimization service', error);
    process.exit(1);
  }
}

startService();