export type ClockAssessment = {
  /** Décalage estimé de l'appareil : heure serveur - heure appareil (ms). */
  offsetMs: number;
  /** Heure retenue pour le passage. */
  effectiveTime: Date;
  status: 'OK' | 'CORRECTED' | 'UNRELIABLE';
};

export type ClockPolicy = {
  /** Au-delà de cet écart, le passage est marqué « horloge corrigée ». */
  skewFlagSeconds: number;
  /** Un passage plus ancien que cette durée (après correction) est mis de côté. */
  maxAgeHours: number;
};

/**
 * Correction de l'horloge de l'appareil de l'agent.
 *
 * À chaque envoi, l'appareil transmet son heure (`deviceSentAt`). L'écart avec
 * l'heure du serveur à la réception donne le décalage de son horloge, que l'on
 * applique à l'heure locale de chaque scan du lot. Le temps de transit (quelques
 * centaines de ms) est négligeable devant les fenêtres de plusieurs minutes.
 *
 * Hypothèse documentée : le décalage n'a pas changé entre le scan et l'envoi.
 * Si l'heure corrigée reste impossible (dans le futur, ou trop ancienne), le
 * passage est conservé mais mis de côté (UNRELIABLE) : jamais compté en silence.
 */
export function assessClock(
  deviceLocalTime: number,
  deviceSentAt: number,
  serverReceivedAt: number,
  policy: ClockPolicy,
): ClockAssessment {
  const offsetMs = serverReceivedAt - deviceSentAt;
  const effective = deviceLocalTime + offsetMs;
  const futureLimit = serverReceivedAt + 60_000;
  const pastLimit = serverReceivedAt - policy.maxAgeHours * 3600_000;

  let status: ClockAssessment['status'] =
    Math.abs(offsetMs) > policy.skewFlagSeconds * 1000 ? 'CORRECTED' : 'OK';
  if (effective > futureLimit || effective < pastLimit || deviceLocalTime > deviceSentAt + 60_000) {
    status = 'UNRELIABLE';
  }
  return { offsetMs, effectiveTime: new Date(effective), status };
}
