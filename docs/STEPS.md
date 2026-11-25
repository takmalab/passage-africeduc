# Feuille de route pas à pas

Suivre les étapes **dans l'ordre**. Chaque étape a un objectif, les commandes, et un critère « c'est bon quand ». Cocher au fur et à mesure.

Échéance : **samedi 28 novembre 2026, 23:59** (viser l'envoi à 18:00). Le lien du dépôt et un point d'étape d'une ligne étaient attendus au **Jour 2** : si ce n'est pas fait, c'est la toute première chose à faire (étape 2).

> Règle d'or du sujet : savoir expliquer **chaque ligne** du code. Les étapes 4 et 9 sont là pour ça. Ne pas les sauter.

---

## Étape 0. Prérequis (Windows)

- [ ] Ouvrir **PowerShell** (pas besoin d'être administrateur pour la plupart des outils).
- [ ] Vérifier que `winget` existe : `winget --version`. Sinon, installer « App Installer » depuis le Microsoft Store.
- [ ] Recommandé : **Docker Desktop** (`winget install Docker.DockerDesktop`, redémarrer, lancer Docker Desktop une fois).

C'est bon quand : `winget --version` répond.

## Étape 1. Installation automatique

Décompresser le zip, puis dans le dossier du projet :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -RepoName passage
```

Le script installe ce qui manque (**Git, Node.js 22, GitHub CLI `gh`**), démarre PostgreSQL dans Docker, crée `.env` avec une clé aléatoire, installe les dépendances, applique les migrations, charge les données de démo, configure git, puis vous connecte à GitHub et **crée le dépôt public**.

Sans Docker : installer PostgreSQL 16 (`winget install PostgreSQL.PostgreSQL.16`), puis dans « SQL Shell (psql) » :

```sql
CREATE USER passage WITH PASSWORD 'passage' CREATEDB;
CREATE DATABASE passage OWNER passage;
CREATE DATABASE passage_test OWNER passage;
```

puis `npm run db:deploy` et `npm run db:seed`.

Si un outil vient d'être installé et n'est « pas reconnu » : fermer et rouvrir PowerShell, relancer le script (il ne refait pas ce qui est déjà fait).

C'est bon quand : le script affiche « Terminé » et `npm test` affiche **100 tests passés**.

## Étape 2. Dépôt GitHub et premier courriel (urgent)

- [ ] Le script a créé le dépôt. Sinon : `gh repo create passage --public --source . --remote origin --push`.
- [ ] Dans `README.md`, remplacer `OWNER/REPO` par le vrai chemin (ex. `jean-dupont/passage`) puis :
  ```powershell
  git add README.md; git commit -m "docs: badges CI du dépôt"; git push
  ```
- [ ] Vérifier l'onglet **Actions** du dépôt : CI et Sécurité au vert.
- [ ] Envoyer le courriel d'étape (une ligne) :
  > Dépôt : https://github.com/…/passage. Fait : architecture, base, authentification, badges, synchronisation hors ligne, anomalies, CI. En cours : tests sur téléphone et vidéos. Aucun blocage.

C'est bon quand : le lien est envoyé et le badge CI est vert.

## Étape 3. Faire tourner l'application

```powershell
npm run dev
```

Ouvrir http://localhost:5173 et se connecter avec chaque compte (mot de passe `Passage2026!`) : `responsable`, `agent`, `parent.awa`, `parent.kevin`.

- [ ] Responsable > Journée : choisir la date de la veille (journée de démo) : 5 anomalies, 17 passages.
- [ ] Responsable > Simulateur de carte : « Poser la carte de Awa », copier le code.
- [ ] Agent (autre navigateur ou fenêtre privée) > Saisie : coller le code : **accepté**. Recoller le même code : **refusé, code déjà utilisé**.
- [ ] Responsable > Synthèse IA : classe 3e A, date de la veille : phrase « Gabarit » (pas de clé).

C'est bon quand : les 4 points ci-dessus fonctionnent.

## Étape 4. Comprendre le code (indispensable pour l'entretien)

Lire dans cet ordre, en se posant à chaque fois « pourquoi c'est fait ainsi » (les réponses sont dans DECISIONS.md) :

1. [ ] `apps/api/prisma/schema.prisma` et `prisma/migrations/*` (contraintes uniques, index partiel, CHECK)
2. [ ] `apps/api/src/app.ts`, `middleware/auth.ts`, `middleware/security.ts`
3. [ ] `modules/auth/*` (hachage, blocage, message unique)
4. [ ] `modules/badges/nfc-crypto.ts`, `keys.ts`, `badge-verifier.ts` (cœur de la sécurité du badge)
5. [ ] `modules/sync/clock.ts`, `sync.service.ts` (idempotence, horloge)
6. [ ] `apps/web/src/offline/sync-engine.ts` (file hors ligne)
7. [ ] `modules/anomalies/anomalies.service.ts`, `worker/scheduler.ts` (passage manquant)
8. [ ] `modules/notifications/*` (plafond, fournisseur)
9. [ ] `modules/summary/*` (garde-fous IA)
10. [ ] Les tests `apps/api/test/integration/*.ts` : chaque test raconte un scénario du sujet.

Astuce : dans Claude Code, demander « explique-moi ce fichier ligne par ligne comme pour un entretien » (skill `passage-restitution`).

C'est bon quand : vous savez expliquer à voix haute les 5 points : carte NFC, idempotence, horloge, programme de fond, garde-fous IA.

## Étape 5. Clé Mistral (facultatif)

- [ ] Créer une clé sur https://console.mistral.ai (offre gratuite « Experiment »).
- [ ] La mettre dans `.env` : `MISTRAL_API_KEY=...` (jamais dans le dépôt).
- [ ] Redémarrer, régénérer la synthèse : origine « Rédigée par le modèle ». Regénérer : « Cache : non facturé ».

## Étape 6. Ajustements personnels (et commits réguliers)

Faire **au moins 4 à 6 commits personnels** répartis sur les jours restants (le sujet élimine un dépôt à un seul commit et regarde la régularité). Idées utiles et petites :

- [ ] Ajuster les textes de l'interface ou des messages parents (`modules/notifications/templates.ts`).
- [ ] Ajouter un écran de liaison parent-élève (actuellement uniquement dans le seed).
- [ ] Ajouter la création d'un point de contrôle dans l'interface (l'API existe : `POST /api/manager/checkpoints`).
- [ ] Ajouter un test de votre choix.
- [ ] Compléter **JOURNAL-IA.md** à chaque usage notable de l'IA (une ligne dans le tableau).

Avant chaque commit : `npm run verify`.

## Étape 7. Test réel sur téléphone

- **Avec Internet** : déployer (voir `docs/DEPLOIEMENT.md`, 2 h maximum), ouvrir l'URL HTTPS sur le téléphone de l'agent.
- **Sans Internet** : `npm run cert:lan`, ajouter les 2 lignes affichées au `.env`, `npm run build`, `npm start`, ouvrir `https://<ip-du-pc>:8443` sur le téléphone (partage de connexion du PC), accepter l'avertissement.

À tester :

- [ ] Mode QR : scanner le QR du simulateur affiché sur l'écran du PC.
- [ ] Mode avion : scanner 3 cartes, voir « 3 en attente », réactiver le réseau, voir l'envoi.
- [ ] Cartes QR imprimées (option bon marché) : Paramètres > autoriser, fiche élève > « Émettre une carte QR imprimée » > Imprimer.
- [ ] Cartes NFC réelles si vous en avez (NTAG 424 DNA) : voir `docs/BADGES.md`.

## Étape 8. Vidéos

- [ ] **Démo technique** (6 min max, en local) : suivre `docs/video/DEMO-SCRIPT.md` scène par scène. OBS Studio (`winget install OBSProject.OBSStudio`). Mettre en ligne sur YouTube en « non répertorié ».
- [ ] **Capsule** (60 à 90 s) : `docs/video/CAPSULE-SCRIPT.md` + sous-titres `capsule.srt`. CapCut (sous-titres incrustés, transition, image de fin), voix off naturelle (ElevenLabs ou votre voix).
- [ ] Vérifier les deux liens dans une fenêtre privée (aucune demande d'accès).

## Étape 9. Préparer l'entretien

- [ ] Lire `docs/RESTITUTION.md` et répondre à voix haute aux questions.
- [ ] S'entraîner aux 3 modifications en direct listées (chronométrer : 10 min).
- [ ] Vérifier que la démo marche **sans Internet** (couper le Wi-Fi) : mode dégradé de l'IA visible.

## Étape 10. Envoi final

- [ ] `npm run verify` vert, CI verte sur GitHub.
- [ ] README à jour (section « Ce qui n'est pas terminé » honnête).
- [ ] Un seul courriel avec : lien du dépôt, lien démo, lien capsule (README, DECISIONS, JOURNAL-IA sont dans le dépôt).
