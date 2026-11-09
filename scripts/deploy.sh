#!/usr/bin/env bash
# Publica dist/ en la rama gh-pages (GitHub Pages) sin reescribir su historial.
# Uso: npm run deploy -- "mensaje"
set -euo pipefail

cd "$(dirname "$0")/.."
REMOTE="$(git remote get-url origin)"
WORK="$(mktemp -d)"
NAME="$(git config user.name || git log -1 --format=%an)"
EMAIL="$(git config user.email)"
trap 'rm -rf "$WORK"' EXIT

npm test
npm run build

git -c credential.helper=manager clone --quiet --branch gh-pages --single-branch "$REMOTE" "$WORK"
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r dist/. "$WORK/"
touch "$WORK/.nojekyll"

cd "$WORK"
git config user.name "$NAME"
git config user.email "$EMAIL"
git add -A
if git diff --cached --quiet; then
  echo "Sin cambios que publicar."
  exit 0
fi
git commit --quiet -m "${1:-Publicación}"
git -c credential.helper=manager push --quiet origin gh-pages
echo "Publicado: $(git rev-parse --short HEAD)"
