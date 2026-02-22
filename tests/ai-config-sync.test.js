const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function readAppSource() {
  return [
    "challenge-modules/constants.js",
    "challenge-modules/dom.js",
    "challenge-modules/math.js",
    "challenge-modules/sync.js",
    "challenge-modules/tutor.js",
    "challenge.js",
    "challenge-modules/gameplay.js",
    "challenge-modules/bootstrap.js"
  ].map(readText).join("\n");
}

test("AI config loads from chrome profile sync and saves back to sync", () => {
  const source = readAppSource();
  assert.match(source, /\bfunction getSync\(keys\)/);
  assert.match(source, /\bfunction setSync\(values\)/);
  assert.match(source, /await setSync\(\{\s*ai_config:\s*payload\s*\}\)/);
  assert.match(source, /getSync\(\["ai_config"\]\)/);
});
