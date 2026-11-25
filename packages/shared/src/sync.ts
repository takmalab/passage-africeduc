import { z } from 'zod';

/**
 * Protocole de synchronisation des scans hors ligne.
 *
 * Le téléphone de l'agent crée, au moment du scan, un `localEventId` (UUID).
 * Le couple (deviceId, localEventId) est unique en base : renvoyer un lot
 * plusieurs fois ne crée jamais de doublon (voir DECISIONS.md, D2).
 */

export const MAX_EVENTS_PER_BATCH = 200;

export const scanEventSchema = z.object({
  localEventId: z.uuid(),
  rawCode: z.string().min(1).max(256),
  checkpointId: z.uuid(),
  /** Heure de l'appareil au moment du scan (ms depuis 1970), possiblement fausse. */
  deviceLocalTime: z.number().int().nonnegative(),
});

export const syncBatchSchema = z.object({
  deviceId: z.uuid(),
  /** Heure de l'appareil au moment de l'envoi : sert à estimer son décalage d'horloge. */
  deviceSentAt: z.number().int().nonnegative(),
  events: z.array(scanEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

export type ScanEvent = z.infer<typeof scanEventSchema>;
export type SyncBatch = z.infer<typeof syncBatchSchema>;

/** Résultat de stockage : créé, déjà reçu (renvoi), ou invalide (jamais stocké). */
export type StorageStatus = 'created' | 'duplicate' | 'invalid';

/** Décision sur le badge pour un passage stocké. */
export type PassageVerdict = 'ACCEPTED' | 'REFUSED';

export type RefusalReason =
  | 'MALFORMED_CODE'
  | 'UNKNOWN_BADGE'
  | 'BAD_SIGNATURE'
  | 'CODE_ALREADY_USED'
  | 'CODE_OUT_OF_ORDER'
  | 'BADGE_INACTIVE'
  | 'PRINTED_BADGES_DISABLED'
  | 'CLOCK_UNRELIABLE'
  | 'UNKNOWN_CHECKPOINT';

export type EventAck = {
  localEventId: string;
  storage: StorageStatus;
  verdict?: PassageVerdict;
  reason?: RefusalReason;
  /** Prénom de l'élève, renvoyé à l'agent pour un contrôle visuel quand le badge est accepté. */
  studentFirstName?: string;
};

export type SyncResponse = {
  serverTime: number;
  clockOffsetMs: number;
  acks: EventAck[];
};

/** Libellés français des motifs de refus, affichés à l'agent et au responsable. */
export const REFUSAL_LABELS: Record<RefusalReason, string> = {
  MALFORMED_CODE: 'QR illisible ou non reconnu',
  UNKNOWN_BADGE: 'Badge inconnu',
  BAD_SIGNATURE: 'Signature invalide (carte falsifiée)',
  CODE_ALREADY_USED: 'Code déjà utilisé (copie probable)',
  CODE_OUT_OF_ORDER: 'Code plus ancien qu’un passage déjà enregistré (copie probable)',
  BADGE_INACTIVE: 'Badge suspendu, perdu ou révoqué',
  PRINTED_BADGES_DISABLED: 'Cartes QR imprimées désactivées dans cet établissement',
  CLOCK_UNRELIABLE: 'Heure de l’appareil incohérente, passage mis de côté',
  UNKNOWN_CHECKPOINT: 'Point de contrôle inconnu',
};
