import * as tf from '@tensorflow/tfjs-node';
import { prisma, logger } from '@reskflow/shared';

interface PredictionInput {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  packageDetails: {
    weight: number;
    dimensions: { length: number; width: number; height: number };
    fragile: boolean;
  };
  timeOfDay: Date;
  traffic: 'low' | 'medium' | 'high';
  weather?: {
    condition: string;
    temperature: number;
    precipitation: number;
  };
}

interface PredictionOutput {
  estimatedDuration: number; // in minutes
  confidence: number;
  factors: {
    distance: number;
    traffic: number;
    weather: number;
    timeOfDay: number;
  };
  alternativeRoutes?: Array<{
    duration: number;
    distance: number;
    trafficLevel: string;
  }>;
}

export class DeliveryPredictor {
  private model: tf.LayersModel | null = null;
  private featureScaler: any = null;

  constructor() {
    this.loadModel();
  }

  private async loadModel() {
    try {
      // Load pre-trained model
      this.model = await tf.loadLayersModel('file://./models/reskflow_predictor/model.json');
      
      // Load feature scaler parameters
      const scalerData = await import('./models/reskflow_predictor/scaler.json');
      this.featureScaler = scalerData;
      
      logger.info('Delivery prediction model loaded successfully');
    } catch (error) {
      logger.warn('Failed to load pre-trained model, will train new one', error);
      await this.trainModel();
    }
  }

  async predictDeliveryTime(input: PredictionInput): Promise<PredictionOutput> {
    try {
      // Extract features
      const features = this.extractFeatures(input);
      
      // Make prediction using neural network
      const prediction = await this.makePrediction(features);
      
      // Calculate factor contributions
      const factors = this.calculateFactors(input, features);
      
      // Get alternative routes
      const alternativeRoutes = await this.getAlternativeRoutes(input);
      
      return {
        estimatedDuration: prediction.duration,
        confidence: prediction.confidence,
        factors,
        alternativeRoutes,
      };
    } catch (error) {
      logger.error('Delivery prediction failed', error);
      
      // Fallback to rule-based estimation
      return this.fallbackEstimation(input);
    }
  }

  private extractFeatures(input: PredictionInput): number[] {
    // Calculate distance
    const distance = this.calculateDistance(input.origin, input.destination);
    
    // Time features
    const hour = input.timeOfDay.getHours();
    const dayOfWeek = input.timeOfDay.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0;
    const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 1 : 0;
    
    // Package features
    const volume = input.packageDetails.dimensions.length * 
                   input.packageDetails.dimensions.width * 
                   input.packageDetails.dimensions.height;
    const weight = input.packageDetails.weight;
    const fragile = input.packageDetails.fragile ? 1 : 0;
    
    // Traffic encoding
    const trafficLevels = { low: 0, medium: 0.5, high: 1 };
    const trafficValue = trafficLevels[input.traffic];
    
    // Weather features (if available)
    const weatherImpact = this.calculateWeatherImpact(input.weather);
    
    return [
      distance,
      hour / 24, // Normalize
      dayOfWeek / 7,
      isWeekend,
      isRushHour,
      Math.log1p(volume), // Log transform for volume
      Math.log1p(weight), // Log transform for weight
      fragile,
      trafficValue,
      weatherImpact,
    ];
  }

  private async makePrediction(features: number[]): Promise<{
    duration: number;
    confidence: number;
  }> {
    if (!this.model) {
      throw new Error('Model not loaded');
    }

    // Normalize features
    const normalizedFeatures = this.normalizeFeatures(features);
    
    // Create tensor
    const inputTensor = tf.tensor2d([normalizedFeatures]);
    
    // Make prediction
    const prediction = this.model.predict(inputTensor) as tf.Tensor;
    const result = await prediction.data();
    
    // Clean up tensors
    inputTensor.dispose();
    prediction.dispose();
    
    // The model outputs [duration, confidence]
    return {
      duration: result[0] * 120, // Denormalize (max 120 minutes)
      confidence: result[1],
    };
  }

  private normalizeFeatures(features: number[]): number[] {
    if (!this.featureScaler) {
      // Simple normalization if scaler not available
      return features.map((f, i) => {
        if (i === 0) return f / 50; // Distance (max 50km)
        return f;
      });
    }

    // Apply saved scaler parameters
    return features.map((value, index) => {
      const mean = this.featureScaler.mean[index];
      const std = this.featureScaler.std[index];
      return (value - mean) / std;
    });
  }

