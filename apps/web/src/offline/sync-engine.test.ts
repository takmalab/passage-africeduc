import 'fake-indexeddb/auto';
import type { SyncResponse } from '@passage/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { PassageDb, type QueuedScan } from './db';
import { SyncEngine, type SendBatch } from './sync-engine';

const CHECKPOINT = '0190f0f0-0000-7000-8000-000000000001';

/** Faux serveur idempotent : garde ce qu'il a reçu, reconnaît les renvois. */
function fakeServer() {
  const received = new Map<string, QueuedScan>();
  const send: SendBatch = async ({ events }) => ({
    serverTime: Date.now(),
    clockOffsetMs: 0,
    acks: events.map((e) => {
      const duplicate = received.has(e.localEventId);
      received.set(e.localEventId, e);
      return {
        localEventId: e.localEventId,
        storage: duplicate ? 'duplicate' : 'created',
        verdict: 'ACCEPTED',
      };
    }),
  });
  return { received, send };
}

let store: PassageDb;
beforeEach(async () => {
  store = new PassageDb(`test-${Math.random()}`);
  await store.open();
});

describe('file de scans hors ligne', () => {
  it('garde 20 scans sans réseau puis les envoie tous', async () => {
    const offline: SendBatch = async () => {
      throw new TypeError('Failed to fetch');
    };
    const engineOffline = new SyncEngine(store, offline);
    for (let i = 0; i < 20; i++)
      await engineOffline.enqueue({ rawCode: `code-${i}`, checkpointId: CHECKPOINT }, 'Portail');
    await expect(engineOffline.flush()).rejects.toThrow();
    expect(await engineOffline.pendingCount()).toBe(20);

    const server = fakeServer();
    const engine = new SyncEngine(store, server.send);
    expect(await engine.flush()).toBe(20);
    expect(await engine.pendingCount()).toBe(0);
    expect(server.received.size).toBe(20);
  });

  it('coupure pendant l’envoi : le serveur a reçu, mais rien n’est retiré, puis renvoi sans doublon', async () => {
    const server = fakeServer();
    // Le serveur enregistre le lot, mais la réponse se perd (réseau coupé au retour).
    const lostResponse: SendBatch = async (body) => {
      await server.send(body);
      throw new TypeError('Network connection lost');
    };
    const broken = new SyncEngine(store, lostResponse);
    for (let i = 0; i < 20; i++)
      await broken.enqueue({ rawCode: `code-${i}`, checkpointId: CHECKPOINT }, 'Portail');
    await expect(broken.flush()).rejects.toThrow();
    expect(await broken.pendingCount()).toBe(20);

    let duplicates = 0;
    const engine = new SyncEngine(store, async (body): Promise<SyncResponse> => {
      const res = await server.send(body);
      duplicates += res.acks.filter((a) => a.storage === 'duplicate').length;
      return res;
    });
    await engine.flush();
    expect(await engine.pendingCount()).toBe(0);
    expect(server.received.size).toBe(20);
    expect(duplicates).toBe(20);
  });

  it('ne retire que les scans confirmés par le serveur', async () => {
    const engine = new SyncEngine(store, async ({ events }) => ({
      serverTime: 0,
      clockOffsetMs: 0,
      acks: events
        .slice(0, 1)
        .map((e) => ({
          localEventId: e.localEventId,
          storage: 'created' as const,
          verdict: 'ACCEPTED' as const,
        })),
    }));
    await engine.enqueue({ rawCode: 'a', checkpointId: CHECKPOINT }, 'Portail');
    await engine.enqueue({ rawCode: 'b', checkpointId: CHECKPOINT }, 'Portail');
    await engine.flush();
    expect(await engine.pendingCount()).toBe(0);
  });

  it('un seul envoi à la fois', async () => {
    let concurrent = 0;
    let max = 0;
    const server = fakeServer();
    const engine = new SyncEngine(store, async (body) => {
      concurrent++;
      max = Math.max(max, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return server.send(body);
    });
    await engine.enqueue({ rawCode: 'a', checkpointId: CHECKPOINT }, 'Portail');
    await Promise.all([engine.flush(), engine.flush(), engine.flush()]);
    expect(max).toBe(1);
  });

  it('enregistre le verdict et le motif de refus pour l’agent', async () => {
    const engine = new SyncEngine(store, async ({ events }) => ({
      serverTime: 0,
      clockOffsetMs: 0,
      acks: events.map((e) => ({
        localEventId: e.localEventId,
        storage: 'created' as const,
        verdict: 'REFUSED' as const,
        reason: 'CODE_ALREADY_USED' as const,
      })),
    }));
    const item = await engine.enqueue({ rawCode: 'a', checkpointId: CHECKPOINT }, 'Portail');
    await engine.flush();
    expect(await store.results.get(item.localEventId)).toMatchObject({
      status: 'refused',
      reason: 'CODE_ALREADY_USED',
    });
  });
});
