# Architecture

```
apps/web (PWA)  --HTTPS, cookie de session-->  apps/api (Express 5)  --Prisma-->  PostgreSQL
   IndexedDB (file de scans)                     routes -> services          contraintes uniques,
   Web NFC / caméra                              programme de fond           index partiel, CHECK
                                                 LlmClient -> Groq (optionnel)
                                                 NotificationProvider -> boîte d'envoi
```

Une seule application Node sert l'API (`/api`) et la PWA construite : même origine, pas de CORS.

## Couches

- **Routes** (`*.routes.ts`) : HTTP, rôle (`requireRole`), validation Zod, audit.
- **Services** (`*.service.ts`) : règles métier, testables sans HTTP.
- **Données** : Prisma 7 (adaptateur `pg`), migrations SQL versionnées.

## Flux d'un scan

1. Le téléphone écrit le scan dans IndexedDB (UUID, heure locale).
2. Il envoie la file par lots à `POST /api/agent/sync` avec son heure courante.
3. Le serveur corrige l'heure, vérifie le badge (verrou par badge), enregistre le passage, renvoie un accusé par scan.
4. Le téléphone retire les scans confirmés.
5. Le serveur évalue les anomalies et prépare les messages.

## Programme de fond (chaque minute)

Passages manquants (fenêtres closes + 15 min, veille comprise) ; envoi des messages en attente ; nettoyage des sessions. Verrou consultatif PostgreSQL lié à une transaction.

## Modèle de données

Voir `apps/api/prisma/schema.prisma` (commenté) et DECISIONS.md D9.
