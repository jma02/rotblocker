const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./background-harness");

const REQUIRED_SCORE = 30;
const UNLOCK_DURATION_MS = 2 * 60 * 60 * 1000;

test("GET_STATE lock boundary treats unlockedUntil === now as locked", async () => {
  const h = createBackgroundHarness({
    now: 10_000,
    initialStorage: { score: 5, unlockedUntil: 10_001 }
  });

  let state = await h.sendMessage({ type: "GET_STATE" });
  assert.equal(state.response.ok, true);
  assert.equal(state.response.locked, false);
  assert.equal(state.response.unlockedUntil, 10_001);

  h.setNow(10_001);
  state = await h.sendMessage({ type: "GET_STATE" });
  assert.equal(state.response.ok, true);
  assert.equal(state.response.locked, true);
  assert.equal(state.response.unlockedUntil, null);
});

test("REQUEST_UNLOCK enforces threshold and unlocks exactly at required score", async () => {
  const h = createBackgroundHarness({
    now: 2_000,
    initialStorage: { score: REQUIRED_SCORE - 0.01 }
  });

  const denied = await h.sendMessage({ type: "REQUEST_UNLOCK" });
  assert.equal(denied.response.ok, false);
  assert.match(denied.response.error, /Need 0\.01 more points\./);

  h.setStorage({ score: REQUIRED_SCORE });
  const granted = await h.sendMessage({ type: "REQUEST_UNLOCK" });
  assert.equal(granted.response.ok, true);
  assert.equal(granted.response.unlockedUntil, 2_000 + UNLOCK_DURATION_MS);

  const store = h.getStorage();
  assert.equal(store.score, 0);
  assert.equal(store.unlockedUntil, 2_000 + UNLOCK_DURATION_MS);

  assert.deepEqual(h.logs.rulesetUpdates.at(-1), {
    enableRulesetIds: [],
    disableRulesetIds: ["block_rules"]
  });
  assert.deepEqual(h.logs.alarmCreates.at(-1), {
    name: "relock",
    info: { when: 2_000 + UNLOCK_DURATION_MS }
  });
});

test("SET_LOCKOUT_COOLDOWN persists and REQUEST_UNLOCK uses the configured duration", async () => {
  const h = createBackgroundHarness({
    now: 12_000,
    initialStorage: { score: REQUIRED_SCORE }
  });

  const initialSettings = await h.sendMessage({ type: "GET_SETTINGS" });
  assert.equal(initialSettings.response.ok, true);
  assert.equal(initialSettings.response.lockoutCooldownMs, UNLOCK_DURATION_MS);

  const setCooldown = await h.sendMessage({ type: "SET_LOCKOUT_COOLDOWN", minutes: 45 });
  assert.equal(setCooldown.response.ok, true);
  assert.equal(setCooldown.response.lockoutCooldownMs, 45 * 60 * 1000);

  const state = await h.sendMessage({ type: "GET_STATE" });
  assert.equal(state.response.ok, true);
  assert.equal(state.response.unlockDurationMs, 45 * 60 * 1000);
  assert.equal(h.getStorage().lockoutCooldownMs, 45 * 60 * 1000);

  const unlocked = await h.sendMessage({ type: "REQUEST_UNLOCK" });
  assert.equal(unlocked.response.ok, true);
  assert.equal(unlocked.response.unlockedUntil, 12_000 + (45 * 60 * 1000));
  assert.equal(unlocked.response.unlockDurationMs, 45 * 60 * 1000);
  assert.deepEqual(h.logs.alarmCreates.at(-1), {
    name: "relock",
    info: { when: 12_000 + (45 * 60 * 1000) }
  });
});

test("alarm relock path clears unlockedUntil but keeps score when resetScore is false", async () => {
  const h = createBackgroundHarness({
    now: 7_000,
    initialStorage: { score: 19.75, unlockedUntil: 8_000 }
  });

  await h.triggerAlarm("relock");

  const store = h.getStorage();
  assert.equal(store.unlockedUntil, null);
  assert.equal(store.score, 19.75);
  assert.equal(h.logs.alarmClears.at(-1), "relock");
  assert.deepEqual(h.logs.rulesetUpdates.at(-1), {
    enableRulesetIds: ["block_rules"],
    disableRulesetIds: []
  });
});

