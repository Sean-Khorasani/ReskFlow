import { prisma, logger } from '@reskflow/shared';
import Bull from 'bull';
import dayjs from 'dayjs';

interface SearchTrackingData {
  searchId: string;
  userId: string;
  query?: string;
  filters?: any;
  location: { latitude: number; longitude: number };
  resultCount: number;
  timestamp: Date;
}

interface ClickTrackingData {
  searchId: string;
  userId: string;
  resultId: string;
  resultType: 'merchant' | 'item';
  position: number;
  timestamp: Date;
}

interface ConversionTrackingData {
  searchId: string;
  userId: string;
  orderId: string;
  itemIds: string[];
  revenue: number;
  timestamp: Date;
}

interface SearchInsight {
  type: string;
  value: any;
  confidence: number;
  description: string;
}

interface SearchTrend {
  query: string;
  count: number;
  growth: number;
  category?: string;
}

export class SearchAnalyticsService {
  constructor(private searchQueue: Bull.Queue) {}

  async trackSearch(data: SearchTrackingData): Promise<void> {
    try {
      // Store search event
      await prisma.searchHistory.create({
        data: {
          search_id: data.searchId,
          user_id: data.userId,
          query: data.query || '',
          filters: data.filters || {},
          location: data.location,
          result_count: data.resultCount,
          created_at: data.timestamp,
        },
      });

      // Queue for further processing
      await this.searchQueue.add('generate-insights', {
        searchId: data.searchId,
        userId: data.userId,
      }, { delay: 5000 }); // Delay to collect more data

    } catch (error) {
      logger.error('Error tracking search:', error);
    }
  }

  async trackClick(data: ClickTrackingData): Promise<void> {
    try {
      // Store click event
      await prisma.searchClickEvent.create({
        data: {
          search_id: data.searchId,
          user_id: data.userId,
          result_id: data.resultId,
          result_type: data.resultType,
          position: data.position,
          created_at: data.timestamp,
        },
      });

      // Update search history with click
      await prisma.searchHistory.update({
        where: { search_id: data.searchId },
        data: {
          click_count: { increment: 1 },
          first_click_position: data.position,
        },
      });

    } catch (error) {
      logger.error('Error tracking click:', error);
    }
  }

  async trackConversion(data: ConversionTrackingData): Promise<void> {
    try {
      // Store conversion event
      await prisma.searchConversion.create({
        data: {
          search_id: data.searchId,
          user_id: data.userId,
          order_id: data.orderId,
          item_ids: data.itemIds,
          revenue: data.revenue,
          created_at: data.timestamp,
        },
      });

      // Update search history
      await prisma.searchHistory.update({
        where: { search_id: data.searchId },
        data: {
          conversion_count: { increment: 1 },
          conversion_revenue: { increment: data.revenue },
        },
      });

    } catch (error) {
      logger.error('Error tracking conversion:', error);
    }
  }

  async getPopularSearches(params: {
    location?: string;
    timeframe: string;
    limit?: number;
  }): Promise<any[]> {
    const hours = this.parseTimeframe(params.timeframe);
    const since = dayjs().subtract(hours, 'hour').toDate();

    const popularSearches = await prisma.searchHistory.groupBy({
      by: ['query'],
      where: {
        created_at: { gte: since },
        query: { not: '' },
      },
      _count: {
        query: true,
      },
      orderBy: {
        _count: {
          query: 'desc',
        },
      },
      take: params.limit || 20,
    });

    return popularSearches.map(search => ({
      query: search.query,
      count: search._count.query,
    }));
  }

  async getPopularSearchesNear(
    location: { latitude: number; longitude: number },
    radius: number = 5
  ): Promise<any[]> {
    // Get searches from users near this location
    const nearbySearches = await prisma.$queryRaw`
      SELECT query, COUNT(*) as count
      FROM search_history
      WHERE created_at > NOW() - INTERVAL '24 hours'
        AND query != ''
        AND ST_DWithin(
          ST_MakePoint(location->>'longitude'::float, location->>'latitude'::float)::geography,
          ST_MakePoint(${location.longitude}, ${location.latitude})::geography,
          ${radius * 1000}
        )
      GROUP BY query
      ORDER BY count DESC
      LIMIT 10
    `;

    return nearbySearches;
  }

  async getSearchTrends(period: string): Promise<SearchTrend[]> {
    const days = parseInt(period) || 7;
    const currentPeriodStart = dayjs().subtract(days, 'day').toDate();
    const previousPeriodStart = dayjs().subtract(days * 2, 'day').toDate();

    // Get current period searches
    const currentSearches = await prisma.searchHistory.groupBy({
      by: ['query'],
      where: {
        created_at: { gte: currentPeriodStart },
        query: { not: '' },
      },
      _count: { query: true },
    });

    // Get previous period searches
    const previousSearches = await prisma.searchHistory.groupBy({
      by: ['query'],
      where: {
        created_at: {
          gte: previousPeriodStart,
          lt: currentPeriodStart,
        },
        query: { not: '' },
      },
      _count: { query: true },
    });

    // Create map of previous counts
    const previousMap = new Map(
      previousSearches.map(s => [s.query, s._count.query])
    );

    // Calculate trends
    const trends: SearchTrend[] = currentSearches.map(search => {
      const currentCount = search._count.query;
      const previousCount = previousMap.get(search.query) || 0;
      const growth = previousCount > 0
        ? ((currentCount - previousCount) / previousCount) * 100
        : 100;

      return {
        query: search.query,
        count: currentCount,
        growth,
        category: this.categorizeQuery(search.query),
      };
    });

    // Sort by growth rate
    return trends.sort((a, b) => b.growth - a.growth).slice(0, 50);
  }

