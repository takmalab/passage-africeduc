import { addDaysToDateKey, isoWeekdayOfDateKey, localParts } from '@passage/shared';
import { env } from '../../config/env.js';
import { prisma, Prisma, type Anomaly, type AnomalyType, type Passage } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { enqueueForAnomaly } from '../notifications/notifications.service.js';

export const dateFromKey = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);

type NewAnomaly = {
  studentId: string;
  establishmentId: string;
  type: AnomalyType;
  dateKey: string;
  dedupeKey: string;
  routeStepId?: string | null;
  passageId?: string | null;
  details: Prisma.InputJsonObject;
};

/**
 * Crée une anomalie et prépare les messages aux parents. La clé `dedupeKey`
 * est unique en base : rejouer une détection ne crée jamais de doublon.
 * Renvoie null si l'anomalie existait déjà.
 */
export async function raiseAnomaly(input: NewAnomaly): Promise<Anomaly | null> {
  let anomaly: Anomaly;
  try {
    anomaly = await prisma.anomaly.create({
      data: {
        studentId: input.studentId,
        establishmentId: input.establishmentId,
        type: input.type,
        date: dateFromKey(input.dateKey),
        dedupeKey: input.dedupeKey,
        routeStepId: input.routeStepId ?? null,
        passageId: input.passageId ?? null,
        details: input.details,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
    throw err;
  }
  await enqueueForAnomaly(anomaly);
  return anomaly;
}

/**
 * Ce que couvrent les exceptions du jour pour cet élève (voir DECISIONS D18) :
 * - 'DAY'  : jour férié ou absence justifiée, toute la journée est excusée ;
 * - 'EXIT' : sortie anticipée autorisée, seule la sortie (dernière étape) l'est ;
 *   ce qui précède (bus, entrée) compte toujours ;
 * - null   : aucune exception.
 */
export async function dayExceptionScope(
  establishmentId: string,
  studentId: string,
  dateKey: string,
): Promise<'DAY' | 'EXIT' | null> {
  const exceptions = await prisma.dayException.findMany({
    where: {
      establishmentId,
      date: dateFromKey(dateKey),
      OR: [{ studentId }, { type: 'HOLIDAY', studentId: null }],
    },
    select: { type: true },
  });
  if (exceptions.some((e) => e.type !== 'EARLY_EXIT_AUTHORIZED')) return 'DAY';
  return exceptions.length > 0 ? 'EXIT' : null;
}

/** Identifiant de la dernière étape de l'itinéraire de l'élève ce jour-là : la sortie. */
async function lastStepIdOfDay(studentId: string, isoWeekday: number): Promise<string | null> {
  const last = await prisma.routeStep.findFirst({
    where: { route: { studentId }, days: { has: isoWeekday } },
    orderBy: { position: 'desc' },
    select: { id: true },
  });
  return last?.id ?? null;
}

const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/**
 * Règles évaluées à la réception d'un passage. Un jour férié ou une absence
 * justifiée suspend les règles liées à l'itinéraire ; une sortie anticipée
 * n'excuse qu'un passage en avance à la sortie (D18). Les alertes de sécurité
 * du badge restent toujours actives.
 */
export async function evaluatePassage(passage: Passage, timezone: string): Promise<void> {
  if (!passage.studentId) return;
  const studentId = passage.studentId;
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { establishmentId: true },
  });
  if (!student) return;
  const { dateKey, minuteOfDay, isoWeekday } = localParts(passage.effectiveTime, timezone);
  const checkpoint = await prisma.checkpoint.findUnique({ where: { id: passage.checkpointId } });
  const base = {
    studentId,
    establishmentId: student.establishmentId,
    dateKey,
    passageId: passage.id,
  };
  const label = checkpoint?.label ?? null;

  if (passage.verdict === 'REFUSED') {
    const reason = passage.refusalReason;
    if (
      reason === 'CODE_ALREADY_USED' ||
      reason === 'CODE_OUT_OF_ORDER' ||
      reason === 'BAD_SIGNATURE'
    ) {
      await raiseAnomaly({
        ...base,
        type: 'BADGE_REPLAY',
        dedupeKey: `REPLAY:${passage.id}`,
        details: { reason, checkpointLabel: label, minute: minuteOfDay },
      });
    } else if (reason === 'BADGE_INACTIVE') {
      await raiseAnomaly({
        ...base,
        type: 'INACTIVE_BADGE',
        dedupeKey: `INACTIVE:${passage.id}`,
        details: { checkpointLabel: label, minute: minuteOfDay },
      });
    }
    return;
  }

  // Carte imprimée utilisée sur deux appareils à quelques minutes d'écart : copie probable.
  if (passage.badgeId) {
    const badge = await prisma.badge.findUnique({ where: { id: passage.badgeId } });
    if (badge?.kind === 'PRINTED') {
      const windowMs = env.PRINTED_CLONE_MINUTES * 60_000;
      const other = await prisma.passage.findFirst({
        where: {
          badgeId: badge.id,
          verdict: 'ACCEPTED',
          id: { not: passage.id },
          deviceId: { not: passage.deviceId },
          effectiveTime: {
            gte: new Date(passage.effectiveTime.getTime() - windowMs),
            lte: new Date(passage.effectiveTime.getTime() + windowMs),
          },
        },
      });
      if (other) {
        await raiseAnomaly({
          ...base,
          type: 'BADGE_REPLAY',
          dedupeKey: `CLONE:${pairKey(passage.id, other.id)}`,
          details: { suspectedClone: true, checkpointLabel: label, minute: minuteOfDay },
        });
      }
    }
  }

  const exception = await dayExceptionScope(student.establishmentId, studentId, dateKey);
  if (exception === 'DAY') return;

  // Double scan : un autre passage accepté du même élève à moins de N secondes.
  const doubleMs = env.DOUBLE_SCAN_SECONDS * 1000;
  const close = await prisma.passage.findFirst({
    where: {
      studentId,
      verdict: 'ACCEPTED',
      id: { not: passage.id },
      effectiveTime: {
        gt: new Date(passage.effectiveTime.getTime() - doubleMs),
        lt: new Date(passage.effectiveTime.getTime() + doubleMs),
      },
    },
  });
  if (close) {
    await raiseAnomaly({
      ...base,
      type: 'DOUBLE_SCAN',
      dedupeKey: `DOUBLE:${pairKey(passage.id, close.id)}`,
      details: { checkpointLabel: label, minute: minuteOfDay, otherPassageId: close.id },
    });
    return;
  }

  const steps = await prisma.routeStep.findMany({
    where: {
      route: { studentId },
      checkpointId: passage.checkpointId,
      days: { has: isoWeekday },
    },
    orderBy: { position: 'asc' },
  });

  if (steps.length === 0) {
    await raiseAnomaly({
      ...base,
      type: 'UNEXPECTED_CHECKPOINT',
      dedupeKey: `UNEXPECTED:${passage.id}`,
      details: { checkpointLabel: label, minute: minuteOfDay },
    });
    return;
  }

  const inWindow = steps.find((s) => minuteOfDay >= s.startMinute && minuteOfDay <= s.endMinute);
  if (inWindow) {
    await autoResolveMissed(inWindow.id, dateKey, studentId);
    return;
  }

  // Hors fenêtre : on rattache le passage à l'étape la plus proche.
  const distance = (s: { startMinute: number; endMinute: number }) =>
    minuteOfDay < s.startMinute ? s.startMinute - minuteOfDay : minuteOfDay - s.endMinute;
  const nearest = [...steps].sort((a, b) => distance(a) - distance(b))[0]!;
  const early = minuteOfDay < nearest.startMinute;
  // Sortie anticipée autorisée : passer en avance à la sortie est justement ce qui
  // est permis. Un passage en retard, ou à une autre étape, reste signalé.
  if (
    exception === 'EXIT' &&
    early &&
    nearest.id === (await lastStepIdOfDay(studentId, isoWeekday))
  ) {
    return;
  }
  await raiseAnomaly({
    ...base,
    type: 'OUT_OF_WINDOW',
    routeStepId: nearest.id,
    dedupeKey: `OUT:${passage.id}`,
    details: {
      checkpointLabel: label,
      minute: minuteOfDay,
      window: { start: nearest.startMinute, end: nearest.endMinute },
      direction: early ? 'EARLY' : 'LATE',
      stepPosition: nearest.position,
    },
  });
}

/**
 * Un passage valide arrive après coup (synchronisation tardive) alors que
 * l'anomalie « passage manquant » a déjà été émise : on la clôt
 * automatiquement et on prépare un message de rectification.
 */
async function autoResolveMissed(routeStepId: string, dateKey: string, studentId: string) {
  const missed = await prisma.anomaly.findUnique({
    where: { dedupeKey: `MISSED:${routeStepId}:${dateKey}` },
  });
  if (!missed || missed.studentId !== studentId) return;
  if (missed.status !== 'OPEN' && missed.status !== 'ACKNOWLEDGED') return;
  const resolved = await prisma.anomaly.update({
    where: { id: missed.id },
    data: {
      status: 'AUTO_RESOLVED',
      resolvedAt: new Date(),
      resolutionNote: 'Passage reçu après la clôture de la fenêtre (synchronisation différée).',
    },
  });
  // Rectification seulement si une alerte a effectivement été préparée.
  const alerted = await prisma.outboundMessage.count({
    where: { anomalyId: missed.id, kind: 'ALERT', status: { in: ['PENDING', 'SENT'] } },
  });
  if (alerted > 0) await enqueueForAnomaly(resolved, 'CORRECTION');
}

/**
 * Détection des passages manquants, lancée par le programme de fond sans
 * qu'aucun utilisateur n'ouvre l'application. Pour chaque fenêtre close
 * (fin + délai de grâce) aujourd'hui et la veille (rattrapage après une panne),
 * on cherche un passage accepté dans la fenêtre ; sinon, anomalie.
 * Idempotent : la clé MISSED:<étape>:<date> empêche tout doublon.
 */
export async function detectMissedCheckpoints(
  now: Date = new Date(),
  lookbackDays = 1,
): Promise<number> {
  let created = 0;
  const establishments = await prisma.establishment.findMany({
    select: { id: true, timezone: true },
  });

  for (const est of establishments) {
    const today = localParts(now, est.timezone);
    const dates = Array.from({ length: lookbackDays + 1 }, (_, i) =>
      addDaysToDateKey(today.dateKey, i - lookbackDays),
    );

    for (const dateKey of dates) {
      const weekday = isoWeekdayOfDateKey(dateKey);
      const isToday = dateKey === today.dateKey;
      const steps = await prisma.routeStep.findMany({
        where: {
          days: { has: weekday },
          route: { student: { establishmentId: est.id, status: 'ACTIVE' } },
          ...(isToday ? { endMinute: { lte: today.minuteOfDay - env.WINDOW_GRACE_MINUTES } } : {}),
        },
        include: { route: { select: { studentId: true } }, checkpoint: true },
      });

      for (const step of steps) {
        const studentId = step.route.studentId;
        const dedupeKey = `MISSED:${step.id}:${dateKey}`;
        const exists = await prisma.anomaly.findUnique({ where: { dedupeKey } });
        if (exists) continue;
        const exception = await dayExceptionScope(est.id, studentId, dateKey);
        if (exception === 'DAY') continue;
        // Sortie anticipée : l'élève a pu partir avant la plage de sortie ; les
        // étapes du matin restent attendues.
        if (exception === 'EXIT' && step.id === (await lastStepIdOfDay(studentId, weekday))) {
          continue;
        }
        // Un passage hors fenêtre déjà signalé pour cette étape suffit : pas de double alerte.
        const outOfWindow = await prisma.anomaly.count({
          where: { routeStepId: step.id, date: dateFromKey(dateKey), type: 'OUT_OF_WINDOW' },
        });
        if (outOfWindow > 0) continue;

        const found = await hasPassageInWindow(
          studentId,
          step.checkpointId,
          dateKey,
          step.startMinute,
          step.endMinute,
          est.timezone,
        );
        if (found) continue;

        const anomaly = await raiseAnomaly({
          studentId,
          establishmentId: est.id,
          type: 'MISSED_CHECKPOINT',
          dateKey,
          routeStepId: step.id,
          dedupeKey,
          details: {
            checkpointLabel: step.checkpoint.label,
            window: { start: step.startMinute, end: step.endMinute },
            stepPosition: step.position,
          },
        });
        if (anomaly) created++;
      }
    }
  }
  if (created > 0) logger.info({ created }, 'Passages manquants détectés');
  return created;
}

async function hasPassageInWindow(
  studentId: string,
  checkpointId: string,
  dateKey: string,
  startMinute: number,
  endMinute: number,
  timezone: string,
): Promise<boolean> {
  // Bornes larges (± 1 jour) puis filtre exact en heure locale de l'établissement.
  const from = new Date(`${addDaysToDateKey(dateKey, -1)}T00:00:00Z`);
  const to = new Date(`${addDaysToDateKey(dateKey, 2)}T00:00:00Z`);
  const passages = await prisma.passage.findMany({
    where: {
      studentId,
      checkpointId,
      verdict: 'ACCEPTED',
      effectiveTime: { gte: from, lt: to },
    },
    select: { effectiveTime: true },
  });
  return passages.some((p) => {
    const local = localParts(p.effectiveTime, timezone);
    return (
      local.dateKey === dateKey &&
      local.minuteOfDay >= startMinute &&
      local.minuteOfDay <= endMinute
    );
  });
}
