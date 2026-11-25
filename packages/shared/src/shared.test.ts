import { describe, expect, it } from 'vitest';
import {
  formatMinute,
  formatNfcCode,
  formatPrintedCode,
  localParts,
  nfcUrlToCode,
  parseBadgeCode,
  parseMinute,
  startOfLocalDayUtc,
} from './index.js';

const PUBLIC_ID = 'AbCdEfGhIjKlMnOp';
const SECRET = 's'.repeat(32);
// Vecteur officiel NXP AN12196 (PICCData chiffrée + SDMMAC)
const P = 'EF963FF7828658A599F3041510671E88';
const C = '94EED9EE65337086';

describe('format du badge', () => {
  it('relit un code de carte NFC', () => {
    expect(parseBadgeCode(formatNfcCode(P, C))).toEqual({ kind: 'NFC', piccData: P, mac: C });
  });

  it("convertit l'URL lue sur la puce en code", () => {
    const url = `https://passage.local/c?p=${P.toLowerCase()}&c=${C}`;
    expect(nfcUrlToCode(url)).toBe(`PSG1.N.${P}.${C}`);
    expect(parseBadgeCode(url)).toEqual({ kind: 'NFC', piccData: P, mac: C });
  });

  it('relit un code de carte QR imprimée', () => {
    expect(parseBadgeCode(formatPrintedCode(PUBLIC_ID, SECRET))).toEqual({
      kind: 'PRINTED',
      publicId: PUBLIC_ID,
      secret: SECRET,
    });
  });

  it.each([
    '',
    'hello',
    `PSG1.N.${P}`,
    `PSG1.N.${P.slice(2)}.${C}`,
    `PSG1.N.${P}.${C}.extra`,
    `PSG1.N.${P.replace('E', 'Z')}.${C}`,
    `PSG1.S.${PUBLIC_ID}.<script>`,
    `PSG2.S.${PUBLIC_ID}.${SECRET}`,
    'https://evil.example/?x=1',
  ])('refuse un contenu mal formé : %s', (raw) => {
    expect(parseBadgeCode(raw)).toBeNull();
  });
});

describe('heure locale (Africa/Douala, UTC+1)', () => {
  it('convertit un instant UTC en date, minute et jour locaux', () => {
    // 2026-11-25T06:10Z = 07:10 à Douala, un mercredi
    expect(localParts(new Date('2026-11-25T06:10:00Z'), 'Africa/Douala')).toEqual({
      dateKey: '2026-11-25',
      minuteOfDay: 430,
      isoWeekday: 3,
    });
  });

  it('change de jour à minuit local et non à minuit UTC', () => {
    expect(localParts(new Date('2026-11-25T23:30:00Z'), 'Africa/Douala').dateKey).toBe(
      '2026-11-26',
    );
  });

  it('retrouve minuit local en UTC', () => {
    expect(startOfLocalDayUtc('2026-11-25', 'Africa/Douala').toISOString()).toBe(
      '2026-11-24T23:00:00.000Z',
    );
  });

  it('formate et relit les minutes', () => {
    expect(formatMinute(435)).toBe('07:15');
    expect(parseMinute('07:15')).toBe(435);
    expect(parseMinute('24:00')).toBeNull();
  });
});
