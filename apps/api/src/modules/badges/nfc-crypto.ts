import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cryptographie des cartes NFC NTAG 424 DNA en mode SUN (Secure Unique NFC).
 *
 * Référence : NXP AN12196, sections 3.4 (PICCData chiffrée) et 3.4.4 (SDMMAC).
 * Les tests vérifient ce module contre les exemples officiels de NXP et
 * contre la RFC 4493 (AES-CMAC).
 *
 * À chaque lecture, la puce :
 *   1. incrémente son compteur SDMReadCtr (3 octets) ;
 *   2. chiffre PICCData = C7 || UID (7 octets) || compteur || aléa (5 octets)
 *      avec la clé « méta » (AES-128-CBC, IV nul) -> paramètre `p` ;
 *   3. dérive une clé de session à partir de la clé « MAC » de la carte, de
 *      l'UID et du compteur, puis calcule un CMAC tronqué -> paramètre `c`.
 * Sans la clé MAC de la carte, impossible de fabriquer un `c` valide.
 */

const BLOCK = 16;
const ZERO_IV = Buffer.alloc(BLOCK);
const PICC_TAG_UID_AND_COUNTER = 0xc7; // UID (7 octets) + compteur présents

function aesEcbEncryptBlock(key: Buffer, block: Buffer): Buffer {
  const cipher = createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function shiftLeft(block: Buffer): Buffer {
  const out = Buffer.alloc(BLOCK);
  let carry = 0;
  for (let i = BLOCK - 1; i >= 0; i--) {
    const byte = block[i] as number;
    out[i] = ((byte << 1) | carry) & 0xff;
    carry = byte >> 7;
  }
  if ((block[0] as number) & 0x80) out[BLOCK - 1] = (out[BLOCK - 1] as number) ^ 0x87;
  return out;
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] as number) ^ (b[i] as number);
  return out;
}

/** AES-CMAC (RFC 4493), clé de 16 octets, résultat de 16 octets. */
export function aesCmac(key: Buffer, message: Buffer): Buffer {
  const l = aesEcbEncryptBlock(key, Buffer.alloc(BLOCK));
  const k1 = shiftLeft(l);
  const k2 = shiftLeft(k1);

  const blockCount = Math.max(1, Math.ceil(message.length / BLOCK));
  const lastComplete = message.length > 0 && message.length % BLOCK === 0;

  let last: Buffer;
  const lastStart = (blockCount - 1) * BLOCK;
  if (lastComplete) {
    last = xor(message.subarray(lastStart, lastStart + BLOCK), k1);
  } else {
    const padded = Buffer.alloc(BLOCK);
    const rest = message.subarray(lastStart);
    rest.copy(padded);
    padded[rest.length] = 0x80;
    last = xor(padded, k2);
  }

  let x: Buffer = Buffer.alloc(BLOCK);
  for (let i = 0; i < blockCount - 1; i++) {
    x = aesEcbEncryptBlock(key, xor(x, message.subarray(i * BLOCK, (i + 1) * BLOCK)));
  }
  return aesEcbEncryptBlock(key, xor(x, last));
}

/** Troncature NXP : on garde les octets d'indice impair du CMAC (8 octets). */
function truncateMac(fullMac: Buffer): Buffer {
  const out = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) out[i] = fullMac[2 * i + 1] as number;
  return out;
}

export type PiccData = {
  /** UID de la puce, 14 caractères hexadécimaux majuscules. */
  uid: string;
  /** Compteur de lectures (SDMReadCtr). */
  counter: number;
};

/** Déchiffre `p` avec la clé méta. Renvoie null si le contenu n'a pas la forme attendue. */
export function decryptPiccData(metaKey: Buffer, piccHex: string): PiccData | null {
  const decipher = createDecipheriv('aes-128-cbc', metaKey, ZERO_IV);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(Buffer.from(piccHex, 'hex')), decipher.final()]);
  if (plain[0] !== PICC_TAG_UID_AND_COUNTER) return null;
  const uid = plain.subarray(1, 8).toString('hex').toUpperCase();
  const counter = plain.readUIntLE(8, 3);
  return { uid, counter };
}

/** Calcule le SDMMAC (16 caractères hexadécimaux) attendu pour un UID et un compteur. */
export function computeSdmMac(macKey: Buffer, uidHex: string, counter: number): string {
  const counterLe = Buffer.alloc(3);
  counterLe.writeUIntLE(counter, 0, 3);
  const sv2 = Buffer.concat([
    Buffer.from('3CC300010080', 'hex'),
    Buffer.from(uidHex, 'hex'),
    counterLe,
  ]);
  const sessionKey = aesCmac(macKey, sv2);
  return truncateMac(aesCmac(sessionKey, Buffer.alloc(0)))
    .toString('hex')
    .toUpperCase();
}

/**
 * Simule une lecture de puce : produit exactement ce qu'une NTAG 424 DNA
 * configurée avec ces clés écrirait dans son URL. Utilisé par le simulateur
 * de carte (démonstration sans matériel) et par les tests.
 */
export function simulateTap(
  metaKey: Buffer,
  macKey: Buffer,
  uidHex: string,
  counter: number,
  random: Buffer = randomBytes(5),
): { piccData: string; mac: string } {
  const plain = Buffer.alloc(BLOCK);
  plain[0] = PICC_TAG_UID_AND_COUNTER;
  Buffer.from(uidHex, 'hex').copy(plain, 1);
  plain.writeUIntLE(counter, 8, 3);
  random.subarray(0, 5).copy(plain, 11);
  const cipher = createCipheriv('aes-128-cbc', metaKey, ZERO_IV);
  cipher.setAutoPadding(false);
  const piccData = Buffer.concat([cipher.update(plain), cipher.final()])
    .toString('hex')
    .toUpperCase();
  return { piccData, mac: computeSdmMac(macKey, uidHex, counter) };
}
