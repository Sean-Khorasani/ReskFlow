import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../utils/logger';
import { getSubClient } from '../config/redis';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  role?: string;
  merchantId?: string;
}

export function initializeWebSocket(io: Server) {
  const subClient = getSubClient();

  // Authentication middleware
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwt.secret) as any;
      socket.userId = decoded.userId;
      socket.role = decoded.role;
      socket.merchantId = decoded.merchantId;
      
      next();
    } catch (error) {
      logger.error('WebSocket authentication failed:', error);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`User ${socket.userId} connected via WebSocket`);

    // Join user-specific room
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    // Join merchant room if applicable
    if (socket.merchantId) {
      socket.join(`merchant:${socket.merchantId}`);
    }

    // Subscribe to order updates
    socket.on('subscribe:order', (orderId: string) => {
      socket.join(`order:${orderId}`);
      logger.debug(`User ${socket.userId} subscribed to order ${orderId}`);
    });

    socket.on('unsubscribe:order', (orderId: string) => {
      socket.leave(`order:${orderId}`);
      logger.debug(`User ${socket.userId} unsubscribed from order ${orderId}`);
    });

    // Handle merchant order list subscription
    if (socket.role === 'MERCHANT' && socket.merchantId) {
      socket.on('subscribe:merchant:orders', () => {
        socket.join(`merchant:${socket.merchantId}:orders`);
        logger.debug(`Merchant ${socket.merchantId} subscribed to order updates`);
      });
    }

    socket.on('disconnect', () => {
      logger.info(`User ${socket.userId} disconnected from WebSocket`);
    });
  });

  // Subscribe to Redis pub/sub for real-time updates
  subClient.subscribe('order:updates');
  subClient.subscribe('order:status');

  subClient.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      
      switch (channel) {
        case 'order:updates':
          // Send to specific order room
          io.to(`order:${data.orderId}`).emit('order:updated', data);
          
          // Send to user
          if (data.userId) {
            io.to(`user:${data.userId}`).emit('order:updated', data);
          }
          
          // Send to merchant
          if (data.merchantId) {
            io.to(`merchant:${data.merchantId}:orders`).emit('order:updated', data);
          }
          break;
          
        case 'order:status':
          // Send status updates
          io.to(`order:${data.orderId}`).emit('order:status', {
            orderId: data.orderId,
            status: data.status,
            timestamp: data.timestamp,
          });
          break;
      }
    } catch (error) {
      logger.error('Failed to process Redis message:', error);
    }
  });

  return io;
}

export function emitOrderUpdate(io: Server, orderId: string, update: any) {
  io.to(`order:${orderId}`).emit('order:updated', update);
}

export function emitMerchantOrderUpdate(io: Server, merchantId: string, update: any) {
  io.to(`merchant:${merchantId}:orders`).emit('order:new', update);
}