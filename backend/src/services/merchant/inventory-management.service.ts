/**
 * Inventory Management Service
 * Manages merchant inventory, stock levels, and availability
 */

import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'events';
import { CronJob } from 'cron';
import { logger } from '../../utils/logger';
import { notificationService } from '../notification/notification.service';

const prisma = new PrismaClient();

interface InventoryItem {
  id: string;
  merchantId: string;
  productId?: string;
  ingredientId?: string;
  name: string;
  category: string;
  unit: 'piece' | 'kg' | 'g' | 'l' | 'ml' | 'dozen' | 'box' | 'case';
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  minimumStock: number;
  maximumStock: number;
  reorderPoint: number;
  reorderQuantity: number;
  cost: number;
  supplier?: SupplierInfo;
  lastRestockedAt?: Date;
  expiryDate?: Date;
  batchNumber?: string;
  location?: string;
}

interface SupplierInfo {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  leadTimeDays: number;
  minimumOrderValue?: number;
  preferredDeliveryDays?: number[];
}

interface StockMovement {
  id: string;
  inventoryItemId: string;
  type: 'in' | 'out' | 'adjustment' | 'waste' | 'return';
  quantity: number;
  previousStock: number;
  newStock: number;
  reason: string;
  reference?: string; // Order ID, adjustment ID, etc.
  performedBy: string;
  performedAt: Date;
  cost?: number;
  notes?: string;
}

interface StockAlert {
  id: string;
  merchantId: string;
  type: 'low_stock' | 'out_of_stock' | 'expiring_soon' | 'expired' | 'overstock';
  severity: 'low' | 'medium' | 'high' | 'critical';
  itemId: string;
  itemName: string;
  currentLevel: number;
  threshold: number;
  message: string;
  createdAt: Date;
  acknowledgedAt?: Date;
  resolvedAt?: Date;
}

interface InventorySnapshot {
  id: string;
  merchantId: string;
  date: Date;
  totalItems: number;
  totalValue: number;
  lowStockItems: number;
  outOfStockItems: number;
  expiringItems: number;
  wasteValue: number;
  turnoverRate: number;
}

interface PurchaseOrder {
  id: string;
  merchantId: string;
  supplierId: string;
  orderNumber: string;
  status: 'draft' | 'sent' | 'confirmed' | 'partially_received' | 'received' | 'cancelled';
  items: PurchaseOrderItem[];
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  orderedAt?: Date;
  expectedDelivery?: Date;
  receivedAt?: Date;
  notes?: string;
}

interface PurchaseOrderItem {
  inventoryItemId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  received?: number;
  notes?: string;
}

export class InventoryManagementService extends EventEmitter {
  private alertThresholds = {
    lowStock: 0.25, // 25% of minimum stock
    expiringSoon: 3, // 3 days before expiry
    overstockMultiplier: 1.5, // 150% of maximum stock
  };

  constructor() {
    super();
    this.initializeScheduledJobs();
  }

  /**
   * Initialize scheduled jobs
   */
  private initializeScheduledJobs() {
    // Check stock levels every hour
    const stockCheckJob = new CronJob('0 * * * *', async () => {
      await this.checkAllStockLevels();
    });
    stockCheckJob.start();

    // Check expiring items daily at 6 AM
    const expiryCheckJob = new CronJob('0 6 * * *', async () => {
      await this.checkExpiringItems();
    });
    expiryCheckJob.start();

    // Generate daily inventory snapshot at midnight
    const snapshotJob = new CronJob('0 0 * * *', async () => {
      await this.generateDailySnapshots();
    });
    snapshotJob.start();

    // Auto-generate purchase orders weekly
    const purchaseOrderJob = new CronJob('0 9 * * 1', async () => {
      await this.generateAutoPurchaseOrders();
    });
    purchaseOrderJob.start();
  }

