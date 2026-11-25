# Badges : cartes NFC sécurisées et cartes QR imprimées

## Carte NFC NTAG 424 DNA (mode SUN), recommandée

### Principe

À chaque lecture, la puce écrit dans son URL NDEF : `https://<votre-domaine>/c?p=<PICCData chiffrée>&c=<SDMMAC>`.

| Élément         | Contenu                                                                                         | Clé                              |
| --------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- |
| `p` (16 octets) | `C7` + UID (7 octets) + compteur de lectures (3 octets, poids faible d'abord) + aléa            | Clé méta (une par établissement) |
| `c` (8 octets)  | CMAC tronqué (octets d'indice impair) calculé avec une clé de session dérivée de UID + compteur | Clé MAC (une par badge)          |

Vérification serveur (`apps/api/src/modules/badges`) : déchiffrer `p`, retrouver le badge par l'empreinte HMAC de l'UID, recalculer `c`, refuser si le compteur a déjà servi ou s'il est plus ancien qu'un passage déjà enregistré. Le calcul est testé avec les **vecteurs officiels NXP AN12196** (`test/unit/nfc-crypto.test.ts`).

### Clés

Toutes les clés dérivent de `BADGE_KEYS_MASTER_KEY` (`keys.ts`) : rien n'est stocké en base. Changer la clé maîtresse invalide toutes les cartes.

### Programmer une vraie carte

1. Responsable > Élèves > fiche élève > « Émettre une carte NFC ». L'écran affiche **une seule fois** la clé méta, la clé MAC et le modèle d'URL.
2. Programmer la carte avec l'application **NXP TagWriter** (Android) ou **TagXplorer** (PC + lecteur USB) :
   - fichier NDEF avec l'URL du modèle ;
   - SDM (Secure Dynamic Messaging) activé, miroir **PICCData chiffrée** sur `p`, miroir **SDMMAC** sur `c`, entrée MAC vide ;
   - clé SDMMetaRead = clé méta, clé SDMFileRead = clé MAC ;
   - changer la clé maîtresse de la carte (clé 0) pour qu'elle ne soit plus reprogrammable.
3. Poser la carte sur un téléphone : copier l'URL lue, la coller dans la fiche élève > « Activer ». Le serveur vérifie la signature et associe la carte.

Cette étape n'a pas été réalisée sur du matériel pendant le test (voir README, « Ce qui n'est pas terminé »).

### Lecture au portail

Web NFC : **Chrome sur Android**, page en HTTPS, bouton « Démarrer la lecture NFC » (geste de l'utilisateur obligatoire). Non disponible sur iPhone.

### Simulateur (démonstration sans matériel)

Responsable > Simulateur de carte > « Poser la carte de… » : le serveur calcule exactement ce qu'écrirait la puce et l'affiche en QR. Désactivable : `CARD_SIMULATOR_ENABLED=false`.

## Carte QR imprimée (option économique)

- Activer : Responsable > Paramètres > « Autoriser les cartes QR imprimées ».
- Émettre : fiche élève > « Émettre une carte QR imprimée » > Imprimer (format carte bancaire). Le QR n'est affiché **qu'une fois** : le serveur ne garde que l'empreinte du secret.
- Contenu : `PSG1.S.<référence aléatoire>.<secret aléatoire>`, aucune donnée de l'élève.
- Protection : une seule validation par point dans `PRINTED_REUSE_MINUTES` (120 min) ; utilisation sur deux appareils en `PRINTED_CLONE_MINUTES` = anomalie « copie probable ».
- Limite : une photo présentée **avant** l'élève passe une fois (l'élève est alors refusé et l'agent alerté). C'est pourquoi l'option est désactivée par défaut.
