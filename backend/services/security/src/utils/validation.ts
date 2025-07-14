import { ValidationRule, ValidationResult, ValidationError, PasswordValidation } from '../types/security.types';

/**
 * Validate input data against a set of rules
 */
export function validate(data: Record<string, any>, rules: Record<string, ValidationRule[]>): ValidationResult {
  const errors: ValidationError[] = [];
  
  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = data[field];
    
    for (const rule of fieldRules) {
      const error = validateField(field, value, rule);
      if (error) {
        errors.push(error);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a single field against a rule
 */
function validateField(field: string, value: any, rule: ValidationRule): ValidationError | null {
  switch (rule.type) {
    case 'required':
      if (value === undefined || value === null || value === '') {
        return { field, message: rule.message, value };
      }
      break;
      
    case 'length':
      if (typeof value === 'string') {
        const { min, max } = rule.params || {};
        if (min && value.length < min) {
          return { field, message: rule.message, value };
        }
        if (max && value.length > max) {
          return { field, message: rule.message, value };
        }
      }
      break;
      
    case 'pattern':
      if (typeof value === 'string' && rule.params?.pattern) {
        const regex = new RegExp(rule.params.pattern);
        if (!regex.test(value)) {
          return { field, message: rule.message, value };
        }
      }
      break;
      
    case 'custom':
      if (rule.params?.validator && typeof rule.params.validator === 'function') {
        const isValid = rule.params.validator(value);
        if (!isValid) {
          return { field, message: rule.message, value };
        }
      }
      break;
  }
  
  return null;
}

/**
 * Sanitize user input to prevent XSS and other attacks
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input
    .replace(/[<>]/g, '') // Remove < and > to prevent HTML injection
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .replace(/script/gi, '') // Remove script tags
    .trim();
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate IP address format
 */
export function isValidIP(ip: string): boolean {
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}

/**
 * Validate URL format
 */
export function isValidURL(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): PasswordValidation {
  const requirements = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumbers: /\d/.test(password),
    hasSpecialChars: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password),
    notCommon: !isCommonPassword(password),
  };
  
  const score = calculatePasswordScore(password, requirements);
  const feedback = generatePasswordFeedback(requirements);
  
  return {
    valid: Object.values(requirements).every(req => req),
    score,
    feedback,
    requirements,
  };
}

/**
 * Calculate password strength score (0-100)
 */
function calculatePasswordScore(password: string, requirements: any): number {
  let score = 0;
  
  // Length bonus
  score += Math.min(password.length * 4, 40);
  
  // Character variety bonus
  if (requirements.hasUppercase) score += 10;
  if (requirements.hasLowercase) score += 10;
  if (requirements.hasNumbers) score += 10;
  if (requirements.hasSpecialChars) score += 15;
  
  // Common password penalty
  if (!requirements.notCommon) score -= 30;
  
  // Repetition penalty
  const repetitionPenalty = calculateRepetitionPenalty(password);
  score -= repetitionPenalty;
  
  return Math.max(0, Math.min(100, score));
}

/**
 * Generate password feedback messages
 */
function generatePasswordFeedback(requirements: any): string[] {
  const feedback: string[] = [];
  
  if (!requirements.minLength) {
    feedback.push('Password must be at least 8 characters long');
  }
  if (!requirements.hasUppercase) {
    feedback.push('Password must contain at least one uppercase letter');
  }
  if (!requirements.hasLowercase) {
    feedback.push('Password must contain at least one lowercase letter');
  }
  if (!requirements.hasNumbers) {
    feedback.push('Password must contain at least one number');
  }
  if (!requirements.hasSpecialChars) {
    feedback.push('Password must contain at least one special character');
  }
  if (!requirements.notCommon) {
    feedback.push('Password is too common, please choose a more unique password');
  }
  
  return feedback;
}

/**
 * Check if password is in common passwords list
 */
function isCommonPassword(password: string): boolean {
  const commonPasswords = [
    'password', '123456', '123456789', 'qwerty', 'abc123',
    'password123', 'admin', 'letmein', 'welcome', 'monkey',
    'dragon', 'master', 'shadow', 'football', 'baseball',
    'superman', 'michael', 'jordan', 'princess', 'sunshine',
  ];
  
  return commonPasswords.includes(password.toLowerCase());
}

/**
 * Calculate repetition penalty for password
 */
function calculateRepetitionPenalty(password: string): number {
  let penalty = 0;
  let consecutiveCount = 1;
  
  for (let i = 1; i < password.length; i++) {
    if (password[i] === password[i - 1]) {
      consecutiveCount++;
    } else {
      if (consecutiveCount > 2) {
        penalty += consecutiveCount * 2;
      }
      consecutiveCount = 1;
    }
  }
  
  if (consecutiveCount > 2) {
    penalty += consecutiveCount * 2;
  }
  
  return penalty;
}

/**
 * Validate UUID format
 */
export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate session ID format
 */
export function isValidSessionId(sessionId: string): boolean {
  // Session ID should be alphanumeric and 32-64 characters long
  const sessionRegex = /^[a-zA-Z0-9]{32,64}$/;
  return sessionRegex.test(sessionId);
}

/**
 * Validate API key format
 */
export function isValidApiKey(apiKey: string): boolean {
  // API key should start with a prefix and be base64url encoded
  const apiKeyRegex = /^reskflow_[a-zA-Z0-9_-]{32,}$/;
  return apiKeyRegex.test(apiKey);
}

/**
 * Escape SQL injection characters
 */
export function escapeSql(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }
  
  return input.replace(/'/g, "''").replace(/;/g, '');
}

/**
 * Validate MongoDB ObjectId format
 */
export function isValidObjectId(id: string): boolean {
  const objectIdRegex = /^[0-9a-fA-F]{24}$/;
  return objectIdRegex.test(id);
}

/**
 * Validate JSON Web Token format
 */
export function isValidJWT(token: string): boolean {
  const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
  return jwtRegex.test(token);
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
  return phoneRegex.test(phone.replace(/[\s-().]/g, ''));
}

/**
 * Validate credit card number format (Luhn algorithm)
 */
export function isValidCreditCard(cardNumber: string): boolean {
  const cleanedNumber = cardNumber.replace(/\D/g, '');
  
  if (cleanedNumber.length < 13 || cleanedNumber.length > 19) {
    return false;
  }
  
  let sum = 0;
  let alternate = false;
  
  for (let i = cleanedNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cleanedNumber[i]);
    
    if (alternate) {
      digit *= 2;
      if (digit > 9) {
        digit = digit % 10 + 1;
      }
    }
    
    sum += digit;
    alternate = !alternate;
  }
  
  return sum % 10 === 0;
}

/**
 * Validate file extension against allowed list
 */
export function isAllowedFileExtension(filename: string, allowedExtensions: string[]): boolean {
  const extension = filename.toLowerCase().split('.').pop();
  return extension ? allowedExtensions.includes(extension) : false;
}

/**
 * Validate file size
 */
export function isValidFileSize(fileSize: number, maxSizeMB: number): boolean {
  const maxSizeBytes = maxSizeMB * 1024 * 1024;
  return fileSize <= maxSizeBytes;
}

/**
 * Normalize and validate user input
 */
export function normalizeInput(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Check for suspicious patterns in input
 */
export function containsSuspiciousPatterns(input: string): boolean {
  const suspiciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,
    /union\s+select/i,
    /drop\s+table/i,
    /delete\s+from/i,
    /insert\s+into/i,
    /update\s+set/i,
    /%27|%22|%3C|%3E/i, // URL encoded quotes and brackets
  ];
  
  return suspiciousPatterns.some(pattern => pattern.test(input));
}