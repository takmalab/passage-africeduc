import { MAX_EVENTS_PER_BATCH, type SyncResponse } from '@passage/shared';
import { getDeviceId, type PassageDb, type QueuedScan, type ScanResult } from './db';

export type SendBatch = (body: {
  deviceId: string;
  deviceSentAt: number;
  events: QueuedScan[];
}) => Promise<SyncResponse>;

export class AuthRequiredError extends Error {}

/**
 * Moteur de synchronisation.
 *
 * 1. Un scan est d'abord écrit dans la file locale (jamais perdu, même si
 *    l'onglet se ferme).
 * 2. `flush()` envoie la file par lots. Il ne retire un scan de la file
 *    qu'après l'accusé du serveur. Si la connexion coupe pendant l'envoi,
 *    rien n'est retiré : le prochain envoi renvoie tout, et le serveur
 *    reconnaît ce qu'il a déjà (idempotence par identifiant d'événement).
 * 3. Un seul envoi à la fois (verrou en mémoire).
 */
export class SyncEngine {
  private flushing: Promise<number> | null = null;

  constructor(
    private readonly store: PassageDb,
    private readonly send: SendBatch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async enqueue(scan: Omit<QueuedScan, 'localEventId' | 'deviceLocalTime'>, label: string) {
    const item: QueuedScan = {
      ...scan,
      localEventId: crypto.randomUUID(),
      deviceLocalTime: this.now(),
    };
    await this.store.transaction('rw', this.store.queue, this.store.results, async () => {
      await this.store.queue.add(item);
      await this.store.results.put({
        localEventId: item.localEventId,
        at: item.deviceLocalTime,
        checkpointLabel: label,
        status: 'pending',
      });
    });
    return item;
  }

  pendingCount(): Promise<number> {
    return this.store.queue.count();
  }

  /** Envoie toute la file. Renvoie le nombre de scans confirmés. */
  flush(): Promise<number> {
    this.flushing ??= this.doFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async doFlush(): Promise<number> {
    const deviceId = await getDeviceId(this.store);
    let confirmed = 0;
    for (;;) {
      const batch = await this.store.queue.orderBy('deviceLocalTime').limit(MAX_EVENTS_PER_BATCH).toArray();
      if (batch.length === 0) return confirmed;

      // En cas d'erreur réseau, l'exception remonte et la file reste intacte.
      const response = await this.send({ deviceId, deviceSentAt: this.now(), events: batch });

      const acked = response.acks.map((a) => a.localEventId);
      await this.store.transaction('rw', this.store.queue, this.store.results, async () => {
        for (const ack of response.acks) {
          const status: ScanResult['status'] =
            ack.storage === 'invalid' ? 'invalid' : ack.verdict === 'ACCEPTED' ? 'accepted' : 'refused';
          await this.store.results.update(ack.localEventId, {
            status,
            firstName: ack.studentFirstName,
            reason: ack.reason,
          });
        }
        await this.store.queue.bulkDelete(acked);
      });
      confirmed += acked.length;
      if (acked.length === 0) return confirmed; // sécurité : ne jamais boucler sans progrès
    }
  }

  /** Garde le journal des verdicts court (les 50 derniers). */
  async trimResults(keep = 50) {
    const count = await this.store.results.count();
    if (count <= keep) return;
    const old = await this.store.results.orderBy('at').limit(count - keep).primaryKeys();
    await this.store.results.bulkDelete(old);
  }
}
