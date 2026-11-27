import { afterEach, describe, expect, it, vi } from 'vitest';
import { MistralClient } from '../../src/modules/summary/llm.js';

// Quand Mistral refuse un appel, son explication doit être gardée (journal AiCall),
// sinon on ne sait pas pourquoi le modèle est « indisponible ».

const request = { system: 'consigne', user: 'demande' };

function fakeResponse(status: number, body: string) {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('client Mistral : erreurs du fournisseur', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("garde le code ET l'explication renvoyée par Mistral", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fakeResponse(402, JSON.stringify({ object: 'error', message: 'No active subscription' })),
      ),
    );
    await expect(new MistralClient('cle-de-test').complete(request)).rejects.toThrow(
      'Mistral a répondu 402 : No active subscription',
    );
  });

  it('coupe une explication trop longue et accepte une réponse qui n’est pas du JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(503, 'x'.repeat(1000))),
    );
    const err = await new MistralClient('cle-de-test').complete(request).catch((e: Error) => e);
    expect((err as Error).message.startsWith('Mistral a répondu 503 : xxx')).toBe(true);
    expect((err as Error).message.length).toBeLessThanOrEqual(200);
  });

  it("ne recopie jamais la clé d'API dans le message d'erreur", async () => {
    // Cas extrême : le fournisseur renverrait la clé dans son explication.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => fakeResponse(401, JSON.stringify({ message: 'Invalid key cle-de-test' }))),
    );
    const err = await new MistralClient('cle-de-test').complete(request).catch((e: Error) => e);
    expect((err as Error).message).not.toContain('cle-de-test');
  });
});
