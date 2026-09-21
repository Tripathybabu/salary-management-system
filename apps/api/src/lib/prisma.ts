import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client.
 *
 * In dev, `tsx watch` re-imports modules on every change; without caching on
 * globalThis each reload would open a new connection pool until Postgres refuses
 * connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
