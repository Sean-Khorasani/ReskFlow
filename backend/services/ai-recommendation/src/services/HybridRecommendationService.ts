import { CollaborativeFilteringService } from './CollaborativeFilteringService';
import { ContentBasedService } from './ContentBasedService';
import { logger, redis } from '@reskflow/shared';

interface RecommendationRequest {
  userId: string;
  userProfile: any;
  limit: number;
  context?: string;
}

interface HybridRecommendation {
  itemId: string;
  score: number;
  source: 'collaborative' | 'content' | 'hybrid';
  explanation?: string;
}

export class HybridRecommendationService {
  private collaborativeFiltering: CollaborativeFilteringService;
  private contentBased: ContentBasedService;

  constructor(
    collaborativeFiltering: CollaborativeFilteringService,
    contentBased: ContentBasedService
  ) {
    this.collaborativeFiltering = collaborativeFiltering;
    this.contentBased = contentBased;
  }

  async getRecommendations(
    request: RecommendationRequest
  ): Promise<HybridRecommendation[]> {
    const { userId, userProfile, limit, context } = request;

    // Get recommendations from both approaches
    const [cfRecommendations, cbRecommendations] = await Promise.all([
      this.getCollaborativeRecommendations(userId, limit * 2),
      this.getContentBasedRecommendations(userProfile, limit * 2),
    ]);

    // Merge recommendations using weighted hybrid approach
    const mergedRecommendations = this.mergeRecommendations(
      cfRecommendations,
      cbRecommendations,
      context
    );

    // Apply diversity to avoid filter bubble
    const diverseRecommendations = await this.contentBased.getDiverseRecommendations(
      mergedRecommendations.map(r => ({ itemId: r.itemId, score: r.score })),
      0.2 // 20% diversity weight
    );

    // Convert back to hybrid recommendations
    const finalRecommendations = diverseRecommendations.map(rec => {
      const original = mergedRecommendations.find(r => r.itemId === rec.itemId);
      return original || { ...rec, source: 'hybrid' as const };
    });

    return finalRecommendations.slice(0, limit);
  }

  async getExplanation(
    userId: string,
    itemId: string,
    userProfile: any
  ): Promise<string> {
    // Check if item was recommended through collaborative filtering
    const similarUsers = await this.collaborativeFiltering.getUserSimilarity(
      userId,
      userProfile.similar_users?.[0] || ''
    );

    if (similarUsers > 0.7) {
      return `Users with similar tastes to you often order this item`;
    }

    // Check content-based similarity
    const lastOrderedItems = userProfile.interactions.recent_items || [];
    if (lastOrderedItems.length > 0) {
      const similarities = await Promise.all(
        lastOrderedItems.slice(0, 3).map((recentItemId: string) =>
          this.contentBased.getSimilarItems(recentItemId, 5)
        )
      );

      const isSimmilar = similarities.some(simList =>
        simList.some(sim => sim.itemId === itemId && sim.similarity > 0.7)
      );

      if (isSimmilar) {
        return `Similar to items you've recently ordered`;
      }
    }

    // Check if it matches user preferences
    const itemFeatures = await this.getItemFeatures(itemId);
    if (itemFeatures && userProfile.preferences.categories[itemFeatures.category] > 0.3) {
      return `Matches your preference for ${itemFeatures.category}`;
    }

    return `Recommended based on your overall ordering patterns`;
  }

  private async getCollaborativeRecommendations(
    userId: string,
    limit: number
  ): Promise<HybridRecommendation[]> {
    try {
      const recommendations = await this.collaborativeFiltering.getRecommendations(
        userId,
        [],
        limit
      );

      return recommendations.map(rec => ({
        itemId: rec.itemId,
        score: rec.score,
        source: 'collaborative' as const,
        explanation: 'Based on similar users',
      }));
    } catch (error) {
      logger.error('Collaborative filtering failed', error);
      return [];
    }
  }

  private async getContentBasedRecommendations(
    userProfile: any,
    limit: number
  ): Promise<HybridRecommendation[]> {
    try {
      // Get candidate items based on user's preferred categories
      const candidateItems = await this.getCandidateItems(userProfile);

      const recommendations = await this.contentBased.getRecommendationsForProfile(
        userProfile,
        candidateItems,
        limit
      );

      return recommendations.map(rec => ({
        itemId: rec.itemId,
        score: rec.score,
        source: 'content' as const,
        explanation: 'Matches your preferences',
      }));
    } catch (error) {
      logger.error('Content-based filtering failed', error);
      return [];
    }
  }

  private mergeRecommendations(
    cfRecs: HybridRecommendation[],
    cbRecs: HybridRecommendation[],
    context?: string
  ): HybridRecommendation[] {
    // Create maps for easy lookup
    const cfMap = new Map(cfRecs.map(r => [r.itemId, r]));
    const cbMap = new Map(cbRecs.map(r => [r.itemId, r]));

    // Get all unique item IDs
    const allItemIds = new Set([...cfMap.keys(), ...cbMap.keys()]);

    // Calculate hybrid scores
    const hybridRecs: HybridRecommendation[] = [];

    for (const itemId of allItemIds) {
      const cfRec = cfMap.get(itemId);
      const cbRec = cbMap.get(itemId);

      // Determine weights based on context
      let cfWeight = 0.5;
      let cbWeight = 0.5;

      if (context === 'exploration') {
        // Favor collaborative filtering for discovery
        cfWeight = 0.7;
        cbWeight = 0.3;
      } else if (context === 'reorder') {
        // Favor content-based for familiar items
        cfWeight = 0.3;
        cbWeight = 0.7;
      }

      // Calculate hybrid score
      const cfScore = cfRec ? cfRec.score * cfWeight : 0;
      const cbScore = cbRec ? cbRec.score * cbWeight : 0;
      const hybridScore = cfScore + cbScore;

      // Boost score if item appears in both
      const boostFactor = cfRec && cbRec ? 1.2 : 1.0;

      hybridRecs.push({
        itemId,
        score: hybridScore * boostFactor,
        source: 'hybrid',
        explanation: this.getHybridExplanation(cfRec, cbRec),
      });
    }

    // Sort by score
    return hybridRecs.sort((a, b) => b.score - a.score);
  }

  private getHybridExplanation(
    cfRec?: HybridRecommendation,
    cbRec?: HybridRecommendation
  ): string {
    if (cfRec && cbRec) {
      return 'Popular with similar users and matches your preferences';
    } else if (cfRec) {
      return cfRec.explanation || 'Popular with similar users';
    } else if (cbRec) {
      return cbRec.explanation || 'Matches your preferences';
    }
    return 'Recommended for you';
  }

  private async getCandidateItems(userProfile: any): Promise<string[]> {
    // Get items from user's preferred categories and merchants
    const cacheKey = `candidate_items:${userProfile.userId}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Build candidate set based on user preferences
    const preferredCategories = Object.entries(userProfile.preferences.categories)
      .filter(([_, score]) => (score as number) > 0.1)
      .map(([category]) => category);

    // This is a simplified version - in production, you'd query the database
    const candidateItems: string[] = [];

    // Add items from preferred categories
    // Add items from merchants user has ordered from
    // Add trending items in user's area
    // etc.

    // For now, return empty array which will trigger popularity-based fallback
    await redis.setex(cacheKey, 300, JSON.stringify(candidateItems));
    return candidateItems;
  }

  private async getItemFeatures(itemId: string): Promise<any> {
    // This would fetch from the content-based service's feature store
    // Simplified for now
    return null;
  }
}