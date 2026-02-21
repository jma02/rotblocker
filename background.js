const RULESET_ID = "block_rules";
const ALARM_NAME = "relock";
const REQUIRED_SCORE = 30;
const UNLOCK_DURATION_MS = 2 * 60 * 60 * 1000;
const LOCKOUT_COOLDOWN_KEY = "lockoutCooldownMs";
const MIN_LOCKOUT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_LOCKOUT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const LEVELS_PER_PRESTIGE = 10;
const PRESTIGE_XP_BONUS_STEP = 0.05;
const CUSTOM_DOMAINS_KEY = "customBlockedDomains";
const CUSTOM_DOMAINS_UPDATED_AT_KEY = "customDomainsUpdatedAt";
const CUSTOM_RULE_ID_BASE = 10000;
const CUSTOM_RULE_ID_LIMIT = 500;
const MAX_CUSTOM_DOMAINS = 200;
const SYNC_WRITE_DEBOUNCE_MS = 10_000;
const SYNC_KEYS = [
  "score",
  "xp",
  "prestige",
  "unlockedUntil",
  LOCKOUT_COOLDOWN_KEY,
  "stateUpdatedAt",
  CUSTOM_DOMAINS_KEY,
  CUSTOM_DOMAINS_UPDATED_AT_KEY
];
let stateMutationQueue = Promise.resolve();
let syncWriteTimer = null;
let syncWriteScheduledFor = 0;
let syncLastAttemptAt = 0;
let syncLastSyncedAt = 0;
let syncLastError = null;

function levelFromXp(totalXp) {
  const xpSafe = Math.max(0, Number(totalXp) || 0);
  return Math.max(1, Math.floor(Math.sqrt(xpSafe / 25)) + 1);
}

function canPrestigeNow(totalXp) {
  return levelFromXp(totalXp) >= LEVELS_PER_PRESTIGE;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeLockoutCooldownMs(value, fallback = UNLOCK_DURATION_MS) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(MIN_LOCKOUT_COOLDOWN_MS, Math.min(MAX_LOCKOUT_COOLDOWN_MS, parsed));
}

function normalizeDomainInput(input) {
  let domain = String(input || "").trim().toLowerCase();
  if (!domain) return null;

  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  domain = domain.replace(/^\/+/, "");
  domain = domain.split(/[/?#]/)[0];
  domain = domain.replace(/:\d+$/, "");
  domain = domain.replace(/^\*\./, "");
  domain = domain.replace(/\.$/, "");
  if (domain.startsWith("www.")) {
    domain = domain.slice(4);
  }
  if (!domain) return null;
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  if (domain.includes("..")) return null;

  if (domain === "localhost") {
    return domain;
  }

  const labels = domain.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!/^[a-z0-9-]+$/.test(label)) return null;
    if (label.startsWith("-") || label.endsWith("-")) return null;
    if (label.length > 63) return null;
  }
  if (labels[labels.length - 1].length < 2) return null;
  return domain;
}

function sanitizeDomainList(list) {
  const seen = new Set();
  const sanitized = [];
  const source = Array.isArray(list) ? list : [];
  for (const item of source) {
    const domain = normalizeDomainInput(item);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    sanitized.push(domain);
    if (sanitized.length >= MAX_CUSTOM_DOMAINS) break;
  }
  return sanitized;
}

function normalizeStoredState(input) {
  const raw = input && typeof input === "object" ? input : {};
  const unlockedRaw = Math.floor(Number(raw.unlockedUntil));
  return {
    score: round2(raw.score),
    xp: round2(raw.xp),
    prestige: Math.max(0, Math.floor(Number(raw.prestige) || 0)),
    unlockedUntil: Number.isFinite(unlockedRaw) && unlockedRaw > 0 ? unlockedRaw : null,
    [LOCKOUT_COOLDOWN_KEY]: normalizeLockoutCooldownMs(raw[LOCKOUT_COOLDOWN_KEY]),
    stateUpdatedAt: Math.max(0, Math.floor(Number(raw.stateUpdatedAt) || 0)),
    customBlockedDomains: sanitizeDomainList(raw[CUSTOM_DOMAINS_KEY]),
    customDomainsUpdatedAt: Math.max(0, Math.floor(Number(raw[CUSTOM_DOMAINS_UPDATED_AT_KEY]) || 0))
  };
}

