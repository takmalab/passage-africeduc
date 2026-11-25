import { env } from '../../config/env.js';
import { prisma, type Anomaly, type MessageKind } from '../../db/prisma.js';
import { logger } from '../../lib/logger.js';
import { getProvider } from './provider.js';
import { alertBody, correctionBody, type TemplateInput } from './templates.js';

const MAX_ATTEMPTS = 3;
export const DAILY_CAP_REASON = 'Plafond journalier de messages atteint pour cet élève.';

/**
 * Prépare un message par parent de l'élève. Au-delà du plafond journalier
 * (par élève et par parent), le message est conservé avec l'état SUPPRESSED et
 * son motif : l'anomalie reste visible, seul l'envoi est retenu.
 * Les rectifications ne sont jamais plafonnées : elles corrigent une alerte déjà reçue.
 */
export async function enqueueForAnomaly(anomaly: Anomaly, kind: MessageKind = 'ALERT') {
  const student = await prisma.student.findUnique({
    where: { id: anomaly.studentId },
    select: { firstName: true, parents: { select: { parentId: true } } },
  });
  if (!student || student.parents.length === 0) return;

  const details = anomaly.details as {
    checkpointLabel?: string;
    minute?: number;
    window?: { start: number; end: number };
  };
  const input: TemplateInput = {
    type: anomaly.type,
    firstName: student.firstName,
    checkpointLabel: details.checkpointLabel ?? null,
    dateKey: anomaly.date.toISOString().slice(0, 10),
    minute: details.minute ?? null,
    window: details.window ?? null,
  };
  const body = kind === 'ALERT' ? alertBody(input) : correctionBody(input);
  const provider = getProvider();

  for (const { parentId } of student.parents) {
    let suppressed = false;
    if (kind === 'ALERT') {
      const sentToday = await prisma.outboundMessage.count({
        where: {
          studentId: anomaly.studentId,
          parentId,
          dayKey: anomaly.date,
          kind: 'ALERT',
          status: { in: ['PENDING', 'SENT'] },
        },
      });
      suppressed = sentToday >= env.NOTIFY_MAX_PER_STUDENT_PER_DAY;
    }
    // La contrainte unique (anomalie, parent, type) rend l'appel rejouable sans doublon.
    await prisma.outboundMessage.createMany({
      data: {
        parentId,
        studentId: anomaly.studentId,
        anomalyId: anomaly.id,
        kind,
        body,
        provider: provider.name,
        dayKey: anomaly.date,
        status: suppressed ? 'SUPPRESSED' : 'PENDING',
        suppressionReason: suppressed ? DAILY_CAP_REASON : null,
      },
      skipDuplicates: true,
    });
  }
}

/** Envoie les messages en attente (appelé par le programme de fond). */
export async function dispatchPending(limit = 50): Promise<number> {
  const provider = getProvider();
  const pending = await prisma.outboundMessage.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let sent = 0;
  for (const message of pending) {
    try {
      await provider.send({ id: message.id, parentId: message.parentId, body: message.body });
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 } },
      });
      sent++;
    } catch (err) {
      const attempts = message.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma.outboundMessage.update({
        where: { id: message.id },
        data: {
          attempts,
          lastError: err instanceof Error ? err.message.slice(0, 200) : 'Erreur inconnue',
          status: failed ? 'FAILED' : 'PENDING',
        },
      });
      logger.warn({ messageId: message.id, attempts }, 'Échec d’envoi d’un message parent');
    }
  }
  return sent;
}
