import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env.js';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Client Prisma unique. Toutes les requêtes passent par Prisma (requêtes
 * paramétrées) ; les rares requêtes SQL brutes utilisent `$queryRaw` avec des
 * gabarits balisés, jamais de concaténation de texte saisi.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

export type Db = typeof prisma;
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export * from '../generated/prisma/client.js';
