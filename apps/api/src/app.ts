import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { employeeRoutes } from './routes/employees.routes.js';
import { analyticsRoutes } from './routes/analytics.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { prisma } from './lib/prisma.js';

/**
 * Build the Express app.
 *
 * Separated from server.ts so integration tests can mount the app with supertest
 * without binding a port.
 */
export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:3000',
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  // ---------------------------------------------------------------------------
  // AUTH SEAM
  //
  // A single `app.use(requireAuth)` belongs here. Every service already accepts an
  // `actor` argument for audit fields, so wiring real auth means implementing the
  // middleware and changing `actorFrom` in employees.routes.ts - nothing else.
  // Deliberately out of scope; see docs/REQUIREMENTS.md §4.
  // ---------------------------------------------------------------------------

  /** Liveness plus a real database round-trip, so the check means something. */
  app.get('/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });

  app.use('/api/employees', employeeRoutes);
  app.use('/api/analytics', analyticsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
