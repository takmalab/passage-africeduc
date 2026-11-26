import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { conflict, notFound } from '../../lib/errors.js';
import { hashPassword } from '../auth/password.js';
import { isUniqueViolation } from './manager.service.js';

/**
 * Comptes créés par le responsable : agents de son établissement, et parents
 * créés depuis la fiche d'un élève (compte et lien dans la même transaction).
 *
 * - Le rôle est fixé ici, jamais lu dans la requête : impossible de créer un responsable.
 * - Le mot de passe initial est tiré au hasard, haché (argon2) et renvoyé une seule fois.
 */

/** Identifiant de connexion : minuscules, chiffres, point, tiret, souligné ; 3 à 50 caractères. */
export const loginSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,50}$/, 'Identifiant : 3 à 50 caractères (lettres, chiffres, . _ -).');

export type AccountInput = { name: string; login: string };

/** 12 octets aléatoires (96 bits) en base64url : 16 caractères, impossibles à deviner. */
function generateTemporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

const accountSelect = { id: true, name: true, login: true } as const;

export async function listAgents(establishmentId: string) {
  return prisma.user.findMany({
    where: { establishmentId, role: 'AGENT' },
    orderBy: { name: 'asc' },
    select: accountSelect,
  });
}

export async function createAgent(establishmentId: string, input: AccountInput) {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    const agent = await prisma.user.create({
      data: { ...input, passwordHash, role: 'AGENT', establishmentId },
      select: accountSelect,
    });
    return { agent, temporaryPassword };
  } catch (err) {
    // Contrainte User.login @unique (identifiant unique sur toute l'application).
    if (isUniqueViolation(err)) throw conflict('Cet identifiant est déjà utilisé.');
    throw err;
  }
}

export async function createParentForStudent(
  establishmentId: string,
  studentId: string,
  input: AccountInput,
) {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    // Transaction : soit le compte ET le lien existent, soit rien (pas de parent orphelin).
    const parent = await prisma.$transaction(async (tx) => {
      // L'élève doit appartenir à l'établissement du responsable, sinon 404 (rien n'est révélé).
      const student = await tx.student.findFirst({
        where: { id: studentId, establishmentId },
        select: { id: true },
      });
      if (!student) throw notFound('Élève introuvable.');
      // Un parent n'a pas d'établissement : il ne voit que les élèves qui lui sont liés.
      const user = await tx.user.create({
        data: { ...input, passwordHash, role: 'PARENT', establishmentId: null },
        select: accountSelect,
      });
      await tx.parentStudent.create({ data: { parentId: user.id, studentId: student.id } });
      return user;
    });
    return { parent, temporaryPassword };
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Cet identifiant est déjà utilisé.');
    throw err;
  }
}

// --- Liens parent-élève ----------------------------------------------------------

/**
 * Parents connus de l'établissement : ceux liés à au moins un de SES élèves.
 * Il n'existe pas de liste globale des parents : un responsable ne voit jamais
 * les parents d'une autre école.
 */
export async function listEstablishmentParents(establishmentId: string) {
  return prisma.user.findMany({
    where: { role: 'PARENT', children: { some: { student: { establishmentId } } } },
    orderBy: { name: 'asc' },
    select: accountSelect,
  });
}

/** Lie un parent connu de l'établissement à un élève de l'établissement (frère, sœur...). */
export async function linkParent(establishmentId: string, studentId: string, parentId: string) {
  const [student, parent] = await Promise.all([
    prisma.student.findFirst({ where: { id: studentId, establishmentId }, select: { id: true } }),
    prisma.user.findFirst({
      where: {
        id: parentId,
        role: 'PARENT',
        children: { some: { student: { establishmentId } } },
      },
      select: { id: true },
    }),
  ]);
  // Même réponse pour « n'existe pas » et « appartient à une autre école » : rien n'est révélé.
  if (!student) throw notFound('Élève introuvable.');
  if (!parent) throw notFound('Parent introuvable.');
  try {
    await prisma.parentStudent.create({ data: { parentId: parent.id, studentId: student.id } });
  } catch (err) {
    // Clé primaire (parentId, studentId) : le lien existe déjà.
    if (isUniqueViolation(err)) throw conflict('Ce parent est déjà lié à cet élève.');
    throw err;
  }
}

/** Retire un lien : le parent perd l'accès à cet élève ; son compte est conservé. */
export async function unlinkParent(establishmentId: string, studentId: string, parentId: string) {
  // Le filtre sur l'établissement est DANS la requête de suppression.
  const { count } = await prisma.parentStudent.deleteMany({
    where: { parentId, studentId, student: { establishmentId } },
  });
  if (count === 0) throw notFound('Lien introuvable.');
}
