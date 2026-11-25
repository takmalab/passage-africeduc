/**
 * Outils d'heure locale d'établissement.
 *
 * Toutes les dates sont stockées en UTC. Les fenêtres d'itinéraire sont
 * exprimées en minutes depuis minuit, dans le fuseau de l'établissement
 * (Africa/Douala par défaut, UTC+1 sans heure d'été).
 */

export type LocalParts = {
  /** Date au format AAAA-MM-JJ dans le fuseau donné. */
  dateKey: string;
  /** Minutes depuis minuit (0 à 1439). */
  minuteOfDay: number;
  /** Jour ISO : 1 = lundi ... 7 = dimanche. */
  isoWeekday: number;
};

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function localParts(date: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    minuteOfDay: hour * 60 + minute,
    isoWeekday: WEEKDAYS[parts.weekday as string] ?? 0,
  };
}

/** 435 -> "07:15" */
export function formatMinute(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "07:15" -> 435 ; renvoie null si le format est invalide. */
export function parseMinute(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** "2026-11-25" -> "25/11/2026" */
export function formatDateKeyFr(dateKey: string): string {
  const [y, m, d] = dateKey.split('-');
  return `${d}/${m}/${y}`;
}

/** Jour ISO (1 = lundi) d'une date AAAA-MM-JJ, indépendamment du fuseau. */
export function isoWeekdayOfDateKey(dateKey: string): number {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Date AAAA-MM-JJ décalée de `days` jours. */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Instant UTC correspondant à minuit local d'une date donnée dans un fuseau.
 * Méthode robuste sans bibliothèque : on corrige l'écart observé entre
 * l'heure UTC et l'heure locale à cet instant.
 */
export function startOfLocalDayUtc(dateKey: string, timeZone: string): Date {
  const guess = new Date(`${dateKey}T00:00:00Z`);
  const parts = localParts(guess, timeZone);
  const localGuessMs = Date.parse(`${parts.dateKey}T${formatMinute(parts.minuteOfDay)}:00Z`);
  const offsetMs = localGuessMs - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}