  async getConversionRate(searchId: string): Promise<{
    conversionRate: number;
    averageOrderValue: number;
    clickThroughRate: number;
  }> {
    const search = await prisma.searchHistory.findUnique({
      where: { search_id: searchId },
      include: {
        _count: {
          select: {
            clicks: true,
            conversions: true,
          },
        },
      },
    });

    if (!search) {
      return {
        conversionRate: 0,
        averageOrderValue: 0,
        clickThroughRate: 0,
      };
    }

    const conversionRate = search.result_count > 0
      ? (search._count.conversions / search.result_count) * 100
      : 0;

    const clickThroughRate = search.result_count > 0
      ? (search._count.clicks / search.result_count) * 100
      : 0;

    const averageOrderValue = search._count.conversions > 0
      ? search.conversion_revenue / search._count.conversions
      : 0;

    return {
      conversionRate,
      averageOrderValue,
      clickThroughRate,
    };
  }

  async generateInsights(data: {
    searchId: string;
    userId: string;
  }): Promise<SearchInsight[]> {
    const insights: SearchInsight[] = [];

    // Get search details
    const search = await prisma.searchHistory.findUnique({
      where: { search_id: data.searchId },
      include: {
        clicks: true,
        conversions: true,
      },
    });

    if (!search) return insights;

    // Low result count insight
    if (search.result_count < 5) {
      insights.push({
        type: 'low_results',
        value: search.result_count,
        confidence: 1.0,
        description: 'Search returned few results - consider expanding search criteria',
      });
    }

    // No clicks insight
    if (search.clicks.length === 0 && search.result_count > 0) {
      insights.push({
        type: 'no_engagement',
        value: 0,
        confidence: 0.9,
        description: 'Results shown but no clicks - relevance may be low',
      });
    }

    // High abandonment rate
    if (search.clicks.length > 0 && search.conversions.length === 0) {
      insights.push({
        type: 'high_abandonment',
        value: search.clicks.length,
        confidence: 0.8,
        description: 'Users clicked but didn\'t order - check pricing or availability',
      });
    }

    // Query analysis
    if (search.query) {
      const queryInsights = await this.analyzeQuery(search.query);
      insights.push(...queryInsights);
    }

    // Store insights
    for (const insight of insights) {
      await prisma.searchInsight.create({
        data: {
          search_id: data.searchId,
          type: insight.type,
          value: insight.value,
          confidence: insight.confidence,
          description: insight.description,
          created_at: new Date(),
        },
      });
    }

    return insights;
  }

  async getSimilarSuccessfulQueries(
    query: string,
    location: { latitude: number; longitude: number }
  ): Promise<string[]> {
    // Find queries with similar terms that had good conversion
    const queryTerms = query.toLowerCase().split(' ');
    
    const similarQueries = await prisma.$queryRaw<Array<{ query: string }>>`
      SELECT DISTINCT query
      FROM search_history
      WHERE conversion_count > 0
        AND result_count > 10
        AND created_at > NOW() - INTERVAL '30 days'
        AND query != ${query}
        AND (
          ${queryTerms.map(term => `query ILIKE '%${term}%'`).join(' OR ')}
        )
      ORDER BY conversion_revenue DESC
      LIMIT 5
    `;

    return similarQueries.map(sq => sq.query);
  }

  async getSearchMetrics(params: {
    startDate: Date;
    endDate: Date;
    groupBy: 'hour' | 'day' | 'week';
  }): Promise<any[]> {
    const metrics = await prisma.$queryRaw`
      SELECT 
        DATE_TRUNC(${params.groupBy}, created_at) as period,
        COUNT(*) as search_count,
        COUNT(DISTINCT user_id) as unique_users,
        AVG(result_count) as avg_results,
        SUM(click_count) as total_clicks,
        SUM(conversion_count) as total_conversions,
        SUM(conversion_revenue) as total_revenue
      FROM search_history
      WHERE created_at BETWEEN ${params.startDate} AND ${params.endDate}
      GROUP BY period
      ORDER BY period ASC
    `;

    return metrics;
  }

