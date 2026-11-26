import { addDaysToDateKey, formatMinute, parseMinute } from '@passage/shared';
import {
  prisma,
  Prisma,
  type AnomalyStatus,
  type CheckpointType,
  type ExceptionType,
} from '../../db/prisma.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { dateFromKey } from '../anomalies/anomalies.service.js';

/**
 * Requêtes de l'espace responsable. Chaque requête est bornée à l'établissement
 * du responsable connecté (paramètre `establishmentId`, jamais lu dans l'URL).
 */

export async function listClassrooms(establishmentId: string) {
  return prisma.classroom.findMany({
    where: { establishmentId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { students: true } } },
  });
}

export async function listStudents(establishmentId: string) {
  const students = await prisma.student.findMany({
    where: { establishmentId },
    orderBy: [{ classroom: { name: 'asc' } }, { lastName: 'asc' }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      classroom: { select: { id: true, name: true } },
      badges: {
        where: { status: { in: ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED'] } },
        select: {
          id: true,
          kind: true,
          status: true,
          simulatedCard: { select: { badgeId: true } },
        },
      },
    },
  });
  return students.map(({ badges, ...s }) => {
    const b = badges[0];
    return {
      ...s,
      badge: b
        ? { id: b.id, kind: b.kind, status: b.status, simulated: Boolean(b.simulatedCard) }
        : null,
    };
  });
}

export async function getStudentDetail(establishmentId: string, studentId: string) {
  const student = await prisma.student.findFirst({
    where: { id: studentId, establishmentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      status: true,
      classroom: { select: { id: true, name: true } },
      parents: { select: { parent: { select: { id: true, name: true } } } },
      badges: {
        orderBy: { issuedAt: 'desc' },
        select: {
          id: true,
          kind: true,
          status: true,
          issuedAt: true,
          activatedAt: true,
          replacesBadgeId: true,
          simulatedCard: { select: { counter: true } },
        },
      },
      route: {
        select: {
          name: true,
          steps: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              startMinute: true,
              endMinute: true,
              days: true,
              checkpoint: { select: { id: true, label: true, type: true } },
            },
          },
        },
      },
    },
  });
  if (!student) throw notFound('Élève introuvable.');
  return {
    ...student,
    parents: student.parents.map((p) => p.parent),
    route: student.route && {
      name: student.route.name,
      steps: student.route.steps.map((s) => ({
        ...s,
        start: formatMinute(s.startMinute),
        end: formatMinute(s.endMinute),
      })),
    },
  };
}

export async function createStudent(
  establishmentId: string,
  input: { firstName: string; lastName: string; classroomId: string },
) {
  const classroom = await prisma.classroom.findFirst({
    where: { id: input.classroomId, establishmentId },
  });
  if (!classroom) throw badRequest('Classe inconnue.');
  return prisma.student.create({
    data: { ...input, establishmentId },
    select: { id: true, firstName: true, lastName: true },
  });
}

export async function listCheckpoints(establishmentId: string) {
  return prisma.checkpoint.findMany({
    where: { establishmentId },
    orderBy: { label: 'asc' },
    select: { id: true, label: true, type: true },
  });
}

/**
 * Vrai si PostgreSQL a refusé l'écriture à cause d'une contrainte d'unicité
 * (code Prisma P2002). On laisse la base trancher plutôt que de vérifier avant :
 * deux requêtes simultanées ne peuvent pas créer de doublon.
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function createCheckpoint(
  establishmentId: string,
  input: { label: string; type: CheckpointType },
) {
  try {
    return await prisma.checkpoint.create({
      data: { ...input, establishmentId },
      select: { id: true, label: true, type: true },
    });
  } catch (err) {
    // Contrainte @@unique([establishmentId, label]) : nom déjà pris dans CET établissement.
    if (isUniqueViolation(err)) throw conflict('Un point de contrôle porte déjà ce nom.');
    throw err;
  }
}

export type StepInput = {
  checkpointId: string;
  start: string;
  end: string;
  days: number[];
};

/** Remplace l'itinéraire d'un élève (transaction : tout ou rien). */
export async function replaceRoute(
  establishmentId: string,
  studentId: string,
  name: string,
  steps: StepInput[],
) {
  const student = await prisma.student.findFirst({ where: { id: studentId, establishmentId } });
  if (!student) throw notFound('Élève introuvable.');
  const checkpointIds = new Set(
    (await prisma.checkpoint.findMany({ where: { establishmentId }, select: { id: true } })).map(
      (c) => c.id,
    ),
  );
  const parsed = steps.map((s, i) => {
    const startMinute = parseMinute(s.start);
    const endMinute = parseMinute(s.end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      throw badRequest(`Étape ${i + 1} : fenêtre horaire invalide.`);
    }
    if (!checkpointIds.has(s.checkpointId)) throw badRequest(`Étape ${i + 1} : point inconnu.`);
    return {
      checkpointId: s.checkpointId,
      position: i + 1,
      startMinute,
      endMinute,
      days: [...new Set(s.days)].sort(),
    };
  });

  return prisma.$transaction(async (tx) => {
    const route = await tx.route.upsert({
      where: { studentId },
      create: { studentId, name },
      update: { name },
    });
    await tx.routeStep.deleteMany({ where: { routeId: route.id } });
    await tx.routeStep.createMany({ data: parsed.map((p) => ({ ...p, routeId: route.id })) });
    return { id: route.id, steps: parsed.length };
  });
}

