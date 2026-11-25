import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { ingestBatch } from '../../src/modules/sync/sync.service.js';
import { loggedIn, scanEvent, seedWorld, tap } from './helpers.js';

const TWO_HOURS = 2 * 3600_000;

async function twentyScans() {
  const w = await seedWorld();
  const now = Date.now();
  // 20 lectures : les 3 cartes passent plusieurs fois, compteurs différents.
  const events = Array.from({ length: 20 }, (_, i) => {
    const card = w.students[i % 3]!;
    return scanEvent(tap(card, i + 1), w.entry.id, now - (20 - i) * 90_000);
  });
  return { w, events, deviceId: randomUUID(), now };
}

describe('synchronisation hors ligne', () => {
  it('20 scans hors ligne donnent exactement 20 passages', async () => {
    const { events, deviceId } = await twentyScans();
    const c = await loggedIn('agent');
    const res = await c.post('/api/agent/sync', { deviceId, deviceSentAt: Date.now(), events });
    expect(res.status).toBe(200);
    expect(res.body.acks.filter((a: { storage: string }) => a.storage === 'created')).toHaveLength(20);
    expect(await prisma.passage.count()).toBe(20);
  });

  it('renvoyer le même lot ne crée aucun doublon', async () => {
    const { events, deviceId } = await twentyScans();
    const c = await loggedIn('agent');
    await c.post('/api/agent/sync', { deviceId, deviceSentAt: Date.now(), events });
    const again = await c.post('/api/agent/sync', { deviceId, deviceSentAt: Date.now(), events });
    expect(again.body.acks.every((a: { storage: string }) => a.storage === 'duplicate')).toBe(true);
    expect(await prisma.passage.count()).toBe(20);
  });

  it('une synchronisation interrompue puis reprise donne 20 passages, sans doublon', async () => {
    const { events, deviceId } = await twentyScans();
    const c = await loggedIn('agent');
    // Coupure : seuls 12 scans sont arrivés, le téléphone n'a pas reçu l'accusé.
    await c.post('/api/agent/sync', { deviceId, deviceSentAt: Date.now(), events: events.slice(0, 12) });
    // Au retour du réseau, il renvoie tout ce qui n'a pas été confirmé, donc les 20.
    const resumed = await c.post('/api/agent/sync', { deviceId, deviceSentAt: Date.now(), events });
    const storage = resumed.body.acks.map((a: { storage: string }) => a.storage);
    expect(storage.filter((s: string) => s === 'duplicate')).toHaveLength(12);
    expect(storage.filter((s: string) => s === 'created')).toHaveLength(8);
    expect(await prisma.passage.count()).toBe(20);
  });

  it('deux envois simultanés du même lot ne créent pas de doublon', async () => {
    const { w, events, deviceId } = await twentyScans();
    const agent = { id: w.agent.id, establishmentId: w.est.id };
    const batch = { deviceId, deviceSentAt: Date.now(), events };
    await Promise.all([ingestBatch(agent, batch), ingestBatch(agent, batch)]);
    expect(await prisma.passage.count()).toBe(20);
  });

  it("corrige l'heure d'un téléphone qui avance de 2 heures et le signale", async () => {
    const w = await seedWorld();
    const c = await loggedIn('agent');
    const realScanTime = Date.now() - 5 * 60_000;
    const res = await c.post('/api/agent/sync', {
      deviceId: randomUUID(),
      deviceSentAt: Date.now() + TWO_HOURS,
      events: [scanEvent(tap(w.students[0]!, 1), w.entry.id, realScanTime + TWO_HOURS)],
    });
    expect(res.body.acks[0].verdict).toBe('ACCEPTED');
    const passage = await prisma.passage.findFirstOrThrow();
    expect(passage.clockStatus).toBe('CORRECTED');
    expect(passage.deviceLocalTime.getTime()).toBe(realScanTime + TWO_HOURS);
    // L'heure retenue est la vraie heure du scan, à quelques secondes près.
    expect(Math.abs(passage.effectiveTime.getTime() - realScanTime)).toBeLessThan(5_000);
    expect(passage.clockOffsetMs).toBeLessThan(-TWO_HOURS + 5_000);
  });

  it('met de côté un passage dont l’heure reste impossible même corrigée', async () => {
    const w = await seedWorld();
    const c = await loggedIn('agent');
    const now = Date.now();
    const res = await c.post('/api/agent/sync', {
      deviceId: randomUUID(),
      deviceSentAt: now,
      // Scan daté de 5 jours plus tôt : au-delà de 72 h, on ne compte pas.
      events: [scanEvent(tap(w.students[0]!, 1), w.entry.id, now - 5 * 86_400_000)],
    });
    expect(res.body.acks[0]).toMatchObject({ verdict: 'REFUSED', reason: 'CLOCK_UNRELIABLE' });
    expect(await prisma.badgeCodeUse.count()).toBe(0);
  });

  it("refuse un appareil déjà enregistré dans un autre établissement", async () => {
    const w = await seedWorld();
    const other = await seedWorld('-b');
    const deviceId = randomUUID();
    await ingestBatch({ id: w.agent.id, establishmentId: w.est.id }, {
      deviceId,
      deviceSentAt: Date.now(),
      events: [scanEvent(tap(w.students[0]!, 1), w.entry.id, Date.now())],
    });
    await expect(
      ingestBatch({ id: other.agent.id, establishmentId: other.est.id }, {
        deviceId,
        deviceSentAt: Date.now(),
        events: [scanEvent(tap(other.students[0]!, 1), other.entry.id, Date.now())],
      }),
    ).rejects.toThrow();
  });
});
