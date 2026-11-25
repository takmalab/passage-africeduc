import type { EventAck, RefusalReason, SyncBatch, SyncResponse } from '@passage/shared';
import { env } from '../../config/env.js';
import { prisma, Prisma, type Passage } from '../../db/prisma.js';
import { forbidden } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { evaluatePassage } from '../anomalies/anomalies.service.js';
import { verifyBadgeCode } from '../badges/badge-verifier.js';
import { assessClock } from './clock.js';

type Agent = { id: string; establishmentId: string };

/**
 * Réception d'un lot de scans (en ligne : lot d'un seul scan ; hors ligne :
 * jusqu'à 200 scans accumulés).
 *
 * Idempotence : chaque scan porte un identifiant créé sur l'appareil. Le couple
 * (appareil, identifiant) est unique en base. Un lot renvoyé après une coupure
 * renvoie « duplicate » pour ce qui était déjà arrivé, sans rien recréer.
 * Chaque scan est traité dans sa propre transaction : une erreur sur l'un
 * n'empêche pas les autres d'être enregistrés.
 */
export async function ingestBatch(
  agent: Agent,
  batch: SyncBatch,
  serverNow = Date.now(),
): Promise<SyncResponse> {
  const establishment = await prisma.establishment.findUniqueOrThrow({
    where: { id: agent.establishmentId },
  });

  const existingDevice = await prisma.device.findUnique({ where: { id: batch.deviceId } });
  if (existingDevice && existingDevice.establishmentId !== agent.establishmentId) {
    throw forbidden('Appareil non autorisé.');
  }
  const offsetForDevice = serverNow - batch.deviceSentAt;
  await prisma.device.upsert({
    where: { id: batch.deviceId },
    create: {
      id: batch.deviceId,
      establishmentId: agent.establishmentId,
      registeredById: agent.id,
      lastClockOffsetMs: clampInt(offsetForDevice),
    },
    update: { lastSeenAt: new Date(serverNow), lastClockOffsetMs: clampInt(offsetForDevice) },
  });

  const checkpoints = new Set(
    (
      await prisma.checkpoint.findMany({
        where: { establishmentId: agent.establishmentId },
        select: { id: true },
      })
    ).map((c) => c.id),
  );

  const acks: EventAck[] = [];
  const toEvaluate: Passage[] = [];

  for (const event of batch.events) {
    const previous = await prisma.passage.findUnique({
      where: { deviceId_localEventId: { deviceId: batch.deviceId, localEventId: event.localEventId } },
      include: { student: { select: { firstName: true } } },
    });
    if (previous) {
      acks.push(ackFrom(event.localEventId, 'duplicate', previous));
      continue;
    }
    if (!checkpoints.has(event.checkpointId)) {
      acks.push({ localEventId: event.localEventId, storage: 'invalid', reason: 'UNKNOWN_CHECKPOINT' });
      continue;
    }

    const clock = assessClock(event.deviceLocalTime, batch.deviceSentAt, serverNow, {
      skewFlagSeconds: env.CLOCK_SKEW_FLAG_SECONDS,
      maxAgeHours: env.CLOCK_MAX_AGE_HOURS,
    });

    try {
      const passage = await prisma.$transaction(async (tx) => {
        const verification = await verifyBadgeCode(tx, event.rawCode, {
          establishmentId: agent.establishmentId,
          allowPrintedBadges: establishment.allowPrintedBadges,
          effectiveTime: clock.effectiveTime,
        });

        // Heure incohérente : on garde la trace, sans consommer le compteur ni compter le passage.
        const unreliable = clock.status === 'UNRELIABLE';
        const accepted = verification.verdict === 'ACCEPTED' && !unreliable;
        const reason: RefusalReason | null = accepted
          ? null
          : unreliable
            ? 'CLOCK_UNRELIABLE'
            : verification.verdict === 'REFUSED'
              ? verification.reason
              : null;

        const created = await tx.passage.create({
          data: {
            deviceId: batch.deviceId,
            localEventId: event.localEventId,
            checkpointId: event.checkpointId,
            badgeId: verification.badge?.id ?? null,
            studentId: verification.badge?.studentId ?? null,
            rawPublicId: verification.badge?.publicId ?? null,
            codeCounter: verification.counter,
            deviceLocalTime: new Date(event.deviceLocalTime),
            deviceSentAt: new Date(batch.deviceSentAt),
            serverReceivedAt: new Date(serverNow),
            clockOffsetMs: clampInt(clock.offsetMs),
            effectiveTime: clock.effectiveTime,
            clockStatus: clock.status,
            verdict: accepted ? 'ACCEPTED' : 'REFUSED',
            refusalReason: reason,
          },
          include: { student: { select: { firstName: true } } },
        });

        if (accepted && verification.counter !== null) {
          await tx.badgeCodeUse.create({
            data: {
              badgeId: created.badgeId!,
              counter: verification.counter,
              passageId: created.id,
              effectiveTime: clock.effectiveTime,
            },
          });
        }
        return created;
      });
      acks.push(ackFrom(event.localEventId, 'created', passage));
      toEvaluate.push(passage);
    } catch (err) {
      // Course entre deux envois simultanés du même lot : l'autre a gagné.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await prisma.passage.findUnique({
          where: {
            deviceId_localEventId: { deviceId: batch.deviceId, localEventId: event.localEventId },
          },
          include: { student: { select: { firstName: true } } },
        });
        if (winner) {
          acks.push(ackFrom(event.localEventId, 'duplicate', winner));
          continue;
        }
      }
      throw err;
    }
  }

  // Règles d'anomalies après enregistrement : un échec ici ne fait pas perdre de passage.
  for (const passage of toEvaluate) {
    try {
      await evaluatePassage(passage, establishment.timezone);
    } catch (err) {
      logger.error({ err, passageId: passage.id }, 'Échec de l’évaluation des anomalies');
    }
  }

  return { serverTime: serverNow, clockOffsetMs: offsetForDevice, acks };
}

function ackFrom(
  localEventId: string,
  storage: 'created' | 'duplicate',
  passage: Passage & { student: { firstName: string } | null },
): EventAck {
  const ack: EventAck = { localEventId, storage, verdict: passage.verdict };
  if (passage.refusalReason) ack.reason = passage.refusalReason as RefusalReason;
  if (passage.verdict === 'ACCEPTED' && passage.student) ack.studentFirstName = passage.student.firstName;
  return ack;
}

function clampInt(value: number): number {
  return Math.max(-2_000_000_000, Math.min(2_000_000_000, Math.round(value)));
}