  async getUserSearchPatterns(userId: string): Promise<{
    favoriteQueries: string[];
    searchTimes: { hour: number; count: number }[];
    preferredCategories: string[];
  }> {
    // Get user's search history
    const searches = await prisma.searchHistory.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    // Analyze favorite queries
    const queryMap = new Map<string, number>();
    searches.forEach(search => {
      if (search.query) {
        queryMap.set(search.query, (queryMap.get(search.query) || 0) + 1);
      }
    });

    const favoriteQueries = Array.from(queryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([query]) => query);

    // Analyze search times
    const timeMap = new Map<number, number>();
    searches.forEach(search => {
      const hour = search.created_at.getHours();
      timeMap.set(hour, (timeMap.get(hour) || 0) + 1);
    });

    const searchTimes = Array.from(timeMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count);

    // Analyze categories
    const categories = searches
      .map(s => this.categorizeQuery(s.query))
      .filter(c => c !== 'other');

    const categoryMap = new Map<string, number>();
    categories.forEach(cat => {
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    });

    const preferredCategories = Array.from(categoryMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat]) => cat);

    return {
      favoriteQueries,
      searchTimes,
      preferredCategories,
    };
  }

  async optimizeSearchResults(params: {
    query: string;
    currentResults: any[];
    userHistory: any[];
  }): Promise<any[]> {
    // Analyze which types of results get clicked/converted for this query
    const successfulResults = await prisma.$queryRaw`
      SELECT 
        sc.result_id,
        sc.result_type,
        COUNT(*) as click_count,
        COUNT(DISTINCT sconv.id) as conversion_count
      FROM search_history sh
      JOIN search_click_events sc ON sh.search_id = sc.search_id
      LEFT JOIN search_conversions sconv ON sh.search_id = sconv.search_id
      WHERE sh.query = ${params.query}
      GROUP BY sc.result_id, sc.result_type
      ORDER BY conversion_count DESC, click_count DESC
      LIMIT 20
    `;

    // Create a map of successful result IDs
    const successMap = new Map(
      successfulResults.map(r => [r.result_id, r])
    );

    // Re-order results based on historical success
    const optimized = params.currentResults.sort((a, b) => {
      const aSuccess = successMap.get(a.id);
      const bSuccess = successMap.get(b.id);

      if (aSuccess && bSuccess) {
        return bSuccess.conversion_count - aSuccess.conversion_count;
      }
      if (aSuccess) return -1;
      if (bSuccess) return 1;
      return 0;
    });

    return optimized;
  }

  private parseTimeframe(timeframe: string): number {
    const unit = timeframe.slice(-1);
    const value = parseInt(timeframe.slice(0, -1));

    switch (unit) {
      case 'h': return value;
      case 'd': return value * 24;
      case 'w': return value * 24 * 7;
      default: return 24; // Default to 24 hours
    }
  }

  private categorizeQuery(query: string): string {
    if (!query) return 'other';

    const queryLower = query.toLowerCase();
    
    // Food categories
    const cuisines = ['pizza', 'burger', 'sushi', 'chinese', 'indian', 'thai', 'mexican', 'italian'];
    for (const cuisine of cuisines) {
      if (queryLower.includes(cuisine)) return `cuisine_${cuisine}`;
    }

    // Meal types
    const meals = ['breakfast', 'lunch', 'dinner', 'brunch'];
    for (const meal of meals) {
      if (queryLower.includes(meal)) return `meal_${meal}`;
    }

    // Dietary
    const dietary = ['vegan', 'vegetarian', 'gluten-free', 'healthy'];
    for (const diet of dietary) {
      if (queryLower.includes(diet)) return `dietary_${diet}`;
    }

    // Speed
    if (queryLower.includes('fast') || queryLower.includes('quick')) {
      return 'speed_fast';
    }

    // Price
    if (queryLower.includes('cheap') || queryLower.includes('budget')) {
      return 'price_budget';
    }

    return 'other';
  }

  private async analyzeQuery(query: string): Promise<SearchInsight[]> {
    const insights: SearchInsight[] = [];
    const queryLower = query.toLowerCase();

    // Spelling analysis
    if (this.hasCommonMisspelling(queryLower)) {
      insights.push({
        type: 'spelling',
        value: queryLower,
        confidence: 0.8,
        description: 'Query may contain common misspelling',
      });
    }

    // Ambiguity analysis
    if (queryLower.split(' ').length === 1 && queryLower.length < 5) {
      insights.push({
        type: 'ambiguous',
        value: queryLower,
        confidence: 0.7,
        description: 'Query is too short and may be ambiguous',
      });
    }

    // Intent analysis
    const intent = this.detectQueryIntent(queryLower);
    if (intent) {
      insights.push({
        type: 'intent',
        value: intent,
        confidence: 0.85,
        description: `User intent detected: ${intent}`,
      });
    }

    return insights;
  }

  private hasCommonMisspelling(query: string): boolean {
    const misspellings = ['piza', 'burgur', 'sandwitch', 'chiken', 'cofee'];
    return misspellings.some(m => query.includes(m));
  }

  private detectQueryIntent(query: string): string | null {
    if (query.includes('near') || query.includes('nearby')) {
      return 'location_based';
    }
    if (query.includes('open now') || query.includes('late night')) {
      return 'time_sensitive';
    }
    if (query.includes('reskflow') || query.includes('fast')) {
      return 'speed_focused';
    }
    if (query.includes('deal') || query.includes('discount')) {
      return 'price_sensitive';
    }
    return null;
  }
}