test("onInstalled initializes storage keys and enters locked state via expected Chrome APIs", async () => {
  const h = createBackgroundHarness({ now: 500 });

  await h.triggerInstalled();

  assert.equal(h.logs.storageSets[0].score, 0);
  assert.equal(h.logs.storageSets[0].xp, 0);
  assert.equal(h.logs.storageSets[0].prestige, 0);
  assert.equal(h.logs.storageSets[0].unlockedUntil, null);
  assert.equal(h.logs.storageSets[0].lockoutCooldownMs, UNLOCK_DURATION_MS);
  assert.equal(typeof h.logs.storageSets[0].stateUpdatedAt, "number");
  assert.deepEqual(h.logs.rulesetUpdates.at(-1), {
    enableRulesetIds: ["block_rules"],
    disableRulesetIds: []
  });
  assert.equal(h.logs.alarmClears.at(-1), "relock");
  assert.equal(h.getStorage().unlockedUntil, null);
});

test("message handlers call sendResponse exactly once", async () => {
  const h = createBackgroundHarness({
    now: 3_000,
    initialStorage: { score: REQUIRED_SCORE, xp: 0, prestige: 0 }
  });

  const getState = await h.sendMessage({ type: "GET_STATE" });
  assert.equal(getState.count, 1);

  const addScore = await h.sendMessage({ type: "ADD_SCORE", points: 2 });
  assert.equal(addScore.count, 1);

  const unlock = await h.sendMessage({ type: "REQUEST_UNLOCK" });
  assert.equal(unlock.count, 1);

  const relock = await h.sendMessage({ type: "RELOCK" });
  assert.equal(relock.count, 1);

  const unknown = await h.sendMessage({ type: "NOPE" });
  assert.equal(unknown.count, 1);
  assert.equal(unknown.response.ok, false);
});

test("concurrent ADD_SCORE requests preserve total score and XP", async () => {
  const h = createBackgroundHarness({
    now: 20_000,
    storageLatencyMs: 4,
    initialStorage: { score: 0, xp: 0, prestige: 0 }
  });

  const jobs = Array.from({ length: 20 }, () =>
    h.sendMessage({ type: "ADD_SCORE", points: 1 }, { timeoutMs: 1_000, settleMs: 8 })
  );
  const responses = await Promise.all(jobs);
  for (const res of responses) assert.equal(res.response.ok, true);

  await h.flush(8);
  const store = h.getStorage();
  assert.equal(store.score, 20);
  assert.equal(store.xp, 20);
});

test("near-simultaneous REQUEST_UNLOCK then RELOCK ends locked and clears timer", async () => {
  const h = createBackgroundHarness({
    now: 4_000,
    storageLatencyMs: 4,
    initialStorage: { score: REQUIRED_SCORE, xp: 10, prestige: 0 }
  });

  const unlockPromise = h.sendMessage({ type: "REQUEST_UNLOCK" }, { timeoutMs: 1_000, settleMs: 8 });
  const relockPromise = h.sendMessage({ type: "RELOCK" }, { timeoutMs: 1_000, settleMs: 8 });
  await Promise.all([unlockPromise, relockPromise]);
  await h.flush(10);

  const state = await h.sendMessage({ type: "GET_STATE" });
  assert.equal(state.response.locked, true);
  assert.equal(state.response.unlockedUntil, null);

  const store = h.getStorage();
  assert.equal(store.unlockedUntil, null);
  assert.equal(store.score, 0);
});

test("startup keeps unlocked mode active when unlockedUntil is in the future", async () => {
  const h = createBackgroundHarness({
    now: 1_000,
    initialStorage: { unlockedUntil: 9_000, score: 3, xp: 7, prestige: 1, stateUpdatedAt: 500 }
  });

  await h.triggerStartup();
  const state = await h.sendMessage({ type: "GET_STATE" });
  assert.equal(state.response.locked, false);
  assert.equal(state.response.unlockedUntil, 9_000);
  assert.deepEqual(h.logs.rulesetUpdates.at(-1), {
    enableRulesetIds: [],
    disableRulesetIds: ["block_rules"]
  });
  assert.deepEqual(h.logs.alarmCreates.at(-1), {
    name: "relock",
    info: { when: 9_000 }
  });
});

