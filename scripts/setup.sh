#!/usr/bin/env bash
# Installation complète de Passage (macOS / Linux). Équivalent de scripts/setup.ps1.
#   bash scripts/setup.sh [nom-du-depot]     (SKIP_GITHUB=1 pour ne pas créer le dépôt)
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_NAME="${1:-passage}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok() { printf '    \033[32mOK\033[0m  %s\n' "$1"; }
has() { command -v "$1" >/dev/null 2>&1; }

step "Outils"
for tool in git node; do has "$tool" || { echo "Installez $tool puis relancez."; exit 1; }; done
if ! has gh; then
  if has brew; then brew install gh
  elif has apt-get; then
    (type -p wget >/dev/null || sudo apt-get install -y wget)
    sudo mkdir -p -m 755 /etc/apt/keyrings
    wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg >/dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list >/dev/null
    sudo apt-get update && sudo apt-get install -y gh
  else echo "Installez GitHub CLI : https://cli.github.com"; exit 1; fi
fi
[ "$(node -v | cut -d. -f1 | tr -d v)" -ge 22 ] || { echo "Node 22+ requis"; exit 1; }
ok "git, node $(node -v), gh"

step "PostgreSQL"
USE_DOCKER=0
if has docker; then docker compose up -d db && USE_DOCKER=1 && ok "PostgreSQL (Docker)"; else echo "    Docker absent : voir docs/STEPS.md, étape 1."; fi

step ".env"
if [ ! -f .env ]; then
  KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -e 's#passage:CHANGE_ME@#passage:passage@#g' -e "s#^BADGE_KEYS_MASTER_KEY=.*#BADGE_KEYS_MASTER_KEY=$KEY#" .env.example > .env
  ok ".env créé"
else ok ".env déjà présent"; fi

step "Dépendances"
npm install

if [ "$USE_DOCKER" = 1 ]; then
  step "Migrations et données de démonstration"
  sleep 3
  npm run db:deploy && npm run db:seed
fi

step "Git et GitHub"
git config user.name >/dev/null || { read -rp "Nom pour les commits : " n; git config user.name "$n"; read -rp "E-mail GitHub : " m; git config user.email "$m"; }
if [ "${SKIP_GITHUB:-0}" != 1 ]; then
  gh auth status >/dev/null 2>&1 || gh auth login --web --git-protocol https
  if git remote | grep -q origin; then git push -u origin main
  else gh repo create "$REPO_NAME" --public --source . --remote origin --push; fi
fi
ok "Terminé. Suite : docs/STEPS.md"
