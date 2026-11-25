import { parseBadgeCode, type RefusalReason } from '@passage/shared';
import { env } from '../../config/env.js';
import type { Badge, Tx } from '../../db/prisma.js';
import { safeEqual, sha256Hex } from '../../lib/crypto.js';
import { nfcMacKey, nfcMetaKey, uidHash } from './keys.js';
import { computeSdmMac, decryptPiccData } from './nfc-crypto.js';

export type VerificationResult =
  | { verdict: 'ACCEPTED'; badge: Badge; counter: number | null }
  | { verdict: 'REFUSED'; reason: RefusalReason; badge: Badge | null; counter: number | null };

type Context = {
  establishmentId: string;
  allowPrintedBadges: boolean;
  /** Heure retenue du passage (corrigée du décalage d'horloge). */
  effectiveTime: Date;
};

/**
 * Vérifie un code de badge. Doit être appelé dans une transaction : le verrou
 * par badge garantit que deux lots synchronisés en même temps ne peuvent pas
 * accepter le même compteur (la clé primaire de BadgeCodeUse le garantit aussi).
 */
export async function verifyBadgeCode(
  tx: Tx,
  rawCode: string,
  ctx: Context,
): Promise<VerificationResult> {
  const code = parseBadgeCode(rawCode);
  if (!code) return refused('MALFORMED_CODE');

  if (code.kind === 'PRINTED') {
    if (!ctx.allowPrintedBadges) return refused('PRINTED_BADGES_DISABLED');
    const badge = await tx.badge.findUnique({
      where: { publicId: code.publicId },
      include: { student: { select: { establishmentId: true } } },
    });
    if (!badge || badge.kind !== 'PRINTED' || badge.student.establishmentId !== ctx.establishmentId) {
      return refused('UNKNOWN_BADGE');
    }
    if (!badge.staticSecretHash || !safeEqual(sha256Hex(code.secret), badge.staticSecretHash)) {
      return refused('BAD_SIGNATURE', badge);
    }
    if (badge.status !== 'ACTIVE') return refused('BADGE_INACTIVE', badge);
    return { verdict: 'ACCEPTED', badge, counter: null };
  }

  // Carte NFC : la clé méta de l'établissement révèle l'UID et le compteur.
  const picc = decryptPiccData(nfcMetaKey(ctx.establishmentId), code.piccData);
  if (!picc) return refused('BAD_SIGNATURE');

  const badge = await tx.badge.findUnique({
    where: { uidHash: uidHash(picc.uid) },
    include: { student: { select: { establishmentId: true } } },
  });
  if (!badge || badge.student.establishmentId !== ctx.establishmentId) {
    return refused('UNKNOWN_BADGE');
  }

  const expected = computeSdmMac(nfcMacKey(badge.id), picc.uid, picc.counter);
  if (!safeEqual(expected, code.mac)) return refused('BAD_SIGNATURE', badge, picc.counter);
  if (badge.status !== 'ACTIVE') return refused('BADGE_INACTIVE', badge, picc.counter);

  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${badge.id}, 0))`;

  const reused = await tx.badgeCodeUse.findUnique({
    where: { badgeId_counter: { badgeId: badge.id, counter: picc.counter } },
  });
  if (reused) return refused('CODE_ALREADY_USED', badge, picc.counter);

  // Les compteurs doivent croître avec le temps. Un compteur plus petit qu'un
  // compteur déjà vu à une heure antérieure = lecture recopiée et rejouée.
  // La tolérance couvre les petits écarts d'horloge entre appareils.
  const toleranceMs = env.NFC_ORDER_TOLERANCE_MINUTES * 60_000;
  const newerEarlier = await tx.badgeCodeUse.findFirst({
    where: {
      badgeId: badge.id,
      counter: { gt: picc.counter },
      effectiveTime: { lt: new Date(ctx.effectiveTime.getTime() - toleranceMs) },
    },
    select: { counter: true },
  });
  if (newerEarlier) return refused('CODE_OUT_OF_ORDER', badge, picc.counter);

  return { verdict: 'ACCEPTED', badge, counter: picc.counter };
}

function refused(
  reason: RefusalReason,
  badge: Badge | null = null,
  counter: number | null = null,
): VerificationResult {
  return { verdict: 'REFUSED', reason, badge, counter };
}
