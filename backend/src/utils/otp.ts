/**
 * OTP (One-Time Password) Utility Functions
 */

import * as crypto from 'crypto';

/**
 * Generate OTP
 * @param length Length of OTP (default: 6)
 * @returns OTP string
 */
export function generateOTP(length: number = 6): string {
  const digits = '0123456789';
  let otp = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, digits.length);
    otp += digits[randomIndex];
  }
  
  return otp;
}

/**
 * Generate alphanumeric OTP
 * @param length Length of OTP (default: 8)
 * @returns Alphanumeric OTP string
 */
export function generateAlphanumericOTP(length: number = 8): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let otp = '';
  
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, chars.length);
    otp += chars[randomIndex];
  }
  
  return otp;
}

/**
 * Verify OTP (simple comparison)
 * In production, use a more sophisticated OTP library with time-based validation
 */
export function verifyOTP(inputOTP: string, storedOTP: string): boolean {
  return inputOTP === storedOTP;
}

/**
 * Generate TOTP secret
 */
export function generateTOTPSecret(): string {
  return crypto.randomBytes(32).toString('base64');
}