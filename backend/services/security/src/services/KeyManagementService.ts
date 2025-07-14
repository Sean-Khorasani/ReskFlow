import crypto from 'crypto';
import { EncryptionKey, KeyType, KeyRotationResult } from '../types/security.types';
import { generateEncryptionKey, generateUUID, secureErase } from '../utils/crypto';
import { logKeyRotation, logConfigChange } from '../utils/logger';
import { config, redis } from '@reskflow/shared';

export class KeyManagementService {
  private keys: Map<string, Buffer> = new Map();
  private keyMetadata: Map<string, EncryptionKey> = new Map();
  private masterKey: Buffer | null = null;
  private initialized = false;

  /**
   * Initialize the key management service
   */
  async initialize(): Promise<void> {
    try {
      // Load or generate master key
      await this.initializeMasterKey();
      
      // Load existing keys from secure storage
      await this.loadKeys();
      
      // Start key rotation scheduler
      this.startKeyRotationScheduler();
      
      this.initialized = true;
      logConfigChange('key_management', 'service_initialized', 'system');
    } catch (error) {
      throw new Error(`Failed to initialize KeyManagementService: ${error.message}`);
    }
  }

  /**
   * Initialize or load the master key
   */
  private async initializeMasterKey(): Promise<void> {
    const masterKeyId = 'master_key_v1';
    
    try {
      // Try to load existing master key from environment or secure storage
      const envMasterKey = process.env.MASTER_ENCRYPTION_KEY;
      
      if (envMasterKey) {
        this.masterKey = Buffer.from(envMasterKey, 'base64');
      } else {
        // Generate new master key
        this.masterKey = await generateEncryptionKey();
        
        // In production, this should be stored in a hardware security module (HSM)
        // or key management service like AWS KMS, Azure Key Vault, etc.
        console.warn('Generated new master key. In production, store this securely.');
        console.log('Master Key (base64):', this.masterKey.toString('base64'));
      }
      
      // Store master key metadata
      const masterKeyMetadata: EncryptionKey = {
        id: masterKeyId,
        type: 'master',
        algorithm: 'aes-256-gcm',
        keySize: 256,
        purpose: 'master_encryption',
        createdAt: new Date(),
        status: 'active',
        version: 1,
        metadata: {},
      };
      
      this.keyMetadata.set(masterKeyId, masterKeyMetadata);
      
    } catch (error) {
      throw new Error(`Failed to initialize master key: ${error.message}`);
    }
  }

  /**
   * Load existing keys from storage
   */
  private async loadKeys(): Promise<void> {
    try {
      // In production, keys should be loaded from secure storage
      // For now, generate default keys if they don't exist
      
      const defaultKeys: Array<{ type: KeyType; purpose: string }> = [
        { type: 'data_encryption', purpose: 'user_data_encryption' },
        { type: 'jwt_signing', purpose: 'jwt_token_signing' },
        { type: 'session', purpose: 'session_encryption' },
        { type: 'api_encryption', purpose: 'api_payload_encryption' },
        { type: 'backup_encryption', purpose: 'backup_data_encryption' },
      ];
      
      for (const keyConfig of defaultKeys) {
        const existingKey = await this.loadKeyFromStorage(keyConfig.type);
        
        if (!existingKey) {
          await this.generateKey(keyConfig.type, keyConfig.purpose);
        }
      }
      
    } catch (error) {
      throw new Error(`Failed to load keys: ${error.message}`);
    }
  }

  /**
   * Load a specific key from storage
   */
  private async loadKeyFromStorage(keyType: KeyType): Promise<EncryptionKey | null> {
    try {
      // Try to load from Redis cache first
      const cachedKey = await redis.get(`security:key:${keyType}`);
      
      if (cachedKey) {
        const keyData = JSON.parse(cachedKey);
        const key = Buffer.from(keyData.key, 'base64');
        
        this.keys.set(keyData.id, key);
        this.keyMetadata.set(keyData.id, keyData.metadata);
        
        return keyData.metadata;
      }
      
      return null;
    } catch (error) {
      console.warn(`Failed to load key ${keyType} from storage:`, error.message);
      return null;
    }
  }

  /**
   * Generate a new encryption key
   */
  async generateKey(type: KeyType, purpose: string): Promise<string> {
    if (!this.initialized) {
      throw new Error('KeyManagementService not initialized');
    }

    const keyId = generateUUID();
    const key = await generateEncryptionKey();
    
    const keyMetadata: EncryptionKey = {
      id: keyId,
      type,
      algorithm: 'aes-256-gcm',
      keySize: 256,
      purpose,
      createdAt: new Date(),
      status: 'active',
      version: 1,
      metadata: {},
    };
    
    // Store key and metadata
    this.keys.set(keyId, key);
    this.keyMetadata.set(keyId, keyMetadata);
    
    // Cache in Redis with expiration
    await this.storeKeyInCache(keyId, key, keyMetadata);
    
    logConfigChange('key_management', `generated_key_${type}`, 'system', {
      keyId,
      type,
      purpose,
    });
    
    return keyId;
  }

