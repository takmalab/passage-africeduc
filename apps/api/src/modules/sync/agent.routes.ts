import { syncBatchSchema } from '@passage/shared';
import { Router } from 'express';
import { prisma } from '../../db/prisma.js';
import { currentUser, requireRole, staffEstablishment } from '../../middleware/auth.js';
import { ingestBatch } from './sync.service.js';

export const agentRouter = Router();
agentRouter.use(requireRole('AGENT', 'MANAGER'));

/** Points de contrôle, mis en cache par la PWA pour scanner hors ligne. */
agentRouter.get('/checkpoints', async (req, res) => {
  const checkpoints = await prisma.checkpoint.findMany({
    where: { establishmentId: staffEstablishment(req) },
    orderBy: { label: 'asc' },
    select: { id: true, label: true, type: true },
  });
  res.json({ checkpoints });
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
