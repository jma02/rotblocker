const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./background-harness");

test("startup pulls newer game state from chrome.storage.sync", async () => {
  const h = createBackgroundHarness({
    now: 10_000,
    initialStorage: {
      score: 2,
      xp: 3,
      prestige: 0,
      unlockedUntil: null,
      lockoutCooldownMs: 2 * 60 * 60 * 1000,
      stateUpdatedAt: 100,
      customBlockedDomains: ["old.com"],
      customDomainsUpdatedAt: 100
    },
    initialSyncStorage: {
      score: 9,
      xp: 21,
      prestige: 2,
      unlockedUntil: 20_000,
      lockoutCooldownMs: 30 * 60 * 1000,
      stateUpdatedAt: 900,
      customBlockedDomains: ["new.com"],
      customDomainsUpdatedAt: 800
    }
  });

  await h.triggerStartup();
  const state = await h.sendMessage({ type: "GET_STATE" });
  const local = h.getStorage();

  assert.equal(state.response.ok, true);
  assert.equal(state.response.score, 9);
  assert.equal(state.response.xp, 21);
  assert.equal(state.response.prestige, 2);
  assert.equal(state.response.unlockedUntil, 20_000);
  assert.equal(state.response.unlockDurationMs, 30 * 60 * 1000);
  assert.equal(Array.isArray(local.customBlockedDomains), true);
  assert.equal(local.customBlockedDomains.join(","), "new.com");
  assert.equal(local.lockoutCooldownMs, 30 * 60 * 1000);
});

test("startup pushes newer local state into chrome.storage.sync", async () => {
  const h = createBackgroundHarness({
    now: 50_000,
    initialStorage: {
      score: 7,
      xp: 11,
      prestige: 1,
      unlockedUntil: null,
      lockoutCooldownMs: 90 * 60 * 1000,
      stateUpdatedAt: 700,
      customBlockedDomains: ["localonly.com"],
      customDomainsUpdatedAt: 700
    },
    initialSyncStorage: {
      score: 1,
      xp: 1,
      prestige: 0,
      unlockedUntil: null,
      lockoutCooldownMs: 20 * 60 * 1000,
      stateUpdatedAt: 100,
      customBlockedDomains: [],
      customDomainsUpdatedAt: 100
    }
  });

  await h.triggerStartup();
  const sync = h.getSyncStorage();

  assert.equal(sync.score, 7);
  assert.equal(sync.xp, 11);
  assert.equal(sync.prestige, 1);
  assert.equal(sync.lockoutCooldownMs, 90 * 60 * 1000);
  assert.equal(sync.stateUpdatedAt, 700);
  assert.equal(Array.isArray(sync.customBlockedDomains), true);
  assert.equal(sync.customBlockedDomains.join(","), "localonly.com");
  assert.equal(sync.customDomainsUpdatedAt, 700);
});

test("pending local changes flush to chrome.storage.sync on runtime suspend", async () => {
  const h = createBackgroundHarness({
    now: 1_000,
    initialStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 },
    initialSyncStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 }
  });

  const add = await h.sendMessage({ type: "ADD_SCORE", points: 5 });
  assert.equal(add.response.ok, true);
  assert.equal(h.getSyncStorage().score, 0);

  await h.triggerSuspend();
  const sync = h.getSyncStorage();
  assert.equal(sync.score, 5);
  assert.equal(sync.xp, 5);
  assert.equal(sync.stateUpdatedAt, add.response.stateUpdatedAt);
});

test("GET_SYNC_STATUS reports queued writes and successful flush", async () => {
  const h = createBackgroundHarness({
    now: 2_000,
    initialStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 },
    initialSyncStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 }
  });

  const before = await h.sendMessage({ type: "GET_SYNC_STATUS" });
  assert.equal(before.response.ok, true);
  assert.equal(before.response.available, true);
  assert.equal(before.response.pending, false);
  assert.equal(before.response.lastSyncedAt, null);

  const add = await h.sendMessage({ type: "ADD_SCORE", points: 3 });
  assert.equal(add.response.ok, true);

  const queued = await h.sendMessage({ type: "GET_SYNC_STATUS" });
  assert.equal(queued.response.ok, true);
  assert.equal(queued.response.pending, true);

  await h.triggerSuspend();

  const after = await h.sendMessage({ type: "GET_SYNC_STATUS" });
  assert.equal(after.response.ok, true);
  assert.equal(after.response.pending, false);
  assert.equal(typeof after.response.lastSyncedAt, "number");
  assert.equal(after.response.lastError, null);
});

test("GET_SYNC_STATUS surfaces sync write errors", async () => {
  const h = createBackgroundHarness({
    now: 3_000,
    syncSetErrorMessage: "Quota exceeded.",
    initialStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 },
    initialSyncStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 }
  });

  const add = await h.sendMessage({ type: "ADD_SCORE", points: 2 });
  assert.equal(add.response.ok, true);

  await h.triggerSuspend();

  const status = await h.sendMessage({ type: "GET_SYNC_STATUS" });
  assert.equal(status.response.ok, true);
  assert.equal(status.response.pending, false);
  assert.equal(status.response.lastSyncedAt, null);
  assert.equal(status.response.lastError, "Quota exceeded.");
});
