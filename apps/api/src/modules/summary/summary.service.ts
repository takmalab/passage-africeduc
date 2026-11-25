import { formatDateKeyFr } from '@passage/shared';
import { env } from '../../config/env.js';
import {
  prisma,
  type AiCallStatus,
  type FallbackReason,
  type SummaryOrigin,
} from '../../db/prisma.js';
import { canonicalJson, sha256Hex } from '../../lib/crypto.js';
import { notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { dateFromKey } from '../anomalies/anomalies.service.js';
import { computeFacts, type SummaryFacts } from './facts.js';
import { ALLOWED_PLACEHOLDERS, templateSummary, validateAndFill } from './guard.js';
import { getLlmClient, LlmTimeoutError, type LlmClient } from './llm.js';

export const PROMPT_VERSION = 'v1';
const MAX_ATTEMPTS = 2; // une tentative + un seul nouvel essai

export type SummaryView = {
  id: string;
  text: string;
  facts: SummaryFacts;
  origin: SummaryOrigin;
  fallbackReason: FallbackReason | null;
  fromCache: boolean;
  model: string | null;
  notice: string | null;
};

const SYSTEM_PROMPT = `Tu rédiges la synthèse quotidienne des passages d'une classe pour le responsable d'un établissement scolaire.
Règles absolues :
- Tu ne connais aucun chiffre. Tu écris un gabarit de phrase avec des marqueurs entre accolades, que le logiciel remplacera.
- Marqueurs disponibles : ${ALLOWED_PLACEHOLDERS.map((m) => `{${m}}`).join(', ')}.
- Marqueurs obligatoires : {present}, {enrolled}, {late}, {outOfWindow}, {missed}.
- N'écris aucun chiffre, aucun nombre en lettres, aucun mot de quantité (un, une, aucun, tous, plusieurs, quelques...).
- Accorde avec "(s)" si nécessaire, par exemple "{late} retard(s)".
- Une ou deux phrases, ton neutre et factuel, en français, sans nom d'élève.
Réponds uniquement en JSON conforme au schéma.`;

function userPrompt(facts: SummaryFacts): string {
  // Le modèle reçoit le contexte (non chiffré) et la liste des marqueurs non nuls pour adapter la tournure.
  const nonZero = ALLOWED_PLACEHOLDERS.filter((k) => {
    const v = facts[k as keyof SummaryFacts];
    return Array.isArray(v) ? v.length > 0 : typeof v === 'number' && v > 0;
  });
  return `Classe : ${facts.className}. Date : ${formatDateKeyFr(facts.dateKey)}.
Marqueurs dont la valeur n'est pas nulle : ${nonZero.map((m) => `{${m}}`).join(', ') || 'aucun'}.
Rédige le gabarit de synthèse.`;
}

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * env.AI_PRICE_INPUT_PER_MTOK + outputTokens * env.AI_PRICE_OUTPUT_PER_MTOK) /
    1_000_000
  );
}

/** Dépense estimée du jour (UTC) : somme des appels journalisés. */
export async function spentTodayUsd(now = new Date()): Promise<number> {
  const start = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  const agg = await prisma.aiCall.aggregate({
    where: { createdAt: { gte: start } },
    _sum: { estimatedCostUsd: true },
  });
  return Number(agg._sum.estimatedCostUsd ?? 0);
}

/**
 * Produit la synthèse du jour d'une classe, avec les quatre garde-fous :
 * 1. sortie contrainte (schéma JSON + validation) et un seul nouvel essai ;
 * 2. mode dégradé par gabarit (sans clé, panne, délai dépassé) ;
 * 3. coût journalisé et plafonné, cache pour ne pas payer deux fois ;
 * 4. aucun chiffre écrit par le modèle (voir guard.ts).
 */
