import { env } from '../../config/env.js';
import { hmacSha256 } from '../../lib/crypto.js';

/**
 * Dérivation des clés à partir d'une clé maîtresse unique (BADGE_KEYS_MASTER_KEY).
 * Aucune clé de carte n'est stockée en base : une fuite de la base ne permet
 * pas de fabriquer une carte. Changer la clé maîtresse invalide toutes les cartes.
 *
 * - clé méta : une par établissement (déchiffre `p` pour retrouver l'UID) ;
 * - clé MAC : une par badge (vérifie la signature `c`) ;
 * - empreinte d'UID : HMAC, pour retrouver un badge sans stocker l'UID en clair.
 */

const master = (): Buffer => Buffer.from(env.BADGE_KEYS_MASTER_KEY, 'hex');

export function nfcMetaKey(establishmentId: string): Buffer {
  return hmacSha256(master(), `nfc-meta|${establishmentId}`).subarray(0, 16);
}

export function nfcMacKey(badgeId: string): Buffer {
  return hmacSha256(master(), `nfc-mac|${badgeId}`).subarray(0, 16);
}

export function uidHash(uidHex: string): string {
  return hmacSha256(master(), `nfc-uid|${uidHex.toUpperCase()}`).toString('hex');
}
