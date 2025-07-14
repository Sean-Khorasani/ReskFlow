import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import { AgeVerificationService } from './AgeVerificationService';
import { PrescriptionVerificationService } from './PrescriptionVerificationService';
import { DocumentScanService } from './DocumentScanService';
import { BiometricService } from './BiometricService';
import { ComplianceService } from './ComplianceService';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import QRCode from 'qrcode';

interface VerificationSession {
  id: string;
  orderId: string;
  customerId: string;
  verificationType: 'age' | 'prescription' | 'both';
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'expired';
  documents: VerificationDocument[];
  selfie?: string;
  result?: VerificationResult;
  expiresAt: Date;
  createdAt: Date;
}

interface VerificationDocument {
  id: string;
  type: 'drivers_license' | 'passport' | 'state_id' | 'prescription';
  side: 'front' | 'back' | 'single';
  url: string;
  extractedData?: any;
  verified: boolean;
}

interface VerificationResult {
  verified: boolean;
  ageVerified?: boolean;
  identityVerified?: boolean;
  prescriptionVerified?: boolean;
  failureReasons?: string[];
  verifiedAt: Date;
  verifiedBy?: string;
}

interface DeliveryVerification {
  success: boolean;
  verificationId: string;
  timestamp: Date;
  method: 'code' | 'scan' | 'manual';
}

interface VerificationAnalytics {
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  averageVerificationTime: number;
  verificationsByType: {
    age: number;
    prescription: number;
    both: number;
  };
  failureReasons: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  complianceRate: number;
  fraudAttempts: number;
}

export class IDVerificationService {
  constructor(
    private ageVerificationService: AgeVerificationService,
    private prescriptionVerificationService: PrescriptionVerificationService,
    private documentScanService: DocumentScanService,
    private biometricService: BiometricService,
    private complianceService: ComplianceService,
    private verificationQueue: Bull.Queue
  ) {}

