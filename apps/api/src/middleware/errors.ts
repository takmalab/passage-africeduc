import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ressource introuvable.' } });
}

/** Toute erreur passe ici : l'utilisateur ne voit jamais de pile d'appels ni de SQL. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Données invalides.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }
  // Corps JSON illisible ou trop gros (express.json).
  const status = (err as { status?: number; type?: string }).status;
  if (status === 400 || status === 413) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: 'Requête invalide.' } });
    return;
  }
  logger.error({ err, path: req.path }, 'Erreur non gérée');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Erreur interne. Réessayez.' } });
}
