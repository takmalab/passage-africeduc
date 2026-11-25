import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { env } from '../config/env.js';
import { forbidden } from '../lib/errors.js';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'passage';

/**
 * En-têtes de sécurité. La CSP interdit tout script qui ne vient pas de
 * l'application elle-même : même si un texte malveillant s'affichait, il ne
 * pourrait pas s'exécuter.
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      workerSrc: ["'self'", 'blob:'],
      mediaSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
});

/**
 * Protection CSRF en deux couches :
 * 1. cookie de session `SameSite=Strict` (jamais envoyé depuis un autre site) ;
 * 2. pour toute requête qui modifie des données : en-tête personnalisé
 *    obligatoire (un autre site ne peut pas l'ajouter sans CORS, que l'on
 *    n'active pas) et en-tête Origin, s'il est présent, égal au nôtre.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) throw forbidden('Requête refusée.');
  const origin = req.get('origin');
  if (origin && !isAllowedOrigin(origin, req)) throw forbidden('Requête refusée.');
  next();
}

function isAllowedOrigin(origin: string, req: Request): boolean {
  if (origin === env.APP_ORIGIN) return true;
  try {
    // Même hôte que la requête (accès par l'adresse IP du réseau local en démonstration).
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}
