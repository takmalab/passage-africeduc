/**
 * Jeu de données reproductible pour la démonstration et les tests manuels.
 *
 *   npm run db:seed
 *
 * - vide toutes les tables puis recrée le même contenu (refusé en production
 *   sauf SEED_FORCE=true) ;
 * - 1 établissement, 2 classes, 10 élèves, 3 points de contrôle, itinéraires ;
 * - 1 responsable, 1 agent, 2 parents de 2 enfants chacun (mot de passe : SEED_PASSWORD) ;
 * - une carte NFC simulée par élève ;
 * - une journée complète de passages sur le dernier jour ouvré (pour la
 *   synthèse), aujourd'hui restant vierge pour la démonstration en direct.
 */
import { randomUUID } from 'node:crypto';
import {
  addDaysToDateKey,
  formatNfcCode,
  isoWeekdayOfDateKey,
  localParts,
  startOfLocalDayUtc,
} from '@passage/shared';
import { env } from '../src/config/env.js';
import { prisma } from '../src/db/prisma.js';
import { detectMissedCheckpoints } from '../src/modules/anomalies/anomalies.service.js';
import { hashPassword } from '../src/modules/auth/password.js';
import { nfcMacKey, nfcMetaKey, uidHash } from '../src/modules/badges/keys.js';
import { simulateTap } from '../src/modules/badges/nfc-crypto.js';
import { ingestBatch } from '../src/modules/sync/sync.service.js';
import { applyEstablishmentRouteToStudent } from '../src/modules/manager/itinerary.service.js';

const TZ = 'Africa/Douala';
const WEEKDAYS = [1, 2, 3, 4, 5];

