import { prisma, logger, redis } from '@reskflow/shared';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { CartService } from './CartService';

interface ShareLink {
  code: string;
  userId: string;
  cartSnapshot: any;
  createdAt: Date;
  expiresAt: Date;
  viewCount: number;
  importCount: number;
}

interface SharedCart {
  code: string;
  ownerName: string;
  merchantName: string;
  items: Array<{
    itemName: string;
    quantity: number;
    price: number;
    modifiers: any[];
    specialInstructions?: string;
  }>;
  totals: {
    subtotal: number;
    itemCount: number;
  };
  createdAt: Date;
  expiresAt: Date;
}

export class CartSharingService {
  private io: Server;
  private cartService: CartService;

  constructor(io: Server) {
    this.io = io;
    this.cartService = new CartService();
  }

  async createShareLink(userId: string, expiresIn: number = 3600): Promise<ShareLink> {
    try {
      // Get current cart
      const cart = await this.cartService.getCart(userId);
      
      if (cart.items.length === 0) {
        throw new Error('Cannot share an empty cart');
      }

      // Get user details
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('User not found');
      }

      // Get merchant details
      const merchant = await prisma.merchant.findUnique({
        where: { id: cart.merchantId! },
      });

      // Generate share code
      const code = this.generateShareCode();
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // Create cart snapshot
      const cartSnapshot = {
        userId,
        userName: user.name,
        merchantId: cart.merchantId,
        merchantName: merchant?.name || 'Unknown',
        items: cart.items.map(item => ({
          itemId: item.itemId,
          itemName: item.itemName,
          itemPrice: item.itemPrice,
          quantity: item.quantity,
          modifiers: item.modifiers,
          modifierPrice: item.modifierPrice,
          specialInstructions: item.specialInstructions,
          subtotal: item.subtotal,
        })),
        totals: {
          subtotal: cart.subtotal,
          itemCount: cart.itemCount,
        },
      };

      const shareLink: ShareLink = {
        code,
        userId,
        cartSnapshot,
        createdAt: new Date(),
        expiresAt,
        viewCount: 0,
        importCount: 0,
      };

      // Store in Redis
      await redis.set(
        `cart:share:${code}`,
        JSON.stringify(shareLink),
        'EX',
        expiresIn
      );

      // Track user's share links
      await redis.sadd(`user:${userId}:cart-shares`, code);

      logger.info(`Cart share link created: ${code} by user ${userId}`);
      return shareLink;
    } catch (error) {
      logger.error('Failed to create share link', error);
      throw error;
    }
  }

  async getSharedCart(shareCode: string): Promise<SharedCart | null> {
    try {
      const data = await redis.get(`cart:share:${shareCode}`);
      
      if (!data) {
        return null;
      }

      const shareLink: ShareLink = JSON.parse(data);
      
      // Check if expired
      if (new Date() > new Date(shareLink.expiresAt)) {
        await redis.del(`cart:share:${shareCode}`);
        return null;
      }

      // Increment view count
      shareLink.viewCount++;
      await redis.set(
        `cart:share:${shareCode}`,
        JSON.stringify(shareLink),
        'KEEPTTL'
      );

      // Return simplified shared cart data
      const sharedCart: SharedCart = {
        code: shareCode,
        ownerName: shareLink.cartSnapshot.userName,
        merchantName: shareLink.cartSnapshot.merchantName,
        items: shareLink.cartSnapshot.items,
        totals: shareLink.cartSnapshot.totals,
        createdAt: shareLink.createdAt,
        expiresAt: shareLink.expiresAt,
      };

      return sharedCart;
    } catch (error) {
      logger.error('Failed to get shared cart', error);
      return null;
    }
  }

  async importSharedCart(
    shareCode: string,
    userId: string,
    merge: boolean = false
  ): Promise<void> {
    try {
      const data = await redis.get(`cart:share:${shareCode}`);
      
      if (!data) {
        throw new Error('Share link not found or expired');
      }

      const shareLink: ShareLink = JSON.parse(data);
      
      // Check if expired
      if (new Date() > new Date(shareLink.expiresAt)) {
        await redis.del(`cart:share:${shareCode}`);
        throw new Error('Share link has expired');
      }

      // Cannot import own cart
      if (shareLink.userId === userId) {
        throw new Error('Cannot import your own cart');
      }

      // Get user's current cart
      const currentCart = await this.cartService.getCart(userId);
      
      // Check merchant compatibility
      if (currentCart.items.length > 0 && !merge) {
        if (currentCart.merchantId !== shareLink.cartSnapshot.merchantId) {
          throw new Error('Cannot import cart from different merchant. Clear your cart or enable merge.');
        }
      }

      // Clear cart if not merging
      if (!merge && currentCart.items.length > 0) {
        await this.cartService.clearCart(userId);
      }

      // Import items
      for (const item of shareLink.cartSnapshot.items) {
        try {
          // Verify item still exists and is available
          const menuItem = await prisma.menuItem.findUnique({
            where: { id: item.itemId },
          });

          if (menuItem && menuItem.status === 'AVAILABLE') {
            await this.cartService.addItem(userId, {
              merchantId: shareLink.cartSnapshot.merchantId,
              itemId: item.itemId,
              quantity: item.quantity,
              modifiers: item.modifiers,
              specialInstructions: item.specialInstructions,
            });
          } else {
            logger.warn(`Item ${item.itemName} is no longer available`);
          }
        } catch (error) {
          logger.error(`Failed to import item ${item.itemName}`, error);
        }
      }

      // Update import count
      shareLink.importCount++;
      await redis.set(
        `cart:share:${shareCode}`,
        JSON.stringify(shareLink),
        'KEEPTTL'
      );

      // Track import
      await this.trackImport(shareCode, userId, shareLink.userId);

      // Notify original owner (optional)
      this.notifyCartImported(shareLink.userId, userId);

      logger.info(`Cart imported from share ${shareCode} by user ${userId}`);
    } catch (error) {
      logger.error('Failed to import shared cart', error);
      throw error;
    }
  }

  async getUserShareLinks(userId: string): Promise<ShareLink[]> {
    try {
      const shareKeys = await redis.smembers(`user:${userId}:cart-shares`);
      const shareLinks: ShareLink[] = [];

      for (const code of shareKeys) {
        const data = await redis.get(`cart:share:${code}`);
        if (data) {
          shareLinks.push(JSON.parse(data));
        } else {
          // Clean up expired reference
          await redis.srem(`user:${userId}:cart-shares`, code);
        }
      }

      return shareLinks.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } catch (error) {
      logger.error('Failed to get user share links', error);
      return [];
    }
  }

  async revokeShareLink(userId: string, shareCode: string): Promise<void> {
    try {
      const data = await redis.get(`cart:share:${shareCode}`);
      
      if (!data) {
        throw new Error('Share link not found');
      }

      const shareLink: ShareLink = JSON.parse(data);
      
      if (shareLink.userId !== userId) {
        throw new Error('Unauthorized to revoke this share link');
      }

      // Delete share link
      await redis.del(`cart:share:${shareCode}`);
      await redis.srem(`user:${userId}:cart-shares`, shareCode);

      logger.info(`Share link ${shareCode} revoked by user ${userId}`);
    } catch (error) {
      logger.error('Failed to revoke share link', error);
      throw error;
    }
  }

  async createQuickShare(userId: string): Promise<{
    code: string;
    url: string;
    qrCode: string;
  }> {
    try {
      // Create short-lived share link (15 minutes)
      const shareLink = await this.createShareLink(userId, 900);
      
      // Generate URL
      const baseUrl = process.env.APP_BASE_URL || 'https://reskflow.app';
      const url = `${baseUrl}/cart/shared/${shareLink.code}`;
      
      // Generate QR code (mock - would use qrcode library)
      const qrCode = `data:image/png;base64,${Buffer.from(url).toString('base64')}`;

      return {
        code: shareLink.code,
        url,
        qrCode,
      };
    } catch (error) {
      logger.error('Failed to create quick share', error);
      throw error;
    }
  }

  private generateShareCode(): string {
    // Generate readable share code
    const adjectives = ['quick', 'tasty', 'fresh', 'yummy', 'super'];
    const nouns = ['pizza', 'burger', 'tacos', 'sushi', 'pasta'];
    const number = Math.floor(Math.random() * 999);
    
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    
    return `${adjective}-${noun}-${number}`;
  }

  private async trackImport(
    shareCode: string,
    importerId: string,
    ownerId: string
  ): Promise<void> {
    // Track import analytics
    const importData = {
      shareCode,
      importerId,
      ownerId,
      timestamp: new Date(),
    };

    await redis.lpush('cart:share:imports', JSON.stringify(importData));
    await redis.ltrim('cart:share:imports', 0, 9999); // Keep last 10k imports
  }

  private notifyCartImported(ownerId: string, importerId: string): void {
    // Emit notification if owner is connected
    this.io.to(`user:${ownerId}`).emit('cart:imported', {
      importerId,
      timestamp: new Date(),
    });
  }

  async getShareAnalytics(userId: string): Promise<{
    totalShares: number;
    totalViews: number;
    totalImports: number;
    popularItems: Array<{ itemName: string; shareCount: number }>;
  }> {
    try {
      const shareLinks = await this.getUserShareLinks(userId);
      
      const analytics = {
        totalShares: shareLinks.length,
        totalViews: shareLinks.reduce((sum, link) => sum + link.viewCount, 0),
        totalImports: shareLinks.reduce((sum, link) => sum + link.importCount, 0),
        popularItems: this.getPopularSharedItems(shareLinks),
      };

      return analytics;
    } catch (error) {
      logger.error('Failed to get share analytics', error);
      return {
        totalShares: 0,
        totalViews: 0,
        totalImports: 0,
        popularItems: [],
      };
    }
  }

  private getPopularSharedItems(shareLinks: ShareLink[]): Array<{
    itemName: string;
    shareCount: number;
  }> {
    const itemCounts = new Map<string, number>();

    shareLinks.forEach(link => {
      link.cartSnapshot.items.forEach((item: any) => {
        const count = itemCounts.get(item.itemName) || 0;
        itemCounts.set(item.itemName, count + 1);
      });
    });

    return Array.from(itemCounts.entries())
      .map(([itemName, shareCount]) => ({ itemName, shareCount }))
      .sort((a, b) => b.shareCount - a.shareCount)
      .slice(0, 10);
  }
}