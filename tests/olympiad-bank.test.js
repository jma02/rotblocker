"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadChallengeFns } = require("./challenge-harness");

const rows = JSON.parse(fs.readFileSync("data/olympiad.json", "utf8"));
const expectedCountries = ["China", "Poland", "Russia", "United States"];

test("olympiad bank has ten verified numeric-response problems per requested country", () => {
  assert.equal(rows.length, 40);
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length);

  const counts = Object.fromEntries(expectedCountries.map((country) => [country, 0]));
  for (const row of rows) {
    assert.equal(row.type, "input", `${row.id} must use the numeric input grader`);
    assert.equal(row.contest, "olympiad");
    assert.equal(row.weight, 30);
    assert.equal(Number.isInteger(row.answer), true, `${row.id} needs an exact integer answer`);
    assert.equal(Array.isArray(row.choices), false);
    assert.ok(expectedCountries.includes(row.source?.country), `${row.id} has an unknown country`);
    assert.match(row.source?.url || "", /^https:\/\//);
    assert.match(row.source?.originalLanguage || "", /^(Chinese|Polish|Russian|English)$/);
    assert.match(row.source?.translation || "", /(?:translated|translation|English statement)/i);
    assert.match(row.source?.answerVerification || "", /(?:official|published|independent)/i);
    counts[row.source.country] += 1;
  }

  assert.deepEqual(counts, {
    China: 10,
    Poland: 10,
    Russia: 10,
    "United States": 10
  });
});

test("every olympiad row survives the production rendering guard without a visual", () => {
  const fns = loadChallengeFns();

  for (const row of rows) {
    const prepared = fns.prepareProblemForBank(row);
    assert.equal(fns.problemRequiresExternalVisual(row), false, `${row.id} requires a missing visual`);
    assert.equal(fns.problemLooksRenderable(prepared), true, `${row.id} is not runtime-selectable`);
    assert.equal(prepared.__sanitizedPrompt.trim().length > 0, true);
    assert.equal(fns.hasMalformedMathSyntax(prepared.__sanitizedPrompt), false, `${row.id} has malformed math`);
  }
});

test("olympiad pool is packaged as an opt-in, 30-point, no-decay bank", () => {
  const fns = loadChallengeFns();
  const constants = fns.__sandbox.RB.constants;
  const state = fns.__getGameplayStateForTest();
  const html = fs.readFileSync("rotblocker++/index.html", "utf8");

  assert.equal(constants.POOL_FILE_BY_KEY.olympiad, "olympiad");
  assert.equal(constants.BASE_WEIGHT_BY_CONTEST.olympiad, 30);
  assert.equal(constants.DECAY_DURATION_BY_CONTEST_MS.olympiad, Infinity);
  assert.equal(state.poolEnabled.olympiad, false);
  assert.equal(state.poolAvailable.olympiad, true);
  assert.equal(state.poolLoaded.olympiad, false);
  assert.match(
    html,
    /data-pool="olympiad"[^>]*aria-pressed="false"[^>]*>Olympiad: 30<\/button>/
  );
});
