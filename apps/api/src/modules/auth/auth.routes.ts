import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { isTest } from '../../config/env.js';
import { audit } from '../../lib/audit.js';
import {
  currentUser,
  requireAuth,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '../../middleware/auth.js';
import { login, logout } from './auth.service.js';

const loginSchema = z.object({
  login: z.string().trim().min(1).max(100),
  password: z.string().min(1).max(200),
});

/** Limite par adresse IP, en plus du blocage par compte (voir auth.service). */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: {
    error: {
      code: 'TOO_MANY_REQUESTS',
      message: 'Trop de tentatives depuis cette adresse. Réessayez dans quelques minutes.',
    },
  },
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  try {
    const result = await login(body.login, body.password);
    res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(req));
    req.user = { ...result.user, role: result.user.role as never };
    await audit(req, 'auth.login', 'User', result.user.id);
    res.json({ user: result.user });
  } catch (err) {
    await audit(req, 'auth.login_failed', 'User', null, { login: body.login.slice(0, 100) });
    throw err;
  }
});

authRouter.post('/logout', requireAuth, async (req, res) => {
  if (req.sessionId) await logout(req.sessionId);
  await audit(req, 'auth.logout', 'User', currentUser(req).id);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});
