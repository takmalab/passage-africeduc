# Journal d'usage de l'IA

> Ce journal doit être **vrai**. Les entrées ci-dessous décrivent la phase de préparation réellement menée avec Claude. Le candidat complète la section « Suite du développement » au fil de son propre travail, avec ses propres corrections. Supprimer ou enjoliver une entrée est exactement ce que le sujet sanctionne.

## Outils utilisés

| Outil                                      | Usage                                                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Claude (claude.ai, modèle Claude Opus 5.5) | Lecture du sujet, analyse, document de compréhension, génération de la base du projet (code, tests, CI, documentation) |
| Claude Code                                | Suite du développement sur le poste du candidat (voir CLAUDE.md et `.claude/skills`)                                   |
| Mistral (`mistral-small-latest`)           | Dans le produit uniquement : rédaction de la synthèse du jour                                                          |

## Pour quoi l'IA a servi

- Comprendre le sujet et lister les cas d'usage, les pièges et les critères éliminatoires.
- Rechercher l'état des technologies en novembre 2026 (Prisma 7 stable et Prisma 8 encore en préversion, Next.js 16, Mistral Small 4 et son mode JSON schema).
- Générer l'architecture, le code, les migrations, les tests et la CI, commit par commit.
- Retrouver et appliquer la spécification NXP AN12196 (cartes NTAG 424 DNA) avec ses vecteurs de test officiels.

**Chaque partie générée a été relue, exécutée et testée** : 100 tests automatisés, dont des tests d'intégration sur une vraie base PostgreSQL, et un test de bout en bout dans un navigateur (captures dans `docs/captures/`).

## Cas où une proposition de l'IA a été refusée ou corrigée

### 1. Badge sur téléphone refusé : les élèves n'ont pas de téléphone

L'IA a d'abord proposé un **QR code tournant affiché sur le téléphone de l'élève** (signature toutes les 30 s), en s'appuyant sur le scénario du sujet « badge affiché à l'écran ».

**Refusé** : au Cameroun, les élèves ne viennent pas à l'école avec un téléphone. Proposition remplacée par une **carte physique NFC sécurisée** (NTAG 424 DNA), qui garde la résistance à la copie. Leçon : une solution techniquement élégante peut être inutilisable sur le terrain.

### 2. Coût des cartes NFC : ajout d'un mode QR imprimé, renforcé

Le mode « carte QR imprimée » existait mais était seulement **détecté** en cas de copie. **Demande de correction** : les cartes NFC peuvent être trop chères pour certaines écoles, le mode QR doit être réellement utilisable. Ajout d'une règle d'usage unique par point de contrôle dans une fenêtre de 2 h, avec test : la photo du QR présentée après l'élève est refusée. La faiblesse restante est documentée (DECISIONS.md D1).

### 3. Bug du verrou du programme de fond, trouvé par les tests

Le code généré prenait un verrou PostgreSQL **de session** (`pg_try_advisory_lock`) puis le relâchait avec une autre requête. Avec un pool de connexions, la libération pouvait partir sur une autre connexion : le verrou restait bloqué et le programme de fond ne tournait plus. **Les tests d'intégration ont échoué** (aucune anomalie créée au deuxième passage). Corrigé avec un verrou **lié à une transaction** (`pg_try_advisory_xact_lock`), forcément libéré sur la même connexion.

### 4. Double alerte pour un même retard

Première version : un élève arrivé à 07:58 recevait deux anomalies, « hors fenêtre » **et** « passage manquant », donc deux messages au parent pour un seul événement. Repéré en relisant les données de démonstration. Corrigé : une étape déjà signalée hors fenêtre n'est plus déclarée manquante (test ajouté).

### 5. Next.js remplacé par Vite

Proposition initiale (humaine) : Next.js. L'IA a proposé Vite + React pour un hors ligne plus fiable ; accepté après explication (DECISIONS.md D10).

## Ce que l'IA n'a pas fait

- Aucune carte NFC réelle n'a été programmée ni lue : le simulateur reproduit le calcul de la puce, vérifié par les vecteurs NXP, mais le test sur matériel reste à faire.
- Les vidéos ne sont pas générées par l'IA : seuls les scripts et sous-titres sont fournis (`docs/video/`).

