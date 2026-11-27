import { env, type Env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export type OutgoingMessage = {
  id: string;
  parentId: string;
  body: string;
};

/**
 * Point d'extension pour un vrai fournisseur (SMS Orange / MTN, WhatsApp, e-mail).
 * Brancher un fournisseur = écrire une classe qui implémente cette interface,
 * l'ajouter à PROVIDERS ci-dessous et à la liste NOTIFY_PROVIDER de config/env.ts,
 * puis régler NOTIFY_PROVIDER dans le .env. Rien d'autre ne change.
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

/** Fournisseurs disponibles, choisis par NOTIFY_PROVIDER (validé au démarrage). */
const PROVIDERS: Record<Env['NOTIFY_PROVIDER'], () => NotificationProvider> = {
  outbox: () => new OutboxProvider(),
  // Exemple : 'orange-sms': () => new OrangeSmsProvider(env.ORANGE_SMS_API_KEY),
};

let provider: NotificationProvider = PROVIDERS[env.NOTIFY_PROVIDER]();

export function getProvider(): NotificationProvider {
  return provider;
}

/** Utilisé par les tests pour simuler un fournisseur en panne. */
export function setProvider(next: NotificationProvider): void {
  provider = next;
}
