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

test("AI system prompt asks for MathJax-compatible delimiters", () => {
  const source = readAppSource();
  assert.match(source, /MathJax-compatible LaTeX delimiters/);
  assert.match(source, /use \$\.\.\.\$ for inline math/);
  assert.match(source, /and \$\$\.\.\.\$\$ for display math/);
});

test("assistant chat messages render LaTeX through math renderer", () => {
  const source = readAppSource();
  assert.match(source, /role === "assistant"/);
  assert.match(source, /bodyEl\.className = "chat-message-body"/);
  assert.match(source, /renderMathText\(bodyEl, sanitizeForMathJax\(content\)\)/);
});
