import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createApp } from './app.js';
import { env, envDir } from './config/env.js';
import { prisma } from './db/prisma.js';
import { logger } from './lib/logger.js';
import { startScheduler } from './worker/scheduler.js';

const app = createApp();
const servers: (http.Server | https.Server)[] = [];

servers.push(
  http.createServer(app).listen(env.PORT, () => {
    logger.info(`Passage en écoute sur http://localhost:${env.PORT}`);
  }),
);

// HTTPS optionnel : nécessaire pour la caméra et le NFC sur un téléphone du réseau local.
if (env.HTTPS_KEY_PATH && env.HTTPS_CERT_PATH) {
  // path.resolve laisse un chemin absolu tel quel et rattache un chemin relatif à la racine.
  const credentials = {
    key: fs.readFileSync(path.resolve(envDir, env.HTTPS_KEY_PATH)),
    cert: fs.readFileSync(path.resolve(envDir, env.HTTPS_CERT_PATH)),
  };
  servers.push(
    https.createServer(credentials, app).listen(env.HTTPS_PORT, () => {
      logger.info(`HTTPS en écoute sur le port ${env.HTTPS_PORT}`);
    }),
  );
}

// Le programme de fond tourne dans le même processus par défaut (un seul conteneur).
// Pour le séparer : SCHEDULER_ENABLED=false ici et `npm run worker` à côté.
const stopScheduler = env.SCHEDULER_ENABLED ? startScheduler() : () => undefined;

async function shutdown(signal: string) {
  logger.info({ signal }, 'Arrêt en cours');
  stopScheduler();
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
