import fs from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { loadSession } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { csrfGuard, securityHeaders } from './middleware/security.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { managerRouter } from './modules/manager/manager.routes.js';
import { parentRouter } from './modules/parent/parent.routes.js';
import { agentRouter } from './modules/sync/agent.routes.js';

/**
 * Application Express. Une seule origine sert l'API (/api) et la PWA :
 * cookies de session `SameSite=Strict` sans configuration CORS.
 */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(securityHeaders);
  if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => !req.url?.startsWith('/api') } }));

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(cookieParser());
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  api.use(csrfGuard);
  api.use(loadSession);

  api.get('/health', (_req, res) => res.json({ status: 'ok' }));
  /** Heure du serveur : permet à l'appareil de l'agent d'estimer son décalage. */
  api.get('/time', (_req, res) => res.json({ serverTime: Date.now() }));
  api.use('/auth', authRouter);
  api.use('/agent', agentRouter);
  api.use('/manager', managerRouter);
  api.use('/parent', parentRouter);
  api.use(notFoundHandler);

  app.use('/api', api);

  // PWA construite (apps/web/dist), servie sur la même origine.
  const webDist = path.resolve(import.meta.dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(
      express.static(webDist, {
        index: false,
        setHeaders: (res, file) => {
          if (file.endsWith('sw.js') || file.endsWith('.webmanifest') || file.endsWith('index.html')) {
            res.set('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.set('Cache-Control', 'no-cache').sendFile(path.join(webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
