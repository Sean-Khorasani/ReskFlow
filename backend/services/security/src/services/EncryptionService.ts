import crypto from 'crypto';
import { 
  EncryptedData, 
  EncryptionContext, 
  DecryptionResult, 
  KeyType 
} from '../types/security.types';
import { KeyManagementService } from './KeyManagementService';
import { 
  generateIV, 
  encrypt, 
  decrypt, 
  generateUUID, 
  createHMAC, 
  verifyHMAC 
} from '../utils/crypto';
import { logDataAccess, logConfigChange } from '../utils/logger';
import correlationId from 'correlation-id';

export class EncryptionService {
  private keyManagementService: KeyManagementService;
  private encryptionMetrics: Map<string, number> = new Map();

  constructor(keyManagementService: KeyManagementService) {
    this.keyManagementService = keyManagementService;
    this.initializeMetrics();
  }

  /**
   * Initialize encryption metrics tracking
   */
  private initializeMetrics(): void {
    this.encryptionMetrics.set('total_encryptions', 0);
    this.encryptionMetrics.set('total_decryptions', 0);
    this.encryptionMetrics.set('failed_encryptions', 0);
    this.encryptionMetrics.set('failed_decryptions', 0);
  }

  /**
   * Encrypt data with context and metadata
   */
  async encryptData(
    data: string,
    context: EncryptionContext,
    keyType: KeyType = 'data_encryption'
  ): Promise<EncryptedData> {
    try {
      // Get active encryption key
      const activeKey = this.keyManagementService.getActiveKey(keyType);
      if (!activeKey) {
        throw new Error(`No active encryption key found for type: ${keyType}`);
      }

      // Generate initialization vector
      const iv = await generateIV();

      // Create encryption context metadata
      const encryptionMetadata = {
        context,
        timestamp: new Date(),
        correlationId: correlationId.getId(),
        keyVersion: this.keyManagementService.getKeyMetadata(activeKey.keyId)?.version || 1,
      };

      // Combine data with metadata for authenticated encryption
      const dataWithMetadata = JSON.stringify({
        data,
        metadata: encryptionMetadata,
      });

      // Encrypt the data
      const encryptionResult = encrypt(dataWithMetadata, activeKey.key, iv);

      // Create integrity hash
      const integrityHash = createHMAC(
        `${encryptionResult.encrypted}${iv.toString('hex')}${encryptionResult.tag}`,
        activeKey.key.toString('hex')
      );

      const encryptedData: EncryptedData = {
        data: encryptionResult.encrypted,
        iv: iv.toString('hex'),
        tag: encryptionResult.tag,
        keyId: activeKey.keyId,
        algorithm: 'aes-256-gcm',
        timestamp: new Date(),
      };

      // Add integrity verification
      (encryptedData as any).integrity = integrityHash;

      // Update metrics
      this.encryptionMetrics.set(
        'total_encryptions',
        (this.encryptionMetrics.get('total_encryptions') || 0) + 1
      );

      // Log the encryption event
      logDataAccess(
        context.dataType,
        'encrypt',
        context.userId || 'system',
        'internal',
        true,
        {
          keyId: activeKey.keyId,
          keyType,
          dataSize: data.length,
          purpose: context.purpose,
        }
      );

      return encryptedData;

    } catch (error) {
      // Update failure metrics
      this.encryptionMetrics.set(
        'failed_encryptions',
        (this.encryptionMetrics.get('failed_encryptions') || 0) + 1
      );

      // Log the failed encryption
      logDataAccess(
        context.dataType,
        'encrypt',
        context.userId || 'system',
        'internal',
        false,
        { error: error.message }
      );

      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data and return with metadata
   */
  async decryptData(encryptedData: EncryptedData, context?: EncryptionContext): Promise<DecryptionResult> {
    try {
      // Verify the encrypted data structure
      this.validateEncryptedData(encryptedData);

      // Get the encryption key
      const key = this.keyManagementService.getKey(encryptedData.keyId);
      if (!key) {
        throw new Error(`Encryption key not found: ${encryptedData.keyId}`);
      }

      const keyMetadata = this.keyManagementService.getKeyMetadata(encryptedData.keyId);
      if (!keyMetadata) {
        throw new Error(`Key metadata not found: ${encryptedData.keyId}`);
      }

      // Verify key status
      if (keyMetadata.status === 'revoked') {
        throw new Error(`Cannot decrypt with revoked key: ${encryptedData.keyId}`);
      }

      // Verify integrity hash if present
      if ((encryptedData as any).integrity) {
        const expectedHash = createHMAC(
          `${encryptedData.data}${encryptedData.iv}${encryptedData.tag}`,
          key.toString('hex')
        );
        
        if (!verifyHMAC(
          `${encryptedData.data}${encryptedData.iv}${encryptedData.tag}`,
          key.toString('hex'),
          (encryptedData as any).integrity
        )) {
          throw new Error('Data integrity verification failed');
        }
      }

      // Decrypt the data
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const decryptedJson = decrypt(encryptedData.data, key, iv, encryptedData.tag);

      // Parse the decrypted data with metadata
      const { data, metadata } = JSON.parse(decryptedJson);

      // Validate context if provided
      if (context && metadata.context) {
        this.validateDecryptionContext(context, metadata.context);
      }

      // Check data retention policy
      if (metadata.context.retention) {
        const retentionExpiry = new Date(metadata.timestamp);
        retentionExpiry.setDate(retentionExpiry.getDate() + metadata.context.retention);
        
        if (new Date() > retentionExpiry) {
          throw new Error('Data has exceeded retention period and cannot be decrypted');
        }
      }

      // Update metrics
      this.encryptionMetrics.set(
        'total_decryptions',
        (this.encryptionMetrics.get('total_decryptions') || 0) + 1
      );

      // Log the decryption event
      logDataAccess(
        metadata.context.dataType,
        'decrypt',
        context?.userId || metadata.context.userId || 'system',
        'internal',
        true,
        {
          keyId: encryptedData.keyId,
          dataAge: Date.now() - new Date(metadata.timestamp).getTime(),
          purpose: metadata.context.purpose,
        }
      );

      return {
        data,
        metadata: {
          keyId: encryptedData.keyId,
          algorithm: encryptedData.algorithm,
          timestamp: new Date(metadata.timestamp),
          context: metadata.context,
        },
      };

    } catch (error) {
      // Update failure metrics
      this.encryptionMetrics.set(
        'failed_decryptions',
        (this.encryptionMetrics.get('failed_decryptions') || 0) + 1
      );

      // Log the failed decryption
      logDataAccess(
        'unknown',
        'decrypt',
        context?.userId || 'system',
        'internal',
        false,
        { error: error.message, keyId: encryptedData.keyId }
      );

      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt file data with streaming support for large files
   */
  async encryptFile(
    filePath: string,
    context: EncryptionContext,
    keyType: KeyType = 'data_encryption'
  ): Promise<{ encryptedPath: string; metadata: EncryptedData }> {
    const fs = require('fs').promises;
    const path = require('path');

    try {
      // Read file data
      const fileData = await fs.readFile(filePath);
      
      // Create encryption context for file
      const fileContext: EncryptionContext = {
        ...context,
        dataType: 'file',
        purpose: context.purpose || 'file_encryption',
      };

      // Encrypt file content
      const encryptedData = await this.encryptData(fileData.toString('base64'), fileContext, keyType);

      // Create encrypted file path
      const encryptedPath = `${filePath}.encrypted`;
      
      // Save encrypted file
      await fs.writeFile(encryptedPath, JSON.stringify(encryptedData), 'utf8');

      logDataAccess('file', 'encrypt_file', context.userId || 'system', 'internal', true, {
        originalPath: filePath,
        encryptedPath,
        fileSize: fileData.length,
      });

      return {
        encryptedPath,
        metadata: encryptedData,
      };

    } catch (error) {
      logDataAccess('file', 'encrypt_file', context.userId || 'system', 'internal', false, {
        filePath,
        error: error.message,
      });

      throw new Error(`File encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt file data
   */
  async decryptFile(encryptedPath: string, outputPath?: string, context?: EncryptionContext): Promise<string> {
    const fs = require('fs').promises;

    try {
      // Read encrypted file
      const encryptedFileData = await fs.readFile(encryptedPath, 'utf8');
      const encryptedData: EncryptedData = JSON.parse(encryptedFileData);

      // Decrypt file content
      const decryptionResult = await this.decryptData(encryptedData, context);
      const fileData = Buffer.from(decryptionResult.data, 'base64');

      // Determine output path
      const finalOutputPath = outputPath || encryptedPath.replace('.encrypted', '.decrypted');

      // Save decrypted file
      await fs.writeFile(finalOutputPath, fileData);

      logDataAccess('file', 'decrypt_file', context?.userId || 'system', 'internal', true, {
        encryptedPath,
        outputPath: finalOutputPath,
        fileSize: fileData.length,
      });

      return finalOutputPath;

    } catch (error) {
      logDataAccess('file', 'decrypt_file', context?.userId || 'system', 'internal', false, {
        encryptedPath,
        error: error.message,
      });

      throw new Error(`File decryption failed: ${error.message}`);
    }
  }

  /**
   * Encrypt multiple data items in batch
   */
  async encryptBatch(
    items: Array<{ data: string; context: EncryptionContext }>,
    keyType: KeyType = 'data_encryption'
  ): Promise<EncryptedData[]> {
    const results: EncryptedData[] = [];
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const encrypted = await this.encryptData(items[i].data, items[i].context, keyType);
        results.push(encrypted);
      } catch (error) {
        errors.push(`Item ${i}: ${error.message}`);
        results.push(null as any); // Placeholder for failed encryption
      }
    }

    if (errors.length > 0) {
      throw new Error(`Batch encryption completed with ${errors.length} errors: ${errors.join('; ')}`);
    }

    return results;
  }

  /**
   * Decrypt multiple data items in batch
   */
  async decryptBatch(
    items: Array<{ encryptedData: EncryptedData; context?: EncryptionContext }>
  ): Promise<DecryptionResult[]> {
    const results: DecryptionResult[] = [];
    const errors: string[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const decrypted = await this.decryptData(items[i].encryptedData, items[i].context);
        results.push(decrypted);
      } catch (error) {
        errors.push(`Item ${i}: ${error.message}`);
        results.push(null as any); // Placeholder for failed decryption
      }
    }

    if (errors.length > 0) {
      throw new Error(`Batch decryption completed with ${errors.length} errors: ${errors.join('; ')}`);
    }

    return results;
  }

  /**
   * Re-encrypt data with a new key (for key rotation)
   */
  async reencryptData(
    encryptedData: EncryptedData,
    newKeyType: KeyType,
    context?: EncryptionContext
  ): Promise<EncryptedData> {
    try {
      // First decrypt with old key
      const decryptionResult = await this.decryptData(encryptedData, context);

      // Then encrypt with new key
      const newEncryptedData = await this.encryptData(
        decryptionResult.data,
        context || decryptionResult.metadata.context,
        newKeyType
      );

      logConfigChange('encryption_service', 'data_reencrypted', context?.userId || 'system', {
        oldKeyId: encryptedData.keyId,
        newKeyId: newEncryptedData.keyId,
        dataType: decryptionResult.metadata.context.dataType,
      });

      return newEncryptedData;

    } catch (error) {
      throw new Error(`Re-encryption failed: ${error.message}`);
    }
  }

  /**
   * Validate encrypted data structure
   */
  private validateEncryptedData(encryptedData: EncryptedData): void {
    const requiredFields = ['data', 'iv', 'tag', 'keyId', 'algorithm', 'timestamp'];
    
    for (const field of requiredFields) {
      if (!(field in encryptedData) || encryptedData[field as keyof EncryptedData] === undefined) {
        throw new Error(`Invalid encrypted data: missing field '${field}'`);
      }
    }

    // Validate algorithm
    if (encryptedData.algorithm !== 'aes-256-gcm') {
      throw new Error(`Unsupported encryption algorithm: ${encryptedData.algorithm}`);
    }

    // Validate timestamp
    if (!(encryptedData.timestamp instanceof Date) && isNaN(Date.parse(encryptedData.timestamp as any))) {
      throw new Error('Invalid encrypted data: invalid timestamp');
    }
  }

  /**
   * Validate decryption context against encryption context
   */
  private validateDecryptionContext(
    decryptionContext: EncryptionContext,
    encryptionContext: EncryptionContext
  ): void {
    // Check if user has permission to decrypt this data
    if (decryptionContext.userId && encryptionContext.userId) {
      if (decryptionContext.userId !== encryptionContext.userId) {
        // Allow if it's a system operation or specific authorized purpose
        const authorizedPurposes = ['system_backup', 'compliance_audit', 'data_migration'];
        if (!authorizedPurposes.includes(decryptionContext.purpose)) {
          throw new Error('Unauthorized decryption: user mismatch');
        }
      }
    }

    // Validate compliance levels
    if (encryptionContext.compliance && decryptionContext.compliance) {
      const encryptionLevel = this.getComplianceLevel(encryptionContext.compliance[0]);
      const decryptionLevel = this.getComplianceLevel(decryptionContext.compliance[0]);

      if (decryptionLevel < encryptionLevel) {
        throw new Error('Insufficient compliance level for decryption');
      }
    }
  }

  /**
   * Get numeric compliance level for comparison
   */
  private getComplianceLevel(level: string): number {
    const levels = {
      'public': 1,
      'internal': 2,
      'confidential': 3,
      'restricted': 4,
      'top_secret': 5,
    };

    return levels[level as keyof typeof levels] || 0;
  }

  /**
   * Get encryption metrics
   */
  getMetrics(): Record<string, number> {
    const metrics: Record<string, number> = {};
    
    for (const [key, value] of this.encryptionMetrics) {
      metrics[key] = value;
    }

    // Calculate success rates
    const totalEncryptions = metrics.total_encryptions || 0;
    const totalDecryptions = metrics.total_decryptions || 0;
    
    metrics.encryption_success_rate = totalEncryptions > 0 
      ? ((totalEncryptions - (metrics.failed_encryptions || 0)) / totalEncryptions) * 100 
      : 100;
      
    metrics.decryption_success_rate = totalDecryptions > 0 
      ? ((totalDecryptions - (metrics.failed_decryptions || 0)) / totalDecryptions) * 100 
      : 100;

    return metrics;
  }

  /**
   * Reset metrics (for testing or periodic resets)
   */
  resetMetrics(): void {
    this.encryptionMetrics.clear();
    this.initializeMetrics();
    
    logConfigChange('encryption_service', 'metrics_reset', 'system');
  }

  /**
   * Get supported encryption algorithms
   */
  getSupportedAlgorithms(): string[] {
    return ['aes-256-gcm'];
  }

  /**
   * Verify data integrity without decrypting
   */
  async verifyIntegrity(encryptedData: EncryptedData): Promise<boolean> {
    try {
      this.validateEncryptedData(encryptedData);

      // If integrity hash is present, verify it
      if ((encryptedData as any).integrity) {
        const key = this.keyManagementService.getKey(encryptedData.keyId);
        if (!key) {
          return false;
        }

        return verifyHMAC(
          `${encryptedData.data}${encryptedData.iv}${encryptedData.tag}`,
          key.toString('hex'),
          (encryptedData as any).integrity
        );
      }

      // If no integrity hash, we can only validate structure
      return true;

    } catch (error) {
      return false;
    }
  }
}