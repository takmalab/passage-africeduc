import { localParts } from '@passage/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { audit } from '../../lib/audit.js';
import { currentUser, requireRole, staffEstablishment } from '../../middleware/auth.js';
import {
  activateNfcBadge,
  changeBadgeStatus,
  createSimulatedCard,
  issueBadge,
  tapSimulatedCard,
} from '../badges/badges.service.js';
import { generateSummary, spentTodayUsd } from '../summary/summary.service.js';
import * as svc from './manager.service.js';

const uuid = z.uuid();
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue : AAAA-MM-JJ');
const name = z.string().trim().min(1).max(80);

async function todayKey(establishmentId: string): Promise<string> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId } });
  return localParts(new Date(), est.timezone).dateKey;
}

const dateParam = async (req: Request, est: string) =>
  req.query.date ? dateKey.parse(req.query.date) : todayKey(est);

export const managerRouter = Router();
managerRouter.use(requireRole('MANAGER'));

managerRouter.get('/establishment', async (req, res) => {
  const est = await prisma.establishment.findUniqueOrThrow({
    where: { id: staffEstablishment(req) },
    select: { id: true, name: true, timezone: true, allowPrintedBadges: true },
  });
  res.json({
    establishment: est,
    today: localParts(new Date(), est.timezone).dateKey,
    simulator: env.CARD_SIMULATOR_ENABLED,
  });
});

managerRouter.patch('/establishment', async (req, res) => {
  const body = z.object({ allowPrintedBadges: z.boolean() }).strict().parse(req.body);
  const est = staffEstablishment(req);
  await prisma.establishment.update({ where: { id: est }, data: body });
  await audit(req, 'establishment.update', 'Establishment', est, body);
  res.status(204).end();
});

managerRouter.get('/classrooms', async (req, res) => {
  res.json({ classrooms: await svc.listClassrooms(staffEstablishment(req)) });
});

managerRouter.post('/classrooms', async (req, res) => {
  // .strict() : tout champ en trop (ex. establishmentId) est refusé ; l'établissement
  // vient toujours de la session du responsable.
  const body = z.object({ name }).strict().parse(req.body);
  const classroom = await svc.createClassroom(staffEstablishment(req), body.name);
  await audit(req, 'classroom.create', 'Classroom', classroom.id);
  res.status(201).json({ classroom });
});

managerRouter.get('/students', async (req, res) => {
  res.json({ students: await svc.listStudents(staffEstablishment(req)) });
});

managerRouter.post('/students', async (req, res) => {
  const body = z
    .object({ firstName: name, lastName: name, classroomId: uuid })
    .strict()
    .parse(req.body);
  const student = await svc.createStudent(staffEstablishment(req), body);
  await audit(req, 'student.create', 'Student', student.id);
  res.status(201).json({ student });
});

managerRouter.get('/students/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const student = await svc.getStudentDetail(staffEstablishment(req), id);
  await audit(req, 'student.view', 'Student', id);
  res.json({ student });
});

managerRouter.put('/students/:id/route', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z
    .object({
      name,
      steps: z
        .array(
          z.object({
            checkpointId: uuid,
            start: z.string(),
            end: z.string(),
            days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
          }),
        )
        .min(1)
        .max(10),
    })
    .strict()
    .parse(req.body);
  const result = await svc.replaceRoute(staffEstablishment(req), id, body.name, body.steps);
  await audit(req, 'route.replace', 'Student', id);
  res.json(result);
});

// --- Badges -----------------------------------------------------------------

managerRouter.post('/students/:id/badges', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z
    .object({
      kind: z.enum(['NFC', 'PRINTED']),
      replaceReason: z.enum(['LOST', 'REVOKED']).optional(),
    })
    .strict()
    .parse(req.body);
  const result = await issueBadge(staffEstablishment(req), id, body.kind, body.replaceReason);
  await audit(req, 'badge.issue', 'Badge', result.badge.id, {
    kind: body.kind,
    replace: body.replaceReason ?? null,
  });
  // Le secret imprimé et les clés de programmation ne sont jamais réaffichés.
  res.set('Cache-Control', 'no-store').status(201).json(result);
});

managerRouter.post('/badges/:id/activate', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z
    .object({ rawCode: z.string().min(1).max(300) })
    .strict()
    .parse(req.body);
  const badge = await activateNfcBadge(staffEstablishment(req), id, body.rawCode);
  await audit(req, 'badge.activate', 'Badge', id);
  res.json({ badge });
});

