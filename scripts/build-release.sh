#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
VERSION="$(node -p "require('$ROOT_DIR/manifest.json').version")"
ZIP_PATH="$DIST_DIR/rotblocker-plusplus-v${VERSION}.zip"
MATHJAX_ENTRY="$ROOT_DIR/node_modules/mathjax/es5/tex-mml-chtml.js"

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

if [[ ! -f "$MATHJAX_ENTRY" ]]; then
  echo "Missing MathJax runtime at node_modules/mathjax/es5/tex-mml-chtml.js"
  echo "Run: npm install"
  exit 1
fi

cd "$ROOT_DIR"
zip -r "$ZIP_PATH" \
  manifest.json \
  rules.json \
  background.js \
  challenge.css \
  challenge-modules \
  challenge.js \
  scoring.js \
  popup.html \
  popup.css \
  popup.js \
  mathjax-config.js \
  assets \
  node_modules/mathjax/es5 \
  README.md \
  rotblocker++ \
  data \
  -x "*.DS_Store" "assets/diagrams/*.asy"

echo "Created $ZIP_PATH"
