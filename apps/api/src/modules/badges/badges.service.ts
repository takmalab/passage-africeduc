import { randomBytes } from 'node:crypto';
import { formatNfcCode, formatPrintedCode, parseBadgeCode } from '@passage/shared';
import { env } from '../../config/env.js';
import { prisma, type BadgeKind, type BadgeStatus } from '../../db/prisma.js';
import { randomToken, safeEqual, sha256Hex } from '../../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { nfcMacKey, nfcMetaKey, uidHash } from './keys.js';
import { computeSdmMac, decryptPiccData, simulateTap } from './nfc-crypto.js';

/** Statuts « vivants » : un seul par élève, garanti par un index unique partiel. */
const LIVE: BadgeStatus[] = ['PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED'];

/** Transitions autorisées. LOST et REVOKED sont définitifs. */
const TRANSITIONS: Record<BadgeStatus, BadgeStatus[]> = {
  PENDING_ACTIVATION: ['REVOKED'],
  ACTIVE: ['SUSPENDED', 'LOST', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'LOST', 'REVOKED'],
  LOST: [],
  REVOKED: [],
};

export type IssueResult = {
  badge: { id: string; publicId: string; kind: BadgeKind; status: BadgeStatus };
  /** Carte imprimée : contenu du QR, affiché une seule fois (le secret n'est pas conservé). */
  printedCode?: string;
  /** Carte NFC : éléments pour programmer la puce (voir docs/BADGES.md). */
  nfcProgramming?: { metaKey: string; macKey: string; urlTemplate: string };
};

async function getStudentInEstablishment(studentId: string, establishmentId: string) {
  const student = await prisma.student.findFirst({ where: { id: studentId, establishmentId } });
  if (!student) throw notFound('Élève introuvable.');
  return student;
}

/**
 * Émet un badge. S'il existe déjà un badge vivant, il faut une raison de
 * remplacement : l'ancien est déclaré perdu ou révoqué dans la même transaction,
 * ce qui l'invalide immédiatement.
 */
export async function issueBadge(
  establishmentId: string,
  studentId: string,
  kind: BadgeKind,
  replaceReason?: 'LOST' | 'REVOKED',
): Promise<IssueResult> {
  await getStudentInEstablishment(studentId, establishmentId);
  if (kind === 'PRINTED') {
    const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId } });
    if (!est.allowPrintedBadges) {
      throw forbidden("Les cartes QR imprimées sont désactivées pour cet établissement.");
    }
  }

  const secret = kind === 'PRINTED' ? randomToken(24) : undefined;

  const badge = await prisma.$transaction(async (tx) => {
    const live = await tx.badge.findFirst({ where: { studentId, status: { in: LIVE } } });
    if (live && !replaceReason) {
      throw conflict('Cet élève a déjà un badge. Indiquez s’il est perdu ou révoqué pour le remplacer.');
    }
    if (live) {
      await tx.badge.update({
        where: { id: live.id },
        data: { status: replaceReason, statusChangedAt: new Date() },
      });
    }
    return tx.badge.create({
      data: {
        publicId: randomToken(12),
        studentId,
        kind,
        status: kind === 'PRINTED' ? 'ACTIVE' : 'PENDING_ACTIVATION',
        staticSecretHash: secret ? sha256Hex(secret) : null,
        activatedAt: kind === 'PRINTED' ? new Date() : null,
        replacesBadgeId: live?.id ?? null,
      },
    });
  });

  const result: IssueResult = {
    badge: { id: badge.id, publicId: badge.publicId, kind: badge.kind, status: badge.status },
  };
  if (secret) result.printedCode = formatPrintedCode(badge.publicId, secret);
  if (kind === 'NFC') {
    result.nfcProgramming = {
      metaKey: nfcMetaKey(establishmentId).toString('hex').toUpperCase(),
      macKey: nfcMacKey(badge.id).toString('hex').toUpperCase(),
      urlTemplate: `${env.APP_ORIGIN}/c?p=00000000000000000000000000000000&c=0000000000000000`,
    };
  }
  return result;
}

