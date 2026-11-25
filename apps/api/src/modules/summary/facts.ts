import { addDaysToDateKey, formatMinute, localParts } from '@passage/shared';
import { prisma } from '../../db/prisma.js';
import { dateFromKey } from '../anomalies/anomalies.service.js';

/**
 * Chiffres de la synthèse, calculés uniquement par le code à partir de la base.
 * Le modèle de langage ne voit que ces valeurs et ne calcule jamais rien.
 */
export type SummaryFacts = {
  className: string;
  dateKey: string;
  holiday: boolean;
  /** Élèves actifs de la classe. */
  enrolled: number;
  /** Élèves avec au moins un passage accepté dans la journée. */
  present: number;
  /** Élèves avec une absence justifiée ce jour-là. */
  excused: number;
  /** Arrivées après la fin de la première fenêtre de l'itinéraire. */
  late: number;
  /** Autres passages hors fenêtre (sorties anticipées ou tardives). */
  outOfWindow: number;
  /** Heures de ces passages hors fenêtre, triées (HH:MM). */
  outOfWindowTimes: string[];
  /** Points attendus non validés (hors anomalies closes automatiquement). */
  missed: number;
  /** Tentatives de copie ou badges désactivés présentés. */
  badgeAlerts: number;
};

/** Valeurs numériques que la synthèse peut afficher, par nom de marqueur. */
export function factPlaceholders(f: SummaryFacts): Record<string, string> {
  return {
    enrolled: String(f.enrolled),
    present: String(f.present),
    excused: String(f.excused),
    late: String(f.late),
    outOfWindow: String(f.outOfWindow),
    outOfWindowTimes: f.outOfWindowTimes.length ? f.outOfWindowTimes.join(', ') : 'aucune',
    missed: String(f.missed),
    badgeAlerts: String(f.badgeAlerts),
  };
}

export async function computeFacts(
  establishmentId: string,
  classroomId: string,
  dateKey: string,
): Promise<SummaryFacts | null> {
  const classroom = await prisma.classroom.findFirst({
    where: { id: classroomId, establishmentId },
    include: { establishment: { select: { timezone: true } } },
  });
  if (!classroom) return null;
  const tz = classroom.establishment.timezone;
  const date = dateFromKey(dateKey);

  const students = await prisma.student.findMany({
    where: { classroomId, status: 'ACTIVE' },
    select: { id: true },
  });
  const ids = students.map((s) => s.id);

  const holiday =
    (await prisma.dayException.count({
      where: { establishmentId, date, type: 'HOLIDAY', studentId: null },
    })) > 0;

  // Passages acceptés de la journée locale (bornes larges puis filtre exact).
  const passages = await prisma.passage.findMany({
    where: {
      studentId: { in: ids },
      verdict: 'ACCEPTED',
      effectiveTime: {
        gte: new Date(`${addDaysToDateKey(dateKey, -1)}T00:00:00Z`),
        lt: new Date(`${addDaysToDateKey(dateKey, 2)}T00:00:00Z`),
      },
    },
    select: { studentId: true, effectiveTime: true },
  });
  const presentIds = new Set(
    passages
      .filter((p) => localParts(p.effectiveTime, tz).dateKey === dateKey)
      .map((p) => p.studentId as string),
  );

  const excused = await prisma.dayException.findMany({
    where: { date, type: 'JUSTIFIED_ABSENCE', studentId: { in: ids } },
    select: { studentId: true },
    distinct: ['studentId'],
  });

  const anomalies = await prisma.anomaly.findMany({
    where: { studentId: { in: ids }, date },
    select: { type: true, status: true, details: true },
  });

  let late = 0;
  const outTimes: number[] = [];
  let missed = 0;
  let badgeAlerts = 0;
  for (const a of anomalies) {
    const d = a.details as { direction?: string; stepPosition?: number; minute?: number };
    if (a.type === 'OUT_OF_WINDOW') {
      if (d.direction === 'LATE' && d.stepPosition === 1) late++;
      else if (typeof d.minute === 'number') outTimes.push(d.minute);
    } else if (a.type === 'MISSED_CHECKPOINT' && a.status !== 'AUTO_RESOLVED') {
      missed++;
    } else if (a.type === 'BADGE_REPLAY' || a.type === 'INACTIVE_BADGE') {
      badgeAlerts++;
    }
  }
  outTimes.sort((x, y) => x - y);

  return {
    className: classroom.name,
    dateKey,
    holiday,
    enrolled: ids.length,
    present: presentIds.size,
    excused: excused.length,
    late,
    outOfWindow: outTimes.length,
    outOfWindowTimes: outTimes.map(formatMinute),
    missed,
    badgeAlerts,
  };
}