  /**
   * Get an encryption key by ID
   */
  getKey(keyId: string): Buffer | null {
    if (!this.initialized) {
      throw new Error('KeyManagementService not initialized');
    }

    return this.keys.get(keyId) || null;
  }

  /**
   * Get key metadata by ID
   */
  getKeyMetadata(keyId: string): EncryptionKey | null {
    if (!this.initialized) {
      throw new Error('KeyManagementService not initialized');
    }

    return this.keyMetadata.get(keyId) || null;
  }

  /**
   * Get the current active key for a specific type
   */
  getActiveKey(type: KeyType): { keyId: string; key: Buffer } | null {
    if (!this.initialized) {
      throw new Error('KeyManagementService not initialized');
    }

    // Find the most recent active key of the specified type
    let latestKey: EncryptionKey | null = null;
    let latestKeyId: string | null = null;
    
    for (const [keyId, metadata] of this.keyMetadata) {
      if (metadata.type === type && metadata.status === 'active') {
        if (!latestKey || metadata.createdAt > latestKey.createdAt) {
          latestKey = metadata;
          latestKeyId = keyId;
        }
      }
    }
    
    if (latestKeyId && latestKey) {
      const key = this.keys.get(latestKeyId);
      if (key) {
        return { keyId: latestKeyId, key };
      }
    }
    
    return null;
  }

  /**
   * Rotate an encryption key
   */
  async rotateKey(type: KeyType): Promise<KeyRotationResult> {
    if (!this.initialized) {
      throw new Error('KeyManagementService not initialized');
    }

    try {
      const currentKey = this.getActiveKey(type);
      
      if (!currentKey) {
        throw new Error(`No active key found for type: ${type}`);
      }
      
      // Generate new key
      const newKeyId = await this.generateKey(type, `rotated_${type}_key`);
      
      // Mark old key as deprecated
      const oldMetadata = this.keyMetadata.get(currentKey.keyId);
      if (oldMetadata) {
        oldMetadata.status = 'deprecated';
        oldMetadata.rotatedAt = new Date();
        this.keyMetadata.set(currentKey.keyId, oldMetadata);
      }
      
      const result: KeyRotationResult = {
        oldKeyId: currentKey.keyId,
        newKeyId,
        rotatedAt: new Date(),
        status: 'success',
      };
      
      logKeyRotation(type, newKeyId, true, {
        oldKeyId: currentKey.keyId,
        newKeyId,
      });
      
      return result;
      
    } catch (error) {
      logKeyRotation(type, '', false, { error: error.message });
      
      return {
        oldKeyId: '',
        newKeyId: '',
        rotatedAt: new Date(),
        status: 'failed',
        errors: [error.message],
      };
    }
  }

  /**
   * Revoke a key (mark as revoked and remove from active use)
   */
  async revokeKey(keyId: string, reason: string): Promise<void> {
    if (!this.initialized) {
      throw new Error('KeyManagementService not initialized');
    }

    const metadata = this.keyMetadata.get(keyId);
    
    if (!metadata) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    // Mark as revoked
    metadata.status = 'revoked';
    metadata.metadata.revokedAt = new Date();
    metadata.metadata.revocationReason = reason;
    
    this.keyMetadata.set(keyId, metadata);
    
    // Remove from cache
    await redis.del(`security:key:${metadata.type}`);
    
    logConfigChange('key_management', 'key_revoked', 'system', {
      keyId,
      type: metadata.type,
      reason,
    });
  }

  /**
   * Get all keys with their metadata
   */
  getAllKeys(): Array<{ keyId: string; metadata: EncryptionKey }> {
    if (!this.initialized) {
      throw new Error('KeyManagementService not initialized');
    }

    const result: Array<{ keyId: string; metadata: EncryptionKey }> = [];
    
    for (const [keyId, metadata] of this.keyMetadata) {
      result.push({ keyId, metadata });
    }
    
    return result.sort((a, b) => b.metadata.createdAt.getTime() - a.metadata.createdAt.getTime());
  }

  /**
   * Store key in cache
   */
  private async storeKeyInCache(keyId: string, key: Buffer, metadata: EncryptionKey): Promise<void> {
    try {
      const keyData = {
        id: keyId,
        key: key.toString('base64'),
        metadata,
      };
      
      // Store with 24 hour expiration
      await redis.setex(`security:key:${metadata.type}`, 86400, JSON.stringify(keyData));
      
    } catch (error) {
      console.warn('Failed to cache key:', error.message);
    }
  }

  /**
   * Start automatic key rotation scheduler
   */
  private startKeyRotationScheduler(): void {
    const rotationInterval = 24 * 60 * 60 * 1000; // 24 hours
    
    setInterval(async () => {
      try {
        await this.performScheduledRotations();
      } catch (error) {
        console.error('Scheduled key rotation failed:', error.message);
      }
    }, rotationInterval);
  }