  /**
   * Add inventory item
   */
  async addInventoryItem(
    merchantId: string,
    item: Omit<InventoryItem, 'id' | 'merchantId' | 'availableStock' | 'reservedStock'>
  ): Promise<InventoryItem> {
    try {
      // Validate merchant
      const merchant = await prisma.merchant.findUnique({
        where: { id: merchantId },
      });

      if (!merchant) {
        throw new Error('Merchant not found');
      }

      // Calculate available stock
      const availableStock = item.currentStock;

      // Create inventory item
      const inventoryItem = await prisma.inventoryItem.create({
        data: {
          ...item,
          merchantId,
          availableStock,
          reservedStock: 0,
        },
      });

      // Create initial stock movement
      await this.recordStockMovement({
        inventoryItemId: inventoryItem.id,
        type: 'in',
        quantity: item.currentStock,
        previousStock: 0,
        newStock: item.currentStock,
        reason: 'Initial stock',
        performedBy: merchantId,
        cost: item.cost * item.currentStock,
      });

      // Check if item needs alerts
      await this.checkItemStockLevel(inventoryItem);

      // Emit event
      this.emit('inventory:item_added', {
        merchantId,
        item: inventoryItem,
      });

      return inventoryItem;

    } catch (error) {
      logger.error('Failed to add inventory item', error);
      throw error;
    }
  }

