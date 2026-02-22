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

test("chat messages include explicit YOU and PoBot prefixes", () => {
  const source = readAppSource();
  assert.match(source, /const roleLabel = role === "user" \? "YOU" : role === "assistant" \? "PoBot" : "System"/);
  assert.match(source, /prefixEl\.className = "chat-role-prefix"/);
  assert.match(source, /prefixEl\.textContent = `\$\{roleLabel\}:`/);
  assert.match(source, /role\.textContent = "PoBot:"/);
});
