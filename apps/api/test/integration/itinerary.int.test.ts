import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { dateFromKey } from '../../src/modules/anomalies/anomalies.service.js';
import { ingestBatch } from '../../src/modules/sync/sync.service.js';
import { runSchedulerTick } from '../../src/worker/scheduler.js';
import { localTime, loggedIn, scanEvent, seedWorld, tap } from './helpers.js';

// Itinéraire défini une fois par l'établissement et recopié sur chaque élève (D14).

const DAY = '2026-11-24'; // un mardi
const WEEKDAYS = [1, 2, 3, 4, 5];
type World = Awaited<ReturnType<typeof seedWorld>>;

/** Itinéraire de l'école : autobus, portail d'entrée, portail de sortie. */
const schoolRoute = (w: World) => [
  { checkpointId: w.bus.id, start: '06:15', end: '06:45', days: WEEKDAYS },
  { checkpointId: w.entry.id, start: '07:00', end: '07:45', days: WEEKDAYS },
  { checkpointId: w.exit.id, start: '15:30', end: '16:15', days: WEEKDAYS },
];

async function scanAt(w: World, studentIndex: number, checkpointId: string, time: number) {
  return ingestBatch(
    { id: w.agent.id, establishmentId: w.est.id },
    {
      deviceId: randomUUID(),
      deviceSentAt: time,
      events: [scanEvent(tap(w.students[studentIndex]!, 1), checkpointId, time)],
    },
    time + 1000,
  );
}

const stepsOf = (studentId: string) =>
  prisma.routeStep.findMany({
    where: { route: { studentId } },
    orderBy: { position: 'asc' },
    include: { checkpoint: { select: { label: true } } },
  });

