import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { ingestBatch } from '../../src/modules/sync/sync.service.js';
import { loggedIn, scanEvent, seedWorld, tap } from './helpers.js';

type World = Awaited<ReturnType<typeof seedWorld>>;

function scanner(w: World) {
  const agent = { id: w.agent.id, establishmentId: w.est.id };
  const deviceId = randomUUID();
  return async (rawCode: string, time = Date.now(), device = deviceId) => {
    const res = await ingestBatch(agent, {
      deviceId: device,
      deviceSentAt: time,
      events: [scanEvent(rawCode, w.entry.id, time)],
    }, time + 1000);
    return res.acks[0]!;
  };
}

describe('carte NFC : résistance à la copie', () => {
  it('accepte la carte, puis refuse le même code présenté depuis un autre appareil', async () => {
    const w = await seedWorld();
    const scan = scanner(w);
    const code = tap(w.students[0]!, 7);

    expect(await scan(code)).toMatchObject({ verdict: 'ACCEPTED', studentFirstName: 'Awa' });
    const copy = await scan(code, Date.now() + 60_000, randomUUID());
    expect(copy).toMatchObject({ verdict: 'REFUSED', reason: 'CODE_ALREADY_USED' });

    const anomaly = await prisma.anomaly.findFirstOrThrow({ where: { type: 'BADGE_REPLAY' } });
    expect(anomaly.studentId).toBe(w.students[0]!.id);
    // Le parent est prévenu de la tentative.
    expect(await prisma.outboundMessage.count({ where: { anomalyId: anomaly.id } })).toBe(1);
  });

  it('refuse une lecture recopiée rejouée après un passage plus récent', async () => {
    const w = await seedWorld();
    const scan = scanner(w);
    const t0 = Date.now() - 30 * 60_000;
    const skimmed = tap(w.students[0]!, 5); // lue en cachette, jamais présentée
    expect((await scan(tap(w.students[0]!, 6), t0)).verdict).toBe('ACCEPTED');
    const replay = await scan(skimmed, t0 + 10 * 60_000);
    expect(replay).toMatchObject({ verdict: 'REFUSED', reason: 'CODE_OUT_OF_ORDER' });
  });

  it('accepte deux appareils hors ligne synchronisés dans le désordre', async () => {
    const w = await seedWorld();
    const scan = scanner(w);
    const t0 = Date.now() - 60 * 60_000;
    // Bus (appareil B) à 7 h 05 avec le compteur 6, synchronisé en premier ;
    // portail (appareil A) à 7 h 00 avec le compteur 5, synchronisé plus tard.
    expect((await scan(tap(w.students[0]!, 6), t0 + 5 * 60_000, randomUUID())).verdict).toBe('ACCEPTED');
    expect((await scan(tap(w.students[0]!, 5), t0, randomUUID())).verdict).toBe('ACCEPTED');
  });

  it('refuse une signature falsifiée', async () => {
    const w = await seedWorld();
    const scan = scanner(w);
    const forged = tap(w.students[0]!, 3).slice(0, -4) + '0000';
    expect(await scan(forged)).toMatchObject({ verdict: 'REFUSED', reason: 'BAD_SIGNATURE' });
  });

  it("refuse la carte d'un autre établissement", async () => {
    const w = await seedWorld();
    const other = await seedWorld('-b');
    const scan = scanner(w);
    expect((await scan(tap(other.students[0]!, 1))).verdict).toBe('REFUSED');
  });

  it('une réémission invalide immédiatement l’ancienne carte', async () => {
    const w = await seedWorld();
    const scan = scanner(w);
    const oldCard = w.students[0]!;
    expect((await scan(tap(oldCard, 1))).verdict).toBe('ACCEPTED');

    const c = await loggedIn('responsable');
    const res = await c.post(`/api/manager/students/${oldCard.id}/badges`, { kind: 'NFC', replaceReason: 'LOST' });
    expect(res.status).toBe(201);
    expect(res.body.nfcProgramming.macKey).toMatch(/^[0-9A-F]{32}$/);

    const refused = await scan(tap(oldCard, 2), Date.now() + 120_000);
    expect(refused).toMatchObject({ verdict: 'REFUSED', reason: 'BADGE_INACTIVE' });
    expect(await prisma.anomaly.count({ where: { type: 'INACTIVE_BADGE' } })).toBe(1);

    const badges = await prisma.badge.findMany({ where: { studentId: oldCard.id } });
    expect(badges.map((b) => b.status).sort()).toEqual(['LOST', 'PENDING_ACTIVATION']);
  });

  it("garantit en base un seul badge vivant par élève", async () => {
    const w = await seedWorld();
    await expect(
      prisma.badge.create({
        data: { publicId: 'Zz'.repeat(8), studentId: w.students[0]!.id, kind: 'NFC', status: 'PENDING_ACTIVATION' },
      }),
    ).rejects.toThrow();
  });

  it('le simulateur produit des codes acceptés une seule fois chacun', async () => {
    const w = await seedWorld();
    const student = await prisma.student.create({
      data: { firstName: 'Simu', lastName: 'Test', classroomId: w.classroom.id, establishmentId: w.est.id },
    });
    const c = await loggedIn('responsable');
    const issued = await c.post(`/api/manager/students/${student.id}/badges`, { kind: 'NFC' });
    const badgeId = issued.body.badge.id;
    expect((await c.post(`/api/manager/badges/${badgeId}/simulator`)).status).toBe(201);
    const first = await c.post(`/api/manager/badges/${badgeId}/simulator/tap`);
    const second = await c.post(`/api/manager/badges/${badgeId}/simulator/tap`);
    expect(first.body.code).not.toBe(second.body.code);

    const scan = scanner(w);
    expect((await scan(first.body.code)).verdict).toBe('ACCEPTED');
    expect((await scan(second.body.code, Date.now() + 1000)).verdict).toBe('ACCEPTED');
    expect((await scan(first.body.code, Date.now() + 2000)).verdict).toBe('REFUSED');
  });
});

describe('carte QR imprimée (mode optionnel)', () => {
  it("est refusée tant que l'établissement ne l'a pas autorisée", async () => {
    const w = await seedWorld();
    const c = await loggedIn('responsable');
    const res = await c.post(`/api/manager/students/${w.students[0]!.id}/badges`, {
      kind: 'PRINTED',
      replaceReason: 'REVOKED',
    });
    expect(res.status).toBe(403);
  });

  it("ne contient pas l'identifiant de l'élève et détecte une copie utilisée ailleurs", async () => {
    const w = await seedWorld();
    await prisma.establishment.update({ where: { id: w.est.id }, data: { allowPrintedBadges: true } });
    const c = await loggedIn('responsable');
    const student = w.students[2]!;
    const res = await c.post(`/api/manager/students/${student.id}/badges`, {
      kind: 'PRINTED',
      replaceReason: 'REVOKED',
    });
    const code: string = res.body.printedCode;
    expect(code).toMatch(/^PSG1\.S\./);
    expect(code).not.toContain(student.id);
    expect(code).not.toContain(student.firstName);

    const scan = scanner(w);
    expect((await scan(code)).verdict).toBe('ACCEPTED');
    // Photo du QR présentée sur un autre appareil deux minutes plus tard.
    await scan(code, Date.now() + 120_000, randomUUID());
    const clone = await prisma.anomaly.findFirstOrThrow({ where: { type: 'BADGE_REPLAY' } });
    expect(clone.details).toMatchObject({ suspectedClone: true });
  });
});
