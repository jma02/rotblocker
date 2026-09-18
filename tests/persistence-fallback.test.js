const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./background-harness");
const { loadChallengeFns } = require("./challenge-harness");

function createLocalStorageMock(seed = {}) {
  const raw = {};
  Object.entries(seed || {}).forEach(([key, value]) => {
    raw[String(key)] = String(value);
  });
  return {
    __raw: raw,
    getItem(key) {
      const k = String(key);
      return Object.prototype.hasOwnProperty.call(raw, k) ? raw[k] : null;
    },
    setItem(key, value) {
      raw[String(key)] = String(value);
    },
    removeItem(key) {
      delete raw[String(key)];
    }
  };
}

test("xp persists through chrome storage and sync when extension runtime is available", async () => {
  const h = createBackgroundHarness({
    now: 1_000,
    initialStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 },
    initialSyncStorage: { score: 0, xp: 0, prestige: 0, unlockedUntil: null, stateUpdatedAt: 1 }
  });

  const add = await h.sendMessage({ type: "ADD_SCORE", points: 4 });
  assert.equal(add.response.ok, true);
  assert.equal(add.response.xp, 4);
  assert.equal(h.getStorage().xp, 4);

  await h.triggerSuspend();
  assert.equal(h.getSyncStorage().xp, 4);
});

test("preview fallback persists xp and ai config in localStorage when chrome storage is unavailable", async () => {
  const localStorageMock = createLocalStorageMock();
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ data: [{ id: "gpt-4o-mini" }] })
  });

  const first = loadChallengeFns({
    extensionRuntime: false,
    localStorageOverride: localStorageMock,
    fetchImpl
  });

  const add = await first.sendMessage({ type: "ADD_SCORE", points: 7 });
  assert.equal(add.ok, true);
  assert.equal(add.xp, 7);

  const refs1 = first.__sandbox.RB.dom.refs;
  refs1.aiProviderEl.value = "openai";
  refs1.aiModelEl.value = "gpt-4o-mini";
  refs1.aiTokenEl.value = "local-fallback-token";
  await first.saveAiConfig();

  const persisted = JSON.parse(localStorageMock.__raw.rb_preview_state_v1 || "{}");
  assert.equal(persisted.xp, 7);
  assert.deepEqual(persisted.ai_config, {
    provider: "openai",
    model: "gpt-4o-mini",
    token: "local-fallback-token"
  });

  const second = loadChallengeFns({
    extensionRuntime: false,
    localStorageOverride: localStorageMock,
    fetchImpl
  });

  const nextState = await second.sendMessage({ type: "GET_STATE" });
  assert.equal(nextState.ok, true);
  assert.equal(nextState.xp, 7);

  await second.loadAiConfig();
  const refs2 = second.__sandbox.RB.dom.refs;
  assert.equal(refs2.aiProviderEl.value, "openai");
  assert.equal(refs2.aiModelEl.value, "gpt-4o-mini");
  assert.equal(refs2.aiTokenEl.value, "local-fallback-token");
});

test("preview fallback caps persisted model-cache entries to avoid unbounded localStorage growth", async () => {
  const seededState = {
    score: 0,
    xp: 0,
    prestige: 0,
    stateUpdatedAt: 1
  };
  for (let i = 0; i < 20; i += 1) {
    seededState[`ai_models_cache_openai_${String(i).padStart(2, "0")}`] = {
      models: [`gpt-${i}`],
      fetchedAt: 1_000 + i
    };
  }

  const localStorageMock = createLocalStorageMock({
    rb_preview_state_v1: JSON.stringify(seededState)
  });

  const fns = loadChallengeFns({
    extensionRuntime: false,
    localStorageOverride: localStorageMock,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o-mini" }] })
    })
  });

  const add = await fns.sendMessage({ type: "ADD_SCORE", points: 1 });
  assert.equal(add.ok, true);

  const persisted = JSON.parse(localStorageMock.__raw.rb_preview_state_v1 || "{}");
  const cacheKeys = Object.keys(persisted).filter((key) => key.startsWith("ai_models_cache_"));
  assert.equal(cacheKeys.length, 8);
  assert.ok(cacheKeys.includes("ai_models_cache_openai_19"));
  assert.ok(cacheKeys.includes("ai_models_cache_openai_12"));
  assert.ok(!cacheKeys.includes("ai_models_cache_openai_11"));
});
