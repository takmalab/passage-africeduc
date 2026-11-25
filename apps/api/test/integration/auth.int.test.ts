import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { LOGIN_FAILED_MESSAGE } from '../../src/modules/auth/auth.service.js';
import { client, loggedIn, PASSWORD, seedWorld } from './helpers.js';

describe('authentification', () => {
  it('stocke les mots de passe hachés en Argon2id, jamais en clair', async () => {
    await seedWorld();
    const users = await prisma.user.findMany();
    for (const u of users) {
      expect(u.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(u.passwordHash).not.toContain(PASSWORD);
    }
  });

  it('renvoie le même message que le compte existe ou non', async () => {
    await seedWorld();
    const c = client();
    const wrongPassword = await c.post('/api/auth/login', { login: 'responsable', password: 'faux-mot-de-passe' });
    const unknownLogin = await c.post('/api/auth/login', { login: 'personne', password: 'faux-mot-de-passe' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownLogin.status).toBe(401);
    expect(wrongPassword.body.error.message).toBe(LOGIN_FAILED_MESSAGE);
    expect(unknownLogin.body).toEqual(wrongPassword.body);
  });

  it('bloque le compte après 5 échecs, même avec le bon mot de passe ensuite', async () => {
    await seedWorld();
    const c = client();
    for (let i = 0; i < 5; i++) {
      await c.post('/api/auth/login', { login: 'responsable', password: 'mauvais' });
    }
    const res = await c.post('/api/auth/login', { login: 'responsable', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe(LOGIN_FAILED_MESSAGE);
    const user = await prisma.user.findUniqueOrThrow({ where: { login: 'responsable' } });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it('pose un cookie HttpOnly SameSite=Strict', async () => {
    await seedWorld();
    const res = await client().post('/api/auth/login', { login: 'responsable', password: PASSWORD });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('la déconnexion supprime la session côté serveur', async () => {
    await seedWorld();
    const c = await loggedIn('responsable');
    const cookie = String((await c.get('/api/auth/me')).request.cookies ?? '');
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect(await prisma.session.count()).toBe(1);
    expect((await c.post('/api/auth/logout')).status).toBe(204);
    expect(await prisma.session.count()).toBe(0);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect(cookie).toBeDefined();
  });

  it("expire la session après la durée d'inactivité", async () => {
    await seedWorld();
    const c = await loggedIn('responsable');
    await prisma.session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.count()).toBe(0);
  });

  it("refuse une requête de modification sans l'en-tête anti-CSRF", async () => {
    await seedWorld();
    const c = await loggedIn('responsable');
    const res = await c.agent.post('/api/auth/logout');
    expect(res.status).toBe(403);
  });

  it("refuse une requête venant d'une autre origine", async () => {
    await seedWorld();
    const c = await loggedIn('responsable');
    const res = await c.agent
      .post('/api/auth/logout')
      .set('X-Requested-With', 'passage')
      .set('Origin', 'https://site-malveillant.example');
    expect(res.status).toBe(403);
  });
});
