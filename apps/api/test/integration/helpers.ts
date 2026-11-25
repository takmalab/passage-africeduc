import { randomUUID } from 'node:crypto';
import { formatNfcCode, startOfLocalDayUtc } from '@passage/shared';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { nfcMacKey, nfcMetaKey, uidHash } from '../../src/modules/badges/keys.js';
import { simulateTap } from '../../src/modules/badges/nfc-crypto.js';

export const PASSWORD = 'MotDePasse-Test-1';
export const TZ = 'Africa/Douala';
export const app = createApp();

/** Client HTTP qui garde le cookie de session et ajoute l'en-tête anti-CSRF. */
export function client() {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(url),
    post: (url: string, body?: object) =>
      agent.post(url).set('X-Requested-With', 'passage').send(body ?? {}),
    patch: (url: string, body?: object) =>
      agent.patch(url).set('X-Requested-With', 'passage').send(body ?? {}),
    put: (url: string, body?: object) =>
      agent.put(url).set('X-Requested-With', 'passage').send(body ?? {}),
  };
}

export async function loggedIn(login: string) {
  const c = client();
  const res = await c.post('/api/auth/login', { login, password: PASSWORD });
  if (res.status !== 200) throw new Error(`Connexion impossible pour ${login} : ${res.status}`);
  return c;
}

let passwordHash: string | undefined;

/** Établissement complet : 1 classe, 2 points, 3 élèves avec carte NFC simulée et itinéraire. */
export async function seedWorld(suffix = '') {
  passwordHash ??= await hashPassword(PASSWORD);
  const est = await prisma.establishment.create({ data: { name: `Lycée${suffix}`, timezone: TZ } });
  const mk = (login: string, role: 'MANAGER' | 'AGENT' | 'PARENT', withEst = true) =>
    prisma.user.create({
      data: {
        name: login,
        login: `${login}${suffix}`,
        passwordHash: passwordHash!,
        role,
        establishmentId: withEst ? est.id : null,
      },
    });
  const manager = await mk('responsable', 'MANAGER');
  const agent = await mk('agent', 'AGENT');
  const parentA = await mk('parent.a', 'PARENT', false);
  const parentB = await mk('parent.b', 'PARENT', false);

  const classroom = await prisma.classroom.create({ data: { name: '3e A', establishmentId: est.id } });
  const entry = await prisma.checkpoint.create({
    data: { label: 'Portail entrée', type: 'GATE', establishmentId: est.id },
  });
  const exit = await prisma.checkpoint.create({
    data: { label: 'Portail sortie', type: 'GATE', establishmentId: est.id },
  });
  const bus = await prisma.checkpoint.create({
    data: { label: 'Bus', type: 'BUS', establishmentId: est.id },
  });

  const students = [];
  for (const firstName of ['Awa', 'Kevin', 'Brenda']) {
    const student = await prisma.student.create({
      data: { firstName, lastName: 'Test', classroomId: classroom.id, establishmentId: est.id },
    });
    await prisma.route.create({
      data: {
        studentId: student.id,
        name: 'Portail',
        steps: {
          create: [
            { checkpointId: entry.id, position: 1, startMinute: 420, endMinute: 465, days: [1, 2, 3, 4, 5, 6, 7] },
            { checkpointId: exit.id, position: 2, startMinute: 930, endMinute: 975, days: [1, 2, 3, 4, 5, 6, 7] },
          ],
        },
      },
    });
    const card = await createCard(est.id, student.id);
    students.push({ ...student, ...card });
  }
  await prisma.parentStudent.create({ data: { parentId: parentA.id, studentId: students[0]!.id } });
  await prisma.parentStudent.create({ data: { parentId: parentB.id, studentId: students[1]!.id } });

  return { est, manager, agent, parentA, parentB, classroom, entry, exit, bus, students, suffix };
}

export async function createCard(establishmentId: string, studentId: string) {
  const badge = await prisma.badge.create({
    data: {
      publicId: randomUUID().replace(/-/g, '').slice(0, 16),
      studentId,
      kind: 'NFC',
      status: 'PENDING_ACTIVATION',
    },
  });
  const uid = `04${randomUUID().replace(/-/g, '').slice(0, 12)}`.toUpperCase();
  await prisma.badge.update({
    where: { id: badge.id },
    data: { status: 'ACTIVE', uidHash: uidHash(uid), activatedAt: new Date() },
  });
  return { badgeId: badge.id, uid, establishmentId };
}

/** Code tel qu'une vraie puce le produirait pour ce compteur. */
export function tap(card: { establishmentId: string; badgeId: string; uid: string }, counter: number) {
  const t = simulateTap(nfcMetaKey(card.establishmentId), nfcMacKey(card.badgeId), card.uid, counter);
  return formatNfcCode(t.piccData, t.mac);
}

/** Instant UTC d'une heure locale (Douala) pour une date AAAA-MM-JJ. */
export function localTime(dateKey: string, hh: number, mm: number): number {
  return startOfLocalDayUtc(dateKey, TZ).getTime() + (hh * 60 + mm) * 60_000;
}

export function scanEvent(rawCode: string, checkpointId: string, deviceLocalTime: number) {
  return { localEventId: randomUUID(), rawCode, checkpointId, deviceLocalTime };
}
