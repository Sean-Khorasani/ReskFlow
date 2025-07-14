import { prisma, logger, redis } from '@reskflow/shared';
import { v4 as uuidv4 } from 'uuid';
import Joi from 'joi';

interface CartItem {
  id: string;
  cartId: string;
  merchantId: string;
  itemId: string;
  itemName: string;
  itemPrice: number;
  quantity: number;
  modifiers?: any[];
  modifierPrice: number;
  specialInstructions?: string;
  subtotal: number;
  addedAt: Date;
  updatedAt: Date;
}

interface Cart {
  id: string;
  userId: string;
  merchantId?: string;
  items: CartItem[];
  subtotal: number;
  tax: number;
  reskflowFee: number;
  serviceFee: number;
  total: number;
  itemCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface AddItemInput {
  merchantId: string;
  itemId: string;
  quantity: number;
  modifiers?: Array<{
    groupId: string;
    modifierIds: string[];
  }>;
  specialInstructions?: string;
}

interface CartValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  updates: {
    itemsRemoved: string[];
    pricesUpdated: Array<{ itemId: string; oldPrice: number; newPrice: number }>;
  };
}

const addItemSchema = Joi.object({
  merchantId: Joi.string().required(),
  itemId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  modifiers: Joi.array().items(
    Joi.object({
      groupId: Joi.string().required(),
      modifierIds: Joi.array().items(Joi.string()).required(),
    })
  ),
  specialInstructions: Joi.string().max(500),
});

