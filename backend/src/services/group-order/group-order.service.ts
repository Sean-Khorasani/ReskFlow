/**
 * Group Order Service
 * Manages collaborative ordering for groups (office, friends, family)
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { io } from '../../websocket/socket';
import ShortUniqueId from 'short-unique-id';

const prisma = new PrismaClient();
const uid = new ShortUniqueId({ length: 6 });

interface GroupOrder {
  id: string;
  code: string;
  hostId: string;
  merchantId: string;
  name: string;
  description?: string;
  reskflowAddress: string;
  reskflowTime?: Date;
  status: 'open' | 'locked' | 'ordered' | 'delivered' | 'cancelled';
  maxParticipants?: number;
  allowGuestOrders: boolean;
  splitEqually: boolean;
  hostPaysDelivery: boolean;
  expiresAt: Date;
}

interface GroupParticipant {
  id: string;
  groupOrderId: string;
  customerId?: string;
  guestName?: string;
  guestPhone?: string;
  status: 'joined' | 'ready' | 'paid' | 'left';
  items: GroupOrderItem[];
  subtotal: number;
  shareAmount?: number;
}

interface GroupOrderItem {
  id: string;
  participantId: string;
  productId: string;
  quantity: number;
  specialInstructions?: string;
  price: number;
}

export class GroupOrderService extends EventEmitter {
  constructor() {
    super();
    this.setupExpirationCheck();
  }

  /**
   * Setup periodic check for expired group orders
   */
  private setupExpirationCheck() {
    setInterval(async () => {
      await this.checkExpiredOrders();
    }, 60000); // Check every minute
  }

  /**
   * Create a new group order
   */
  async createGroupOrder(hostId: string, orderData: {
    merchantId: string;
    name: string;
    description?: string;
    reskflowAddress: string;
    reskflowTime?: Date;
    maxParticipants?: number;
    allowGuestOrders?: boolean;
    splitEqually?: boolean;
    hostPaysDelivery?: boolean;
    expirationMinutes?: number;
  }): Promise<GroupOrder> {
    try {
      const code = this.generateGroupCode();
      const expiresAt = new Date(
        Date.now() + (orderData.expirationMinutes || 60) * 60 * 1000
      );

      const groupOrder = await prisma.groupOrder.create({
        data: {
          code,
          hostId,
          merchantId: orderData.merchantId,
          name: orderData.name,
          description: orderData.description,
          reskflowAddress: orderData.reskflowAddress,
          reskflowTime: orderData.reskflowTime,
          maxParticipants: orderData.maxParticipants,
          allowGuestOrders: orderData.allowGuestOrders ?? true,
          splitEqually: orderData.splitEqually ?? false,
          hostPaysDelivery: orderData.hostPaysDelivery ?? true,
          status: 'open',
          expiresAt,
        },
      });

      // Add host as first participant
      await this.joinGroupOrder(groupOrder.id, hostId);

      // Get merchant info for notifications
      const merchant = await prisma.merchant.findUnique({
        where: { id: orderData.merchantId },
      });

      // Create shareable link
      const shareLink = `${process.env.FRONTEND_URL}/group-order/${code}`;

      // Emit event
      this.emit('group_order:created', {
        groupOrder,
        shareLink,
        merchant,
      });

      logger.info(`Group order created: ${code}`, {
        hostId,
        merchantId: orderData.merchantId,
      });

      return { ...groupOrder, shareLink };

    } catch (error) {
      logger.error('Failed to create group order', error);
      throw error;
    }
  }

  /**
   * Join a group order
   */
  async joinGroupOrder(
    groupOrderId: string,
    customerId?: string,
    guestInfo?: { name: string; phone: string }
  ): Promise<GroupParticipant> {
    try {
      const groupOrder = await prisma.groupOrder.findUnique({
        where: { id: groupOrderId },
        include: {
          participants: true,
        },
      });

      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.status !== 'open') {
        throw new Error('Group order is not open for new participants');
      }

      if (new Date() > groupOrder.expiresAt) {
        throw new Error('Group order has expired');
      }

      // Check max participants
      if (groupOrder.maxParticipants && 
          groupOrder.participants.length >= groupOrder.maxParticipants) {
        throw new Error('Group order is full');
      }

      // Check if already joined
      if (customerId) {
        const existing = groupOrder.participants.find(p => p.customerId === customerId);
        if (existing) {
          return existing;
        }
      }

      // Create participant
      const participant = await prisma.groupParticipant.create({
        data: {
          groupOrderId,
          customerId,
          guestName: guestInfo?.name,
          guestPhone: guestInfo?.phone,
          status: 'joined',
        },
      });

      // Notify via WebSocket
      this.broadcastToGroup(groupOrderId, 'participant:joined', {
        participant,
        totalParticipants: groupOrder.participants.length + 1,
      });

      // Notify host
      if (groupOrder.hostId !== customerId) {
        const host = await prisma.customer.findUnique({
          where: { id: groupOrder.hostId },
          include: { user: true },
        });

        if (host) {
          await notificationService.sendPushNotification(
            host.userId,
            'New participant joined',
            `${guestInfo?.name || 'Someone'} joined your group order "${groupOrder.name}"`,
            {
              type: 'group_order_joined',
              groupOrderId,
            }
          );
        }
      }

      return participant;

    } catch (error) {
      logger.error('Failed to join group order', error);
      throw error;
    }
  }

  /**
   * Add items to participant's order
   */
  async addItemsToParticipant(
    participantId: string,
    items: Array<{
      productId: string;
      quantity: number;
      specialInstructions?: string;
    }>
  ): Promise<void> {
    try {
      const participant = await prisma.groupParticipant.findUnique({
        where: { id: participantId },
        include: {
          groupOrder: true,
        },
      });

      if (!participant) {
        throw new Error('Participant not found');
      }

      if (participant.groupOrder.status !== 'open') {
        throw new Error('Group order is locked');
      }

      // Get product prices
      const productIds = items.map(item => item.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
      });

      const productMap = new Map(products.map(p => [p.id, p]));

      // Create order items
      const orderItems = items.map(item => {
        const product = productMap.get(item.productId);
        if (!product) {
          throw new Error(`Product ${item.productId} not found`);
        }

        return {
          participantId,
          productId: item.productId,
          quantity: item.quantity,
          specialInstructions: item.specialInstructions,
          price: product.price,
        };
      });

      // Save items
      await prisma.groupOrderItem.createMany({
        data: orderItems,
      });

      // Update participant subtotal
      const subtotal = orderItems.reduce(
        (sum, item) => sum + (item.price * item.quantity),
        0
      );

      await prisma.groupParticipant.update({
        where: { id: participantId },
        data: {
          subtotal: {
            increment: subtotal,
          },
        },
      });

      // Broadcast update
      this.broadcastToGroup(participant.groupOrderId, 'items:added', {
        participantId,
        items: orderItems,
        newSubtotal: participant.subtotal + subtotal,
      });

    } catch (error) {
      logger.error('Failed to add items', error);
      throw error;
    }
  }

  /**
   * Update item quantity
   */
  async updateItemQuantity(
    itemId: string,
    quantity: number
  ): Promise<void> {
    try {
      const item = await prisma.groupOrderItem.findUnique({
        where: { id: itemId },
        include: {
          participant: {
            include: {
              groupOrder: true,
            },
          },
        },
      });

      if (!item) {
        throw new Error('Item not found');
      }

      if (item.participant.groupOrder.status !== 'open') {
        throw new Error('Group order is locked');
      }

      if (quantity === 0) {
        // Remove item
        await prisma.groupOrderItem.delete({
          where: { id: itemId },
        });
      } else {
        // Update quantity
        await prisma.groupOrderItem.update({
          where: { id: itemId },
          data: { quantity },
        });
      }

      // Recalculate participant subtotal
      const items = await prisma.groupOrderItem.findMany({
        where: { participantId: item.participantId },
      });

      const newSubtotal = items.reduce(
        (sum, i) => sum + (i.price * i.quantity),
        0
      );

      await prisma.groupParticipant.update({
        where: { id: item.participantId },
        data: { subtotal: newSubtotal },
      });

      // Broadcast update
      this.broadcastToGroup(item.participant.groupOrderId, 'item:updated', {
        participantId: item.participantId,
        itemId,
        quantity,
        newSubtotal,
      });

    } catch (error) {
      logger.error('Failed to update item quantity', error);
      throw error;
    }
  }

  /**
   * Mark participant as ready
   */
  async markParticipantReady(participantId: string): Promise<void> {
    try {
      const participant = await prisma.groupParticipant.findUnique({
        where: { id: participantId },
        include: {
          groupOrder: {
            include: {
              participants: true,
            },
          },
          items: true,
        },
      });

      if (!participant) {
        throw new Error('Participant not found');
      }

      if (participant.items.length === 0) {
        throw new Error('No items in order');
      }

      await prisma.groupParticipant.update({
        where: { id: participantId },
        data: { status: 'ready' },
      });

      // Check if all participants are ready
      const allReady = participant.groupOrder.participants
        .filter(p => p.id !== participantId)
        .every(p => p.status === 'ready') && true; // Include current participant

      // Broadcast update
      this.broadcastToGroup(participant.groupOrderId, 'participant:ready', {
        participantId,
        allReady,
      });

      // Notify host if all ready
      if (allReady && participant.customerId !== participant.groupOrder.hostId) {
        const host = await prisma.customer.findUnique({
          where: { id: participant.groupOrder.hostId },
          include: { user: true },
        });

        if (host) {
          await notificationService.sendPushNotification(
            host.userId,
            'Everyone is ready!',
            'All participants have finalized their orders. You can now place the group order.',
            {
              type: 'group_order_ready',
              groupOrderId: participant.groupOrderId,
            }
          );
        }
      }

    } catch (error) {
      logger.error('Failed to mark participant ready', error);
      throw error;
    }
  }

  /**
   * Lock group order (no more changes allowed)
   */
  async lockGroupOrder(groupOrderId: string, hostId: string): Promise<void> {
    try {
      const groupOrder = await prisma.groupOrder.findUnique({
        where: { id: groupOrderId },
        include: {
          participants: {
            include: {
              items: true,
            },
          },
        },
      });

      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.hostId !== hostId) {
        throw new Error('Only host can lock the order');
      }

      // Check if all participants have items
      const emptyParticipants = groupOrder.participants.filter(p => p.items.length === 0);
      if (emptyParticipants.length > 0) {
        throw new Error('Some participants have not added items');
      }

      await prisma.groupOrder.update({
        where: { id: groupOrderId },
        data: { status: 'locked' },
      });

      // Calculate payment splits
      await this.calculatePaymentSplits(groupOrderId);

      // Broadcast update
      this.broadcastToGroup(groupOrderId, 'order:locked', {
        status: 'locked',
      });

    } catch (error) {
      logger.error('Failed to lock group order', error);
      throw error;
    }
  }

  /**
   * Calculate payment splits
   */
  private async calculatePaymentSplits(groupOrderId: string): Promise<void> {
    const groupOrder = await prisma.groupOrder.findUnique({
      where: { id: groupOrderId },
      include: {
        participants: true,
        merchant: true,
      },
    });

    if (!groupOrder) return;

    const subtotal = groupOrder.participants.reduce((sum, p) => sum + p.subtotal, 0);
    const reskflowFee = groupOrder.merchant.reskflowFee || 0;
    const taxes = subtotal * 0.08; // 8% tax
    const total = subtotal + reskflowFee + taxes;

    if (groupOrder.splitEqually) {
      // Split total equally among all participants
      const sharePerPerson = total / groupOrder.participants.length;
      
      for (const participant of groupOrder.participants) {
        await prisma.groupParticipant.update({
          where: { id: participant.id },
          data: { shareAmount: sharePerPerson },
        });
      }
    } else {
      // Each pays for their items + proportional share of reskflow/tax
      for (const participant of groupOrder.participants) {
        const itemShare = participant.subtotal;
        const reskflowShare = groupOrder.hostPaysDelivery ? 0 : 
          (reskflowFee * (participant.subtotal / subtotal));
        const taxShare = taxes * (participant.subtotal / subtotal);
        
        await prisma.groupParticipant.update({
          where: { id: participant.id },
          data: { shareAmount: itemShare + reskflowShare + taxShare },
        });
      }

      // If host pays reskflow, add it to their share
      if (groupOrder.hostPaysDelivery) {
        const hostParticipant = groupOrder.participants.find(
          p => p.customerId === groupOrder.hostId
        );
        
        if (hostParticipant) {
          await prisma.groupParticipant.update({
            where: { id: hostParticipant.id },
            data: {
              shareAmount: {
                increment: reskflowFee,
              },
            },
          });
        }
      }
    }
  }

  /**
   * Place the final group order
   */
  async placeGroupOrder(
    groupOrderId: string,
    hostId: string,
    paymentMethodId: string
  ): Promise<any> {
    try {
      const groupOrder = await prisma.groupOrder.findUnique({
        where: { id: groupOrderId },
        include: {
          participants: {
            include: {
              items: {
                include: {
                  product: true,
                },
              },
            },
          },
          merchant: true,
        },
      });

      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.hostId !== hostId) {
        throw new Error('Only host can place the order');
      }

      if (groupOrder.status !== 'locked') {
        throw new Error('Group order must be locked before placing');
      }

      // Collect all items
      const allItems = groupOrder.participants.flatMap(p => 
        p.items.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          specialInstructions: item.specialInstructions,
          participantName: p.guestName || p.customer?.name || 'Guest',
        }))
      );

      // Create the actual order
      const order = await prisma.order.create({
        data: {
          customerId: hostId,
          merchantId: groupOrder.merchantId,
          groupOrderId: groupOrder.id,
          orderNumber: this.generateOrderNumber(),
          status: 'pending',
          paymentMethod: 'card',
          paymentMethodId,
          reskflowAddress: groupOrder.reskflowAddress,
          reskflowTime: groupOrder.reskflowTime,
          subtotal: groupOrder.participants.reduce((sum, p) => sum + p.subtotal, 0),
          reskflowFee: groupOrder.merchant.reskflowFee || 0,
          taxes: groupOrder.participants.reduce((sum, p) => sum + p.subtotal, 0) * 0.08,
          total: 0, // Will be calculated
          items: {
            create: allItems.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
              specialInstructions: item.specialInstructions,
              metadata: {
                participantName: item.participantName,
              },
            })),
          },
        },
      });

      // Update group order status
      await prisma.groupOrder.update({
        where: { id: groupOrderId },
        data: {
          status: 'ordered',
          orderId: order.id,
        },
      });

      // Process payments from each participant
      await this.processParticipantPayments(groupOrder);

      // Send notifications
      await this.sendOrderConfirmations(groupOrder, order);

      // Broadcast final update
      this.broadcastToGroup(groupOrderId, 'order:placed', {
        orderId: order.id,
        orderNumber: order.orderNumber,
      });

      return order;

    } catch (error) {
      logger.error('Failed to place group order', error);
      throw error;
    }
  }

  /**
   * Process payments from participants
   */
  private async processParticipantPayments(groupOrder: any): Promise<void> {
    for (const participant of groupOrder.participants) {
      if (participant.shareAmount > 0) {
        // Create payment record
        await prisma.groupOrderPayment.create({
          data: {
            groupOrderId: groupOrder.id,
            participantId: participant.id,
            amount: participant.shareAmount,
            status: 'pending',
          },
        });

        // If not guest, charge their saved payment method
        if (participant.customerId) {
          // Process payment via payment service
          // This would integrate with Stripe or other payment processor
        }
      }
    }
  }

  /**
   * Send order confirmations
   */
  private async sendOrderConfirmations(groupOrder: any, order: any): Promise<void> {
    // Send to all participants with accounts
    for (const participant of groupOrder.participants) {
      if (participant.customerId) {
        const customer = await prisma.customer.findUnique({
          where: { id: participant.customerId },
          include: { user: true },
        });

        if (customer) {
          await notificationService.sendEmail(
            customer.user.email,
            'group_order_confirmation',
            {
              customerName: customer.name,
              groupOrderName: groupOrder.name,
              orderNumber: order.orderNumber,
              items: participant.items,
              shareAmount: participant.shareAmount,
              reskflowAddress: groupOrder.reskflowAddress,
              reskflowTime: groupOrder.reskflowTime,
            }
          );
        }
      } else if (participant.guestPhone) {
        // Send SMS to guests
        await notificationService.sendSMS(
          participant.guestPhone,
          `Your group order "${groupOrder.name}" has been placed! Order #${order.orderNumber}. Your share: $${participant.shareAmount.toFixed(2)}`
        );
      }
    }
  }

  /**
   * Leave group order
   */
  async leaveGroupOrder(participantId: string): Promise<void> {
    try {
      const participant = await prisma.groupParticipant.findUnique({
        where: { id: participantId },
        include: {
          groupOrder: true,
        },
      });

      if (!participant) {
        throw new Error('Participant not found');
      }

      if (participant.groupOrder.status !== 'open') {
        throw new Error('Cannot leave locked order');
      }

      // Remove participant and their items
      await prisma.groupOrderItem.deleteMany({
        where: { participantId },
      });

      await prisma.groupParticipant.delete({
        where: { id: participantId },
      });

      // Broadcast update
      this.broadcastToGroup(participant.groupOrderId, 'participant:left', {
        participantId,
      });

    } catch (error) {
      logger.error('Failed to leave group order', error);
      throw error;
    }
  }

  /**
   * Get group order details
   */
  async getGroupOrderDetails(code: string): Promise<any> {
    const groupOrder = await prisma.groupOrder.findUnique({
      where: { code },
      include: {
        host: true,
        merchant: true,
        participants: {
          include: {
            customer: true,
            items: {
              include: {
                product: true,
              },
            },
          },
        },
        order: true,
      },
    });

    if (!groupOrder) {
      throw new Error('Group order not found');
    }

    // Get merchant menu for adding items
    const menu = await prisma.product.findMany({
      where: {
        merchantId: groupOrder.merchantId,
        isAvailable: true,
      },
      include: {
        category: true,
      },
    });

    return {
      ...groupOrder,
      menu,
      totals: {
        subtotal: groupOrder.participants.reduce((sum, p) => sum + p.subtotal, 0),
        participants: groupOrder.participants.length,
        items: groupOrder.participants.reduce((sum, p) => sum + p.items.length, 0),
      },
      shareLink: `${process.env.FRONTEND_URL}/group-order/${code}`,
      isExpired: new Date() > groupOrder.expiresAt,
      timeRemaining: Math.max(0, groupOrder.expiresAt.getTime() - Date.now()),
    };
  }

  /**
   * Check and handle expired orders
   */
  private async checkExpiredOrders(): Promise<void> {
    const expiredOrders = await prisma.groupOrder.findMany({
      where: {
        status: 'open',
        expiresAt: { lt: new Date() },
      },
    });

    for (const order of expiredOrders) {
      await prisma.groupOrder.update({
        where: { id: order.id },
        data: { status: 'cancelled' },
      });

      this.broadcastToGroup(order.id, 'order:expired', {
        message: 'Group order has expired',
      });
    }
  }

  /**
   * Broadcast to all participants in a group
   */
  private broadcastToGroup(groupOrderId: string, event: string, data: any): void {
    io.to(`group_order:${groupOrderId}`).emit(event, data);
  }

  /**
   * Generate unique group code
   */
  private generateGroupCode(): string {
    return uid();
  }

  /**
   * Generate order number
   */
  private generateOrderNumber(): string {
    return `GRP-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }

  /**
   * Get participant's current order
   */
  async getParticipantOrder(participantId: string): Promise<any> {
    const participant = await prisma.groupParticipant.findUnique({
      where: { id: participantId },
      include: {
        items: {
          include: {
            product: true,
          },
        },
        groupOrder: {
          include: {
            merchant: true,
          },
        },
      },
    });

    if (!participant) {
      throw new Error('Participant not found');
    }

    return {
      participant,
      subtotal: participant.subtotal,
      shareAmount: participant.shareAmount,
      items: participant.items,
      canEdit: participant.groupOrder.status === 'open',
    };
  }

  /**
   * Send reminder to participants
   */
  async sendReminder(groupOrderId: string, hostId: string): Promise<void> {
    const groupOrder = await prisma.groupOrder.findUnique({
      where: { id: groupOrderId },
      include: {
        participants: {
          include: {
            customer: {
              include: { user: true },
            },
          },
        },
      },
    });

    if (!groupOrder || groupOrder.hostId !== hostId) {
      throw new Error('Unauthorized');
    }

    // Send to participants who haven't added items or marked ready
    const pendingParticipants = groupOrder.participants.filter(
      p => p.items.length === 0 || p.status === 'joined'
    );

    for (const participant of pendingParticipants) {
      if (participant.customer) {
        await notificationService.sendPushNotification(
          participant.customer.userId,
          'Group order reminder',
          `Don't forget to add your items to "${groupOrder.name}"`,
          {
            type: 'group_order_reminder',
            groupOrderId,
            code: groupOrder.code,
          }
        );
      }
    }
  }
}

// Export singleton instance
export const groupOrderService = new GroupOrderService();