export async function generateSummary(
  establishmentId: string,
  classroomId: string,
  dateKey: string,
  requestedById: string,
): Promise<SummaryView> {
  const facts = await computeFacts(establishmentId, classroomId, dateKey);
  if (!facts) throw notFound('Classe introuvable.');

  const client = getLlmClient();
  const model = client?.model ?? env.MISTRAL_MODEL;
  const cacheKey = sha256Hex(`${model}|${PROMPT_VERSION}|${canonicalJson(facts)}`);

  const save = (
    text: string,
    origin: SummaryOrigin,
    fallbackReason: FallbackReason | null,
    fromCache: boolean,
    notice: string | null,
  ) =>
    prisma.summary
      .create({
        data: {
          classroomId,
          date: dateFromKey(dateKey),
          facts,
          text,
          origin,
          fallbackReason,
          fromCache,
          cacheKey,
          model: origin === 'TEMPLATE' ? null : model,
          requestedById,
        },
      })
      .then((s) => ({
        id: s.id,
        text,
        facts,
        origin,
        fallbackReason,
        fromCache,
        model: s.model,
        notice,
      }));

  if (facts.holiday) return save(templateSummary(facts), 'TEMPLATE', null, false, null);

  if (!client) {
    return save(
      templateSummary(facts),
      'TEMPLATE',
      'NO_API_KEY',
      false,
      'Mode dégradé : aucune clé d’API configurée, synthèse produite par gabarit.',
    );
  }

  // Cache : mêmes chiffres, même modèle, même version de consigne => pas de nouvel appel.
  const cached = await prisma.summary.findFirst({
    where: { cacheKey, origin: { in: ['MODEL', 'MODEL_AFTER_RETRY'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (cached) {
    await logCall(model, cacheKey, 0, 'CACHE_HIT');
    return save(
      cached.text,
      cached.origin,
      null,
      true,
      'Résultat réutilisé (cache) : aucun appel facturé.',
    );
  }

  // Plafond de coût : on bloque si le budget du jour est atteint, ou s'il le serait par cet appel.
  const worstCase = estimateCostUsd(2000, env.AI_MAX_OUTPUT_TOKENS) * MAX_ATTEMPTS;
  const spent = await spentTodayUsd();
  if (spent + worstCase > env.AI_DAILY_BUDGET_USD) {
    await logCall(model, cacheKey, 0, 'BLOCKED_BUDGET');
    return save(
      templateSummary(facts),
      'TEMPLATE',
      'BUDGET_EXCEEDED',
      false,
      `Budget IA du jour atteint (${spent.toFixed(4)} $ sur ${env.AI_DAILY_BUDGET_USD.toFixed(2)} $) : appel bloqué, synthèse produite par gabarit.`,
    );
  }

  let lastFailure: FallbackReason = 'INVALID_OUTPUT';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const outcome = await callOnce(client, facts, cacheKey, attempt);
    if (outcome.ok) {
      return save(outcome.text, attempt === 1 ? 'MODEL' : 'MODEL_AFTER_RETRY', null, false, null);
    }
    lastFailure = outcome.reason;
  }

  return save(
    templateSummary(facts),
    'TEMPLATE',
    lastFailure,
    false,
    lastFailure === 'INVALID_OUTPUT'
      ? 'Sortie du modèle invalide deux fois : synthèse produite par gabarit.'
      : 'Modèle indisponible : synthèse produite par gabarit.',
  );
}

async function callOnce(
  client: LlmClient,
  facts: SummaryFacts,
  cacheKey: string,
  attempt: number,
): Promise<{ ok: true; text: string } | { ok: false; reason: FallbackReason }> {
  const started = Date.now();
  try {
    const response = await client.complete({ system: SYSTEM_PROMPT, user: userPrompt(facts) });
    const cost = estimateCostUsd(response.inputTokens, response.outputTokens);
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.content);
    } catch {
      parsed = null;
    }
    const result = validateAndFill(parsed, facts);
    await logCall(client.model, cacheKey, attempt, result.ok ? 'SUCCESS' : 'INVALID_OUTPUT', {
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      cost,
      durationMs: Date.now() - started,
      error: result.ok ? undefined : result.reason,
    });
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: 'INVALID_OUTPUT' };
  } catch (err) {
    const timeout = err instanceof LlmTimeoutError;
    await logCall(client.model, cacheKey, attempt, timeout ? 'TIMEOUT' : 'PROVIDER_ERROR', {
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message.slice(0, 200) : 'Erreur inconnue',
    });
    logger.warn({ attempt, timeout }, 'Appel au modèle en échec');
    return { ok: false, reason: 'PROVIDER_ERROR' };
  }
}

async function logCall(
  model: string,
  cacheKey: string,
  attempt: number,
  status: AiCallStatus,
  extra: {
    inputTokens?: number;
    outputTokens?: number;
    cost?: number;
    durationMs?: number;
    error?: string;
  } = {},
) {
  await prisma.aiCall.create({
    data: {
      model,
      promptVersion: PROMPT_VERSION,
      cacheKey,
      attempt,
      status,
      inputTokens: extra.inputTokens ?? 0,
      outputTokens: extra.outputTokens ?? 0,
      estimatedCostUsd: extra.cost ?? 0,
      durationMs: extra.durationMs ?? 0,
      errorMessage: extra.error ?? null,
    },
  });
}
