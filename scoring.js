(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.RotBlockerScoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const DEFAULT_GUESS_MULTIPLIERS = [1, 0.25, 0.125, 0.0625, 0.03125];

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function guessMultiplier(guessNumber, multipliers) {
    const list = multipliers || DEFAULT_GUESS_MULTIPLIERS;
    if (!Number.isFinite(guessNumber) || guessNumber < 1) return 0;
    return list[guessNumber - 1] || 0;
  }

  function decayMultiplier(elapsedMs, durationMs) {
    if (durationMs === Infinity) return 1;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
    const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
    return Math.max(0, 1 - elapsed / durationMs);
  }

  function decayedBasePoints(baseWeight, elapsedMs, durationMs) {
    if (!Number.isFinite(baseWeight) || baseWeight <= 0) return 0;
    return round2(baseWeight * decayMultiplier(elapsedMs, durationMs));
  }

  function pointsIfCorrectNow(args) {
    const {
      baseWeight,
      elapsedMs,
      durationMs,
      hintUsed,
      isMcq,
      wrongGuesses,
      multipliers,
    } = args;

    if (hintUsed) return 0;

    const base = decayedBasePoints(baseWeight, elapsedMs, durationMs);
    if (!isMcq) return base;

    const guessNumber = (Number.isFinite(wrongGuesses) ? wrongGuesses : 0) + 1;
    return round2(base * guessMultiplier(guessNumber, multipliers));
  }

  return {
    DEFAULT_GUESS_MULTIPLIERS,
    guessMultiplier,
    decayMultiplier,
    decayedBasePoints,
    pointsIfCorrectNow,
    round2,
  };
});
