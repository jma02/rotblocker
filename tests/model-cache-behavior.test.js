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
  return { ...store };
}

function createChromeMock(localSeed = {}) {
  const localStore = { ...localSeed };
  return {
    localStore,
    chrome: {
      runtime: {
        id: "test-runtime",
        lastError: null,
        sendMessage(_message, callback) {
          callback?.({ ok: true });
        },
        getURL(path) {
          return `chrome-extension://test/${String(path || "").replace(/^\/+/, "")}`;
        }
      },
      storage: {
        local: {
          get(keys, cb) {
            cb(pickKeys(localStore, keys));
          },
          set(values, cb) {
            Object.assign(localStore, values || {});
            cb?.();
          },
          remove(keys, cb) {
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach((key) => delete localStore[key]);
            cb?.();
          }
        },
        sync: {
          get(_keys, cb) {
            cb({});
          },
          set(_values, cb) {
            cb?.();
          }
        }
      }
    }
  };
}

test("fetchAndCacheModels honors cache TTL and force refresh", async () => {
  const chromeMock = createChromeMock();
  let fetchCount = 0;

  const fns = loadChallengeFns({
    chromeOverride: chromeMock.chrome,
    fetchImpl: async () => {
      fetchCount += 1;
      return {
        ok: true,
        json: async () => ({ data: [{ id: `model-${fetchCount}` }] })
      };
    }
  });

  const token = "token-1234567890";
  const provider = "openai";
  const key = fns.modelCacheKey(provider, token);
  const ttlMs = fns.__sandbox.RB.constants.MODEL_CACHE_TTL_MS;

  const first = await fns.fetchAndCacheModels(provider, token, false);
  assert.deepEqual(first, ["model-1"]);
  assert.equal(fetchCount, 1);

  const second = await fns.fetchAndCacheModels(provider, token, false);
  assert.deepEqual(second, ["model-1"]);
  assert.equal(fetchCount, 1);

  chromeMock.localStore[key].fetchedAt = Date.now() - ttlMs - 1;
  const third = await fns.fetchAndCacheModels(provider, token, false);
  assert.deepEqual(third, ["model-2"]);
  assert.equal(fetchCount, 2);

  const forced = await fns.fetchAndCacheModels(provider, token, true);
  assert.deepEqual(forced, ["model-3"]);
  assert.equal(fetchCount, 3);
});
