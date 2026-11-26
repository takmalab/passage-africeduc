import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { client, loggedIn, seedWorld } from './helpers.js';

// Mise en place d'un établissement par le responsable, depuis l'interface :
// points de contrôle (puis classes, comptes et liens parent-élève).

describe('points de contrôle', () => {
  it("le responsable crée un point de contrôle, que l'agent peut ensuite scanner", async () => {
    await seedWorld();
    const manager = await loggedIn('responsable');
    const res = await manager.post('/api/manager/checkpoints', {
      label: 'Arrêt Bonapriso',
      type: 'BUS',
    });
    expect(res.status).toBe(201);
    expect(res.body.checkpoint).toMatchObject({ label: 'Arrêt Bonapriso', type: 'BUS' });

    // Le téléphone de l'agent récupère la liste des points pour scanner hors ligne.
    const agent = await loggedIn('agent');
    const list = await agent.get('/api/agent/checkpoints');
    expect(list.body.checkpoints.map((c: { label: string }) => c.label)).toContain(
      'Arrêt Bonapriso',
    );
  });

  it('refuse un nom déjà utilisé dans le même établissement (409, message clair)', async () => {
    await seedWorld();
    const manager = await loggedIn('responsable');
    // « Portail entrée » existe déjà dans seedWorld.
    const res = await manager.post('/api/manager/checkpoints', {
      label: 'Portail entrée',
      type: 'GATE',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Un point de contrôle porte déjà ce nom.');
  });

  it("chaque établissement a ses propres points : même nom permis ailleurs, jamais visible d'une école à l'autre", async () => {
    await seedWorld();
    await seedWorld('2');
    const managerA = await loggedIn('responsable');
    const managerB = await loggedIn('responsable2');
    expect(
      (await managerB.post('/api/manager/checkpoints', { label: 'Arrêt Akwa', type: 'BUS' }))
        .status,
    ).toBe(201);
    // Même nom dans l'autre établissement : autorisé (l'unicité est par établissement).
    expect(
      (await managerA.post('/api/manager/checkpoints', { label: 'Arrêt Akwa', type: 'BUS' }))
        .status,
    ).toBe(201);
    const listA = await managerA.get('/api/manager/checkpoints');
    const akwa = listA.body.checkpoints.filter((c: { label: string }) => c.label === 'Arrêt Akwa');
    expect(akwa).toHaveLength(1);
  });

  it('refuse un agent et un parent (403) et toute donnée invalide (400)', async () => {
    await seedWorld();
    for (const login of ['agent', 'parent.a']) {
      const c = await loggedIn(login);
      expect((await c.post('/api/manager/checkpoints', { label: 'X', type: 'GATE' })).status).toBe(
        403,
      );
    }
    const manager = await loggedIn('responsable');
    const invalid = [
      { label: '', type: 'GATE' }, // nom vide
      { label: 'Cantine', type: 'CANTINE' }, // type inconnu
      { label: 'Cantine', type: 'GATE', establishmentId: 'autre' }, // champ en trop (.strict)
    ];
    for (const body of invalid) {
      expect((await manager.post('/api/manager/checkpoints', body)).status).toBe(400);
    }
  });
});

describe('classes', () => {
  it('le responsable crée une classe, puis peut y inscrire un élève', async () => {
    await seedWorld();
    const manager = await loggedIn('responsable');
    const res = await manager.post('/api/manager/classrooms', { name: '4e B' });
    expect(res.status).toBe(201);
    expect(res.body.classroom).toMatchObject({ name: '4e B' });

    const student = await manager.post('/api/manager/students', {
      firstName: 'Ines',
      lastName: 'Test',
      classroomId: res.body.classroom.id,
    });
    expect(student.status).toBe(201);
  });

  it('refuse un nom de classe déjà utilisé dans le même établissement (409, message clair)', async () => {
    await seedWorld();
    const manager = await loggedIn('responsable');
    // « 3e A » existe déjà dans seedWorld.
    const res = await manager.post('/api/manager/classrooms', { name: '3e A' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('Une classe porte déjà ce nom.');
  });

  it("une classe d'un autre établissement est invisible et inutilisable", async () => {
    await seedWorld();
    await seedWorld('2');
    const managerB = await loggedIn('responsable2');
    const created = await managerB.post('/api/manager/classrooms', { name: '6e C' });
    expect(created.status).toBe(201);

    const managerA = await loggedIn('responsable');
    const listA = await managerA.get('/api/manager/classrooms');
    expect(listA.body.classrooms.map((c: { name: string }) => c.name)).not.toContain('6e C');
    // Inscrire un élève de A dans la classe de B : refusé.
    const student = await managerA.post('/api/manager/students', {
      firstName: 'Intrus',
      lastName: 'Test',
      classroomId: created.body.classroom.id,
    });
    expect(student.status).toBe(400);
  });

  it('refuse un agent et un parent (403) et toute donnée invalide (400)', async () => {
    await seedWorld();
    for (const login of ['agent', 'parent.a']) {
      const c = await loggedIn(login);
      expect((await c.post('/api/manager/classrooms', { name: '5e A' })).status).toBe(403);
    }
    const manager = await loggedIn('responsable');
    for (const body of [{ name: '' }, { name: '5e A', establishmentId: 'autre' }, {}]) {
      expect((await manager.post('/api/manager/classrooms', body)).status).toBe(400);
    }
  });
});

/** Se connecte avec un mot de passe donné (les comptes créés n'ont pas le mot de passe de test). */
async function loginWith(login: string, password: string) {
  const c = client();
  const res = await c.post('/api/auth/login', { login, password });
  return { c, status: res.status, body: res.body };
}

describe('comptes agents', () => {
  it('le responsable crée un agent : mot de passe généré, affiché une fois, jamais stocké en clair', async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    const res = await manager.post('/api/manager/agents', {
      name: 'Paul Agent',
      login: 'Paul.Agent',
    });
    expect(res.status).toBe(201);
    expect(res.body.agent).toMatchObject({ name: 'Paul Agent', login: 'paul.agent' });
    const temporaryPassword: string = res.body.temporaryPassword;
    expect(temporaryPassword).toHaveLength(16);

    // Stocké haché (argon2id), jamais en clair ; rattaché à l'établissement du responsable.
    const user = await prisma.user.findUniqueOrThrow({ where: { login: 'paul.agent' } });
    expect(user.role).toBe('AGENT');
    expect(user.establishmentId).toBe(w.est.id);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(temporaryPassword);
    // Le journal d'audit ne contient pas le mot de passe.
    const logs = await prisma.auditLog.findMany({ where: { action: 'account.create_agent' } });
    expect(logs).toHaveLength(1);
    expect(JSON.stringify(logs)).not.toContain(temporaryPassword);

    // Le nouvel agent se connecte et peut scanner dans son établissement.
    const login = await loginWith('paul.agent', temporaryPassword);
    expect(login.status).toBe(200);
    expect((await login.c.get('/api/agent/checkpoints')).status).toBe(200);
  });

  it('chaque responsable ne voit que les agents de son établissement', async () => {
    await seedWorld();
    await seedWorld('2');
    const managerB = await loggedIn('responsable2');
    expect(
      (await managerB.post('/api/manager/agents', { name: 'B', login: 'agent.b' })).status,
    ).toBe(201);
    const managerA = await loggedIn('responsable');
    const list = await managerA.get('/api/manager/agents');
    const logins = list.body.agents.map((a: { login: string }) => a.login);
    expect(logins).toContain('agent');
    expect(logins).not.toContain('agent.b');
    expect(logins).not.toContain('agent2');
  });

  it('refuse un identifiant déjà pris (409), un rôle imposé par la requête et un identifiant invalide (400)', async () => {
    await seedWorld();
    const manager = await loggedIn('responsable');
    const taken = await manager.post('/api/manager/agents', { name: 'X', login: 'agent' });
    expect(taken.status).toBe(409);
    expect(taken.body.error.message).toBe('Cet identifiant est déjà utilisé.');
    // Tentative d'élévation : créer un responsable en ajoutant « role ».
    const escalation = await manager.post('/api/manager/agents', {
      name: 'Chef',
      login: 'chef',
      role: 'MANAGER',
    });
    expect(escalation.status).toBe(400);
    expect(await prisma.user.count({ where: { login: 'chef' } })).toBe(0);
    for (const login of ['ab', 'avec espace', "x'; DROP TABLE"]) {
      expect((await manager.post('/api/manager/agents', { name: 'X', login })).status).toBe(400);
    }
  });

  it('refuse la création de compte à un agent et à un parent (403)', async () => {
    const w = await seedWorld();
    for (const login of ['agent', 'parent.a']) {
      const c = await loggedIn(login);
      expect((await c.post('/api/manager/agents', { name: 'X', login: 'x.y' })).status).toBe(403);
      expect(
        (
          await c.post(`/api/manager/students/${w.students[0]!.id}/parents`, {
            name: 'X',
            login: 'x.z',
          })
        ).status,
      ).toBe(403);
    }
  });
});

describe('comptes parents', () => {
  it('le compte parent est créé depuis la fiche élève et lié à cet élève seulement', async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    const brenda = w.students[2]!;
    const res = await manager.post(`/api/manager/students/${brenda.id}/parents`, {
      name: 'Mère de Brenda',
      login: 'parent.brenda',
    });
    expect(res.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { login: 'parent.brenda' } });
    expect(user.role).toBe('PARENT');
    expect(user.establishmentId).toBeNull();

    // Le parent se connecte et ne voit que Brenda.
    const login = await loginWith('parent.brenda', res.body.temporaryPassword);
    expect(login.status).toBe(200);
    const children = await login.c.get('/api/parent/children');
    expect(children.body.children.map((s: { firstName: string }) => s.firstName)).toEqual([
      'Brenda',
    ]);
    expect((await login.c.get(`/api/parent/children/${w.students[0]!.id}`)).status).toBe(404);

    // La fiche élève côté responsable affiche ce parent.
    const detail = await manager.get(`/api/manager/students/${brenda.id}`);
    expect(detail.body.student.parents.map((p: { name: string }) => p.name)).toContain(
      'Mère de Brenda',
    );
  });

  it("refuse de créer un parent pour l'élève d'un autre établissement (404) et ne crée aucun compte", async () => {
    await seedWorld();
    const other = await seedWorld('2');
    const managerA = await loggedIn('responsable');
    const res = await managerA.post(`/api/manager/students/${other.students[0]!.id}/parents`, {
      name: 'Intrus',
      login: 'parent.intrus',
    });
    expect(res.status).toBe(404);
    expect(await prisma.user.count({ where: { login: 'parent.intrus' } })).toBe(0);
  });

  it('refuse un identifiant déjà pris (409) sans rien lier', async () => {
    const w = await seedWorld();
    const manager = await loggedIn('responsable');
    const res = await manager.post(`/api/manager/students/${w.students[2]!.id}/parents`, {
      name: 'X',
      login: 'parent.a',
    });
    expect(res.status).toBe(409);
    expect(await prisma.parentStudent.count({ where: { studentId: w.students[2]!.id } })).toBe(0);
  });
});
