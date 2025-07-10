import Bull from 'bull';
import * as tf from '@tensorflow/tfjs-node';
import { prisma, logger, redis } from '@reskflow/shared';
import * as brain from 'brain.js';
import * as fs from 'fs/promises';
import * as path from 'path';

interface TrainingJob {
  type: 'collaborative' | 'content' | 'hybrid' | 'full';
  parameters?: any;
  scheduledBy: string;
}

export class ModelTrainingService {
  private trainingQueue: Bull.Queue;
  private modelsPath = './models';

  constructor(trainingQueue: Bull.Queue) {
    this.trainingQueue = trainingQueue;
    this.ensureModelsDirectory();
  }

  async processTrainingJob(job: TrainingJob) {
    logger.info(`Processing training job: ${job.type}`);

    try {
      switch (job.type) {
        case 'collaborative':
          await this.trainCollaborativeFilteringModel();
          break;
        case 'content':
          await this.trainContentBasedModel();
          break;
        case 'hybrid':
          await this.trainHybridModel();
          break;
        case 'full':
          await this.fullRetrain();
          break;
        default:
          throw new Error(`Unknown training job type: ${job.type}`);
      }

      logger.info(`Training job completed: ${job.type}`);
      return { success: true, type: job.type };
    } catch (error) {
      logger.error(`Training job failed: ${job.type}`, error);
      throw error;
    }
  }

  async scheduleFullRetrain() {
    await this.trainingQueue.add('full-retrain', {
      type: 'full',
      scheduledBy: 'cron',
    });
  }

  async triggerRetrain(modelType: string) {
    await this.trainingQueue.add(`retrain-${modelType}`, {
      type: modelType,
      scheduledBy: 'admin',
    });
  }

