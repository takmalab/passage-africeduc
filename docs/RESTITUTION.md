# Préparer l'entretien (30 min)

## 1. Démo (10 min, en local, sans connexion)

Suivre `docs/video/DEMO-SCRIPT.md`. Couper le Wi-Fi avant : la synthèse passe en gabarit, c'est voulu.

## 2. Questions probables et éléments de réponse

| Question                                                        | Réponse courte                                                                           | Où dans le code                        |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| Pourquoi une photo du badge ne marche pas ?                     | La puce signe chaque lecture avec un compteur ; un compteur ne sert qu'une fois          | `badge-verifier.ts`, `BadgeCodeUse`    |
| Comment évitez-vous les doublons à la synchronisation ?         | UUID créé au scan + contrainte unique (appareil, UUID) ; retrait de la file après accusé | `sync.service.ts`, `sync-engine.ts`    |
| Et si le téléphone a 2 h d'avance ?                             | Décalage mesuré à l'envoi, appliqué au lot, passage marqué « horloge corrigée »          | `clock.ts`                             |
| Comment détecter ce qui n'a pas eu lieu ?                       | Programme de fond chaque minute, fenêtres closes + délai de grâce, clé unique            | `anomalies.service.ts`, `scheduler.ts` |
| Que se passe-t-il si un scan hors ligne arrive après l'alerte ? | Anomalie close automatiquement + message de rectification                                | `autoResolveMissed`                    |
| Comment le modèle ne peut-il pas inventer un chiffre ?          | Il écrit un gabarit à marqueurs, le code refuse tout chiffre ou quantité et remplit      | `guard.ts`                             |
| Pourquoi pas JWT ?                                              | Révocation réelle à la déconnexion                                                       | DECISIONS D8                           |
| Un parent peut-il voir un autre enfant ?                        | Non : filtre dans la requête SQL, 404 identique, audit                                   | `parent.service.ts`                    |
| Quelle part avez-vous écrite ?                                  | Réponse honnête, cohérente avec JOURNAL-IA.md                                            |                                        |

## 3. Modifications en direct : s'entraîner

1. **Passer le plafond de messages à 2** : `.env` `NOTIFY_MAX_PER_STUDENT_PER_DAY=2`, relancer ; adapter le test si besoin.
2. **Changer la fenêtre de tolérance du double scan à 90 s** : `DOUBLE_SCAN_SECONDS`.
3. **Ajouter un type d'anomalie** (ex. « passage le week-end ») : enum `AnomalyType` dans `schema.prisma` + migration, règle dans `evaluatePassage`, libellé dans `labels.ts` et `templates.ts`, un test.
4. **Ajouter un champ** (ex. téléphone du parent) : `schema.prisma`, `npm run db:migrate -- --name parent_phone`, seed, affichage.
