import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import Bull from 'bull';
import { logger, connectDB, authMiddleware } from '@reskflow/shared';
import { ChatService } from './services/ChatService';
import { SocketService } from './services/SocketService';
import { MessageService } from './services/MessageService';
import { NotificationService } from './services/NotificationService';
import { MediaService } from './services/MediaService';
import { ModerationService } from './services/ModerationService';
import multer from 'multer';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true,
  },
});

app.use(express.json());

// Initialize queues
const messageQueue = new Bull('message-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

const notificationQueue = new Bull('chat-notification-queue', {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
  },
});

// Initialize services
const mediaService = new MediaService();
const moderationService = new ModerationService();
const messageService = new MessageService(messageQueue, moderationService);
const notificationService = new NotificationService(notificationQueue);
const chatService = new ChatService(messageService, notificationService);
const socketService = new SocketService(io, chatService, messageService);

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

// Chat room routes
app.post('/api/chat/rooms', authMiddleware, async (req, res) => {
  try {
    const { orderId, participants } = req.body;
    
    const room = await chatService.createChatRoom({
      orderId,
      participants,
      createdBy: req.user.id,
    });
    
    res.json(room);
  } catch (error) {
    logger.error('Error creating chat room:', error);
    res.status(500).json({ error: 'Failed to create chat room' });
  }
});

app.get('/api/chat/rooms', authMiddleware, async (req, res) => {
  try {
    const rooms = await chatService.getUserChatRooms(req.user.id);
    res.json(rooms);
  } catch (error) {
    logger.error('Error getting chat rooms:', error);
    res.status(500).json({ error: 'Failed to get chat rooms' });
  }
});

app.get('/api/chat/rooms/:roomId', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await chatService.getChatRoom(roomId, req.user.id);
    res.json(room);
  } catch (error) {
    logger.error('Error getting chat room:', error);
    res.status(500).json({ error: 'Failed to get chat room' });
  }
});

// Message routes
app.get('/api/chat/rooms/:roomId/messages', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { limit = 50, before } = req.query;
    
    const messages = await messageService.getRoomMessages(
      roomId,
      req.user.id,
      parseInt(limit as string),
      before as string
    );
    
    res.json(messages);
  } catch (error) {
    logger.error('Error getting messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

app.post('/api/chat/rooms/:roomId/messages', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { content, type = 'text', metadata } = req.body;
    
    const message = await messageService.sendMessage({
      roomId,
      senderId: req.user.id,
      content,
      type,
      metadata,
    });
    
    res.json(message);
  } catch (error) {
    logger.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Media upload route
app.post('/api/chat/media/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { roomId } = req.body;
    
    const result = await mediaService.uploadMedia({
      file: req.file,
      userId: req.user.id,
      roomId,
    });
    
    res.json(result);
  } catch (error) {
    logger.error('Error uploading media:', error);
    res.status(500).json({ error: 'Failed to upload media' });
  }
});

// Quick replies routes
app.get('/api/chat/quick-replies/:context', authMiddleware, async (req, res) => {
  try {
    const { context } = req.params;
    const replies = await chatService.getQuickReplies(context, req.user.role);
    res.json(replies);
  } catch (error) {
    logger.error('Error getting quick replies:', error);
    res.status(500).json({ error: 'Failed to get quick replies' });
  }
});

// Typing indicators
app.post('/api/chat/rooms/:roomId/typing', authMiddleware, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { isTyping } = req.body;
    
    await socketService.broadcastTypingIndicator(roomId, req.user.id, isTyping);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error sending typing indicator:', error);
    res.status(500).json({ error: 'Failed to send typing indicator' });
  }
});

// Read receipts
app.put('/api/chat/messages/:messageId/read', authMiddleware, async (req, res) => {
  try {
    const { messageId } = req.params;
    
    await messageService.markMessageAsRead(messageId, req.user.id);
    res.json({ success: true });
  } catch (error) {
    logger.error('Error marking message as read:', error);
    res.status(500).json({ error: 'Failed to mark message as read' });
  }
});

// Analytics routes
app.get('/api/chat/analytics/response-time', authMiddleware, async (req, res) => {
  try {
    const { merchantId, period = '7d' } = req.query;
    
    const analytics = await chatService.getResponseTimeAnalytics(
      merchantId as string,
      period as string
    );
    
    res.json(analytics);
  } catch (error) {
    logger.error('Error getting response time analytics:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Process message queue
messageQueue.process(async (job) => {
  const { type, data } = job.data;
  
  switch (type) {
    case 'process-message':
      await messageService.processMessage(data);
      break;
    case 'translate-message':
      await messageService.translateMessage(data);
      break;
    case 'cleanup-old-messages':
      await messageService.cleanupOldMessages();
      break;
  }
});

// Process notification queue
notificationQueue.process(async (job) => {
  await notificationService.processNotification(job.data);
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'chat' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = process.env.PORT || 3015;

async function start() {
  try {
    await connectDB();
    
    // Initialize Socket.IO
    await socketService.initialize();
    
    httpServer.listen(PORT, () => {
      logger.info(`Chat service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start service:', error);
    process.exit(1);
  }
}

start();