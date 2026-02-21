const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./background-harness");

function makeRng(seed = 0xDEADBEEF) {
  let x = seed >>> 0;
  return () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function expectedNormalize(payload) {
  const updatedAt = Math.floor(Number(payload.stateUpdatedAt));
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null;

  const unlockedRaw = Math.floor(Number(payload.unlockedUntil));
  return {
    score: round2(payload.score),
    xp: round2(payload.xp),
    prestige: Math.max(0, Math.floor(Number(payload.prestige) || 0)),
    unlockedUntil: Number.isFinite(unlockedRaw) && unlockedRaw > 0 ? unlockedRaw : null,
    stateUpdatedAt: updatedAt
  };
}

function assertMaybeNaN(actual, expected, msg) {
  if (Number.isNaN(expected)) {
    assert.ok(Number.isNaN(actual), msg || `expected NaN, got ${actual}`);
    return;
  }
  assert.equal(actual, expected, msg);
}

test("APPLY_SYNC_STATE fuzz: accepts/normalizes valid payloads and rejects invalid ones", async () => {
  const now = 50_000;
  const h = createBackgroundHarness({
    now,
    initialStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 }
  });
  const rng = makeRng(0x51A7E);
  const weird = [undefined, null, "", "abc", {}, [], true, false, NaN, Infinity, -Infinity];

  for (let i = 0; i < 300; i += 1) {
    const payload = {
      score: rng() < 0.2 ? weird[Math.floor(rng() * weird.length)] : (rng() * 250 - 80),
      xp: rng() < 0.2 ? weird[Math.floor(rng() * weird.length)] : (rng() * 500 - 100),
      prestige: rng() < 0.2 ? weird[Math.floor(rng() * weird.length)] : (rng() * 15 - 5),
      requiredScore: rng() < 0.2 ? weird[Math.floor(rng() * weird.length)] : (rng() * 100 - 10),
      unlockedUntil: rng() < 0.2 ? weird[Math.floor(rng() * weird.length)] : (rng() * 120000 - 20000),
      stateUpdatedAt: rng() < 0.35 ? weird[Math.floor(rng() * weird.length)] : (rng() * 300000 - 10000)
    };

    const expected = expectedNormalize(payload);
    const res = await h.sendMessage({
      type: "APPLY_SYNC_STATE",
      force: true,
      state: payload
    });

    if (!expected) {
      assert.equal(res.response.ok, false, `expected invalid payload at iteration ${i}`);
      assert.match(res.response.error, /Invalid sync payload/);
      continue;
    }

    assert.equal(res.response.ok, true, `expected valid payload at iteration ${i}`);
    assert.equal(res.response.applied, true);
    assert.equal(res.response.score, round2(expected.score));
    assert.equal(res.response.xp, round2(expected.xp));
    assert.equal(res.response.prestige, expected.prestige);
    assert.equal(res.response.stateUpdatedAt, expected.stateUpdatedAt);

    const expectedUnlocked = expected.unlockedUntil && expected.unlockedUntil > now
      ? expected.unlockedUntil
      : null;
    assert.equal(res.response.unlockedUntil, expectedUnlocked);
    assert.equal(res.response.locked, expectedUnlocked === null);

    const store = h.getStorage();
    assertMaybeNaN(store.score, expected.score, `score mismatch at iteration ${i}`);
    assertMaybeNaN(store.xp, expected.xp, `xp mismatch at iteration ${i}`);
    assert.equal(store.prestige, expected.prestige);
    assert.equal(store.stateUpdatedAt, expected.stateUpdatedAt);
    assert.equal(store.unlockedUntil, expectedUnlocked);
  }
});
