import { logger } from '@reskflow/shared';
import * as faceapi from 'face-api.js';
import axios from 'axios';
import sharp from 'sharp';
import { Canvas, Image, ImageData } from 'canvas';
import '@tensorflow/tfjs-node';

interface FaceMatchResult {
  isMatch: boolean;
  confidence: number;
  distance: number;
  details?: {
    facesDetected: number;
    faceQuality: number;
    livenessScore?: number;
  };
}

interface LivenessCheck {
  isLive: boolean;
  confidence: number;
  spoofingType?: string;
}

export class BiometricService {
  private modelsLoaded: boolean = false;

  constructor() {
    this.initializeFaceAPI();
  }

  private async initializeFaceAPI(): Promise<void> {
    try {
      // Set up face-api.js environment for Node.js
      const { Canvas, Image, ImageData } = require('canvas');
      faceapi.env.monkeyPatch({ Canvas, Image, ImageData } as any);

      // Load models
      const MODEL_URL = process.env.FACEAPI_MODELS_PATH || './models';
      
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromDisk(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromDisk(MODEL_URL),
        faceapi.nets.faceExpressionNet.loadFromDisk(MODEL_URL),
        faceapi.nets.ageGenderNet.loadFromDisk(MODEL_URL),
      ]);

      this.modelsLoaded = true;
      logger.info('Face recognition models loaded successfully');
    } catch (error) {
      logger.error('Error loading face recognition models:', error);
      throw new Error('Failed to initialize biometric service');
    }
  }

  async compareFaces(
    documentImageUrl: string,
    selfieImageUrl: string
  ): Promise<FaceMatchResult> {
    if (!this.modelsLoaded) {
      await this.initializeFaceAPI();
    }

    try {
      // Download images
      const [docImage, selfieImage] = await Promise.all([
        this.downloadImage(documentImageUrl),
        this.downloadImage(selfieImageUrl),
      ]);

      // Detect faces and extract descriptors
      const [docFaceResult, selfieFaceResult] = await Promise.all([
        this.detectAndDescribeFace(docImage),
        this.detectAndDescribeFace(selfieImage),
      ]);

      if (!docFaceResult || !selfieFaceResult) {
        return {
          isMatch: false,
          confidence: 0,
          distance: 1,
          details: {
            facesDetected: (docFaceResult ? 1 : 0) + (selfieFaceResult ? 1 : 0),
            faceQuality: 0,
          },
        };
      }

      // Calculate face distance
      const distance = faceapi.euclideanDistance(
        docFaceResult.descriptor,
        selfieFaceResult.descriptor
      );

      // Convert distance to confidence (0-1 scale)
      // Typical face distances range from 0 to 0.6
      const confidence = Math.max(0, 1 - distance / 0.6);
      const isMatch = distance < 0.4; // Threshold for match

      // Calculate face quality based on detection confidence
      const faceQuality = (docFaceResult.detection.score + selfieFaceResult.detection.score) / 2;

      return {
        isMatch,
        confidence,
        distance,
        details: {
          facesDetected: 2,
          faceQuality,
        },
      };
    } catch (error) {
      logger.error('Error comparing faces:', error);
      throw new Error('Failed to compare faces');
    }
  }

  async performLivenessCheck(
    selfieImageUrl: string,
    additionalImages?: string[]
  ): Promise<LivenessCheck> {
    try {
      // Basic liveness check using multiple techniques
      const checks = await Promise.all([
        this.checkFaceQuality(selfieImageUrl),
        this.checkForSpoofing(selfieImageUrl),
        this.checkBlinkDetection(additionalImages || []),
      ]);

      const avgConfidence = checks.reduce((sum, check) => sum + check.confidence, 0) / checks.length;
      const isLive = checks.every(check => check.isLive);

      return {
        isLive,
        confidence: avgConfidence,
        spoofingType: checks.find(c => !c.isLive)?.spoofingType,
      };
    } catch (error) {
      logger.error('Error performing liveness check:', error);
      return {
        isLive: false,
        confidence: 0,
        spoofingType: 'error',
      };
    }
  }

  async extractFaceFeatures(imageUrl: string): Promise<{
    age?: number;
    gender?: string;
    expression?: string;
    landmarks?: any;
  }> {
    if (!this.modelsLoaded) {
      await this.initializeFaceAPI();
    }

    try {
      const image = await this.downloadImage(imageUrl);
      const canvas = await this.imageToCanvas(image);

      const detection = await faceapi
        .detectSingleFace(canvas as any)
        .withFaceLandmarks()
        .withFaceExpressions()
        .withAgeAndGender();

      if (!detection) {
        return {};
      }

      // Get dominant expression
      const expressions = detection.expressions as any;
      const dominantExpression = Object.keys(expressions).reduce((a, b) =>
        expressions[a] > expressions[b] ? a : b
      );

      return {
        age: Math.round(detection.age),
        gender: detection.gender,
        expression: dominantExpression,
        landmarks: detection.landmarks,
      };
    } catch (error) {
      logger.error('Error extracting face features:', error);
      return {};
    }
  }

  async generateFaceTemplate(imageUrl: string): Promise<Float32Array | null> {
    if (!this.modelsLoaded) {
      await this.initializeFaceAPI();
    }

    try {
      const image = await this.downloadImage(imageUrl);
      const result = await this.detectAndDescribeFace(image);
      
      return result ? result.descriptor : null;
    } catch (error) {
      logger.error('Error generating face template:', error);
      return null;
    }
  }

  async verifyFaceTemplate(
    template1: Float32Array,
    template2: Float32Array
  ): Promise<FaceMatchResult> {
    const distance = faceapi.euclideanDistance(template1, template2);
    const confidence = Math.max(0, 1 - distance / 0.6);
    const isMatch = distance < 0.4;

    return {
      isMatch,
      confidence,
      distance,
    };
  }

  private async detectAndDescribeFace(imageBuffer: Buffer): Promise<{
    descriptor: Float32Array;
    detection: faceapi.FaceDetection;
  } | null> {
    try {
      const canvas = await this.imageToCanvas(imageBuffer);
      
      const detection = await faceapi
        .detectSingleFace(canvas as any)
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!detection) {
        return null;
      }

      return {
        descriptor: detection.descriptor,
        detection: detection.detection,
      };
    } catch (error) {
      logger.error('Error detecting face:', error);
      return null;
    }
  }

  private async checkFaceQuality(imageUrl: string): Promise<LivenessCheck> {
    try {
      const image = await this.downloadImage(imageUrl);
      const metadata = await sharp(image).metadata();
      
      // Check image quality metrics
      const isHighQuality = 
        (metadata.width || 0) >= 640 &&
        (metadata.height || 0) >= 480 &&
        (metadata.density || 72) >= 72;

      // Check for blur using sharpness detection
      const stats = await sharp(image).stats();
      const sharpness = this.calculateSharpness(stats);
      
      const confidence = isHighQuality ? 0.8 : 0.3;

      return {
        isLive: isHighQuality && sharpness > 0.5,
        confidence,
      };
    } catch (error) {
      return { isLive: false, confidence: 0 };
    }
  }

  private async checkForSpoofing(imageUrl: string): Promise<LivenessCheck> {
    try {
      const image = await this.downloadImage(imageUrl);
      const canvas = await this.imageToCanvas(image);
      
      // Detect single face
      const detections = await faceapi.detectAllFaces(canvas as any);
      
      // Multiple faces might indicate spoofing
      if (detections.length !== 1) {
        return {
          isLive: false,
          confidence: 0.2,
          spoofingType: 'multiple_faces',
        };
      }

      // Check face size relative to image
      const detection = detections[0];
      const faceArea = detection.box.width * detection.box.height;
      const imageArea = (canvas as any).width * (canvas as any).height;
      const faceRatio = faceArea / imageArea;

      // Face too small or too large might indicate spoofing
      if (faceRatio < 0.05 || faceRatio > 0.8) {
        return {
          isLive: false,
          confidence: 0.3,
          spoofingType: 'unusual_face_size',
        };
      }

      return {
        isLive: true,
        confidence: 0.8,
      };
    } catch (error) {
      return { isLive: false, confidence: 0 };
    }
  }

  private async checkBlinkDetection(images: string[]): Promise<LivenessCheck> {
    if (images.length < 2) {
      // Can't perform blink detection with less than 2 images
      return {
        isLive: true,
        confidence: 0.5,
      };
    }

    try {
      const eyeStates = await Promise.all(
        images.map(img => this.detectEyeState(img))
      );

      // Check if there's at least one blink
      const hasOpenEyes = eyeStates.some(state => state === 'open');
      const hasClosedEyes = eyeStates.some(state => state === 'closed');
      const hasBlink = hasOpenEyes && hasClosedEyes;

      return {
        isLive: hasBlink,
        confidence: hasBlink ? 0.9 : 0.3,
        spoofingType: hasBlink ? undefined : 'no_blink_detected',
      };
    } catch (error) {
      return { isLive: true, confidence: 0.5 };
    }
  }

  private async detectEyeState(imageUrl: string): Promise<'open' | 'closed' | 'unknown'> {
    try {
      const image = await this.downloadImage(imageUrl);
      const canvas = await this.imageToCanvas(image);
      
      const detection = await faceapi
        .detectSingleFace(canvas as any)
        .withFaceLandmarks();

      if (!detection) {
        return 'unknown';
      }

      // Get eye landmarks
      const landmarks = detection.landmarks;
      const leftEye = landmarks.getLeftEye();
      const rightEye = landmarks.getRightEye();

      // Calculate eye aspect ratio (EAR)
      const leftEAR = this.calculateEyeAspectRatio(leftEye);
      const rightEAR = this.calculateEyeAspectRatio(rightEye);
      const avgEAR = (leftEAR + rightEAR) / 2;

      // Threshold for closed eyes (typically around 0.2)
      return avgEAR < 0.2 ? 'closed' : 'open';
    } catch (error) {
      return 'unknown';
    }
  }

  private calculateEyeAspectRatio(eyeLandmarks: faceapi.Point[]): number {
    // Eye aspect ratio calculation
    // EAR = (||p2 - p6|| + ||p3 - p5||) / (2 * ||p1 - p4||)
    if (eyeLandmarks.length < 6) return 0;

    const p1 = eyeLandmarks[0];
    const p2 = eyeLandmarks[1];
    const p3 = eyeLandmarks[2];
    const p4 = eyeLandmarks[3];
    const p5 = eyeLandmarks[4];
    const p6 = eyeLandmarks[5];

    const verticalDist1 = this.euclideanDistance(p2, p6);
    const verticalDist2 = this.euclideanDistance(p3, p5);
    const horizontalDist = this.euclideanDistance(p1, p4);

    return (verticalDist1 + verticalDist2) / (2 * horizontalDist);
  }

  private euclideanDistance(p1: faceapi.Point, p2: faceapi.Point): number {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  }

  private calculateSharpness(stats: any): number {
    // Simple sharpness metric based on standard deviation
    const channels = stats.channels as any[];
    const avgStdDev = channels.reduce((sum, ch) => sum + ch.stdev, 0) / channels.length;
    
    // Normalize to 0-1 range
    return Math.min(avgStdDev / 100, 1);
  }

  private async downloadImage(url: string): Promise<Buffer> {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
    });
    
    return Buffer.from(response.data);
  }

  private async imageToCanvas(buffer: Buffer): Promise<any> {
    // Process image with sharp first to ensure compatibility
    const processedBuffer = await sharp(buffer)
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();

    const img = new Image();
    img.src = processedBuffer;
    
    const canvas = faceapi.createCanvasFromMedia(img as any);
    return canvas;
  }
}