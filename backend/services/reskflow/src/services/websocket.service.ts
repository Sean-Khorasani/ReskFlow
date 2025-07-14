import { Server, Socket } from 'socket.io';
import { authenticateSocket } from '../middleware/auth.middleware';
import { redis } from '../config/redis';
import {
  WebSocketMessage,
  LocationUpdateMessage,
  StatusUpdateMessage,
  DeliveryAssignedMessage,
  NotificationMessage,
  DeliveryStatus,
} from '../types/reskflow.types';
import { websocketLogger } from '../utils/logger';
import { WebSocketConnectionError, WebSocketAuthError } from '../utils/errors';
import { DeliveryService } from './reskflow.service';
import { DriverService } from './driver.service';
import { TrackingService } from './tracking.service';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  role?: string;
  driverId?: string;
  merchantId?: string;
}

export class WebSocketService {
  private io: Server;
  private reskflowService: DeliveryService;
  private driverService: DriverService;
  private trackingService: TrackingService;
  private connectedClients: Map<string, AuthenticatedSocket> = new Map();

  constructor(io: Server) {
    this.io = io;
    this.reskflowService = new DeliveryService();
    this.driverService = new DriverService();
    this.trackingService = new TrackingService();
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.query.token;
        
        if (!token) {
          return next(new WebSocketAuthError('No authentication token provided'));
        }

        const user = await authenticateSocket(token as string);
        
        socket.userId = user.userId;
        socket.role = user.role;
        socket.driverId = user.driverId;
        socket.merchantId = user.merchantId;

        websocketLogger.info('WebSocket client authenticated', {
          socketId: socket.id,
          userId: user.userId,
          role: user.role,
        });

        next();
      } catch (error) {
        websocketLogger.warn('WebSocket authentication failed', {
          socketId: socket.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        next(new WebSocketAuthError('Authentication failed'));
      }
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: AuthenticatedSocket): void {
    try {
      const { userId, role, socketId } = socket;
      
      // Store connected client
      if (userId) {
        this.connectedClients.set(userId, socket);
      }

      websocketLogger.info('WebSocket client connected', {
        socketId: socket.id,
        userId,
        role,
      });

      // Join user-specific room
      if (userId) {
        socket.join(`user:${userId}`);
      }

      // Join role-specific room
      if (role) {
        socket.join(`role:${role}`);
      }

      // Setup event listeners
      this.setupSocketEventListeners(socket);

      // Handle disconnection
      socket.on('disconnect', (reason) => {
        this.handleDisconnection(socket, reason);
      });

      // Send welcome message
      socket.emit('connected', {
        message: 'Connected to reskflow service',
        timestamp: new Date().toISOString(),
      });

    } catch (error) {
      websocketLogger.error('Error handling WebSocket connection', {
        socketId: socket.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      socket.disconnect();
    }
  }

  private setupSocketEventListeners(socket: AuthenticatedSocket): void {
    // Join specific rooms (reskflow tracking, driver updates, etc.)
    socket.on('join_room', async (data: { room: string; id: string }) => {
      try {
        await this.handleJoinRoom(socket, data);
      } catch (error) {
        socket.emit('error', {
          message: 'Failed to join room',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Leave room
    socket.on('leave_room', (data: { room: string; id: string }) => {
      try {
        this.handleLeaveRoom(socket, data);
      } catch (error) {
        socket.emit('error', {
          message: 'Failed to leave room',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Driver location updates
    if (socket.role === 'DRIVER' && socket.driverId) {
      socket.on('location_update', async (data) => {
        try {
          await this.handleDriverLocationUpdate(socket, data);
        } catch (error) {
          socket.emit('error', {
            message: 'Failed to update location',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });

      socket.on('status_update', async (data) => {
        try {
          await this.handleDriverStatusUpdate(socket, data);
        } catch (error) {
          socket.emit('error', {
            message: 'Failed to update status',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    }

    // Delivery status updates
    socket.on('reskflow_status_update', async (data) => {
      try {
        await this.handleDeliveryStatusUpdate(socket, data);
      } catch (error) {
        socket.emit('error', {
          message: 'Failed to update reskflow status',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Subscribe to reskflow updates
    socket.on('subscribe_reskflow', async (data: { reskflowId: string }) => {
      try {
        await this.handleSubscribeDelivery(socket, data);
      } catch (error) {
        socket.emit('error', {
          message: 'Failed to subscribe to reskflow',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Unsubscribe from reskflow updates
    socket.on('unsubscribe_reskflow', (data: { reskflowId: string }) => {
      try {
        this.handleUnsubscribeDelivery(socket, data);
      } catch (error) {
        socket.emit('error', {
          message: 'Failed to unsubscribe from reskflow',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: new Date().toISOString() });
    });
  }

  private async handleJoinRoom(socket: AuthenticatedSocket, data: { room: string; id: string }): Promise<void> {
    const { room, id } = data;
    const roomName = `${room}:${id}`;

    // Validate authorization to join room
    const canJoin = await this.canJoinRoom(socket, room, id);
    if (!canJoin) {
      throw new WebSocketAuthError(`Not authorized to join room: ${roomName}`);
    }

    socket.join(roomName);
    
    websocketLogger.debug('Client joined room', {
      socketId: socket.id,
      userId: socket.userId,
      room: roomName,
    });

    socket.emit('joined_room', { room: roomName, timestamp: new Date().toISOString() });
  }

  private handleLeaveRoom(socket: AuthenticatedSocket, data: { room: string; id: string }): void {
    const { room, id } = data;
    const roomName = `${room}:${id}`;

    socket.leave(roomName);
    
    websocketLogger.debug('Client left room', {
      socketId: socket.id,
      userId: socket.userId,
      room: roomName,
    });

    socket.emit('left_room', { room: roomName, timestamp: new Date().toISOString() });
  }

  private async handleDriverLocationUpdate(socket: AuthenticatedSocket, data: any): Promise<void> {
    if (!socket.driverId) {
      throw new WebSocketAuthError('Driver ID not found');
    }

    const { location, heading, speed, accuracy } = data;

    // Update driver location
    await this.driverService.updateDriverLocation(socket.driverId, {
      location,
      heading,
      speed,
      accuracy,
    });

    // Get active deliveries for this driver
    const activeDeliveries = await this.getActiveDeliveriesForDriver(socket.driverId);

    // Broadcast location update to relevant rooms
    for (const reskflow of activeDeliveries) {
      // Update tracking
      await this.trackingService.updateTracking(reskflow.id, {
        location,
        timestamp: new Date(),
        status: reskflow.status,
      });

      // Broadcast to reskflow room
      const locationUpdate: LocationUpdateMessage = {
        type: 'LOCATION_UPDATE',
        data: {
          reskflowId: reskflow.id,
          location,
          heading,
          speed,
          timestamp: new Date(),
        },
        timestamp: new Date(),
        userId: socket.userId,
        reskflowId: reskflow.id,
      };

      this.io.to(`reskflow:${reskflow.id}`).emit('location_update', locationUpdate);
    }

    websocketLogger.debug('Driver location updated via WebSocket', {
      driverId: socket.driverId,
      location,
      activeDeliveries: activeDeliveries.length,
    });
  }

  private async handleDriverStatusUpdate(socket: AuthenticatedSocket, data: any): Promise<void> {
    if (!socket.driverId) {
      throw new WebSocketAuthError('Driver ID not found');
    }

    const { available, location } = data;

    // Update driver availability
    await this.driverService.updateDriverAvailability(socket.driverId, {
      available,
      location,
    });

    // Broadcast status update
    this.io.to(`driver:${socket.driverId}`).emit('driver_status_update', {
      driverId: socket.driverId,
      available,
      timestamp: new Date().toISOString(),
    });

    websocketLogger.debug('Driver status updated via WebSocket', {
      driverId: socket.driverId,
      available,
    });
  }

  private async handleDeliveryStatusUpdate(socket: AuthenticatedSocket, data: any): Promise<void> {
    const { reskflowId, status, notes } = data;

    // Validate authorization
    const canUpdate = await this.canUpdateDelivery(socket, reskflowId);
    if (!canUpdate) {
      throw new WebSocketAuthError('Not authorized to update reskflow');
    }

    // Update reskflow status
    await this.reskflowService.updateDelivery(reskflowId, {
      status,
      reskflowNotes: notes,
    });

    // Broadcast status update
    const statusUpdate: StatusUpdateMessage = {
      type: 'STATUS_UPDATE',
      data: {
        reskflowId,
        status,
        timestamp: new Date(),
        notes,
      },
      timestamp: new Date(),
      userId: socket.userId,
      reskflowId,
    };

    this.io.to(`reskflow:${reskflowId}`).emit('status_update', statusUpdate);

    websocketLogger.info('Delivery status updated via WebSocket', {
      reskflowId,
      status,
      updatedBy: socket.userId,
    });
  }

  private async handleSubscribeDelivery(socket: AuthenticatedSocket, data: { reskflowId: string }): Promise<void> {
    const { reskflowId } = data;

    // Validate authorization
    const canSubscribe = await this.canSubscribeToDelivery(socket, reskflowId);
    if (!canSubscribe) {
      throw new WebSocketAuthError('Not authorized to subscribe to reskflow');
    }

    // Join reskflow room
    socket.join(`reskflow:${reskflowId}`);

    // Send current reskflow status
    const reskflow = await this.reskflowService.getDeliveryById(reskflowId);
    const trackingInfo = await this.trackingService.getTrackingInfo(reskflowId);

    socket.emit('reskflow_subscribed', {
      reskflowId,
      reskflow,
      trackingInfo,
      timestamp: new Date().toISOString(),
    });

    websocketLogger.debug('Client subscribed to reskflow', {
      socketId: socket.id,
      userId: socket.userId,
      reskflowId,
    });
  }

  private handleUnsubscribeDelivery(socket: AuthenticatedSocket, data: { reskflowId: string }): void {
    const { reskflowId } = data;

    socket.leave(`reskflow:${reskflowId}`);

    socket.emit('reskflow_unsubscribed', {
      reskflowId,
      timestamp: new Date().toISOString(),
    });

    websocketLogger.debug('Client unsubscribed from reskflow', {
      socketId: socket.id,
      userId: socket.userId,
      reskflowId,
    });
  }

  private handleDisconnection(socket: AuthenticatedSocket, reason: string): void {
    const { userId, socketId } = socket;

    // Remove from connected clients
    if (userId) {
      this.connectedClients.delete(userId);
    }

    websocketLogger.info('WebSocket client disconnected', {
      socketId: socket.id,
      userId,
      reason,
    });
  }

  // Public methods for broadcasting events

  public async broadcastDeliveryAssigned(reskflowId: string, driverId: string): Promise<void> {
    const message: DeliveryAssignedMessage = {
      type: 'DELIVERY_ASSIGNED',
      data: {
        reskflowId,
        driverId,
        timestamp: new Date(),
      },
      timestamp: new Date(),
      reskflowId,
    };

    this.io.to(`reskflow:${reskflowId}`).emit('reskflow_assigned', message);
    this.io.to(`driver:${driverId}`).emit('reskflow_assigned', message);
  }

  public async broadcastLocationUpdate(reskflowId: string, location: any, driverId?: string): Promise<void> {
    const message: LocationUpdateMessage = {
      type: 'LOCATION_UPDATE',
      data: {
        reskflowId,
        location,
        timestamp: new Date(),
      },
      timestamp: new Date(),
      reskflowId,
    };

    this.io.to(`reskflow:${reskflowId}`).emit('location_update', message);
  }

  public async broadcastStatusUpdate(reskflowId: string, status: DeliveryStatus, notes?: string): Promise<void> {
    const message: StatusUpdateMessage = {
      type: 'STATUS_UPDATE',
      data: {
        reskflowId,
        status,
        timestamp: new Date(),
        notes,
      },
      timestamp: new Date(),
      reskflowId,
    };

    this.io.to(`reskflow:${reskflowId}`).emit('status_update', message);
  }

  public async sendNotification(userId: string, notification: Omit<NotificationMessage, 'timestamp'>): Promise<void> {
    const message: NotificationMessage = {
      ...notification,
      timestamp: new Date(),
    };

    // Send to user's room
    this.io.to(`user:${userId}`).emit('notification', message);

    // Also send to connected client if available
    const client = this.connectedClients.get(userId);
    if (client) {
      client.emit('notification', message);
    }
  }

  // Authorization helpers

  private async canJoinRoom(socket: AuthenticatedSocket, room: string, id: string): Promise<boolean> {
    const { userId, role, driverId, merchantId } = socket;

    switch (room) {
      case 'reskflow':
        return this.canSubscribeToDelivery(socket, id);
      case 'driver':
        return role === 'DRIVER' && driverId === id;
      case 'merchant':
        return role === 'MERCHANT' && merchantId === id;
      case 'user':
        return userId === id;
      default:
        return false;
    }
  }

  private async canSubscribeToDelivery(socket: AuthenticatedSocket, reskflowId: string): Promise<boolean> {
    const { userId, role, driverId, merchantId } = socket;

    try {
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);

      // Admins can subscribe to any reskflow
      if (role === 'ADMIN') return true;

      // Customers can subscribe to their own deliveries
      if (role === 'CUSTOMER' && reskflow.customerId === userId) return true;

      // Drivers can subscribe to assigned deliveries
      if (role === 'DRIVER' && reskflow.driverId === driverId) return true;

      // Merchants can subscribe to their deliveries
      if (role === 'MERCHANT' && reskflow.merchantId === merchantId) return true;

      return false;
    } catch (error) {
      return false;
    }
  }

  private async canUpdateDelivery(socket: AuthenticatedSocket, reskflowId: string): Promise<boolean> {
    const { userId, role, driverId } = socket;

    try {
      const reskflow = await this.reskflowService.getDeliveryById(reskflowId);

      // Admins can update any reskflow
      if (role === 'ADMIN') return true;

      // Drivers can update their assigned deliveries
      if (role === 'DRIVER' && reskflow.driverId === driverId) return true;

      return false;
    } catch (error) {
      return false;
    }
  }

  private async getActiveDeliveriesForDriver(driverId: string) {
    // This would get deliveries from the database
    // For now, return empty array as placeholder
    return [];
  }

  // Health check
  public getConnectionStats() {
    return {
      connectedClients: this.connectedClients.size,
      totalConnections: this.io.engine.clientsCount,
      rooms: Object.keys(this.io.sockets.adapter.rooms),
    };
  }
}

// Export function to initialize WebSocket service
export function initializeWebSocket(io: Server): WebSocketService {
  return new WebSocketService(io);
}