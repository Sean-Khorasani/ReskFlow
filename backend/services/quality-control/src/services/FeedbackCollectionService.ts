import { prisma, logger } from '@reskflow/shared';
import { EventEmitter } from 'events';
import dayjs from 'dayjs';
import natural from 'natural';

interface FeedbackRequest {
  orderId: string;
  customerId: string;
  type: 'automatic' | 'prompted' | 'manual';
  questions: FeedbackQuestion[];
}

interface FeedbackQuestion {
  id: string;
  type: 'rating' | 'boolean' | 'text' | 'multiChoice';
  question: string;
  required: boolean;
  options?: string[];
  category: 'overall' | 'food' | 'reskflow' | 'packaging' | 'service';
}

interface FeedbackResponse {
  orderId: string;
  customerId: string;
  responses: {
    questionId: string;
    answer: any;
  }[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  actionableInsights: string[];
  submittedAt: Date;
}

interface FeedbackAnalysis {
  orderId: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  categories: {
    category: string;
    score: number;
    issues: string[];
  }[];
  suggestedActions: string[];
  priority: 'low' | 'medium' | 'high';
}

export class FeedbackCollectionService extends EventEmitter {
  private sentimentAnalyzer: any;
  private readonly FEEDBACK_WINDOW_HOURS = 48;

  constructor() {
    super();
    this.sentimentAnalyzer = new natural.SentimentAnalyzer('English', natural.PorterStemmer, 'afinn');
  }

