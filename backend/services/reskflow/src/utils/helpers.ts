import crypto from 'crypto';
import { InvalidLocationError, ValidationError } from './errors';

// Distance calculation using Haversine formula
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return Math.round(distance * 100) / 100; // Round to 2 decimal places
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// Generate unique reskflow number
export function generateDeliveryNumber(): string {
  const timestamp = Date.now().toString();
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `DEL-${timestamp.slice(-8)}-${random}`;
}

// Generate tracking number
export function generateTrackingNumber(): string {
  const timestamp = Date.now().toString();
  const random = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `TRK-${timestamp.slice(-6)}-${random}`;
}

// Generate driver code
export function generateDriverCode(): string {
  const timestamp = Date.now().toString();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `DRV-${timestamp.slice(-6)}-${random}`;
}

// Validate coordinates
export function validateCoordinates(lat: number, lon: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !isNaN(lat) &&
    !isNaN(lon)
  );
}

// Format coordinates
export function formatCoordinates(lat: number, lon: number): string {
  if (!validateCoordinates(lat, lon)) {
    throw new InvalidLocationError(`Invalid coordinates: ${lat}, ${lon}`);
  }
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
}

// Parse coordinates from string
export function parseCoordinates(coordString: string): { lat: number; lon: number } {
  const coords = coordString.split(',').map(coord => parseFloat(coord.trim()));
  
  if (coords.length !== 2 || coords.some(isNaN)) {
    throw new InvalidLocationError(`Invalid coordinate string: ${coordString}`);
  }

  const [lat, lon] = coords;
  
  if (!validateCoordinates(lat, lon)) {
    throw new InvalidLocationError(`Invalid coordinates: ${lat}, ${lon}`);
  }

  return { lat, lon };
}

// Calculate estimated reskflow time based on distance
export function calculateEstimatedDeliveryTime(distanceKm: number): number {
  // Base time: 15 minutes
  // Additional time: 2 minutes per km
  // Traffic factor: 1.2x
  const baseTime = 15;
  const timePerKm = 2;
  const trafficFactor = 1.2;
  
  const estimatedTime = (baseTime + (distanceKm * timePerKm)) * trafficFactor;
  return Math.ceil(estimatedTime);
}

// Calculate reskflow fee based on distance
export function calculateDeliveryFee(distanceKm: number, baseRate: number = 2.50): number {
  const perKmRate = 0.50;
  const fee = baseRate + (distanceKm * perKmRate);
  return Math.round(fee * 100) / 100; // Round to 2 decimal places
}

// Check if reskflow is within service area
export function isWithinServiceArea(
  lat: number,
  lon: number,
  centerLat: number,
  centerLon: number,
  radiusKm: number
): boolean {
  if (!validateCoordinates(lat, lon) || !validateCoordinates(centerLat, centerLon)) {
    return false;
  }

  const distance = calculateDistance(lat, lon, centerLat, centerLon);
  return distance <= radiusKm;
}

// Format address for display
export function formatAddress(address: {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}): string {
  const parts = [
    address.street,
    address.city,
    address.state,
    address.zipCode,
    address.country,
  ].filter(Boolean);

  return parts.join(', ');
}

// Validate phone number (basic international format)
export function validatePhoneNumber(phone: string): boolean {
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
  return phoneRegex.test(phone);
}

// Format phone number
export function formatPhoneNumber(phone: string): string {
  const cleanPhone = phone.replace(/\D/g, '');
  
  if (cleanPhone.length === 10) {
    return `(${cleanPhone.slice(0, 3)}) ${cleanPhone.slice(3, 6)}-${cleanPhone.slice(6)}`;
  } else if (cleanPhone.length === 11 && cleanPhone.startsWith('1')) {
    return `+1 (${cleanPhone.slice(1, 4)}) ${cleanPhone.slice(4, 7)}-${cleanPhone.slice(7)}`;
  }
  
  return phone;
}

// Generate OTP
export function generateOTP(length: number = 6): string {
  const digits = '0123456789';
  let otp = '';
  
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  
  return otp;
}

// Validate OTP
export function validateOTP(otp: string, expectedLength: number = 6): boolean {
  return /^\d+$/.test(otp) && otp.length === expectedLength;
}

// Generate secure random string
export function generateSecureRandom(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

// Hash sensitive data
export function hashData(data: string, salt?: string): string {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256');
  hash.update(data + actualSalt);
  return hash.digest('hex');
}

// Time utilities
export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3600000);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  
  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }
  
  return `${hours} hr ${remainingMinutes} min`;
}

// Array utilities
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return array.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {} as Record<string, T[]>);
}

// Pagination utilities
export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export function validatePagination(page: number, limit: number): void {
  if (!Number.isInteger(page) || page < 1) {
    throw new ValidationError('Page must be a positive integer');
  }
  
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('Limit must be a positive integer between 1 and 100');
  }
}

export function calculatePagination(
  page: number,
  limit: number,
  total: number
): PaginatedResult<any>['pagination'] {
  validatePagination(page, limit);
  
  const totalPages = Math.ceil(total / limit);
  
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

// Rate limiting utilities
export function createRateLimitKey(identifier: string, window: string): string {
  return `rate_limit:${identifier}:${window}`;
}

export function getRateLimitWindow(windowSizeMinutes: number): string {
  const now = new Date();
  const windowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    Math.floor(now.getMinutes() / windowSizeMinutes) * windowSizeMinutes
  );
  return windowStart.toISOString();
}

// Retry utilities
export interface RetryOptions {
  maxAttempts: number;
  delayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions
): Promise<T> {
  let lastError: Error;
  let delay = options.delayMs;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === options.maxAttempts) {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * options.backoffMultiplier, options.maxDelayMs);
    }
  }

  throw lastError!;
}

// Validation utilities
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function isValidUUID(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export function sanitizeString(str: string): string {
  return str.trim().replace(/[<>]/g, '');
}

// Deep clone utility
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as unknown as T;
  }
  
  const cloned = {} as T;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}