import { startOfLocalDayUtc } from '@passage/shared';
import { describe, expect, it } from 'vitest';
import { windowStatus } from './window-status';

const TZ = 'Africa/Douala';
const DAY = '2026-11-24'; // un mardi
const at = (h: number, m: number, s = 0) =>
  startOfLocalDayUtc(DAY, TZ).getTime() + ((h * 60 + m) * 60 + s) * 1000;
const entry = { startMinute: 420, endMinute: 465, days: [1, 2, 3, 4, 5] }; // 07:00-07:45

describe("état de la plage affichée à l'agent", () => {
  it('avant la plage : temps restant avant ouverture', () => {
    expect(windowStatus(at(6, 50), TZ, entry)).toEqual({ state: 'before', seconds: 600 });
  });

  it('pendant la plage : compte à rebours jusqu’à la fermeture, à la seconde', () => {
    expect(windowStatus(at(7, 0), TZ, entry)).toEqual({ state: 'open', seconds: 46 * 60 });
    // 07:45:30 est encore dans la plage (le serveur compte la minute 07:45 entière).
    expect(windowStatus(at(7, 45, 30), TZ, entry)).toEqual({ state: 'open', seconds: 30 });
  });

  it('après la plage : terminée', () => {
    expect(windowStatus(at(7, 46), TZ, entry)).toEqual({ state: 'closed' });
  });

  it('jour non couvert, ou point sans plage', () => {
    expect(windowStatus(at(7, 10), TZ, { ...entry, days: [1, 3, 5] })).toEqual({
      state: 'not-today',
    });
    expect(windowStatus(at(7, 10), TZ, null)).toEqual({ state: 'none' });
  });
});
