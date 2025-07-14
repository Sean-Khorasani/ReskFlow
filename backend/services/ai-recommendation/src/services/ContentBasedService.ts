import { prisma, redis, logger } from '@reskflow/shared';
import * as natural from 'natural';
import * as tf from '@tensorflow/tfjs-node';
import { kmeans } from 'kmeans-js';

interface ItemFeatures {
  itemId: string;
  name: string;
  description: string;
  category: string;
  cuisine: string;
  price: number;
  tags: string[];
  ingredients: string[];
  nutritionalInfo: any;
  textVector?: number[];
  numericVector?: number[];
}

export class ContentBasedService {
  private tfidf: natural.TfIdf;
  private itemFeatures: Map<string, ItemFeatures> = new Map();
  private featureModel: tf.LayersModel | null = null;

  constructor() {
    this.tfidf = new natural.TfIdf();
  }

  async initialize() {
    await this.buildItemFeatures();
    await this.trainFeatureModel();
  }

  async getSimilarItems(
    itemId: string,
    limit: number = 10
  ): Promise<Array<{ itemId: string; similarity: number }>> {
    const targetFeatures = this.itemFeatures.get(itemId);
    if (!targetFeatures) {
      logger.warn(`Item features not found for ${itemId}`);
      return [];
    }

    const similarities: Array<{ itemId: string; similarity: number }> = [];

    for (const [otherItemId, otherFeatures] of this.itemFeatures) {
      if (otherItemId === itemId) continue;

      const similarity = this.calculateSimilarity(targetFeatures, otherFeatures);
      if (similarity > 0.3) { // Threshold for relevance
        similarities.push({ itemId: otherItemId, similarity });
      }
    }

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  async getRecommendationsForProfile(
    userProfile: any,
    candidateItems: string[],
    limit: number = 20
  ): Promise<Array<{ itemId: string; score: number }>> {
    const recommendations: Array<{ itemId: string; score: number }> = [];

    for (const itemId of candidateItems) {
      const features = this.itemFeatures.get(itemId);
      if (!features) continue;

      const score = this.calculateProfileItemScore(userProfile, features);
      recommendations.push({ itemId, score });
    }

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async getItemClusters(k: number = 10): Promise<Map<number, string[]>> {
    // Cluster items based on features
    const itemIds: string[] = [];
    const vectors: number[][] = [];

    for (const [itemId, features] of this.itemFeatures) {
      if (features.numericVector) {
        itemIds.push(itemId);
        vectors.push(features.numericVector);
      }
    }

    if (vectors.length < k) {
      logger.warn('Not enough items for clustering');
      return new Map();
    }

    // Perform k-means clustering
    const clusters = kmeans(vectors, k, {
      iterations: 100,
      distance: 'euclidean',
    });

    // Map items to clusters
    const clusterMap = new Map<number, string[]>();
    clusters.assignments.forEach((cluster, index) => {
      if (!clusterMap.has(cluster)) {
        clusterMap.set(cluster, []);
      }
      clusterMap.get(cluster)!.push(itemIds[index]);
    });

    return clusterMap;
  }

  async getDiverseRecommendations(
    baseItems: Array<{ itemId: string; score: number }>,
    diversityWeight: number = 0.3
  ): Promise<Array<{ itemId: string; score: number }>> {
    if (baseItems.length === 0) return [];

    const selected: Array<{ itemId: string; score: number }> = [];
    const remaining = [...baseItems];

    // Select first item (highest score)
    selected.push(remaining.shift()!);

    // Iteratively select diverse items
    while (selected.length < Math.min(baseItems.length, 20) && remaining.length > 0) {
      let bestCandidate = null;
      let bestScore = -Infinity;

      for (const candidate of remaining) {
        const candidateFeatures = this.itemFeatures.get(candidate.itemId);
        if (!candidateFeatures) continue;

        // Calculate average dissimilarity to selected items
        let avgDissimilarity = 0;
        for (const selectedItem of selected) {
          const selectedFeatures = this.itemFeatures.get(selectedItem.itemId);
          if (selectedFeatures) {
            const similarity = this.calculateSimilarity(candidateFeatures, selectedFeatures);
            avgDissimilarity += (1 - similarity);
          }
        }
        avgDissimilarity /= selected.length;

        // Combined score: original score + diversity bonus
        const combinedScore = 
          (1 - diversityWeight) * candidate.score + 
          diversityWeight * avgDissimilarity;

        if (combinedScore > bestScore) {
          bestScore = combinedScore;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate) {
        selected.push(bestCandidate);
        remaining.splice(remaining.indexOf(bestCandidate), 1);
      } else {
        break;
      }
    }

    return selected;
  }

  private async buildItemFeatures() {
    logger.info('Building item features for content-based filtering');

    const items = await prisma.item.findMany({
      where: { active: true },
      include: {
        category: true,
        merchant: {
          select: {
            cuisine_type: true,
          },
        },
        tags: true,
      },
    });

    // Build TF-IDF model
    items.forEach(item => {
      const text = `${item.name} ${item.description} ${item.category.name} ${item.merchant.cuisine_type || ''} ${item.tags.map(t => t.name).join(' ')}`;
      this.tfidf.addDocument(text);
    });

    // Extract features for each item
    items.forEach((item, index) => {
      const features: ItemFeatures = {
        itemId: item.id,
        name: item.name,
        description: item.description || '',
        category: item.category.name,
        cuisine: item.merchant.cuisine_type || 'unknown',
        price: item.price,
        tags: item.tags.map(t => t.name),
        ingredients: item.ingredients || [],
        nutritionalInfo: item.nutritional_info || {},
      };

      // Extract text features using TF-IDF
      const textVector: number[] = [];
      this.tfidf.tfidfs(item.name, (i, measure) => {
        if (i === index) {
          textVector.push(measure);
        }
      });
      features.textVector = textVector;

      // Extract numeric features
      features.numericVector = this.extractNumericFeatures(item);

      this.itemFeatures.set(item.id, features);
    });

    logger.info(`Built features for ${items.length} items`);

    // Cache a sample of features
    const sample = Array.from(this.itemFeatures.entries()).slice(0, 100);
    await redis.setex(
      'item_features_sample',
      3600,
      JSON.stringify(sample)
    );
  }

  private extractNumericFeatures(item: any): number[] {
    const features = [];

    // Price (normalized)
    features.push(Math.log(item.price + 1) / 10);

    // Preparation time (normalized)
    features.push((item.preparation_time || 15) / 60);

    // Spiciness level
    features.push((item.spiciness_level || 0) / 5);

    // Nutritional features (normalized)
    const nutrition = item.nutritional_info || {};
    features.push((nutrition.calories || 500) / 1000);
    features.push((nutrition.protein || 20) / 100);
    features.push((nutrition.carbs || 50) / 100);
    features.push((nutrition.fat || 20) / 100);

    // Category one-hot encoding (simplified)
    const categories = ['Fast Food', 'Italian', 'Asian', 'Mexican', 'Healthy', 'Dessert'];
    categories.forEach(cat => {
      features.push(item.category.name === cat ? 1 : 0);
    });

    // Time of day suitability
    const breakfast = item.tags.some((t: any) => t.name.toLowerCase().includes('breakfast')) ? 1 : 0;
    const lunch = item.tags.some((t: any) => t.name.toLowerCase().includes('lunch')) ? 1 : 0;
    const dinner = item.tags.some((t: any) => t.name.toLowerCase().includes('dinner')) ? 1 : 0;
    features.push(breakfast, lunch, dinner);

    return features;
  }

  private calculateSimilarity(features1: ItemFeatures, features2: ItemFeatures): number {
    // Combine multiple similarity measures

    // 1. Category similarity
    const categorySimilarity = features1.category === features2.category ? 1 : 0.3;

    // 2. Cuisine similarity
    const cuisineSimilarity = features1.cuisine === features2.cuisine ? 1 : 0.2;

    // 3. Price similarity
    const priceDiff = Math.abs(features1.price - features2.price);
    const priceSimilarity = Math.exp(-priceDiff / 10);

    // 4. Tag similarity (Jaccard index)
    const tags1 = new Set(features1.tags);
    const tags2 = new Set(features2.tags);
    const intersection = new Set([...tags1].filter(x => tags2.has(x)));
    const union = new Set([...tags1, ...tags2]);
    const tagSimilarity = union.size > 0 ? intersection.size / union.size : 0;

    // 5. Text similarity (if vectors available)
    let textSimilarity = 0;
    if (features1.textVector && features2.textVector) {
      textSimilarity = this.cosineSimilarity(features1.textVector, features2.textVector);
    }

    // 6. Numeric feature similarity
    let numericSimilarity = 0;
    if (features1.numericVector && features2.numericVector) {
      numericSimilarity = this.cosineSimilarity(features1.numericVector, features2.numericVector);
    }

    // Weighted combination
    const weights = {
      category: 0.25,
      cuisine: 0.15,
      price: 0.15,
      tags: 0.15,
      text: 0.15,
      numeric: 0.15,
    };

    return (
      weights.category * categorySimilarity +
      weights.cuisine * cuisineSimilarity +
      weights.price * priceSimilarity +
      weights.tags * tagSimilarity +
      weights.text * textSimilarity +
      weights.numeric * numericSimilarity
    );
  }

  private calculateProfileItemScore(userProfile: any, itemFeatures: ItemFeatures): number {
    let score = 1;

    // Category preference
    const categoryPref = userProfile.preferences.categories[itemFeatures.category] || 0.1;
    score *= (1 + categoryPref);

    // Cuisine preference
    const cuisinePref = userProfile.preferences.cuisines[itemFeatures.cuisine] || 0.1;
    score *= (1 + cuisinePref);

    // Price range match
    if (this.matchesPriceRange(itemFeatures.price, userProfile.preferences.priceRange)) {
      score *= 1.2;
    }

    // Dietary restrictions
    const dietaryTags = new Set(itemFeatures.tags.map(t => t.toLowerCase()));
    userProfile.preferences.dietaryRestrictions.forEach((restriction: string) => {
      if (dietaryTags.has(restriction.toLowerCase())) {
        score *= 1.3;
      }
    });

    // Allergen penalty
    const ingredients = new Set(itemFeatures.ingredients.map(i => i.toLowerCase()));
    userProfile.preferences.allergens.forEach((allergen: string) => {
      if (ingredients.has(allergen.toLowerCase())) {
        score *= 0.1; // Heavy penalty
      }
    });

    return score;
  }

  private matchesPriceRange(price: number, range: string): boolean {
    switch (range) {
      case 'budget':
        return price < 15;
      case 'moderate':
        return price >= 15 && price < 30;
      case 'premium':
        return price >= 30;
      default:
        return true;
    }
  }

  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) return 0;

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    if (norm1 === 0 || norm2 === 0) return 0;

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  private async trainFeatureModel() {
    // Train a neural network for feature extraction (placeholder)
    try {
      this.featureModel = tf.sequential({
        layers: [
          tf.layers.dense({
            inputShape: [20], // Assuming 20 numeric features
            units: 64,
            activation: 'relu',
          }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({
            units: 32,
            activation: 'relu',
          }),
          tf.layers.dense({
            units: 16,
            activation: 'relu',
          }),
        ],
      });

      logger.info('Content-based feature model created');
    } catch (error) {
      logger.error('Failed to create feature model', error);
    }
  }
}