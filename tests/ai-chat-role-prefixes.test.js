const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("chat messages include explicit YOU and PoBot prefixes", () => {
  const source = readText("challenge.js");
  assert.match(source, /const roleLabel = role === "user" \? "YOU" : role === "assistant" \? "PoBot" : "System"/);
  assert.match(source, /prefixEl\.className = "chat-role-prefix"/);
  assert.match(source, /prefixEl\.textContent = `\$\{roleLabel\}:`/);
  assert.match(source, /role\.textContent = "PoBot:"/);
});
