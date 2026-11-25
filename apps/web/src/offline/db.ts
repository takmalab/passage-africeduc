import Dexie, { type EntityTable } from 'dexie';
import type { EventAck } from '@passage/shared';

/**
 * Stockage local du téléphone de l'agent (IndexedDB, via Dexie).
 *
 * - `queue` : scans en attente d'accusé du serveur. Un scan n'en sort QUE
 *   lorsque le serveur a confirmé l'avoir reçu (créé ou déjà reçu).
 * - `results` : journal des derniers verdicts, affiché à l'agent.
 * - `meta` : identifiant de l'appareil, points de contrôle en cache, décalage
 *   d'horloge connu.
 *
 * Aucune donnée d'élève n'est conservée, sauf le prénom renvoyé à l'agent pour
 * un contrôle visuel, et seulement dans le journal des derniers verdicts.
 */

export type QueuedScan = {
  localEventId: string;
  rawCode: string;
  checkpointId: string;
  deviceLocalTime: number;
};

export type ScanResult = {
  localEventId: string;
  at: number;
  checkpointLabel: string;
  status: 'pending' | 'accepted' | 'refused' | 'invalid';
  firstName?: string;
  reason?: EventAck['reason'];
};

export type Meta = { key: string; value: unknown };

export class PassageDb extends Dexie {
  queue!: EntityTable<QueuedScan, 'localEventId'>;
  results!: EntityTable<ScanResult, 'localEventId'>;
  meta!: EntityTable<Meta, 'key'>;

  constructor(name = 'passage') {
    super(name);
    this.version(1).stores({
      queue: 'localEventId, deviceLocalTime',
      results: 'localEventId, at',
      meta: 'key',
    });
  }
}

export const db = new PassageDb();

export async function getMeta<T>(key: string, store = db): Promise<T | undefined> {
  return (await store.meta.get(key))?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown, store = db): Promise<void> {
  await store.meta.put({ key, value });
}

/** Identifiant stable de l'appareil, créé une fois. */
export async function getDeviceId(store = db): Promise<string> {
  const existing = await getMeta<string>('deviceId', store);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await setMeta('deviceId', id, store);
  return id;
}
