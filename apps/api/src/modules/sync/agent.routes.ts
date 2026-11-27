import { syncBatchSchema } from '@passage/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { currentUser, requireRole, staffEstablishment } from '../../middleware/auth.js';
import { ingestBatch } from './sync.service.js';

export const agentRouter = Router();
agentRouter.use(requireRole('AGENT', 'MANAGER'));

/**
 * Points de contrôle, mis en cache par la PWA pour scanner hors ligne, avec la plage
 * horaire de l'itinéraire de l'établissement (affichée à l'agent avec un compte à
 * rebours). L'heure du serveur permet au téléphone de corriger sa propre horloge.
 * Aucune donnée d'élève ni d'anomalie : l'agent n'y a pas droit.
 */
agentRouter.get('/checkpoints', async (req, res) => {
  const establishmentId = staffEstablishment(req);
  const [establishment, checkpoints] = await Promise.all([
    prisma.establishment.findUniqueOrThrow({
      where: { id: establishmentId },
      select: { timezone: true },
    }),
    prisma.checkpoint.findMany({
      where: { establishmentId },
      orderBy: { label: 'asc' },
      select: {
        id: true,
        label: true,
        type: true,
        // Au plus une étape par point (contrainte unique établissement + point).
        establishmentRouteSteps: { select: { startMinute: true, endMinute: true, days: true } },
      },
    }),
  ]);
  res.json({
    serverTime: Date.now(),
    timezone: establishment.timezone,
    checkpoints: checkpoints.map(({ establishmentRouteSteps, ...c }) => ({
      ...c,
      window: establishmentRouteSteps[0] ?? null,
    })),
  });
});

agentRouter.post('/sync', async (req, res) => {
  const batch = syncBatchSchema.parse(req.body);
  const user = currentUser(req);
  const result = await ingestBatch(
    { id: user.id, establishmentId: staffEstablishment(req) },
    batch,
  );
  res.json(result);
});
