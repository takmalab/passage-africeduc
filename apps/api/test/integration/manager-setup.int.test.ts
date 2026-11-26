import { describe, expect, it } from 'vitest';
import { loggedIn, seedWorld } from './helpers.js';

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
