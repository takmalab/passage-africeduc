# CLAUDE.md

Consignes pour Claude Code dans ce dépôt. Projet : **Passage**, test technique Afric'Éduc (sujet B), à rendre le 28/11/2026 à 23:59.

## Contexte essentiel

- Le candidat doit pouvoir **expliquer chaque ligne** en entretien : préférer du code simple et commenté en français, des changements petits, et expliquer ce qui a été fait.
- La sécurité vaut 20 points et a des critères **éliminatoires** : ne jamais affaiblir un contrôle existant (voir skill `passage-security-review`).
- La feuille de route est `docs/STEPS.md`. Les décisions sont dans `DECISIONS.md`. Toute nouvelle décision y va.
- Toute aide significative de l'IA est notée dans `JOURNAL-IA.md` (section « Suite du développement »), **honnêtement**.

## Commandes

```bash
npm run dev          # API :3000 + PWA :5173
npm test             # tous les tests (base passage_test recréée)
npm run verify       # lint + types + tests + build (comme la CI)
npm run db:deploy    # appliquer les migrations
npm run db:seed      # données de démo (vide la base)
npm run db:migrate -- --name <nom>   # nouvelle migration après modification du schéma
```

## Architecture

- `packages/shared` : formats de badge, protocole de synchronisation, heures locales (utilisés par l'API et la PWA).
- `apps/api` : Express 5. `src/modules/<domaine>/` contient `*.routes.ts` (HTTP, validation Zod, rôle) et `*.service.ts` (règles métier, Prisma). Pas de logique métier dans les routes.
- `apps/web` : Vite + React PWA. `src/offline` (IndexedDB, moteur de synchronisation), `src/scanner` (NFC, QR), `src/pages`.

## Règles du code

- Code en anglais, commentaires, interface, messages et documentation en **français**. Pas d'emoji dans l'interface : icônes `lucide-react`.
- Toute route : `requireRole(...)` + schéma Zod `.strict()`. Toute requête d'un parent : filtre « mes enfants » dans la requête, 404 sinon.
- Jamais de SQL construit avec du texte saisi ; `$queryRaw` uniquement en gabarit balisé.
- Jamais de secret dans le code ou les tests (sauf la clé de test documentée dans `vitest.config.ts`).
- Les nombres de la synthèse IA viennent **uniquement** de `computeFacts` ; ne jamais laisser le modèle écrire un chiffre.
- Toute nouvelle règle métier = un test d'intégration dans `apps/api/test/integration`.
- Après modification de `schema.prisma` : `npm run db:migrate -- --name ... --create-only`, relire le SQL généré (il ne doit **pas** supprimer l'index `Badge_one_live_per_student` ni les contraintes CHECK de la migration `integrity_constraints`), puis appliquer.

## Commits

Messages en français, style conventionnel : `feat(api): ...`, `fix(web): ...`, `test: ...`, `docs: ...`. Commits petits et réguliers (le sujet élimine un dépôt à commit unique). Lancer `npm run verify` avant chaque commit.

## Skills du projet

- `passage-domain` : règles métier (badges, synchronisation, horloge, anomalies, synthèse).
- `passage-security-review` : liste de contrôle avant commit.
- `passage-restitution` : préparation de l'entretien.
- Skills tiers dans `.claude/skills` (TDD, débogage systématique, vérification avant de conclure, consignes Karpathy, tests web).
