import AWS from 'aws-sdk';
import { config, logger } from '../config';

export class S3Service {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
      region: config.aws.region,
    });
    this.bucketName = config.aws.s3BucketName || 'reskflow-assets';
  }

  async uploadFile(
    buffer: Buffer,
    key: string,
    contentType: string
  ): Promise<string> {
    try {
      const params: AWS.S3.PutObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        ACL: 'public-read',
      };

      const result = await this.s3.upload(params).promise();
      logger.info(`File uploaded to S3: ${result.Location}`);
      return result.Location;
    } catch (error) {
      logger.error('S3 upload failed', error);
      throw error;
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const params: AWS.S3.DeleteObjectRequest = {
        Bucket: this.bucketName,
        Key: key,
      };

      await this.s3.deleteObject(params).promise();
      logger.info(`File deleted from S3: ${key}`);
    } catch (error) {
      logger.error('S3 delete failed', error);
      throw error;
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const params = {
        Bucket: this.bucketName,
        Key: key,
        Expires: expiresIn,
      };

      const url = await this.s3.getSignedUrlPromise('getObject', params);
      return url;
    } catch (error) {
      logger.error('Failed to generate signed URL', error);
      throw error;
    }
  }

  async listFiles(prefix: string): Promise<AWS.S3.Object[]> {
    try {
      const params: AWS.S3.ListObjectsV2Request = {
        Bucket: this.bucketName,
        Prefix: prefix,
      };

      const result = await this.s3.listObjectsV2(params).promise();
      return result.Contents || [];
    } catch (error) {
      logger.error('S3 list failed', error);
      throw error;
    }
  }

  async copyFile(sourceKey: string, destinationKey: string): Promise<void> {
    try {
      const params: AWS.S3.CopyObjectRequest = {
        Bucket: this.bucketName,
        CopySource: `${this.bucketName}/${sourceKey}`,
        Key: destinationKey,
        ACL: 'public-read',
      };

      await this.s3.copyObject(params).promise();
      logger.info(`File copied from ${sourceKey} to ${destinationKey}`);
    } catch (error) {
      logger.error('S3 copy failed', error);
      throw error;
    }
  }
}