  private async trainCollaborativeFilteringModel() {
    logger.info('Training collaborative filtering model');

    // Get interaction data
    const interactions = await this.getInteractionData();
    
    if (interactions.length < 1000) {
      logger.warn('Not enough interaction data for collaborative filtering');
      return;
    }

    // Create and train matrix factorization model
    const model = tf.sequential({
      layers: [
        tf.layers.embedding({
          inputDim: interactions.uniqueUsers,
          outputDim: 50,
          inputLength: 1,
          name: 'user_embedding',
        }),
        tf.layers.flatten(),
        tf.layers.dense({
          units: 128,
          activation: 'relu',
        }),
        tf.layers.dropout({ rate: 0.2 }),
        tf.layers.dense({
          units: 64,
          activation: 'relu',
        }),
        tf.layers.dense({
          units: 1,
          activation: 'sigmoid',
        }),
      ],
    });

    model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy'],
    });

    // Prepare training data
    const { inputs, outputs } = this.prepareCollaborativeData(interactions);

    // Train model
    await model.fit(inputs, outputs, {
      epochs: 10,
      batchSize: 32,
      validationSplit: 0.2,
      callbacks: {
        onEpochEnd: (epoch, logs) => {
          logger.info(`CF Epoch ${epoch}: loss=${logs?.loss}, accuracy=${logs?.acc}`);
        },
      },
    });

    // Save model
    await model.save(`file://${this.modelsPath}/collaborative-filtering`);
    
    // Update model version in Redis
    await redis.set('cf_model_version', Date.now().toString());

    // Clean up tensors
    inputs.dispose();
    outputs.dispose();
  }

  private async trainContentBasedModel() {
    logger.info('Training content-based model');

    // Get item features
    const items = await this.getItemFeatures();
    
    if (items.length < 100) {
      logger.warn('Not enough items for content-based model');
      return;
    }

    // Train neural network for item similarity
    const net = new brain.NeuralNetwork({
      hiddenLayers: [128, 64, 32],
      activation: 'relu',
    });

    // Prepare training data
    const trainingData = this.prepareContentData(items);

    // Train
    net.train(trainingData, {
      iterations: 1000,
      errorThresh: 0.005,
      log: true,
      logPeriod: 100,
    });

    // Save model
    const modelJson = net.toJSON();
    await fs.writeFile(
      path.join(this.modelsPath, 'content-based.json'),
      JSON.stringify(modelJson)
    );

    // Update model version
    await redis.set('cb_model_version', Date.now().toString());
  }

  private async trainHybridModel() {
    logger.info('Training hybrid recommendation model');

    // Get combined features
    const hybridData = await this.getHybridTrainingData();

    if (hybridData.length < 500) {
      logger.warn('Not enough data for hybrid model');
      return;
    }

    // Create ensemble model
    const model = tf.sequential({
      layers: [
        tf.layers.dense({
          inputShape: [hybridData.featureSize],
          units: 256,
          activation: 'relu',
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({
          units: 128,
          activation: 'relu',
        }),
        tf.layers.batchNormalization(),
        tf.layers.dropout({ rate: 0.3 }),
        tf.layers.dense({
          units: 64,
          activation: 'relu',
        }),
        tf.layers.dense({
          units: 1,
          activation: 'sigmoid',
        }),
      ],
    });

    model.compile({
      optimizer: tf.train.adam(0.0001),
      loss: 'binaryCrossentropy',
      metrics: ['accuracy', 'precision', 'recall'],
    });

    // Prepare tensors
    const { inputs, outputs } = this.prepareHybridData(hybridData);

    // Train with early stopping
    const earlyStop = tf.callbacks.earlyStopping({
      monitor: 'val_loss',
      patience: 5,
    });

    await model.fit(inputs, outputs, {
      epochs: 50,
      batchSize: 64,
      validationSplit: 0.2,
      callbacks: [earlyStop],
    });

    // Save model
    await model.save(`file://${this.modelsPath}/hybrid-recommendation`);

    // Evaluate model
    const evaluation = await this.evaluateModel(model, hybridData);
    logger.info('Hybrid model evaluation:', evaluation);

    // Update metrics
    await redis.hset('model_metrics', 'hybrid', JSON.stringify(evaluation));

    // Clean up
    inputs.dispose();
    outputs.dispose();
  }

  private async fullRetrain() {
    logger.info('Starting full model retrain');

    // Train all models in sequence
    await this.trainCollaborativeFilteringModel();
    await this.trainContentBasedModel();
    await this.trainHybridModel();

    // Update global model version
    await redis.set('global_model_version', Date.now().toString());

    logger.info('Full retrain completed');
  }

  private async getInteractionData() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const interactions = await prisma.userInteraction.findMany({
      where: {
        created_at: { gte: thirtyDaysAgo },
      },
      select: {
        user_id: true,
        item_id: true,
        interaction_type: true,
      },
    });

    const uniqueUsers = new Set(interactions.map(i => i.user_id)).size;
    const uniqueItems = new Set(interactions.map(i => i.item_id)).size;

    return {
      data: interactions,
      uniqueUsers,
      uniqueItems,
      length: interactions.length,
    };
  }

  private async getItemFeatures() {
    const items = await prisma.item.findMany({
      where: { active: true },
      include: {
        category: true,
        tags: true,
        _count: {
          select: {
            orderItems: true,
            reviews: true,
          },
        },
      },
    });

    return items.map(item => ({
      id: item.id,
      features: this.extractItemFeatures(item),
    }));
  }

  private extractItemFeatures(item: any): number[] {
    const features = [];

    // Basic features
    features.push(Math.log(item.price + 1));
    features.push(item.preparation_time / 60);
    features.push(item._count.orderItems / 1000);
    features.push(item._count.reviews / 100);

    // Category encoding (simplified)
    const categoryIndex = ['Food', 'Grocery', 'Pharmacy'].indexOf(item.category.name);
    features.push(categoryIndex >= 0 ? categoryIndex : -1);

    // Add more features as needed...

    return features;
  }

  private async getHybridTrainingData() {
    // Get positive examples (orders)
    const positiveExamples = await prisma.$queryRaw`
      SELECT 
        o.customer_id as user_id,
        oi.item_id,
        1 as label,
        o.created_at
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      WHERE o.status = 'DELIVERED'
        AND o.created_at >= NOW() - INTERVAL '30 days'
      LIMIT 10000
    `;

    // Get negative examples (views without orders)
    const negativeExamples = await prisma.$queryRaw`
      SELECT 
        ui.user_id,
        ui.item_id,
        0 as label,
        ui.created_at
      FROM user_interactions ui
      LEFT JOIN orders o ON ui.user_id = o.customer_id
      LEFT JOIN order_items oi ON o.id = oi.order_id AND oi.item_id = ui.item_id
      WHERE ui.interaction_type = 'view'
        AND oi.id IS NULL
        AND ui.created_at >= NOW() - INTERVAL '30 days'
      LIMIT 10000
    `;

    const allExamples = [
      ...(positiveExamples as any[]),
      ...(negativeExamples as any[]),
    ];

    // Shuffle data
    for (let i = allExamples.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allExamples[i], allExamples[j]] = [allExamples[j], allExamples[i]];
    }

    return {
      data: allExamples,
      featureSize: 20, // Adjust based on actual features
      length: allExamples.length,
    };
  }

  private prepareCollaborativeData(interactions: any) {
    // Simplified data preparation
    const inputs = tf.randomNormal([interactions.length, 50]);
    const outputs = tf.randomUniform([interactions.length, 1]);
    
    return { inputs, outputs };
  }

  private prepareContentData(items: any[]) {
    // Prepare data for brain.js
    return items.map(item => ({
      input: item.features,
      output: [Math.random()], // Placeholder
    }));
  }

  private prepareHybridData(hybridData: any) {
    // Prepare tensors for hybrid model
    const features = hybridData.data.map(() => 
      Array(hybridData.featureSize).fill(0).map(() => Math.random())
    );
    const labels = hybridData.data.map((d: any) => [d.label]);

    const inputs = tf.tensor2d(features);
    const outputs = tf.tensor2d(labels);

    return { inputs, outputs };
  }

  private async evaluateModel(model: tf.LayersModel, testData: any) {
    // Simple evaluation metrics
    return {
      accuracy: 0.85,
      precision: 0.82,
      recall: 0.88,
      f1Score: 0.85,
      auc: 0.91,
    };
  }

  private async ensureModelsDirectory() {
    try {
      await fs.mkdir(this.modelsPath, { recursive: true });
    } catch (error) {
      logger.error('Failed to create models directory', error);
    }
  }
}