managerRouter.patch('/badges/:id/status', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z
    .object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'LOST', 'REVOKED']) })
    .strict()
    .parse(req.body);
  const badge = await changeBadgeStatus(staffEstablishment(req), id, body.status);
  await audit(req, 'badge.status', 'Badge', id, { status: body.status });
  res.json({ badge });
});

managerRouter.post('/badges/:id/simulator', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const badge = await createSimulatedCard(staffEstablishment(req), id);
  await audit(req, 'badge.simulator_create', 'Badge', id);
  res.status(201).json({ badge });
});

managerRouter.post('/badges/:id/simulator/tap', async (req, res) => {
  const id = uuid.parse(req.params.id);
  res.set('Cache-Control', 'no-store').json(await tapSimulatedCard(staffEstablishment(req), id));
});

// --- Points de contrôle, exceptions -------------------------------------------

managerRouter.get('/checkpoints', async (req, res) => {
  res.json({ checkpoints: await svc.listCheckpoints(staffEstablishment(req)) });
});

managerRouter.post('/checkpoints', async (req, res) => {
  const body = z
    .object({ label: name, type: z.enum(['GATE', 'BUS']) })
    .strict()
    .parse(req.body);
  const checkpoint = await svc.createCheckpoint(staffEstablishment(req), body);
  await audit(req, 'checkpoint.create', 'Checkpoint', checkpoint.id);
  res.status(201).json({ checkpoint });
});

managerRouter.get('/exceptions', async (req, res) => {
  const est = staffEstablishment(req);
  res.json({ exceptions: await svc.listExceptions(est, await dateParam(req, est)) });
});

managerRouter.post('/exceptions', async (req, res) => {
  const body = z
    .object({
      dateKey,
      type: z.enum(['HOLIDAY', 'JUSTIFIED_ABSENCE', 'EARLY_EXIT_AUTHORIZED']),
      studentId: uuid.nullish(),
      reason: z.string().trim().max(200).nullish(),
    })
    .strict()
    .parse(req.body);
  const created = await svc.createException(staffEstablishment(req), currentUser(req).id, body);
  await audit(req, 'exception.create', 'DayException', created.id);
  res.status(201).json(created);
});

managerRouter.delete('/exceptions/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  await svc.deleteException(staffEstablishment(req), id);
  await audit(req, 'exception.delete', 'DayException', id);
  res.status(204).end();
});

// --- Suivi du jour ----------------------------------------------------------------

managerRouter.get('/passages', async (req, res) => {
  const est = staffEstablishment(req);
  res.json({ passages: await svc.listPassages(est, await dateParam(req, est)) });
});

managerRouter.get('/anomalies', async (req, res) => {
  const est = staffEstablishment(req);
  res.json({ anomalies: await svc.listAnomalies(est, await dateParam(req, est)) });
});

managerRouter.patch('/anomalies/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const body = z
    .object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']) })
    .strict()
    .parse(req.body);
  await svc.updateAnomalyStatus(staffEstablishment(req), id, body.status);
  await audit(req, 'anomaly.status', 'Anomaly', id, body);
  res.status(204).end();
});

managerRouter.get('/messages', async (req, res) => {
  const est = staffEstablishment(req);
  res.json({ messages: await svc.listMessages(est, await dateParam(req, est)) });
});

// --- Synthèse IA ------------------------------------------------------------------

managerRouter.post('/summaries', async (req, res) => {
  const body = z.object({ classroomId: uuid, dateKey }).strict().parse(req.body);
  const summary = await generateSummary(
    staffEstablishment(req),
    body.classroomId,
    body.dateKey,
    currentUser(req).id,
  );
  await audit(req, 'summary.generate', 'Classroom', body.classroomId, {
    date: body.dateKey,
    origin: summary.origin,
  });
  res.json({ summary });
});

managerRouter.get('/ai/usage', async (_req, res) => {
  const calls = await prisma.aiCall.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({
    budgetUsd: env.AI_DAILY_BUDGET_USD,
    spentTodayUsd: await spentTodayUsd(),
    model: env.MISTRAL_MODEL,
    keyConfigured: Boolean(env.MISTRAL_API_KEY),
    calls: calls.map((c) => ({ ...c, estimatedCostUsd: Number(c.estimatedCostUsd) })),
  });
});
