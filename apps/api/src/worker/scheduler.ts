import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { logger } from '../lib/logger.js';
import { detectMissedCheckpoints } from '../modules/anomalies/anomalies.service.js';
import { dispatchPending } from '../modules/notifications/notifications.service.js';

/** Identifiant arbitraire du verrou PostgreSQL du programme de fond. */
const SCHEDULER_LOCK_ID = 4_242_001;

/**
 * Un tour du programme de fond :
 * 1. détecter les passages manquants des fenêtres closes ;
 * 2. envoyer les messages en attente ;
 * 3. supprimer les sessions expirées.
 *
 * Un verrou consultatif PostgreSQL garantit qu'un seul processus fait le
 * travail, même si plusieurs instances de l'API tournent. Chaque étape est de
 * toute façon idempotente (clés uniques).
 */
export async function runSchedulerTick(now = new Date()): Promise<{ ran: boolean }> {
  const [row] = await prisma.$queryRaw<{ locked: boolean }[]>`
    SELECT pg_try_advisory_lock(${SCHEDULER_LOCK_ID}) AS locked`;
  if (!row?.locked) return { ran: false };
  try {
    await detectMissedCheckpoints(now);
    await dispatchPending();
    const sessionCutoff = new Date(now.getTime() - env.SESSION_IDLE_MINUTES * 60_000);
    await prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { lastSeenAt: { lt: sessionCutoff } }] },
    });
    return { ran: true };
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${SCHEDULER_LOCK_ID})`;
  }
}

export function startScheduler(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSchedulerTick();
    } catch (err) {
      logger.error({ err }, 'Échec du programme de fond');
    } finally {
      running = false;
    }
  };
  // Premier passage immédiat : rattrape les fenêtres closes pendant un arrêt du serveur.
  void tick();
  const timer = setInterval(tick, env.SCHEDULER_INTERVAL_SECONDS * 1000);
  logger.info({ everySeconds: env.SCHEDULER_INTERVAL_SECONDS }, 'Programme de fond démarré');
  return () => clearInterval(timer);
}