  private calculateDistance(origin: any, destination: any): number {
    const R = 6371; // Earth's radius in km
    const dLat = (destination.latitude - origin.latitude) * Math.PI / 180;
    const dLon = (destination.longitude - origin.longitude) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(origin.latitude * Math.PI / 180) * 
      Math.cos(destination.latitude * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private calculateWeatherImpact(weather?: any): number {
    if (!weather) return 0;

    let impact = 0;
    
    // Rain/snow impact
    if (weather.precipitation > 0) {
      impact += Math.min(weather.precipitation / 10, 0.5);
    }
    
    // Extreme temperature impact
    if (weather.temperature < -10 || weather.temperature > 35) {
      impact += 0.2;
    }
    
    // Severe weather conditions
    const severeConditions = ['storm', 'blizzard', 'hurricane'];
    if (severeConditions.includes(weather.condition.toLowerCase())) {
      impact += 0.5;
    }
    
    return Math.min(impact, 1); // Cap at 1
  }

  private calculateFactors(input: PredictionInput, features: number[]): any {
    const baseTime = features[0] * 2; // 2 min/km base
    
    return {
      distance: features[0],
      traffic: features[8] * 30, // Traffic can add up to 30 min
      weather: features[9] * 20, // Weather can add up to 20 min
      timeOfDay: features[4] * 15, // Rush hour can add up to 15 min
    };
  }

  private async getAlternativeRoutes(input: PredictionInput): Promise<any[]> {
    // Simulate alternative routes with different traffic conditions
    const alternatives = [];
    
    for (const trafficLevel of ['low', 'medium', 'high'] as const) {
      if (trafficLevel !== input.traffic) {
        const altInput = { ...input, traffic: trafficLevel };
        const altFeatures = this.extractFeatures(altInput);
        const altPrediction = await this.makePrediction(altFeatures);
        
        alternatives.push({
          duration: altPrediction.duration,
          distance: altFeatures[0],
          trafficLevel,
        });
      }
    }
    
    return alternatives.sort((a, b) => a.duration - b.duration);
  }

  private fallbackEstimation(input: PredictionInput): PredictionOutput {
    const distance = this.calculateDistance(input.origin, input.destination);
    let duration = distance * 2; // Base: 2 min/km
    
    // Traffic adjustments
    const trafficMultipliers = { low: 1, medium: 1.3, high: 1.6 };
    duration *= trafficMultipliers[input.traffic];
    
    // Time of day adjustments
    const hour = input.timeOfDay.getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      duration *= 1.2; // Rush hour
    }
    
    return {
      estimatedDuration: Math.round(duration),
      confidence: 0.6, // Lower confidence for fallback
      factors: {
        distance,
        traffic: duration * (trafficMultipliers[input.traffic] - 1),
        weather: 0,
        timeOfDay: hour,
      },
    };
  }

  private async trainModel() {
    try {
      // Fetch historical reskflow data
      const trainingData = await this.fetchTrainingData();
      
      if (trainingData.length < 1000) {
        logger.warn('Insufficient training data, using rule-based predictions');
        return;
      }

      // Prepare features and labels
      const { features, labels } = this.prepareTrainingData(trainingData);
      
      // Create model architecture
      this.model = tf.sequential({
        layers: [
          tf.layers.dense({
            units: 64,
            activation: 'relu',
            inputShape: [features[0].length],
          }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({
            units: 32,
            activation: 'relu',
          }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({
            units: 16,
            activation: 'relu',
          }),
          tf.layers.dense({
            units: 2, // [duration, confidence]
            activation: 'sigmoid',
          }),
        ],
      });

      // Compile model
      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'meanSquaredError',
        metrics: ['mae'],
      });

      // Convert to tensors
      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(labels);

      // Train model
      await this.model.fit(xs, ys, {
        epochs: 100,
        batchSize: 32,
        validationSplit: 0.2,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            if (epoch % 10 === 0) {
              logger.info(`Training epoch ${epoch}: loss = ${logs?.loss}`);
            }
          },
        },
      });

      // Save model
      await this.model.save('file://./models/reskflow_predictor');
      
      // Clean up tensors
      xs.dispose();
      ys.dispose();

      logger.info('Delivery prediction model trained successfully');
    } catch (error) {
      logger.error('Model training failed', error);
    }
  }

  private async fetchTrainingData(): Promise<any[]> {
    return prisma.reskflow.findMany({
      where: {
        status: 'DELIVERED',
        actualDelivery: { not: null },
        actualPickup: { not: null },
      },
      include: {
        pickupAddress: true,
        reskflowAddress: true,
        trackingEvents: true,
      },
      take: 10000,
      orderBy: { createdAt: 'desc' },
    });
  }

  private prepareTrainingData(data: any[]): {
    features: number[][];
    labels: number[][];
  } {
    const features: number[][] = [];
    const labels: number[][] = [];

    data.forEach(reskflow => {
      if (!reskflow.actualPickup || !reskflow.actualDelivery) return;

      const actualDuration = 
        (reskflow.actualDelivery.getTime() - reskflow.actualPickup.getTime()) / 
        (1000 * 60); // Convert to minutes

      // Extract features similar to prediction
      const distance = this.calculateDistance(
        reskflow.pickupAddress,
        reskflow.reskflowAddress
      );

      const hour = reskflow.actualPickup.getHours();
      const dayOfWeek = reskflow.actualPickup.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6 ? 1 : 0;
      const isRushHour = (hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19) ? 1 : 0;

      features.push([
        distance,
        hour / 24,
        dayOfWeek / 7,
        isWeekend,
        isRushHour,
        Math.log1p(reskflow.weight || 1),
        0, // Volume (not stored in current schema)
        0, // Fragile (not stored in current schema)
        0.5, // Default traffic
        0, // Default weather impact
      ]);

      labels.push([
        actualDuration / 120, // Normalize to [0, 1]
        1, // High confidence for actual data
      ]);
    });

    return { features, labels };
  }
}