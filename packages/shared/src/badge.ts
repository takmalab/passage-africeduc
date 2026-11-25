/**
 * Format des codes de badge transmis par le scanner au serveur.
 *
 * Aucun format ne contient l'identifiant de l'élève ni une donnée nominative.
 *
 * - Carte NFC sécurisée (NTAG 424 DNA, mode SUN) : `PSG1.N.<p>.<c>`
 *   À chaque lecture, la puce écrit dans son URL NDEF deux paramètres :
 *   `p` = 16 octets chiffrés (AES) contenant l'UID de la puce et un compteur
 *   de lectures, `c` = signature AES-CMAC tronquée (8 octets) calculée avec une
 *   clé propre à la carte. Le serveur seul détient les clés. Chaque compteur ne
 *   peut servir qu'une fois : une lecture recopiée est refusée (DECISIONS.md, D1).
 *
 * - Carte QR imprimée (option moins sûre) : `PSG1.S.<publicId>.<secret>`
 *   `secret` = 24 octets aléatoires en base64url ; le serveur n'en stocke que
 *   l'empreinte SHA-256. Ce code ne change jamais : il est désactivé par défaut.
 */

export const BADGE_PREFIX = 'PSG1';

const HEX32 = /^[0-9A-F]{32}$/;
const HEX16 = /^[0-9A-F]{16}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const PUBLIC_ID_LENGTH = 16; // 12 octets aléatoires en base64url
const SECRET_LENGTH = 32; // 24 octets en base64url

export type NfcBadgeCode = {
  kind: 'NFC';
  /** PICCData chiffrée, 32 caractères hexadécimaux majuscules. */
  piccData: string;
  /** SDMMAC tronqué, 16 caractères hexadécimaux majuscules. */
  mac: string;
};

export type PrintedBadgeCode = {
  kind: 'PRINTED';
  publicId: string;
  secret: string;
};

export type BadgeCode = NfcBadgeCode | PrintedBadgeCode;

export function formatNfcCode(piccData: string, mac: string): string {
  return `${BADGE_PREFIX}.N.${piccData.toUpperCase()}.${mac.toUpperCase()}`;
}

export function formatPrintedCode(publicId: string, secret: string): string {
  return `${BADGE_PREFIX}.S.${publicId}.${secret}`;
}

/**
 * Convertit l'URL lue sur la puce (ex. `https://passage.app/c?p=EF96...&c=94EE...`)
 * en code `PSG1.N...`. Renvoie null si les paramètres attendus manquent.
 */
export function nfcUrlToCode(url: string): string | null {
  const match = /[?&]p=([0-9A-Fa-f]{32})&c=([0-9A-Fa-f]{16})(?:&|$)/.exec(url);
  if (!match) return null;
  return formatNfcCode(match[1] as string, match[2] as string);
}

/**
 * Analyse le contenu brut transmis par le scanner. Renvoie `null` pour tout
 * contenu qui ne respecte pas strictement le format. Ne vérifie aucune
 * signature : c'est le rôle du serveur.
 */
export function parseBadgeCode(raw: string): BadgeCode | null {
  if (typeof raw !== 'string' || raw.length > 256) return null;
  const trimmed = raw.trim();

  // Le scanner peut aussi transmettre l'URL brute lue sur la puce.
  if (/^https?:\/\//i.test(trimmed)) {
    const code = nfcUrlToCode(trimmed);
    return code ? parseBadgeCode(code) : null;
  }

  const parts = trimmed.split('.');
  if (parts[0] !== BADGE_PREFIX) return null;

  if (parts[1] === 'N' && parts.length === 4) {
    const piccData = (parts[2] as string).toUpperCase();
    const mac = (parts[3] as string).toUpperCase();
    if (!HEX32.test(piccData) || !HEX16.test(mac)) return null;
    return { kind: 'NFC', piccData, mac };
  }

  if (parts[1] === 'S' && parts.length === 4) {
    const publicId = parts[2] as string;
    const secret = parts[3] as string;
    if (!isB64(publicId, PUBLIC_ID_LENGTH) || !isB64(secret, SECRET_LENGTH)) return null;
    return { kind: 'PRINTED', publicId, secret };
  }

  return null;
}

function isB64(value: string, length: number): boolean {
  return value.length === length && B64URL.test(value);
}
