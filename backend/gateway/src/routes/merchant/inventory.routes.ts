/**
 * Merchant Inventory Routes
 */

import { Router } from 'express';
import { body, param, query } from 'express-validator';
import { validationMiddleware, paginationValidation } from '../../middleware/validation';
import { authMiddleware, checkPermission } from '../../middleware/auth';
import { proxyRequest } from '../../utils/proxy';
import { config } from '../../config';

const router = Router();

// Get inventory items
router.get('/',
  authMiddleware,
  checkPermission('inventory', 'read'),
  paginationValidation,
  query('merchantId').isUUID(),
  query('category').optional().isString(),
  query('status').optional().isIn(['in_stock', 'low_stock', 'out_of_stock']),
  query('search').optional().isString(),
  query('sortBy').optional().isIn(['name', 'quantity', 'updatedAt']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.inventory.url}/inventory`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get inventory item details
router.get('/:id',
  authMiddleware,
  checkPermission('inventory', 'read'),
  param('id').isUUID(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.inventory.url}/inventory/${req.params.id}`,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create inventory item
router.post('/',
  authMiddleware,
  checkPermission('inventory', 'create'),
  body('merchantId').isUUID(),
  body('name').notEmpty().trim(),
  body('sku').notEmpty().trim(),
  body('category').notEmpty(),
  body('unit').isIn(['piece', 'kg', 'g', 'l', 'ml', 'dozen', 'box', 'case']),
  body('quantity').isFloat({ min: 0 }),
  body('minQuantity').optional().isFloat({ min: 0 }),
  body('maxQuantity').optional().isFloat({ min: 0 }),
  body('reorderPoint').optional().isFloat({ min: 0 }),
  body('reorderQuantity').optional().isFloat({ min: 0 }),
  body('cost').optional().isFloat({ min: 0 }),
  body('suppliers').optional().isArray(),
  body('expirationDate').optional().isISO8601(),
  body('storageLocation').optional().isString(),
  body('isPerishable').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.inventory.url}/inventory`,
        body: {
          ...req.body,
          createdBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update inventory item
router.put('/:id',
  authMiddleware,
  checkPermission('inventory', 'update'),
  param('id').isUUID(),
  body('name').optional().trim(),
  body('category').optional(),
  body('minQuantity').optional().isFloat({ min: 0 }),
  body('maxQuantity').optional().isFloat({ min: 0 }),
  body('reorderPoint').optional().isFloat({ min: 0 }),
  body('reorderQuantity').optional().isFloat({ min: 0 }),
  body('cost').optional().isFloat({ min: 0 }),
  body('isActive').optional().isBoolean(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.inventory.url}/inventory/${req.params.id}`,
        body: {
          ...req.body,
          updatedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Update inventory quantity
router.post('/:id/adjust',
  authMiddleware,
  checkPermission('inventory', 'update'),
  param('id').isUUID(),
  body('adjustment').isFloat(),
  body('reason').isIn(['received', 'sold', 'damaged', 'expired', 'theft', 'correction', 'return']),
  body('notes').optional().isString(),
  body('reference').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.inventory.url}/inventory/${req.params.id}/adjust`,
        body: {
          ...req.body,
          adjustedBy: req.user!.id,
          timestamp: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Bulk update inventory
router.post('/bulk-adjust',
  authMiddleware,
  checkPermission('inventory', 'update'),
  body('adjustments').isArray(),
  body('adjustments.*.inventoryId').isUUID(),
  body('adjustments.*.adjustment').isFloat(),
  body('reason').isIn(['received', 'sold', 'damaged', 'expired', 'theft', 'correction']),
  body('reference').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.inventory.url}/inventory/bulk-adjust`,
        body: {
          ...req.body,
          adjustedBy: req.user!.id,
          timestamp: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get inventory history
router.get('/:id/history',
  authMiddleware,
  checkPermission('inventory', 'read'),
  param('id').isUUID(),
  paginationValidation,
  query('startDate').optional().isISO8601(),
  query('endDate').optional().isISO8601(),
  query('reason').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.inventory.url}/inventory/${req.params.id}/history`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get low stock items
router.get('/alerts/low-stock',
  authMiddleware,
  checkPermission('inventory', 'read'),
  query('merchantId').isUUID(),
  query('threshold').optional().isFloat({ min: 0, max: 1 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.inventory.url}/inventory/alerts/low-stock`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get expiring items
router.get('/alerts/expiring',
  authMiddleware,
  checkPermission('inventory', 'read'),
  query('merchantId').isUUID(),
  query('days').optional().isInt({ min: 1, max: 90 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.inventory.url}/inventory/alerts/expiring`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Create purchase order
router.post('/purchase-orders',
  authMiddleware,
  checkPermission('inventory', 'create'),
  body('merchantId').isUUID(),
  body('supplierId').isUUID(),
  body('items').isArray(),
  body('items.*.inventoryId').isUUID(),
  body('items.*.quantity').isFloat({ min: 0 }),
  body('items.*.unitCost').isFloat({ min: 0 }),
  body('expectedDelivery').optional().isISO8601(),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.inventory.url}/inventory/purchase-orders`,
        body: {
          ...req.body,
          createdBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Receive purchase order
router.post('/purchase-orders/:orderId/receive',
  authMiddleware,
  checkPermission('inventory', 'update'),
  param('orderId').isUUID(),
  body('items').isArray(),
  body('items.*.inventoryId').isUUID(),
  body('items.*.receivedQuantity').isFloat({ min: 0 }),
  body('items.*.condition').optional().isIn(['good', 'damaged', 'expired']),
  body('notes').optional().isString(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.inventory.url}/inventory/purchase-orders/${req.params.orderId}/receive`,
        body: {
          ...req.body,
          receivedBy: req.user!.id,
          receivedAt: new Date()
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get inventory valuation
router.get('/valuation',
  authMiddleware,
  checkPermission('inventory', 'read'),
  query('merchantId').isUUID(),
  query('method').optional().isIn(['fifo', 'lifo', 'average']),
  query('asOf').optional().isISO8601(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'GET',
        url: `${config.services.inventory.url}/inventory/valuation`,
        query: req.query,
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Generate inventory report
router.post('/report',
  authMiddleware,
  checkPermission('inventory', 'read'),
  body('merchantId').isUUID(),
  body('type').isIn(['summary', 'detailed', 'movement', 'valuation']),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('format').isIn(['pdf', 'excel', 'csv']),
  body('groupBy').optional().isIn(['category', 'supplier', 'location']),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.inventory.url}/inventory/report`,
        body: {
          ...req.body,
          requestedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Set inventory alerts
router.put('/alerts/settings',
  authMiddleware,
  checkPermission('inventory', 'update'),
  body('merchantId').isUUID(),
  body('lowStockThreshold').optional().isFloat({ min: 0, max: 1 }),
  body('expirationWarningDays').optional().isInt({ min: 1, max: 90 }),
  body('enableAutoReorder').optional().isBoolean(),
  body('notificationChannels').optional().isArray(),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'PUT',
        url: `${config.services.inventory.url}/inventory/alerts/settings`,
        body: {
          ...req.body,
          updatedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Sync inventory with menu
router.post('/sync-menu',
  authMiddleware,
  checkPermission('inventory', 'update'),
  body('merchantId').isUUID(),
  body('mappings').isArray(),
  body('mappings.*.menuItemId').isUUID(),
  body('mappings.*.ingredients').isArray(),
  body('mappings.*.ingredients.*.inventoryId').isUUID(),
  body('mappings.*.ingredients.*.quantity').isFloat({ min: 0 }),
  validationMiddleware,
  async (req, res, next) => {
    try {
      const result = await proxyRequest({
        method: 'POST',
        url: `${config.services.inventory.url}/inventory/sync-menu`,
        body: {
          ...req.body,
          syncedBy: req.user!.id
        },
        headers: req.headers
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

export const inventoryRoutes = router;