## Suite du développement (à compléter par le candidat)

| Date       | Outil                  | Demande                                                                         | Résultat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Accepté, corrigé ou refusé, et pourquoi                                                                                                                                                                                    |
| ---------- | ---------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 26/11/2026 | Claude Code (Opus 5.5) | Installer le projet sur mon poste (Linux, sans Docker)                          | PostgreSQL 16 et gh installés par moi (sudo), Node 22 via nvm, migrations et démo OK. `npm test` plantait (« Bus error ») : l'IA a trouvé un binaire rolldown tronqué (10,8 Mo au lieu de 21,1 Mo) par un premier `npm install` interrompu, corrigé par `npm ci`. 100 tests verts                                                                                                                                                                                                                          | Accepté. Le `.env` (clé maîtresse) a été créé par moi, pas par l'IA, qui n'a pas le droit de le lire                                                                                                                       |
| 26/11/2026 | Claude Code (Opus 5.5) | Brancher le projet sur mon dépôt existant                                       | Mon dépôt GitHub avait déjà 2 commits au même contenu. L'IA a montré la différence (seulement les droits d'exécution de 5 scripts) et proposé une fusion sans forcer                                                                                                                                                                                                                                                                                                                                       | Accepté. J'ai aussi demandé de réécrire l'auteur des 6 premiers commits : ils étaient signés avec mon ancienne identité git (« Jeffrey Nguimdo Kenfack ») ; c'est bien moi, réécrits en « takmalab » avant le premier push |
| 26/11/2026 | Claude Code (Opus 5.5) | Faire passer le workflow Sécurité au vert                                       | Gitleaks : erreur de l'outil au premier push (commit racine sans parent), pas une fuite ; analyse locale de tout l'historique avec la même version : aucun secret. npm audit : faille haute dans `effect` (dépendance de Prisma), corrigée par un `overrides` (DECISIONS D12). Premier essai de l'IA raté : retirer l'entrée du fichier de verrouillage avait supprimé `effect`, et l'audit « 0 faille » était trompeur ; repéré par l'échec de `prisma generate`, corrigé en modifiant l'entrée du verrou | Accepté après explication des deux options (corriger ou accepter la faille)                                                                                                                                                |
| 26/11/2026 | Claude Code (Opus 5.5) | Je n'arrivais pas à me connecter dans le navigateur (`npm run dev`)             | L'IA a lu les journaux : chaque connexion était refusée (403) par le contrôle anti-CSRF, car le relais de Vite remplaçait l'hôte par localhost:3000 alors que la page venait de localhost:5173. Ses propres tests de l'étape 3 ne l'avaient pas vu (script sans en-tête Origin). Correction limitée à la configuration de développement (`changeOrigin: false`) ; vérifié : connexion acceptée, requête d'un autre site et requête sans en-tête toujours refusées (403)                                    | Accepté. Contrôle anti-CSRF inchangé ; problème absent en production (même origine)                                                                                                                                        |
| 26/11/2026 | Claude Code (Opus 5.5) | Fonctionnalité : créer un point de contrôle depuis l'interface (l'API existait) | Test d'intégration écrit d'abord : il a révélé qu'un nom en double renvoyait une erreur 500 au lieu d'un message clair. Corrigé (409, « Un point de contrôle porte déjà ce nom. ») ; carte « Points de contrôle » ajoutée dans Paramètres                                                                                                                                                                                                                                                                  | Accepté. Ordre des fonctionnalités choisi par moi : points de contrôle, classes, comptes, liens parent-élève                                                                                                               |
| 26/11/2026 | Claude Code (Opus 5.5) | Fonctionnalité : créer une classe                                               | Nouvelle route `POST /manager/classrooms` (rôle responsable, Zod strict, établissement pris dans la session, doublon = 409), carte « Classes » dans Paramètres. Tests d'abord (rouges, puis verts), dont le refus d'inscrire un élève dans la classe d'une autre école                                                                                                                                                                                                                                     | Accepté                                                                                                                                                                                                                    |