  async initiateVerification(params: {
    orderId: string;
    customerId: string;
    verificationType: string;
  }): Promise<VerificationSession> {
    // Check if order requires verification
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        orderItems: {
          include: {
            item: true,
          },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Determine verification requirements
    const requirements = await this.determineVerificationRequirements(order);
    
    if (!requirements.requiresVerification) {
      throw new Error('Order does not require verification');
    }

    // Check for existing session
    const existingSession = await prisma.verificationSession.findFirst({
      where: {
        order_id: params.orderId,
        customer_id: params.customerId,
        status: { in: ['pending', 'in_progress'] },
      },
    });

    if (existingSession) {
      return this.mapToVerificationSession(existingSession);
    }

    // Create new session
    const session = await prisma.verificationSession.create({
      data: {
        id: uuidv4(),
        order_id: params.orderId,
        customer_id: params.customerId,
        verification_type: params.verificationType,
        status: 'pending',
        documents: [],
        expires_at: dayjs().add(30, 'minute').toDate(),
        requirements,
      },
    });

    // Generate verification QR code
    const qrCode = await this.generateVerificationQR(session.id);
    
    await prisma.verificationSession.update({
      where: { id: session.id },
      data: { qr_code: qrCode },
    });

    return this.mapToVerificationSession(session);
  }

  async uploadDocument(params: {
    sessionId: string;
    file: Express.Multer.File;
    documentType: string;
    side: string;
    uploadedBy: string;
  }): Promise<{
    success: boolean;
    documentId: string;
    extractedData?: any;
    message: string;
  }> {
    // Get session
    const session = await prisma.verificationSession.findUnique({
      where: { id: params.sessionId },
    });

    if (!session || session.status === 'completed' || session.status === 'expired') {
      throw new Error('Invalid or expired session');
    }

    // Upload document
    const documentUrl = await this.documentScanService.uploadDocument(
      params.file,
      params.sessionId
    );

    // Create document record
    const document = await prisma.verificationDocument.create({
      data: {
        id: uuidv4(),
        session_id: params.sessionId,
        type: params.documentType,
        side: params.side,
        url: documentUrl,
        uploaded_by: params.uploadedBy,
      },
    });

    // Update session status
    await prisma.verificationSession.update({
      where: { id: params.sessionId },
      data: { status: 'in_progress' },
    });

    // Queue document processing
    await this.verificationQueue.add('process-document', {
      documentId: document.id,
      sessionId: params.sessionId,
      documentType: params.documentType,
    });

    // Extract data from document
    const extractedData = await this.documentScanService.extractDocumentData(
      params.file.buffer,
      params.documentType
    );

    // Update document with extracted data
    await prisma.verificationDocument.update({
      where: { id: document.id },
      data: { extracted_data: extractedData },
    });

    return {
      success: true,
      documentId: document.id,
      extractedData,
      message: 'Document uploaded successfully',
    };
  }

  async uploadSelfie(params: {
    sessionId: string;
    file: Express.Multer.File;
    uploadedBy: string;
  }): Promise<{
    success: boolean;
    faceMatchScore: number;
    verified: boolean;
  }> {
    const session = await prisma.verificationSession.findUnique({
      where: { id: params.sessionId },
      include: {
        documents: true,
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Upload selfie
    const selfieUrl = await this.documentScanService.uploadDocument(
      params.file,
      params.sessionId
    );

    // Update session
    await prisma.verificationSession.update({
      where: { id: params.sessionId },
      data: { selfie_url: selfieUrl },
    });

    // Find ID document for face matching
    const idDocument = session.documents.find(
      d => d.type === 'drivers_license' || d.type === 'passport'
    );

    if (!idDocument) {
      throw new Error('ID document required for face matching');
    }

    // Perform face matching
    const faceMatchResult = await this.biometricService.compareFaces(
      idDocument.url,
      selfieUrl
    );

    // Update session with biometric result
    await prisma.verificationSession.update({
      where: { id: params.sessionId },
      data: {
        biometric_score: faceMatchResult.confidence,
        biometric_verified: faceMatchResult.isMatch,
      },
    });

    return {
      success: true,
      faceMatchScore: faceMatchResult.confidence,
      verified: faceMatchResult.isMatch,
    };
  }

  async completeVerification(
    sessionId: string,
    userId: string
  ): Promise<VerificationResult> {
    const session = await prisma.verificationSession.findUnique({
      where: { id: sessionId },
      include: {
        documents: true,
        order: {
          include: {
            orderItems: {
              include: { item: true },
            },
          },
        },
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    if (session.status === 'completed') {
      return session.result as VerificationResult;
    }

    // Verify all required documents are uploaded
    const requiredDocs = this.getRequiredDocuments(session.verification_type);
    const uploadedTypes = session.documents.map(d => d.type);
    
    const missingDocs = requiredDocs.filter(doc => !uploadedTypes.includes(doc));
    if (missingDocs.length > 0) {
      throw new Error(`Missing required documents: ${missingDocs.join(', ')}`);
    }

    // Perform verification checks
    const verificationResult = await this.performVerification(session);

    // Update session
    await prisma.verificationSession.update({
      where: { id: sessionId },
      data: {
        status: verificationResult.verified ? 'completed' : 'failed',
        result: verificationResult,
        completed_at: new Date(),
      },
    });

    // Update order verification status
    await prisma.order.update({
      where: { id: session.order_id },
      data: {
        id_verified: verificationResult.verified,
        id_verification_at: new Date(),
      },
    });

    // Log for compliance
    await this.complianceService.logVerification({
      sessionId,
      orderId: session.order_id,
      customerId: session.customer_id,
      result: verificationResult,
      documents: session.documents,
    });

    // Queue compliance check
    await this.verificationQueue.add('check-compliance', {
      sessionId,
      orderId: session.order_id,
      state: session.order.reskflow_state,
    });

    return verificationResult;
  }

  async verifyDelivery(params: {
    reskflowId: string;
    driverId: string;
    verificationCode?: string;
    photoUrl?: string;
  }): Promise<DeliveryVerification> {
    const reskflow = await prisma.reskflow.findUnique({
      where: { id: params.reskflowId },
      include: {
        order: {
          include: {
            verificationSession: true,
          },
        },
      },
    });

    if (!reskflow || reskflow.driver_id !== params.driverId) {
      throw new Error('Delivery not found or unauthorized');
    }

    if (!reskflow.order.id_verified) {
      throw new Error('Customer ID not verified');
    }

    // Verify using code or QR scan
    let verified = false;
    let method: 'code' | 'scan' | 'manual' = 'code';

    if (params.verificationCode) {
      // Verify code
      const session = reskflow.order.verificationSession;
      if (session && session.verification_code === params.verificationCode) {
        verified = true;
        method = 'code';
      }
    }

    if (!verified && params.photoUrl) {
      // Manual verification with photo
      verified = true;
      method = 'manual';
    }

    if (!verified) {
      throw new Error('Verification failed');
    }

    // Create reskflow verification record
    const verification = await prisma.reskflowVerification.create({
      data: {
        id: uuidv4(),
        reskflow_id: params.reskflowId,
        driver_id: params.driverId,
        verification_method: method,
        photo_url: params.photoUrl,
        verified_at: new Date(),
      },
    });

    // Update reskflow status
    await prisma.reskflow.update({
      where: { id: params.reskflowId },
      data: {
        id_verified: true,
        id_verification_photo: params.photoUrl,
      },
    });

    return {
      success: true,
      verificationId: verification.id,
      timestamp: new Date(),
      method,
    };
  }

  async getVerificationStatus(
    sessionId: string,
    userId: string
  ): Promise<{
    session: VerificationSession;
    progress: number;
    remainingSteps: string[];
    estimatedTime: number;
  }> {
    const session = await prisma.verificationSession.findUnique({
      where: { id: sessionId },
      include: {
        documents: true,
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // Calculate progress
    const requiredSteps = this.getVerificationSteps(session.verification_type);
    const completedSteps = this.getCompletedSteps(session);
    const progress = (completedSteps.length / requiredSteps.length) * 100;

    const remainingSteps = requiredSteps.filter(
      step => !completedSteps.includes(step)
    );

    return {
      session: this.mapToVerificationSession(session),
      progress,
      remainingSteps,
      estimatedTime: remainingSteps.length * 2, // 2 minutes per step
    };
  }

  async processVerification(data: any): Promise<void> {
    logger.info('Processing verification:', data);
    // Background verification processing
  }

  async getVerificationAnalytics(
    merchantId: string,
    period: string = '30d'
  ): Promise<VerificationAnalytics> {
    const days = parseInt(period) || 30;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all verifications for merchant orders
    const verifications = await prisma.$queryRaw`
      SELECT 
        vs.*,
        o.merchant_id
      FROM verification_sessions vs
      JOIN orders o ON vs.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND vs.created_at >= ${startDate}
    `;

    const verificationList = verifications as any[];
    const totalVerifications = verificationList.length;
    const successfulVerifications = verificationList.filter(
      v => v.status === 'completed' && v.result?.verified
    ).length;
    const failedVerifications = verificationList.filter(
      v => v.status === 'failed' || (v.status === 'completed' && !v.result?.verified)
    ).length;

    // Calculate average verification time
    const completionTimes = verificationList
      .filter(v => v.completed_at)
      .map(v => dayjs(v.completed_at).diff(v.created_at, 'minute'));

    const averageVerificationTime = completionTimes.length > 0
      ? completionTimes.reduce((a, b) => a + b, 0) / completionTimes.length
      : 0;

    // Group by type
    const byType = {
      age: 0,
      prescription: 0,
      both: 0,
    };

    verificationList.forEach(v => {
      byType[v.verification_type as keyof typeof byType]++;
    });

    // Analyze failure reasons
    const failureReasonCounts = new Map<string, number>();
    
    verificationList
      .filter(v => v.result?.failureReasons)
      .forEach(v => {
        v.result.failureReasons.forEach((reason: string) => {
          failureReasonCounts.set(reason, (failureReasonCounts.get(reason) || 0) + 1);
        });
      });

    const totalFailures = Array.from(failureReasonCounts.values()).reduce((a, b) => a + b, 0);
    
    const failureReasons = Array.from(failureReasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: totalFailures > 0 ? (count / totalFailures) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Calculate compliance rate
    const complianceRate = totalVerifications > 0
      ? (successfulVerifications / totalVerifications) * 100
      : 100;

    // Detect fraud attempts
    const fraudAttempts = verificationList.filter(
      v => v.fraud_detected || v.biometric_score < 0.7
    ).length;

    return {
      totalVerifications,
      successfulVerifications,
      failedVerifications,
      averageVerificationTime,
      verificationsByType: byType,
      failureReasons,
      complianceRate,
      fraudAttempts,
    };
  }

  private async determineVerificationRequirements(order: any): Promise<{
    requiresVerification: boolean;
    requiresAge: boolean;
    requiresPrescription: boolean;
    minimumAge?: number;
    prescriptionItems?: string[];
  }> {
    let requiresAge = false;
    let requiresPrescription = false;
    let minimumAge = 0;
    const prescriptionItems: string[] = [];

    for (const orderItem of order.orderItems) {
      const item = orderItem.item;
      
      // Check for age-restricted items
      if (item.age_restricted) {
        requiresAge = true;
        minimumAge = Math.max(minimumAge, item.minimum_age || 21);
      }

      // Check for prescription items
      if (item.requires_prescription) {
        requiresPrescription = true;
        prescriptionItems.push(item.id);
      }
    }

    return {
      requiresVerification: requiresAge || requiresPrescription,
      requiresAge,
      requiresPrescription,
      minimumAge: requiresAge ? minimumAge : undefined,
      prescriptionItems: requiresPrescription ? prescriptionItems : undefined,
    };
  }

  private async performVerification(session: any): Promise<VerificationResult> {
    const failureReasons: string[] = [];
    let ageVerified = true;
    let identityVerified = true;
    let prescriptionVerified = true;

    // Check biometric verification
    if (session.biometric_score && session.biometric_score < 0.8) {
      identityVerified = false;
      failureReasons.push('Face match failed');
    }

    // Age verification
    if (session.verification_type === 'age' || session.verification_type === 'both') {
      const idDoc = session.documents.find(
        (d: any) => d.type === 'drivers_license' || d.type === 'passport'
      );

      if (idDoc && idDoc.extracted_data) {
        const dob = idDoc.extracted_data.dateOfBirth;
        const age = dayjs().diff(dob, 'year');
        
        if (age < (session.requirements?.minimumAge || 21)) {
          ageVerified = false;
          failureReasons.push('Age requirement not met');
        }
      } else {
        ageVerified = false;
        failureReasons.push('Could not verify age from document');
      }
    }

    // Prescription verification
    if (session.verification_type === 'prescription' || session.verification_type === 'both') {
      const prescriptionDoc = session.documents.find(
        (d: any) => d.type === 'prescription'
      );

      if (prescriptionDoc) {
        const isValid = await this.prescriptionVerificationService.validatePrescription(
          prescriptionDoc.id,
          session.order_id
        );
        
        if (!isValid) {
          prescriptionVerified = false;
          failureReasons.push('Invalid prescription');
        }
      } else {
        prescriptionVerified = false;
        failureReasons.push('Prescription required');
      }
    }

    const verified = identityVerified && 
                    (session.verification_type === 'age' ? ageVerified : true) &&
                    (session.verification_type === 'prescription' ? prescriptionVerified : true);

    return {
      verified,
      ageVerified,
      identityVerified,
      prescriptionVerified,
      failureReasons: failureReasons.length > 0 ? failureReasons : undefined,
      verifiedAt: new Date(),
    };
  }

  private getRequiredDocuments(verificationType: string): string[] {
    switch (verificationType) {
      case 'age':
        return ['drivers_license', 'passport', 'state_id'];
      case 'prescription':
        return ['prescription'];
      case 'both':
        return ['drivers_license', 'passport', 'state_id', 'prescription'];
      default:
        return [];
    }
  }

  private getVerificationSteps(verificationType: string): string[] {
    const steps = ['upload_id', 'upload_selfie'];
    
    if (verificationType === 'prescription' || verificationType === 'both') {
      steps.push('upload_prescription');
    }
    
    return steps;
  }

  private getCompletedSteps(session: any): string[] {
    const completed: string[] = [];
    
    if (session.documents.some((d: any) => 
      ['drivers_license', 'passport', 'state_id'].includes(d.type)
    )) {
      completed.push('upload_id');
    }
    
    if (session.selfie_url) {
      completed.push('upload_selfie');
    }
    
    if (session.documents.some((d: any) => d.type === 'prescription')) {
      completed.push('upload_prescription');
    }
    
    return completed;
  }

  private async generateVerificationQR(sessionId: string): Promise<string> {
    const verificationUrl = `${process.env.APP_URL}/verify/${sessionId}`;
    const qrCode = await QRCode.toDataURL(verificationUrl);
    return qrCode;
  }

  private mapToVerificationSession(dbSession: any): VerificationSession {
    return {
      id: dbSession.id,
      orderId: dbSession.order_id,
      customerId: dbSession.customer_id,
      verificationType: dbSession.verification_type,
      status: dbSession.status,
      documents: dbSession.documents || [],
      selfie: dbSession.selfie_url,
      result: dbSession.result,
      expiresAt: dbSession.expires_at,
      createdAt: dbSession.created_at,
    };
  }
}