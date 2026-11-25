<#
.SYNOPSIS
  Installation complète de Passage sous Windows (PowerShell 5+ ou 7).

.DESCRIPTION
  1. Installe ce qui manque avec winget : Git, Node.js 22 LTS, GitHub CLI (gh).
  2. Démarre PostgreSQL avec Docker si Docker est présent (sinon explique l'alternative).
  3. Crée le fichier .env (clé maîtresse des badges générée aléatoirement).
  4. Installe les dépendances, applique les migrations, charge les données de démo.
  5. Configure git, se connecte à GitHub et crée le dépôt public (optionnel).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -RepoName passage-test-technique
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -SkipGitHub
#>
param(
  [string]$RepoName = "passage",
  [switch]$SkipGitHub,
  [switch]$SkipDocker
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    OK  $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    !   $text" -ForegroundColor Yellow }
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }
function Refresh-Path {
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
              [System.Environment]::GetEnvironmentVariable("Path", "User")
}
function Ensure($cmd, $wingetId, $label) {
  if (Has $cmd) { Ok "$label déjà installé"; return }
  if (-not (Has "winget")) { throw "winget introuvable : installez $label à la main puis relancez." }
  Write-Host "    Installation de $label ($wingetId)..."
  winget install --id $wingetId -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
  if (-not (Has $cmd)) { throw "$label installé mais introuvable : fermez et rouvrez PowerShell, puis relancez ce script." }
  Ok "$label installé"
}

Step "Outils"
Ensure "git" "Git.Git" "Git"
Ensure "node" "OpenJS.NodeJS.LTS" "Node.js LTS"
Ensure "gh" "GitHub.cli" "GitHub CLI (gh)"
$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 22) { throw "Node.js 22 ou plus est requis (actuel : $(node -v)). winget upgrade OpenJS.NodeJS.LTS" }
Ok "Node $(node -v)"

Step "Base de données PostgreSQL"
$useDocker = (-not $SkipDocker) -and (Has "docker")
if ($useDocker) {
  docker compose up -d db | Out-Null
  Ok "PostgreSQL démarré dans Docker (port 5432)"
} else {
  Warn "Docker absent : installez Docker Desktop (winget install Docker.DockerDesktop),"
  Warn "ou PostgreSQL 16 (winget install PostgreSQL.PostgreSQL.16) avec l'utilisateur 'passage'"
  Warn "et les bases 'passage' et 'passage_test' (voir docs/STEPS.md, étape 1)."
}

Step "Fichier .env"
if (-not (Test-Path ".env")) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $key = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  (Get-Content ".env.example" -Raw) `
    -replace "passage:CHANGE_ME@", "passage:passage@" `
    -replace "(?m)^BADGE_KEYS_MASTER_KEY=.*$", "BADGE_KEYS_MASTER_KEY=$key" |
    Set-Content ".env" -Encoding utf8
  Ok ".env créé (clé maîtresse des badges générée). Ajoutez MISTRAL_API_KEY si vous en avez une."
} else { Ok ".env déjà présent (non modifié)" }

Step "Dépendances"
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install a échoué" }
Ok "Dépendances installées"

if ($useDocker) {
  Step "Migrations et données de démonstration"
  Start-Sleep -Seconds 3
  npm run db:deploy
  if ($LASTEXITCODE -ne 0) { throw "Migrations en échec" }
  npm run db:seed
  Ok "Base prête (comptes : responsable, agent, parent.awa, parent.kevin / Passage2026!)"
}

Step "Git"
if (-not (git config user.name)) {
  $name = Read-Host "Votre nom pour les commits"
  $mail = Read-Host "Votre e-mail GitHub"
  git config user.name "$name"
  git config user.email "$mail"
}
Ok "Commits signés : $(git config user.name) <$(git config user.email)>"

if (-not $SkipGitHub) {
  Step "GitHub"
  gh auth status 2>$null
  if ($LASTEXITCODE -ne 0) { gh auth login --web --git-protocol https }
  $hasRemote = git remote 2>$null | Select-String -Quiet "origin"
  if (-not $hasRemote) {
    gh repo create $RepoName --public --source . --remote origin --push
    Ok "Dépôt public créé et poussé : $(gh repo view --json url -q .url)"
  } else {
    git push -u origin main
    Ok "Poussé vers origin"
  }
}

Step "Terminé"
Write-Host "  Tests       : npm test"
Write-Host "  Développement : npm run dev   puis http://localhost:5173"
Write-Host "  Suite       : docs/STEPS.md"
