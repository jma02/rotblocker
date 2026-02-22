const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

function pickKeys(store, keys) {
  if (Array.isArray(keys)) {
    const out = {};
    keys.forEach((key) => {
      out[key] = store[key];
    });
    return out;
  }
  if (typeof keys === "string") {
    return { [keys]: store[keys] };
  }
  if (keys && typeof keys === "object") {
    const out = {};
    Object.keys(keys).forEach((key) => {
      out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : keys[key];
    });
    return out;
  }
  return { ...store };
}

function createChromeMock({ localSeed = {}, syncSeed = {} } = {}) {
  const localStore = { ...localSeed };
  const syncStore = { ...syncSeed };
  const localSetCalls = [];
  const syncSetCalls = [];
  const runtime = {
    id: "test-runtime",
    lastError: null,
    sendMessage(_message, callback) {
      callback?.({ ok: true });
    },
    getURL(path) {
      return `chrome-extension://test/${String(path || "").replace(/^\/+/, "")}`;
    }
  };

  const local = {
    get(keys, cb) {
      cb(pickKeys(localStore, keys));
    },
    set(values, cb) {
      localSetCalls.push({ ...(values || {}) });
      Object.assign(localStore, values || {});
      cb?.();
    },
    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((key) => {
        delete localStore[key];
      });
      cb?.();
    }
  };

  const sync = {
    get(keys, cb) {
      cb(pickKeys(syncStore, keys));
    },
    set(values, cb) {
      syncSetCalls.push({ ...(values || {}) });
      Object.assign(syncStore, values || {});
      cb?.();
    }
  };

  return {
    chrome: {
      runtime,
      storage: {
        local,
        sync
      }
    },
    localStore,
    syncStore,
    localSetCalls,
    syncSetCalls
  };
}

test("loadAiConfig prefers sync profile config over local config", async () => {
  const localCfg = { provider: "openai", model: "gpt-local", token: "local-token" };
  const syncCfg = { provider: "openrouter", model: "openrouter/auto", token: "sync-token" };
  const chromeMock = createChromeMock({
    localSeed: { ai_config: localCfg },
    syncSeed: { ai_config: syncCfg }
  });

  const fetchCalls = [];
  const fns = loadChallengeFns({
    chromeOverride: chromeMock.chrome,
    fetchImpl: async (url) => {
      fetchCalls.push(String(url));
      return {
        ok: true,
        json: async () => ({ data: [{ id: "openrouter/auto" }] })
      };
    }
  });

  await fns.loadAiConfig();

  const refs = fns.__sandbox.RB.dom.refs;
  assert.equal(refs.aiProviderEl.value, "openrouter");
  assert.equal(refs.aiModelEl.value, "openrouter/auto");
  assert.equal(refs.aiTokenEl.value, "sync-token");
  assert.deepEqual(chromeMock.localStore.ai_config, syncCfg);
  assert.equal(chromeMock.syncSetCalls.length, 0);
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0], /openrouter\.ai\/api\/v1\/models/);
});

test("loadAiConfig migrates local-only config into sync storage", async () => {
  const localCfg = { provider: "openai", model: "gpt-4o-mini", token: "only-local-token" };
  const chromeMock = createChromeMock({
    localSeed: { ai_config: localCfg },
    syncSeed: {}
  });

  const fns = loadChallengeFns({
    chromeOverride: chromeMock.chrome,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-4o-mini" }] })
    })
  });

  await fns.loadAiConfig();

  const refs = fns.__sandbox.RB.dom.refs;
  assert.equal(refs.aiProviderEl.value, "openai");
  assert.equal(refs.aiModelEl.value, "gpt-4o-mini");
  assert.equal(refs.aiTokenEl.value, "only-local-token");
  assert.deepEqual(chromeMock.syncStore.ai_config, localCfg);
  assert.equal(chromeMock.syncSetCalls.length, 1);
});
