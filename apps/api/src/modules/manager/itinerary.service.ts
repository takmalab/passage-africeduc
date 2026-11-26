import { formatMinute, parseMinute } from '@passage/shared';
import { prisma, type CheckpointType, type Prisma } from '../../db/prisma.js';
import { badRequest, notFound } from '../../lib/errors.js';

/**
 * Itinéraire de l'établissement (DECISIONS.md, D14).
 *
 * Le responsable le saisit UNE fois : portail entrée, portail sortie, et autobus si
 * l'école en a un. Il est recopié dans l'itinéraire de chaque élève (Route / RouteStep),
 * que lit le moteur d'anomalies. Les étapes de type BUS sont sautées pour un élève qui
 * ne prend pas le bus : s'il badge quand même au bus, c'est « point absent de l'itinéraire ».
 */

export type ItineraryStepInput = {
  checkpointId: string;
  start: string; // « HH:MM »
  end: string;
  days: number[]; // 1 = lundi ... 7 = dimanche
};

type TemplateStep = {
  checkpointId: string;
  checkpointType: CheckpointType;
  startMinute: number;
  endMinute: number;
  days: number[];
};

type Tx = Prisma.TransactionClient;

const ROUTE_NAME = "Itinéraire de l'établissement";

export async function getEstablishmentRoute(establishmentId: string) {
  const steps = await prisma.establishmentRouteStep.findMany({
    where: { establishmentId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      position: true,
      startMinute: true,
      endMinute: true,
      days: true,
      checkpoint: { select: { id: true, label: true, type: true } },
    },
  });
  return steps.map((s) => ({
    ...s,
    start: formatMinute(s.startMinute),
    end: formatMinute(s.endMinute),
  }));
}

/** Enregistre l'itinéraire de l'établissement et le recopie sur tous ses élèves. */
export async function saveEstablishmentRoute(establishmentId: string, input: ItineraryStepInput[]) {
  // Points de CET établissement uniquement (id -> type).
  const checkpoints = new Map(
    (
      await prisma.checkpoint.findMany({
        where: { establishmentId },
        select: { id: true, type: true },
      })
    ).map((c) => [c.id, c.type]),
  );
  const seen = new Set<string>();
  const template: TemplateStep[] = input.map((s, i) => {
    const type = checkpoints.get(s.checkpointId);
    if (!type) throw badRequest(`Étape ${i + 1} : point inconnu.`);
    if (seen.has(s.checkpointId)) throw badRequest(`Étape ${i + 1} : ce point figure déjà.`);
    seen.add(s.checkpointId);
    const startMinute = parseMinute(s.start);
    const endMinute = parseMinute(s.end);
    if (startMinute === null || endMinute === null || startMinute >= endMinute) {
      throw badRequest(`Étape ${i + 1} : fenêtre horaire invalide.`);
    }
    return {
      checkpointId: s.checkpointId,
      checkpointType: type,
      startMinute,
      endMinute,
      days: [...new Set(s.days)].sort(),
    };
  });

  // Tout ou rien : l'itinéraire de l'école et celui de chaque élève changent ensemble.
  return prisma.$transaction(
    async (tx) => {
      await tx.establishmentRouteStep.deleteMany({ where: { establishmentId } });
      await tx.establishmentRouteStep.createMany({
        data: template.map(({ checkpointType: _type, ...t }, i) => ({
          ...t,
          position: i + 1,
          establishmentId,
        })),
      });
      const students = await tx.student.findMany({
        where: { establishmentId },
        select: { id: true, takesBus: true },
      });
      for (const student of students) {
        await applyToStudent(tx, student.id, student.takesBus, template);
      }
      return { steps: template.length, students: students.length };
    },
    // Une écriture par élève : on laisse plus que les 5 s par défaut.
    { timeout: 30_000 },
  );
}

/** Recopie l'itinéraire actuel de l'établissement sur un élève (création, case bus). */
export async function applyEstablishmentRouteToStudent(
  tx: Tx,
  establishmentId: string,
  studentId: string,
  takesBus: boolean,
) {
  const steps = await tx.establishmentRouteStep.findMany({
    where: { establishmentId },
    orderBy: { position: 'asc' },
    include: { checkpoint: { select: { type: true } } },
  });
  const template = steps.map((s) => ({
    checkpointId: s.checkpointId,
    checkpointType: s.checkpoint.type,
    startMinute: s.startMinute,
    endMinute: s.endMinute,
    days: s.days,
  }));
  await applyToStudent(tx, studentId, takesBus, template);
}

/** Le responsable coche ou décoche « Ne prend pas le bus » sur la fiche d'un élève. */
export async function setTakesBus(establishmentId: string, studentId: string, takesBus: boolean) {
  return prisma.$transaction(async (tx) => {
    // Filtre sur l'établissement DANS la requête : élève d'une autre école = 404.
    const { count } = await tx.student.updateMany({
      where: { id: studentId, establishmentId },
      data: { takesBus },
    });
    if (count === 0) throw notFound('Élève introuvable.');
    await applyEstablishmentRouteToStudent(tx, establishmentId, studentId, takesBus);
    return { takesBus };
  });
}

/**
 * Met l'itinéraire d'un élève en conformité avec celui de l'établissement, SUR PLACE :
 * une étape dont le point existe déjà garde son identifiant. C'est important, car la
 * clé anti-doublon des alertes est MISSED:<étape>:<date> ; recréer les étapes changerait
 * leurs identifiants et une alerte déjà envoyée aujourd'hui repartirait.
 */
async function applyToStudent(
  tx: Tx,
  studentId: string,
  takesBus: boolean,
  template: TemplateStep[],
) {
  const wanted = template.filter((t) => takesBus || t.checkpointType !== 'BUS');
  const route = await tx.route.upsert({
    where: { studentId },
    create: { studentId, name: ROUTE_NAME },
    update: { name: ROUTE_NAME },
  });
  const existing = await tx.routeStep.findMany({
    where: { routeId: route.id },
    orderBy: { position: 'asc' },
  });

  // Une étape existante à garder par point voulu ; tout le reste est supprimé.
  const wantedIds = new Set(wanted.map((w) => w.checkpointId));
  const keep = new Map<string, string>(); // checkpointId -> id de l'étape gardée
  for (const step of existing) {
    if (wantedIds.has(step.checkpointId) && !keep.has(step.checkpointId)) {
      keep.set(step.checkpointId, step.id);
    }
  }
  const keptIds = new Set(keep.values());
  await tx.routeStep.deleteMany({
    where: { routeId: route.id, id: { notIn: [...keptIds] } },
  });

  // Les positions sont uniques par itinéraire : on décale d'abord les étapes gardées
  // (+100) pour que la renumérotation 1, 2, 3 ne heurte jamais une position occupée.
  await tx.routeStep.updateMany({
    where: { routeId: route.id },
    data: { position: { increment: 100 } },
  });

  for (const [i, w] of wanted.entries()) {
    const data = {
      position: i + 1,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      days: w.days,
    };
    const id = keep.get(w.checkpointId);
    if (id) {
      await tx.routeStep.update({ where: { id }, data });
    } else {
      await tx.routeStep.create({
        data: { ...data, routeId: route.id, checkpointId: w.checkpointId },
      });
    }
  }
}
