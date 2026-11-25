import type { Request } from 'express';
import { prisma, type Prisma } from '../db/prisma.js';
import { logger } from './logger.js';

/**
 * Journal d'audit : qui a consulté ou modifié quoi. Les données concernent des
 * mineurs ; chaque consultation d'une fiche élève par un parent est tracée.
 * Un échec d'écriture du journal ne bloque pas la requête, mais il est signalé.
 */
export async function audit(
  req: Request,
  action: string,
  targetType: string,
  targetId?: string | null,
  meta?: Prisma.InputJsonValue,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user?.id ?? null,
        action,
        targetType,
        targetId: targetId ?? null,
        ip: req.ip ?? null,
        meta,
      },
    });
  } catch (err) {
    logger.error({ err, action }, "Échec d'écriture du journal d'audit");
  }
}
