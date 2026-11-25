import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { randomToken, sha256Hex } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import { burnPasswordCheck, verifyPassword } from './password.js';

/** Message unique pour tous les échecs : ne révèle ni l'existence du compte ni son blocage. */
export const LOGIN_FAILED_MESSAGE = 'Identifiant ou mot de passe incorrect.';

const loginFailed = () => new HttpError(401, 'INVALID_CREDENTIALS', LOGIN_FAILED_MESSAGE);

export type LoginResult = {
  token: string;
  user: { id: string; name: string; role: string; establishmentId: string | null };
};

export async function login(loginRaw: string, password: string): Promise<LoginResult> {
  const login = loginRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { login } });

  if (!user) {
    await burnPasswordCheck(password);
    throw loginFailed();
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    // Compte bloqué : même travail et même message que pour un mauvais mot de passe.
    await burnPasswordCheck(password);
    throw loginFailed();
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const attempts = user.failedLoginCount + 1;
    const lock = attempts >= env.LOGIN_MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : attempts,
        lockedUntil: lock ? new Date(now.getTime() + env.LOGIN_LOCK_MINUTES * 60_000) : null,
      },
    });
    throw loginFailed();
  }

  const token = randomToken(32);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    }),
    prisma.session.create({
      data: {
        tokenHash: sha256Hex(token),
        userId: user.id,
        expiresAt: new Date(now.getTime() + env.SESSION_ABSOLUTE_HOURS * 3600_000),
      },
    }),
  ]);

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      establishmentId: user.establishmentId,
    },
  };
}

/** Déconnexion effective : la session est supprimée côté serveur. */
export async function logout(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}
