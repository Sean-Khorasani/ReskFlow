import { prisma, logger } from '@reskflow/shared';
import { MessageService } from './MessageService';
import { NotificationService } from './NotificationService';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';

interface ChatRoom {
  id: string;
  orderId: string;
  participants: Participant[];
  createdAt: Date;
  updatedAt: Date;
  lastMessage?: {
    content: string;
    senderId: string;
    timestamp: Date;
  };
  unreadCount: number;
  isActive: boolean;
}

interface Participant {
  userId: string;
  role: 'customer' | 'driver' | 'merchant' | 'support';
  name: string;
  avatar?: string;
  joinedAt: Date;
  lastReadAt: Date;
  isOnline: boolean;
}

interface QuickReply {
  id: string;
  text: string;
  category: string;
  context: string;
  roles: string[];
}

interface ResponseTimeAnalytics {
  averageResponseTime: number;
  medianResponseTime: number;
  responseRate: number;
  totalConversations: number;
  byHour: Array<{
    hour: number;
    avgResponseTime: number;
    messageCount: number;
  }>;
  byParticipant: Array<{
    userId: string;
    name: string;
    avgResponseTime: number;
    messageCount: number;
  }>;
}

export class ChatService {
  constructor(
    private messageService: MessageService,
    private notificationService: NotificationService
  ) {}

  async createChatRoom(params: {
    orderId: string;
    participants: string[];
    createdBy: string;
  }): Promise<ChatRoom> {
    // Verify order exists
    const order = await prisma.order.findUnique({
      where: { id: params.orderId },
      include: {
        customer: true,
        merchant: true,
        reskflow: {
          include: {
            driver: true,
          },
        },
      },
    });

    if (!order) {
      throw new Error('Order not found');
    }

    // Check if chat room already exists
    const existingRoom = await prisma.chatRoom.findFirst({
      where: { order_id: params.orderId },
    });

    if (existingRoom) {
      return this.mapToChatRoom(existingRoom);
    }

    // Create participant list
    const participantData = await this.buildParticipantList(order, params.participants);

    // Create chat room
    const room = await prisma.chatRoom.create({
      data: {
        id: uuidv4(),
        order_id: params.orderId,
        participants: participantData,
        created_by: params.createdBy,
        is_active: true,
      },
    });

    // Send welcome message
    await this.sendSystemMessage(room.id, 'Chat room created for your order');

    // Notify participants
    await this.notifyParticipants(room.id, participantData, 'new_chat');

    return this.mapToChatRoom(room);
  }

  async getChatRoom(roomId: string, userId: string): Promise<ChatRoom> {
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      include: {
        messages: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });

    if (!room) {
      throw new Error('Chat room not found');
    }

    // Verify user is participant
    const participants = room.participants as any[];
    const isParticipant = participants.some(p => p.userId === userId);
    
    if (!isParticipant) {
      throw new Error('Unauthorized access to chat room');
    }

    // Get unread count
    const unreadCount = await this.getUnreadCount(roomId, userId);

