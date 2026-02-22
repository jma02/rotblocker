const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeKeys(keys) {
  if (keys == null) return { type: "all" };
  if (Array.isArray(keys)) return { type: "array", keys };
  if (typeof keys === "string") return { type: "array", keys: [keys] };
  if (typeof keys === "object") return { type: "object", defaults: keys };
  return { type: "all" };
}

function getSubset(store, keys) {
  const spec = normalizeKeys(keys);
  if (spec.type === "all") {
    return { ...store };
  }
  if (spec.type === "array") {
    const out = {};
    for (const key of spec.keys) out[key] = store[key];
    return out;
  }
  const out = {};
  for (const [key, defaultValue] of Object.entries(spec.defaults)) {
    out[key] = Object.prototype.hasOwnProperty.call(store, key) ? store[key] : defaultValue;
  }
  return out;
}

function createBackgroundHarness(options = {}) {
  const {
    now = 0,
    initialStorage = {},
    initialSyncStorage = {},
    storageLatencyMs = 0,
    initialDynamicRules = [],
    syncSetErrorMessage = null,
    initialTabs = []
  } = options;

  const nowRef = { value: Number(now) || 0 };
  const storage = { ...initialStorage };
  const syncStorage = { ...initialSyncStorage };
  const listeners = {
    onInstalled: null,
    onStartup: null,
    onSuspend: null,
    onAlarm: null,
    onMessage: null,
    onTabUpdated: null,
    onTabActivated: null,
    onTabRemoved: null
  };

  const logs = {
    rulesetUpdates: [],
    dynamicRuleReads: 0,
    dynamicRuleUpdates: [],
    alarmCreates: [],
    alarmClears: [],
    storageGets: [],
    storageSets: [],
    storageRemoves: [],
    storageSyncGets: [],
    storageSyncSets: [],
    storageSyncRemoves: [],
    tabUpdates: []
  };
  let dynamicRules = Array.isArray(initialDynamicRules) ? clone(initialDynamicRules) : [];
  const tabs = new Map(
    (Array.isArray(initialTabs) ? initialTabs : [])
      .filter((tab) => tab && Number.isInteger(tab.id))
      .map((tab) => [tab.id, clone(tab)])
  );

  const asyncCb = (fn) => {
    if (storageLatencyMs > 0) {
      setTimeout(fn, storageLatencyMs);
      return;
    }
    queueMicrotask(fn);
  };

  const chrome = {
    runtime: {
      lastError: null,
      getURL(pathname = "") {
        return `chrome-extension://test-extension/${String(pathname || "").replace(/^\/+/, "")}`;
      },
      onInstalled: {
        addListener(fn) { listeners.onInstalled = fn; }
      },
      onStartup: {
        addListener(fn) { listeners.onStartup = fn; }
      },
      onSuspend: {
        addListener(fn) { listeners.onSuspend = fn; }
      },
      onMessage: {
        addListener(fn) { listeners.onMessage = fn; }
      }
    },
    alarms: {
      create: async (name, info) => {
        logs.alarmCreates.push({ name, info: clone(info) });
      },
      clear: async (name) => {
        logs.alarmClears.push(name);
        return true;
      },
      onAlarm: {
        addListener(fn) { listeners.onAlarm = fn; }
      }
    },
    declarativeNetRequest: {
      updateEnabledRulesets: async (payload) => {
        logs.rulesetUpdates.push(clone(payload));
      },
      getDynamicRules: async () => {
        logs.dynamicRuleReads += 1;
        return clone(dynamicRules);
      },
      updateDynamicRules: async (payload = {}) => {
        logs.dynamicRuleUpdates.push(clone(payload));
        const remove = new Set(Array.isArray(payload.removeRuleIds) ? payload.removeRuleIds : []);
        dynamicRules = dynamicRules.filter((rule) => !remove.has(rule.id));
        const additions = Array.isArray(payload.addRules) ? payload.addRules : [];
        dynamicRules.push(...clone(additions));
      }
    },
    storage: {
      local: {
        get(keys, cb) {
          logs.storageGets.push(clone(keys));
          asyncCb(() => cb(getSubset(storage, keys)));
        },
        set(values, cb) {
          logs.storageSets.push(clone(values));
          asyncCb(() => {
            Object.assign(storage, values || {});
            if (cb) cb();
          });
        },
        remove(keys, cb) {
          logs.storageRemoves.push(clone(keys));
          asyncCb(() => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) delete storage[key];
            if (cb) cb();
          });
        }
      },
      sync: {
        get(keys, cb) {
          logs.storageSyncGets.push(clone(keys));
          asyncCb(() => cb(getSubset(syncStorage, keys)));
        },
        set(values, cb) {
          logs.storageSyncSets.push(clone(values));
          asyncCb(() => {
            if (syncSetErrorMessage) {
              chrome.runtime.lastError = { message: String(syncSetErrorMessage) };
              if (cb) cb();
              chrome.runtime.lastError = null;
              return;
            }
            Object.assign(syncStorage, values || {});
            if (cb) cb();
          });
        },
        remove(keys, cb) {
          logs.storageSyncRemoves.push(clone(keys));
          asyncCb(() => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const key of list) delete syncStorage[key];
            if (cb) cb();
          });
        }
      }
    },
    tabs: {
      update(tabId, updateProperties, callback) {
        logs.tabUpdates.push({ tabId, updateProperties: clone(updateProperties) });
        const current = tabs.get(tabId) || { id: tabId };
        const next = { ...current, ...clone(updateProperties) };
        if (typeof updateProperties?.url === "string") {
          next.url = updateProperties.url;
          next.pendingUrl = updateProperties.url;
        }
        tabs.set(tabId, next);
        asyncCb(() => {
          if (callback) callback(clone(next));
        });
      },
      get(tabId, callback) {
        const tab = tabs.get(tabId);
        asyncCb(() => {
          callback(tab ? clone(tab) : undefined);
        });
      },
      onUpdated: {
        addListener(fn) { listeners.onTabUpdated = fn; }
      },
      onActivated: {
        addListener(fn) { listeners.onTabActivated = fn; }
      },
      onRemoved: {
        addListener(fn) { listeners.onTabRemoved = fn; }
      }
    }
  };

  const NativeDate = Date;
  class FakeDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) {
        super(nowRef.value);
        return;
      }
      super(...args);
    }
    static now() {
      return nowRef.value;
    }
  }

  const sandbox = {
    console,
    chrome,
    Date: FakeDate,
    URL,
    setTimeout,
    clearTimeout,
    Promise
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(process.cwd(), "background.js"), "utf8");
  vm.runInContext(source, sandbox);

  async function flush(turns = 5) {
    for (let i = 0; i < turns; i += 1) {
      await delay(storageLatencyMs > 0 ? storageLatencyMs + 1 : 0);
    }
  }

  async function sendMessage(message, options = {}) {
    const {
      timeoutMs = 300,
      settleMs = 20
    } = options;

    if (typeof listeners.onMessage !== "function") {
      throw new Error("background onMessage listener not registered");
    }

    const responses = [];
    const returned = listeners.onMessage(message, {}, (response) => {
      responses.push(response);
    });

    const deadline = Date.now() + timeoutMs;
    while (responses.length === 0 && Date.now() < deadline) {
      await delay(1);
    }
    if (responses.length === 0) {
      throw new Error(`No sendResponse for message: ${JSON.stringify(message)}`);
    }
    await delay(settleMs);
    return {
      returned,
      count: responses.length,
      response: responses[responses.length - 1],
      responses
    };
  }

  async function triggerInstalled() {
    if (typeof listeners.onInstalled === "function") listeners.onInstalled();
    await flush();
  }

  async function triggerStartup() {
    if (typeof listeners.onStartup === "function") listeners.onStartup();
    await flush();
  }

  async function triggerAlarm(name) {
    if (typeof listeners.onAlarm === "function") listeners.onAlarm({ name });
    await flush();
  }

  async function triggerSuspend() {
    if (typeof listeners.onSuspend === "function") listeners.onSuspend();
    await flush();
  }

  async function triggerTabUpdated(tabId, changeInfo = {}, tab = null) {
    if (tab && Number.isInteger(tab.id)) {
      tabs.set(tab.id, clone(tab));
    }
    const known = tabs.get(tabId);
    if (!known) tabs.set(tabId, { id: tabId });
    const payloadTab = clone(tab || tabs.get(tabId));
    if (typeof listeners.onTabUpdated === "function") {
      listeners.onTabUpdated(tabId, clone(changeInfo), payloadTab);
    }
    await flush();
  }

  async function triggerTabActivated(tabId) {
    if (typeof listeners.onTabActivated === "function") {
      listeners.onTabActivated({ tabId });
    }
    await flush();
  }

  async function triggerTabRemoved(tabId) {
    tabs.delete(tabId);
    if (typeof listeners.onTabRemoved === "function") {
      listeners.onTabRemoved(tabId, {});
    }
    await flush();
  }

  function setNow(value) {
    nowRef.value = Number(value) || 0;
  }

  function getStorage() {
    return { ...storage };
  }

  function getDynamicRules() {
    return clone(dynamicRules);
  }

  function setStorage(values) {
    Object.assign(storage, values || {});
  }

  function getSyncStorage() {
    return { ...syncStorage };
  }

  function setSyncStorage(values) {
    Object.assign(syncStorage, values || {});
  }

  return {
    logs,
    setNow,
    getStorage,
    getDynamicRules,
    setStorage,
    getSyncStorage,
    setSyncStorage,
    sendMessage,
    triggerInstalled,
    triggerStartup,
    triggerSuspend,
    triggerAlarm,
    triggerTabUpdated,
    triggerTabActivated,
    triggerTabRemoved,
    flush
  };
}

module.exports = { createBackgroundHarness };
