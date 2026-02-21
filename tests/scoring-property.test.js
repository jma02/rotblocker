const test = require("node:test");
const assert = require("node:assert/strict");
const scoring = require("../scoring.js");
const { loadChallengeFns } = require("./challenge-harness");

function makeRng(seed = 0xC0FFEE) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function randBetween(rng, min, max) {
  return min + (max - min) * rng();
}

function maybe(rng, value, fallback) {
  return rng() < 0.5 ? value : fallback;
}

test("scoring fallback in challenge matches scoring.js across randomized inputs", () => {
  const { resolveScoringApi } = loadChallengeFns({
    rotBlockerScoring: undefined,
    siteBlockerScoring: undefined
  });
  const fallback = resolveScoringApi();
  const rng = makeRng(0xA11CE);

  for (let i = 0; i < 750; i += 1) {
    const multipliers = Array.from({ length: 5 }, () => Number(randBetween(rng, 0, 1).toFixed(3)));
    const args = {
      baseWeight: maybe(rng, randBetween(rng, -40, 80), "bad"),
      elapsedMs: maybe(rng, randBetween(rng, -2000, 200000), null),
      durationMs: rng() < 0.1 ? Infinity : maybe(rng, randBetween(rng, -2000, 200000), undefined),
      hintUsed: rng() < 0.25,
      isMcq: rng() < 0.5,
      wrongGuesses: maybe(rng, Math.floor(randBetween(rng, -2, 9)), "bad"),
      multipliers
    };

    assert.equal(
      fallback.pointsIfCorrectNow(args),
      scoring.pointsIfCorrectNow(args),
      `mismatch at iteration ${i}`
    );
  }
});

test("scoring invariants hold under randomized input", () => {
  const rng = makeRng(0xBEE5);

  for (let i = 0; i < 750; i += 1) {
    const baseWeight = randBetween(rng, -20, 60);
    const elapsed = randBetween(rng, -2000, 120000);
    const duration = rng() < 0.1 ? Infinity : randBetween(rng, -2000, 120000);
    const wrongGuesses = Math.floor(randBetween(rng, -2, 8));

    const decayed = scoring.decayedBasePoints(baseWeight, elapsed, duration);
    assert.ok(Number.isFinite(decayed));
    assert.ok(decayed >= 0, `decayed must be non-negative: ${decayed}`);

    const withHint = scoring.pointsIfCorrectNow({
      baseWeight,
      elapsedMs: elapsed,
      durationMs: duration,
      hintUsed: true,
      isMcq: rng() < 0.5,
      wrongGuesses,
      multipliers: [1, 0.5, 0.25, 0.1, 0]
    });
    assert.equal(withHint, 0);

    const g = scoring.guessMultiplier(wrongGuesses + 1, [1, 0.5, 0.25, 0.1, 0]);
    assert.ok(g >= 0 && g <= 1, `guess multiplier out of bounds: ${g}`);
  }
});
