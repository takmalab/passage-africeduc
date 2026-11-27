import { env } from '../../config/env.js';
import { MODEL_JSON_SCHEMA } from './guard.js';

export type LlmRequest = { system: string; user: string };

export type LlmResponse = {
  /** Contenu JSON brut renvoyé par le modèle (non encore validé). */
  content: string;
  inputTokens: number;
  outputTokens: number;
};

export class LlmTimeoutError extends Error {}

/**
 * Interface du modèle de langage. Le service de synthèse ne connaît que cette
 * interface : les tests utilisent un faux modèle, et changer de fournisseur ne
 * touche qu'une classe.
 */
export interface LlmClient {
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * Appel direct à une API au format « chat/completions » (Groq, Mistral, OpenAI...),
 * avec sortie contrainte par schéma JSON strict. Le fournisseur se choisit dans le
 * .env (AI_BASE_URL, AI_MODEL, AI_API_KEY) : aucun code à changer (D17).
 */
export class ChatCompletionsClient implements LlmClient {
  readonly model = env.AI_MODEL;

  constructor(private readonly apiKey: string) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.AI_TIMEOUT_MS);
    try {
      const response = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: env.AI_MAX_OUTPUT_TOKENS,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'daily_summary', schema: MODEL_JSON_SCHEMA, strict: true },
          },
        }),
      });
      if (!response.ok) {
        // On garde l'explication du fournisseur (ex. « No active subscription ») pour le
        // journal AiCall : sans elle, on ne sait pas pourquoi le modèle est indisponible.
        const reason = await providerReason(response, this.apiKey);
        throw new Error(
          `Le fournisseur d'IA a répondu ${response.status}${reason ? ` : ${reason}` : ''}`,
        );
      }
      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LlmTimeoutError(`Pas de réponse en ${env.AI_TIMEOUT_MS} ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Explication d'une réponse d'erreur du fournisseur : le champ `message` (ou `detail`)
 * si la réponse est du JSON, sinon le texte brut. Courte (journal limité à 200 caractères)
 * et sans jamais la clé d'API, au cas où le fournisseur la renverrait.
 */
async function providerReason(response: Response, apiKey: string): Promise<string> {
  const raw = await response.text().catch(() => '');
  let reason = raw;
  try {
    const data = JSON.parse(raw) as { message?: unknown; detail?: unknown };
    const field = data.message ?? data.detail;
    if (field !== undefined) reason = typeof field === 'string' ? field : JSON.stringify(field);
  } catch {
    // Pas du JSON : on garde le texte tel quel.
  }
  return reason.split(apiKey).join('***').replace(/\s+/g, ' ').trim().slice(0, 150);
}

let override: LlmClient | null | undefined;

/** Client à utiliser, ou null en mode dégradé (pas de clé). */
export function getLlmClient(): LlmClient | null {
  if (override !== undefined) return override;
  return env.AI_API_KEY ? new ChatCompletionsClient(env.AI_API_KEY) : null;
}

/** Pour les tests : impose un faux modèle (ou null = pas de clé). `undefined` rétablit. */
export function setLlmClient(client: LlmClient | null | undefined): void {
  override = client;
}
