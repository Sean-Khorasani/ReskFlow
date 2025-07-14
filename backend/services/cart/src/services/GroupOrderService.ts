import { prisma, logger, redis } from '@reskflow/shared';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { addMinutes } from 'date-fns';

interface GroupOrder {
  id: string;
  hostId: string;
  merchantId: string;
  reskflowAddress: any;
  scheduledFor?: Date;
  status: 'open' | 'locked' | 'finalized' | 'cancelled';
  participants: GroupParticipant[];
  items: GroupOrderItem[];
  totals: {
    subtotal: number;
    tax: number;
    reskflowFee: number;
    serviceFee: number;
    tip: number;
    total: number;
  };
  paymentMethod?: string;
  orderId?: string;
  shareCode: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface GroupParticipant {
  userId: string;
  userName: string;
  userAvatar?: string;
  joinedAt: Date;
  items: GroupOrderItem[];
  subtotal: number;
  shareAmount: number;
  paymentStatus: 'pending' | 'paid' | 'failed';
  paymentMethod?: string;
}

interface GroupOrderItem {
  id: string;
  userId: string;
  itemId: string;
  itemName: string;
  itemPrice: number;
  quantity: number;
  modifiers?: any[];
  modifierPrice: number;
  specialInstructions?: string;
  subtotal: number;
  addedAt: Date;
}

interface CreateGroupOrderInput {
  hostId: string;
  merchantId: string;
  reskflowAddress: any;
  scheduledFor?: Date;
}

export class GroupOrderService {
  private io: Server;

  constructor(io: Server) {
    this.io = io;
  }

  async createGroupOrder(input: CreateGroupOrderInput): Promise<GroupOrder> {
    try {
      // Validate merchant
      const merchant = await prisma.merchant.findUnique({
        where: { id: input.merchantId },
      });

      if (!merchant || merchant.status !== 'ACTIVE') {
        throw new Error('Merchant not available');
      }

      // Get host user details
      const host = await prisma.user.findUnique({
        where: { id: input.hostId },
      });

      if (!host) {
        throw new Error('Host user not found');
      }

      const groupOrderId = uuidv4();
      const shareCode = this.generateShareCode();
      const expiresAt = addMinutes(new Date(), 60); // 1 hour expiry

      const groupOrder: GroupOrder = {
        id: groupOrderId,
        hostId: input.hostId,
        merchantId: input.merchantId,
        reskflowAddress: input.reskflowAddress,
        scheduledFor: input.scheduledFor,
        status: 'open',
        participants: [{
          userId: input.hostId,
          userName: host.name,
          userAvatar: (host as any).avatar,
          joinedAt: new Date(),
          items: [],
          subtotal: 0,
          shareAmount: 0,
          paymentStatus: 'pending',
        }],
        items: [],
        totals: {
          subtotal: 0,
          tax: 0,
          reskflowFee: merchant.reskflowFee,
          serviceFee: 0,
          tip: 0,
          total: merchant.reskflowFee,
        },
        shareCode,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        3600 // 1 hour
      );

      // Store share code mapping
      await redis.set(
        `group-order:share:${shareCode}`,
        groupOrderId,
        'EX',
        3600
      );

      // Create activity log
      await this.logActivity(groupOrderId, {
        type: 'created',
        userId: input.hostId,
        userName: host.name,
        timestamp: new Date(),
      });

      logger.info(`Group order created: ${groupOrderId}`);
      return groupOrder;
    } catch (error) {
      logger.error('Failed to create group order', error);
      throw error;
    }
  }

  async getGroupOrder(groupOrderId: string): Promise<GroupOrder | null> {
    try {
      const data = await redis.get(`group-order:${groupOrderId}`);
      if (!data) {
        return null;
      }

      return JSON.parse(data);
    } catch (error) {
      logger.error('Failed to get group order', error);
      return null;
    }
  }

  async joinGroupOrder(groupOrderId: string, userId: string): Promise<GroupParticipant> {
    try {
      const groupOrder = await this.getGroupOrder(groupOrderId);
      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.status !== 'open') {
        throw new Error('Group order is not open for new participants');
      }

      if (new Date() > new Date(groupOrder.expiresAt)) {
        throw new Error('Group order has expired');
      }

      // Check if already a participant
      const existingParticipant = groupOrder.participants.find(p => p.userId === userId);
      if (existingParticipant) {
        return existingParticipant;
      }

      // Get user details
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Add participant
      const participant: GroupParticipant = {
        userId,
        userName: user.name,
        userAvatar: (user as any).avatar,
        joinedAt: new Date(),
        items: [],
        subtotal: 0,
        shareAmount: 0,
        paymentStatus: 'pending',
      };

      groupOrder.participants.push(participant);
      groupOrder.updatedAt = new Date();

      // Update in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        3600
      );

