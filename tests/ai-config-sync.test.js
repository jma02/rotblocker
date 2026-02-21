const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("AI config loads from chrome profile sync and saves back to sync", () => {
  const source = readText("challenge.js");
  assert.match(source, /\bfunction getSync\(keys\)/);
  assert.match(source, /\bfunction setSync\(values\)/);
  assert.match(source, /await setSync\(\{\s*ai_config:\s*payload\s*\}\)/);
  assert.match(source, /getSync\(\["ai_config"\]\)/);
});
