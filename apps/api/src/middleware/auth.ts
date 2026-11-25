import type { NextFunction, Request, Response } from 'express';
import { env, isProduction } from '../config/env.js';
import { prisma, type Role } from '../db/prisma.js';
import { sha256Hex } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'psg_session';

export type AuthUser = {
  id: string;
  name: string;
  role: Role;
  establishmentId: string | null;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
      sessionId?: string;
    }
  }
}

export function sessionCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: isProduction || req.secure,
    path: '/',
    maxAge: env.SESSION_ABSOLUTE_HOURS * 3600 * 1000,
  };
}

/**
 * Charge la session à partir du cookie. Une session expirée (inactivité ou
 * durée absolue) est supprimée côté serveur : elle ne peut plus resservir.
 */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { user: { select: { id: true, name: true, role: true, establishmentId: true } } },
  });
  if (!session) {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return next();
  }

  const now = Date.now();
  const idleLimit = session.lastSeenAt.getTime() + env.SESSION_IDLE_MINUTES * 60_000;
  if (session.expiresAt.getTime() <= now || idleLimit <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    return next();
  }

  // Mise à jour de l'activité au plus une fois par minute (évite une écriture par requête).
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } });
  }

  req.user = session.user;
  req.sessionId = session.id;
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) throw unauthorized();
  next();
}

/**
 * Contrôle de rôle côté serveur, sur chaque route. Masquer un bouton dans
 * l'interface n'est qu'un confort : c'est ce middleware qui protège.
 */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

/** Utilisateur courant (après requireAuth / requireRole). */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** Établissement du personnel (agent, responsable). Un parent n'en a pas. */
export function staffEstablishment(req: Request): string {
  const user = currentUser(req);
  if (!user.establishmentId) throw forbidden();
  return user.establishmentId;
}