  async createFeedbackRequest(orderId: string): Promise<FeedbackRequest> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          orderItems: true,
          merchant: true,
        },
      });

      if (!order || !order.delivered_at) {
        throw new Error('Order not found or not delivered');
      }

      // Check if feedback already requested
      const existing = await prisma.feedbackRequest.findFirst({
        where: { order_id: orderId },
      });

      if (existing) {
        return this.formatFeedbackRequest(existing);
      }

      // Generate dynamic questions based on order
      const questions = this.generateDynamicQuestions(order);

      // Create feedback request
      const request = await prisma.feedbackRequest.create({
        data: {
          order_id: orderId,
          customer_id: order.customer_id,
          type: 'automatic',
          questions,
          expires_at: dayjs().add(this.FEEDBACK_WINDOW_HOURS, 'hour').toDate(),
          created_at: new Date(),
        },
      });

      // Schedule reminder
      this.emit('feedback-requested', {
        requestId: request.id,
        customerId: order.customer_id,
        orderId,
      });

      return this.formatFeedbackRequest(request);
    } catch (error) {
      logger.error('Error creating feedback request:', error);
      throw error;
    }
  }

  async submitFeedback(params: {
    orderId: string;
    customerId: string;
    responses: { questionId: string; answer: any }[];
  }): Promise<FeedbackResponse> {
    try {
      // Validate feedback request
      const request = await prisma.feedbackRequest.findFirst({
        where: {
          order_id: params.orderId,
          customer_id: params.customerId,
        },
      });

      if (!request) {
        throw new Error('Feedback request not found');
      }

      if (request.expires_at < new Date()) {
        throw new Error('Feedback request has expired');
      }

      // Analyze feedback
      const analysis = await this.analyzeFeedback(params.responses, request.questions);

      // Store feedback
      const feedback = await prisma.feedback.create({
        data: {
          order_id: params.orderId,
          customer_id: params.customerId,
          request_id: request.id,
          responses: params.responses,
          sentiment: analysis.sentiment,
          analysis_results: analysis,
          submitted_at: new Date(),
        },
      });

      // Update request status
      await prisma.feedbackRequest.update({
        where: { id: request.id },
        data: {
          status: 'completed',
          completed_at: new Date(),
        },
      });

      // Process actionable insights
      const actionableInsights = await this.extractActionableInsights(analysis);

      // Trigger actions based on feedback
      await this.triggerFeedbackActions(analysis, params.orderId);

      return {
        orderId: params.orderId,
        customerId: params.customerId,
        responses: params.responses,
        sentiment: analysis.sentiment,
        actionableInsights,
        submittedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error submitting feedback:', error);
      throw error;
    }
  }

  async getQuickFeedbackOptions(orderId: string): Promise<{
    orderId: string;
    quickOptions: {
      id: string;
      emoji: string;
      label: string;
      sentiment: 'positive' | 'neutral' | 'negative';
    }[];
  }> {
    const options = [
      { id: 'excellent', emoji: '😍', label: 'Excellent!', sentiment: 'positive' as const },
      { id: 'good', emoji: '😊', label: 'Good', sentiment: 'positive' as const },
      { id: 'okay', emoji: '😐', label: 'Okay', sentiment: 'neutral' as const },
      { id: 'poor', emoji: '😞', label: 'Poor', sentiment: 'negative' as const },
      { id: 'terrible', emoji: '😡', label: 'Terrible', sentiment: 'negative' as const },
    ];

    return {
      orderId,
      quickOptions: options,
    };
  }

  async submitQuickFeedback(params: {
    orderId: string;
    customerId: string;
    optionId: string;
    comment?: string;
  }): Promise<void> {
    try {
      const quickOptions = await this.getQuickFeedbackOptions(params.orderId);
      const selected = quickOptions.quickOptions.find(opt => opt.id === params.optionId);

      if (!selected) {
        throw new Error('Invalid feedback option');
      }

      // Create simplified feedback
      await prisma.quickFeedback.create({
        data: {
          order_id: params.orderId,
          customer_id: params.customerId,
          option_id: params.optionId,
          sentiment: selected.sentiment,
          comment: params.comment,
          created_at: new Date(),
        },
      });

      // If negative, trigger immediate follow-up
      if (selected.sentiment === 'negative') {
        await this.triggerNegativeFeedbackFollowUp(params.orderId, params.customerId);
      }
    } catch (error) {
      logger.error('Error submitting quick feedback:', error);
      throw error;
    }
  }

  async getFeedbackTrends(params: {
    merchantId?: string;
    period: { start: Date; end: Date };
    groupBy: 'day' | 'week' | 'month';
  }): Promise<{
    period: string;
    totalFeedback: number;
    averageSentiment: number;
    sentimentBreakdown: {
      positive: number;
      neutral: number;
      negative: number;
    };
    topIssues: string[];
    responseRate: number;
  }[]> {
    const groupByClause = params.groupBy === 'day' ? 'DATE(submitted_at)' :
                         params.groupBy === 'week' ? 'DATE_TRUNC(\'week\', submitted_at)' :
                         'DATE_TRUNC(\'month\', submitted_at)';

    const trends = await prisma.$queryRaw`
      SELECT 
        ${groupByClause} as period,
        COUNT(*) as total_feedback,
        COUNT(CASE WHEN sentiment = 'positive' THEN 1 END) as positive_count,
        COUNT(CASE WHEN sentiment = 'neutral' THEN 1 END) as neutral_count,
        COUNT(CASE WHEN sentiment = 'negative' THEN 1 END) as negative_count,
        AVG(CASE 
          WHEN sentiment = 'positive' THEN 1
          WHEN sentiment = 'neutral' THEN 0
          WHEN sentiment = 'negative' THEN -1
        END) as avg_sentiment
      FROM feedback f
      JOIN orders o ON f.order_id = o.id
      WHERE f.submitted_at BETWEEN ${params.period.start} AND ${params.period.end}
        ${params.merchantId ? `AND o.merchant_id = ${params.merchantId}` : ''}
      GROUP BY ${groupByClause}
      ORDER BY period ASC
    `;

    // Calculate response rates
    const responseRates = await this.calculateResponseRates(params);

    return trends.map((trend: any) => ({
      period: trend.period,
      totalFeedback: trend.total_feedback,
      averageSentiment: trend.avg_sentiment,
      sentimentBreakdown: {
        positive: trend.positive_count,
        neutral: trend.neutral_count,
        negative: trend.negative_count,
      },
      topIssues: [], // Would require additional query
      responseRate: responseRates[trend.period] || 0,
    }));
  }

  async getInsightsSummary(merchantId: string): Promise<{
    overallSentiment: number;
    topCompliments: string[];
    topComplaints: string[];
    improvementAreas: {
      area: string;
      score: number;
      trend: 'improving' | 'stable' | 'declining';
      suggestions: string[];
    }[];
    customerQuotes: {
      text: string;
      sentiment: string;
      date: Date;
    }[];
  }> {
    const period = {
      start: dayjs().subtract(30, 'day').toDate(),
      end: new Date(),
    };

    // Get feedback data
    const feedback = await prisma.feedback.findMany({
      where: {
        order: {
          merchant_id: merchantId,
        },
        submitted_at: {
          gte: period.start,
          lte: period.end,
        },
      },
      include: {
        order: true,
      },
    });

    // Analyze feedback
    const analysis = this.analyzeFeedbackSet(feedback);

    return {
      overallSentiment: analysis.overallSentiment,
      topCompliments: analysis.topCompliments,
      topComplaints: analysis.topComplaints,
      improvementAreas: analysis.improvementAreas,
      customerQuotes: analysis.customerQuotes,
    };
  }

  private generateDynamicQuestions(order: any): FeedbackQuestion[] {
    const questions: FeedbackQuestion[] = [
      {
        id: 'overall-rating',
        type: 'rating',
        question: 'How would you rate your overall experience?',
        required: true,
        category: 'overall',
      },
      {
        id: 'food-quality',
        type: 'rating',
        question: 'How was the quality of your food?',
        required: true,
        category: 'food',
      },
      {
        id: 'reskflow-experience',
        type: 'rating',
        question: 'How was your reskflow experience?',
        required: true,
        category: 'reskflow',
      },
    ];

    // Add conditional questions
    if (order.reskflow_time > order.estimated_reskflow_time) {
      questions.push({
        id: 'late-reskflow-reason',
        type: 'multiChoice',
        question: 'We noticed your order was late. What do you think caused the delay?',
        required: false,
        options: ['Traffic', 'Wrong address', 'Driver issue', 'Restaurant delay', 'Other'],
        category: 'reskflow',
      });
    }

    // Add item-specific questions
    if (order.orderItems.length > 3) {
      questions.push({
        id: 'order-accuracy',
        type: 'boolean',
        question: 'Did you receive all items in your order?',
        required: true,
        category: 'food',
      });
    }

    // Add open-ended question
    questions.push({
      id: 'additional-comments',
      type: 'text',
      question: 'Any additional comments or suggestions?',
      required: false,
      category: 'overall',
    });

    return questions;
  }

  private async analyzeFeedback(
    responses: { questionId: string; answer: any }[],
    questions: any[]
  ): Promise<FeedbackAnalysis> {
    const analysis: FeedbackAnalysis = {
      orderId: '',
      sentiment: 'neutral',
      categories: [],
      suggestedActions: [],
      priority: 'low',
    };

    // Calculate sentiment from ratings
    const ratings = responses
      .filter(r => questions.find(q => q.id === r.questionId && q.type === 'rating'))
      .map(r => r.answer);

    if (ratings.length > 0) {
      const avgRating = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      analysis.sentiment = avgRating >= 4 ? 'positive' : avgRating >= 3 ? 'neutral' : 'negative';
    }

    // Analyze text responses
    const textResponses = responses
      .filter(r => questions.find(q => q.id === r.questionId && q.type === 'text'))
      .map(r => r.answer);

    for (const text of textResponses) {
      if (text && text.length > 10) {
        const sentimentScore = this.sentimentAnalyzer.getSentiment(text.split(' '));
        if (sentimentScore < -0.5) {
          analysis.sentiment = 'negative';
          analysis.priority = 'high';
        }
      }
    }

    // Extract issues by category
    const categoryMap = new Map<string, { scores: number[]; issues: string[] }>();

    responses.forEach(response => {
      const question = questions.find(q => q.id === response.questionId);
      if (!question) return;

      const category = question.category;
      if (!categoryMap.has(category)) {
        categoryMap.set(category, { scores: [], issues: [] });
      }

      const categoryData = categoryMap.get(category)!;

      if (question.type === 'rating') {
        categoryData.scores.push(response.answer);
        if (response.answer <= 2) {
          categoryData.issues.push(`Low rating for ${question.question}`);
        }
      } else if (question.type === 'boolean' && !response.answer) {
        categoryData.issues.push(question.question);
      }
    });

    // Build category analysis
    analysis.categories = Array.from(categoryMap.entries()).map(([category, data]) => ({
      category,
      score: data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : 0,
      issues: data.issues,
    }));

    // Generate suggested actions
    analysis.suggestedActions = this.generateSuggestedActions(analysis);

    return analysis;
  }

  private generateSuggestedActions(analysis: FeedbackAnalysis): string[] {
    const actions: string[] = [];

    analysis.categories.forEach(category => {
      if (category.score < 3) {
        switch (category.category) {
          case 'food':
            actions.push('Review food preparation standards');
            actions.push('Check ingredient freshness');
            break;
          case 'reskflow':
            actions.push('Review reskflow driver performance');
            actions.push('Optimize reskflow routes');
            break;
          case 'packaging':
            actions.push('Upgrade packaging materials');
            actions.push('Train staff on proper packaging');
            break;
        }
      }
    });

    if (analysis.sentiment === 'negative') {
      actions.push('Contact customer for follow-up');
      actions.push('Offer compensation or discount');
    }

    return actions;
  }

  private async extractActionableInsights(analysis: FeedbackAnalysis): Promise<string[]> {
    const insights: string[] = [];

    // Check for specific patterns
    analysis.categories.forEach(category => {
      if (category.issues.length > 0) {
        insights.push(`Issues detected in ${category.category}: ${category.issues.join(', ')}`);
      }
    });

    // Add priority-based insights
    if (analysis.priority === 'high') {
      insights.push('Immediate attention required - customer highly dissatisfied');
    }

    return insights;
  }

  private async triggerFeedbackActions(
    analysis: FeedbackAnalysis,
    orderId: string
  ): Promise<void> {
    // Trigger different actions based on analysis
    if (analysis.sentiment === 'negative' && analysis.priority === 'high') {
      this.emit('negative-feedback-alert', {
        orderId,
        analysis,
      });
    }

    // Queue suggested actions
    analysis.suggestedActions.forEach(action => {
      this.emit('suggested-action', {
        orderId,
        action,
        priority: analysis.priority,
      });
    });
  }

  private async triggerNegativeFeedbackFollowUp(
    orderId: string,
    customerId: string
  ): Promise<void> {
    // Create follow-up task
    await prisma.feedbackFollowUp.create({
      data: {
        order_id: orderId,
        customer_id: customerId,
        type: 'negative_feedback',
        priority: 'high',
        assigned_to: null, // Will be assigned by support team
        due_date: dayjs().add(1, 'hour').toDate(),
        created_at: new Date(),
      },
    });

    this.emit('negative-feedback-followup', {
      orderId,
      customerId,
    });
  }

  private async calculateResponseRates(params: any): Promise<Record<string, number>> {
    // This would calculate actual response rates
    // For now, return mock data
    return {};
  }

  private analyzeFeedbackSet(feedback: any[]): any {
    // Analyze a set of feedback for insights
    const sentiments = feedback.map(f => f.sentiment);
    const positiveCount = sentiments.filter(s => s === 'positive').length;
    const totalCount = sentiments.length;

    const overallSentiment = totalCount > 0 ? positiveCount / totalCount : 0;

    // Extract compliments and complaints from text
    const compliments: string[] = [];
    const complaints: string[] = [];

    feedback.forEach(f => {
      if (f.analysis_results?.categories) {
        f.analysis_results.categories.forEach((cat: any) => {
          if (cat.score >= 4) {
            compliments.push(`Great ${cat.category}`);
          } else if (cat.score <= 2) {
            complaints.push(`Poor ${cat.category}`);
          }
        });
      }
    });

    return {
      overallSentiment,
      topCompliments: [...new Set(compliments)].slice(0, 5),
      topComplaints: [...new Set(complaints)].slice(0, 5),
      improvementAreas: [],
      customerQuotes: [],
    };
  }

  private formatFeedbackRequest(request: any): FeedbackRequest {
    return {
      orderId: request.order_id,
      customerId: request.customer_id,
      type: request.type,
      questions: request.questions,
    };
  }
}