# Skills Claude Code du projet

Skills chargés automatiquement par Claude Code dans ce dépôt.

## Skills tiers (copiés tels quels, licences d'origine conservées)

| Skill | Source | Licence | Usage ici |
| --- | --- | --- | --- |
| test-driven-development | [obra/superpowers](https://github.com/obra/superpowers) | MIT | Écrire le test qui échoue avant le code |
| systematic-debugging | obra/superpowers | MIT | Déboguer par hypothèses vérifiées |
| verification-before-completion | obra/superpowers | MIT | Ne jamais déclarer « fini » sans avoir lancé les tests |
| writing-plans / executing-plans | obra/superpowers | MIT | Découper une évolution en étapes |
| requesting-code-review / receiving-code-review | obra/superpowers | MIT | Relecture avant fusion |
| karpathy-guidelines | [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) | MIT | Changements minimaux, pas de sur-ingénierie |
| webapp-testing | [anthropics/skills](https://github.com/anthropics/skills) | Apache 2.0 (voir LICENSE.txt) | Tester la PWA dans un navigateur (Playwright) |

Pour la version complète de Superpowers (plugin) :

```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

## Skills du projet (écrits pour Passage)

| Skill | Quand l'utiliser |
| --- | --- |
| passage-domain | Toute modification du métier : badges, synchronisation, anomalies, synthèse |
| passage-security-review | Avant chaque commit qui touche une route, une requête ou l'authentification |
| passage-restitution | Préparer l'entretien : démo, questions, modification en direct |
