const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

test("resolveScoringApi prefers RotBlockerScoring when available", () => {
  const api = {
    guessMultiplier() { return 11; },
    decayedBasePoints() { return 22; },
    pointsIfCorrectNow() { return 33; }
  };
  const fns = loadChallengeFns({
    rotBlockerScoring: api,
    siteBlockerScoring: {
      guessMultiplier() { return -1; },
      decayedBasePoints() { return -1; },
      pointsIfCorrectNow() { return -1; }
    }
  });
  const resolved = fns.resolveScoringApi();
  assert.equal(resolved, api);
});

test("resolveScoringApi falls back to SiteBlockerScoring for compatibility", () => {
  const legacy = {
    guessMultiplier() { return 2; },
    decayedBasePoints() { return 3; },
    pointsIfCorrectNow() { return 4; }
  };
  const fns = loadChallengeFns({
    rotBlockerScoring: undefined,
    siteBlockerScoring: legacy
  });
  const resolved = fns.resolveScoringApi();
  assert.equal(resolved, legacy);
});

test("resolveScoringApi provides internal fallback when no global is present", () => {
  const { resolveScoringApi } = loadChallengeFns({
    rotBlockerScoring: undefined,
    siteBlockerScoring: undefined
  });
  const scoring = resolveScoringApi();
  assert.equal(scoring.guessMultiplier(1, [1, 0.5]), 1);
  assert.equal(scoring.decayedBasePoints(10, 500, 1000), 5);
  assert.equal(scoring.pointsIfCorrectNow({
    baseWeight: 10,
    elapsedMs: 0,
    durationMs: 1000,
    isMcq: true,
    wrongGuesses: 1,
    multipliers: [1, 0.1]
  }), 1);
});
