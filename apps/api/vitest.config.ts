import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });

/** Base dédiée aux tests : elle est vidée et recréée à chaque exécution. */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://passage:passage@localhost:5432/passage_test';
process.env.TEST_DATABASE_URL = TEST_DATABASE_URL;

// Deux projets : unitaires (sans base) et intégration (vraie base PostgreSQL).
const testEnv = {
  NODE_ENV: 'test',
  BADGE_KEYS_MASTER_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  SCHEDULER_ENABLED: 'false',
  CARD_SIMULATOR_ENABLED: 'true',
  AI_API_KEY: '',
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          env: { ...testEnv, DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused' },
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/integration/global-setup.ts'],
          setupFiles: ['test/integration/setup.ts'],
          // Une seule base partagée : les fichiers s'exécutent l'un après l'autre.
          fileParallelism: false,
          env: { ...testEnv, DATABASE_URL: TEST_DATABASE_URL },
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