function syncPayloadFromState(state) {
  const normalized = normalizeStoredState(state);
  return {
    score: normalized.score,
    xp: normalized.xp,
    prestige: normalized.prestige,
    unlockedUntil: normalized.unlockedUntil,
    [LOCKOUT_COOLDOWN_KEY]: normalized[LOCKOUT_COOLDOWN_KEY],
    stateUpdatedAt: normalized.stateUpdatedAt,
    [CUSTOM_DOMAINS_KEY]: normalized.customBlockedDomains,
    [CUSTOM_DOMAINS_UPDATED_AT_KEY]: normalized.customDomainsUpdatedAt
  };
}

function getStorage(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function setStorage(values) {
  return new Promise((resolve) => chrome.storage.local.set(values, resolve));
}

function supportsSyncStorage() {
  return Boolean(chrome?.storage?.sync);
}

function recordSyncSuccess(at = Date.now()) {
  const stamp = Math.floor(Number(at) || Date.now());
  syncLastAttemptAt = stamp;
  syncLastSyncedAt = stamp;
  syncLastError = null;
}

function recordSyncError(error, at = Date.now()) {
  const stamp = Math.floor(Number(at) || Date.now());
  syncLastAttemptAt = stamp;
  syncLastError = String(error || "Chrome sync write failed.");
}

function buildSyncStatusResponse() {
  return {
    ok: true,
    available: supportsSyncStorage(),
    pending: Boolean(syncWriteTimer),
    scheduledFor: syncWriteScheduledFor > 0 ? syncWriteScheduledFor : null,
    lastAttemptAt: syncLastAttemptAt > 0 ? syncLastAttemptAt : null,
    lastSyncedAt: syncLastSyncedAt > 0 ? syncLastSyncedAt : null,
    lastError: syncLastError || null,
    writeDebounceMs: SYNC_WRITE_DEBOUNCE_MS
  };
}

function getSyncStorage(keys) {
  if (!supportsSyncStorage()) return Promise.resolve({});
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (out) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        recordSyncError(err.message || "Chrome sync read failed.");
        resolve({});
        return;
      }
      resolve(out || {});
    });
  });
}

function setSyncStorage(values) {
  if (!supportsSyncStorage()) {
    recordSyncError("Chrome sync storage unavailable.");
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    chrome.storage.sync.set(values, () => {
      const err = chrome.runtime?.lastError;
      if (err) {
        recordSyncError(err.message || "Chrome sync write failed.");
        resolve(false);
        return;
      }
      recordSyncSuccess();
      resolve(true);
    });
  });
}

function enqueueStateMutation(work) {
  const run = async () => work();
  const next = stateMutationQueue.then(run, run);
  stateMutationQueue = next.catch(() => {});
  return next;
}

async function waitForPendingStateMutations() {
  await stateMutationQueue;
}

async function flushSyncStateNow() {
  if (syncWriteTimer) {
    clearTimeout(syncWriteTimer);
    syncWriteTimer = null;
  }
  syncWriteScheduledFor = 0;
  const local = await getStorage(SYNC_KEYS);
  await setSyncStorage(syncPayloadFromState(local));
}

function scheduleSyncStateWrite() {
  if (!supportsSyncStorage()) return;
  if (syncWriteTimer) return;
  syncWriteScheduledFor = Date.now() + SYNC_WRITE_DEBOUNCE_MS;
  syncWriteTimer = setTimeout(() => {
    syncWriteTimer = null;
    syncWriteScheduledFor = 0;
    void enqueueStateMutation(async () => {
      await flushSyncStateNow();
    });
  }, SYNC_WRITE_DEBOUNCE_MS);
  if (typeof syncWriteTimer?.unref === "function") {
    syncWriteTimer.unref();
  }
}

