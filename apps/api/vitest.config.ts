import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load .env.test before anything imports PrismaClient, so tests can never point at
// the development database and truncate the seeded 10,000 employees.
config({ path: '.env.test' });

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Integration tests truncate shared tables, so files must not run concurrently.
    // A single fork keeps that safe without per-test transaction wrapping.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
  },
});
