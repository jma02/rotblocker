const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("AI system prompt asks for MathJax-compatible delimiters", () => {
  const source = readText("challenge.js");
  assert.match(source, /MathJax-compatible LaTeX delimiters/);
  assert.match(source, /use \$\.\.\.\$ for inline math/);
  assert.match(source, /and \$\$\.\.\.\$\$ for display math/);
});

test("assistant chat messages render LaTeX through math renderer", () => {
  const source = readText("challenge.js");
  assert.match(source, /role === "assistant"/);
  assert.match(source, /bodyEl\.className = "chat-message-body"/);
  assert.match(source, /renderMathText\(bodyEl, sanitizeForMathJax\(content\)\)/);
});
