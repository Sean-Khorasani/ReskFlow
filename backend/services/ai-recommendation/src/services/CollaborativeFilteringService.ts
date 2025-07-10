import { prisma, redis, logger } from '@reskflow/shared';
import * as tf from '@tensorflow/tfjs-node';
import { CF } from 'collaborative-filter';

interface UserItemMatrix {
  users: string[];
  items: string[];
  ratings: number[][];
}

export class CollaborativeFilteringService {
  private userItemMatrix: UserItemMatrix | null = null;
  private model: tf.LayersModel | null = null;
  private lastUpdate: Date | null = null;

  async initialize() {
    await this.buildUserItemMatrix();
    await this.trainModel();
  }

  async getRecommendations(
    userId: string,
    excludeItems: string[] = [],
    limit: number = 20
  ): Promise<Array<{ itemId: string; score: number }>> {
    // Check if matrix needs update
    if (this.shouldUpdateMatrix()) {
      await this.buildUserItemMatrix();
    }

    if (!this.userItemMatrix) {
      logger.warn('User-item matrix not available, returning empty recommendations');
      return [];
    }

    const userIndex = this.userItemMatrix.users.indexOf(userId);
    if (userIndex === -1) {
      // New user, use popularity-based recommendations
      return this.getPopularityBasedRecommendations(excludeItems, limit);
    }

    try {
      // Use collaborative filtering library for recommendations
      const recommendations = CF.recommendItems(
        this.userItemMatrix.ratings,
        userIndex,
        limit * 2 // Get extra to filter
      );

      // Convert to item IDs and filter
      const itemRecommendations = recommendations
        .map((rec: any) => ({
          itemId: this.userItemMatrix!.items[rec.itemIndex],
          score: rec.score,
        }))
        .filter(rec => !excludeItems.includes(rec.itemId))
        .slice(0, limit);

      return itemRecommendations;
    } catch (error) {
      logger.error('Collaborative filtering failed', error);
      return this.getPopularityBasedRecommendations(excludeItems, limit);
    }
  }