test("APPLY_SYNC_STATE rejects malformed payloads", async () => {
  const h = createBackgroundHarness({
    now: 1_000,
    initialStorage: { score: 1, xp: 2, prestige: 0, unlockedUntil: null, stateUpdatedAt: 100 }
  });

  const bad1 = await h.sendMessage({ type: "APPLY_SYNC_STATE", state: null });
  assert.equal(bad1.response.ok, false);
  assert.match(bad1.response.error, /Invalid sync payload/);

  const bad2 = await h.sendMessage({ type: "APPLY_SYNC_STATE", state: { stateUpdatedAt: 0 } });
  assert.equal(bad2.response.ok, false);
  assert.match(bad2.response.error, /Invalid sync payload/);
});

test("APPLY_SYNC_STATE ignores stale payload unless force=true", async () => {
  const h = createBackgroundHarness({
    now: 2_000,
    initialStorage: { score: 8, xp: 10, prestige: 1, unlockedUntil: null, stateUpdatedAt: 1_000 }
  });

  const stale = await h.sendMessage({
    type: "APPLY_SYNC_STATE",
    state: { score: 99, xp: 99, prestige: 9, requiredScore: 30, unlockedUntil: 8_000, stateUpdatedAt: 900 }
  });
  assert.equal(stale.response.ok, true);
  assert.equal(stale.response.applied, false);
  assert.equal(stale.response.score, 8);
  assert.equal(stale.response.xp, 10);
  assert.equal(stale.response.prestige, 1);
  assert.equal(h.getStorage().score, 8);

  const forced = await h.sendMessage({
    type: "APPLY_SYNC_STATE",
    force: true,
    state: { score: 99, xp: 99, prestige: 9, requiredScore: 30, unlockedUntil: 8_000, stateUpdatedAt: 900 }
  });
  assert.equal(forced.response.ok, true);
  assert.equal(forced.response.applied, true);
  assert.equal(forced.response.locked, false);
  assert.equal(forced.response.unlockedUntil, 8_000);
  assert.deepEqual(h.logs.rulesetUpdates.at(-1), {
    enableRulesetIds: [],
    disableRulesetIds: ["block_rules"]
  });
});

test("APPLY_SYNC_STATE with expired unlockedUntil locks rules and clears timer", async () => {
  const h = createBackgroundHarness({
    now: 5_000,
    initialStorage: { score: 2, xp: 4, prestige: 0, unlockedUntil: null, stateUpdatedAt: 100 }
  });

  const res = await h.sendMessage({
    type: "APPLY_SYNC_STATE",
    state: { score: 7, xp: 11, prestige: 2, requiredScore: 30, unlockedUntil: 4_000, stateUpdatedAt: 300 }
  });
  assert.equal(res.response.ok, true);
  assert.equal(res.response.applied, true);
  assert.equal(res.response.locked, true);
  assert.equal(res.response.unlockedUntil, null);

  assert.deepEqual(h.logs.rulesetUpdates.at(-1), {
    enableRulesetIds: ["block_rules"],
    disableRulesetIds: []
  });
  assert.equal(h.logs.alarmClears.at(-1), "relock");
  assert.equal(h.getStorage().unlockedUntil, null);
});

test("GET_STATE waits for pending queued mutations", async () => {
  const h = createBackgroundHarness({
    now: 30_000,
    storageLatencyMs: 6,
    initialStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 }
  });

  const addScorePromise = h.sendMessage({ type: "ADD_SCORE", points: 5 }, { timeoutMs: 1_000, settleMs: 0 });
  const getStatePromise = h.sendMessage({ type: "GET_STATE" }, { timeoutMs: 1_000, settleMs: 0 });
  await addScorePromise;
  const state = await getStatePromise;

  assert.equal(state.response.ok, true);
  assert.equal(state.response.score, 5);
  assert.equal(state.response.xp, 5);
});

test("ADD_SCORE rejects invalid increments without mutating state", async () => {
  const h = createBackgroundHarness({
    now: 40_000,
    initialStorage: { score: 12, xp: 15, prestige: 0, unlockedUntil: null, stateUpdatedAt: 10 }
  });

  const before = h.getStorage();
  const zero = await h.sendMessage({ type: "ADD_SCORE", points: 0 });
  assert.equal(zero.response.ok, false);
  assert.match(zero.response.error, /Invalid score increment/);

  const nan = await h.sendMessage({ type: "ADD_SCORE", points: "abc" });
  assert.equal(nan.response.ok, false);
  assert.match(nan.response.error, /Invalid score increment/);

  const after = h.getStorage();
  assert.equal(after.score, before.score);
  assert.equal(after.xp, before.xp);
});
