import { localParts } from '@passage/shared';

/** Plage horaire d'un point de contrôle, en minutes depuis minuit (heure de l'établissement). */
export type CheckpointWindow = { startMinute: number; endMinute: number; days: number[] };

export type WindowStatus =
  | { state: 'none' } // point sans plage dans l'itinéraire de l'établissement
  | { state: 'not-today' } // la plage ne s'applique pas ce jour-là
  | { state: 'before'; seconds: number } // ouvre dans `seconds`
  | { state: 'open'; seconds: number } // ferme dans `seconds`
  | { state: 'closed' };

/**
 * État de la plage à l'instant `nowMs`, dans le fuseau de l'établissement.
 * Même règle que le serveur : la minute de fin compte entière (07:45:59 est
 * encore dans une plage 07:00-07:45), donc la fermeture a lieu à 07:46:00.
 */
export function windowStatus(
  nowMs: number,
  timeZone: string,
  window: CheckpointWindow | null,
): WindowStatus {
  if (!window) return { state: 'none' };
  const now = new Date(nowMs);
  const { minuteOfDay, isoWeekday } = localParts(now, timeZone);
  if (!window.days.includes(isoWeekday)) return { state: 'not-today' };

  // Les fuseaux utilisés décalent d'un nombre entier de minutes : les secondes UTC conviennent.
  const second = minuteOfDay * 60 + now.getUTCSeconds();
  const opensAt = window.startMinute * 60;
  const closesAt = (window.endMinute + 1) * 60;
  if (second < opensAt) return { state: 'before', seconds: opensAt - second };
  if (second < closesAt) return { state: 'open', seconds: closesAt - second };
  return { state: 'closed' };
}

/** 754 -> « 12:34 » ; 3 900 -> « 1 h 05 min ». */
export function formatCountdown(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h} h ${String(m).padStart(2, '0')} min`;
  }
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
