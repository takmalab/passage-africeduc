import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { dateFromKey } from '../../src/modules/anomalies/anomalies.service.js';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/modules/summary/llm.js';
import { setLlmClient } from '../../src/modules/summary/llm.js';
import { generateSummary } from '../../src/modules/summary/summary.service.js';
import { ingestBatch } from '../../src/modules/sync/sync.service.js';
import { runSchedulerTick } from '../../src/worker/scheduler.js';
import { localTime, scanEvent, seedWorld, tap } from './helpers.js';

const DAY = '2026-11-24';

/** Faux modèle : renvoie les réponses prévues dans l'ordre et compte les appels. */
class FakeLlm implements LlmClient {
  readonly model = 'faux-modele';
  calls = 0;
  constructor(private readonly replies: (string | Error)[]) {}
  async complete(_req: LlmRequest): Promise<LlmResponse> {
    const reply = this.replies[Math.min(this.calls, this.replies.length - 1)]!;
    this.calls++;
    if (reply instanceof Error) throw reply;
    return { content: reply, inputTokens: 400, outputTokens: 60 };
  }
}

const GOOD = JSON.stringify({
  template:
    'Classe : {present} présent(s) sur {enrolled}, {late} retard(s), {outOfWindow} passage(s) hors plage ({outOfWindowTimes}) et {missed} passage(s) manquant(s).',
});
const INVENTS_NUMBER = JSON.stringify({
  template:
    'Classe : 19 présents sur {enrolled}, {late} retard(s), {outOfWindow} hors plage, {missed} manquant(s), {present}.',
});

/** Journée type : Awa et Kevin à l'heure, Brenda en retard, Kevin sort à 14 h 10, Awa ne sort pas. */
async function day() {
  const w = await seedWorld();
  const scan = (i: number, cp: string, h: number, m: number, counter: number) =>
    ingestBatch(
      { id: w.agent.id, establishmentId: w.est.id },
      {
        deviceId: randomUUID(),
        deviceSentAt: localTime(DAY, h, m),
        events: [scanEvent(tap(w.students[i]!, counter), cp, localTime(DAY, h, m))],
      },
      localTime(DAY, h, m) + 1000,
    );
  await scan(0, w.entry.id, 7, 5, 1);
  await scan(1, w.entry.id, 7, 10, 1);
  await scan(2, w.entry.id, 7, 58, 1);
  await scan(1, w.exit.id, 14, 10, 2);
  await scan(2, w.exit.id, 15, 40, 2);
  await runSchedulerTick(new Date(localTime(DAY, 23, 0)));
  return w;
}

