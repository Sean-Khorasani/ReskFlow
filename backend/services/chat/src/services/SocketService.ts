import { Server, Socket } from 'socket.io';
import { prisma, logger } from '@reskflow/shared';
import { ChatService } from './ChatService';
import { MessageService } from './MessageService';
import jwt from 'jsonwebtoken';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

interface SocketMessage {
  roomId: string;
  content: string;
  type: 'text' | 'image' | 'location' | 'quick_reply';
  metadata?: any;
}

export class SocketService {
  private userSockets: Map<string, Set<string>> = new Map();
  private socketUsers: Map<string, string> = new Map();

  constructor(
    private io: Server,
    private chatService: ChatService,
    private messageService: MessageService
  ) {}

  async initialize() {
    // Authentication middleware
    this.io.use(async (socket: AuthenticatedSocket, next) => {
      try {
        const token = socket.handshake.auth.token;
        if (!token) {
          return next(new Error('Authentication required'));
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
        socket.userId = decoded.userId;
        socket.userRole = decoded.role;

        // Store socket mapping
        this.addUserSocket(decoded.userId, socket.id);

        next();
      } catch (error) {
        next(new Error('Invalid token'));
      }
    });

    // Connection handler
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      logger.info(`User ${socket.userId} connected with socket ${socket.id}`);

      // Join user's rooms
      this.joinUserRooms(socket);

      // Handle events
      this.setupEventHandlers(socket);

      // Handle disconnection
      socket.on('disconnect', () => {
        logger.info(`User ${socket.userId} disconnected`);
        this.removeUserSocket(socket.userId!, socket.id);
      });
    });
  }

  private async joinUserRooms(socket: AuthenticatedSocket) {
    try {
      const rooms = await this.chatService.getUserChatRooms(socket.userId!);
      
      for (const room of rooms) {
        socket.join(room.id);
        
        // Update online status
        await this.chatService.updateParticipantStatus(room.id, socket.userId!, true);
        
        // Notify other participants
        socket.to(room.id).emit('user_online', {
          roomId: room.id,
          userId: socket.userId,
        });
      }
    } catch (error) {
      logger.error('Error joining rooms:', error);
    }
  }

  private setupEventHandlers(socket: AuthenticatedSocket) {
    // Join room
    socket.on('join_room', async (roomId: string) => {
      try {
        // Verify user has access
        const room = await this.chatService.getChatRoom(roomId, socket.userId!);
        
        socket.join(roomId);
        
        // Update online status
        await this.chatService.updateParticipantStatus(roomId, socket.userId!, true);
        
        // Send room data
        socket.emit('room_joined', room);
        
        // Notify others
        socket.to(roomId).emit('user_joined', {
          roomId,
          userId: socket.userId,
        });
      } catch (error) {
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    // Leave room
    socket.on('leave_room', async (roomId: string) => {
      socket.leave(roomId);
      
      // Update online status
      await this.chatService.updateParticipantStatus(roomId, socket.userId!, false);
      
      // Notify others
      socket.to(roomId).emit('user_left', {
        roomId,
        userId: socket.userId,
      });
    });

    // Send message
    socket.on('send_message', async (data: SocketMessage) => {
      try {
        const message = await this.messageService.sendMessage({
          roomId: data.roomId,
          senderId: socket.userId!,
          content: data.content,
          type: data.type,
          metadata: data.metadata,
        });

        // Emit to room
        this.io.to(data.roomId).emit('new_message', message);

        // Send push notifications to offline users
        await this.sendOfflineNotifications(data.roomId, socket.userId!, message);
      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('typing', async (data: { roomId: string; isTyping: boolean }) => {
      socket.to(data.roomId).emit('user_typing', {
        roomId: data.roomId,
        userId: socket.userId,
        isTyping: data.isTyping,
      });
    });

    // Mark messages as read
    socket.on('mark_read', async (data: { roomId: string; messageIds: string[] }) => {
      try {
        await Promise.all(
          data.messageIds.map(id => 
            this.messageService.markMessageAsRead(id, socket.userId!)
          )
        );

        // Update last read
        await this.chatService.updateLastRead(data.roomId, socket.userId!);

        // Notify sender
        socket.to(data.roomId).emit('messages_read', {
          roomId: data.roomId,
          userId: socket.userId,
          messageIds: data.messageIds,
        });
      } catch (error) {
        socket.emit('error', { message: 'Failed to mark messages as read' });
      }
    });

    // Request older messages
    socket.on('load_more_messages', async (data: { roomId: string; before: string }) => {
      try {
        const messages = await this.messageService.getRoomMessages(
          data.roomId,
          socket.userId!,
          50,
          data.before
        );

        socket.emit('more_messages', {
          roomId: data.roomId,
          messages,
        });
      } catch (error) {
        socket.emit('error', { message: 'Failed to load messages' });
      }
    });

    // Send location
    socket.on('send_location', async (data: {
      roomId: string;
      latitude: number;
      longitude: number;
    }) => {
      try {
        const message = await this.messageService.sendMessage({
          roomId: data.roomId,
          senderId: socket.userId!,
          content: 'Shared location',
          type: 'location',
          metadata: {
            latitude: data.latitude,
            longitude: data.longitude,
          },
        });

        this.io.to(data.roomId).emit('new_message', message);
      } catch (error) {
        socket.emit('error', { message: 'Failed to send location' });
      }
    });

    // Get online users
    socket.on('get_online_users', async (roomId: string) => {
      const onlineUsers = this.getRoomOnlineUsers(roomId);
      socket.emit('online_users', {
        roomId,
        users: onlineUsers,
      });
    });
  }

  async broadcastTypingIndicator(
    roomId: string,
    userId: string,
    isTyping: boolean
  ): Promise<void> {
    this.io.to(roomId).emit('user_typing', {
      roomId,
      userId,
      isTyping,
    });
  }

  async broadcastMessage(roomId: string, message: any): Promise<void> {
    this.io.to(roomId).emit('new_message', message);
  }

  async broadcastToUser(userId: string, event: string, data: any): Promise<void> {
    const socketIds = this.userSockets.get(userId);
    if (socketIds) {
      socketIds.forEach(socketId => {
        this.io.to(socketId).emit(event, data);
      });
    }
  }

  private addUserSocket(userId: string, socketId: string) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socketId);
    this.socketUsers.set(socketId, userId);
  }

  private removeUserSocket(userId: string, socketId: string) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }
    this.socketUsers.delete(socketId);
  }

  private getRoomOnlineUsers(roomId: string): string[] {
    const room = this.io.sockets.adapter.rooms.get(roomId);
    if (!room) return [];

    const onlineUsers: string[] = [];
    room.forEach(socketId => {
      const userId = this.socketUsers.get(socketId);
      if (userId && !onlineUsers.includes(userId)) {
        onlineUsers.push(userId);
      }
    });

    return onlineUsers;
  }

  private async sendOfflineNotifications(
    roomId: string,
    senderId: string,
    message: any
  ): Promise<void> {
    try {
      const room = await prisma.chatRoom.findUnique({
        where: { id: roomId },
      });

      if (!room) return;

      const participants = room.participants as any[];
      const onlineUsers = this.getRoomOnlineUsers(roomId);

      for (const participant of participants) {
        if (participant.userId !== senderId && !onlineUsers.includes(participant.userId)) {
          // User is offline, send push notification
          await prisma.unreadMessage.create({
            data: {
              user_id: participant.userId,
              chat_room_id: roomId,
              message_id: message.id,
            },
          });

          // Queue push notification
          // This would integrate with your push notification service
          logger.info(`Queuing push notification for offline user ${participant.userId}`);
        }
      }
    } catch (error) {
      logger.error('Error sending offline notifications:', error);
    }
  }
}