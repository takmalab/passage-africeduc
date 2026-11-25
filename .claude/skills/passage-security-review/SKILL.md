---
name: passage-security-review
description: Liste de contrôle sécurité de Passage à appliquer avant chaque commit touchant une route, une requête, l'authentification, les badges ou l'interface.
---

# Contrôle sécurité avant commit

Chaque point est un critère du sujet ; certains sont éliminatoires (note de sécurité à zéro).

1. Nouvelle route : `requireRole(...)` présent ? Entrée validée par Zod `.strict()` ?
2. Données d'élève lues par un parent : filtre `parents: { some: { parentId } }` DANS la requête ? Réponse 404 sinon ?
3. Données lues par un responsable : filtrées par `staffEstablishment(req)` ?
4. Aucune concaténation de texte dans une requête SQL ; `$queryRaw` en gabarit balisé seulement.
5. Aucun `dangerouslySetInnerHTML`, aucun `eval`.
6. Aucun secret dans le code, les tests, les logs ou les messages d'erreur. `.env` jamais ajouté (`git status`).
7. Mots de passe : uniquement via `hashPassword` / `verifyPassword`.
8. Badges : aucune donnée nominative dans un code ; ne jamais accepter un code sans vérifier signature + usage unique.
9. Un test d'intégration couvre-t-il le cas refusé (pas seulement le cas accepté) ?
10. `npm run verify` vert.
