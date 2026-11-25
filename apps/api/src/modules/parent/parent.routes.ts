import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { currentUser, requireRole } from '../../middleware/auth.js';
import { getChild, listChildren, listMessages } from './parent.service.js';

export const parentRouter = Router();
parentRouter.use(requireRole('PARENT'));

parentRouter.get('/children', async (req, res) => {
  res.json({ children: await listChildren(currentUser(req).id) });
});

parentRouter.get('/children/:id', async (req, res) => {
  // Un identifiant mal formé reçoit la même réponse qu'un élève d'autrui : 404.
  const parsed = z.uuid().safeParse(req.params.id);
  if (!parsed.success) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Élève introuvable.' } });
    return;
  }
  try {
    const data = await getChild(currentUser(req).id, parsed.data);
    await audit(req, 'parent.view_child', 'Student', parsed.data);
    res.json(data);
  } catch (err) {
    await audit(req, 'parent.view_child_denied', 'Student', parsed.data);
    throw err;
  }
});

parentRouter.get('/messages', async (req, res) => {
  res.json({ messages: await listMessages(currentUser(req).id) });
});
