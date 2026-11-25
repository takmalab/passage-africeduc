import { formatDateKeyFr, formatMinute } from '@passage/shared';
import type { AnomalyType } from '../../db/prisma.js';

/**
 * Messages neutres destinés aux parents. Ils ne contiennent que le prénom,
 * le point de contrôle, la date et l'heure : pas de nom de famille, pas de
 * classe, pas de lien, pas de détail technique sur le badge.
 */
export type TemplateInput = {
  type: AnomalyType;
  firstName: string;
  checkpointLabel: string | null;
  dateKey: string;
  minute?: number | null;
  window?: { start: number; end: number } | null;
};

const CONTACT = 'Pour toute question, contactez l’établissement.';

export function alertBody(input: TemplateInput): string {
  const date = formatDateKeyFr(input.dateKey);
  const place = input.checkpointLabel ?? 'un point de contrôle';
  const at = input.minute != null ? ` à ${formatMinute(input.minute)}` : '';
  const window = input.window
    ? ` entre ${formatMinute(input.window.start)} et ${formatMinute(input.window.end)}`
    : '';

  switch (input.type) {
    case 'MISSED_CHECKPOINT':
      return `Bonjour. Aucun passage n’a été enregistré pour ${input.firstName} au point « ${place} » le ${date}${window}. ${CONTACT}`;
    case 'OUT_OF_WINDOW':
      return `Bonjour. Un passage de ${input.firstName} a été enregistré au point « ${place} » le ${date}${at}, en dehors de l’horaire prévu${window}. ${CONTACT}`;
    case 'UNEXPECTED_CHECKPOINT':
      return `Bonjour. Un passage de ${input.firstName} a été enregistré le ${date}${at} à un point de contrôle qui ne fait pas partie de son trajet habituel. ${CONTACT}`;
    case 'DOUBLE_SCAN':
      return `Bonjour. Deux passages rapprochés de ${input.firstName} ont été enregistrés au point « ${place} » le ${date}${at}. ${CONTACT}`;
    case 'BADGE_REPLAY':
      return `Bonjour. Une tentative d’utilisation d’une copie du badge de ${input.firstName} a été bloquée le ${date}${at}. ${CONTACT}`;
    case 'INACTIVE_BADGE':
      return `Bonjour. Un badge désactivé appartenant à ${input.firstName} a été présenté le ${date}${at}. ${CONTACT}`;
  }
}

export function correctionBody(input: TemplateInput): string {
  const date = formatDateKeyFr(input.dateKey);
  const place = input.checkpointLabel ?? 'un point de contrôle';
  return `Bonjour. Rectification : le passage de ${input.firstName} au point « ${place} » le ${date} a bien été enregistré (transmission différée). Le précédent message est sans objet.`;
}
