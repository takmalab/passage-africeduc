import { hash, verify } from '@node-rs/argon2';
import { z } from 'zod';

/**
 * Hachage Argon2id avec les paramètres minimaux recommandés par l'OWASP
 * (19 Mio de mémoire, 2 itérations, 1 fil). Le sel est aléatoire et intégré
 * au résultat.
 */
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const passwordSchema = z
  .string()
  .min(8, 'Le mot de passe doit contenir au moins 8 caractères.')
  .max(128, 'Le mot de passe est trop long.');

export function hashPassword(plain: string): Promise<string> {
  return hash(passwordSchema.parse(plain), ARGON2_OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/**
 * Empreinte factice : quand le compte n'existe pas, on vérifie quand même un
 * mot de passe, pour que le temps de réponse ne révèle pas l'existence du compte.
 */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(plain: string): Promise<void> {
  dummyHash ??= hash('compte-inexistant-factice', ARGON2_OPTIONS);
  await verifyPassword(await dummyHash, plain);
}