function updateRuleset(enable) {
  return chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: enable ? [RULESET_ID] : [],
    disableRulesetIds: enable ? [] : [RULESET_ID]
  });
}

async function getStoredCustomDomains() {
  const stored = await getStorage([CUSTOM_DOMAINS_KEY, CUSTOM_DOMAINS_UPDATED_AT_KEY]);
  const sanitized = sanitizeDomainList(stored[CUSTOM_DOMAINS_KEY]);
  const raw = Array.isArray(stored[CUSTOM_DOMAINS_KEY]) ? stored[CUSTOM_DOMAINS_KEY] : [];
  const changed = raw.length !== sanitized.length || raw.some((v, i) => v !== sanitized[i]);
  if (changed) {
    await setStorage({
      [CUSTOM_DOMAINS_KEY]: sanitized,
      [CUSTOM_DOMAINS_UPDATED_AT_KEY]: Math.max(0, Math.floor(Number(stored[CUSTOM_DOMAINS_UPDATED_AT_KEY]) || 0))
    });
  }
  return sanitized;
}

function buildCustomDomainRules(domains) {
  return domains.map((domain, index) => ({
    id: CUSTOM_RULE_ID_BASE + index,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: ["main_frame"]
    }
  }));
}

async function syncCustomDomainRules(locked) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const managedRuleIds = existing
    .filter((rule) => rule.id >= CUSTOM_RULE_ID_BASE && rule.id < CUSTOM_RULE_ID_BASE + CUSTOM_RULE_ID_LIMIT)
    .map((rule) => rule.id);

  const domains = await getStoredCustomDomains();
  const addRules = locked ? buildCustomDomainRules(domains) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: managedRuleIds,
    addRules
  });
  return domains;
}

async function reconcileLocalWithChromeSync() {
  if (!supportsSyncStorage()) return;

  const localRaw = await getStorage(SYNC_KEYS);
  const syncRaw = await getSyncStorage(SYNC_KEYS);
  const local = normalizeStoredState(localRaw);
  const remote = normalizeStoredState(syncRaw);

  const useRemoteState = remote.stateUpdatedAt > local.stateUpdatedAt;
  const useRemoteDomains = remote.customDomainsUpdatedAt > local.customDomainsUpdatedAt;

  const merged = {
    score: useRemoteState ? remote.score : local.score,
    xp: useRemoteState ? remote.xp : local.xp,
    prestige: useRemoteState ? remote.prestige : local.prestige,
    unlockedUntil: useRemoteState ? remote.unlockedUntil : local.unlockedUntil,
    [LOCKOUT_COOLDOWN_KEY]: useRemoteState ? remote[LOCKOUT_COOLDOWN_KEY] : local[LOCKOUT_COOLDOWN_KEY],
    stateUpdatedAt: useRemoteState ? remote.stateUpdatedAt : local.stateUpdatedAt,
    [CUSTOM_DOMAINS_KEY]: useRemoteDomains ? remote.customBlockedDomains : local.customBlockedDomains,
    [CUSTOM_DOMAINS_UPDATED_AT_KEY]: useRemoteDomains ? remote.customDomainsUpdatedAt : local.customDomainsUpdatedAt
  };

  const localPayload = syncPayloadFromState(localRaw);
  const mergedPayload = syncPayloadFromState(merged);
  const localDiffers = JSON.stringify(localPayload) !== JSON.stringify(mergedPayload);
  if (localDiffers) {
    await setStorage(mergedPayload);
  }

  const remotePayload = syncPayloadFromState(syncRaw);
  const remoteDiffers = JSON.stringify(remotePayload) !== JSON.stringify(mergedPayload);
  if (remoteDiffers) {
    await setSyncStorage(mergedPayload);
  }
}

