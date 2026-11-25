# Déploiement et tests sur téléphone

Rappel : le sujet ne valorise pas l'hébergement. À faire **après** que tout marche en local, 2 h maximum.

## Sans Internet (entretien, réseau local)

```bash
npm run cert:lan        # certificat auto-signé pour localhost et les IP du PC
# ajouter au .env : HTTPS_KEY_PATH=certs/lan.key et HTTPS_CERT_PATH=certs/lan.crt
npm run build && npm start
```

Le téléphone (connecté au partage de connexion du PC) ouvre `https://<ip-du-pc>:8443` et accepte l'avertissement. Caméra et NFC fonctionnent (HTTPS).

## Base en ligne en une commande

```bash
npx create-db@latest                                   # crée une base Prisma Postgres gratuite, affiche son URL
npm run db:init:prod -- "postgresql://...?sslmode=require"   # migrations + données de démo
```

## Hébergement de l'application (Docker)

L'image `Dockerfile` applique les migrations au démarrage puis lance le serveur (programme de fond inclus). Exemple Render : « New Web Service » > depuis le dépôt > Docker ; variables : `DATABASE_URL`, `BADGE_KEYS_MASTER_KEY`, `APP_ORIGIN=https://<url>`, `TRUST_PROXY=true`, `NODE_ENV=production`, éventuellement `MISTRAL_API_KEY`.

Limite : une offre gratuite qui se met en veille arrête aussi le programme de fond ; le rattrapage au réveil limite le problème.
