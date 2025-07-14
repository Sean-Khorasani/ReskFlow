import { logger } from '@reskflow/shared';
import AWS from 'aws-sdk';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

interface MediaUploadParams {
  file: Express.Multer.File;
  userId: string;
  roomId: string;
}

interface MediaUploadResult {
  url: string;
  thumbnailUrl?: string;
  type: string;
  size: number;
  dimensions?: {
    width: number;
    height: number;
  };
  duration?: number;
}

export class MediaService {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    this.bucketName = process.env.S3_BUCKET_NAME || 'reskflow-chat-media';
  }

  async uploadMedia(params: MediaUploadParams): Promise<MediaUploadResult> {
    try {
      const { file, userId, roomId } = params;
      
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'audio/mpeg'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new Error('File type not allowed');
      }

      // Process based on file type
      if (file.mimetype.startsWith('image/')) {
        return await this.uploadImage(file, userId, roomId);
      } else if (file.mimetype.startsWith('video/')) {
        return await this.uploadVideo(file, userId, roomId);
      } else if (file.mimetype.startsWith('audio/')) {
        return await this.uploadAudio(file, userId, roomId);
      }

      throw new Error('Unsupported media type');
    } catch (error) {
      logger.error('Error uploading media:', error);
      throw error;
    }
  }

  private async uploadImage(
    file: Express.Multer.File,
    userId: string,
    roomId: string
  ): Promise<MediaUploadResult> {
    // Process image
    const processedImage = await sharp(file.buffer)
      .resize(1920, 1080, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85, progressive: true })
      .toBuffer();

    // Create thumbnail
    const thumbnail = await sharp(file.buffer)
      .resize(320, 240, {
        fit: 'cover',
      })
      .jpeg({ quality: 70 })
      .toBuffer();

    // Get dimensions
    const metadata = await sharp(file.buffer).metadata();

    // Generate filenames
    const filename = this.generateFilename(userId, roomId, 'image', 'jpg');
    const thumbnailFilename = this.generateFilename(userId, roomId, 'thumb', 'jpg');

    // Upload to S3
    const [imageUrl, thumbnailUrl] = await Promise.all([
      this.uploadToS3(filename, processedImage, 'image/jpeg'),
      this.uploadToS3(thumbnailFilename, thumbnail, 'image/jpeg'),
    ]);

    return {
      url: imageUrl,
      thumbnailUrl,
      type: 'image',
      size: processedImage.length,
      dimensions: {
        width: metadata.width || 0,
        height: metadata.height || 0,
      },
    };
  }

  private async uploadVideo(
    file: Express.Multer.File,
    userId: string,
    roomId: string
  ): Promise<MediaUploadResult> {
    // For video, we'll upload as-is and generate thumbnail
    const filename = this.generateFilename(userId, roomId, 'video', 'mp4');
    
    // Upload video
    const videoUrl = await this.uploadToS3(filename, file.buffer, file.mimetype);

    // TODO: Generate video thumbnail using ffmpeg
    // For now, we'll skip thumbnail generation

    return {
      url: videoUrl,
      type: 'video',
      size: file.buffer.length,
      duration: 0, // TODO: Extract video duration
    };
  }

  private async uploadAudio(
    file: Express.Multer.File,
    userId: string,
    roomId: string
  ): Promise<MediaUploadResult> {
    const filename = this.generateFilename(userId, roomId, 'audio', 'mp3');
    
    // Upload audio
    const audioUrl = await this.uploadToS3(filename, file.buffer, file.mimetype);

    return {
      url: audioUrl,
      type: 'audio',
      size: file.buffer.length,
      duration: 0, // TODO: Extract audio duration
    };
  }

  private async uploadToS3(
    key: string,
    buffer: Buffer,
    contentType: string
  ): Promise<string> {
    const params: AWS.S3.PutObjectRequest = {
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'max-age=31536000',
    };

    const result = await this.s3.upload(params).promise();
    return result.Location;
  }

  private generateFilename(
    userId: string,
    roomId: string,
    type: string,
    extension: string
  ): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const uniqueId = uuidv4();

    return `chat/${roomId}/${year}/${month}/${day}/${type}_${userId}_${uniqueId}.${extension}`;
  }

  async deleteMedia(url: string): Promise<void> {
    try {
      const key = this.extractKeyFromUrl(url);
      
      await this.s3.deleteObject({
        Bucket: this.bucketName,
        Key: key,
      }).promise();

      logger.info(`Deleted media: ${key}`);
    } catch (error) {
      logger.error('Error deleting media:', error);
      throw error;
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

  private extractKeyFromUrl(url: string): string {
    const urlParts = url.split('/');
    return urlParts.slice(3).join('/');
  }
}