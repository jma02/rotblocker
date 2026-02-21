const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

const { levelFromXp, avatarTierFromLevel } = loadChallengeFns();

test("levelFromXp keeps expected square-root progression", () => {
  assert.equal(levelFromXp(0), 1);
  assert.equal(levelFromXp(24.99), 1);
  assert.equal(levelFromXp(25), 2);
  assert.equal(levelFromXp(100), 3);
  assert.equal(levelFromXp(225), 4);
  assert.equal(levelFromXp(2025), 10);
});

test("avatarTierFromLevel evolves at intended milestones", () => {
  assert.equal(avatarTierFromLevel(1), "rookie");
  assert.equal(avatarTierFromLevel(3), "rookie");
  assert.equal(avatarTierFromLevel(4), "adept");
  assert.equal(avatarTierFromLevel(6), "adept");
  assert.equal(avatarTierFromLevel(7), "veteran");
  assert.equal(avatarTierFromLevel(9), "veteran");
  assert.equal(avatarTierFromLevel(10), "legend");
  assert.equal(avatarTierFromLevel(25), "legend");
});
