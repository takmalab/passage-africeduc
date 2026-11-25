import { prisma } from '../../db/prisma.js';
import { notFound } from '../../lib/errors.js';

/**
 * Cloisonnement des parents : chaque requête filtre sur le lien parent-enfant
 * DANS la requête SQL elle-même. Changer l'identifiant dans l'URL ne donne
 * jamais accès à un autre élève : la réponse est 404, comme pour un élève
 * inexistant, pour ne rien révéler.
 */

const childWhere = (parentId: string, studentId?: string) => ({
  ...(studentId ? { id: studentId } : {}),
  parents: { some: { parentId } },
});

export async function listChildren(parentId: string) {
  return prisma.student.findMany({
    where: childWhere(parentId),
    orderBy: { firstName: 'asc' },
    select: { id: true, firstName: true, lastName: true, classroom: { select: { name: true } } },
  });
}

export async function getChild(parentId: string, studentId: string) {
  const child = await prisma.student.findFirst({
    where: childWhere(parentId, studentId),
    select: { id: true, firstName: true, lastName: true, classroom: { select: { name: true } } },
  });
  if (!child) throw notFound('Élève introuvable.');

  const since = new Date(Date.now() - 14 * 86_400_000);
  const [passages, anomalies] = await Promise.all([
    prisma.passage.findMany({
      where: { studentId: child.id, verdict: 'ACCEPTED', effectiveTime: { gte: since } },
      orderBy: { effectiveTime: 'desc' },
      take: 200,
      select: { id: true, effectiveTime: true, checkpoint: { select: { label: true } } },
    }),
    prisma.anomaly.findMany({
      where: { studentId: child.id, date: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, type: true, status: true, date: true, details: true, createdAt: true },
    }),
  ]);
  return { child, passages, anomalies };
}

export async function listMessages(parentId: string) {
  return prisma.outboundMessage.findMany({
    where: { parentId, status: { in: ['PENDING', 'SENT'] } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, body: true, kind: true, createdAt: true, sentAt: true },
  });
}
