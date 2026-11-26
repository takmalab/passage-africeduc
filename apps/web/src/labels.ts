import { REFUSAL_LABELS, type RefusalReason } from '@passage/shared';

export const ANOMALY_LABELS: Record<string, string> = {
  MISSED_CHECKPOINT: 'Passage manquant',
  OUT_OF_WINDOW: 'Hors fenêtre',
  UNEXPECTED_CHECKPOINT: 'Point hors itinéraire',
  DOUBLE_SCAN: 'Double scan',
  BADGE_REPLAY: 'Tentative de copie',
  INACTIVE_BADGE: 'Badge désactivé présenté',
};

export const ANOMALY_STATUS: Record<string, string> = {
  OPEN: 'Ouverte',
  ACKNOWLEDGED: 'Vue',
  RESOLVED: 'Résolue',
  AUTO_RESOLVED: 'Close automatiquement',
};

export const BADGE_STATUS: Record<string, string> = {
  PENDING_ACTIVATION: 'À activer',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspendue',
  LOST: 'Perdue',
  REVOKED: 'Révoquée',
};

export const BADGE_KIND: Record<string, string> = {
  NFC: 'Carte NFC',
  PRINTED: 'Carte QR imprimée',
};

export const MESSAGE_STATUS: Record<string, string> = {
  PENDING: 'En attente',
  SENT: 'Envoyé',
  FAILED: 'Échec',
  SUPPRESSED: 'Non envoyé',
};

export const EXCEPTION_TYPES: Record<string, string> = {
  HOLIDAY: 'Jour férié',
  JUSTIFIED_ABSENCE: 'Absence justifiée',
  EARLY_EXIT_AUTHORIZED: 'Sortie anticipée autorisée',
};

export const CHECKPOINT_TYPES: Record<string, string> = {
  GATE: 'Portail',
  BUS: 'Bus',
};

export const ORIGIN_LABELS: Record<string, string> = {
  MODEL: 'Rédigée par le modèle',
  MODEL_AFTER_RETRY: 'Rédigée par le modèle (après un nouvel essai)',
  TEMPLATE: 'Gabarit',
};

export const CLOCK_LABELS: Record<string, string> = {
  OK: 'Heure fiable',
  CORRECTED: 'Horloge corrigée',
  UNRELIABLE: 'Heure incohérente',
};

export const refusalLabel = (reason?: string | null) =>
  reason ? (REFUSAL_LABELS[reason as RefusalReason] ?? reason) : '';

export const fmtTime = (iso: string | number) =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Africa/Douala',
  });

export const fmtDateTime = (iso: string | number) =>
  new Date(iso).toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Africa/Douala',
  });
