import express from 'express';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { ContactlessDeliveryService } from './services/ContactlessDeliveryService';
import { VerificationService } from './services/VerificationService';
import { PhotoUploadService } from './services/PhotoUploadService';
import { NotificationService } from './services/NotificationService';
import { SafeDropService } from './services/SafeDropService';

const app = express();
app.use(express.json());

// Initialize queues
const verificationQueue = new Bull('verification-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const notificationQueue = new Bull('notification-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const verificationService = new VerificationService();
const photoUploadService = new PhotoUploadService();
const notificationService = new NotificationService(notificationQueue);
const safeDropService = new SafeDropService();
const contactlessService = new ContactlessDeliveryService(
  verificationService,
  photoUploadService,
  notificationService,
  safeDropService
);

// Customer routes
app.post('/api/orders/:orderId/contactless', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { 
      dropLocation, 
      instructions, 
      requirePhoto, 
      requireSignature,
      notifyOnDelivery 
    } = req.body;
    
    const result = await contactlessService.enableContactlessDelivery({
      orderId,
      customerId: req.user.id,
      dropLocation,
      instructions,
      requirePhoto,
      requireSignature,
      notifyOnDelivery,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error enabling contactless reskflow:', error);
    res.status(500).json({ error: 'Failed to enable contactless reskflow' });
  }
});

app.get('/api/orders/:orderId/contactless', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const settings = await contactlessService.getContactlessSettings(orderId);
    res.json(settings);
  } catch (error) {
    logger.error('Error getting contactless settings:', error);
    res.status(500).json({ error: 'Failed to get contactless settings' });
  }
});

app.put('/api/orders/:orderId/contactless', authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.params;
    const updates = req.body;
    
    const result = await contactlessService.updateContactlessSettings(
      orderId,
      req.user.id,
      updates
    );
    
    res.json(result);
  } catch (error) {
    logger.error('Error updating contactless settings:', error);
    res.status(500).json({ error: 'Failed to update contactless settings' });
  }
});

// Driver routes
app.post('/api/deliveries/:reskflowId/verify-drop', authMiddleware, async (req, res) => {
  try {
    const { reskflowId } = req.params;
    const { 
      photoUrl, 
      location, 
      notes,
      signatureData 
    } = req.body;
    
    const result = await contactlessService.verifyDropoff({
      reskflowId,
      driverId: req.user.id,
      photoUrl,
      location,
      notes,
      signatureData,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error verifying dropoff:', error);
    res.status(500).json({ error: 'Failed to verify dropoff' });
  }
});

app.post('/api/deliveries/:reskflowId/safe-drop', authMiddleware, async (req, res) => {
  try {
    const { reskflowId } = req.params;
    const { reason, safeLocation, photoUrl } = req.body;
    
    const result = await safeDropService.initiateSafeDrop({
      reskflowId,
      driverId: req.user.id,
      reason,
      safeLocation,
      photoUrl,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error initiating safe drop:', error);
    res.status(500).json({ error: 'Failed to initiate safe drop' });
  }
});

app.get('/api/deliveries/:reskflowId/drop-locations', authMiddleware, async (req, res) => {
  try {
    const { reskflowId } = req.params;
    const locations = await safeDropService.getSuggestedDropLocations(reskflowId);
    res.json(locations);
  } catch (error) {
    logger.error('Error getting drop locations:', error);
    res.status(500).json({ error: 'Failed to get drop locations' });
  }
});

// Verification routes
app.get('/api/verify/:code', async (req, res) => {
  try {
    const { code } = req.params;
    const verification = await verificationService.verifyCode(code);
    res.json(verification);
  } catch (error) {
    logger.error('Error verifying code:', error);
    res.status(400).json({ error: 'Invalid verification code' });
  }
});

app.post('/api/photo-upload', authMiddleware, async (req, res) => {
  try {
    const { base64Image, metadata } = req.body;
    const url = await photoUploadService.uploadPhoto(base64Image, metadata);
    res.json({ url });
  } catch (error) {
    logger.error('Error uploading photo:', error);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Analytics routes
app.get('/api/analytics/contactless', authMiddleware, async (req, res) => {
  try {
    const { merchantId, period = '30d' } = req.query;
    const analytics = await contactlessService.getContactlessAnalytics(
      merchantId as string,
      period as string
    );
    res.json(analytics);
  } catch (error) {
    logger.error('Error getting contactless analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Process verification queue
verificationQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'send-verification':
      await verificationService.sendVerificationCode(data);
      break;
    case 'cleanup-expired':
      await verificationService.cleanupExpiredCodes();
      break;
  }
});

// Process notification queue
notificationQueue.process(async (job) => {
  await notificationService.processNotification(job.data);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'contactless-reskflow' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3014;

async function start() {
  try {
    await connectDB();
    
    app.listen(PORT, () => {
      logger.info(`Contactless reskflow service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();