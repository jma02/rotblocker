const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function readJson(relPath) {
  const fullPath = path.join(process.cwd(), relPath);
  return JSON.parse(fs.readFileSync(fullPath, "utf8"));
}

test("manifest and package metadata use canonical rotblocker names", () => {
  const manifest = readJson("manifest.json");
  const pkg = readJson("package.json");
  const lock = readJson("package-lock.json");

  assert.equal(manifest.name, "rotblocker++");
  assert.equal(manifest.action.default_title, "rotblocker++");
  assert.ok(!(manifest.permissions || []).includes("identity"));
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, "oauth2"), false);
  assert.ok(!(manifest.host_permissions || []).includes("https://identitytoolkit.googleapis.com/*"));
  assert.ok(!(manifest.host_permissions || []).includes("https://securetoken.googleapis.com/*"));
  assert.ok(!(manifest.host_permissions || []).includes("https://firestore.googleapis.com/*"));
  assert.equal(pkg.name, "rotblocker-plusplus");
  assert.equal(lock.name, "rotblocker-plusplus");
});

test("all redirect rules target the rotblocker challenge page", () => {
  const rules = readJson("rules.json");
  assert.ok(Array.isArray(rules));
  assert.ok(rules.length > 0);

  for (const rule of rules) {
    assert.equal(rule.action?.type, "redirect");
    assert.equal(rule.action?.redirect?.extensionPath, "/rotblocker++/index.html");
  }
});

test("scoring browser global is RotBlockerScoring", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scoring.js"), "utf8");
  const sandbox = { self: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  assert.ok(sandbox.self.RotBlockerScoring);
  assert.equal(typeof sandbox.self.RotBlockerScoring.pointsIfCorrectNow, "function");
  assert.equal(sandbox.self.SiteBlockerScoring, undefined);
});

test("challenge code prefers renamed scoring symbol with safe compatibility fallback", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "challenge.js"), "utf8");
  assert.match(source, /\bresolveScoringApi\b/);
  assert.match(source, /\bRotBlockerScoring\b/);
  assert.match(source, /\bscoringApi\.(?:guessMultiplier|decayedBasePoints|pointsIfCorrectNow)\b/);
  assert.doesNotMatch(source, /\bRotBlockerScoring\.(?:guessMultiplier|decayedBasePoints|pointsIfCorrectNow)\b/);
  assert.doesNotMatch(source, /\bSiteBlockerScoring\.(?:guessMultiplier|decayedBasePoints|pointsIfCorrectNow)\b/);
});
