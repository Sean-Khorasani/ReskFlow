/**
 * API Routes Configuration
 * Aggregates all route handlers for the gateway
 */

import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/auth';
// import { rateLimiter } from '../middleware/rate-limiter';
// import { validationMiddleware } from '../middleware/validation';
import { proxyMiddleware } from '../middleware/proxy';
import { config } from '../config';

// Customer Routes
import { groupOrderRoutes } from './customer/group-order.routes';
import { scheduledOrderRoutes } from './customer/scheduled-order.routes';
import { favoritesRoutes } from './customer/favorites.routes';
import { splitPaymentRoutes } from './customer/split-payment.routes';
import { dietaryRoutes } from './customer/dietary.routes';

// Driver Routes
import { earningsRoutes } from './driver/earnings.routes';
import { routeOptimizationRoutes } from './driver/route-optimization.routes';
import { shiftRoutes } from './driver/shift.routes';
import { vehicleInspectionRoutes } from './driver/vehicle-inspection.routes';
import { emergencyRoutes } from './driver/emergency.routes';

// Merchant Routes  
import { inventoryRoutes } from './merchant/inventory.routes';
import { campaignsRoutes } from './merchant/campaigns.routes';
import { menuSchedulingRoutes } from './merchant/menu-scheduling.routes';
import { ingredientTrackingRoutes } from './merchant/ingredient-tracking.routes';
import { multiLocationRoutes } from './merchant/multi-location.routes';

// Admin Routes
import { fraudDetectionRoutes } from './admin/fraud-detection.routes';
import { reportingRoutes } from './admin/reporting.routes';
import { disputeRoutes } from './admin/dispute.routes';
import { platformHealthRoutes } from './admin/platform-health.routes';
import { dynamicPricingRoutes } from './admin/dynamic-pricing.routes';

// Core Routes
import { authRoutes } from './core/auth.routes';
import { userRoutes } from './core/user.routes';
import { orderRoutes } from './core/order.routes';
import { reskflowRoutes } from './core/reskflow.routes';
import { paymentRoutes } from './core/payment.routes';
import { merchantRoutes } from './core/merchant.routes';
import { notificationRoutes } from './core/notification.routes';
import { analyticsRoutes } from './core/analytics.routes';
import { searchRoutes } from './core/search.routes';

export function setupRoutes(app: Router) {
  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      services: Object.keys(config.services).map(service => ({
        name: service,
        url: config.services[service]
      }))
    });
  });

  // Core routes (public)
  app.use('/api/auth', authRoutes);
  app.use('/api/search', searchRoutes);

  // Protected routes - require authentication
  app.use(authMiddleware);

  // Core routes (protected)
  app.use('/api/users', userRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/deliveries', reskflowRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/merchants', merchantRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/analytics', analyticsRoutes);

  // Customer routes
  app.use('/api/customer/group-orders', groupOrderRoutes);
  app.use('/api/customer/scheduled-orders', scheduledOrderRoutes);
  app.use('/api/customer/favorites', favoritesRoutes);
  app.use('/api/customer/split-payments', splitPaymentRoutes);
  app.use('/api/customer/dietary', dietaryRoutes);

  // Driver routes
  app.use('/api/driver/earnings', earningsRoutes);
  app.use('/api/driver/routes', routeOptimizationRoutes);
  app.use('/api/driver/shifts', shiftRoutes);
  app.use('/api/driver/inspections', vehicleInspectionRoutes);
  app.use('/api/driver/emergency', emergencyRoutes);

  // Merchant routes
  app.use('/api/merchant/inventory', inventoryRoutes);
  app.use('/api/merchant/campaigns', campaignsRoutes);
  app.use('/api/merchant/menu-scheduling', menuSchedulingRoutes);
  app.use('/api/merchant/ingredients', ingredientTrackingRoutes);
  app.use('/api/merchant/locations', multiLocationRoutes);

  // Admin routes - require admin role
  app.use('/api/admin/fraud', fraudDetectionRoutes);
  app.use('/api/admin/reports', reportingRoutes);
  app.use('/api/admin/disputes', disputeRoutes);
  app.use('/api/admin/health', platformHealthRoutes);
  app.use('/api/admin/pricing', dynamicPricingRoutes);

  // Generic proxy for other services
  app.use('/api/:service/*', proxyMiddleware);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not Found',
      message: 'The requested resource does not exist',
      path: req.originalUrl
    });
  });

  // Error handler
  app.use((err: Error & { status?: number; statusCode?: number }, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';

    logger.error('Request error', {
      error: err,
      request: {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body
      }
    });

    res.status(status).json({
      error: message,
      status,
      timestamp: new Date().toISOString(),
      requestId: (req as any).id
    });
  });
}

// Middleware imports
import { logger } from '../utils/logger';