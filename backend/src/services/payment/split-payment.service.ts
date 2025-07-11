/**
 * Split Payment Service
 * Manages payment splitting between multiple customers
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import Stripe from 'stripe';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';
import { paymentService } from './payment.service';

const prisma = new PrismaClient();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

interface SplitPaymentSession {
  id: string;
  orderId: string;
  totalAmount: number;
  initiatorId: string;
  status: 'pending' | 'collecting' | 'processing' | 'completed' | 'failed' | 'cancelled';
  type: 'equal' | 'custom' | 'item_based';
  participants: SplitParticipant[];
  expiresAt: Date;
  completedAt?: Date;
}

interface SplitParticipant {
  id: string;
  customerId?: string;
  email?: string;
  phone?: string;
  name: string;
  amount: number;
  items?: string[]; // Item IDs for item-based splits
  status: 'pending' | 'accepted' | 'paid' | 'failed' | 'declined';
  paymentIntentId?: string;
  paidAt?: Date;
  declinedAt?: Date;
  declineReason?: string;
}

interface PaymentLink {
  url: string;
  expiresAt: Date;
  participantId: string;
}

export class SplitPaymentService extends EventEmitter {
  constructor() {
    super();
    this.setupExpirationCheck();
  }

  /**
   * Setup periodic check for expired sessions
   */
  private setupExpirationCheck() {
    setInterval(async () => {
      await this.checkExpiredSessions();
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Create a split payment session
   */
  async createSplitPayment(orderId: string, initiatorId: string, data: {
    type: 'equal' | 'custom' | 'item_based';
    participants: Array<{
      customerId?: string;
      email?: string;
      phone?: string;
      name: string;
      amount?: number; // For custom splits
      items?: string[]; // For item-based splits
    }>;
    message?: string;
  }): Promise<SplitPaymentSession> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: true,
          merchant: true,
        },
      });

      if (!order) {
        throw new Error('Order not found');
      }

      if (order.customerId !== initiatorId) {
        throw new Error('Only order owner can initiate split payment');
      }

      if (order.paymentStatus !== 'pending') {
        throw new Error('Order has already been paid');
      }

      // Calculate split amounts
      const participants = this.calculateSplitAmounts(order, data.type, data.participants);

      // Validate total
      const totalSplit = participants.reduce((sum, p) => sum + p.amount, 0);
      if (Math.abs(totalSplit - order.total) > 0.01) {
        throw new Error('Split amounts do not match order total');
      }

      // Create split payment session
      const session = await prisma.splitPaymentSession.create({
        data: {
          orderId,
          initiatorId,
          totalAmount: order.total,
          type: data.type,
          status: 'pending',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          participants: {
            create: participants.map(p => ({
              ...p,
              status: p.customerId === initiatorId ? 'accepted' : 'pending',
            })),
          },
        },
        include: {
          participants: true,
        },
      });

      // Send invitations
      await this.sendSplitInvitations(session, order, data.message);

      // Emit event
      this.emit('split_payment:created', {
        session,
        order,
      });

      logger.info(`Split payment created for order ${orderId}`, {
        sessionId: session.id,
        participantCount: participants.length,
      });

      return session;

    } catch (error) {
      logger.error('Failed to create split payment', error);
      throw error;
    }
  }

  /**
   * Accept split payment invitation
   */
  async acceptSplitPayment(sessionId: string, participantId: string): Promise<PaymentLink> {
    try {
      const session = await prisma.splitPaymentSession.findUnique({
        where: { id: sessionId },
        include: {
          participants: true,
          order: {
            include: {
              merchant: true,
            },
          },
        },
      });

      if (!session) {
        throw new Error('Split payment session not found');
      }

      if (session.status !== 'pending' && session.status !== 'collecting') {
        throw new Error('Split payment session is no longer active');
      }

      if (new Date() > session.expiresAt) {
        throw new Error('Split payment session has expired');
      }

      const participant = session.participants.find(p => p.id === participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      if (participant.status !== 'pending') {
        throw new Error('Invitation already responded to');
      }

      // Update participant status
      await prisma.splitParticipant.update({
        where: { id: participantId },
        data: { status: 'accepted' },
      });

      // Create payment link
      const paymentLink = await this.createPaymentLink(session, participant);

      // Update session status if needed
      await this.updateSessionStatus(sessionId);

      // Notify initiator
      await notificationService.sendPushNotification(
        session.initiatorId,
        'Split Payment Accepted',
        `${participant.name} has accepted the split payment request`,
        {
          type: 'split_payment_accepted',
          sessionId,
          participantId,
        }
      );

      return paymentLink;

    } catch (error) {
      logger.error('Failed to accept split payment', error);
      throw error;
    }
  }

  /**
   * Decline split payment invitation
   */
  async declineSplitPayment(sessionId: string, participantId: string, reason?: string): Promise<void> {
    try {
      const session = await prisma.splitPaymentSession.findUnique({
        where: { id: sessionId },
        include: {
          participants: true,
        },
      });

      if (!session) {
        throw new Error('Split payment session not found');
      }

      const participant = session.participants.find(p => p.id === participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      if (participant.status !== 'pending') {
        throw new Error('Invitation already responded to');
      }

      // Update participant status
      await prisma.splitParticipant.update({
        where: { id: participantId },
        data: {
          status: 'declined',
          declinedAt: new Date(),
          declineReason: reason,
        },
      });

      // Check if session should be cancelled
      const remainingParticipants = session.participants.filter(
        p => p.id !== participantId && p.status !== 'declined'
      );

      if (remainingParticipants.length < 2) {
        await this.cancelSession(sessionId, 'Not enough participants');
      } else {
        // Redistribute the declined amount
        await this.redistributeAmount(sessionId, participant.amount, remainingParticipants);
      }

      // Notify initiator
      await notificationService.sendPushNotification(
        session.initiatorId,
        'Split Payment Declined',
        `${participant.name} has declined the split payment request`,
        {
          type: 'split_payment_declined',
          sessionId,
          participantId,
          reason,
        }
      );

    } catch (error) {
      logger.error('Failed to decline split payment', error);
      throw error;
    }
  }

  /**
   * Process payment from participant
   */
  async processParticipantPayment(sessionId: string, participantId: string, paymentMethodId: string): Promise<any> {
    try {
      const session = await prisma.splitPaymentSession.findUnique({
        where: { id: sessionId },
        include: {
          participants: true,
          order: true,
        },
      });

      if (!session) {
        throw new Error('Split payment session not found');
      }

      const participant = session.participants.find(p => p.id === participantId);
      if (!participant) {
        throw new Error('Participant not found');
      }

      if (participant.status !== 'accepted') {
        throw new Error('Payment not authorized');
      }

      // Create payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(participant.amount * 100), // Convert to cents
        currency: 'usd',
        payment_method: paymentMethodId,
        confirm: true,
        metadata: {
          sessionId,
          participantId,
          orderId: session.orderId,
        },
      });

      if (paymentIntent.status === 'succeeded') {
        // Update participant
        await prisma.splitParticipant.update({
          where: { id: participantId },
          data: {
            status: 'paid',
            paymentIntentId: paymentIntent.id,
            paidAt: new Date(),
          },
        });

        // Check if all payments collected
        await this.checkSessionCompletion(sessionId);

        // Send confirmation
        if (participant.email) {
          await notificationService.sendEmail(
            participant.email,
            'split_payment_confirmation',
            {
              name: participant.name,
              amount: participant.amount,
              orderDetails: session.order,
            }
          );
        }

        return {
          success: true,
          paymentIntent,
        };
      } else {
        throw new Error('Payment failed');
      }

    } catch (error) {
      logger.error('Failed to process participant payment', error);
      
      // Update participant status
      await prisma.splitParticipant.update({
        where: { id: participantId },
        data: { status: 'failed' },
      });

      throw error;
    }
  }

  /**
   * Calculate split amounts based on type
   */
  private calculateSplitAmounts(order: any, type: string, participants: any[]): any[] {
    switch (type) {
      case 'equal':
        const equalAmount = order.total / participants.length;
        return participants.map(p => ({
          ...p,
          amount: Math.round(equalAmount * 100) / 100, // Round to cents
        }));

      case 'custom':
        // Validate custom amounts
        const customTotal = participants.reduce((sum, p) => sum + (p.amount || 0), 0);
        if (Math.abs(customTotal - order.total) > 0.01) {
          throw new Error('Custom amounts do not match order total');
        }
        return participants;

      case 'item_based':
        // Calculate based on items
        const itemTotals = new Map<string, number>();
        
        for (const item of order.items) {
          itemTotals.set(item.id, item.price * item.quantity);
        }

        // Add proportional fees
        const subtotal = order.subtotal;
        const feesRatio = order.total / subtotal;

        return participants.map(p => {
          let participantSubtotal = 0;
          
          if (p.items) {
            for (const itemId of p.items) {
              participantSubtotal += itemTotals.get(itemId) || 0;
            }
          }

          return {
            ...p,
            amount: Math.round(participantSubtotal * feesRatio * 100) / 100,
          };
        });

      default:
        throw new Error('Invalid split type');
    }
  }

  /**
   * Send split payment invitations
   */
  private async sendSplitInvitations(session: any, order: any, message?: string): Promise<void> {
    const invitationPromises = session.participants
      .filter(p => p.status === 'pending')
      .map(async (participant) => {
        const inviteLink = `${process.env.FRONTEND_URL}/split-payment/${session.id}/${participant.id}`;

        if (participant.customerId) {
          // Send push notification to app users
          await notificationService.sendPushNotification(
            participant.customerId,
            'Split Payment Request',
            `${session.initiator.name} has requested ${participant.amount.toFixed(2)} for an order from ${order.merchant.name}`,
            {
              type: 'split_payment_request',
              sessionId: session.id,
              participantId: participant.id,
              amount: participant.amount,
              inviteLink,
            }
          );
        } else if (participant.email) {
          // Send email to non-app users
          await notificationService.sendEmail(
            participant.email,
            'split_payment_invitation',
            {
              participantName: participant.name,
              initiatorName: session.initiator.name,
              amount: participant.amount,
              merchantName: order.merchant.name,
              orderTotal: order.total,
              message,
              inviteLink,
              expiresAt: session.expiresAt,
            }
          );
        } else if (participant.phone) {
          // Send SMS to phone numbers
          await notificationService.sendSMS(
            participant.phone,
            `${session.initiator.name} requests $${participant.amount.toFixed(2)} for a ${order.merchant.name} order. Pay here: ${inviteLink}`
          );
        }
      });

    await Promise.all(invitationPromises);
  }

  /**
   * Create Stripe payment link
   */
  private async createPaymentLink(session: any, participant: any): Promise<PaymentLink> {
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `Split payment for ${session.order.merchant.name}`,
            description: `Order #${session.order.orderNumber}`,
          },
          unit_amount: Math.round(participant.amount * 100),
        },
        quantity: 1,
      }],
      metadata: {
        sessionId: session.id,
        participantId: participant.id,
        orderId: session.orderId,
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL}/split-payment/success?session=${session.id}`,
        },
      },
    });

    return {
      url: paymentLink.url,
      expiresAt: session.expiresAt,
      participantId: participant.id,
    };
  }

  /**
   * Update session status based on participant statuses
   */
  private async updateSessionStatus(sessionId: string): Promise<void> {
    const session = await prisma.splitPaymentSession.findUnique({
      where: { id: sessionId },
      include: { participants: true },
    });

    if (!session) return;

    const acceptedCount = session.participants.filter(p => p.status === 'accepted').length;
    const totalCount = session.participants.length;

    if (acceptedCount === totalCount && session.status === 'pending') {
      await prisma.splitPaymentSession.update({
        where: { id: sessionId },
        data: { status: 'collecting' },
      });
    }
  }

  /**
   * Check if all payments are collected
   */
  private async checkSessionCompletion(sessionId: string): Promise<void> {
    const session = await prisma.splitPaymentSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: true,
        order: true,
      },
    });

    if (!session) return;

    const paidCount = session.participants.filter(p => p.status === 'paid').length;
    const totalCount = session.participants.filter(p => p.status !== 'declined').length;

    if (paidCount === totalCount) {
      // All payments collected
      await prisma.splitPaymentSession.update({
        where: { id: sessionId },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });

      // Update order payment status
      await prisma.order.update({
        where: { id: session.orderId },
        data: {
          paymentStatus: 'paid',
          paymentMethod: 'split',
        },
      });

      // Process order
      await orderService.processOrder(session.orderId);

      // Send completion notifications
      await this.sendCompletionNotifications(session);

      // Emit event
      this.emit('split_payment:completed', {
        sessionId,
        orderId: session.orderId,
      });
    }
  }

  /**
   * Send completion notifications
   */
  private async sendCompletionNotifications(session: any): Promise<void> {
    // Notify all participants
    const notifications = session.participants.map(async (participant) => {
      const message = `Split payment completed! Order from ${session.order.merchant.name} has been placed.`;

      if (participant.customerId) {
        await notificationService.sendPushNotification(
          participant.customerId,
          'Payment Complete',
          message,
          {
            type: 'split_payment_completed',
            orderId: session.orderId,
          }
        );
      } else if (participant.email) {
        await notificationService.sendEmail(
          participant.email,
          'split_payment_completed',
          {
            participantName: participant.name,
            orderDetails: session.order,
          }
        );
      }
    });

    await Promise.all(notifications);
  }

  /**
   * Redistribute amount when participant declines
   */
  private async redistributeAmount(sessionId: string, amount: number, remainingParticipants: any[]): Promise<void> {
    const additionalPerPerson = amount / remainingParticipants.length;

    for (const participant of remainingParticipants) {
      await prisma.splitParticipant.update({
        where: { id: participant.id },
        data: {
          amount: {
            increment: additionalPerPerson,
          },
        },
      });

      // Notify about amount change
      if (participant.customerId) {
        await notificationService.sendPushNotification(
          participant.customerId,
          'Split Amount Updated',
          `Your share has been updated to $${(participant.amount + additionalPerPerson).toFixed(2)}`,
          {
            type: 'split_amount_updated',
            sessionId,
            newAmount: participant.amount + additionalPerPerson,
          }
        );
      }
    }
  }

  /**
   * Cancel split payment session
   */
  private async cancelSession(sessionId: string, reason: string): Promise<void> {
    const session = await prisma.splitPaymentSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: true,
        order: true,
      },
    });

    if (!session) return;

    // Update session
    await prisma.splitPaymentSession.update({
      where: { id: sessionId },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason,
      },
    });

    // Refund any payments made
    const paidParticipants = session.participants.filter(p => p.status === 'paid');
    for (const participant of paidParticipants) {
      if (participant.paymentIntentId) {
        await stripe.refunds.create({
          payment_intent: participant.paymentIntentId,
          reason: 'requested_by_customer',
        });
      }
    }

    // Notify all participants
    await this.sendCancellationNotifications(session, reason);

    // Emit event
    this.emit('split_payment:cancelled', {
      sessionId,
      reason,
    });
  }

  /**
   * Send cancellation notifications
   */
  private async sendCancellationNotifications(session: any, reason: string): Promise<void> {
    const notifications = session.participants.map(async (participant) => {
      const message = `Split payment for ${session.order.merchant.name} has been cancelled: ${reason}`;

      if (participant.customerId) {
        await notificationService.sendPushNotification(
          participant.customerId,
          'Split Payment Cancelled',
          message,
          {
            type: 'split_payment_cancelled',
            sessionId: session.id,
            reason,
          }
        );
      }
    });

    await Promise.all(notifications);
  }

  /**
   * Check and handle expired sessions
   */
  private async checkExpiredSessions(): Promise<void> {
    const expiredSessions = await prisma.splitPaymentSession.findMany({
      where: {
        status: { in: ['pending', 'collecting'] },
        expiresAt: { lt: new Date() },
      },
    });

    for (const session of expiredSessions) {
      await this.cancelSession(session.id, 'Session expired');
    }
  }

  /**
   * Get split payment session details
   */
  async getSessionDetails(sessionId: string, participantId?: string): Promise<any> {
    const session = await prisma.splitPaymentSession.findUnique({
      where: { id: sessionId },
      include: {
        participants: true,
        order: {
          include: {
            merchant: true,
            items: {
              include: {
                product: true,
              },
            },
          },
        },
        initiator: true,
      },
    });

    if (!session) {
      throw new Error('Session not found');
    }

    // If participant ID provided, check access
    if (participantId) {
      const participant = session.participants.find(p => p.id === participantId);
      if (!participant) {
        throw new Error('Unauthorized');
      }
    }

    return {
      ...session,
      remainingAmount: session.participants
        .filter(p => p.status !== 'paid' && p.status !== 'declined')
        .reduce((sum, p) => sum + p.amount, 0),
      paidAmount: session.participants
        .filter(p => p.status === 'paid')
        .reduce((sum, p) => sum + p.amount, 0),
    };
  }

  /**
   * Get customer's split payment history
   */
  async getCustomerSplitHistory(customerId: string): Promise<any[]> {
    const sessions = await prisma.splitPaymentSession.findMany({
      where: {
        OR: [
          { initiatorId: customerId },
          {
            participants: {
              some: { customerId },
            },
          },
        ],
      },
      include: {
        order: {
          include: { merchant: true },
        },
        participants: true,
        initiator: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map(session => ({
      ...session,
      role: session.initiatorId === customerId ? 'initiator' : 'participant',
      myShare: session.participants.find(p => p.customerId === customerId)?.amount || 0,
    }));
  }
}

// Export singleton instance
export const splitPaymentService = new SplitPaymentService();