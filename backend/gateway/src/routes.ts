/**
 * Setup Routes
 */

import { Express } from 'express';
import routes from './routes/index';

export function setupRoutes(app: Express): void {
  // API routes
  app.use('/api/v1', routes);
}