export async function listExceptions(establishmentId: string, fromKey: string) {
  return prisma.dayException.findMany({
    where: { establishmentId, date: { gte: dateFromKey(fromKey) } },
    orderBy: { date: 'asc' },
    select: {
      id: true,
      date: true,
      type: true,
      reason: true,
      student: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function createException(
  establishmentId: string,
  createdById: string,
  input: {
    dateKey: string;
    type: ExceptionType;
    studentId?: string | null;
    reason?: string | null;
  },
) {
  if (input.type === 'HOLIDAY' && input.studentId) {
    throw badRequest('Un jour férié concerne tout l’établissement.');
  }
  if (input.type !== 'HOLIDAY') {
    if (!input.studentId) throw badRequest('Choisissez un élève.');
    const student = await prisma.student.findFirst({
      where: { id: input.studentId, establishmentId },
    });
    if (!student) throw badRequest('Élève inconnu.');
  }
  return prisma.dayException.create({
    data: {
      establishmentId,
      createdById,
      date: dateFromKey(input.dateKey),
      type: input.type,
      studentId: input.type === 'HOLIDAY' ? null : input.studentId!,
      reason: input.reason ?? null,
    },
    select: { id: true },
  });
}

export async function deleteException(establishmentId: string, id: string) {
  const res = await prisma.dayException.deleteMany({ where: { id, establishmentId } });
  if (res.count === 0) throw notFound();
}

export async function listPassages(establishmentId: string, dateKey: string) {
  // Journée locale élargie (± 1 jour) : le filtrage fin se fait à l'affichage.
  return prisma.passage.findMany({
    where: {
      checkpoint: { establishmentId },
      effectiveTime: {
        gte: new Date(`${addDaysToDateKey(dateKey, -1)}T12:00:00Z`),
        lt: new Date(`${addDaysToDateKey(dateKey, 1)}T12:00:00Z`),
      },
    },
    orderBy: { effectiveTime: 'desc' },
    take: 500,
    select: {
      id: true,
      effectiveTime: true,
      deviceLocalTime: true,
      serverReceivedAt: true,
      clockOffsetMs: true,
      clockStatus: true,
      verdict: true,
      refusalReason: true,
      codeCounter: true,
      checkpoint: { select: { label: true } },
      student: { select: { id: true, firstName: true, lastName: true } },
      badge: { select: { kind: true } },
    },
  });
}

export async function listAnomalies(establishmentId: string, dateKey: string) {
  return prisma.anomaly.findMany({
    where: { establishmentId, date: dateFromKey(dateKey) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      status: true,
      details: true,
      createdAt: true,
      resolutionNote: true,
      student: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { messages: true } },
    },
  });
}

export async function updateAnomalyStatus(
  establishmentId: string,
  id: string,
  status: Extract<AnomalyStatus, 'ACKNOWLEDGED' | 'RESOLVED'>,
) {
  const res = await prisma.anomaly.updateMany({
    where: { id, establishmentId },
    data: { status, resolvedAt: status === 'RESOLVED' ? new Date() : null },
  });
  if (res.count === 0) throw notFound();
}

export async function listMessages(establishmentId: string, dateKey: string) {
  return prisma.outboundMessage.findMany({
    where: { dayKey: dateFromKey(dateKey), student: { establishmentId } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      kind: true,
      body: true,
      status: true,
      suppressionReason: true,
      provider: true,
      attempts: true,
      createdAt: true,
      sentAt: true,
      parent: { select: { name: true } },
      student: { select: { firstName: true, lastName: true } },
    },
  });
}
