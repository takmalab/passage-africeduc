// Initialise une base PostgreSQL en ligne (production / démo) : migrations + données de démo.
//   npm run db:init:prod -- "postgresql://utilisateur:motdepasse@hote:5432/base?sslmode=require"
// Pas encore de base ? En une commande (Prisma Postgres, gratuit) :  npx create-db@latest
// La commande affiche une URL de connexion PostgreSQL à copier ici.
import { spawnSync } from 'node:child_process';

const url = process.argv[2] ?? process.env.DATABASE_URL_PROD;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('Usage : npm run db:init:prod -- "postgresql://..."');
  console.error('Pour créer une base en ligne en une commande : npx create-db@latest');
  process.exit(1);
}
const env = { ...process.env, DATABASE_URL: url, SEED_FORCE: 'true' };
const run = (args) => {
  const r = spawnSync('npm', args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
run(['run', 'db:deploy']);
if (!process.argv.includes('--no-seed')) run(['run', 'db:seed']);
console.log('Base en ligne prête.');
