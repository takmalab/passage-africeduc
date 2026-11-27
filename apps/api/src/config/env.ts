import fs from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Le fichier .env est à la racine du monorepo (jamais versionné). On le cherche en
// remontant depuis le dossier courant, que l'on lance le code source ou le build.
function findEnvFile(): string | undefined {
  for (const start of [process.cwd(), import.meta.dirname]) {
    let dir = start;
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, '.env');
      if (fs.existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
  }
  return undefined;
}
const envFile = findEnvFile();
if (envFile) loadEnv({ path: envFile, quiet: true });

/**
 * Dossier de référence des chemins relatifs du .env (ex. HTTPS_KEY_PATH=certs/lan.key) :
 * celui du fichier .env, c'est-à-dire la racine du projet. Sans cela, le chemin dépendrait
 * du dossier de lancement (npm start s'exécute dans apps/api).
 */
export const envDir = envFile ? path.dirname(envFile) : process.cwd();

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const intFrom = (def: number) => z.coerce.number().int().nonnegative().default(def);
const numFrom = (def: number) => z.coerce.number().nonnegative().default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intFrom(3000),
  APP_ORIGIN: z.string().default('http://localhost:3000'),
  TRUST_PROXY: bool,
  HTTPS_KEY_PATH: z.string().optional().default(''),
  HTTPS_CERT_PATH: z.string().optional().default(''),
  HTTPS_PORT: intFrom(8443),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),

  SESSION_IDLE_MINUTES: intFrom(30),
  SESSION_ABSOLUTE_HOURS: intFrom(8),
  LOGIN_MAX_ATTEMPTS: intFrom(5),
  LOGIN_LOCK_MINUTES: intFrom(15),

  /** Clé maîtresse (64 caractères hexadécimaux) dont dérivent les clés AES des cartes NFC. */
  BADGE_KEYS_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'BADGE_KEYS_MASTER_KEY doit faire 64 caractères hexadécimaux'),
  /** Tolérance (minutes) pour l'ordre des compteurs NFC entre appareils hors ligne. */
  NFC_ORDER_TOLERANCE_MINUTES: intFrom(2),
  CARD_SIMULATOR_ENABLED: bool,

  CLOCK_SKEW_FLAG_SECONDS: intFrom(120),
  CLOCK_MAX_AGE_HOURS: intFrom(72),

  DOUBLE_SCAN_SECONDS: intFrom(60),
  WINDOW_GRACE_MINUTES: intFrom(15),
  PRINTED_CLONE_MINUTES: intFrom(5),
  /** Carte QR imprimée : une seule validation par point dans cette fenêtre (minutes). */
  PRINTED_REUSE_MINUTES: intFrom(120),
  SCHEDULER_ENABLED: bool,
  SCHEDULER_INTERVAL_SECONDS: intFrom(60),

  NOTIFY_MAX_PER_STUDENT_PER_DAY: intFrom(3),
  NOTIFY_PROVIDER: z.enum(['outbox']).default('outbox'),

  MISTRAL_API_KEY: z.string().optional().default(''),
  MISTRAL_MODEL: z.string().default('mistral-small-latest'),
  MISTRAL_BASE_URL: z.string().default('https://api.mistral.ai/v1'),
  AI_TIMEOUT_MS: intFrom(8000),
  AI_MAX_OUTPUT_TOKENS: intFrom(300),
  AI_DAILY_BUDGET_USD: numFrom(0.5),
  AI_PRICE_INPUT_PER_MTOK: numFrom(0.15),
  AI_PRICE_OUTPUT_PER_MTOK: numFrom(0.6),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')} : ${i.message}`);
    // Message volontairement explicite : c'est la première chose que voit la personne qui installe.
    throw new Error(`Configuration invalide (fichier .env) :\n${issues.join('\n')}`);
  }
  return parsed.data;
}

export const env: Env = load();

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
