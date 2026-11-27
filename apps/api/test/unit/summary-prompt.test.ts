import { describe, expect, it } from 'vitest';
import { ALLOWED_PLACEHOLDERS, PLACEHOLDER_MEANINGS } from '../../src/modules/summary/guard.js';
import { PROMPT_VERSION, SYSTEM_PROMPT } from '../../src/modules/summary/summary.service.js';

// Le garde-fou empêche le modèle d'inventer un chiffre, mais pas de MAL NOMMER un
// chiffre exact (« {missed} absence(s) » au lieu de « passage(s) manquant(s) »).
// La consigne doit donc donner le sens de chaque marqueur.

describe('consigne envoyée au modèle', () => {
  it('décrit chaque marqueur autorisé, avec sa signification', () => {
    for (const marker of ALLOWED_PLACEHOLDERS) {
      expect(SYSTEM_PROMPT).toContain(`{${marker}} : ${PLACEHOLDER_MEANINGS[marker]}`);
    }
  });

  it('précise que les passages manquants ne sont pas des absences', () => {
    expect(PLACEHOLDER_MEANINGS.missed).toMatch(/pas des absences/i);
  });

  it('change de version quand la consigne change (le cache ne ressert pas les anciennes phrases)', () => {
    expect(PROMPT_VERSION).toBe('v2');
  });
});
