import express from 'express';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { IDVerificationService } from './services/IDVerificationService';
import { AgeVerificationService } from './services/AgeVerificationService';
import { PrescriptionVerificationService } from './services/PrescriptionVerificationService';
import { ComplianceService } from './services/ComplianceService';
import { DocumentScanService } from './services/DocumentScanService';
import { BiometricService } from './services/BiometricService';
import multer from 'multer';

const app = express();
app.use(express.json());

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Initialize queues
const verificationQueue = new Bull('verification-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const complianceQueue = new Bull('compliance-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const documentScanService = new DocumentScanService();
const biometricService = new BiometricService();
const complianceService = new ComplianceService(complianceQueue);
const ageVerificationService = new AgeVerificationService(documentScanService);
const prescriptionVerificationService = new PrescriptionVerificationService();
const idVerificationService = new IDVerificationService(
  ageVerificationService,
  prescriptionVerificationService,
  documentScanService,
  biometricService,
  complianceService,
  verificationQueue
);

// ID Verification routes
app.post('/api/verification/initiate', authMiddleware, async (req, res) => {
  try {
    const { orderId, verificationType } = req.body;
    
    const session = await idVerificationService.initiateVerification({
      orderId,
      customerId: req.user.id,
      verificationType,
    });
    
    res.json(session);
  } catch (error) {
    logger.error('Error initiating verification:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/verification/upload-id', authMiddleware, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document uploaded' });
    }

    const { sessionId, documentType, side } = req.body;
    
    const result = await idVerificationService.uploadDocument({
      sessionId,
      file: req.file,
      documentType,
      side,
      uploadedBy: req.user.id,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error uploading document:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/verification/selfie', authMiddleware, upload.single('selfie'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No selfie uploaded' });
    }

    const { sessionId } = req.body;
    
    const result = await idVerificationService.uploadSelfie({
      sessionId,
      file: req.file,
      uploadedBy: req.user.id,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error uploading selfie:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/verification/complete', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    const result = await idVerificationService.completeVerification(
      sessionId,
      req.user.id
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error completing verification:', error);
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/verification/status/:sessionId', authMiddleware, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const status = await idVerificationService.getVerificationStatus(
      sessionId,
      req.user.id
    );
    
    res.json(status);
  } catch (error) {
    logger.error('Error getting verification status:', error);
    res.status(400).json({ error: error.message });
  }
});

// Age verification routes
app.post('/api/age-verification/check', authMiddleware, async (req, res) => {
  try {
    const { customerId, dateOfBirth, productType } = req.body;
    
    const result = await ageVerificationService.verifyAge({
      customerId,
      dateOfBirth,
      productType,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error verifying age:', error);
    res.status(400).json({ error: error.message });
  }
});

// Prescription verification routes
app.post('/api/prescription/upload', authMiddleware, upload.single('prescription'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No prescription uploaded' });
    }

    const { orderId, prescribedBy, expiryDate } = req.body;
    
    const result = await prescriptionVerificationService.uploadPrescription({
      orderId,
      customerId: req.user.id,
      file: req.file,
      prescribedBy,
      expiryDate,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error uploading prescription:', error);
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/prescription/verify', authMiddleware, async (req, res) => {
  try {
    const { prescriptionId, orderId } = req.body;
    
    const result = await prescriptionVerificationService.verifyPrescription(
      prescriptionId,
      orderId
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error verifying prescription:', error);
    res.status(400).json({ error: error.message });
  }
});

// Driver verification routes
app.post('/api/driver/verify-reskflow', authMiddleware, async (req, res) => {
  try {
    const { reskflowId, verificationCode, photoUrl } = req.body;
    
    const result = await idVerificationService.verifyDelivery({
      reskflowId,
      driverId: req.user.id,
      verificationCode,
      photoUrl,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error verifying reskflow:', error);
    res.status(400).json({ error: error.message });
  }
});

// Compliance routes
app.get('/api/compliance/requirements/:state', authMiddleware, async (req, res) => {
  try {
    const { state } = req.params;
    const { productType } = req.query;
    
    const requirements = await complianceService.getStateRequirements(
      state,
      productType as string
    );
    
    res.json(requirements);
  } catch (error) {
    logger.error('Error getting compliance requirements:', error);
    res.status(500).json({ error: 'Failed to get requirements' });
  }
});

app.get('/api/compliance/audit-log', authMiddleware, async (req, res) => {
  try {
    const { orderId, startDate, endDate } = req.query;
    
    const logs = await complianceService.getAuditLog({
      orderId: orderId as string,
      startDate: startDate as string,
      endDate: endDate as string,
    });
    
    res.json(logs);
  } catch (error) {
    logger.error('Error getting audit log:', error);
    res.status(500).json({ error: 'Failed to get audit log' });
  }
});

// Analytics routes
app.get('/api/verification/analytics', authMiddleware, async (req, res) => {
  try {
    const { merchantId, period = '30d' } = req.query;
    
    const analytics = await idVerificationService.getVerificationAnalytics(
      merchantId as string,
      period as string
    );
    
    res.json(analytics);
  } catch (error) {
    logger.error('Error getting verification analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Process queues
verificationQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'process-document':
      await documentScanService.processDocument(data);
      break;
    case 'verify-identity':
      await idVerificationService.processVerification(data);
      break;
    case 'check-compliance':
      await complianceService.checkCompliance(data);
      break;
  }
});

complianceQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'audit-verification':
      await complianceService.auditVerification(data);
      break;
    case 'generate-report':
      await complianceService.generateComplianceReport(data);
      break;
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'id-verification' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3018;

async function start() {
  try {
    await connectDB();
    
    app.listen(PORT, () => {
      logger.info(`ID verification service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();