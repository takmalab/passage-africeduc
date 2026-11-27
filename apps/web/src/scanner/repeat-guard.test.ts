import { describe, expect, it } from 'vitest';
import { createRepeatGuard } from './repeat-guard';

describe('anti-relecture du lecteur QR', () => {
  it('ne renvoie pas le même code tant qu’il reste devant la caméra, même longtemps', () => {
    const accept = createRepeatGuard(3000);
    expect(accept('A', 0)).toBe(true);
    // Le QR reste visible : lu 5 fois par seconde pendant 20 s, jamais renvoyé.
    for (let t = 200; t <= 20_000; t += 200) expect(accept('A', t)).toBe(false);
  });

  it('relit le même code après 3 s hors de la caméra (badge présenté une seconde fois)', () => {
    const accept = createRepeatGuard(3000);
    expect(accept('A', 0)).toBe(true);
    expect(accept('A', 1000)).toBe(false);
    expect(accept('A', 4001)).toBe(true); // absent de 1 000 à 4 001 ms
  });

  it('accepte tout de suite un code différent', () => {
    const accept = createRepeatGuard(3000);
    expect(accept('A', 0)).toBe(true);
    expect(accept('B', 100)).toBe(true);
    expect(accept('A', 200)).toBe(true);
  });
});
