import { prisma } from './db/prisma.js';
import { logger } from './lib/logger.js';
import { startScheduler } from './worker/scheduler.js';

/** Processus séparé pour le programme de fond (optionnel, voir server.ts). */
const stop = startScheduler();
logger.info('Processus du programme de fond démarré');

async function shutdown() {
  stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
