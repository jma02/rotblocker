const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function assertScriptOrder(source, scoringSrc, challengeSrc) {
  const scoringTag = `<script src="${scoringSrc}"></script>`;
  const challengeTag = `<script src="${challengeSrc}"></script>`;
  const scoringIdx = source.indexOf(scoringTag);
  const challengeIdx = source.indexOf(challengeTag);

  assert.notEqual(scoringIdx, -1, `missing ${scoringTag}`);
  assert.notEqual(challengeIdx, -1, `missing ${challengeTag}`);
  assert.ok(scoringIdx < challengeIdx, `${scoringTag} must appear before ${challengeTag}`);
}

test("rotblocker entrypoint loads scoring.js before challenge.js", () => {
  const source = readText("rotblocker++/index.html");
  assertScriptOrder(source, "../scoring.js", "../challenge.js");
});

test("legacy challenge entrypoint loads scoring.js before challenge.js", () => {
  const source = readText("challenge.html");
  assertScriptOrder(source, "scoring.js", "challenge.js");
});
