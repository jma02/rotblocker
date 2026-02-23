const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("tutor requests prepend current problem and user prompt headers", () => {
  const source = readText("challenge-modules/tutor.js");
  assert.match(source, /\bfunction buildTutorUserPrompt\(userText\)/);
  assert.match(source, /"CURRENT PROBLEM:"/);
  assert.match(source, /"USER PROMPT:"/);
  assert.match(source, /const contextualizedUserPrompt = buildTutorUserPrompt\(userText\)/);
  assert.match(source, /\{\s*role:\s*"user",\s*content:\s*contextualizedUserPrompt\s*\}/);
  assert.doesNotMatch(source, /Current problem context:/);
});

test("problem transitions annotate tutor context and reset stale tutor history", () => {
  const gameplay = readText("challenge-modules/gameplay.js");
  const bootstrap = readText("challenge-modules/bootstrap.js");

  assert.match(gameplay, /\bfunction setTutorProblemEvent\(note\)/);
  assert.match(gameplay, /\bfunction nextProblem\(eventNote = null\)/);
  assert.match(gameplay, /setTutorProblemEvent\(eventNote \|\| "Loaded a new problem\."\)/);
  assert.match(gameplay, /aiHistory = \[\];/);
  assert.match(gameplay, /answered correctly/);

  assert.match(bootstrap, /User rerolled the problem\. Loaded a new problem\./);
  assert.match(bootstrap, /answered incorrectly\. Loaded a new problem\./);
});