  async getSimilarItems(
    itemId: string,
    limit: number = 10
  ): Promise<Array<{ itemId: string; similarity: number }>> {
    if (!this.userItemMatrix) {
      await this.buildUserItemMatrix();
    }

    const itemIndex = this.userItemMatrix!.items.indexOf(itemId);
    if (itemIndex === -1) {
      return [];
    }

    try {
      // Calculate item-item similarity using cosine similarity
      const itemVector = this.getItemVector(itemIndex);
      const similarities: Array<{ itemId: string; similarity: number }> = [];

      for (let i = 0; i < this.userItemMatrix!.items.length; i++) {
        if (i === itemIndex) continue;

        const otherVector = this.getItemVector(i);
        const similarity = this.cosineSimilarity(itemVector, otherVector);

        if (similarity > 0.1) { // Threshold for relevance
          similarities.push({
            itemId: this.userItemMatrix!.items[i],
            similarity,
          });
        }
      }

      // Sort by similarity and return top items
      return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);
    } catch (error) {
      logger.error('Item similarity calculation failed', error);
      return [];
    }
  }

  async getUserSimilarity(userId1: string, userId2: string): Promise<number> {
    if (!this.userItemMatrix) {
      await this.buildUserItemMatrix();
    }

    const user1Index = this.userItemMatrix!.users.indexOf(userId1);
    const user2Index = this.userItemMatrix!.users.indexOf(userId2);

    if (user1Index === -1 || user2Index === -1) {
      return 0;
    }

    const user1Vector = this.userItemMatrix!.ratings[user1Index];
    const user2Vector = this.userItemMatrix!.ratings[user2Index];

    return this.cosineSimilarity(user1Vector, user2Vector);
  }

  async predictRating(userId: string, itemId: string): Promise<number> {
    if (!this.model) {
      await this.trainModel();
    }

    if (!this.userItemMatrix) {
      return 0;
    }

    const userIndex = this.userItemMatrix.users.indexOf(userId);
    const itemIndex = this.userItemMatrix.items.indexOf(itemId);

    if (userIndex === -1 || itemIndex === -1) {
      return 0;
    }

    try {
      // Use the trained model to predict rating
      const userFeatures = await this.getUserFeatures(userId);
      const itemFeatures = await this.getItemFeatures(itemId);

      const input = tf.concat([
        tf.tensor2d([userFeatures]),
        tf.tensor2d([itemFeatures])
      ], 1);

      const prediction = this.model!.predict(input) as tf.Tensor;
      const rating = await prediction.data();

      input.dispose();
      prediction.dispose();

      return rating[0];
    } catch (error) {
      logger.error('Rating prediction failed', error);
      return 0;
    }
  }

  private async buildUserItemMatrix() {
    logger.info('Building user-item matrix for collaborative filtering');

    // Get all ratings/interactions from the last 90 days
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const interactions = await prisma.$queryRaw`
      SELECT DISTINCT
        o.customer_id as user_id,
        oi.item_id,
        CASE 
          WHEN r.rating IS NOT NULL THEN r.rating
          WHEN o.status = 'DELIVERED' THEN 4.0
          ELSE 3.0
        END as rating,
        COUNT(*) as order_count
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN reviews r ON r.order_id = o.id AND r.item_id = oi.item_id
      WHERE o.created_at >= ${ninetyDaysAgo}
        AND o.status IN ('DELIVERED', 'COMPLETED')
      GROUP BY o.customer_id, oi.item_id, r.rating, o.status
    `;

    // Build unique user and item lists
    const users = new Set<string>();
    const items = new Set<string>();
    const ratingMap = new Map<string, number>();

    (interactions as any[]).forEach(interaction => {
      users.add(interaction.user_id);
      items.add(interaction.item_id);
      
      // Weighted rating based on order count
      const weight = Math.min(interaction.order_count, 5); // Cap at 5
      const adjustedRating = interaction.rating * (1 + weight * 0.1);
      
      const key = `${interaction.user_id}:${interaction.item_id}`;
      ratingMap.set(key, Math.min(adjustedRating, 5)); // Cap at 5
    });

    const userArray = Array.from(users);
    const itemArray = Array.from(items);

    // Build rating matrix
    const ratings: number[][] = [];
    for (const user of userArray) {
      const userRatings: number[] = [];
      for (const item of itemArray) {
        const key = `${user}:${item}`;
        userRatings.push(ratingMap.get(key) || 0);
      }
      ratings.push(userRatings);
    }

    this.userItemMatrix = {
      users: userArray,
      items: itemArray,
      ratings,
    };

    this.lastUpdate = new Date();

    // Cache the matrix
    await redis.setex(
      'cf_matrix',
      3600, // 1 hour
      JSON.stringify({
        users: userArray.slice(0, 100), // Sample for cache
        items: itemArray.slice(0, 100),
        updated: this.lastUpdate,
      })
    );

    logger.info(`Built user-item matrix: ${userArray.length} users, ${itemArray.length} items`);
  }

  private async trainModel() {
    if (!this.userItemMatrix || this.userItemMatrix.users.length < 10) {
      logger.info('Not enough data to train collaborative filtering model');
      return;
    }

    try {
      // Create a simple matrix factorization model
      const userEmbeddingSize = 50;
      const itemEmbeddingSize = 50;

      this.model = tf.sequential({
        layers: [
          tf.layers.dense({
            inputShape: [userEmbeddingSize + itemEmbeddingSize],
            units: 128,
            activation: 'relu',
          }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({
            units: 64,
            activation: 'relu',
          }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({
            units: 1,
            activation: 'sigmoid',
          }),
        ],
      });

      this.model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'meanSquaredError',
        metrics: ['mae'],
      });

      logger.info('Collaborative filtering model created');
    } catch (error) {
      logger.error('Failed to create collaborative filtering model', error);
    }
  }

  private async getPopularityBasedRecommendations(
    excludeItems: string[],
    limit: number
  ): Promise<Array<{ itemId: string; score: number }>> {
    const popularItems = await prisma.$queryRaw`
      SELECT 
        i.id as item_id,
        COUNT(DISTINCT oi.order_id) as order_count,
        AVG(r.rating) as avg_rating
      FROM items i
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN reviews r ON i.id = r.item_id
      WHERE o.created_at >= NOW() - INTERVAL '7 days'
        AND o.status = 'DELIVERED'
        ${excludeItems.length > 0 ? prisma.Prisma.sql`AND i.id NOT IN (${prisma.Prisma.join(excludeItems)})` : prisma.Prisma.empty}
      GROUP BY i.id
      ORDER BY order_count DESC, avg_rating DESC NULLS LAST
      LIMIT ${limit}
    `;

    return (popularItems as any[]).map((item, index) => ({
      itemId: item.item_id,
      score: 1 - index * 0.05, // Decreasing score by rank
    }));
  }

  private getItemVector(itemIndex: number): number[] {
    const vector: number[] = [];
    for (let i = 0; i < this.userItemMatrix!.users.length; i++) {
      vector.push(this.userItemMatrix!.ratings[i][itemIndex]);
    }
    return vector;
  }

  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  private shouldUpdateMatrix(): boolean {
    if (!this.lastUpdate) return true;
    
    const hoursSinceUpdate = (Date.now() - this.lastUpdate.getTime()) / (1000 * 60 * 60);
    return hoursSinceUpdate > 1; // Update every hour
  }

  private async getUserFeatures(userId: string): Promise<number[]> {
    // Get user features for the neural network
    const userOrders = await prisma.order.count({
      where: { customer_id: userId },
    });

    const avgOrderValue = await prisma.order.aggregate({
      where: { customer_id: userId },
      _avg: { total: true },
    });

    const categoryPreferences = await prisma.$queryRaw`
      SELECT c.id, COUNT(*) as count
      FROM categories c
      JOIN items i ON i.category_id = c.id
      JOIN order_items oi ON i.id = oi.item_id
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = ${userId}
      GROUP BY c.id
      ORDER BY count DESC
      LIMIT 10
    `;

    // Create feature vector (simplified)
    const features = new Array(50).fill(0);
    features[0] = userOrders / 100; // Normalized
    features[1] = (avgOrderValue._avg.total || 0) / 100; // Normalized

    // Add category preferences
    (categoryPreferences as any[]).forEach((cat, index) => {
      if (index < 10) {
        features[index + 2] = cat.count / 10; // Normalized
      }
    });

    return features;
  }

  private async getItemFeatures(itemId: string): Promise<number[]> {
    // Get item features for the neural network
    const item = await prisma.item.findUnique({
      where: { id: itemId },
      include: {
        category: true,
        _count: {
          select: { orderItems: true },
        },
      },
    });

    if (!item) {
      return new Array(50).fill(0);
    }

    const avgRating = await prisma.review.aggregate({
      where: { item_id: itemId },
      _avg: { rating: true },
    });

    // Create feature vector (simplified)
    const features = new Array(50).fill(0);
    features[0] = item.price / 100; // Normalized
    features[1] = item._count.orderItems / 1000; // Normalized
    features[2] = (avgRating._avg.rating || 0) / 5; // Normalized

    return features;
  }
}