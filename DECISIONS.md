# Décisions techniques

Chaque décision : le problème, l'option retenue, ce qui a été écarté et pourquoi.

## D1. Badge physique : carte NFC sécurisée NTAG 424 DNA, carte QR imprimée en option

**Problème.** Un badge photographié ne doit pas permettre à un tiers de passer. Aucune donnée nominative sur le support. Les élèves (Cameroun) ne viennent pas à l'école avec un téléphone : un code tournant affiché sur écran est irréaliste.

**Retenu.** Carte PVC avec puce **NTAG 424 DNA en mode SUN** (environ 1 € pièce). À chaque lecture, la puce incrémente un compteur et produit une signature AES-CMAC avec une clé qui ne peut pas être extraite. Le serveur déchiffre l'UID et le compteur, vérifie la signature, et n'accepte chaque compteur **qu'une fois** (clé primaire `BadgeCodeUse(badgeId, counter)`). Une lecture rejouée plus tard est aussi refusée si un compteur plus grand a déjà été vu plus tôt (`CODE_OUT_OF_ORDER`).

**Écarté.**

- QR tournant sur le téléphone de l'élève : pas de téléphone chez les élèves (première proposition, refusée en connaissance du terrain, voir JOURNAL-IA).
- QR statique seul : une photo suffit pour passer. Note de sécurité à zéro selon le sujet.
- Cartes MIFARE Classic ou NTAG 213 : UID et contenu copiables avec un téléphone.

**Option moins chère, assumée.** Les cartes NFC ont un coût ; le mode **carte QR imprimée** existe, désactivé par défaut et activable par établissement. Le QR contient une référence et un secret aléatoires (jamais l'identifiant de l'élève), le serveur n'en stocke que l'empreinte. Une même carte n'est acceptée **qu'une fois par point de contrôle dans une fenêtre de 2 h** : une photo présentée après l'élève est refusée ; présentée avant lui, c'est l'élève qui est refusé et l'agent est alerté sur-le-champ. Une carte utilisée sur deux appareils à quelques minutes d'écart déclenche l'anomalie « copie probable ». C'est plus faible que le NFC, et c'est écrit.