      // Log activity
      await this.logActivity(groupOrderId, {
        type: 'participant_joined',
        userId,
        userName: user.name,
        timestamp: new Date(),
      });

      // Emit update
      this.io.to(`group-order:${groupOrderId}`).emit('group-order:participant-joined', {
        participant,
        timestamp: new Date(),
      });

      logger.info(`User ${userId} joined group order ${groupOrderId}`);
      return participant;
    } catch (error) {
      logger.error('Failed to join group order', error);
      throw error;
    }
  }

  async leaveGroupOrder(groupOrderId: string, userId: string): Promise<void> {
    try {
      const groupOrder = await this.getGroupOrder(groupOrderId);
      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.status !== 'open') {
        throw new Error('Cannot leave a locked or finalized group order');
      }

      if (groupOrder.hostId === userId) {
        throw new Error('Host cannot leave the group order');
      }

      // Remove participant and their items
      groupOrder.participants = groupOrder.participants.filter(p => p.userId !== userId);
      groupOrder.items = groupOrder.items.filter(item => item.userId !== userId);

      // Recalculate totals
      this.recalculateTotals(groupOrder);

      groupOrder.updatedAt = new Date();

      // Update in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        3600
      );

      // Log activity
      const user = await prisma.user.findUnique({ where: { id: userId } });
      await this.logActivity(groupOrderId, {
        type: 'participant_left',
        userId,
        userName: user?.name || 'Unknown',
        timestamp: new Date(),
      });

      // Emit update
      this.io.to(`group-order:${groupOrderId}`).emit('group-order:participant-left', {
        userId,
        timestamp: new Date(),
      });

      logger.info(`User ${userId} left group order ${groupOrderId}`);
    } catch (error) {
      logger.error('Failed to leave group order', error);
      throw error;
    }
  }

  async addItemToGroupOrder(
    groupOrderId: string,
    userId: string,
    input: {
      itemId: string;
      quantity: number;
      modifiers?: any[];
      specialInstructions?: string;
    }
  ): Promise<GroupOrderItem> {
    try {
      const groupOrder = await this.getGroupOrder(groupOrderId);
      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.status !== 'open') {
        throw new Error('Group order is locked');
      }

      // Verify user is a participant
      const participant = groupOrder.participants.find(p => p.userId === userId);
      if (!participant) {
        throw new Error('User is not a participant');
      }

      // Get item details
      const item = await prisma.menuItem.findUnique({
        where: { id: input.itemId },
        include: { modifierGroups: { include: { modifiers: true } } },
      });

      if (!item || item.merchantId !== groupOrder.merchantId) {
        throw new Error('Invalid item');
      }

      // Calculate modifier price
      let modifierPrice = 0;
      if (input.modifiers) {
        // Calculate modifier prices (similar to CartService)
        // ... validation and calculation logic ...
      }

      const groupOrderItem: GroupOrderItem = {
        id: uuidv4(),
        userId,
        itemId: item.id,
        itemName: item.name,
        itemPrice: item.price,
        quantity: input.quantity,
        modifiers: input.modifiers,
        modifierPrice,
        specialInstructions: input.specialInstructions,
        subtotal: (item.price + modifierPrice) * input.quantity,
        addedAt: new Date(),
      };

      // Add to group order
      groupOrder.items.push(groupOrderItem);
      
      // Update participant's items
      participant.items.push(groupOrderItem);
      participant.subtotal += groupOrderItem.subtotal;

      // Recalculate totals and shares
      this.recalculateTotals(groupOrder);
      this.calculateShares(groupOrder);

      groupOrder.updatedAt = new Date();

      // Update in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        3600
      );

      // Log activity
      const user = await prisma.user.findUnique({ where: { id: userId } });
      await this.logActivity(groupOrderId, {
        type: 'item_added',
        userId,
        userName: user?.name || 'Unknown',
        itemName: item.name,
        quantity: input.quantity,
        timestamp: new Date(),
      });

      // Emit update
      this.io.to(`group-order:${groupOrderId}`).emit('group-order:item-added', {
        item: groupOrderItem,
        participant: {
          userId,
          subtotal: participant.subtotal,
          shareAmount: participant.shareAmount,
        },
        totals: groupOrder.totals,
        timestamp: new Date(),
      });

      return groupOrderItem;
    } catch (error) {
      logger.error('Failed to add item to group order', error);
      throw error;
    }
  }

  async removeItemFromGroupOrder(
    groupOrderId: string,
    userId: string,
    itemId: string
  ): Promise<void> {
    try {
      const groupOrder = await this.getGroupOrder(groupOrderId);
      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.status !== 'open') {
        throw new Error('Group order is locked');
      }

      // Find and remove item
      const itemIndex = groupOrder.items.findIndex(
        item => item.id === itemId && item.userId === userId
      );

      if (itemIndex === -1) {
        throw new Error('Item not found');
      }

      const removedItem = groupOrder.items.splice(itemIndex, 1)[0];

      // Update participant
      const participant = groupOrder.participants.find(p => p.userId === userId);
      if (participant) {
        participant.items = participant.items.filter(item => item.id !== itemId);
        participant.subtotal -= removedItem.subtotal;
      }

      // Recalculate
      this.recalculateTotals(groupOrder);
      this.calculateShares(groupOrder);

      groupOrder.updatedAt = new Date();

      // Update in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        3600
      );

      // Emit update
      this.io.to(`group-order:${groupOrderId}`).emit('group-order:item-removed', {
        itemId,
        userId,
        totals: groupOrder.totals,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Failed to remove item from group order', error);
      throw error;
    }
  }

  async lockGroupOrder(groupOrderId: string, hostId: string): Promise<GroupOrder> {
    try {
      const groupOrder = await this.getGroupOrder(groupOrderId);
      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.hostId !== hostId) {
        throw new Error('Only host can lock the group order');
      }

      if (groupOrder.status !== 'open') {
        throw new Error('Group order is already locked or finalized');
      }

      if (groupOrder.items.length === 0) {
        throw new Error('Cannot lock empty group order');
      }

      groupOrder.status = 'locked';
      groupOrder.updatedAt = new Date();

      // Update in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        3600
      );

      // Log activity
      await this.logActivity(groupOrderId, {
        type: 'locked',
        userId: hostId,
        timestamp: new Date(),
      });

      // Emit update
      this.io.to(`group-order:${groupOrderId}`).emit('group-order:locked', {
        timestamp: new Date(),
      });

      // Send payment requests to participants
      await this.sendPaymentRequests(groupOrder);

      logger.info(`Group order ${groupOrderId} locked`);
      return groupOrder;
    } catch (error) {
      logger.error('Failed to lock group order', error);
      throw error;
    }
  }

  async finalizeGroupOrder(
    groupOrderId: string,
    hostId: string,
    input: {
      paymentMethod: string;
      tip: number;
    }
  ): Promise<any> {
    try {
      const groupOrder = await this.getGroupOrder(groupOrderId);
      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      if (groupOrder.hostId !== hostId) {
        throw new Error('Only host can finalize the group order');
      }

      if (groupOrder.status !== 'locked') {
        throw new Error('Group order must be locked before finalizing');
      }

      // Check all participants have paid
      const unpaidParticipants = groupOrder.participants.filter(
        p => p.userId !== hostId && p.paymentStatus !== 'paid'
      );

      if (unpaidParticipants.length > 0) {
        throw new Error('Not all participants have paid their share');
      }

      // Update totals with tip
      groupOrder.totals.tip = input.tip;
      groupOrder.totals.total += input.tip;
      groupOrder.paymentMethod = input.paymentMethod;
      groupOrder.status = 'finalized';

      // Create actual order
      const order = await this.createOrderFromGroupOrder(groupOrder);
      groupOrder.orderId = order.id;

      // Update in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        86400 // Keep for 24 hours after finalization
      );

      // Emit update
      this.io.to(`group-order:${groupOrderId}`).emit('group-order:finalized', {
        orderId: order.id,
        timestamp: new Date(),
      });

      logger.info(`Group order ${groupOrderId} finalized as order ${order.id}`);
      return order;
    } catch (error) {
      logger.error('Failed to finalize group order', error);
      throw error;
    }
  }

  private generateShareCode(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private recalculateTotals(groupOrder: GroupOrder): void {
    const subtotal = groupOrder.items.reduce((sum, item) => sum + item.subtotal, 0);
    const tax = subtotal * 0.08; // 8% tax
    const serviceFee = subtotal * 0.15; // 15% service fee

    groupOrder.totals = {
      subtotal,
      tax,
      reskflowFee: groupOrder.totals.reskflowFee,
      serviceFee,
      tip: groupOrder.totals.tip || 0,
      total: subtotal + tax + groupOrder.totals.reskflowFee + serviceFee + (groupOrder.totals.tip || 0),
    };
  }

  private calculateShares(groupOrder: GroupOrder): void {
    const participantCount = groupOrder.participants.length;
    
    if (participantCount === 0) return;

    // Calculate each participant's share
    const sharedCosts = groupOrder.totals.reskflowFee + groupOrder.totals.serviceFee + groupOrder.totals.tax;
    const sharedCostPerPerson = sharedCosts / participantCount;

    groupOrder.participants.forEach(participant => {
      // Each person pays their items + share of reskflow/service/tax
      participant.shareAmount = participant.subtotal + sharedCostPerPerson;
    });

    // Host pays the tip
    const host = groupOrder.participants.find(p => p.userId === groupOrder.hostId);
    if (host && groupOrder.totals.tip > 0) {
      host.shareAmount += groupOrder.totals.tip;
    }
  }

  private async sendPaymentRequests(groupOrder: GroupOrder): Promise<void> {
    // Send payment request notifications to all participants except host
    for (const participant of groupOrder.participants) {
      if (participant.userId !== groupOrder.hostId) {
        // Queue payment request notification
        await redis.lpush('payment:requests', JSON.stringify({
          userId: participant.userId,
          groupOrderId: groupOrder.id,
          amount: participant.shareAmount,
          dueBy: groupOrder.expiresAt,
        }));
      }
    }
  }

  private async createOrderFromGroupOrder(groupOrder: GroupOrder): Promise<any> {
    // Create order in the main order system
    // This would integrate with the order service
    const orderData = {
      customerId: groupOrder.hostId,
      merchantId: groupOrder.merchantId,
      type: 'DELIVERY',
      items: groupOrder.items.map(item => ({
        menuItemId: item.itemId,
        quantity: item.quantity,
        price: item.itemPrice,
        modifiers: item.modifiers,
        specialRequest: item.specialInstructions,
        totalPrice: item.subtotal,
      })),
      reskflowAddress: groupOrder.reskflowAddress,
      subtotal: groupOrder.totals.subtotal,
      tax: groupOrder.totals.tax,
      reskflowFee: groupOrder.totals.reskflowFee,
      serviceFee: groupOrder.totals.serviceFee,
      tip: groupOrder.totals.tip,
      total: groupOrder.totals.total,
      paymentMethod: groupOrder.paymentMethod,
      isScheduled: !!groupOrder.scheduledFor,
      scheduledFor: groupOrder.scheduledFor,
      metadata: {
        isGroupOrder: true,
        groupOrderId: groupOrder.id,
        participantCount: groupOrder.participants.length,
      },
    };

    // Mock order creation - would call order service
    return {
      id: `order_${Date.now()}`,
      orderNumber: `GRP${Date.now()}`,
      ...orderData,
      status: 'PENDING',
      createdAt: new Date(),
    };
  }

  private async logActivity(groupOrderId: string, activity: any): Promise<void> {
    const key = `group-order:activity:${groupOrderId}`;
    await redis.lpush(key, JSON.stringify(activity));
    await redis.ltrim(key, 0, 99); // Keep last 100 activities
    await redis.expire(key, 86400); // 24 hours
  }

  async getGroupOrderByShareCode(shareCode: string): Promise<GroupOrder | null> {
    try {
      const groupOrderId = await redis.get(`group-order:share:${shareCode}`);
      if (!groupOrderId) {
        return null;
      }

      return this.getGroupOrder(groupOrderId);
    } catch (error) {
      logger.error('Failed to get group order by share code', error);
      return null;
    }
  }

  async updateParticipantPayment(
    groupOrderId: string,
    userId: string,
    paymentStatus: 'paid' | 'failed',
    paymentMethod?: string
  ): Promise<void> {
    try {
      const groupOrder = await this.getGroupOrder(groupOrderId);
      if (!groupOrder) {
        throw new Error('Group order not found');
      }

      const participant = groupOrder.participants.find(p => p.userId === userId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      participant.paymentStatus = paymentStatus;
      if (paymentMethod) {
        participant.paymentMethod = paymentMethod;
      }

      // Update in Redis
      await redis.set(
        `group-order:${groupOrderId}`,
        JSON.stringify(groupOrder),
        'EX',
        3600
      );

      // Emit update
      this.io.to(`group-order:${groupOrderId}`).emit('group-order:payment-update', {
        userId,
        paymentStatus,
        timestamp: new Date(),
      });

      logger.info(`Payment status updated for user ${userId} in group order ${groupOrderId}`);
    } catch (error) {
      logger.error('Failed to update participant payment', error);
      throw error;
    }
  }
}