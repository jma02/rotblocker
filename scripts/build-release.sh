#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
VERSION="$(node -p "require('$ROOT_DIR/manifest.json').version")"
MATHJAX_ENTRY="$ROOT_DIR/node_modules/mathjax/es5/tex-mml-chtml.js"
STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rotblocker-release.XXXXXX")"
TARGET="chrome"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --target (expected: chrome or firefox)"
        exit 1
      fi
      TARGET="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Usage: bash scripts/build-release.sh [--target chrome|firefox]"
      exit 1
      ;;
  esac
done

case "$TARGET" in
  chrome|firefox) ;;
  *)
    echo "Unsupported target: $TARGET (expected: chrome or firefox)"
    exit 1
    ;;
esac

ZIP_PATH="$DIST_DIR/rotblocker-plusplus-${TARGET}-v${VERSION}.zip"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

RUNTIME_PATHS=(
  "manifest.json"
  "rules.json"
  "background.js"
  "challenge.css"
  "challenge-modules"
  "challenge.js"
  "scoring.js"
  "popup.html"
  "popup.css"
  "popup.js"
  "mathjax-config.js"
  "rotblocker++"
  "assets/logo"
)

DATA_FILES=(
  "data/amc8.json"
  "data/amc10.json"
  "data/amc12.json"
  "data/aime.json"
  "data/upper_level_mcq.json"
  "data/calculus_mcq_synthetic.json"
)

mkdir -p "$DIST_DIR"
rm -f "$ZIP_PATH"

if [[ ! -f "$MATHJAX_ENTRY" ]]; then
  echo "Missing MathJax runtime at node_modules/mathjax/es5/tex-mml-chtml.js"
  echo "Run: npm install"
  exit 1
fi

copy_into_stage() {
  local rel="$1"
  local src="$ROOT_DIR/$rel"
  local dst="$STAGE_DIR/$rel"
  if [[ ! -e "$src" ]]; then
    echo "Missing required path: $rel"
    exit 1
  fi
  mkdir -p "$(dirname "$dst")"
  cp -R "$src" "$dst"
}

for rel in "${RUNTIME_PATHS[@]}"; do
  copy_into_stage "$rel"
done

for rel in "${DATA_FILES[@]}"; do
  copy_into_stage "$rel"
done

if [[ "$TARGET" == "firefox" ]]; then
  node - "$STAGE_DIR/manifest.json" <<'NODE'
const fs = require("node:fs");

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

manifest.background = { scripts: ["background.js"] };
manifest.browser_specific_settings = manifest.browser_specific_settings || {};
manifest.browser_specific_settings.gecko = manifest.browser_specific_settings.gecko || {};
if (!manifest.browser_specific_settings.gecko.id) {
  manifest.browser_specific_settings.gecko.id = "rotblockerplusplus@rotblocker.app";
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

  node - \
    "$STAGE_DIR/rotblocker++/index.html" \
    "$STAGE_DIR/challenge-modules/sync.js" \
    "$STAGE_DIR/challenge.js" <<'NODE'
const fs = require("node:fs");

const files = process.argv.slice(2);
const replacements = [
  ["Chrome Sync", "Firefox Sync"],
  ["Chrome storage sync", "Firefox Sync storage"],
  ["Chrome profile", "Firefox profile"],
  ["Chrome sync", "Firefox sync"]
];

for (const file of files) {
  let source = fs.readFileSync(file, "utf8");
  for (const [before, after] of replacements) {
    source = source.split(before).join(after);
  }
  fs.writeFileSync(file, source);
}
NODE
fi

mkdir -p "$STAGE_DIR/node_modules/mathjax"
cp -R "$ROOT_DIR/node_modules/mathjax/es5" "$STAGE_DIR/node_modules/mathjax/es5"

while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  if [[ ! -f "$ROOT_DIR/$rel" ]]; then
    echo "Missing referenced diagram asset: $rel"
    exit 1
  fi
  copy_into_stage "$rel"
done < <(
  node - "$ROOT_DIR" "${DATA_FILES[@]}" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2];
const files = process.argv.slice(3);
const out = new Set();

for (const rel of files) {
  const full = path.join(root, rel);
  const rows = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!Array.isArray(rows)) continue;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const key of ["diagramPng", "diagramSvg"]) {
      const value = row[key];
      if (typeof value !== "string") continue;
      const clean = value.trim();
      if (clean.startsWith("assets/diagrams/")) out.add(clean);
    }
  }
}

for (const rel of Array.from(out).sort()) {
  process.stdout.write(`${rel}\n`);
}
NODE
)

(
  cd "$STAGE_DIR"
  zip -r "$ZIP_PATH" . -x "*.DS_Store" "assets/diagrams/*.asy"
)

echo "Created $ZIP_PATH"
