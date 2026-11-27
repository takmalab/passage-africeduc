import { randomUUID } from 'node:crypto';
import { localParts } from '@passage/shared';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { dateFromKey } from '../../src/modules/anomalies/anomalies.service.js';
import { DAILY_CAP_REASON } from '../../src/modules/notifications/notifications.service.js';
import { ingestBatch } from '../../src/modules/sync/sync.service.js';
import { runSchedulerTick } from '../../src/worker/scheduler.js';
import { localTime, scanEvent, seedWorld, tap, TZ } from './helpers.js';

const DAY = '2026-11-24'; // un mardi
const after = (h: number, m: number) => new Date(localTime(DAY, h, m));

async function scanAt(
  w: Awaited<ReturnType<typeof seedWorld>>,
  studentIndex: number,
  checkpointId: string,
  time: number,
  counter: number,
) {
  return ingestBatch(
    { id: w.agent.id, establishmentId: w.est.id },
    {
      deviceId: randomUUID(),
      deviceSentAt: time,
      events: [scanEvent(tap(w.students[studentIndex]!, counter), checkpointId, time)],
    },
    time + 1000,
  );
}

describe('détection automatique du passage manquant', () => {
  it("crée l'anomalie à la clôture de la fenêtre, sans aucune requête utilisateur", async () => {
    const w = await seedWorld();
    await scanAt(w, 0, w.entry.id, localTime(DAY, 7, 10), 1); // Awa passe
    await scanAt(w, 1, w.entry.id, localTime(DAY, 7, 15), 1); // Kevin passe
    // Brenda ne passe pas. Avant la fin du délai de grâce : rien.
    const today = { type: 'MISSED_CHECKPOINT' as const, date: dateFromKey(DAY) };
    await runSchedulerTick(after(7, 45 + env.WINDOW_GRACE_MINUTES - 1));
    expect(await prisma.anomaly.count({ where: today })).toBe(0);

    // Après la fenêtre + délai de grâce : le programme de fond la détecte seul.
    await runSchedulerTick(after(7, 45 + env.WINDOW_GRACE_MINUTES));
    const missed = await prisma.anomaly.findMany({ where: today });
    expect(missed).toHaveLength(1);
    expect(missed[0]!.studentId).toBe(w.students[2]!.id);
  });

  it('est idempotente : relancer le programme ne crée pas de doublon', async () => {
    await seedWorld();
    const today = { date: dateFromKey(DAY) };
    await runSchedulerTick(after(9, 0));
    const first = await prisma.anomaly.count({ where: today });
    await runSchedulerTick(after(9, 1));
    await runSchedulerTick(after(9, 2));
    expect(first).toBe(3);
    expect(await prisma.anomaly.count({ where: today })).toBe(3);
  });

  it('prépare un message neutre pour le parent, envoyé par le programme de fond', async () => {
    const w = await seedWorld();
    await runSchedulerTick(after(9, 0));
    const messages = await prisma.outboundMessage.findMany({
      where: { parentId: w.parentA.id, dayKey: dateFromKey(DAY) },
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.status).toBe('SENT');
    expect(messages[0]!.body).toContain('Awa');
    expect(messages[0]!.body).not.toContain('Test'); // pas de nom de famille
    expect(messages[0]!.body).toContain('07:00');
  });

  it('rattrape la veille si le serveur était arrêté', async () => {
    await seedWorld();
    // Le serveur redémarre le lendemain à 6 h : la veille est évaluée (entrée et sortie).
    await runSchedulerTick(new Date(localTime('2026-11-25', 6, 0)));
    const missed = await prisma.anomaly.findMany({ where: { date: dateFromKey(DAY) } });
    expect(missed).toHaveLength(6);
  });

  it("n'alerte pas un jour férié ni pour une absence justifiée", async () => {
    const w = await seedWorld();
    await prisma.dayException.create({
      data: {
        establishmentId: w.est.id,
        studentId: w.students[0]!.id,
        date: dateFromKey(DAY),
        type: 'JUSTIFIED_ABSENCE',
        createdById: w.manager.id,
      },
    });
    await runSchedulerTick(after(9, 0));
    expect(
      await prisma.anomaly.count({
        where: { studentId: w.students[0]!.id, date: dateFromKey(DAY) },
      }),
    ).toBe(0);

    await prisma.anomaly.deleteMany();
    await prisma.dayException.create({
      data: {
        establishmentId: w.est.id,
        date: dateFromKey('2026-11-26'),
        type: 'HOLIDAY',
        createdById: w.manager.id,
      },
    });
    await runSchedulerTick(new Date(localTime('2026-11-26', 18, 0)));
    expect(await prisma.anomaly.count({ where: { date: dateFromKey('2026-11-26') } })).toBe(0);
  });

  it('clôt automatiquement l’anomalie quand le scan hors ligne arrive en retard, et rectifie', async () => {
    const w = await seedWorld();
    await runSchedulerTick(after(9, 0));
    const missed = await prisma.anomaly.findFirstOrThrow({
      where: { studentId: w.students[0]!.id, date: dateFromKey(DAY), routeStep: { position: 1 } },
    });

    // L'agent avait scanné Awa à 7 h 10 hors ligne, il synchronise à 9 h 30.
    await ingestBatch(
      { id: w.agent.id, establishmentId: w.est.id },
      {
        deviceId: randomUUID(),
        deviceSentAt: localTime(DAY, 9, 30),
        events: [scanEvent(tap(w.students[0]!, 1), w.entry.id, localTime(DAY, 7, 10))],
      },
      localTime(DAY, 9, 30),
    );
    const after2 = await prisma.anomaly.findUniqueOrThrow({ where: { id: missed.id } });
    expect(after2.status).toBe('AUTO_RESOLVED');
    const correction = await prisma.outboundMessage.findFirst({
      where: { anomalyId: missed.id, kind: 'CORRECTION' },
    });
    expect(correction?.body).toContain('Rectification');
  });
});

describe('anomalies à la réception du passage', () => {
  it('validation hors fenêtre (retard) sans double alerte « manquant »', async () => {
    const w = await seedWorld();
    await scanAt(w, 0, w.entry.id, localTime(DAY, 7, 58), 1);
    const oow = await prisma.anomaly.findFirstOrThrow({ where: { type: 'OUT_OF_WINDOW' } });
    expect(oow.details).toMatchObject({ direction: 'LATE', minute: 478 });
    await runSchedulerTick(after(9, 0));
    expect(
      await prisma.anomaly.count({
        where: {
          studentId: w.students[0]!.id,
          type: 'MISSED_CHECKPOINT',
          date: dateFromKey(DAY),
          routeStep: { position: 1 },
        },
      }),
    ).toBe(0);
  });

  it("point absent de l'itinéraire", async () => {
    const w = await seedWorld();
    await scanAt(w, 0, w.bus.id, localTime(DAY, 6, 40), 1);
    expect(await prisma.anomaly.count({ where: { type: 'UNEXPECTED_CHECKPOINT' } })).toBe(1);
  });

  it('double scan en moins de 60 secondes', async () => {
    const w = await seedWorld();
    await scanAt(w, 0, w.entry.id, localTime(DAY, 7, 10), 1);
    await scanAt(w, 0, w.entry.id, localTime(DAY, 7, 10) + 20_000, 2);
    expect(await prisma.anomaly.count({ where: { type: 'DOUBLE_SCAN' } })).toBe(1);
  });

  it("calcule la fenêtre en heure de l'établissement, pas en UTC", async () => {
    const w = await seedWorld();
    // 06:20 UTC = 07:20 à Douala : dans la fenêtre 07:00-07:45.
    await scanAt(w, 0, w.entry.id, Date.parse(`${DAY}T06:20:00Z`), 1);
    expect(localParts(new Date(`${DAY}T06:20:00Z`), TZ).minuteOfDay).toBe(440);
    expect(await prisma.anomaly.count()).toBe(0);
  });
});

describe('plafond de messages par élève et par jour', () => {
  it('au-delà du plafond, le message est conservé mais non envoyé, avec son motif', async () => {
    const w = await seedWorld();
    // 4 passages hors fenêtre pour Awa le même jour.
    for (let i = 0; i < env.NOTIFY_MAX_PER_STUDENT_PER_DAY + 1; i++) {
      await scanAt(w, 0, w.entry.id, localTime(DAY, 9, i * 5), i + 1);
    }
    const messages = await prisma.outboundMessage.findMany({
      where: { parentId: w.parentA.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(messages).toHaveLength(env.NOTIFY_MAX_PER_STUDENT_PER_DAY + 1);
    expect(messages.filter((m) => m.status === 'PENDING')).toHaveLength(
      env.NOTIFY_MAX_PER_STUDENT_PER_DAY,
    );
    const last = messages.at(-1)!;
    expect(last.status).toBe('SUPPRESSED');
    expect(last.suppressionReason).toBe(DAILY_CAP_REASON);
    // L'anomalie, elle, est bien enregistrée.
    expect(await prisma.anomaly.count({ where: { studentId: w.students[0]!.id } })).toBe(
      env.NOTIFY_MAX_PER_STUDENT_PER_DAY + 1,
    );
  });
});

describe('sortie anticipée autorisée : seule la sortie est excusée (D18)', () => {
  async function earlyExit(w: Awaited<ReturnType<typeof seedWorld>>) {
    await prisma.dayException.create({
      data: {
        establishmentId: w.est.id,
        studentId: w.students[0]!.id,
        date: dateFromKey(DAY),
        type: 'EARLY_EXIT_AUTHORIZED',
        createdById: w.manager.id,
      },
    });
  }
  const awaAnomalies = (w: Awaited<ReturnType<typeof seedWorld>>, position: number) =>
    prisma.anomaly.findMany({
      where: { studentId: w.students[0]!.id, date: dateFromKey(DAY), routeStep: { position } },
    });

  it("le matin compte toujours ; l'absence de sortie est excusée", async () => {
    const w = await seedWorld();
    await earlyExit(w);
    // Awa ne passe ni à l'entrée ni à la sortie.
    await runSchedulerTick(new Date(localTime(DAY, 18, 0)));
    const entry = await awaAnomalies(w, 1);
    expect(entry.map((a) => a.type)).toEqual(['MISSED_CHECKPOINT']);
    expect(await awaAnomalies(w, 2)).toHaveLength(0);
  });

  it('retard le matin signalé ; sortie avant la plage excusée ; sortie après la plage signalée', async () => {
    const w = await seedWorld();
    await earlyExit(w);
    await scanAt(w, 0, w.entry.id, localTime(DAY, 7, 58), 1); // retard à l'entrée
    expect((await awaAnomalies(w, 1)).map((a) => a.type)).toEqual(['OUT_OF_WINDOW']);

    await scanAt(w, 0, w.exit.id, localTime(DAY, 11, 0), 2); // sortie anticipée
    expect(await awaAnomalies(w, 2)).toHaveLength(0);

    await scanAt(w, 0, w.exit.id, localTime(DAY, 23, 0), 3); // passage tardif
    const late = await awaAnomalies(w, 2);
    expect(late.map((a) => a.type)).toEqual(['OUT_OF_WINDOW']);
    expect(late[0]!.details).toMatchObject({ direction: 'LATE' });
  });
});
