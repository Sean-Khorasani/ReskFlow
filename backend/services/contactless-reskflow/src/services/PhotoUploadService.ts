import { logger } from '@reskflow/shared';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import sharp from 'sharp';

interface PhotoMetadata {
  orderId: string;
  reskflowId: string;
  type: 'dropoff' | 'verification' | 'damage' | 'id_verification';
  location?: {
    latitude: number;
    longitude: number;
  };
  timestamp: Date;
  deviceInfo?: any;
}

interface UploadResult {
  url: string;
  thumbnailUrl: string;
  metadata: PhotoMetadata;
  hash: string;
  size: number;
}

export class PhotoUploadService {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    this.bucketName = process.env.S3_BUCKET_NAME || 'reskflow-photos';
  }

  async uploadPhoto(
    base64Image: string,
    metadata: PhotoMetadata
  ): Promise<string> {
    try {
      // Decode base64 image
      const buffer = Buffer.from(base64Image.replace(/^data:image\/\w+;base64,/, ''), 'base64');

      // Process image
      const processedImage = await this.processImage(buffer);
      const thumbnail = await this.createThumbnail(buffer);

      // Generate unique filename
      const filename = this.generateFilename(metadata);
      const thumbnailFilename = `thumbnails/${filename}`;

      // Calculate hash for integrity
      const hash = this.calculateHash(processedImage);

      // Upload main image
      const uploadParams: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: filename,
        Body: processedImage,
        ContentType: 'image/jpeg',
        Metadata: {
          orderId: metadata.orderId,
          reskflowId: metadata.reskflowId,
          type: metadata.type,
          timestamp: metadata.timestamp.toISOString(),
          hash,
        },
      };

      if (metadata.location) {
        uploadParams.Metadata.latitude = metadata.location.latitude.toString();
        uploadParams.Metadata.longitude = metadata.location.longitude.toString();
      }

      const uploadResult = await this.s3.upload(uploadParams).promise();

      // Upload thumbnail
      await this.s3.upload({
        Bucket: this.bucketName,
        Key: thumbnailFilename,
        Body: thumbnail,
        ContentType: 'image/jpeg',
      }).promise();

      // Store photo record in database
      await this.storePhotoRecord({
        url: uploadResult.Location,
        thumbnailUrl: `https://${this.bucketName}.s3.amazonaws.com/${thumbnailFilename}`,
        metadata,
        hash,
        size: processedImage.length,
      });

      return uploadResult.Location;
    } catch (error) {
      logger.error('Error uploading photo:', error);
      throw new Error('Failed to upload photo');
    }
  }

  async verifyPhotoIntegrity(url: string, expectedHash: string): Promise<boolean> {
    try {
      // Extract key from URL
      const key = this.extractKeyFromUrl(url);

      // Get object from S3
      const params = {
        Bucket: this.bucketName,
        Key: key,
      };

      const object = await this.s3.getObject(params).promise();
      
      // Calculate hash
      const actualHash = this.calculateHash(object.Body as Buffer);

      return actualHash === expectedHash;
    } catch (error) {
      logger.error('Error verifying photo integrity:', error);
      return false;
    }
  }

  async getPhotoMetadata(url: string): Promise<PhotoMetadata | null> {
    try {
      const key = this.extractKeyFromUrl(url);

      const params = {
        Bucket: this.bucketName,
        Key: key,
      };

      const object = await this.s3.headObject(params).promise();

      if (!object.Metadata) {
        return null;
      }

      return {
        orderId: object.Metadata.orderId,
        reskflowId: object.Metadata.reskflowId,
        type: object.Metadata.type as any,
        location: object.Metadata.latitude && object.Metadata.longitude
          ? {
              latitude: parseFloat(object.Metadata.latitude),
              longitude: parseFloat(object.Metadata.longitude),
            }
          : undefined,
        timestamp: new Date(object.Metadata.timestamp),
      };
    } catch (error) {
      logger.error('Error getting photo metadata:', error);
      return null;
    }
  }

  async deletePhoto(url: string): Promise<void> {
    try {
      const key = this.extractKeyFromUrl(url);
      const thumbnailKey = `thumbnails/${key}`;

      // Delete main image
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: key,
      }).promise();

      // Delete thumbnail
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: thumbnailKey,
      }).promise();

      logger.info(`Deleted photo: ${key}`);
    } catch (error) {
      logger.error('Error deleting photo:', error);
      throw new Error('Failed to delete photo');
    }
  }

  async generateSignedUrl(url: string, expirySeconds: number = 3600): Promise<string> {
    const key = this.extractKeyFromUrl(url);

    const params = {
      Bucket: this.bucketName,
      Key: key,
      Expires: expirySeconds,
    };

    return this.s3.getSignedUrl('getObject', params);
  }

  private async processImage(buffer: Buffer): Promise<Buffer> {
    // Process image: resize, compress, add watermark if needed
    const processed = await sharp(buffer)
      .resize(1920, 1080, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 85,
        progressive: true,
      })
      .toBuffer();

    return processed;
  }

  private async createThumbnail(buffer: Buffer): Promise<Buffer> {
    const thumbnail = await sharp(buffer)
      .resize(320, 240, {
        fit: 'cover',
      })
      .jpeg({
        quality: 70,
      })
      .toBuffer();

    return thumbnail;
  }

  private generateFilename(metadata: PhotoMetadata): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}/${month}/${day}/${metadata.type}/${metadata.reskflowId}-${uuidv4()}.jpg`;
  }

  private calculateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private extractKeyFromUrl(url: string): string {
    const urlParts = url.split('/');
    return urlParts.slice(3).join('/');
  }

  private async storePhotoRecord(record: UploadResult): Promise<void> {
    try {
      await prisma.reskflowPhoto.create({
        data: {
          id: uuidv4(),
          reskflow_id: record.metadata.reskflowId,
          url: record.url,
          thumbnail_url: record.thumbnailUrl,
          type: record.metadata.type,
          hash: record.hash,
          size: record.size,
          metadata: record.metadata as any,
          uploaded_at: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error storing photo record:', error);
    }
  }
}