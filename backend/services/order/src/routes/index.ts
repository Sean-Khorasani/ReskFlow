import { Express } from 'express';
import orderRoutes from './order.routes';
import invoiceRoutes from './invoice.routes';
import statisticsRoutes from './statistics.routes';

export function setupRoutes(app: Express) {
  app.use('/api/v1/orders', orderRoutes);
  app.use('/api/v1/invoices', invoiceRoutes);
  app.use('/api/v1/statistics', statisticsRoutes);
}