**Contrainte pour l'agent.** Téléphone Android avec NFC et Chrome (Web NFC n'existe pas sur iPhone). Hors ligne, il ne peut pas vérifier la signature (il n'a pas les clés) : le verdict définitif arrive à la synchronisation.

**Limite.** Un complice qui lit la carte en cachette puis passe **avant** l'élève est accepté (limite de toute carte sans contact) ; le saut de compteur le rend visible ensuite.

## D2. Synchronisation idempotente par identifiant d'événement

**Retenu.** Chaque scan reçoit un UUID créé sur le téléphone. `Passage` a une contrainte unique `(deviceId, localEventId)`. Le téléphone ne retire un scan de sa file qu'après l'accusé du serveur. Un lot renvoyé après une coupure renvoie « déjà reçu » pour ce qui était arrivé. Chaque scan est traité dans sa propre transaction.

**Écarté.** Déduplication par (badge, heure) : deux vrais passages rapprochés seraient fusionnés, et l'heure de l'appareil n'est pas fiable. Synchronisation « tout ou rien » d'un lot : un scan invalide bloquerait les autres.

## D3. Horloge des appareils : correction par décalage mesuré à l'envoi

**Retenu.** Avec chaque lot, le téléphone envoie son heure courante. Décalage = heure serveur - heure téléphone ; il est appliqué à chaque scan du lot. Au-delà de 2 min, le passage est marqué « horloge corrigée » ; l'heure brute est conservée. Si l'heure corrigée reste impossible (futur, plus de 72 h), le passage est **mis de côté** (refusé `CLOCK_UNRELIABLE`, visible par le responsable) plutôt que compté en silence.

**Écarté.** Rejeter (perte de vrais passages), faire confiance (anomalies fausses), heure de réception serveur (fausse pour tout scan hors ligne).

**Hypothèse.** Le décalage n'a pas changé entre le scan et l'envoi.

## D4. Détection du passage manquant : programme de fond avec verrou PostgreSQL

**Retenu.** Un programme dans le processus de l'API (ou séparé : `npm run worker`) tourne chaque minute. Il évalue les fenêtres closes depuis plus de 15 min (délai de grâce pour les scans hors ligne), la veille comprise (rattrapage après panne). Clé unique `MISSED:<étape>:<date>` : rejouable sans doublon. Verrou consultatif **lié à une transaction** : une seule instance travaille. Un passage hors ligne arrivé après coup **clôt automatiquement** l'anomalie et prépare une rectification pour le parent.

**Écarté.** Détection à la consultation (interdite par le sujet). BullMQ + Redis (un serveur de plus). Cron du système (ne suit pas `docker compose up`).

## D5. Synthèse IA : le modèle rédige un gabarit, le code met les chiffres

**Retenu.** Les chiffres sont calculés en SQL. Le modèle reçoit le contexte et la liste des marqueurs (`{present}`, `{enrolled}`...), et répond en JSON strict `{"template": "..."}`. Le code refuse toute sortie qui contient un chiffre, un nombre en lettres ou un quantificateur (« un », « aucun », « tous », « plusieurs »), puis remplace les marqueurs. Un nouvel essai, puis gabarit. Chaque appel est journalisé (`AiCall` : tokens, coût estimé, statut). Budget journalier. Cache par empreinte (modèle + version de consigne + chiffres).

**Écarté.** Laisser le modèle écrire les nombres puis les comparer : une phrase comme « une sortie » au lieu de « 0 sortie » échapperait à une simple recherche de chiffres. Avec les marqueurs, le modèle **ne peut pas** inventer une quantité.

**Modèle.** `mistral-small-latest` (Mistral Small 4) : 0,15 $ / 0,60 $ par million de tokens, moins d'un dixième de centime par synthèse.

## D6. Cinquième anomalie : tentative de copie du badge

**Retenu.** Code déjà utilisé, code plus ancien qu'un passage enregistré, signature falsifiée, ou carte imprimée utilisée sur deux appareils proches dans le temps. C'est le risque central du sujet (un tiers qui se fait passer pour l'élève) ; le parent doit le savoir. Ajoutée aussi : « badge désactivé présenté » (carte perdue qui réapparaît).

**Écarté.** « Absence prolongée sur plusieurs jours » : utile, mais déductible des passages manquants et moins urgente.

## D7. Notifications : boîte d'envoi en base, plafond par élève et par parent

**Retenu.** `OutboundMessage` est la boîte d'envoi (motif transactionnel « outbox »). Le programme de fond envoie via l'interface `NotificationProvider` (3 essais). Plafond `NOTIFY_MAX_PER_STUDENT_PER_DAY` (3) par élève et par parent : au-delà, message `SUPPRESSED` avec motif. Les rectifications ne sont pas plafonnées. Messages neutres : prénom, point, date, heure, rien d'autre.

## D8. Sessions serveur plutôt que JWT

**Retenu.** Jeton aléatoire en cookie `HttpOnly`, empreinte en base. Déconnexion et expiration réellement effectives côté serveur.

**Écarté.** JWT : impossible à révoquer avant expiration sans liste noire, ce qui revient à une session en base.

## D9. Écarts au modèle de données indicatif

- `Badge` : `uidHash` (empreinte HMAC de l'UID, jamais l'UID en clair), `staticSecretHash` (cartes QR), `replacesBadgeId` (traçabilité des réémissions), index unique **partiel** « un seul badge vivant par élève ».
- `BadgeCodeUse` : usage unique des compteurs NFC.
- `Passage` : heure brute, heure d'envoi, décalage, heure retenue, statut d'horloge, verdict et motif. Les refus sont conservés (audit, anomalies de sécurité).
- `RouteStep` : fenêtres en minutes depuis minuit dans le fuseau de l'établissement, jours ISO ; contraintes CHECK (début < fin, jours 1 à 7).
- `Device`, `AiCall`, `Summary`, `AuditLog`, `Session` ajoutés. `Classroom` en table (synthèse par classe).

## D10. Front : Vite + React plutôt que Next.js

**Retenu.** Vite + vite-plugin-pwa : toute l'application est précachée, l'écran de scan s'ouvre sans réseau quelle que soit la route. Express sert la PWA sur la même origine (pas de CORS, cookies `SameSite=Strict`).

**Écarté.** Next.js 16 (proposé au départ) : rendu serveur inutile ici, service worker seulement en build de production, routes dynamiques plus délicates hors ligne.

## D11. Déploiement : seulement après le reste, pour une raison technique

Le sujet ne valorise pas l'hébergement. Une image Docker unique et un script d'initialisation de base en ligne sont fournis, car **la caméra et le NFC exigent HTTPS sur téléphone** pour un test réel. Alternative sans Internet : certificat local (`npm run cert:lan`).

## D12. Faille de sévérité haute dans une dépendance de Prisma : version corrigée imposée

**Problème.** `npm audit` (workflow Sécurité) signale une faille ReDoS de sévérité haute dans `effect` 3.20.0 ([GHSA-7589-6fvf-x4pw](https://github.com/advisories/GHSA-7589-6fvf-x4pw)), utilisé par `prisma` via `@prisma/config`. Toutes les versions de Prisma 7 imposent exactement cette version.

**Retenu.** Un `overrides` dans le `package.json` racine impose `effect` 3.22.5, version corrigée de la même branche 3.x (mêmes dépendances, même API). Vérifié : `npm ci`, `prisma generate`, `prisma migrate status`, `npm run verify` et `npm audit --omit=dev --audit-level=high` sans faille. À retirer dès qu'une version de Prisma embarque `effect` 3.22.1 ou plus.

**Écarté.** `npm audit fix --force` : il ramène Prisma à la version 6.12 (changement majeur, projet cassé). Accepter la faille sans rien faire : elle touche surtout l'outil en ligne de commande de Prisma, mais le contrôle de sécurité resterait rouge.

## D13. Comptes créés par le responsable : rôle fixé par la route, mot de passe généré

**Problème.** Une école doit pouvoir démarrer seule : créer ses agents et les comptes des parents. Sans ouvrir de faille : ni création d'un responsable, ni accès d'un responsable aux parents d'une autre école.

**Retenu.**

- **Agents** : `POST /manager/agents`, rattachés à l'établissement du responsable (pris dans la session).
- **Parents** : créés **depuis la fiche d'un élève** (`POST /manager/students/:id/parents`). Le compte et le lien parent-élève sont créés dans **la même transaction** ; si l'élève n'est pas dans l'établissement, réponse 404 et aucun compte créé. Un parent n'a pas d'établissement : le responsable ne voit que les parents de ses propres élèves, il n'existe aucune liste globale de parents.
- **Rôle** fixé par la route ; schéma Zod `.strict()` : un champ `role` ajouté à la requête est refusé (400). Impossible de créer un responsable.
- **Mot de passe provisoire** tiré au hasard par le serveur (12 octets, 16 caractères), haché en argon2id, renvoyé **une seule fois** et jamais écrit dans le journal d'audit.

**Écarté.** Mot de passe saisi par le responsable : il le connaîtrait et risquerait d'en choisir un faible. Page « Comptes » avec des parents sans enfant : il aurait fallu donner un établissement aux parents, donc modifier le modèle et la règle `staffEstablishment`.

**Limite.** Pas encore d'écran « changer mon mot de passe » (voir README).

## D14. Itinéraire défini par l'établissement, appliqué à chaque élève (décision du candidat)

**Problème.** Le sujet décrit l'itinéraire comme « une suite ordonnée de points de contrôle, chacun avec une fenêtre horaire et des jours d'application », et son modèle indicatif le rattache à l'**élève**. Mais une école ne raisonne pas élève par élève : elle a **un** portail d'entrée (07:00-07:45), **un** portail de sortie (15:30-16:15), et un autobus seulement si elle en dispose. Saisir les mêmes horaires sur chaque élève est fastidieux et source d'erreurs.

**Retenu.** Le responsable saisit **une seule fois** l'itinéraire de l'établissement (Paramètres). Il est recopié automatiquement dans l'itinéraire de **chaque** élève, existant ou nouveau, et toute modification est répercutée sur tous. Les étapes de type autobus ne s'appliquent pas aux élèves marqués « Ne prend pas le bus » (case sur la fiche élève). Chaque élève garde donc sa propre copie, comme dans le modèle indicatif : le moteur d'anomalies est inchangé, et un élève sans bus qui badge au bus déclenche bien « point absent de l'itinéraire » (anomalie obligatoire n° 3). Les copies sont mises à jour sur place (mêmes identifiants d'étapes), pour qu'une alerte « passage manquant » déjà émise ne soit pas émise une seconde fois.

**Écarté.**

- Itinéraire saisi élève par élève (première version) : conforme au modèle indicatif, mais inutilisable pour une école de plusieurs centaines d'élèves.
- « Appliquer l'itinéraire d'un élève à toute sa classe », **proposé par l'assistant IA et refusé par le candidat** : il laisse la configuration éparpillée par classe, alors que l'école n'a qu'un seul itinéraire.
- Un itinéraire unique lu directement par le moteur, sans copie par élève : un élève qui ne prend pas le bus ne pourrait plus être signalé « hors itinéraire » s'il badge au bus, et la refonte du moteur d'anomalies était trop risquée à deux jours de l'échéance.

**Limites.** Pas d'itinéraire différent selon la classe (par exemple une sortie plus tôt le mercredi pour les 6e) ; les exceptions du jour (sortie anticipée autorisée) couvrent les cas individuels. La recopie se fait dans une transaction sur tous les élèves : suffisant pour quelques centaines d'élèves, à revoir au-delà.

## D15. Résolution d'une anomalie : motif obligatoire, réservé à l'école (décision du candidat)

**Problème.** Le sujet demande un « état de traitement » des anomalies. Le responsable pouvait passer une anomalie en « Résolue » d'un simple clic : on savait qui et quand (journal d'audit), mais jamais **pourquoi**. En cas de contestation d'un parent des mois plus tard, l'école n'aurait eu aucune explication.

**Retenu.** « Vue » reste un simple clic (prise en charge). « Résolue » exige un **motif** de 3 à 200 caractères (par exemple « Mère appelée : élève malade ») : sans lui, le serveur refuse (400). Le motif est enregistré sur l'anomalie et dans le journal d'audit, avec l'auteur et l'heure. Il est **visible par l'école uniquement** : la requête du parent ne sélectionne pas ce champ, il voit seulement l'état « Résolue » (testé).

**Écarté.** Motif facultatif : la raison se perd. Motif visible par le parent : il peut contenir une information sensible (santé, situation familiale), alors que le sujet exige des messages au parent sans donnée sensible.
