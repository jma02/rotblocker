#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
VERSION="$(node -p "require('$ROOT_DIR/manifest.json').version")"
ZIP_PATH="$DIST_DIR/rotblocker-plusplus-v${VERSION}.zip"

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

cd "$ROOT_DIR"
zip -r "$ZIP_PATH" \
  manifest.json \
  rules.json \
  background.js \
  challenge.html \
  challenge.css \
  challenge.js \
  scoring.js \
  popup.html \
  popup.css \
  popup.js \
  assets \
  README.md \
  rotblocker++ \
  data \
  -x "*.DS_Store"

echo "Created $ZIP_PATH"
