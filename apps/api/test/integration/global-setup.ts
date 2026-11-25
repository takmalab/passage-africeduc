import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

/**
 * Recrée le schéma de la base de test à partir des fichiers de migration
 * (exactement le SQL appliqué en production), sans dépendre de la CLI Prisma.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !/test/i.test(url)) {
    throw new Error(`Refus : la base de test doit contenir « test » dans son nom (${url ?? 'vide'}).`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = path.resolve(import.meta.dirname, '../../prisma/migrations');
    const migrations = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const name of migrations) {
      await client.query(fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8'));
    }
  } finally {
    await client.end();
  }
}
