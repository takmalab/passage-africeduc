import { defineConfig } from 'vitest/config';

// Deux projets : unitaires (sans base) et intégration (vraie base PostgreSQL).
const testEnv = {
  NODE_ENV: 'test',
  BADGE_KEYS_MASTER_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  SCHEDULER_ENABLED: 'false',
  CARD_SIMULATOR_ENABLED: 'true',
  MISTRAL_API_KEY: '',
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
          env: testEnv,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
