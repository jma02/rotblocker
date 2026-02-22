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

test("popup includes basic custom-domain settings controls", () => {
  const html = readText("popup.html");
  assert.match(html, /id="tab-settings"/);
  assert.match(html, /id="panel-settings"/);
  assert.match(html, /id="domain-form"/);
  assert.match(html, /id="domain-input"/);
  assert.match(html, /id="domain-list"/);
});

test("popup script wires custom-domain message types", () => {
  const source = readText("popup.js");
  assert.match(source, /type:\s*"GET_CUSTOM_DOMAINS"/);
  assert.match(source, /type:\s*"ADD_CUSTOM_DOMAIN"/);
  assert.match(source, /type:\s*"REMOVE_CUSTOM_DOMAIN"/);
});

test("challenge page includes custom-domain settings button and modal", () => {
  const html = readText("rotblocker++/index.html");
  assert.match(html, /id="domain-settings-toggle"/);
  assert.match(html, /id="domain-settings-modal"[^>]*\bhidden\b/);
  assert.match(html, /id="domain-settings-backdrop"/);
  assert.match(html, /id="domain-settings-panel"/);
  assert.match(html, /id="domain-settings-title">Settings</);
  assert.match(html, /id="lockout-settings-form"/);
  assert.match(html, /id="lockout-cooldown-input"/);
  assert.match(html, /id="lockout-settings-feedback"/);
  assert.match(html, /id="domain-settings-close"/);
  assert.match(html, /id="domain-settings-form"/);
  assert.match(html, /id="domain-settings-input"/);
  assert.match(html, /id="domain-settings-list"/);
  assert.match(html, /id="sync-last"/);
  assert.match(html, /id="sync-error"/);
});

test("challenge stylesheet keeps custom-domain modal hidden until opened", () => {
  const css = readText("challenge.css");
  assert.match(css, /\.domain-settings-modal\[hidden\]\s*\{/);
  assert.match(css, /\.domain-settings-modal\[hidden\][\s\S]*display:\s*none\s*!important\s*;/);
});

test("challenge script wires custom-domain message types", () => {
  const source = readAppSource();
  assert.match(source, /type:\s*"GET_SETTINGS"/);
  assert.match(source, /type:\s*"SET_LOCKOUT_COOLDOWN"/);
  assert.match(source, /type:\s*"GET_SYNC_STATUS"/);
  assert.match(source, /type:\s*"GET_CUSTOM_DOMAINS"/);
  assert.match(source, /type:\s*"ADD_CUSTOM_DOMAIN"/);
  assert.match(source, /type:\s*"REMOVE_CUSTOM_DOMAIN"/);
});

test("background script handles custom domains via dynamic rules", () => {
  const source = readText("background.js");
  assert.match(source, /CUSTOM_DOMAINS_KEY/);
  assert.match(source, /updateDynamicRules/);
  assert.match(source, /message\.type === "GET_CUSTOM_DOMAINS"/);
  assert.match(source, /message\.type === "ADD_CUSTOM_DOMAIN"/);
  assert.match(source, /message\.type === "REMOVE_CUSTOM_DOMAIN"/);
});

test("background script exposes lockout cooldown settings handlers", () => {
  const source = readText("background.js");
  assert.match(source, /LOCKOUT_COOLDOWN_KEY/);
  assert.match(source, /message\.type === "GET_SETTINGS"/);
  assert.match(source, /message\.type === "SET_LOCKOUT_COOLDOWN"/);
  assert.match(source, /message\.type === "GET_SYNC_STATUS"/);
});