export class CartService {
  async getCart(userId: string): Promise<Cart> {
    try {
      const cacheKey = `cart:${userId}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return JSON.parse(cached);
      }

      // Build cart from stored items
      const cart = await this.buildCart(userId);
      
      // Cache for 30 minutes
      await redis.set(cacheKey, JSON.stringify(cart), 'EX', 1800);
      
      return cart;
    } catch (error) {
      logger.error('Failed to get cart', error);
      throw error;
    }
  }

  async addItem(userId: string, input: AddItemInput): Promise<CartItem> {
    try {
      // Validate input
      const { error } = addItemSchema.validate(input);
      if (error) {
        throw new Error(error.details[0].message);
      }

      // Get item details
      const item = await prisma.menuItem.findUnique({
        where: { id: input.itemId },
        include: {
          merchant: true,
          modifierGroups: {
            include: { modifiers: true },
          },
        },
      });

      if (!item || item.status !== 'AVAILABLE') {
        throw new Error('Item not available');
      }

      if (item.merchantId !== input.merchantId) {
        throw new Error('Item does not belong to specified merchant');
      }

      // Check if cart has items from different merchant
      const existingCart = await this.getCart(userId);
      if (existingCart.merchantId && existingCart.merchantId !== input.merchantId) {
        throw new Error('Cannot add items from different merchants. Please clear your cart first.');
      }

      // Validate modifiers
      let modifierPrice = 0;
      const selectedModifiers: any[] = [];

      if (input.modifiers && input.modifiers.length > 0) {
        for (const selection of input.modifiers) {
          const group = item.modifierGroups.find(g => g.id === selection.groupId);
          if (!group) {
            throw new Error('Invalid modifier group');
          }

          // Validate selection count
          if (selection.modifierIds.length < group.minSelections ||
              selection.modifierIds.length > group.maxSelections) {
            throw new Error(`${group.name} requires ${group.minSelections}-${group.maxSelections} selections`);
          }

          // Calculate modifier prices
          for (const modifierId of selection.modifierIds) {
            const modifier = group.modifiers.find(m => m.id === modifierId);
            if (!modifier) {
              throw new Error('Invalid modifier');
            }
            modifierPrice += modifier.price;
            selectedModifiers.push({
              groupId: group.id,
              groupName: group.name,
              modifierId: modifier.id,
              modifierName: modifier.name,
              price: modifier.price,
            });
          }
        }
      }

      // Check for required modifiers
      const requiredGroups = item.modifierGroups.filter(g => g.isRequired);
      for (const group of requiredGroups) {
        if (!input.modifiers?.find(m => m.groupId === group.id)) {
          throw new Error(`${group.name} is required`);
        }
      }

      // Create cart item
      const cartItemId = uuidv4();
      const subtotal = (item.price + modifierPrice) * input.quantity;

      const cartItem: CartItem = {
        id: cartItemId,
        cartId: userId, // Using userId as cartId for simplicity
        merchantId: input.merchantId,
        itemId: item.id,
        itemName: item.name,
        itemPrice: item.price,
        quantity: input.quantity,
        modifiers: selectedModifiers,
        modifierPrice,
        specialInstructions: input.specialInstructions,
        subtotal,
        addedAt: new Date(),
        updatedAt: new Date(),
      };

      // Store in Redis
      await redis.hset(`cart:items:${userId}`, cartItemId, JSON.stringify(cartItem));
      
      // Update cart merchant if needed
      if (!existingCart.merchantId) {
        await redis.set(`cart:merchant:${userId}`, input.merchantId, 'EX', 86400);
      }

      // Invalidate cart cache
      await redis.del(`cart:${userId}`);

      // Emit update event
      await redis.publish(`cart:updates:${userId}`, JSON.stringify({
        action: 'item_added',
        item: cartItem,
        timestamp: new Date(),
      }));

      logger.info(`Item added to cart: ${userId} - ${item.name}`);
      return cartItem;
    } catch (error) {
      logger.error('Failed to add item to cart', error);
      throw error;
    }
  }

  async updateItem(
    userId: string,
    cartItemId: string,
    updates: {
      quantity?: number;
      modifiers?: any[];
      specialInstructions?: string;
    }
  ): Promise<CartItem> {
    try {
      // Get existing item
      const itemData = await redis.hget(`cart:items:${userId}`, cartItemId);
      if (!itemData) {
        throw new Error('Cart item not found');
      }

      const cartItem: CartItem = JSON.parse(itemData);

      // Update fields
      if (updates.quantity !== undefined) {
        if (updates.quantity < 1) {
          throw new Error('Quantity must be at least 1');
        }
        cartItem.quantity = updates.quantity;
      }

      if (updates.modifiers !== undefined) {
        // Re-validate and calculate modifier prices
        const item = await prisma.menuItem.findUnique({
          where: { id: cartItem.itemId },
          include: {
            modifierGroups: {
              include: { modifiers: true },
            },
          },
        });

        if (!item) {
          throw new Error('Item no longer available');
        }

        let modifierPrice = 0;
        const selectedModifiers: any[] = [];

        // Validate new modifiers (similar to addItem)
        // ... validation logic ...

        cartItem.modifiers = selectedModifiers;
        cartItem.modifierPrice = modifierPrice;
      }

      if (updates.specialInstructions !== undefined) {
        cartItem.specialInstructions = updates.specialInstructions;
      }

      // Recalculate subtotal
      cartItem.subtotal = (cartItem.itemPrice + cartItem.modifierPrice) * cartItem.quantity;
      cartItem.updatedAt = new Date();

      // Update in Redis
      await redis.hset(`cart:items:${userId}`, cartItemId, JSON.stringify(cartItem));
      
      // Invalidate cart cache
      await redis.del(`cart:${userId}`);

      // Emit update event
      await redis.publish(`cart:updates:${userId}`, JSON.stringify({
        action: 'item_updated',
        item: cartItem,
        timestamp: new Date(),
      }));

      return cartItem;
    } catch (error) {
      logger.error('Failed to update cart item', error);
      throw error;
    }
  }

  async removeItem(userId: string, cartItemId: string): Promise<void> {
    try {
      const removed = await redis.hdel(`cart:items:${userId}`, cartItemId);
      
      if (removed === 0) {
        throw new Error('Cart item not found');
      }

      // Check if cart is now empty
      const remainingItems = await redis.hlen(`cart:items:${userId}`);
      if (remainingItems === 0) {
        // Clear merchant association
        await redis.del(`cart:merchant:${userId}`);
      }

      // Invalidate cart cache
      await redis.del(`cart:${userId}`);

      // Emit update event
      await redis.publish(`cart:updates:${userId}`, JSON.stringify({
        action: 'item_removed',
        itemId: cartItemId,
        timestamp: new Date(),
      }));

      logger.info(`Item removed from cart: ${userId} - ${cartItemId}`);
    } catch (error) {
      logger.error('Failed to remove cart item', error);
      throw error;
    }
  }

  async clearCart(userId: string): Promise<void> {
    try {
      await redis.del(`cart:items:${userId}`);
      await redis.del(`cart:merchant:${userId}`);
      await redis.del(`cart:${userId}`);

      // Emit update event
      await redis.publish(`cart:updates:${userId}`, JSON.stringify({
        action: 'cart_cleared',
        timestamp: new Date(),
      }));

      logger.info(`Cart cleared: ${userId}`);
    } catch (error) {
      logger.error('Failed to clear cart', error);
      throw error;
    }
  }

  async validateCart(userId: string): Promise<CartValidation> {
    try {
      const validation: CartValidation = {
        valid: true,
        errors: [],
        warnings: [],
        updates: {
          itemsRemoved: [],
          pricesUpdated: [],
        },
      };

      const cart = await this.getCart(userId);
      
      if (cart.items.length === 0) {
        validation.valid = false;
        validation.errors.push('Cart is empty');
        return validation;
      }

      // Check merchant status
      const merchant = await prisma.merchant.findUnique({
        where: { id: cart.merchantId! },
        include: { operatingHours: true },
      });

      if (!merchant || merchant.status !== 'ACTIVE') {
        validation.valid = false;
        validation.errors.push('Merchant is no longer available');
        return validation;
      }

      if (!merchant.isOpen) {
        validation.warnings.push('Merchant is currently closed');
      }

      // Validate each item
      const itemsToRemove: string[] = [];
      const priceUpdates: any[] = [];

      for (const cartItem of cart.items) {
        const item = await prisma.menuItem.findUnique({
          where: { id: cartItem.itemId },
        });

        if (!item) {
          itemsToRemove.push(cartItem.id);
          validation.warnings.push(`${cartItem.itemName} is no longer available`);
          continue;
        }

        if (item.status !== 'AVAILABLE') {
          itemsToRemove.push(cartItem.id);
          validation.warnings.push(`${cartItem.itemName} is currently unavailable`);
          continue;
        }

        if (item.trackInventory && item.quantity < cartItem.quantity) {
          validation.errors.push(`${cartItem.itemName}: Only ${item.quantity} available`);
          validation.valid = false;
        }

        if (item.price !== cartItem.itemPrice) {
          priceUpdates.push({
            itemId: cartItem.id,
            oldPrice: cartItem.itemPrice,
            newPrice: item.price,
          });
          validation.warnings.push(`${cartItem.itemName} price has changed`);
        }
      }

      // Remove unavailable items
      for (const itemId of itemsToRemove) {
        await this.removeItem(userId, itemId);
        validation.updates.itemsRemoved.push(itemId);
      }

      // Update prices
      for (const update of priceUpdates) {
        const itemData = await redis.hget(`cart:items:${userId}`, update.itemId);
        if (itemData) {
          const cartItem = JSON.parse(itemData);
          cartItem.itemPrice = update.newPrice;
          cartItem.subtotal = (cartItem.itemPrice + cartItem.modifierPrice) * cartItem.quantity;
          await redis.hset(`cart:items:${userId}`, update.itemId, JSON.stringify(cartItem));
        }
        validation.updates.pricesUpdated.push(update);
      }

      // Check minimum order amount
      const updatedCart = await this.buildCart(userId);
      if (updatedCart.subtotal < merchant.minOrderAmount) {
        validation.errors.push(`Minimum order amount is $${merchant.minOrderAmount}`);
        validation.valid = false;
      }

      // Invalidate cache if changes were made
      if (itemsToRemove.length > 0 || priceUpdates.length > 0) {
        await redis.del(`cart:${userId}`);
      }

      return validation;
    } catch (error) {
      logger.error('Failed to validate cart', error);
      throw error;
    }
  }

  private async buildCart(userId: string): Promise<Cart> {
    try {
      const items = await redis.hgetall(`cart:items:${userId}`);
      const merchantId = await redis.get(`cart:merchant:${userId}`);

      const cartItems: CartItem[] = Object.values(items).map(item => JSON.parse(item));
      
      // Calculate totals
      const subtotal = cartItems.reduce((sum, item) => sum + item.subtotal, 0);
      const tax = subtotal * 0.08; // 8% tax
      let reskflowFee = 0;
      let serviceFee = 0;

      if (merchantId) {
        const merchant = await prisma.merchant.findUnique({
          where: { id: merchantId },
        });

        if (merchant) {
          reskflowFee = merchant.reskflowFee;
          serviceFee = subtotal * merchant.serviceFee;
        }
      }

      const total = subtotal + tax + reskflowFee + serviceFee;

      return {
        id: userId,
        userId,
        merchantId: merchantId || undefined,
        items: cartItems.sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime()),
        subtotal,
        tax,
        reskflowFee,
        serviceFee,
        total,
        itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0),
        createdAt: cartItems.length > 0 ? cartItems[0].addedAt : new Date(),
        updatedAt: cartItems.length > 0 
          ? cartItems.reduce((latest, item) => 
              item.updatedAt > latest ? item.updatedAt : latest, cartItems[0].updatedAt)
          : new Date(),
      };
    } catch (error) {
      logger.error('Failed to build cart', error);
      throw error;
    }
  }

  async mergeCart(userId: string, guestCartId: string): Promise<Cart> {
    try {
      // Get guest cart items
      const guestItems = await redis.hgetall(`cart:items:${guestCartId}`);
      
      if (Object.keys(guestItems).length === 0) {
        return this.getCart(userId);
      }

      // Get user's existing cart
      const userCart = await this.getCart(userId);
      
      // Merge items
      for (const [itemId, itemData] of Object.entries(guestItems)) {
        const guestItem: CartItem = JSON.parse(itemData);
        
        // Check if user cart already has this merchant
        if (userCart.merchantId && userCart.merchantId !== guestItem.merchantId) {
          logger.warn(`Skipping item from different merchant: ${guestItem.itemName}`);
          continue;
        }

        // Check if item already exists in user cart
        const existingItem = userCart.items.find(
          item => item.itemId === guestItem.itemId && 
                  JSON.stringify(item.modifiers) === JSON.stringify(guestItem.modifiers)
        );

        if (existingItem) {
          // Update quantity
          await this.updateItem(userId, existingItem.id, {
            quantity: existingItem.quantity + guestItem.quantity,
          });
        } else {
          // Add new item
          await this.addItem(userId, {
            merchantId: guestItem.merchantId,
            itemId: guestItem.itemId,
            quantity: guestItem.quantity,
            modifiers: guestItem.modifiers,
            specialInstructions: guestItem.specialInstructions,
          });
        }
      }

      // Clear guest cart
      await this.clearCart(guestCartId);

      return this.getCart(userId);
    } catch (error) {
      logger.error('Failed to merge cart', error);
      throw error;
    }
  }
}