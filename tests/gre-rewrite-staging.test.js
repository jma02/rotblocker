"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const {
  INPUT,
  OUTPUT,
  REPORT,
  loadChallengeFns
} = require("../scripts/rewrite_upper_level_mcq_offline.js");

test("GRE rewrite targets an ignored preview instead of the curated bank", () => {
  assert.equal(INPUT, path.join(ROOT, "data", "upper_level_mcq.json"));
  assert.equal(
    OUTPUT,
    path.join(ROOT, "data", "upper_level_mcq_rewrite_preview.json")
  );
  assert.equal(
    REPORT,
    path.join(ROOT, "data", "upper_level_mcq_rewrite_preview_report.json")
  );
  assert.notEqual(OUTPUT, INPUT);

  const ignore = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
  assert.match(ignore, /data\/\*_rewrite_preview\.json/);
  assert.match(ignore, /data\/\*_rewrite_preview_report\.json/);
});

test("GRE rewrite loads sanitizer functions from the modular challenge runtime", () => {
  const fns = loadChallengeFns();

  assert.equal(typeof fns.sanitizeForMathJax, "function");
  assert.equal(typeof fns.normalizeChoiceMath, "function");
  assert.equal(typeof fns.hasRenderableMathSyntax, "function");
  assert.equal(typeof fns.problemLooksRenderable, "function");
  assert.equal(
    fns.sanitizeForMathJax(String.raw`Choose frac12.`),
    String.raw`Choose \frac{1}{2}.`
  );
  assert.equal(
    fns.normalizeChoiceMath(String.raw`\frac{1}{2}`),
    String.raw`$\frac{1}{2}$`
  );
});
