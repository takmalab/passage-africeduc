---
name: passage-domain
description: Règles métier de Passage (badges NFC et QR, synchronisation hors ligne, horloge, anomalies, notifications, synthèse IA). À lire avant toute modification de ces domaines.
---

# Règles métier de Passage

## Badges (apps/api/src/modules/badges)
- Carte NFC NTAG 424 DNA (mode SUN) : code `PSG1.N.<p>.<c>`. `p` déchiffré avec la clé méta de l'établissement donne UID + compteur ; `c` vérifié avec la clé MAC du badge. Clés dérivées de `BADGE_KEYS_MASTER_KEY` (keys.ts), jamais stockées.
- Un compteur ne sert qu'une fois (`BadgeCodeUse` PK). Compteur plus petit qu'un compteur vu plus tôt = `CODE_OUT_OF_ORDER`.
- Carte QR imprimée `PSG1.S.<publicId>.<secret>` : désactivée par défaut ; une validation par point dans `PRINTED_REUSE_MINUTES`.
- Un seul badge vivant par élève (index partiel). Réémission = ancien LOST/REVOKED dans la même transaction.
- Vérifier toute modification avec `test/unit/nfc-crypto.test.ts` (vecteurs NXP) et `badges.int.test.ts`.

## Synchronisation (modules/sync, apps/web/src/offline)
- Idempotence par `(deviceId, localEventId)`. Le téléphone ne retire un scan qu'après accusé.
- Horloge : décalage = heure serveur - heure envoyée par l'appareil, appliqué au lot (clock.ts).

## Anomalies (modules/anomalies)
- Règles à la réception (hors fenêtre, hors itinéraire, double scan, copie, badge inactif) ; passage manquant par le programme de fond (`worker/scheduler.ts`), clé `MISSED:<étape>:<date>`.
- Exceptions du jour : suspendent les règles d'itinéraire, pas les alertes de sécurité.
- Heures en minutes locales du fuseau de l'établissement (`localParts`).

## Synthèse IA (modules/summary)
- Chiffres = `computeFacts` uniquement. Le modèle écrit un gabarit à marqueurs ; `guard.ts` refuse chiffres et quantités. 1 nouvel essai puis gabarit. Journal `AiCall`, budget, cache.
