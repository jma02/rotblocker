const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertDeferredScriptPresent(source, scriptSrc) {
  const pattern = new RegExp(`<script\\s+defer\\s+src="${escapeRegex(scriptSrc)}"\\s*><\\/script>`);
  assert.match(source, pattern, `missing deferred script tag for ${scriptSrc}`);
}

function assertSourceOrder(source, firstSrc, secondSrc) {
  const firstIdx = source.indexOf(`src="${firstSrc}"`);
  const secondIdx = source.indexOf(`src="${secondSrc}"`);
  assert.notEqual(firstIdx, -1, `missing ${firstSrc}`);
  assert.notEqual(secondIdx, -1, `missing ${secondSrc}`);
  assert.ok(firstIdx < secondIdx, `${firstSrc} must appear before ${secondSrc}`);
}

test("rotblocker entrypoint loads scoring.js before challenge.js", () => {
  const source = readText("rotblocker++/index.html");
  assertDeferredScriptPresent(source, "../scoring.js");
  assertDeferredScriptPresent(source, "../challenge-modules/constants.js");
  assertDeferredScriptPresent(source, "../challenge-modules/dom.js");
  assertDeferredScriptPresent(source, "../challenge-modules/math.js");
  assertDeferredScriptPresent(source, "../challenge-modules/sync.js");
  assertDeferredScriptPresent(source, "../challenge-modules/tutor.js");
  assertDeferredScriptPresent(source, "../challenge.js");
  assertDeferredScriptPresent(source, "../challenge-modules/gameplay.js");
  assertDeferredScriptPresent(source, "../challenge-modules/bootstrap.js");
  assert.match(source, /<script\s+src="\.\.\/mathjax-config\.js"\s*><\/script>/);
  assertDeferredScriptPresent(source, "../node_modules/mathjax/es5/tex-mml-chtml.js");
  assert.doesNotMatch(source, /<script>\s*window\.MathJax\s*=/);
  assertSourceOrder(source, "../mathjax-config.js", "../node_modules/mathjax/es5/tex-mml-chtml.js");
  assertSourceOrder(source, "../node_modules/mathjax/es5/tex-mml-chtml.js", "../scoring.js");
  assertSourceOrder(source, "../scoring.js", "../challenge-modules/constants.js");
  assertSourceOrder(source, "../challenge-modules/constants.js", "../challenge-modules/dom.js");
  assertSourceOrder(source, "../challenge-modules/dom.js", "../challenge-modules/math.js");
  assertSourceOrder(source, "../challenge-modules/math.js", "../challenge-modules/sync.js");
  assertSourceOrder(source, "../challenge-modules/sync.js", "../challenge-modules/tutor.js");
  assertSourceOrder(source, "../challenge-modules/tutor.js", "../challenge.js");
  assertSourceOrder(source, "../challenge.js", "../challenge-modules/gameplay.js");
  assertSourceOrder(source, "../challenge-modules/gameplay.js", "../challenge-modules/bootstrap.js");
});

test("legacy challenge entrypoint loads scoring.js before challenge.js", () => {
  const source = readText("challenge.html");
  assertDeferredScriptPresent(source, "scoring.js");
  assertDeferredScriptPresent(source, "challenge-modules/constants.js");
  assertDeferredScriptPresent(source, "challenge-modules/dom.js");
  assertDeferredScriptPresent(source, "challenge-modules/math.js");
  assertDeferredScriptPresent(source, "challenge-modules/sync.js");
  assertDeferredScriptPresent(source, "challenge-modules/tutor.js");
  assertDeferredScriptPresent(source, "challenge.js");
  assertDeferredScriptPresent(source, "challenge-modules/gameplay.js");
  assertDeferredScriptPresent(source, "challenge-modules/bootstrap.js");
  assertSourceOrder(source, "scoring.js", "challenge-modules/constants.js");
  assertSourceOrder(source, "challenge-modules/constants.js", "challenge-modules/dom.js");
  assertSourceOrder(source, "challenge-modules/dom.js", "challenge-modules/math.js");
  assertSourceOrder(source, "challenge-modules/math.js", "challenge-modules/sync.js");
  assertSourceOrder(source, "challenge-modules/sync.js", "challenge-modules/tutor.js");
  assertSourceOrder(source, "challenge-modules/tutor.js", "challenge.js");
  assertSourceOrder(source, "challenge.js", "challenge-modules/gameplay.js");
  assertSourceOrder(source, "challenge-modules/gameplay.js", "challenge-modules/bootstrap.js");
});
