const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("tutor form uses a single submit button (no separate cancel button)", () => {
  const html = readText("rotblocker++/index.html");
  assert.doesNotMatch(html, /id="ai-cancel"/);
  assert.match(html, /<button type="submit">Ask Tutor<\/button>/);
});

test("tutor request flow supports abort and cancel handling", () => {
  const source = readText("challenge.js");
  assert.match(source, /\baiAbortController\b/);
  assert.match(source, /\bfunction isAbortError\b/);
  assert.match(source, /aiSubmitEl\.classList\.toggle\("is-cancel", isLoading\)/);
  assert.match(source, /<span class=\\"ai-submit-text\\">Cancel<\/span>/);
  assert.match(source, /if \(aiBusy\) \{\s*if \(!aiAbortController\) return;/);
  assert.match(source, /aiAbortController\.abort\(\)/);
  assert.match(source, /callTutor\(text, aiAbortController\?\.signal\)/);
  assert.match(source, /if \(isAbortError\(err\)\)/);
  assert.match(source, /appendChat\("system", "Request canceled\."\)/);
});
