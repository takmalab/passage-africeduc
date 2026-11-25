import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { app, loggedIn, seedWorld } from './helpers.js';

describe('rôles contrôlés côté serveur', () => {
  it('refuse une requête sans session (401)', async () => {
    await seedWorld();
    expect((await request(app).get('/api/manager/students')).status).toBe(401);
    expect((await request(app).get('/api/parent/children')).status).toBe(401);
  });

  it("refuse l'espace responsable à un parent et à un agent (403)", async () => {
    await seedWorld();
    for (const login of ['parent.a', 'agent']) {
      const c = await loggedIn(login);
      expect((await c.get('/api/manager/students')).status).toBe(403);
      expect((await c.post('/api/manager/summaries', {})).status).toBe(403);
    }
  });

  it("refuse la synchronisation à un parent (403)", async () => {
    await seedWorld();
    const c = await loggedIn('parent.a');
    expect((await c.post('/api/agent/sync', {})).status).toBe(403);
  });
});

describe('cloisonnement des données', () => {
  it("un parent voit son enfant mais pas celui d'un autre parent, même en changeant l'URL (404)", async () => {
    const w = await seedWorld();
    const c = await loggedIn('parent.a');
    const own = await c.get(`/api/parent/children/${w.students[0]!.id}`);
    expect(own.status).toBe(200);
    expect(own.body.child.firstName).toBe('Awa');

    const other = await c.get(`/api/parent/children/${w.students[1]!.id}`);
    expect(other.status).toBe(404);
    // Même réponse qu'un identifiant qui n'existe pas : rien n'est révélé.
    const ghost = await c.get('/api/parent/children/00000000-0000-7000-8000-000000000000');
    expect(other.body).toEqual(ghost.body);
    const garbage = await c.get("/api/parent/children/1' OR '1'='1");
    expect(garbage.status).toBe(404);

    const list = await c.get('/api/parent/children');
    expect(list.body.children.map((s: { firstName: string }) => s.firstName)).toEqual(['Awa']);
  });

  it("trace dans le journal d'audit la tentative d'accès refusée", async () => {
    const w = await seedWorld();
    const c = await loggedIn('parent.a');
    await c.get(`/api/parent/children/${w.students[1]!.id}`);
    const log = await prisma.auditLog.findFirst({ where: { action: 'parent.view_child_denied' } });
    expect(log?.targetId).toBe(w.students[1]!.id);
  });

  it("un responsable ne voit pas les élèves d'un autre établissement (404)", async () => {
    await seedWorld();
    const other = await seedWorld('-b');
    const c = await loggedIn('responsable');
    expect((await c.get(`/api/manager/students/${other.students[0]!.id}`)).status).toBe(404);
    const list = await c.get('/api/manager/students');
    expect(list.body.students).toHaveLength(3);
  });
});

describe('entrées validées et texte jamais exécuté', () => {
  it('rejette une date malformée (tentative d’injection) avec 400', async () => {
    await seedWorld();
    const c = await loggedIn('responsable');
    const res = await c.get("/api/manager/passages?date=2026-11-25';DROP TABLE \"User\";--");
    expect(res.status).toBe(400);
    expect(await prisma.user.count()).toBeGreaterThan(0);
  });

  it('stocke un nom contenant du HTML comme du simple texte, avec une CSP stricte', async () => {
    const w = await seedWorld();
    const c = await loggedIn('responsable');
    const payload = '<script>alert(1)</script>';
    const created = await c.post('/api/manager/students', {
      firstName: payload,
      lastName: 'Test',
      classroomId: w.classroom.id,
    });
    expect(created.status).toBe(201);
    const res = await c.get(`/api/manager/students/${created.body.student.id}`);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.student.firstName).toBe(payload);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
  });

  it('rejette les champs inattendus', async () => {
    const w = await seedWorld();
    const c = await loggedIn('responsable');
    const res = await c.post('/api/manager/students', {
      firstName: 'A',
      lastName: 'B',
      classroomId: w.classroom.id,
      establishmentId: 'pirate',
    });
    expect(res.status).toBe(400);
  });
});