function normalizeSyncPayload(input) {
  if (!input || typeof input !== "object") {
    return null;
  }

  const updatedAt = Math.floor(Number(input.stateUpdatedAt));
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return null;
  }

  const unlockedRaw = Math.floor(Number(input.unlockedUntil));
  const hasCooldown =
    Object.prototype.hasOwnProperty.call(input, LOCKOUT_COOLDOWN_KEY) ||
    Object.prototype.hasOwnProperty.call(input, "unlockDurationMs");
  const rawCooldown = Object.prototype.hasOwnProperty.call(input, LOCKOUT_COOLDOWN_KEY)
    ? input[LOCKOUT_COOLDOWN_KEY]
    : input.unlockDurationMs;
  return {
    score: round2(input.score),
    xp: round2(input.xp),
    prestige: Math.max(0, Math.floor(Number(input.prestige) || 0)),
    requiredScore: Math.max(0, Math.floor(Number(input.requiredScore) || REQUIRED_SCORE)),
    unlockedUntil: Number.isFinite(unlockedRaw) && unlockedRaw > 0 ? unlockedRaw : null,
    [LOCKOUT_COOLDOWN_KEY]: hasCooldown ? normalizeLockoutCooldownMs(rawCooldown) : null,
    stateUpdatedAt: updatedAt
  };
}

function buildStateResponse(values) {
  const unlockedUntil = Number(values.unlockedUntil);
  const lockoutCooldownMs = normalizeLockoutCooldownMs(values[LOCKOUT_COOLDOWN_KEY]);
  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  return {
    ok: true,
    requiredScore: REQUIRED_SCORE,
    score: round2(values.score),
    xp: round2(values.xp),
    prestige: Math.max(0, Math.floor(Number(values.prestige) || 0)),
    locked,
    unlockedUntil: locked ? null : unlockedUntil,
    unlockDurationMs: lockoutCooldownMs,
    [LOCKOUT_COOLDOWN_KEY]: lockoutCooldownMs,
    stateUpdatedAt: Math.floor(Number(values.stateUpdatedAt) || Date.now())
  };
}

async function lockNow(resetScore = false, stateUpdatedAt = Date.now()) {
  const stamp = Math.floor(Number(stateUpdatedAt) || Date.now());
  await updateRuleset(true);
  await syncCustomDomainRules(true);
  await chrome.alarms.clear(ALARM_NAME);
  await setStorage({
    unlockedUntil: null,
    ...(resetScore ? { score: 0 } : {}),
    stateUpdatedAt: stamp
  });
  scheduleSyncStateWrite();
  return stamp;
}

async function unlockNow(stateUpdatedAt = Date.now()) {
  const stamp = Math.floor(Number(stateUpdatedAt) || Date.now());
  const settings = await getStorage([LOCKOUT_COOLDOWN_KEY]);
  const lockoutCooldownMs = normalizeLockoutCooldownMs(settings[LOCKOUT_COOLDOWN_KEY]);
  const unlockedUntil = Date.now() + lockoutCooldownMs;
  await updateRuleset(false);
  await syncCustomDomainRules(false);
  await setStorage({ unlockedUntil, score: 0, stateUpdatedAt: stamp });
  await chrome.alarms.create(ALARM_NAME, { when: unlockedUntil });
  scheduleSyncStateWrite();
  return { unlockedUntil, stateUpdatedAt: stamp, lockoutCooldownMs };
}

async function syncLockState() {
  const { unlockedUntil } = await getStorage(["unlockedUntil"]);

  if (!unlockedUntil) {
    await updateRuleset(true);
    await syncCustomDomainRules(true);
    await chrome.alarms.clear(ALARM_NAME);
    return { locked: true, unlockedUntil: null };
  }

  if (unlockedUntil <= Date.now()) {
    await lockNow(false);
    return { locked: true, unlockedUntil: null };
  }

  await updateRuleset(false);
  await syncCustomDomainRules(false);
  await chrome.alarms.create(ALARM_NAME, { when: unlockedUntil });
  return { locked: false, unlockedUntil };
}

