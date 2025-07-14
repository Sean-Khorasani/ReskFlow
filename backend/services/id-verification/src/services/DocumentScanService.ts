import { logger } from '@reskflow/shared';
import AWS from 'aws-sdk';
import { v4 as uuidv4 } from 'uuid';
import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { Buffer } from 'buffer';

interface DocumentData {
  documentType: string;
  documentNumber?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  expirationDate?: string;
  address?: string;
  issuingState?: string;
  issuingCountry?: string;
  [key: string]: any;
}

interface DocumentValidation {
  isValid: boolean;
  confidence: number;
  issues: string[];
}

export class DocumentScanService {
  private s3: AWS.S3;
  private bucketName: string;

  constructor() {
    this.s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'us-east-1',
    });
    this.bucketName = process.env.S3_BUCKET_NAME || 'reskflow-id-verification';
  }

  async uploadDocument(
    file: Express.Multer.File,
    sessionId: string
  ): Promise<string> {
    const fileKey = `sessions/${sessionId}/${uuidv4()}-${file.originalname}`;
    
    try {
      // Upload to S3
      await this.s3.upload({
        Bucket: this.bucketName,
        Key: fileKey,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: {
          sessionId,
          uploadedAt: new Date().toISOString(),
        },
      }).promise();

      // Return S3 URL
      return `https://${this.bucketName}.s3.amazonaws.com/${fileKey}`;
    } catch (error) {
      logger.error('Error uploading document to S3:', error);
      throw new Error('Failed to upload document');
    }
  }

  async extractDocumentData(
    fileBuffer: Buffer,
    documentType: string
  ): Promise<DocumentData> {
    try {
      // Preprocess image for better OCR
      const processedImage = await this.preprocessImage(fileBuffer);
      
      // Perform OCR
      const result = await Tesseract.recognize(processedImage, 'eng', {
        logger: m => logger.debug('OCR Progress:', m),
      });

      const extractedText = result.data.text;
      
      // Parse based on document type
      let documentData: DocumentData;
      
      switch (documentType) {
        case 'drivers_license':
          documentData = this.parseDriversLicense(extractedText);
          break;
        case 'passport':
          documentData = this.parsePassport(extractedText);
          break;
        case 'state_id':
          documentData = this.parseStateId(extractedText);
          break;
        case 'prescription':
          documentData = this.parsePrescription(extractedText);
          break;
        default:
          documentData = this.parseGenericDocument(extractedText);
      }

      documentData.documentType = documentType;
      documentData.ocrConfidence = result.data.confidence;

      return documentData;
    } catch (error) {
      logger.error('Error extracting document data:', error);
      throw new Error('Failed to extract document data');
    }
  }

  async processDocument(data: {
    documentId: string;
    sessionId: string;
    documentType: string;
  }): Promise<void> {
    logger.info('Processing document:', data);
    
    // This would be handled by the queue processor
    // Additional processing like:
    // - Barcode scanning
    // - Security feature detection
    // - Cross-reference with databases
  }

  async validateDocument(
    documentData: DocumentData,
    documentType: string
  ): Promise<DocumentValidation> {
    const issues: string[] = [];
    let confidence = 100;

    // Check required fields
    const requiredFields = this.getRequiredFields(documentType);
    for (const field of requiredFields) {
      if (!documentData[field]) {
        issues.push(`Missing ${field}`);
        confidence -= 10;
      }
    }

    // Validate date formats
    if (documentData.dateOfBirth && !this.isValidDate(documentData.dateOfBirth)) {
      issues.push('Invalid date of birth format');
      confidence -= 15;
    }

    if (documentData.expirationDate) {
      if (!this.isValidDate(documentData.expirationDate)) {
        issues.push('Invalid expiration date format');
        confidence -= 15;
      } else if (new Date(documentData.expirationDate) < new Date()) {
        issues.push('Document is expired');
        confidence -= 50;
      }
    }

    // Validate document number format
    if (documentData.documentNumber && !this.isValidDocumentNumber(documentData.documentNumber, documentType)) {
      issues.push('Invalid document number format');
      confidence -= 20;
    }

    return {
      isValid: issues.length === 0,
      confidence: Math.max(0, confidence),
      issues,
    };
  }

  async detectSecurityFeatures(imageBuffer: Buffer): Promise<{
    hasHologram: boolean;
    hasUVFeatures: boolean;
    hasMicroprint: boolean;
    hasRaisedText: boolean;
    securityScore: number;
  }> {
    // In a real implementation, this would use computer vision
    // to detect security features like:
    // - Holographic overlays
    // - UV-reactive elements
    // - Microprinting
    // - Raised text/tactile features
    
    // For now, return mock data
    return {
      hasHologram: true,
      hasUVFeatures: true,
      hasMicroprint: true,
      hasRaisedText: true,
      securityScore: 85,
    };
  }

  async compareFaces(
    documentImageUrl: string,
    selfieImageUrl: string
  ): Promise<{
    isMatch: boolean;
    confidence: number;
  }> {
    // This would be handled by BiometricService
    // Placeholder for interface consistency
    return {
      isMatch: true,
      confidence: 0.95,
    };
  }

  private async preprocessImage(buffer: Buffer): Promise<Buffer> {
    try {
      // Use sharp to enhance image for better OCR
      const processed = await sharp(buffer)
        .resize(2000, null, { // Resize to standard width
          withoutEnlargement: true,
        })
        .grayscale() // Convert to grayscale
        .normalize() // Normalize contrast
        .sharpen() // Sharpen text
        .toBuffer();

      return processed;
    } catch (error) {
      logger.error('Error preprocessing image:', error);
      return buffer; // Return original if processing fails
    }
  }

  private parseDriversLicense(text: string): DocumentData {
    const data: DocumentData = { documentType: 'drivers_license' };
    
    // Parse common DL fields
    const lines = text.split('\n');
    
    for (const line of lines) {
      // Document number
      const dlMatch = line.match(/DL[:#\s]*([A-Z0-9]+)/i);
      if (dlMatch) {
        data.documentNumber = dlMatch[1];
      }

      // Name
      const nameMatch = line.match(/(?:FN|First Name)[:#\s]*([A-Z]+)/i);
      if (nameMatch) {
        data.firstName = nameMatch[1];
      }
      
      const lastNameMatch = line.match(/(?:LN|Last Name)[:#\s]*([A-Z]+)/i);
      if (lastNameMatch) {
        data.lastName = lastNameMatch[1];
      }

      // DOB
      const dobMatch = line.match(/(?:DOB|Date of Birth)[:#\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
      if (dobMatch) {
        data.dateOfBirth = dobMatch[1];
      }

      // Expiration
      const expMatch = line.match(/(?:EXP|Expires)[:#\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
      if (expMatch) {
        data.expirationDate = expMatch[1];
      }
    }

    // Try to extract from PDF417 barcode format if available
    const pdf417Match = text.match(/ANSI\s+\d+([A-Z]{2})/);
    if (pdf417Match) {
      data.issuingState = pdf417Match[1];
    }

    return data;
  }

  private parsePassport(text: string): DocumentData {
    const data: DocumentData = { documentType: 'passport' };
    
    // Parse Machine Readable Zone (MRZ)
    const mrzLines = text.split('\n').filter(line => 
      line.length > 30 && /^[A-Z0-9<]+$/.test(line)
    );

    if (mrzLines.length >= 2) {
      // Parse MRZ Type 3 (standard passport)
      const line1 = mrzLines[0];
      const line2 = mrzLines[1];

      // Document type and issuing country
      data.issuingCountry = line1.substring(2, 5).replace(/</g, '');
      
      // Names
      const names = line1.substring(5, 44).split('<<');
      data.lastName = names[0]?.replace(/</g, ' ').trim();
      data.firstName = names[1]?.replace(/</g, ' ').trim();

      // Passport number
      data.documentNumber = line2.substring(0, 9).replace(/</g, '');

      // Dates (YYMMDD format)
      const dobStr = line2.substring(13, 19);
      if (dobStr) {
        data.dateOfBirth = this.parseMRZDate(dobStr);
      }

      const expStr = line2.substring(21, 27);
      if (expStr) {
        data.expirationDate = this.parseMRZDate(expStr);
      }
    }

    return data;
  }

  private parseStateId(text: string): DocumentData {
    // Similar to driver's license but without driving-specific fields
    const data = this.parseDriversLicense(text);
    data.documentType = 'state_id';
    return data;
  }

  private parsePrescription(text: string): DocumentData {
    const data: DocumentData = { documentType: 'prescription' };
    
    const lines = text.split('\n');
    
    for (const line of lines) {
      // Patient name
      const patientMatch = line.match(/(?:Patient|Name)[:#\s]*([A-Za-z\s]+)/i);
      if (patientMatch) {
        data.patientName = patientMatch[1].trim();
      }

      // Prescriber
      const prescriberMatch = line.match(/(?:Dr\.|MD|Prescriber)[:#\s]*([A-Za-z\s]+)/i);
      if (prescriberMatch) {
        data.prescribedBy = prescriberMatch[1].trim();
      }

      // DEA number
      const deaMatch = line.match(/DEA[:#\s]*([A-Z]{2}\d{7})/i);
      if (deaMatch) {
        data.deaNumber = deaMatch[1];
      }

      // Date
      const dateMatch = line.match(/(?:Date|Prescribed)[:#\s]*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
      if (dateMatch) {
        data.prescriptionDate = dateMatch[1];
      }
    }

    // Extract medications
    data.medications = this.extractMedications(text);

    return data;
  }

  private parseGenericDocument(text: string): DocumentData {
    const data: DocumentData = { documentType: 'generic' };
    
    // Try to extract common fields
    const lines = text.split('\n');
    
    for (const line of lines) {
      // Look for name patterns
      const nameMatch = line.match(/(?:Name|Full Name)[:#\s]*([A-Za-z\s]+)/i);
      if (nameMatch) {
        const nameParts = nameMatch[1].trim().split(/\s+/);
        data.firstName = nameParts[0];
        data.lastName = nameParts[nameParts.length - 1];
      }

      // Look for date patterns
      const dateMatch = line.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/);
      if (dateMatch && !data.dateOfBirth) {
        data.dateOfBirth = dateMatch[1];
      }
    }

    data.rawText = text;
    return data;
  }

  private extractMedications(text: string): Array<any> {
    const medications: Array<any> = [];
    const lines = text.split('\n');
    
    // Look for medication patterns
    const medicationPattern = /([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+\s*mg|\d+\s*ml)/gi;
    
    for (const line of lines) {
      const matches = line.matchAll(medicationPattern);
      for (const match of matches) {
        medications.push({
          name: match[1].trim(),
          dosage: match[2].trim(),
        });
      }
    }

    return medications;
  }

  private parseMRZDate(dateStr: string): string {
    // Convert YYMMDD to MM/DD/YYYY
    if (dateStr.length !== 6) return '';
    
    const year = parseInt(dateStr.substring(0, 2));
    const month = dateStr.substring(2, 4);
    const day = dateStr.substring(4, 6);
    
    // Determine century (assume 19xx for >50, 20xx for <=50)
    const fullYear = year > 50 ? 1900 + year : 2000 + year;
    
    return `${month}/${day}/${fullYear}`;
  }

  private getRequiredFields(documentType: string): string[] {
    const fieldMap: Record<string, string[]> = {
      'drivers_license': ['documentNumber', 'firstName', 'lastName', 'dateOfBirth', 'expirationDate'],
      'passport': ['documentNumber', 'firstName', 'lastName', 'dateOfBirth', 'expirationDate', 'issuingCountry'],
      'state_id': ['documentNumber', 'firstName', 'lastName', 'dateOfBirth'],
      'prescription': ['patientName', 'prescribedBy', 'prescriptionDate'],
    };

    return fieldMap[documentType] || [];
  }

  private isValidDate(dateStr: string): boolean {
    const datePattern = /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/;
    if (!datePattern.test(dateStr)) return false;
    
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date.getTime());
  }

  private isValidDocumentNumber(docNum: string, documentType: string): boolean {
    const patterns: Record<string, RegExp> = {
      'drivers_license': /^[A-Z0-9]{5,20}$/,
      'passport': /^[A-Z0-9]{6,9}$/,
      'state_id': /^[A-Z0-9]{5,20}$/,
    };

    const pattern = patterns[documentType];
    return pattern ? pattern.test(docNum) : true;
  }
}