/** Comptage indépendant, directement en SQL, pour vérifier la synthèse. */
async function independentCounts(classroomId: string) {
  const [present] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT p."studentId") AS n FROM "Passage" p
    JOIN "Student" s ON s.id = p."studentId"
    WHERE s."classroomId" = ${classroomId}::uuid AND p.verdict = 'ACCEPTED'
      AND (p."effectiveTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Douala')::date = ${DAY}::date`;
  const [enrolled] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*) AS n FROM "Student" WHERE "classroomId" = ${classroomId}::uuid AND status = 'ACTIVE'`;
  const missed = await prisma.anomaly.count({
    where: { type: 'MISSED_CHECKPOINT', date: dateFromKey(DAY), status: { not: 'AUTO_RESOLVED' } },
  });
  return { present: Number(present!.n), enrolled: Number(enrolled!.n), missed };
}

const numbersIn = (text: string) =>
  (text.match(/\d{1,2}:\d{2}|\d+/g) ?? []).filter((n) => !n.includes(':'));

describe('synthèse IA : aucune donnée inventée', () => {
  it('les chiffres de la synthèse sont exactement ceux de la base (modèle valide)', async () => {
    const w = await day();
    const llm = new FakeLlm([GOOD]);
    setLlmClient(llm);
    const s = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    expect(s.origin).toBe('MODEL');

    const db = await independentCounts(w.classroom.id);
    expect(s.facts).toMatchObject({
      present: db.present,
      enrolled: db.enrolled,
      late: 1,
      outOfWindow: 1,
      missed: db.missed,
    });
    expect(s.facts.outOfWindowTimes).toEqual(['14:10']);
    // Chaque nombre affiché provient des chiffres calculés, dans l'ordre du gabarit.
    expect(numbersIn(s.text)).toEqual([db.present, db.enrolled, 1, 1, db.missed].map(String));
    expect(s.text).toContain('14:10');
  });

  it('rejette une sortie qui écrit un chiffre, refait un seul essai, et le trace', async () => {
    const w = await day();
    const llm = new FakeLlm([INVENTS_NUMBER, GOOD]);
    setLlmClient(llm);
    const s = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    expect(s.origin).toBe('MODEL_AFTER_RETRY');
    expect(s.text).not.toContain('19');
    expect(llm.calls).toBe(2);
    const calls = await prisma.aiCall.findMany({ orderBy: { attempt: 'asc' } });
    expect(calls.map((c) => c.status)).toEqual(['INVALID_OUTPUT', 'SUCCESS']);
  });

  it('bascule sur le gabarit après deux sorties invalides', async () => {
    const w = await day();
    const llm = new FakeLlm(['pas du JSON', INVENTS_NUMBER]);
    setLlmClient(llm);
    const s = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    expect(s).toMatchObject({ origin: 'TEMPLATE', fallbackReason: 'INVALID_OUTPUT' });
    expect(llm.calls).toBe(2);
  });
});

describe('synthèse IA : mode dégradé, coût, cache', () => {
  it('sans clé, renvoie une synthèse exacte par gabarit sans planter', async () => {
    const w = await day();
    setLlmClient(null);
    const s = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    expect(s).toMatchObject({ origin: 'TEMPLATE', fallbackReason: 'NO_API_KEY' });
    const db = await independentCounts(w.classroom.id);
    expect(s.text).toContain(`${db.present} élève(s) présent(s) sur ${db.enrolled}`);
    expect(s.text).toContain('14:10');
    expect(await prisma.aiCall.count()).toBe(0);
  });

  it('modèle en panne : gabarit, et l’erreur est journalisée', async () => {
    const w = await day();
    setLlmClient(new FakeLlm([new Error('503')]));
    const s = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    expect(s).toMatchObject({ origin: 'TEMPLATE', fallbackReason: 'PROVIDER_ERROR' });
    expect(await prisma.aiCall.count({ where: { status: 'PROVIDER_ERROR' } })).toBe(2);
  });

  it('journalise le coût estimé de chaque appel', async () => {
    const w = await day();
    setLlmClient(new FakeLlm([GOOD]));
    await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    const call = await prisma.aiCall.findFirstOrThrow();
    const expected = (400 * env.AI_PRICE_INPUT_PER_MTOK + 60 * env.AI_PRICE_OUTPUT_PER_MTOK) / 1e6;
    expect(Number(call.estimatedCostUsd)).toBeCloseTo(expected, 6);
    expect(call).toMatchObject({ inputTokens: 400, outputTokens: 60, model: 'faux-modele' });
  });

  it('deux demandes identiques ne sont pas facturées deux fois (cache)', async () => {
    const w = await day();
    const llm = new FakeLlm([GOOD]);
    setLlmClient(llm);
    const a = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    const b = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
    expect(llm.calls).toBe(1);
    expect(b).toMatchObject({ fromCache: true, text: a.text });
    const hit = await prisma.aiCall.findFirstOrThrow({ where: { status: 'CACHE_HIT' } });
    expect(Number(hit.estimatedCostUsd)).toBe(0);
  });

  it("bloque l'appel au-delà du budget du jour, avec un message clair", async () => {
    const w = await day();
    const llm = new FakeLlm([GOOD]);
    setLlmClient(llm);
    const budget = env.AI_DAILY_BUDGET_USD;
    env.AI_DAILY_BUDGET_USD = 0;
    try {
      const s = await generateSummary(w.est.id, w.classroom.id, DAY, w.manager.id);
      expect(s).toMatchObject({ origin: 'TEMPLATE', fallbackReason: 'BUDGET_EXCEEDED' });
      expect(s.notice).toMatch(/Budget IA du jour atteint/);
      expect(llm.calls).toBe(0);
      expect(await prisma.aiCall.count({ where: { status: 'BLOCKED_BUDGET' } })).toBe(1);
    } finally {
      env.AI_DAILY_BUDGET_USD = budget;
    }
  });
});
