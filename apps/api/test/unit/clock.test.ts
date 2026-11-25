import { describe, expect, it } from 'vitest';
import { assessClock } from '../../src/modules/sync/clock.js';

const policy = { skewFlagSeconds: 120, maxAgeHours: 72 };
const NOW = Date.parse('2026-11-25T09:00:00Z');
const H = 3600_000;

describe("correction de l'horloge de l'appareil", () => {
  it('horloge juste : aucune correction signalée', () => {
    const r = assessClock(NOW - 60_000, NOW - 500, NOW, policy);
    expect(r.status).toBe('OK');
    expect(r.effectiveTime.getTime()).toBe(NOW - 60_000 + 500);
  });

  it('téléphone en avance de 2 h : heure corrigée et signalée', () => {
    const r = assessClock(NOW - 10 * 60_000 + 2 * H, NOW + 2 * H, NOW, policy);
    expect(r.status).toBe('CORRECTED');
    expect(r.offsetMs).toBe(-2 * H);
    expect(r.effectiveTime.getTime()).toBe(NOW - 10 * 60_000);
  });

  it('téléphone en retard de 3 h : même correction', () => {
    const r = assessClock(NOW - 3 * H - 5 * 60_000, NOW - 3 * H, NOW, policy);
    expect(r.status).toBe('CORRECTED');
    expect(r.effectiveTime.getTime()).toBe(NOW - 5 * 60_000);
  });

  it('scan dans le futur après correction : mis de côté', () => {
    expect(assessClock(NOW + 10 * 60_000, NOW, NOW, policy).status).toBe('UNRELIABLE');
  });

  it('scan plus ancien que 72 h : mis de côté', () => {
    expect(assessClock(NOW - 73 * H, NOW, NOW, policy).status).toBe('UNRELIABLE');
  });

  it('scan hors ligne de la veille, horloge juste : accepté', () => {
    expect(assessClock(NOW - 20 * H, NOW, NOW, policy).status).toBe('OK');
  });
});
