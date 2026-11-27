import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { dateFromKey } from '../../src/modules/anomalies/anomalies.service.js';
import { runSchedulerTick } from '../../src/worker/scheduler.js';
import { localTime, loggedIn, seedWorld } from './helpers.js';

// Résolution d'une anomalie par le responsable : le motif est obligatoire,
// tracé, et réservé à l'école (jamais montré au parent). DECISIONS.md, D15.

const DAY = '2026-11-24'; // un mardi

/** Anomalie « passage manquant » d'Awa (élève de parent.a), créée par le programme de fond. */
async function awaMissed() {
  const w = await seedWorld();
  await runSchedulerTick(new Date(localTime(DAY, 9, 0)));
  const anomaly = await prisma.anomaly.findFirstOrThrow({
    // Le programme rattrape aussi la veille : on prend l'anomalie du jour DAY.
    where: { studentId: w.students[0]!.id, type: 'MISSED_CHECKPOINT', date: dateFromKey(DAY) },
  });
  return { w, anomaly };
}

describe("résolution d'une anomalie", () => {
  it('refuse « Résolue » sans motif (400), accepte « Vue » sans motif', async () => {
    const { anomaly } = await awaMissed();
    const manager = await loggedIn('responsable');
    const url = `/api/manager/anomalies/${anomaly.id}`;
    for (const body of [{ status: 'RESOLVED' }, { status: 'RESOLVED', note: '  ' }]) {
      expect((await manager.patch(url, body)).status).toBe(400);
    }
    expect((await prisma.anomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).status).toBe(
      'OPEN',
    );
    expect((await manager.patch(url, { status: 'ACKNOWLEDGED' })).status).toBe(204);
  });

  it("enregistre le motif, l'heure et l'auteur ; le responsable le relit plus tard", async () => {
    const { w, anomaly } = await awaMissed();
    const manager = await loggedIn('responsable');
    const note = 'Mère appelée : élève malade';
    const res = await manager.patch(`/api/manager/anomalies/${anomaly.id}`, {
      status: 'RESOLVED',
      note,
    });
    expect(res.status).toBe(204);

    const saved = await prisma.anomaly.findUniqueOrThrow({ where: { id: anomaly.id } });
    expect(saved).toMatchObject({ status: 'RESOLVED', resolutionNote: note });
    expect(saved.resolvedAt).not.toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'anomaly.status', targetId: anomaly.id },
    });
    expect(log.actorId).toBe(w.manager.id);
    expect(log.meta).toMatchObject({ status: 'RESOLVED', note });

    const list = await manager.get(`/api/manager/anomalies?date=${DAY}`);
    const listed = list.body.anomalies.find((a: { id: string }) => a.id === anomaly.id);
    expect(listed.resolutionNote).toBe(note);
  });

  it("le parent voit « Résolue » mais jamais le motif, réservé à l'école", async () => {
    const { w, anomaly } = await awaMissed();
    const manager = await loggedIn('responsable');
    const note = 'Problème familial signalé par la mère';
    await manager.patch(`/api/manager/anomalies/${anomaly.id}`, { status: 'RESOLVED', note });

    const parent = await loggedIn('parent.a');
    const res = await parent.get(`/api/parent/children/${w.students[0]!.id}`);
    expect(res.status).toBe(200);
    const seen = res.body.anomalies.find((a: { id: string }) => a.id === anomaly.id);
    expect(seen.status).toBe('RESOLVED');
    expect(JSON.stringify(res.body)).not.toContain(note);
    expect(seen).not.toHaveProperty('resolutionNote');
  });

  it("refuse un agent et un parent (403), un motif trop long ou un champ en trop (400), et l'anomalie d'une autre école (404)", async () => {
    const { anomaly } = await awaMissed();
    const other = await seedWorld('2');
    const url = `/api/manager/anomalies/${anomaly.id}`;
    for (const login of ['agent', 'parent.a']) {
      const c = await loggedIn(login);
      expect((await c.patch(url, { status: 'RESOLVED', note: 'Réglé' })).status).toBe(403);
    }
    const manager = await loggedIn('responsable');
    expect((await manager.patch(url, { status: 'RESOLVED', note: 'x'.repeat(201) })).status).toBe(
      400,
    );
    expect(
      (await manager.patch(url, { status: 'RESOLVED', note: 'Réglé', studentId: other.est.id }))
        .status,
    ).toBe(400);

    // Le responsable de l'autre école ne peut pas résoudre l'anomalie d'Awa.
    const otherManager = await loggedIn('responsable2');
    expect((await otherManager.patch(url, { status: 'RESOLVED', note: 'Réglé' })).status).toBe(404);
    expect((await prisma.anomaly.findUniqueOrThrow({ where: { id: anomaly.id } })).status).toBe(
      'OPEN',
    );
  });
});