/**
 * Première lecture d'une carte NFC fraîchement programmée : on vérifie sa
 * signature avec la clé du badge, puis on mémorise l'empreinte de son UID.
 */
export async function activateNfcBadge(establishmentId: string, badgeId: string, rawCode: string) {
  const badge = await prisma.badge.findFirst({
    where: { id: badgeId, student: { establishmentId } },
  });
  if (!badge) throw notFound('Badge introuvable.');
  if (badge.kind !== 'NFC' || badge.status !== 'PENDING_ACTIVATION') {
    throw conflict('Ce badge n’attend pas d’activation.');
  }
  const code = parseBadgeCode(rawCode);
  if (!code || code.kind !== 'NFC') throw badRequest('Lecture de carte invalide.');
  const picc = decryptPiccData(nfcMetaKey(establishmentId), code.piccData);
  if (!picc || !safeEqual(computeSdmMac(nfcMacKey(badge.id), picc.uid, picc.counter), code.mac)) {
    throw badRequest('Carte non reconnue : vérifiez les clés programmées.');
  }
  const hash = uidHash(picc.uid);
  const taken = await prisma.badge.findUnique({ where: { uidHash: hash } });
  if (taken) throw conflict('Cette carte est déjà associée à un autre badge.');
  return prisma.badge.update({
    where: { id: badge.id },
    data: { uidHash: hash, status: 'ACTIVE', activatedAt: new Date(), statusChangedAt: new Date() },
    select: { id: true, status: true },
  });
}

export async function changeBadgeStatus(
  establishmentId: string,
  badgeId: string,
  next: BadgeStatus,
) {
  const badge = await prisma.badge.findFirst({
    where: { id: badgeId, student: { establishmentId } },
  });
  if (!badge) throw notFound('Badge introuvable.');
  if (!TRANSITIONS[badge.status].includes(next)) {
    throw conflict(`Passage de ${badge.status} à ${next} impossible.`);
  }
  return prisma.badge.update({
    where: { id: badge.id },
    data: { status: next, statusChangedAt: new Date() },
    select: { id: true, status: true },
  });
}

// --- Simulateur de carte NFC (démonstration sans matériel) ------------------

function assertSimulator() {
  if (!env.CARD_SIMULATOR_ENABLED) throw notFound();
}

/** Crée une carte virtuelle (UID aléatoire) et active le badge comme une vraie carte. */
export async function createSimulatedCard(establishmentId: string, badgeId: string) {
  assertSimulator();
  const badge = await prisma.badge.findFirst({
    where: { id: badgeId, student: { establishmentId } },
  });
  if (!badge || badge.kind !== 'NFC') throw notFound('Badge NFC introuvable.');
  if (badge.status !== 'PENDING_ACTIVATION') throw conflict('Ce badge a déjà une carte.');
  // UID de 7 octets commençant par 04 (fabricant NXP), comme une vraie puce.
  const uid = `04${randomBytes(6).toString('hex')}`.toUpperCase();
  const tap = simulateTap(nfcMetaKey(establishmentId), nfcMacKey(badge.id), uid, 0);
  await prisma.simulatedCard.create({ data: { badgeId: badge.id, uid, counter: 0 } });
  return activateNfcBadge(establishmentId, badge.id, formatNfcCode(tap.piccData, tap.mac));
}

/** « Pose » la carte virtuelle : le compteur augmente, un nouveau code est produit. */
export async function tapSimulatedCard(establishmentId: string, badgeId: string) {
  assertSimulator();
  const card = await prisma.simulatedCard.findFirst({
    where: { badgeId, badge: { student: { establishmentId } } },
  });
  if (!card) throw notFound('Carte simulée introuvable.');
  const updated = await prisma.simulatedCard.update({
    where: { badgeId },
    data: { counter: { increment: 1 } },
  });
  const tap = simulateTap(
    nfcMetaKey(establishmentId),
    nfcMacKey(badgeId),
    updated.uid,
    updated.counter,
  );
  return { code: formatNfcCode(tap.piccData, tap.mac), counter: updated.counter };
}
