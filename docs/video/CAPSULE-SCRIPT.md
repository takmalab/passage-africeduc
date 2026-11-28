# Capsule de présentation (60 à 90 s)

**Publics :** établissements, partenaires institutionnels, enseignants, parents et élèves ; aucun n'est informaticien.
**Formats :** horizontal 16:9 (1920 x 1080) et vertical 9:16 (1080 x 1920, téléphone).
**Exigences du sujet :** titre en ouverture, voix off, sous-titres incrustés, au moins une transition, image de fin, outils d'IA nommés dans `JOURNAL-IA.md`. Durée visée : 70 à 80 s.
**Règle de fond :** ne rien promettre que le produit ne fait pas. Passage est un prototype pensé pour SchoolLogs : la carte finale le dit en petit.

## Script de la voix off

Texte prêt à coller dans ElevenLabs : `capsule-voix-off.txt` (un paragraphe par scène, pauses `<break time="0.8s" />` entre les paragraphes ; adresses écrites telles qu'elles se prononcent : « schoollogs point com », « support arobase schoollogs point com »).

| Scène | Public visé                 | Voix off                                                                                                                              | À l'image                                              |
| ----- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0     | Tous                        | (titre, 3 s)                                                                                                                          | Logo, « Passage », « Mon enfant est-il bien arrivé ? » |
| 1     | Parents                     | Chaque matin, des milliers de parents se posent la même question : mon enfant est-il bien arrivé à l'école ?                          | Espace parent (téléphone)                              |
| 2     | Établissements              | Avec Passage, la réponse arrive en une seconde. L'élève présente son badge, et son arrivée est enregistrée.                           | Vidéo : scan accepté                                   |
| 3     | Élèves                      | Pour l'élève, pas de téléphone, pas de mot de passe : juste un badge, et un geste.                                                    | Verdict « Acceptée »                                   |
| 4     | Établissements              | Le réseau coupe ? Rien n'est perdu. Chaque passage est gardé, puis envoyé dès que la connexion revient.                               | Vidéo : hors ligne, compteur, envoi                    |
| 5     | Parents                     | Un élève ne s'est pas présenté ? Ses parents sont prévenus automatiquement. Et chaque parent ne voit que ses propres enfants.         | Message reçu par le parent                             |
| 6     | Établissements, parents     | Un badge photographié ou copié est refusé, et l'école est alertée.                                                                    | Vidéo : copie refusée                                  |
| 7     | Enseignants, direction      | Enseignants et direction obtiennent le résumé de chaque classe en un clic, avec des chiffres toujours exacts.                         | Synthèse du jour                                       |
| 8     | Partenaires institutionnels | Pour les établissements et leurs partenaires : des données fiables, protégées, pensées pour le terrain.                               | Journée du responsable                                 |
| 9     | Tous (appel à l'action)     | Passage, le suivi des élèves pensé pour SchoolLogs. Téléchargez SchoolLogs sur schoollogs.com. Une question ? support@schoollogs.com. | Carte : schoollogs.com, support@schoollogs.com         |
| 10    | Tous                        | L'école sait. Les parents sont rassurés.                                                                                              | Image de fin                                           |

## Voix ElevenLabs (à faire par le candidat)

1. Modèle **Eleven Multilingual v2**, une voix française chaleureuse et posée.
2. Réglages de départ : stabilité 45 %, similarité 75 %, style 15 à 20 %, vitesse normale.
3. Coller tout `capsule-voix-off.txt` en une fois (les `<break>` sont compris par ElevenLabs), générer, écouter, régénérer une phrase si besoin.
4. Télécharger en MP3 et le placer dans `montage/voix-elevenlabs.mp3` (exclu de git).

## Fabrication (dossier `montage/`)

Images avec `sharp`, vidéo avec `ffmpeg` (installé sur le système). Tout le contenu (textes, titres, images de chaque scène) est dans `montage/contenu.mjs`.

```bash
cd docs/video/montage
npm install                                   # une fois : installe sharp
VOIX=voix-elevenlabs.mp3 node fabriquer.mjs   # produit sortie/capsule-16x9.mp4 et sortie/capsule-9x16.mp4
```

Le script découpe la voix aux pauses (une scène par phrase), anime chaque scène (extraits de la vidéo de l'agent, zoom lent, titres et pictogrammes qui apparaissent), enchaîne les scènes par fondus et incruste les sous-titres. Option `MUSIQUE=musique.mp3` (libre de droits, mixée bas sous la voix).

Sources visuelles : `captures/` (captures et vidéo de l'agent, faites sur l'application en marche), `pictos/` (icônes Lucide, licence ISC), motif « école » de l'application.

## Mise en ligne

YouTube « non répertoriée » (ou Google Drive, « tous les utilisateurs disposant du lien »). Ouvrir chaque lien en navigation privée : aucune autorisation ne doit être demandée.
