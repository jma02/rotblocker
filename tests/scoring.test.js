const test = require('node:test');
const assert = require('node:assert/strict');
const scoring = require('../scoring.js');

test('guess multipliers follow requested ladder', () => {
  assert.equal(scoring.guessMultiplier(1), 1);
  assert.equal(scoring.guessMultiplier(2), 0.25);
  assert.equal(scoring.guessMultiplier(3), 0.125);
  assert.equal(scoring.guessMultiplier(4), 0.0625);
  assert.equal(scoring.guessMultiplier(5), 0.03125);
});

test('decayed base points are linear and bounded', () => {
  assert.equal(scoring.decayedBasePoints(10, 0, 1000), 10);
  assert.equal(scoring.decayedBasePoints(10, 500, 1000), 5);
  assert.equal(scoring.decayedBasePoints(10, 1000, 1000), 0);
  assert.equal(scoring.decayedBasePoints(10, 1500, 1000), 0);
  assert.equal(scoring.decayedBasePoints(30, 999999, Infinity), 30);
});

test('mcq points apply decay and guess penalty', () => {
  const points = scoring.pointsIfCorrectNow({
    baseWeight: 12,
    elapsedMs: 0,
    durationMs: 90000,
    hintUsed: false,
    isMcq: true,
    wrongGuesses: 1,
  });
  assert.equal(points, 3);
});

test('hint forces zero points', () => {
  const points = scoring.pointsIfCorrectNow({
    baseWeight: 60,
    elapsedMs: 1000,
    durationMs: 90000,
    hintUsed: true,
    isMcq: false,
    wrongGuesses: 0,
  });
  assert.equal(points, 0);
});