chrome.runtime.onInstalled.addListener(() => {
  void enqueueStateMutation(async () => {
    const now = Date.now();
    await setStorage({
      score: 0,
      xp: 0,
      prestige: 0,
      unlockedUntil: null,
      [LOCKOUT_COOLDOWN_KEY]: UNLOCK_DURATION_MS,
      stateUpdatedAt: now,
      [CUSTOM_DOMAINS_KEY]: [],
      [CUSTOM_DOMAINS_UPDATED_AT_KEY]: now
    });
    await setSyncStorage({
      score: 0,
      xp: 0,
      prestige: 0,
      unlockedUntil: null,
      [LOCKOUT_COOLDOWN_KEY]: UNLOCK_DURATION_MS,
      stateUpdatedAt: now,
      [CUSTOM_DOMAINS_KEY]: [],
      [CUSTOM_DOMAINS_UPDATED_AT_KEY]: now
    });
    await syncLockState();
  });
});

chrome.runtime.onStartup.addListener(() => {
  void enqueueStateMutation(async () => {
    await reconcileLocalWithChromeSync();
    await syncLockState();
  });
});

if (chrome?.runtime?.onSuspend?.addListener) {
  chrome.runtime.onSuspend.addListener(() => {
    void enqueueStateMutation(async () => {
      await flushSyncStateNow();
    });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void enqueueStateMutation(async () => {
      await lockNow();
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    sendResponse({ ok: false, error: "Invalid message." });
    return;
  }

  if (message.type === "GET_STATE") {
    void (async () => {
      await waitForPendingStateMutations();
      const state = await getStorage(["score", "xp", "prestige", "unlockedUntil", LOCKOUT_COOLDOWN_KEY, "stateUpdatedAt"]);
      sendResponse(buildStateResponse(state));
    })();
    return true;
  }

  if (message.type === "ADD_SCORE") {
    void enqueueStateMutation(async () => {
      const points = Number(message.points);
      if (!Number.isFinite(points) || points === 0) {
        sendResponse({ ok: false, error: "Invalid score increment." });
        return;
      }

      const normalized = Math.round(points * 100) / 100;
      const { score = 0, xp = 0, prestige = 0 } = await getStorage(["score", "xp", "prestige"]);
      const nextScore = round2(score + normalized);
      const xpMultiplier = 1 + Math.max(0, Number(prestige) || 0) * PRESTIGE_XP_BONUS_STEP;
      const xpGain = normalized > 0 ? normalized * xpMultiplier : 0;
      const nextXp = xpGain > 0 ? round2(xp + xpGain) : xp;
      const stateUpdatedAt = Date.now();
      await setStorage({ score: nextScore, xp: nextXp, stateUpdatedAt });
      scheduleSyncStateWrite();
      sendResponse({
        ok: true,
        score: nextScore,
        xp: nextXp,
        prestige,
        xpMultiplier,
        requiredScore: REQUIRED_SCORE,
        stateUpdatedAt
      });
    });
    return true;
  }

  if (message.type === "PRESTIGE") {
    void enqueueStateMutation(async () => {
      const { xp = 0, prestige = 0 } = await getStorage(["xp", "prestige"]);
      if (!canPrestigeNow(xp)) {
        sendResponse({ ok: false, error: `Reach level ${LEVELS_PER_PRESTIGE} to prestige.` });
        return;
      }

      const nextPrestige = Math.max(0, Number(prestige) || 0) + 1;
      const stateUpdatedAt = Date.now();
      await setStorage({ prestige: nextPrestige, xp: 0, score: 0, stateUpdatedAt });
      scheduleSyncStateWrite();
      sendResponse({
        ok: true,
        prestige: nextPrestige,
        xp: 0,
        score: 0,
        xpMultiplier: 1 + nextPrestige * PRESTIGE_XP_BONUS_STEP,
        stateUpdatedAt
      });
    });
    return true;
  }

  if (message.type === "REQUEST_UNLOCK") {
    void enqueueStateMutation(async () => {
      const { score = 0 } = await getStorage(["score"]);
      if (score < REQUIRED_SCORE) {
        const missing = Math.round((REQUIRED_SCORE - score) * 100) / 100;
        sendResponse({ ok: false, error: `Need ${missing} more points.` });
        return;
      }

      const result = await unlockNow(Date.now());
      sendResponse({
        ok: true,
        unlockedUntil: result.unlockedUntil,
        unlockDurationMs: result.lockoutCooldownMs,
        [LOCKOUT_COOLDOWN_KEY]: result.lockoutCooldownMs,
        stateUpdatedAt: result.stateUpdatedAt
      });
    });
    return true;
  }

  if (message.type === "RELOCK") {
    void enqueueStateMutation(async () => {
      const stateUpdatedAt = await lockNow(true, Date.now());
      sendResponse({ ok: true, stateUpdatedAt });
    });
    return true;
  }

  if (message.type === "APPLY_SYNC_STATE") {
    void enqueueStateMutation(async () => {
      const incoming = normalizeSyncPayload(message.state);
      if (!incoming) {
        sendResponse({ ok: false, error: "Invalid sync payload." });
        return;
      }

      const { stateUpdatedAt: localStamp = 0 } = await getStorage(["stateUpdatedAt"]);
      const localUpdatedAt = Math.floor(Number(localStamp) || 0);
      if (!message.force && incoming.stateUpdatedAt <= localUpdatedAt) {
        const current = await getStorage(["score", "xp", "prestige", "unlockedUntil", LOCKOUT_COOLDOWN_KEY, "stateUpdatedAt"]);
        sendResponse({ ok: true, applied: false, ...buildStateResponse(current) });
        return;
      }

      const current = await getStorage([LOCKOUT_COOLDOWN_KEY]);
      const lockoutCooldownMs =
        incoming[LOCKOUT_COOLDOWN_KEY] == null
          ? normalizeLockoutCooldownMs(current[LOCKOUT_COOLDOWN_KEY])
          : incoming[LOCKOUT_COOLDOWN_KEY];
      await setStorage({
        score: incoming.score,
        xp: incoming.xp,
        prestige: incoming.prestige,
        unlockedUntil: incoming.unlockedUntil,
        [LOCKOUT_COOLDOWN_KEY]: lockoutCooldownMs,
        stateUpdatedAt: incoming.stateUpdatedAt
      });

      if (!incoming.unlockedUntil || incoming.unlockedUntil <= Date.now()) {
        await updateRuleset(true);
        await syncCustomDomainRules(true);
        await chrome.alarms.clear(ALARM_NAME);
        await setStorage({ unlockedUntil: null });
      } else {
        await updateRuleset(false);
        await syncCustomDomainRules(false);
        await chrome.alarms.create(ALARM_NAME, { when: incoming.unlockedUntil });
      }

      const latest = await getStorage(["score", "xp", "prestige", "unlockedUntil", LOCKOUT_COOLDOWN_KEY, "stateUpdatedAt"]);
      scheduleSyncStateWrite();
      sendResponse({ ok: true, applied: true, ...buildStateResponse(latest) });
    });
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    void (async () => {
      await waitForPendingStateMutations();
      const stored = await getStorage([LOCKOUT_COOLDOWN_KEY]);
      const lockoutCooldownMs = normalizeLockoutCooldownMs(stored[LOCKOUT_COOLDOWN_KEY]);
      sendResponse({
        ok: true,
        [LOCKOUT_COOLDOWN_KEY]: lockoutCooldownMs,
        minLockoutCooldownMs: MIN_LOCKOUT_COOLDOWN_MS,
        maxLockoutCooldownMs: MAX_LOCKOUT_COOLDOWN_MS
      });
    })();
    return true;
  }

  if (message.type === "GET_SYNC_STATUS") {
    sendResponse(buildSyncStatusResponse());
    return;
  }

  if (message.type === "SET_LOCKOUT_COOLDOWN") {
    void enqueueStateMutation(async () => {
      const rawMinutes = Number(message.minutes);
      if (!Number.isFinite(rawMinutes)) {
        sendResponse({ ok: false, error: "Enter a valid cooldown in minutes." });
        return;
      }
      const requestedMs = Math.floor(rawMinutes * 60 * 1000);
      if (requestedMs < MIN_LOCKOUT_COOLDOWN_MS || requestedMs > MAX_LOCKOUT_COOLDOWN_MS) {
        const minMinutes = MIN_LOCKOUT_COOLDOWN_MS / (60 * 1000);
        const maxMinutes = MAX_LOCKOUT_COOLDOWN_MS / (60 * 1000);
        sendResponse({ ok: false, error: `Cooldown must be between ${minMinutes} and ${maxMinutes} minutes.` });
        return;
      }
      const lockoutCooldownMs = normalizeLockoutCooldownMs(requestedMs);
      const stateUpdatedAt = Date.now();
      await setStorage({
        [LOCKOUT_COOLDOWN_KEY]: lockoutCooldownMs,
        stateUpdatedAt
      });
      scheduleSyncStateWrite();
      sendResponse({
        ok: true,
        [LOCKOUT_COOLDOWN_KEY]: lockoutCooldownMs,
        unlockDurationMs: lockoutCooldownMs,
        minutes: Math.floor(lockoutCooldownMs / (60 * 1000)),
        stateUpdatedAt
      });
    });
    return true;
  }

  if (message.type === "GET_CUSTOM_DOMAINS") {
    void (async () => {
      await waitForPendingStateMutations();
      const domains = await getStoredCustomDomains();
      sendResponse({ ok: true, domains });
    })();
    return true;
  }

  if (message.type === "ADD_CUSTOM_DOMAIN") {
    void enqueueStateMutation(async () => {
      const domain = normalizeDomainInput(message.domain);
      if (!domain) {
        sendResponse({ ok: false, error: "Enter a valid domain (example.com)." });
        return;
      }

      const domains = await getStoredCustomDomains();
      if (domains.includes(domain)) {
        sendResponse({ ok: true, domains, added: false, domain });
        return;
      }
      if (domains.length >= MAX_CUSTOM_DOMAINS) {
        sendResponse({ ok: false, error: `Limit reached (${MAX_CUSTOM_DOMAINS} domains).` });
        return;
      }

      const next = [...domains, domain];
      const customDomainsUpdatedAt = Date.now();
      await setStorage({
        [CUSTOM_DOMAINS_KEY]: next,
        [CUSTOM_DOMAINS_UPDATED_AT_KEY]: customDomainsUpdatedAt
      });
      const { unlockedUntil } = await getStorage(["unlockedUntil"]);
      const locked = !unlockedUntil || unlockedUntil <= Date.now();
      await syncCustomDomainRules(locked);
      scheduleSyncStateWrite();
      sendResponse({ ok: true, domains: next, added: true, domain });
    });
    return true;
  }

  if (message.type === "REMOVE_CUSTOM_DOMAIN") {
    void enqueueStateMutation(async () => {
      const domain = normalizeDomainInput(message.domain);
      if (!domain) {
        sendResponse({ ok: false, error: "Invalid domain." });
        return;
      }

      const domains = await getStoredCustomDomains();
      const next = domains.filter((d) => d !== domain);
      if (next.length === domains.length) {
        sendResponse({ ok: true, domains, removed: false, domain });
        return;
      }

      const customDomainsUpdatedAt = Date.now();
      await setStorage({
        [CUSTOM_DOMAINS_KEY]: next,
        [CUSTOM_DOMAINS_UPDATED_AT_KEY]: customDomainsUpdatedAt
      });
      const { unlockedUntil } = await getStorage(["unlockedUntil"]);
      const locked = !unlockedUntil || unlockedUntil <= Date.now();
      await syncCustomDomainRules(locked);
      scheduleSyncStateWrite();
      sendResponse({ ok: true, domains: next, removed: true, domain });
    });
    return true;
  }

  sendResponse({ ok: false, error: "Unknown message type." });
});
