import { logger } from '../../lib/logger.js';

export type OutgoingMessage = {
  id: string;
  parentId: string;
  body: string;
};

/**
 * Point d'extension pour un vrai fournisseur (SMS Orange / MTN, WhatsApp, e-mail).
 * Brancher un fournisseur = écrire une classe qui implémente cette interface
 * et l'ajouter dans `getProvider()`. Rien d'autre ne change.
 */
export interface NotificationProvider {
  readonly name: string;
  send(message: OutgoingMessage): Promise<void>;
}

/**
 * Fournisseur par défaut : la table OutboundMessage EST la boîte d'envoi.
 * On journalise sans le contenu (qui concerne un mineur) et on considère
 * l'envoi réussi.
 */
export class OutboxProvider implements NotificationProvider {
  readonly name = 'outbox';
  async send(message: OutgoingMessage): Promise<void> {
    logger.info({ messageId: message.id }, 'Message parent prêt (boîte d’envoi simulée)');
  }
}

let provider: NotificationProvider = new OutboxProvider();

export function getProvider(): NotificationProvider {
  return provider;
}

/** Utilisé par les tests pour simuler un fournisseur en panne. */
export function setProvider(next: NotificationProvider): void {
  provider = next;
}
