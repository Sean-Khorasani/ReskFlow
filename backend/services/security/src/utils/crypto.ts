import crypto from 'crypto';
import { promisify } from 'util';
import { CryptoConfig } from '../types/security.types';

const randomBytes = promisify(crypto.randomBytes);
const scrypt = promisify(crypto.scrypt);

export const CRYPTO_CONFIG: CryptoConfig = {
  algorithm: 'aes-256-gcm',
  keyDerivation: {
    iterations: 100000,
    saltLength: 32,
    keyLength: 32,
  },
  encryption: {
    keySize: 32,
    ivLength: 16,
    tagLength: 16,
  },
};

/**
 * Generate cryptographically secure random bytes
 */
export async function generateRandomBytes(length: number): Promise<Buffer> {
  return await randomBytes(length);
}

/**
 * Generate a cryptographically secure random string
 */
export async function generateRandomString(length: number): Promise<string> {
  const bytes = await generateRandomBytes(Math.ceil(length / 2));
  return bytes.toString('hex').slice(0, length);
}

/**
 * Generate a secure salt for key derivation
 */
export async function generateSalt(): Promise<Buffer> {
  return await generateRandomBytes(CRYPTO_CONFIG.keyDerivation.saltLength);
}

/**
 * Derive a key from a password using PBKDF2
 */
export async function deriveKey(
  password: string,
  salt: Buffer,
  iterations?: number,
  keyLength?: number
): Promise<Buffer> {
  const iter = iterations || CRYPTO_CONFIG.keyDerivation.iterations;
  const length = keyLength || CRYPTO_CONFIG.keyDerivation.keyLength;
  
  return (await scrypt(password, salt, length)) as Buffer;
}

/**
 * Generate a secure encryption key
 */
export async function generateEncryptionKey(): Promise<Buffer> {
  return await generateRandomBytes(CRYPTO_CONFIG.encryption.keySize);
}

/**
 * Generate an initialization vector for encryption
 */
export async function generateIV(): Promise<Buffer> {
  return await generateRandomBytes(CRYPTO_CONFIG.encryption.ivLength);
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data: string, key: Buffer, iv: Buffer): {
  encrypted: string;
  tag: string;
} {
  const cipher = crypto.createCipherGCM('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  return {
    encrypted,
    tag: tag.toString('hex'),
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(
  encryptedData: string,
  key: Buffer,
  iv: Buffer,
  tag: string
): string {
  const decipher = crypto.createDecipherGCM('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Hash a password using Argon2 (secure alternative)
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Verify a password against its hash
 */
export function verifyPassword(password: string, hashedPassword: string): boolean {
  const [salt, hash] = hashedPassword.split(':');
  const saltBuffer = Buffer.from(salt, 'hex');
  const hashBuffer = Buffer.from(hash, 'hex');
  
  const computedHash = crypto.pbkdf2Sync(password, saltBuffer, 100000, 64, 'sha512');
  
  return crypto.timingSafeEqual(hashBuffer, computedHash);
}

/**
 * Generate a secure token for API keys, session IDs, etc.
 */
export async function generateSecureToken(length = 32): Promise<string> {
  const bytes = await generateRandomBytes(length);
  return bytes.toString('base64url');
}

/**
 * Create HMAC signature for data integrity
 */
export function createHMAC(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify HMAC signature
 */
export function verifyHMAC(data: string, secret: string, signature: string): boolean {
  const computedSignature = createHMAC(data, secret);
  return crypto.timingSafeEqual(
    Buffer.from(computedSignature, 'hex'),
    Buffer.from(signature, 'hex')
  );
}

/**
 * Generate a key pair for asymmetric encryption
 */
export function generateKeyPair(): {
  publicKey: string;
  privateKey: string;
} {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });
  
  return { publicKey, privateKey };
}

/**
 * Encrypt data with RSA public key
 */
export function rsaEncrypt(data: string, publicKey: string): string {
  const buffer = Buffer.from(data, 'utf8');
  const encrypted = crypto.publicEncrypt(publicKey, buffer);
  return encrypted.toString('base64');
}

/**
 * Decrypt data with RSA private key
 */
export function rsaDecrypt(encryptedData: string, privateKey: string): string {
  const buffer = Buffer.from(encryptedData, 'base64');
  const decrypted = crypto.privateDecrypt(privateKey, buffer);
  return decrypted.toString('utf8');
}

/**
 * Calculate hash of data for integrity checking
 */
export function calculateHash(data: string, algorithm = 'sha256'): string {
  return crypto.createHash(algorithm).update(data).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  
  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Secure random number generation
 */
export function secureRandom(min: number, max: number): number {
  const range = max - min + 1;
  const bytesNeeded = Math.ceil(Math.log2(range) / 8);
  const maxValue = Math.pow(256, bytesNeeded) - 1;
  const threshold = maxValue - (maxValue % range);
  
  let randomValue;
  do {
    const randomBytes = crypto.randomBytes(bytesNeeded);
    randomValue = randomBytes.readUIntBE(0, bytesNeeded);
  } while (randomValue >= threshold);
  
  return min + (randomValue % range);
}

/**
 * Key stretching function for additional security
 */
export async function stretchKey(key: Buffer, salt: Buffer, iterations = 10000): Promise<Buffer> {
  let stretchedKey = key;
  
  for (let i = 0; i < iterations; i++) {
    const hash = crypto.createHash('sha256');
    hash.update(stretchedKey);
    hash.update(salt);
    stretchedKey = hash.digest();
  }
  
  return stretchedKey;
}

/**
 * Secure key erasure (overwrite memory)
 */
export function secureErase(buffer: Buffer): void {
  if (buffer && buffer.length > 0) {
    crypto.randomFillSync(buffer);
    buffer.fill(0);
  }
}