    return {
      ...this.mapToChatRoom(room),
      unreadCount,
    };
  }

  async getUserChatRooms(userId: string): Promise<ChatRoom[]> {
    const rooms = await prisma.$queryRaw`
      SELECT 
        cr.*,
        m.content as last_message_content,
        m.sender_id as last_message_sender,
        m.created_at as last_message_time
      FROM chat_rooms cr
      LEFT JOIN LATERAL (
        SELECT content, sender_id, created_at
        FROM messages
        WHERE chat_room_id = cr.id
        ORDER BY created_at DESC
        LIMIT 1
      ) m ON true
      WHERE cr.participants @> ${JSON.stringify([{ userId }])}
        AND cr.is_active = true
      ORDER BY COALESCE(m.created_at, cr.created_at) DESC
    `;

    const roomsWithDetails = await Promise.all(
      (rooms as any[]).map(async (room) => {
        const unreadCount = await this.getUnreadCount(room.id, userId);
        
        return {
          ...this.mapToChatRoom(room),
          lastMessage: room.last_message_content ? {
            content: room.last_message_content,
            senderId: room.last_message_sender,
            timestamp: room.last_message_time,
          } : undefined,
          unreadCount,
        };
      })
    );

    return roomsWithDetails;
  }

  async getQuickReplies(context: string, userRole: string): Promise<QuickReply[]> {
    const quickReplies = await prisma.quickReply.findMany({
      where: {
        context,
        roles: { has: userRole },
        is_active: true,
      },
      orderBy: { order_index: 'asc' },
    });

    return quickReplies.map(reply => ({
      id: reply.id,
      text: reply.text,
      category: reply.category,
      context: reply.context,
      roles: reply.roles,
    }));
  }

  async updateParticipantStatus(
    roomId: string,
    userId: string,
    isOnline: boolean
  ): Promise<void> {
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
    });

    if (!room) return;

    const participants = room.participants as any[];
    const updatedParticipants = participants.map(p => {
      if (p.userId === userId) {
        return { ...p, isOnline };
      }
      return p;
    });

    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { participants: updatedParticipants },
    });
  }

  async updateLastRead(roomId: string, userId: string): Promise<void> {
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
    });

    if (!room) return;

    const participants = room.participants as any[];
    const updatedParticipants = participants.map(p => {
      if (p.userId === userId) {
        return { ...p, lastReadAt: new Date() };
      }
      return p;
    });

    await prisma.chatRoom.update({
      where: { id: roomId },
      data: { participants: updatedParticipants },
    });

    // Clear unread notifications
    await prisma.unreadMessage.deleteMany({
      where: {
        chat_room_id: roomId,
        user_id: userId,
      },
    });
  }

  async closeChatRoom(roomId: string): Promise<void> {
    await prisma.chatRoom.update({
      where: { id: roomId },
      data: {
        is_active: false,
        closed_at: new Date(),
      },
    });

    // Send closing message
    await this.sendSystemMessage(roomId, 'This chat has been closed');
  }

  async getResponseTimeAnalytics(
    merchantId: string,
    period: string = '7d'
  ): Promise<ResponseTimeAnalytics> {
    const days = parseInt(period) || 7;
    const startDate = dayjs().subtract(days, 'day').toDate();

    // Get all chat rooms for merchant orders
    const chatRooms = await prisma.$queryRaw`
      SELECT cr.*, o.merchant_id
      FROM chat_rooms cr
      JOIN orders o ON cr.order_id = o.id
      WHERE o.merchant_id = ${merchantId}
        AND cr.created_at >= ${startDate}
    `;

    const roomIds = (chatRooms as any[]).map(r => r.id);

    // Get all messages
    const messages = await prisma.message.findMany({
      where: {
        chat_room_id: { in: roomIds },
        created_at: { gte: startDate },
      },
      orderBy: { created_at: 'asc' },
    });

    // Calculate response times
    const responseTimes: number[] = [];
    const responsesByHour = new Map<number, number[]>();
    const responsesByUser = new Map<string, number[]>();

    // Group messages by room
    const messagesByRoom = new Map<string, any[]>();
    messages.forEach(msg => {
      if (!messagesByRoom.has(msg.chat_room_id)) {
        messagesByRoom.set(msg.chat_room_id, []);
      }
      messagesByRoom.get(msg.chat_room_id)!.push(msg);
    });

    // Calculate response times
    messagesByRoom.forEach(roomMessages => {
      for (let i = 1; i < roomMessages.length; i++) {
        const prevMsg = roomMessages[i - 1];
        const currMsg = roomMessages[i];

        if (prevMsg.sender_id !== currMsg.sender_id) {
          const responseTime = dayjs(currMsg.created_at).diff(prevMsg.created_at, 'minute');
          
          if (responseTime < 60 * 24) { // Only count responses within 24 hours
            responseTimes.push(responseTime);

            // By hour
            const hour = dayjs(currMsg.created_at).hour();
            if (!responsesByHour.has(hour)) {
              responsesByHour.set(hour, []);
            }
            responsesByHour.get(hour)!.push(responseTime);

            // By user
            if (!responsesByUser.has(currMsg.sender_id)) {
              responsesByUser.set(currMsg.sender_id, []);
            }
            responsesByUser.get(currMsg.sender_id)!.push(responseTime);
          }
        }
      }
    });

    // Calculate metrics
    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const sortedTimes = [...responseTimes].sort((a, b) => a - b);
    const medianResponseTime = sortedTimes.length > 0
      ? sortedTimes[Math.floor(sortedTimes.length / 2)]
      : 0;

    const responseRate = messagesByRoom.size > 0
      ? (responseTimes.length / messagesByRoom.size) * 100
      : 0;

    // By hour analytics
    const byHour = Array.from({ length: 24 }, (_, hour) => {
      const times = responsesByHour.get(hour) || [];
      return {
        hour,
        avgResponseTime: times.length > 0
          ? times.reduce((a, b) => a + b, 0) / times.length
          : 0,
        messageCount: times.length,
      };
    });

    // Get user details for participant analytics
    const userIds = Array.from(responsesByUser.keys());
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });

    const userMap = new Map(users.map(u => [u.id, u.name]));

    const byParticipant = Array.from(responsesByUser.entries())
      .map(([userId, times]) => ({
        userId,
        name: userMap.get(userId) || 'Unknown',
        avgResponseTime: times.reduce((a, b) => a + b, 0) / times.length,
        messageCount: times.length,
      }))
      .sort((a, b) => b.messageCount - a.messageCount);

    return {
      averageResponseTime,
      medianResponseTime,
      responseRate,
      totalConversations: messagesByRoom.size,
      byHour,
      byParticipant,
    };
  }

  private async buildParticipantList(order: any, requestedParticipants: string[]) {
    const participants: any[] = [];

    // Always include customer
    participants.push({
      userId: order.customer_id,
      role: 'customer',
      name: order.customer.name,
      avatar: order.customer.avatar_url,
      joinedAt: new Date(),
      lastReadAt: new Date(),
      isOnline: false,
    });

    // Include merchant if requested
    if (requestedParticipants.includes('merchant')) {
      const merchantUser = await prisma.user.findFirst({
        where: {
          merchant_id: order.merchant_id,
          role: 'MERCHANT',
        },
      });

      if (merchantUser) {
        participants.push({
          userId: merchantUser.id,
          role: 'merchant',
          name: order.merchant.name,
          avatar: order.merchant.logo_url,
          joinedAt: new Date(),
          lastReadAt: new Date(),
          isOnline: false,
        });
      }
    }

    // Include driver if assigned
    if (order.reskflow?.driver) {
      participants.push({
        userId: order.reskflow.driver_id,
        role: 'driver',
        name: order.reskflow.driver.name,
        avatar: order.reskflow.driver.avatar_url,
        joinedAt: new Date(),
        lastReadAt: new Date(),
        isOnline: false,
      });
    }

    return participants;
  }

  private async sendSystemMessage(roomId: string, content: string): Promise<void> {
    await this.messageService.sendMessage({
      roomId,
      senderId: 'system',
      content,
      type: 'system',
    });
  }

  private async notifyParticipants(
    roomId: string,
    participants: any[],
    type: string
  ): Promise<void> {
    for (const participant of participants) {
      if (participant.userId !== 'system') {
        await this.notificationService.sendChatNotification({
          userId: participant.userId,
          roomId,
          type,
          data: {
            message: 'You have been added to a chat',
          },
        });
      }
    }
  }

  private async getUnreadCount(roomId: string, userId: string): Promise<number> {
    const count = await prisma.unreadMessage.count({
      where: {
        chat_room_id: roomId,
        user_id: userId,
      },
    });

    return count;
  }

  private mapToChatRoom(dbRoom: any): ChatRoom {
    return {
      id: dbRoom.id,
      orderId: dbRoom.order_id,
      participants: dbRoom.participants,
      createdAt: dbRoom.created_at,
      updatedAt: dbRoom.updated_at,
      unreadCount: 0,
      isActive: dbRoom.is_active,
    };
  }
}