  /**
   * Perform scheduled key rotations
   */
  private async performScheduledRotations(): Promise<void> {
    const rotationPolicies = new Map([
      ['session', 7], // Session keys rotate weekly
      ['jwt_signing', 30], // JWT keys rotate monthly
      ['data_encryption', 90], // Data encryption keys rotate quarterly
    ]);
    
    for (const [keyType, rotationDays] of rotationPolicies) {
      const activeKey = this.getActiveKey(keyType as KeyType);
      
      if (activeKey) {
        const metadata = this.keyMetadata.get(activeKey.keyId);
        if (metadata) {
          const daysSinceCreation = Math.floor(
            (Date.now() - metadata.createdAt.getTime()) / (24 * 60 * 60 * 1000)
          );
          
          if (daysSinceCreation >= rotationDays) {
            await this.rotateKey(keyType as KeyType);
          }
        }
      }
    }
  }

  /**
   * Clean up expired and revoked keys
   */
  async cleanup(): Promise<void> {
    try {
      // Securely erase keys from memory
      for (const [keyId, key] of this.keys) {
        secureErase(key);
      }
      
      // Clear key storage
      this.keys.clear();
      this.keyMetadata.clear();
      
      // Securely erase master key
      if (this.masterKey) {
        secureErase(this.masterKey);
        this.masterKey = null;
      }
      
      this.initialized = false;
      
      logConfigChange('key_management', 'service_cleanup', 'system');
      
    } catch (error) {
      console.error('Key cleanup failed:', error.message);
    }
  }

  /**
   * Export key for backup (encrypted with master key)
   */
  async exportKey(keyId: string): Promise<string> {
    if (!this.initialized || !this.masterKey) {
      throw new Error('KeyManagementService not properly initialized');
    }

    const key = this.keys.get(keyId);
    const metadata = this.keyMetadata.get(keyId);
    
    if (!key || !metadata) {
      throw new Error(`Key not found: ${keyId}`);
    }
    
    // Encrypt key with master key for export
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher('aes-256-gcm', this.masterKey);
    
    let encrypted = cipher.update(key.toString('base64'), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    const exportData = {
      keyId,
      metadata,
      encryptedKey: encrypted,
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      exportedAt: new Date(),
    };
    
    return Buffer.from(JSON.stringify(exportData)).toString('base64');
  }

  /**
   * Import key from backup (decrypt with master key)
   */
  async importKey(exportedKeyData: string): Promise<string> {
    if (!this.initialized || !this.masterKey) {
      throw new Error('KeyManagementService not properly initialized');
    }

    try {
      const exportData = JSON.parse(Buffer.from(exportedKeyData, 'base64').toString('utf8'));
      
      const iv = Buffer.from(exportData.iv, 'hex');
      const tag = Buffer.from(exportData.tag, 'hex');
      
      const decipher = crypto.createDecipher('aes-256-gcm', this.masterKey);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(exportData.encryptedKey, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const key = Buffer.from(decrypted, 'base64');
      
      // Generate new key ID for imported key
      const newKeyId = generateUUID();
      const metadata = {
        ...exportData.metadata,
        id: newKeyId,
        createdAt: new Date(),
        metadata: {
          ...exportData.metadata.metadata,
          importedAt: new Date(),
          originalKeyId: exportData.keyId,
        },
      };
      
      this.keys.set(newKeyId, key);
      this.keyMetadata.set(newKeyId, metadata);
      
      logConfigChange('key_management', 'key_imported', 'system', {
        newKeyId,
        originalKeyId: exportData.keyId,
        type: metadata.type,
      });
      
      return newKeyId;
      
    } catch (error) {
      throw new Error(`Failed to import key: ${error.message}`);
    }
  }

  /**
   * Get key rotation schedule
   */
  getRotationSchedule(): Array<{ keyType: KeyType; lastRotation: Date; nextRotation: Date }> {
    const schedule: Array<{ keyType: KeyType; lastRotation: Date; nextRotation: Date }> = [];
    
    const rotationPolicies = new Map([
      ['session', 7],
      ['jwt_signing', 30],
      ['data_encryption', 90],
    ]);
    
    for (const [keyType, rotationDays] of rotationPolicies) {
      const activeKey = this.getActiveKey(keyType as KeyType);
      
      if (activeKey) {
        const metadata = this.keyMetadata.get(activeKey.keyId);
        if (metadata) {
          const lastRotation = metadata.rotatedAt || metadata.createdAt;
          const nextRotation = new Date(lastRotation.getTime() + (rotationDays * 24 * 60 * 60 * 1000));
          
          schedule.push({
            keyType: keyType as KeyType,
            lastRotation,
            nextRotation,
          });
        }
      }
    }
    
    return schedule;
  }
}