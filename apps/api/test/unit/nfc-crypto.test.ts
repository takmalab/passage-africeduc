import { describe, expect, it } from 'vitest';
import {
  aesCmac,
  computeSdmMac,
  decryptPiccData,
  simulateTap,
} from '../../src/modules/badges/nfc-crypto.js';

const hex = (s: string) => Buffer.from(s, 'hex');

describe('AES-CMAC (vecteurs officiels RFC 4493)', () => {
  const key = hex('2b7e151628aed2a6abf7158809cf4f3c');

  it('message vide', () => {
    expect(aesCmac(key, Buffer.alloc(0)).toString('hex')).toBe('bb1d6929e95937287fa37d129b756746');
  });

  it('message de 16 octets', () => {
    expect(aesCmac(key, hex('6bc1bee22e409f96e93d7e117393172a')).toString('hex')).toBe(
      '070a16b46b4d4144f79bdd9dd04a287c',
    );
  });
});

describe('NTAG 424 DNA SUN (vecteurs officiels NXP AN12196)', () => {
  const zeroKey = Buffer.alloc(16);

  it('déchiffre PICCData : UID et compteur', () => {
    expect(decryptPiccData(zeroKey, 'EF963FF7828658A599F3041510671E88')).toEqual({
      uid: '04DE5F1EACC040',
      counter: 0x3d,
    });
  });

  it('calcule le SDMMAC attendu', () => {
    expect(computeSdmMac(zeroKey, '04DE5F1EACC040', 0x3d)).toBe('94EED9EE65337086');
  });

  it('refuse une PICCData déchiffrée avec la mauvaise clé', () => {
    expect(decryptPiccData(Buffer.alloc(16, 1), 'EF963FF7828658A599F3041510671E88')).toBeNull();
  });
});

describe('simulateur de carte', () => {
  const metaKey = Buffer.alloc(16, 7);
  const macKey = Buffer.alloc(16, 9);
  const uid = '04A1B2C3D4E5F6';

  it('produit un code que le serveur sait relire et vérifier', () => {
    const tap = simulateTap(metaKey, macKey, uid, 42);
    expect(decryptPiccData(metaKey, tap.piccData)).toEqual({ uid, counter: 42 });
    expect(tap.mac).toBe(computeSdmMac(macKey, uid, 42));
  });

  it('change de code à chaque lecture', () => {
    const a = simulateTap(metaKey, macKey, uid, 1);
    const b = simulateTap(metaKey, macKey, uid, 2);
    expect(a.piccData).not.toBe(b.piccData);
    expect(a.mac).not.toBe(b.mac);
  });

  it('une autre clé MAC produit une autre signature (impossible de forger sans la clé)', () => {
    expect(computeSdmMac(Buffer.alloc(16, 8), uid, 42)).not.toBe(computeSdmMac(macKey, uid, 42));
  });
});
