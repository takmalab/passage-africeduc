/**
 * Anti-relecture du lecteur QR. La caméra décode le même QR plusieurs fois par
 * seconde tant qu'il reste devant elle : sans ce garde, une seule présentation
 * enverrait un scan toutes les quelques secondes (et, pour un code déjà utilisé,
 * autant d'alertes « tentative de copie » au parent).
 *
 * Règle : un code identique au précédent n'est renvoyé que s'il a disparu de la
 * caméra pendant au moins `quietMs`. Chaque nouvelle lecture du même code
 * prolonge l'attente. Un code différent passe immédiatement.
 */
export function createRepeatGuard(quietMs: number) {
  let lastCode: string | null = null;
  let lastSeenAt = 0;

  return function accept(code: string, now: number): boolean {
    const sameAsBefore = code === lastCode && now - lastSeenAt < quietMs;
    lastCode = code;
    lastSeenAt = now; // toujours mis à jour : le QR encore visible prolonge l'attente
    return !sameAsBefore;
  };
}