async function main() {
  if (env.NODE_ENV === 'production' && process.env.SEED_FORCE !== 'true') {
    throw new Error(
      'Seed refusé en production (il vide la base). Définir SEED_FORCE=true pour forcer.',
    );
  }
  const password = process.env.SEED_PASSWORD ?? 'Passage2026!';

  await prisma.$executeRawUnsafe(`
    TRUNCATE "AuditLog", "AiCall", "Summary", "OutboundMessage", "Anomaly", "BadgeCodeUse",
      "Passage", "Device", "DayException", "RouteStep", "Route", "SimulatedCard", "Badge",
      "ParentStudent", "Student", "Checkpoint", "Classroom", "Session", "User", "Establishment"
    RESTART IDENTITY CASCADE`);

  const est = await prisma.establishment.create({
    data: { name: 'Lycée de démonstration de Dschang', timezone: TZ, allowPrintedBadges: false },
  });

  const hash = await hashPassword(password);
  const [manager, agent, parentA, parentB] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Mme Responsable',
        login: 'responsable',
        passwordHash: hash,
        role: 'MANAGER',
        establishmentId: est.id,
      },
    }),
    prisma.user.create({
      data: {
        name: 'M. Agent',
        login: 'agent',
        passwordHash: hash,
        role: 'AGENT',
        establishmentId: est.id,
      },
    }),
    prisma.user.create({
      data: {
        name: 'Parent de Awa et Junior',
        login: 'parent.awa',
        passwordHash: hash,
        role: 'PARENT',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Parent de Kevin et Clarisse',
        login: 'parent.kevin',
        passwordHash: hash,
        role: 'PARENT',
      },
    }),
  ]);

  const [c3a, c3b] = await Promise.all([
    prisma.classroom.create({ data: { name: '3e A', establishmentId: est.id } }),
    prisma.classroom.create({ data: { name: '3e B', establishmentId: est.id } }),
  ]);

  const [entry, exit, bus] = await Promise.all([
    prisma.checkpoint.create({
      data: { label: 'Portail entrée', type: 'GATE', establishmentId: est.id },
    }),
    prisma.checkpoint.create({
      data: { label: 'Portail sortie', type: 'GATE', establishmentId: est.id },
    }),
    prisma.checkpoint.create({
      data: { label: 'Bus ligne 1', type: 'BUS', establishmentId: est.id },
    }),
  ]);

  const roster: [string, string, string, boolean][] = [
    ['Awa', 'Ngono', c3a.id, false],
    ['Kevin', 'Tchoupo', c3a.id, true],
    ['Brenda', 'Mbarga', c3a.id, false],
    ['Samuel', 'Fotso', c3a.id, false],
    ['Clarisse', 'Tchoupo', c3a.id, true],
    ['Yannick', 'Kamga', c3a.id, false],
    ['Junior', 'Ngono', c3b.id, false],
    ['Grace', 'Atangana', c3b.id, false],
    ['Hervé', 'Djoumessi', c3b.id, false],
    ['Linda', 'Nkemdirim', c3b.id, false],
  ];

  type SeededStudent = Awaited<ReturnType<typeof prisma.student.create>> & {
    badgeId: string;
    uid: string;
    takesBus: boolean;
  };
  const students: SeededStudent[] = [];
  // Itinéraire de l'établissement, saisi une fois et recopié sur chaque élève (D14).
  await prisma.establishmentRouteStep.createMany({
    data: [
      { checkpointId: bus.id, startMinute: 6 * 60 + 15, endMinute: 6 * 60 + 45 },
      { checkpointId: entry.id, startMinute: 7 * 60, endMinute: 7 * 60 + 45 },
      { checkpointId: exit.id, startMinute: 15 * 60 + 30, endMinute: 16 * 60 + 15 },
    ].map((step, i) => ({ ...step, position: i + 1, days: WEEKDAYS, establishmentId: est.id })),
  });

  for (const [firstName, lastName, classroomId, takesBus] of roster) {
    const student = await prisma.student.create({
      data: { firstName, lastName, classroomId, establishmentId: est.id, takesBus },
    });
    // Même chemin que l'application : l'étape bus est sautée si l'élève ne prend pas le bus.
    await prisma.$transaction((tx) =>
      applyEstablishmentRouteToStudent(tx, est.id, student.id, takesBus),
    );

    // Badge NFC avec carte simulée, activé comme une vraie carte.
    const badge = await prisma.badge.create({
      data: {
        publicId: randomUUID().replace(/-/g, '').slice(0, 16),
        studentId: student.id,
        kind: 'NFC',
        status: 'PENDING_ACTIVATION',
      },
    });
    const uid = `04${randomUUID().replace(/-/g, '').slice(0, 12)}`.toUpperCase();
    await prisma.simulatedCard.create({ data: { badgeId: badge.id, uid, counter: 0 } });
    await prisma.badge.update({
      where: { id: badge.id },
      data: { status: 'ACTIVE', uidHash: uidHash(uid), activatedAt: new Date() },
    });
    students.push({ ...student, badgeId: badge.id, uid, takesBus });
  }

  const byName = (n: string) => students.find((s) => s.firstName === n)!;
  await prisma.parentStudent.createMany({
    data: [
      { parentId: parentA.id, studentId: byName('Awa').id },
      { parentId: parentA.id, studentId: byName('Junior').id },
      { parentId: parentB.id, studentId: byName('Kevin').id },
      { parentId: parentB.id, studentId: byName('Clarisse').id },
    ],
  });

  // --- Journée de démonstration : dernier jour ouvré avant aujourd'hui ---------
  const today = localParts(new Date(), TZ).dateKey;
  let day = addDaysToDateKey(today, -1);
  while (!WEEKDAYS.includes(isoWeekdayOfDateKey(day))) day = addDaysToDateKey(day, -1);
  const midnight = startOfLocalDayUtc(day, TZ).getTime();
  const at = (h: number, m: number) => midnight + (h * 60 + m) * 60_000;

  const deviceId = randomUUID();
  const counters = new Map<string, number>();
  const scan = async (firstName: string, checkpointId: string, time: number) => {
    const s = byName(firstName);
    const counter = (counters.get(s.id) ?? 0) + 1;
    counters.set(s.id, counter);
    const tap = simulateTap(nfcMetaKey(est.id), nfcMacKey(s.badgeId), s.uid, counter);
    await ingestBatch(
      { id: agent.id, establishmentId: est.id },
      {
        deviceId,
        deviceSentAt: time,
        events: [
          {
            localEventId: randomUUID(),
            rawCode: formatNfcCode(tap.piccData, tap.mac),
            checkpointId,
            deviceLocalTime: time,
          },
        ],
      },
      time + 2000,
    );
    await prisma.simulatedCard.update({ where: { badgeId: s.badgeId }, data: { counter } });
  };

  // Bus : Kevin passe, Clarisse non (anomalie « point manquant »).
  await scan('Kevin', bus.id, at(6, 32));
  // Entrée : 8 élèves à l'heure, Samuel en retard, Linda absente justifiée, Grace absente.
  for (const [n, m] of [
    ['Awa', 7],
    ['Kevin', 9],
    ['Brenda', 12],
    ['Clarisse', 14],
    ['Yannick', 20],
    ['Junior', 22],
    ['Hervé', 30],
  ] as const) {
    await scan(n, entry.id, at(7, m));
  }
  await scan('Samuel', entry.id, at(7, 58));
  await prisma.dayException.create({
    data: {
      establishmentId: est.id,
      studentId: byName('Linda').id,
      date: new Date(`${day}T00:00:00Z`),
      type: 'JUSTIFIED_ABSENCE',
      reason: 'Certificat médical',
      createdById: manager.id,
    },
  });
  // Sortie : Brenda sort à 14:10 (hors plage), les autres à l'heure.
  await scan('Brenda', exit.id, at(14, 10));
  for (const [n, m] of [
    ['Awa', 35],
    ['Kevin', 36],
    ['Samuel', 40],
    ['Clarisse', 41],
    ['Yannick', 44],
    ['Junior', 50],
    ['Hervé', 55],
  ] as const) {
    await scan(n, exit.id, at(15, m));
  }

  // Détection des passages manquants comme si le programme de fond avait tourné ce soir-là.
  await detectMissedCheckpoints(new Date(at(23, 0)), 0);
  await prisma.outboundMessage.updateMany({
    where: { status: 'PENDING' },
    data: { status: 'SENT', sentAt: new Date(at(23, 1)), attempts: 1 },
  });

  const counts = {
    passages: await prisma.passage.count(),
    anomalies: await prisma.anomaly.count(),
    messages: await prisma.outboundMessage.count(),
  };
  console.log(`Seed terminé. Journée de démonstration : ${day}.`, counts);
  console.log(
    `Comptes : responsable, agent, parent.awa, parent.kevin (mot de passe : ${password})`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
