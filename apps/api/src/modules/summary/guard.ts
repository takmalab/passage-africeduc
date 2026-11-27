import { z } from 'zod';
import { factPlaceholders, type SummaryFacts } from './facts.js';

/**
 * Garde-fou « aucune donnée inventée ».
 *
 * Le modèle ne rédige pas de chiffres : il rédige un GABARIT de phrase avec des
 * marqueurs {present}, {enrolled}... que le code remplace par les valeurs
 * calculées en base. On refuse toute sortie qui contient un chiffre, un nombre
 * écrit en lettres ou un quantificateur (« aucun », « tous », « plusieurs ») :
 * le modèle ne peut donc ni inventer ni déformer une quantité.
 */

export const modelOutputSchema = z
  .object({
    template: z.string().min(20).max(500),
  })
  .strict();

export type ModelOutput = z.infer<typeof modelOutputSchema>;

/** Schéma JSON envoyé au modèle (mode « json_schema » strict). */
export const MODEL_JSON_SCHEMA = {
  type: 'object',
  properties: {
    template: {
      type: 'string',
      description:
        'Phrase de synthèse en français utilisant uniquement les marqueurs fournis, sans aucun chiffre.',
    },
  },
  required: ['template'],
  additionalProperties: false,
} as const;

export const ALLOWED_PLACEHOLDERS = [
  'enrolled',
  'present',
  'excused',
  'late',
  'outOfWindow',
  'outOfWindowTimes',
  'missed',
  'badgeAlerts',
] as const;

/**
 * Sens de chaque marqueur, repris de computeFacts (facts.ts) et donné au modèle :
 * il ne peut pas inventer un chiffre, mais il pourrait mal nommer un chiffre exact.
 * Le type Record impose une signification pour CHAQUE marqueur autorisé.
 */
export const PLACEHOLDER_MEANINGS: Record<(typeof ALLOWED_PLACEHOLDERS)[number], string> = {
  enrolled: "nombre d'élèves inscrits dans la classe",
  present: "nombre d'élèves présents (au moins un passage validé dans la journée)",
  excused: "nombre d'élèves en absence justifiée",
  late: "nombre d'arrivées en retard au premier point de l'itinéraire",
  outOfWindow:
    'nombre des autres passages en dehors de leur plage horaire (sorties anticipées ou tardives)',
  outOfWindowTimes: 'heures de ces passages hors plage, déjà mises en forme',
  missed:
    "nombre de passages manquants : points de l'itinéraire attendus et non validés (bus non pris, sortie non badgée). Ce ne sont pas des absences : un élève présent peut avoir un passage manquant",
  badgeAlerts:
    "nombre d'alertes de sécurité du badge (tentative de copie, badge désactivé présenté)",
};

/** Marqueurs obligatoires : la synthèse doit au moins dire ces chiffres. */
export const REQUIRED_PLACEHOLDERS = [
  'present',
  'enrolled',
  'late',
  'outOfWindow',
  'missed',
] as const;

const NUMBER_WORDS =
  /\b(z[ée]ro|une?|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cent|cents|mille|dizaines?|douzaines?|centaines?|aucune?s?|tou(?:te)?s|plusieurs|quelques|nombreu(?:x|ses)|majorit[ée]|moiti[ée]|totalit[ée]|ensemble des|la plupart)\b/i;

export type GuardResult = { ok: true; text: string } | { ok: false; reason: string };

export function validateAndFill(output: unknown, facts: SummaryFacts): GuardResult {
  const parsed = modelOutputSchema.safeParse(output);
  if (!parsed.success) return { ok: false, reason: 'Format JSON non conforme au schéma.' };
  const template = parsed.data.template.trim();

  const markers = [...template.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1] as string);
  const unknown = markers.filter((m) => !(ALLOWED_PLACEHOLDERS as readonly string[]).includes(m));
  if (unknown.length) return { ok: false, reason: `Marqueur inconnu : ${unknown.join(', ')}.` };
  const missing = REQUIRED_PLACEHOLDERS.filter((m) => !markers.includes(m));
  if (missing.length) return { ok: false, reason: `Marqueur manquant : ${missing.join(', ')}.` };

  const withoutMarkers = template.replace(/\{[a-zA-Z]+\}/g, ' ');
  if (/\d/.test(withoutMarkers)) return { ok: false, reason: 'Chiffre écrit par le modèle.' };
  const word = NUMBER_WORDS.exec(withoutMarkers);
  if (word) return { ok: false, reason: `Quantité écrite par le modèle : « ${word[0]} ».` };
  if (/[<>]/.test(withoutMarkers)) return { ok: false, reason: 'Caractère interdit.' };

  const values = factPlaceholders(facts);
  const text = template.replace(/\{([a-zA-Z]+)\}/g, (_, key: string) => values[key] ?? '');
  return { ok: true, text };
}

/** Gabarit sec mais exact, utilisé sans clé, hors budget, ou après deux sorties invalides. */
export function templateSummary(f: SummaryFacts): string {
  if (f.holiday) return 'Jour férié : aucun passage attendu.';
  const exits = f.outOfWindow
    ? `${f.outOfWindow} passage(s) hors plage (${f.outOfWindowTimes.join(', ')})`
    : '0 passage hors plage';
  return (
    `${f.present} élève(s) présent(s) sur ${f.enrolled}, ${f.excused} absence(s) justifiée(s), ` +
    `${f.late} retard(s) au premier point, ${exits}, ${f.missed} passage(s) manquant(s), ` +
    `${f.badgeAlerts} alerte(s) badge.`
  );
}
