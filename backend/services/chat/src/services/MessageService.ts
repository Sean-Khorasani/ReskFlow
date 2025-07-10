import Bull from 'bull';
import { prisma, logger } from '@reskflow/shared';
import { ModerationService } from './ModerationService';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';

interface Message {
  id: string;
  roomId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'location' | 'system' | 'quick_reply';
  metadata?: any;
  isEdited: boolean;
  isDeleted: boolean;
  readBy: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface MessageParams {
  roomId: string;
  senderId: string;
  content: string;
  type?: string;
  metadata?: any;
  replyTo?: string;
}

interface TranslationCache {
  [key: string]: { [lang: string]: string };
}

export class MessageService {
  private translationCache: TranslationCache = {};

  constructor(
    private messageQueue: Bull.Queue,
    private moderationService: ModerationService
  ) {}

  async sendMessage(params: MessageParams): Promise<Message> {
    // Verify sender has access to room
    if (params.senderId !== 'system') {
      const room = await prisma.chatRoom.findUnique({
        where: { id: params.roomId },
      });

      if (!room) {
        throw new Error('Chat room not found');
      }

      const participants = room.participants as any[];
      const isParticipant = participants.some(p => p.userId === params.senderId);
      
      if (!isParticipant) {
        throw new Error('User is not a participant in this chat');
      }
    }

    // Moderate content
    if (params.type === 'text' && params.senderId !== 'system') {
      const moderation = await this.moderationService.moderateContent(params.content);
      
      if (moderation.blocked) {
        throw new Error(`Message blocked: ${moderation.reason}`);
      }

      if (moderation.flagged) {
        // Log flagged content for review
        await prisma.flaggedMessage.create({
          data: {
            content: params.content,
            sender_id: params.senderId,
            reason: moderation.reason,
            severity: moderation.severity,
          },
        });
      }
    }

    // Create message
    const message = await prisma.message.create({
      data: {
        id: uuidv4(),
        chat_room_id: params.roomId,
        sender_id: params.senderId,
        content: params.content,
        type: params.type || 'text',
        metadata: params.metadata || {},
        reply_to_id: params.replyTo,
        read_by: [params.senderId],
      },
    });

    // Update room's last activity
    await prisma.chatRoom.update({
      where: { id: params.roomId },
      data: { updated_at: new Date() },
    });

    // Queue for processing (translations, notifications, etc.)
    await this.messageQueue.add('process-message', {
      messageId: message.id,
      roomId: params.roomId,
      senderId: params.senderId,
    });

    return this.mapToMessage(message);
  }

  async getRoomMessages(
    roomId: string,
    userId: string,
    limit: number = 50,
    before?: string
  ): Promise<Message[]> {
    // Verify user has access
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new Error('Chat room not found');
    }

    const participants = room.participants as any[];
    const isParticipant = participants.some(p => p.userId === userId);
    
    if (!isParticipant) {
      throw new Error('Unauthorized access to messages');
    }