describe("itinéraire de l'établissement", () => {
  it('le responsable le saisit une fois : il est appliqué à tous les élèves, dans l’ordre', async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    const res = await manager.put('/api/manager/route', { steps: schoolRoute(w) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ steps: 3, students: 3 });

    for (const student of w.students) {
      const steps = await stepsOf(student.id);
      expect(steps.map((s) => s.checkpoint.label)).toEqual([
        'Bus',
        'Portail entrée',
        'Portail sortie',
      ]);
      expect(steps.map((s) => [s.startMinute, s.endMinute])).toEqual([
        [375, 405],
        [420, 465],
        [930, 975],
      ]);
    }
    const read = await manager.get('/api/manager/route');
    expect(
      read.body.steps.map((s: { start: string; end: string }) => `${s.start}-${s.end}`),
    ).toEqual(['06:15-06:45', '07:00-07:45', '15:30-16:15']);
  });

  it("un nouvel élève reçoit automatiquement l'itinéraire de l'établissement", async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    await manager.put('/api/manager/route', { steps: schoolRoute(w) });
    const created = await manager.post('/api/manager/students', {
      firstName: 'Nouvel',
      lastName: 'Élève',
      classroomId: w.classroom.id,
    });
    expect(created.status).toBe(201);
    expect((await stepsOf(created.body.student.id)).map((s) => s.checkpoint.label)).toEqual([
      'Bus',
      'Portail entrée',
      'Portail sortie',
    ]);
  });

  it("« Ne prend pas le bus » retire l'étape bus de son itinéraire ; s'il badge au bus, c'est « point absent de l'itinéraire »", async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    await manager.put('/api/manager/route', { steps: schoolRoute(w) });
    const awa = w.students[0]!;
    const res = await manager.patch(`/api/manager/students/${awa.id}`, { takesBus: false });
    expect(res.status).toBe(200);
    expect((await stepsOf(awa.id)).map((s) => s.checkpoint.label)).toEqual([
      'Portail entrée',
      'Portail sortie',
    ]);

    // Awa (sans bus) badge au bus : anomalie. Kevin (avec bus) dans la plage : aucune.
    await scanAt(w, 0, w.bus.id, localTime(DAY, 6, 30));
    await scanAt(w, 1, w.bus.id, localTime(DAY, 6, 30));
    const unexpected = await prisma.anomaly.findMany({ where: { type: 'UNEXPECTED_CHECKPOINT' } });
    expect(unexpected.map((a) => a.studentId)).toEqual([awa.id]);

    // Retour en arrière : l'étape bus revient.
    await manager.patch(`/api/manager/students/${awa.id}`, { takesBus: true });
    expect(await stepsOf(awa.id)).toHaveLength(3);
  });

  it('une modification met les étapes à jour sur place : pas de seconde alerte « passage manquant »', async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    await manager.put('/api/manager/route', { steps: schoolRoute(w) });
    const entryBefore = (await stepsOf(w.students[0]!.id)).find(
      (s) => s.checkpointId === w.entry.id,
    )!;

    // Personne n'est passé : le programme de fond signale bus et entrée manquants (3 élèves x 2).
    const day = { type: 'MISSED_CHECKPOINT' as const, date: dateFromKey(DAY) };
    await runSchedulerTick(new Date(localTime(DAY, 8, 30)));
    expect(await prisma.anomaly.count({ where: day })).toBe(6);

    // Le responsable change l'horaire de sortie dans la journée.
    const changed = schoolRoute(w).map((s) =>
      s.checkpointId === w.exit.id ? { ...s, start: '15:00', end: '16:00' } : s,
    );
    expect((await manager.put('/api/manager/route', { steps: changed })).status).toBe(200);
    const entryAfter = (await stepsOf(w.students[0]!.id)).find(
      (s) => s.checkpointId === w.entry.id,
    )!;
    expect(entryAfter.id).toBe(entryBefore.id); // même étape, mise à jour sur place

    await runSchedulerTick(new Date(localTime(DAY, 8, 31)));
    expect(await prisma.anomaly.count({ where: day })).toBe(6); // aucune alerte en double
  });

  it('refuse un agent et un parent (403), et un itinéraire invalide (400)', async () => {
    const w = await seedWorld();
    const other = await seedWorld('2');
    for (const login of ['agent', 'parent.a']) {
      const c = await loggedIn(login);
      expect((await c.get('/api/manager/route')).status).toBe(403);
      expect((await c.put('/api/manager/route', { steps: schoolRoute(w) })).status).toBe(403);
      expect(
        (await c.patch(`/api/manager/students/${w.students[0]!.id}`, { takesBus: false })).status,
      ).toBe(403);
    }
    const manager = await loggedIn('responsable');
    const [bus, entry] = schoolRoute(w);
    const invalid = [
      { steps: [] }, // aucune étape
      { steps: [{ ...entry, checkpointId: other.entry.id }] }, // point d'une autre école
      { steps: [entry, { ...entry }] }, // même point deux fois
      { steps: [{ ...bus, start: '07:00', end: '06:00' }] }, // début après la fin
      { steps: [{ ...bus, days: [0] }] }, // jour inexistant
      { steps: [bus], establishmentId: other.est.id }, // champ en trop
    ];
    for (const body of invalid) {
      expect((await manager.put('/api/manager/route', body)).status).toBe(400);
    }
    // Élève d'une autre école : 404, et rien ne change.
    const foreign = await manager.patch(`/api/manager/students/${other.students[0]!.id}`, {
      takesBus: false,
    });
    expect(foreign.status).toBe(404);
    const unchanged = await prisma.student.findUniqueOrThrow({
      where: { id: other.students[0]!.id },
    });
    expect(unchanged.takesBus).toBe(true);
  });
});

describe("plages affichées sur le téléphone de l'agent", () => {
  it("chaque point est livré avec sa plage, le fuseau de l'école et l'heure du serveur", async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    // Itinéraire sans bus : le point « Bus » n'a pas de plage.
    await manager.put('/api/manager/route', { steps: schoolRoute(w).slice(1) });

    const agent = await loggedIn('agent');
    const before = Date.now();
    const res = await agent.get('/api/agent/checkpoints');
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('Africa/Douala');
    expect(res.body.serverTime).toBeGreaterThanOrEqual(before);
    const byLabel = Object.fromEntries(
      res.body.checkpoints.map((c: { label: string; window: unknown }) => [c.label, c.window]),
    );
    expect(byLabel['Portail entrée']).toEqual({ startMinute: 420, endMinute: 465, days: WEEKDAYS });
    expect(byLabel['Portail sortie']).toEqual({ startMinute: 930, endMinute: 975, days: WEEKDAYS });
    expect(byLabel['Bus']).toBeNull();
  });
});
