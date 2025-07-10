import { logger } from '@reskflow/shared';

interface ModerationResult {
  blocked: boolean;
  flagged: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high';
  categories?: string[];
}

interface WordFilter {
  word: string;
  severity: 'low' | 'medium' | 'high';
  action: 'flag' | 'block';
}

export class ModerationService {
  private wordFilters: WordFilter[] = [];
  private patterns: RegExp[] = [];

  constructor() {
    this.initializeFilters();
  }

  async moderateContent(content: string): Promise<ModerationResult> {
    const normalizedContent = content.toLowerCase().trim();
    
    // Check for profanity
    const profanityCheck = this.checkProfanity(normalizedContent);
    if (profanityCheck.found) {
      return {
        blocked: profanityCheck.severity === 'high',
        flagged: true,
        reason: 'Inappropriate language',
        severity: profanityCheck.severity,
        categories: ['profanity'],
      };
    }

    // Check for personal information
    const piiCheck = this.checkPII(content);
    if (piiCheck.found) {
      return {
        blocked: false,
        flagged: true,
        reason: 'Contains personal information',
        severity: 'medium',
        categories: piiCheck.categories,
      };
    }

    // Check for spam patterns
    const spamCheck = this.checkSpam(normalizedContent);
    if (spamCheck.found) {
      return {
        blocked: true,
        flagged: true,
        reason: 'Spam detected',
        severity: 'medium',
        categories: ['spam'],
      };
    }

    // Check for harassment
    const harassmentCheck = this.checkHarassment(normalizedContent);
    if (harassmentCheck.found) {
      return {
        blocked: true,
        flagged: true,
        reason: 'Harassment detected',
        severity: 'high',
        categories: ['harassment'],
      };
    }

    // Check for unsafe content
    const unsafeCheck = await this.checkUnsafeContent(content);
    if (unsafeCheck.found) {
      return {
        blocked: unsafeCheck.severity === 'high',
        flagged: true,
        reason: unsafeCheck.reason,
        severity: unsafeCheck.severity,
        categories: unsafeCheck.categories,
      };
    }

    return {
      blocked: false,
      flagged: false,
    };
  }

  private initializeFilters() {
    // Initialize word filters
    // In production, these would be loaded from a database
    this.wordFilters = [
      // Add common profanity and inappropriate terms
      { word: 'badword1', severity: 'high', action: 'block' },
      { word: 'badword2', severity: 'medium', action: 'flag' },
      // ... more filters
    ];

    // Initialize regex patterns for various checks
    this.patterns = [
      // Phone numbers
      /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
      // Email addresses
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
      // Social Security Numbers
      /\b\d{3}-\d{2}-\d{4}\b/g,
      // Credit card patterns
      /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    ];
  }

  private checkProfanity(content: string): { found: boolean; severity: 'low' | 'medium' | 'high' } {
    let highestSeverity: 'low' | 'medium' | 'high' = 'low';
    let found = false;

    for (const filter of this.wordFilters) {
      if (content.includes(filter.word)) {
        found = true;
        if (filter.severity === 'high') {
          return { found: true, severity: 'high' };
        }
        if (filter.severity === 'medium' && highestSeverity === 'low') {
          highestSeverity = 'medium';
        }
      }
    }

    return { found, severity: highestSeverity };
  }

  private checkPII(content: string): { found: boolean; categories: string[] } {
    const categories: string[] = [];

    // Check for phone numbers
    if (/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/.test(content)) {
      categories.push('phone_number');
    }

    // Check for email addresses
    if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/i.test(content)) {
      categories.push('email');
    }

    // Check for SSN
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(content)) {
      categories.push('ssn');
    }

    // Check for credit card
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(content)) {
      categories.push('credit_card');
    }

    // Check for addresses
    if (/\b\d+\s+[A-Za-z\s]+\s+(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr)\b/i.test(content)) {
      categories.push('address');
    }

    return {
      found: categories.length > 0,
      categories,
    };
  }

  private checkSpam(content: string): { found: boolean } {
    const spamIndicators = [
      // Excessive caps
      content.length > 10 && content === content.toUpperCase(),
      // Repeated characters
      /(.)\1{5,}/.test(content),
      // Multiple exclamation marks
      /!{4,}/.test(content),
      // Common spam phrases
      /(click here|buy now|limited time|act now|free money)/i.test(content),
      // Suspicious URLs
      /bit\.ly|tinyurl|short\.link/i.test(content),
    ];

    const indicatorCount = spamIndicators.filter(Boolean).length;
    return { found: indicatorCount >= 2 };
  }

  private checkHarassment(content: string): { found: boolean } {
    const harassmentPatterns = [
      // Threats
      /(kill|hurt|harm|attack)\s+(you|your|u|ur)/i,
      // Hate speech indicators
      /\b(hate|despise|disgusting)\s+(you|people|them)\b/i,
      // Repeated harassment
      /(leave me alone|stop messaging|harassment|stalking)/i,
    ];

    return {
      found: harassmentPatterns.some(pattern => pattern.test(content)),
    };
  }

  private async checkUnsafeContent(content: string): Promise<{
    found: boolean;
    reason?: string;
    severity?: 'low' | 'medium' | 'high';
    categories?: string[];
  }> {
    // This would integrate with external moderation APIs
    // (Google Perspective API, Azure Content Moderator, etc.)
    
    // For now, check for basic unsafe patterns
    const unsafePatterns = [
      { pattern: /\b(drugs|cocaine|heroin|meth)\b/i, category: 'drugs', severity: 'high' as const },
      { pattern: /\b(weapon|gun|knife|bomb)\b/i, category: 'weapons', severity: 'high' as const },
      { pattern: /\b(scam|fraud|steal)\b/i, category: 'fraud', severity: 'medium' as const },
    ];

    for (const { pattern, category, severity } of unsafePatterns) {
      if (pattern.test(content)) {
        return {
          found: true,
          reason: `Unsafe content detected: ${category}`,
          severity,
          categories: [category],
        };
      }
    }

    return { found: false };
  }

  async reportContent(params: {
    messageId: string;
    reporterId: string;
    reason: string;
    details?: string;
  }): Promise<void> {
    // Store report for manual review
    logger.info('Content reported:', params);
    
    // This would create a report in the database
    // and notify moderators
  }

  async reviewFlaggedContent(messageId: string, action: 'approve' | 'block' | 'delete'): Promise<void> {
    logger.info(`Reviewing message ${messageId}: ${action}`);
    
    // This would update the message status
    // and potentially take action against the user
  }
}