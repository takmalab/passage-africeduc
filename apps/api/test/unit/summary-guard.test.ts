import { describe, expect, it } from 'vitest';
import type { SummaryFacts } from '../../src/modules/summary/facts.js';
import { templateSummary, validateAndFill } from '../../src/modules/summary/guard.js';

const facts: SummaryFacts = {
  className: '3e A',
  dateKey: '2026-11-24',
  holiday: false,
  enrolled: 20,
  present: 18,
  excused: 1,
  late: 2,
  outOfWindow: 1,
  outOfWindowTimes: ['14:10'],
  missed: 1,
  badgeAlerts: 0,
};

const base =
  '{present} présent(s) sur {enrolled}, {late} retard(s), {outOfWindow} sortie(s) hors plage ({outOfWindowTimes}), {missed} manquant(s).';

describe('garde-fou « aucune donnée inventée »', () => {
  it('remplace les marqueurs par les chiffres calculés', () => {
    expect(validateAndFill({ template: base }, facts)).toEqual({
      ok: true,
      text: '18 présent(s) sur 20, 2 retard(s), 1 sortie(s) hors plage (14:10), 1 manquant(s).',
    });
  });

  it.each([
    ['un chiffre', base.replace('{late}', '3')],
    ['un nombre en lettres', base + ' Dix-huit élèves étaient là.'],
    ['un quantificateur', base + ' Tous les élèves sont arrivés.'],
    ['« un » comme quantité', base.replace('{outOfWindow} sortie(s)', 'une sortie')],
    ['« aucun »', base + ' Aucun incident.'],
    ['un marqueur inventé', base + ' {absents}'],
    ['un marqueur obligatoire manquant', base.replace('{missed} manquant(s).', '')],
    ['du HTML', base + ' <b>ok</b>'],
  ])('refuse %s', (_label, template) => {
    expect(validateAndFill({ template }, facts).ok).toBe(false);
  });

  it('refuse un objet qui ne respecte pas le schéma', () => {
    expect(validateAndFill({ template: base, extra: 1 }, facts).ok).toBe(false);
    expect(validateAndFill({ text: base }, facts).ok).toBe(false);
    expect(validateAndFill(null, facts).ok).toBe(false);
  });

  it('le gabarit de repli contient exactement les chiffres calculés', () => {
    expect(templateSummary(facts)).toBe(
      '18 élève(s) présent(s) sur 20, 1 absence(s) justifiée(s), 2 retard(s) au premier point, 1 passage(s) hors plage (14:10), 1 passage(s) manquant(s), 0 alerte(s) badge.',
    );
  });
});