    // Get messages
    const messages = await prisma.message.findMany({
      where: {
        chat_room_id: roomId,
        ...(before && { created_at: { lt: new Date(before) } }),
        is_deleted: false,
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            avatar_url: true,
          },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            sender_id: true,
          },
        },
      },
    });

    // Check translations
    const userLang = await this.getUserLanguage(userId);
    const translatedMessages = await Promise.all(
      messages.map(async (msg) => {
        if (msg.type === 'text' && userLang !== 'en') {
          const translation = await this.getTranslation(msg.id, msg.content, userLang);
          if (translation) {
            msg.metadata = { ...msg.metadata, translation };
          }
        }
        return msg;
      })
    );

    return translatedMessages.reverse().map(msg => this.mapToMessage(msg));
  }

  async markMessageAsRead(messageId: string, userId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) return;

    const readBy = message.read_by || [];
    if (!readBy.includes(userId)) {
      readBy.push(userId);
      
      await prisma.message.update({
        where: { id: messageId },
        data: { read_by: readBy },
      });
    }

    // Remove from unread
    await prisma.unreadMessage.deleteMany({
      where: {
        message_id: messageId,
        user_id: userId,
      },
    });
  }

  async editMessage(
    messageId: string,
    userId: string,
    newContent: string
  ): Promise<Message> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message || message.sender_id !== userId) {
      throw new Error('Message not found or unauthorized');
    }

    // Can only edit within 15 minutes
    const editDeadline = dayjs(message.created_at).add(15, 'minute');
    if (dayjs().isAfter(editDeadline)) {
      throw new Error('Message can no longer be edited');
    }

    // Moderate new content
    const moderation = await this.moderationService.moderateContent(newContent);
    if (moderation.blocked) {
      throw new Error(`Edit blocked: ${moderation.reason}`);
    }

    // Store edit history
    const editHistory = message.edit_history || [];
    editHistory.push({
      content: message.content,
      editedAt: new Date(),
    });

    const updated = await prisma.message.update({
      where: { id: messageId },
      data: {
        content: newContent,
        is_edited: true,
        edit_history: editHistory,
        updated_at: new Date(),
      },
    });

    return this.mapToMessage(updated);
  }

  async deleteMessage(messageId: string, userId: string): Promise<void> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message || message.sender_id !== userId) {
      throw new Error('Message not found or unauthorized');
    }

    await prisma.message.update({
      where: { id: messageId },
      data: {
        is_deleted: true,
        deleted_at: new Date(),
        content: '[Message deleted]',
      },
    });
  }

  async translateMessage(params: {
    messageId: string;
    targetLanguage: string;
  }): Promise<string> {
    const message = await prisma.message.findUnique({
      where: { id: params.messageId },
    });

    if (!message || message.type !== 'text') {
      throw new Error('Message not found or not translatable');
    }

    // Check cache
    const cached = this.translationCache[params.messageId]?.[params.targetLanguage];
    if (cached) {
      return cached;
    }

    // Translate (this would integrate with translation service)
    const translation = await this.performTranslation(
      message.content,
      params.targetLanguage
    );

    // Cache translation
    if (!this.translationCache[params.messageId]) {
      this.translationCache[params.messageId] = {};
    }
    this.translationCache[params.messageId][params.targetLanguage] = translation;

    // Store in database
    await prisma.messageTranslation.create({
      data: {
        message_id: params.messageId,
        language: params.targetLanguage,
        translated_content: translation,
      },
    });

    return translation;
  }

  async processMessage(params: {
    messageId: string;
    roomId: string;
    senderId: string;
  }): Promise<void> {
    // Get room participants
    const room = await prisma.chatRoom.findUnique({
      where: { id: params.roomId },
    });

    if (!room) return;

    const participants = room.participants as any[];

    // Create unread records for other participants
    for (const participant of participants) {
      if (participant.userId !== params.senderId) {
        await prisma.unreadMessage.create({
          data: {
            user_id: participant.userId,
            chat_room_id: params.roomId,
            message_id: params.messageId,
          },
        });
      }
    }

    // Check if translations needed
    const languages = await this.getParticipantLanguages(participants);
    
    if (languages.size > 1) {
      // Queue translations
      for (const lang of languages) {
        if (lang !== 'en') {
          await this.messageQueue.add('translate-message', {
            messageId: params.messageId,
            targetLanguage: lang,
          });
        }
      }
    }
  }

  async cleanupOldMessages(): Promise<void> {
    const cutoffDate = dayjs().subtract(90, 'day').toDate();

    // Delete old deleted messages
    const deleted = await prisma.message.deleteMany({
      where: {
        is_deleted: true,
        deleted_at: { lt: cutoffDate },
      },
    });

    // Archive old messages
    const archived = await prisma.$executeRaw`
      INSERT INTO archived_messages 
      SELECT * FROM messages 
      WHERE created_at < ${cutoffDate}
    `;

    logger.info(`Cleaned up ${deleted.count} deleted messages, archived ${archived} messages`);
  }

  private async getUserLanguage(userId: string): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { language_preference: true },
    });

    return user?.language_preference || 'en';
  }

  private async getTranslation(
    messageId: string,
    content: string,
    targetLang: string
  ): Promise<string | null> {
    // Check database first
    const stored = await prisma.messageTranslation.findFirst({
      where: {
        message_id: messageId,
        language: targetLang,
      },
    });

    if (stored) {
      return stored.translated_content;
    }

    // Check cache
    return this.translationCache[messageId]?.[targetLang] || null;
  }

  private async performTranslation(
    content: string,
    targetLanguage: string
  ): Promise<string> {
    // This would integrate with a translation service (Google Translate, DeepL, etc.)
    // For now, return a placeholder
    return `[Translated to ${targetLanguage}]: ${content}`;
  }

  private async getParticipantLanguages(participants: any[]): Promise<Set<string>> {
    const userIds = participants.map(p => p.userId);
    
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { language_preference: true },
    });

    const languages = new Set<string>();
    users.forEach(u => {
      languages.add(u.language_preference || 'en');
    });

    return languages;
  }

  private mapToMessage(dbMessage: any): Message {
    return {
      id: dbMessage.id,
      roomId: dbMessage.chat_room_id,
      senderId: dbMessage.sender_id,
      content: dbMessage.content,
      type: dbMessage.type,
      metadata: dbMessage.metadata,
      isEdited: dbMessage.is_edited,
      isDeleted: dbMessage.is_deleted,
      readBy: dbMessage.read_by || [],
      createdAt: dbMessage.created_at,
      updatedAt: dbMessage.updated_at,
    };
  }
}