  /**
   * Update stock level
   */
  async updateStock(
    itemId: string,
    quantity: number,
    type: StockMovement['type'],
    reason: string,
    performedBy: string,
    reference?: string
  ): Promise<InventoryItem> {
    try {
      const item = await prisma.inventoryItem.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        throw new Error('Inventory item not found');
      }

      // Calculate new stock
      const previousStock = item.currentStock;
      let newStock: number;

      switch (type) {
        case 'in':
          newStock = previousStock + quantity;
          break;
        case 'out':
          if (quantity > item.availableStock) {
            throw new Error('Insufficient stock available');
          }
          newStock = previousStock - quantity;
          break;
        case 'adjustment':
          newStock = quantity; // Absolute value
          break;
        case 'waste':
        case 'return':
          newStock = previousStock - quantity;
          break;
        default:
          throw new Error('Invalid stock movement type');
      }

      // Update inventory
      const updatedItem = await prisma.inventoryItem.update({
        where: { id: itemId },
        data: {
          currentStock: newStock,
          availableStock: newStock - item.reservedStock,
          lastRestockedAt: type === 'in' ? new Date() : item.lastRestockedAt,
        },
      });

      // Record movement
      await this.recordStockMovement({
        inventoryItemId: itemId,
        type,
        quantity,
        previousStock,
        newStock,
        reason,
        reference,
        performedBy,
        cost: type === 'in' ? item.cost * quantity : undefined,
      });

      // Check stock levels and create alerts
      await this.checkItemStockLevel(updatedItem);

      // Update product availability if linked
      if (item.productId) {
        await this.updateProductAvailability(item.productId);
      }

      // Emit event
      this.emit('inventory:stock_updated', {
        item: updatedItem,
        movement: { type, quantity, reason },
      });

      return updatedItem;

    } catch (error) {
      logger.error('Failed to update stock', error);
      throw error;
    }
  }

  /**
   * Reserve stock for order
   */
  async reserveStock(
    orderId: string,
    items: Array<{ productId: string; quantity: number }>
  ): Promise<void> {
    try {
      for (const orderItem of items) {
        // Get product ingredients/inventory mapping
        const productInventory = await prisma.productInventory.findMany({
          where: { productId: orderItem.productId },
          include: { inventoryItem: true },
        });

        for (const mapping of productInventory) {
          const requiredQuantity = mapping.quantity * orderItem.quantity;
          const inventoryItem = mapping.inventoryItem;

          if (inventoryItem.availableStock < requiredQuantity) {
            throw new Error(`Insufficient stock for ${inventoryItem.name}`);
          }

          // Reserve stock
          await prisma.inventoryItem.update({
            where: { id: inventoryItem.id },
            data: {
              reservedStock: {
                increment: requiredQuantity,
              },
              availableStock: {
                decrement: requiredQuantity,
              },
            },
          });

          // Create reservation record
          await prisma.stockReservation.create({
            data: {
              inventoryItemId: inventoryItem.id,
              orderId,
              quantity: requiredQuantity,
              status: 'reserved',
            },
          });
        }
      }

      logger.info(`Stock reserved for order ${orderId}`);

    } catch (error) {
      logger.error('Failed to reserve stock', error);
      // Rollback reservations
      await this.releaseStock(orderId);
      throw error;
    }
  }

  /**
   * Release reserved stock
   */
  async releaseStock(orderId: string): Promise<void> {
    try {
      const reservations = await prisma.stockReservation.findMany({
        where: {
          orderId,
          status: 'reserved',
        },
      });

      for (const reservation of reservations) {
        // Release stock
        await prisma.inventoryItem.update({
          where: { id: reservation.inventoryItemId },
          data: {
            reservedStock: {
              decrement: reservation.quantity,
            },
            availableStock: {
              increment: reservation.quantity,
            },
          },
        });

        // Update reservation
        await prisma.stockReservation.update({
          where: { id: reservation.id },
          data: { status: 'released' },
        });
      }

      logger.info(`Stock released for order ${orderId}`);

    } catch (error) {
      logger.error('Failed to release stock', error);
      throw error;
    }
  }

  /**
   * Commit stock (when order is completed)
   */
  async commitStock(orderId: string): Promise<void> {
    try {
      const reservations = await prisma.stockReservation.findMany({
        where: {
          orderId,
          status: 'reserved',
        },
        include: { inventoryItem: true },
      });

      for (const reservation of reservations) {
        // Update stock levels
        await prisma.inventoryItem.update({
          where: { id: reservation.inventoryItemId },
          data: {
            currentStock: {
              decrement: reservation.quantity,
            },
            reservedStock: {
              decrement: reservation.quantity,
            },
          },
        });

        // Record stock movement
        await this.recordStockMovement({
          inventoryItemId: reservation.inventoryItemId,
          type: 'out',
          quantity: reservation.quantity,
          previousStock: reservation.inventoryItem.currentStock,
          newStock: reservation.inventoryItem.currentStock - reservation.quantity,
          reason: 'Order fulfilled',
          reference: orderId,
          performedBy: 'system',
        });

        // Update reservation
        await prisma.stockReservation.update({
          where: { id: reservation.id },
          data: {
            status: 'committed',
            committedAt: new Date(),
          },
        });
      }

      logger.info(`Stock committed for order ${orderId}`);

    } catch (error) {
      logger.error('Failed to commit stock', error);
      throw error;
    }
  }

  /**
   * Create purchase order
   */
  async createPurchaseOrder(
    merchantId: string,
    data: {
      supplierId: string;
      items: Array<{
        inventoryItemId: string;
        quantity: number;
        unitCost?: number;
      }>;
      notes?: string;
    }
  ): Promise<PurchaseOrder> {
    try {
      // Validate items and calculate totals
      let subtotal = 0;
      const orderItems: PurchaseOrderItem[] = [];

      for (const item of data.items) {
        const inventoryItem = await prisma.inventoryItem.findUnique({
          where: { id: item.inventoryItemId },
        });

        if (!inventoryItem || inventoryItem.merchantId !== merchantId) {
          throw new Error(`Invalid inventory item: ${item.inventoryItemId}`);
        }

        const unitCost = item.unitCost || inventoryItem.cost;
        const totalCost = unitCost * item.quantity;
        subtotal += totalCost;

        orderItems.push({
          inventoryItemId: item.inventoryItemId,
          quantity: item.quantity,
          unitCost,
          totalCost,
        });
      }

      const tax = subtotal * 0.08; // 8% tax
      const shipping = 0; // To be determined by supplier
      const total = subtotal + tax + shipping;

      // Create purchase order
      const purchaseOrder = await prisma.purchaseOrder.create({
        data: {
          merchantId,
          supplierId: data.supplierId,
          orderNumber: this.generateOrderNumber(),
          status: 'draft',
          items: orderItems,
          subtotal,
          tax,
          shipping,
          total,
          notes: data.notes,
        },
      });

      // Emit event
      this.emit('inventory:purchase_order_created', {
        merchantId,
        purchaseOrder,
      });

      return purchaseOrder;

    } catch (error) {
      logger.error('Failed to create purchase order', error);
      throw error;
    }
  }

  /**
   * Receive purchase order
   */
  async receivePurchaseOrder(
    purchaseOrderId: string,
    items: Array<{
      inventoryItemId: string;
      receivedQuantity: number;
      batchNumber?: string;
      expiryDate?: Date;
    }>
  ): Promise<void> {
    try {
      const purchaseOrder = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
      });

      if (!purchaseOrder) {
        throw new Error('Purchase order not found');
      }

      if (purchaseOrder.status === 'received' || purchaseOrder.status === 'cancelled') {
        throw new Error('Purchase order already processed');
      }

      // Process each received item
      for (const receivedItem of items) {
        const orderItem = purchaseOrder.items.find(
          i => i.inventoryItemId === receivedItem.inventoryItemId
        );

        if (!orderItem) {
          throw new Error(`Item ${receivedItem.inventoryItemId} not in purchase order`);
        }

        // Update inventory
        await this.updateStock(
          receivedItem.inventoryItemId,
          receivedItem.receivedQuantity,
          'in',
          `Purchase order ${purchaseOrder.orderNumber}`,
          'system',
          purchaseOrderId
        );

        // Update batch and expiry if provided
        if (receivedItem.batchNumber || receivedItem.expiryDate) {
          await prisma.inventoryItem.update({
            where: { id: receivedItem.inventoryItemId },
            data: {
              batchNumber: receivedItem.batchNumber,
              expiryDate: receivedItem.expiryDate,
            },
          });
        }

        // Update order item received quantity
        orderItem.received = (orderItem.received || 0) + receivedItem.receivedQuantity;
      }

      // Check if fully received
      const fullyReceived = purchaseOrder.items.every(
        item => (item.received || 0) >= item.quantity
      );

      // Update purchase order status
      await prisma.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: fullyReceived ? 'received' : 'partially_received',
          receivedAt: fullyReceived ? new Date() : undefined,
          items: purchaseOrder.items,
        },
      });

      // Send notification
      await notificationService.sendMerchantNotification(
        purchaseOrder.merchantId,
        'Purchase Order Received',
        `Purchase order ${purchaseOrder.orderNumber} has been ${fullyReceived ? 'fully' : 'partially'} received`,
        {
          type: 'purchase_order_received',
          purchaseOrderId,
        }
      );

    } catch (error) {
      logger.error('Failed to receive purchase order', error);
      throw error;
    }
  }

  /**
   * Get inventory summary
   */
  async getInventorySummary(merchantId: string): Promise<{
    totalItems: number;
    totalValue: number;
    lowStockItems: InventoryItem[];
    outOfStockItems: InventoryItem[];
    expiringItems: InventoryItem[];
    recentMovements: StockMovement[];
    alerts: StockAlert[];
  }> {
    const [inventory, movements, alerts] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { merchantId },
      }),
      prisma.stockMovement.findMany({
        where: {
          inventoryItem: { merchantId },
        },
        orderBy: { performedAt: 'desc' },
        take: 20,
        include: {
          inventoryItem: true,
        },
      }),
      prisma.stockAlert.findMany({
        where: {
          merchantId,
          resolvedAt: null,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    const lowStockItems = inventory.filter(
      item => item.currentStock <= item.minimumStock && item.currentStock > 0
    );

    const outOfStockItems = inventory.filter(
      item => item.currentStock === 0
    );

    const expiringItems = inventory.filter(
      item => item.expiryDate && item.expiryDate <= threeDaysFromNow
    );

    const totalValue = inventory.reduce(
      (sum, item) => sum + (item.currentStock * item.cost),
      0
    );

    return {
      totalItems: inventory.length,
      totalValue,
      lowStockItems,
      outOfStockItems,
      expiringItems,
      recentMovements: movements,
      alerts,
    };
  }

  /**
   * Get inventory report
   */
  async getInventoryReport(
    merchantId: string,
    startDate: Date,
    endDate: Date
  ): Promise<{
    openingStock: { quantity: number; value: number };
    closingStock: { quantity: number; value: number };
    stockIn: { quantity: number; value: number };
    stockOut: { quantity: number; value: number };
    waste: { quantity: number; value: number };
    turnoverRate: number;
    topMovingItems: Array<{ item: InventoryItem; movement: number }>;
    slowMovingItems: Array<{ item: InventoryItem; movement: number }>;
  }> {
    // Get all movements in period
    const movements = await prisma.stockMovement.findMany({
      where: {
        inventoryItem: { merchantId },
        performedAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        inventoryItem: true,
      },
    });

    // Calculate aggregates
    const stockIn = movements
      .filter(m => m.type === 'in')
      .reduce((acc, m) => ({
        quantity: acc.quantity + m.quantity,
        value: acc.value + (m.cost || 0),
      }), { quantity: 0, value: 0 });

    const stockOut = movements
      .filter(m => m.type === 'out')
      .reduce((acc, m) => ({
        quantity: acc.quantity + m.quantity,
        value: acc.value + (m.quantity * m.inventoryItem.cost),
      }), { quantity: 0, value: 0 });

    const waste = movements
      .filter(m => m.type === 'waste')
      .reduce((acc, m) => ({
        quantity: acc.quantity + m.quantity,
        value: acc.value + (m.quantity * m.inventoryItem.cost),
      }), { quantity: 0, value: 0 });

    // Get opening and closing stock
    const currentInventory = await prisma.inventoryItem.findMany({
      where: { merchantId },
    });

    const closingStock = currentInventory.reduce((acc, item) => ({
      quantity: acc.quantity + item.currentStock,
      value: acc.value + (item.currentStock * item.cost),
    }), { quantity: 0, value: 0 });

    const openingStock = {
      quantity: closingStock.quantity - stockIn.quantity + stockOut.quantity + waste.quantity,
      value: closingStock.value - stockIn.value + stockOut.value + waste.value,
    };

    // Calculate turnover rate
    const averageStock = (openingStock.value + closingStock.value) / 2;
    const turnoverRate = averageStock > 0 ? stockOut.value / averageStock : 0;

    // Get item movement statistics
    const itemMovements = new Map<string, number>();
    movements.forEach(m => {
      if (m.type === 'out') {
        const current = itemMovements.get(m.inventoryItemId) || 0;
        itemMovements.set(m.inventoryItemId, current + m.quantity);
      }
    });

    const itemsWithMovement = Array.from(itemMovements.entries())
      .map(([itemId, movement]) => ({
        item: currentInventory.find(i => i.id === itemId)!,
        movement,
      }))
      .filter(i => i.item)
      .sort((a, b) => b.movement - a.movement);

    return {
      openingStock,
      closingStock,
      stockIn,
      stockOut,
      waste,
      turnoverRate,
      topMovingItems: itemsWithMovement.slice(0, 10),
      slowMovingItems: itemsWithMovement.slice(-10).reverse(),
    };
  }

  /**
   * Set auto-reorder rules
   */
  async setAutoReorderRules(
    itemId: string,
    rules: {
      enabled: boolean;
      reorderPoint?: number;
      reorderQuantity?: number;
      preferredSupplierId?: string;
      maxOrderFrequencyDays?: number;
    }
  ): Promise<void> {
    try {
      await prisma.inventoryItem.update({
        where: { id: itemId },
        data: {
          autoReorderEnabled: rules.enabled,
          reorderPoint: rules.reorderPoint,
          reorderQuantity: rules.reorderQuantity,
          preferredSupplierId: rules.preferredSupplierId,
          maxOrderFrequencyDays: rules.maxOrderFrequencyDays,
        },
      });

      logger.info(`Auto-reorder rules updated for item ${itemId}`);

    } catch (error) {
      logger.error('Failed to set auto-reorder rules', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  private async recordStockMovement(movement: Omit<StockMovement, 'id' | 'performedAt'>): Promise<void> {
    await prisma.stockMovement.create({
      data: {
        ...movement,
        performedAt: new Date(),
      },
    });
  }

  private async checkItemStockLevel(item: InventoryItem): Promise<void> {
    const existingAlerts = await prisma.stockAlert.findMany({
      where: {
        itemId: item.id,
        resolvedAt: null,
      },
    });

    // Check for out of stock
    if (item.currentStock === 0) {
      const existingOutOfStock = existingAlerts.find(a => a.type === 'out_of_stock');
      if (!existingOutOfStock) {
        await this.createStockAlert(item, 'out_of_stock', 'critical', 'Item is out of stock');
      }
    } else {
      // Resolve out of stock alert if exists
      const outOfStockAlert = existingAlerts.find(a => a.type === 'out_of_stock');
      if (outOfStockAlert) {
        await this.resolveAlert(outOfStockAlert.id);
      }
    }

    // Check for low stock
    if (item.currentStock > 0 && item.currentStock <= item.minimumStock) {
      const existingLowStock = existingAlerts.find(a => a.type === 'low_stock');
      if (!existingLowStock) {
        await this.createStockAlert(
          item,
          'low_stock',
          'high',
          `Stock level (${item.currentStock}) is below minimum (${item.minimumStock})`
        );
      }
    } else {
      // Resolve low stock alert if exists
      const lowStockAlert = existingAlerts.find(a => a.type === 'low_stock');
      if (lowStockAlert) {
        await this.resolveAlert(lowStockAlert.id);
      }
    }

    // Check for overstock
    if (item.maximumStock && item.currentStock > item.maximumStock * this.alertThresholds.overstockMultiplier) {
      const existingOverstock = existingAlerts.find(a => a.type === 'overstock');
      if (!existingOverstock) {
        await this.createStockAlert(
          item,
          'overstock',
          'low',
          `Stock level (${item.currentStock}) exceeds maximum (${item.maximumStock})`
        );
      }
    }
  }

  private async createStockAlert(
    item: InventoryItem,
    type: StockAlert['type'],
    severity: StockAlert['severity'],
    message: string
  ): Promise<void> {
    const alert = await prisma.stockAlert.create({
      data: {
        merchantId: item.merchantId,
        type,
        severity,
        itemId: item.id,
        itemName: item.name,
        currentLevel: item.currentStock,
        threshold: type === 'low_stock' ? item.minimumStock : 
                  type === 'overstock' ? item.maximumStock : 0,
        message,
      },
    });

    // Send notification
    await notificationService.sendMerchantNotification(
      item.merchantId,
      'Inventory Alert',
      message,
      {
        type: 'inventory_alert',
        alertType: type,
        itemId: item.id,
        itemName: item.name,
      }
    );

    this.emit('inventory:alert_created', alert);
  }

  private async resolveAlert(alertId: string): Promise<void> {
    await prisma.stockAlert.update({
      where: { id: alertId },
      data: { resolvedAt: new Date() },
    });
  }

  private async updateProductAvailability(productId: string): Promise<void> {
    const productInventory = await prisma.productInventory.findMany({
      where: { productId },
      include: { inventoryItem: true },
    });

    // Check if all required ingredients are available
    const isAvailable = productInventory.every(
      mapping => mapping.inventoryItem.availableStock >= mapping.quantity
    );

    await prisma.product.update({
      where: { id: productId },
      data: { isAvailable },
    });
  }

  private generateOrderNumber(): string {
    return `PO-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }

  private async checkAllStockLevels(): Promise<void> {
    const merchants = await prisma.merchant.findMany({
      where: { isActive: true },
    });

    for (const merchant of merchants) {
      const items = await prisma.inventoryItem.findMany({
        where: { merchantId: merchant.id },
      });

      for (const item of items) {
        await this.checkItemStockLevel(item);
      }
    }
  }

  private async checkExpiringItems(): Promise<void> {
    const threeDaysFromNow = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const expiringItems = await prisma.inventoryItem.findMany({
      where: {
        expiryDate: {
          gte: new Date(),
          lte: threeDaysFromNow,
        },
      },
    });

    for (const item of expiringItems) {
      const daysUntilExpiry = Math.ceil(
        (item.expiryDate!.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      );

      await this.createStockAlert(
        item,
        'expiring_soon',
        daysUntilExpiry === 0 ? 'critical' : 'high',
        `Item expires in ${daysUntilExpiry} day(s)`
      );
    }

    // Check for already expired items
    const expiredItems = await prisma.inventoryItem.findMany({
      where: {
        expiryDate: { lt: new Date() },
        currentStock: { gt: 0 },
      },
    });

    for (const item of expiredItems) {
      await this.createStockAlert(
        item,
        'expired',
        'critical',
        'Item has expired and must be removed from inventory'
      );
    }
  }

  private async generateDailySnapshots(): Promise<void> {
    const merchants = await prisma.merchant.findMany({
      where: { isActive: true },
    });

    for (const merchant of merchants) {
      const snapshot = await this.generateInventorySnapshot(merchant.id);
      await prisma.inventorySnapshot.create({
        data: snapshot,
      });
    }
  }

  private async generateInventorySnapshot(merchantId: string): Promise<InventorySnapshot> {
    const inventory = await prisma.inventoryItem.findMany({
      where: { merchantId },
    });

    const lowStockItems = inventory.filter(i => i.currentStock <= i.minimumStock).length;
    const outOfStockItems = inventory.filter(i => i.currentStock === 0).length;
    const expiringItems = inventory.filter(i => {
      if (!i.expiryDate) return false;
      const daysUntilExpiry = (i.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      return daysUntilExpiry <= 3;
    }).length;

    const totalValue = inventory.reduce((sum, item) => sum + (item.currentStock * item.cost), 0);

    // Calculate waste value for the day
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const wasteMovements = await prisma.stockMovement.findMany({
      where: {
        inventoryItem: { merchantId },
        type: 'waste',
        performedAt: { gte: startOfDay },
      },
      include: { inventoryItem: true },
    });

    const wasteValue = wasteMovements.reduce(
      (sum, m) => sum + (m.quantity * m.inventoryItem.cost),
      0
    );

    // Simple turnover calculation (would be more complex in reality)
    const turnoverRate = 0; // Placeholder

    return {
      id: `snapshot_${Date.now()}`,
      merchantId,
      date: new Date(),
      totalItems: inventory.length,
      totalValue,
      lowStockItems,
      outOfStockItems,
      expiringItems,
      wasteValue,
      turnoverRate,
    };
  }

  private async generateAutoPurchaseOrders(): Promise<void> {
    const itemsToReorder = await prisma.inventoryItem.findMany({
      where: {
        autoReorderEnabled: true,
        currentStock: { lte: prisma.inventoryItem.fields.reorderPoint },
      },
      include: {
        lastPurchaseOrder: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    // Group by merchant and supplier
    const ordersByMerchantSupplier = new Map<string, Map<string, InventoryItem[]>>();

    for (const item of itemsToReorder) {
      // Check if recently ordered
      if (item.lastPurchaseOrder.length > 0 && item.maxOrderFrequencyDays) {
        const daysSinceLastOrder = (Date.now() - item.lastPurchaseOrder[0].createdAt.getTime()) / (24 * 60 * 60 * 1000);
        if (daysSinceLastOrder < item.maxOrderFrequencyDays) {
          continue;
        }
      }

      const merchantMap = ordersByMerchantSupplier.get(item.merchantId) || new Map();
      const supplierItems = merchantMap.get(item.preferredSupplierId || 'default') || [];
      supplierItems.push(item);
      merchantMap.set(item.preferredSupplierId || 'default', supplierItems);
      ordersByMerchantSupplier.set(item.merchantId, merchantMap);
    }

    // Create purchase orders
    for (const [merchantId, supplierMap] of ordersByMerchantSupplier) {
      for (const [supplierId, items] of supplierMap) {
        if (supplierId !== 'default') {
          await this.createPurchaseOrder(merchantId, {
            supplierId,
            items: items.map(item => ({
              inventoryItemId: item.id,
              quantity: item.reorderQuantity,
            })),
            notes: 'Auto-generated purchase order',
          });
        }
      }
    }
  }

  /**
   * Import inventory from CSV
   */
  async importInventoryFromCSV(
    merchantId: string,
    csvData: any[]
  ): Promise<{ imported: number; failed: number; errors: string[] }> {
    const results = {
      imported: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (const row of csvData) {
      try {
        await this.addInventoryItem(merchantId, {
          name: row.name,
          category: row.category || 'General',
          unit: row.unit || 'piece',
          currentStock: parseFloat(row.currentStock) || 0,
          minimumStock: parseFloat(row.minimumStock) || 0,
          maximumStock: parseFloat(row.maximumStock) || 0,
          reorderPoint: parseFloat(row.reorderPoint) || 0,
          reorderQuantity: parseFloat(row.reorderQuantity) || 0,
          cost: parseFloat(row.cost) || 0,
          productId: row.productId,
          ingredientId: row.ingredientId,
        });
        results.imported++;
      } catch (error: any) {
        results.failed++;
        results.errors.push(`Row ${results.imported + results.failed}: ${error.message}`);
      }
    }

    return results;
  }

  /**
   * Perform stock take
   */
  async performStockTake(
    merchantId: string,
    items: Array<{ itemId: string; countedQuantity: number }>
  ): Promise<{
    adjustments: number;
    discrepancies: Array<{ item: InventoryItem; expected: number; counted: number; difference: number }>;
  }> {
    const discrepancies = [];
    let adjustments = 0;

    for (const count of items) {
      const item = await prisma.inventoryItem.findUnique({
        where: { id: count.itemId },
      });

      if (!item || item.merchantId !== merchantId) {
        continue;
      }

      const difference = count.countedQuantity - item.currentStock;

      if (difference !== 0) {
        discrepancies.push({
          item,
          expected: item.currentStock,
          counted: count.countedQuantity,
          difference,
        });

        // Adjust stock
        await this.updateStock(
          item.id,
          count.countedQuantity,
          'adjustment',
          'Stock take adjustment',
          merchantId
        );

        adjustments++;
      }
    }

    // Create stock take record
    await prisma.stockTake.create({
      data: {
        merchantId,
        performedAt: new Date(),
        itemsCounted: items.length,
        adjustmentsMade: adjustments,
        discrepancies,
      },
    });

    return { adjustments, discrepancies };
  }
}

// Export singleton instance
export const inventoryManagementService = new InventoryManagementService();