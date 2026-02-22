const RB_ROOT = globalThis.RB || (globalThis.RB = {});
const RB_CONSTANTS = RB_ROOT.constants || {};
const RB_DOM_REFS = RB_ROOT.dom?.refs || {};
const RB_MATH = RB_ROOT.math || {};
const RB_SYNC = RB_ROOT.sync || {};
const RB_TUTOR = RB_ROOT.tutor || {};

const {
  statusEl,
  timerEl,
  livePointsEl,
  globalTimerEl,
  rerollBtnEl,
  xpSummaryEl,
  xpFillEl,
  xpNextEl,
  prestigeSummaryEl,
  prestigeBtnEl,
  xpPanelEl,
  xpCloseEl,
  xpReopenEl,
  xpAvatarEl,
  syncBoxEl,
  syncStatusEl,
  syncUserEl,
  syncLastEl,
  syncErrorEl,
  syncSignInEl,
  syncSignOutEl,
  syncNowEl,
  domainSettingsToggleEl,
  domainSettingsModalEl,
  domainSettingsBackdropEl,
  domainSettingsPanelEl,
  domainSettingsFormEl,
  domainSettingsInputEl,
  domainSettingsFeedbackEl,
  domainSettingsListEl,
  domainSettingsCloseEl,
  lockoutSettingsFormEl,
  lockoutCooldownInputEl,
  lockoutSettingsFeedbackEl,
  feedbackEl,
  problemEl,
  diagramWrapEl,
  diagramImgEl,
  formEl,
  answerEl,
  choicesEl,
  metaEl,
  unlockBtn,
  relockBtn,
  quizEl,
  themeToggleEl,
  tutorPanelEl,
  aiCloseEl,
  aiReopenEl,
  aiProviderEl,
  aiModelEl,
  aiTokenEl,
  aiSaveEl,
  aiRefreshModelsEl,
  aiSystemEl,
  aiChatEl,
  aiFormEl,
  aiInputEl,
  aiSubmitEl,
  poolChipEls = []
} = RB_DOM_REFS;

const {
  DECAY_DURATION_BY_CONTEST_MS = {
    amc8: 6 * 60 * 1000,
    amc10: 8 * 60 * 1000,
    amc12: 10 * 60 * 1000,
    aime: Infinity,
    upper_level_mcq: 8 * 60 * 1000,
    calculus: 8 * 60 * 1000
  },
  BASE_WEIGHT_BY_CONTEST = {
    amc8: 5,
    amc10: 8,
    amc12: 12,
    aime: 30,
    upper_level_mcq: 5,
    calculus: 5
  },
  POOL_FILE_BY_KEY = {
    amc8: "amc8",
    amc10: "amc10",
    amc12: "amc12",
    aime: "aime",
    gre: "upper_level_mcq",
    calculus: "calculus_mcq_synthetic"
  },
  POOL_WEIGHTS: poolWeights = {
    amc8: 35,
    amc10: 20,
    amc12: 15,
    aime: 10,
    gre: 10,
    calculus: 10
  },
  GUESS_MULTIPLIERS = [1, 0.1, 0.02, 0, 0],
  WRONG_GUESS_PENALTIES = { 2: 1.0, 3: 3.0, 4: 6.0 },
  RECENT_PROBLEM_LIMIT = 30,
  UI_TICK_INTERVAL_MS = 1000,
  SYNC_DIAGNOSTICS_FAST_MS = 5000,
  SYNC_DIAGNOSTICS_SLOW_MS = 30000
} = RB_CONSTANTS;

/** @typedef {{ id?: string | number, label?: string, contest?: string, type?: "input" | "mcq", prompt?: string, choices?: string[], answer?: number, answerIndex?: number, acceptableAnswers?: Array<string | number>, weight?: number, diagramPng?: string, diagramSvg?: string, diagramPngs?: string[], diagramSvgs?: string[], __sanitizedPrompt?: string, __sanitizedChoices?: string[], __normalizedChoices?: string[] }} Problem */
/** @typedef {{ provider: string, model: string, token: string }} AiConfig */
/** @typedef {{ available: boolean, pending: boolean, lastError?: string }} SyncStatus */
/** @typedef {{ requiredScore?: number, score?: number, xp?: number, prestige?: number, unlockedUntil?: number | null, lockoutCooldownMs?: number, unlockDurationMs?: number, stateUpdatedAt?: number }} AppState */

const mathApi = RB_MATH;
const syncApi = RB_SYNC;
const tutorApi = RB_TUTOR;
function fallbackRound2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function fallbackGuessMultiplier(guessNumber, multipliers) {
  const list = Array.isArray(multipliers) && multipliers.length > 0
    ? multipliers
    : [1, 0.25, 0.125, 0.0625, 0.03125];
  if (!Number.isFinite(guessNumber) || guessNumber < 1) return 0;
  return Number(list[guessNumber - 1] || 0);
}

function fallbackDecayMultiplier(elapsedMs, durationMs) {
  if (durationMs === Infinity) return 1;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const elapsed = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  return Math.max(0, 1 - elapsed / durationMs);
}

function fallbackDecayedBasePoints(baseWeight, elapsedMs, durationMs) {
  if (!Number.isFinite(baseWeight) || baseWeight <= 0) return 0;
  return fallbackRound2(baseWeight * fallbackDecayMultiplier(elapsedMs, durationMs));
}

function fallbackPointsIfCorrectNow(args = {}) {
  const {
    baseWeight,
    elapsedMs,
    durationMs,
    isMcq,
    wrongGuesses,
    multipliers
  } = args;
  const base = fallbackDecayedBasePoints(baseWeight, elapsedMs, durationMs);
  if (!isMcq) return base;
  const guessNumber = (Number.isFinite(wrongGuesses) ? wrongGuesses : 0) + 1;
  return fallbackRound2(base * fallbackGuessMultiplier(guessNumber, multipliers));
}

function resolveScoringApi() {
  if (typeof RotBlockerScoring !== "undefined" && RotBlockerScoring) {
    return RotBlockerScoring;
  }
  if (typeof SiteBlockerScoring !== "undefined" && SiteBlockerScoring) {
    return SiteBlockerScoring;
  }
  return {
    guessMultiplier: fallbackGuessMultiplier,
    decayedBasePoints: fallbackDecayedBasePoints,
    pointsIfCorrectNow: fallbackPointsIfCorrectNow,
    round2: fallbackRound2
  };
}

const scoringApi = resolveScoringApi();

/** @param {string} input */
function normalizeLocalDomainInput(input) {
  let domain = String(input || "").trim().toLowerCase();
  if (!domain) return null;
  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  domain = domain.replace(/^\/+/, "");
  domain = domain.split(/[/?#]/)[0];
  domain = domain.replace(/:\d+$/, "");
  domain = domain.replace(/^\*\./, "");
  domain = domain.replace(/\.$/, "");
  if (domain.startsWith("www.")) domain = domain.slice(4);
  if (!domain) return null;
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  if (domain.includes("..")) return null;
  if (domain === "localhost") return domain;
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

let requiredScore = 30;
let score = 0;
let unlockedUntil = null;
let xp = 0;
let prestige = 0;
let stateUpdatedAt = 0;
let unlockDurationMs = 2 * 60 * 60 * 1000;
let minLockoutCooldownMs = 5 * 60 * 1000;
let maxLockoutCooldownMs = 24 * 60 * 60 * 1000;
let currentProblem = null;
let problemStartMs = 0;
let mcqWrongGuesses = 0;
let usedChoices = new Set();
let rerollLockedUntil = 0;

let aiHistory = [];
let aiBusy = false;
let aiLoadingMessageEl = null;
let aiAbortController = null;
let tutorUiInitialized = false;
let syncClient = null;
let syncBusy = false;
let syncDiagnosticsIntervalId = null;
let syncDiagnosticsIntervalMs = 5000;
let syncDebounceTimer = null;
let uiTickIntervalId = null;
let cloudSyncInitialized = false;

const banks = {
  amc8: [],
  amc10: [],
  amc12: [],
  aime: [],
  gre: [],
  calculus: []
};
const poolEnabled = {
  amc8: true,
  amc10: true,
  amc12: true,
  aime: true,
  gre: false,
  calculus: false
};
const poolAvailable = {
  amc8: true,
  amc10: true,
  amc12: true,
  aime: true,
  gre: true,
  calculus: true
};
const poolLoaded = {
  amc8: false,
  amc10: false,
  amc12: false,
  aime: false,
  gre: false,
  calculus: false
};
let lastLockState = null;
const recentProblemIds = [];
let mathTypesetQueue = Promise.resolve();
let mathPendingRetryTimer = null;

function isDocumentVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState !== "hidden";
}

function isPerfLoggingEnabled() {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("rb_perf") === "1";
  } catch (_err) {
    return false;
  }
}

function perfMark(name) {
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  try {
    performance.mark(name);
  } catch (_err) {
    // Ignore unsupported performance APIs.
  }
}

function perfMeasure(name, startMark, endMark = undefined) {
  if (typeof performance === "undefined" || typeof performance.measure !== "function") return;
  try {
    if (endMark) {
      performance.measure(name, startMark, endMark);
    } else {
      performance.measure(name, startMark);
    }
    if (isPerfLoggingEnabled()) {
      const entries = performance.getEntriesByName(name, "measure");
      const latest = entries[entries.length - 1];
      if (latest && Number.isFinite(latest.duration)) {
        console.debug(`[perf] ${name}: ${latest.duration.toFixed(2)}ms`);
      }
    }
  } catch (_err) {
    // Ignore invalid mark names / unsupported APIs.
  }
}

const chromeApi = (() => {
  if (typeof chrome !== "undefined" && chrome?.runtime?.sendMessage && chrome?.storage?.local) {
    return chrome;
  }

  const mem = {
    score: 0,
    unlockedUntil: null,
    ai_config: null,
    xp: 0,
    prestige: 0,
    stateUpdatedAt: Date.now(),
    lockoutCooldownMs: 2 * 60 * 60 * 1000,
    customBlockedDomains: []
  };
  const REQUIRED_SCORE = 30;
  const UNLOCK_DURATION_MS = 2 * 60 * 60 * 1000;
  const MIN_LOCKOUT_COOLDOWN_MS = 5 * 60 * 1000;
  const MAX_LOCKOUT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  const PRESTIGE_XP_BONUS_STEP = 0.05;
  function normalizeLocalLockoutCooldownMs(value, fallback = UNLOCK_DURATION_MS) {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.max(MIN_LOCKOUT_COOLDOWN_MS, Math.min(MAX_LOCKOUT_COOLDOWN_MS, parsed));
  }

  return {
    runtime: {
      sendMessage(message, callback) {
        if (!message || typeof message !== "object") {
          callback({ ok: false, error: "Invalid message." });
          return;
        }
        if (message.type === "GET_STATE") {
          const locked = !mem.unlockedUntil || mem.unlockedUntil <= Date.now();
          callback({
            ok: true,
            requiredScore: REQUIRED_SCORE,
            score: mem.score,
            xp: mem.xp,
            prestige: mem.prestige,
            locked,
            unlockedUntil: locked ? null : mem.unlockedUntil,
            unlockDurationMs: normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs),
            lockoutCooldownMs: normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs),
            stateUpdatedAt: mem.stateUpdatedAt
          });
          return;
        }
        if (message.type === "ADD_SCORE") {
          const points = Number(message.points);
          if (!Number.isFinite(points) || points === 0) {
            callback({ ok: false, error: "Invalid score increment." });
            return;
          }
          mem.score = Math.round((mem.score + points) * 100) / 100;
          if (points > 0) {
            const xpMultiplier = 1 + mem.prestige * PRESTIGE_XP_BONUS_STEP;
            mem.xp = Math.round((mem.xp + points * xpMultiplier) * 100) / 100;
          }
          mem.stateUpdatedAt = Date.now();
          callback({
            ok: true,
            score: mem.score,
            xp: mem.xp,
            prestige: mem.prestige,
            xpMultiplier: 1 + mem.prestige * PRESTIGE_XP_BONUS_STEP,
            requiredScore: REQUIRED_SCORE,
            stateUpdatedAt: mem.stateUpdatedAt
          });
          return;
        }
        if (message.type === "PRESTIGE") {
          const level = Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(mem.xp) || 0) / 25)) + 1);
          if (level < 10) {
            callback({ ok: false, error: "Reach level 10 to prestige." });
            return;
          }
          mem.prestige += 1;
          mem.xp = 0;
          mem.score = 0;
          mem.stateUpdatedAt = Date.now();
          callback({
            ok: true,
            prestige: mem.prestige,
            xp: 0,
            score: 0,
            xpMultiplier: 1 + mem.prestige * PRESTIGE_XP_BONUS_STEP,
            stateUpdatedAt: mem.stateUpdatedAt
          });
          return;
        }
        if (message.type === "REQUEST_UNLOCK") {
          if (mem.score < REQUIRED_SCORE) {
            callback({ ok: false, error: `Need ${Math.round((REQUIRED_SCORE - mem.score) * 100) / 100} more points.` });
            return;
          }
          mem.lockoutCooldownMs = normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs);
          mem.unlockedUntil = Date.now() + mem.lockoutCooldownMs;
          mem.score = 0;
          mem.stateUpdatedAt = Date.now();
          callback({
            ok: true,
            unlockedUntil: mem.unlockedUntil,
            unlockDurationMs: mem.lockoutCooldownMs,
            lockoutCooldownMs: mem.lockoutCooldownMs,
            stateUpdatedAt: mem.stateUpdatedAt
          });
          return;
        }
        if (message.type === "RELOCK") {
          mem.unlockedUntil = null;
          mem.score = 0;
          mem.stateUpdatedAt = Date.now();
          callback({ ok: true, stateUpdatedAt: mem.stateUpdatedAt });
          return;
        }
        if (message.type === "GET_CUSTOM_DOMAINS") {
          callback({ ok: true, domains: [...mem.customBlockedDomains] });
          return;
        }
        if (message.type === "ADD_CUSTOM_DOMAIN") {
          const domain = normalizeLocalDomainInput(message.domain);
          if (!domain) {
            callback({ ok: false, error: "Enter a valid domain (example.com)." });
            return;
          }
          if (mem.customBlockedDomains.includes(domain)) {
            callback({ ok: true, domains: [...mem.customBlockedDomains], added: false, domain });
            return;
          }
          mem.customBlockedDomains = [...mem.customBlockedDomains, domain];
          callback({ ok: true, domains: [...mem.customBlockedDomains], added: true, domain });
          return;
        }
        if (message.type === "REMOVE_CUSTOM_DOMAIN") {
          const domain = normalizeLocalDomainInput(message.domain);
          if (!domain) {
            callback({ ok: false, error: "Invalid domain." });
            return;
          }
          const next = mem.customBlockedDomains.filter((d) => d !== domain);
          const removed = next.length !== mem.customBlockedDomains.length;
          mem.customBlockedDomains = next;
          callback({ ok: true, domains: [...mem.customBlockedDomains], removed, domain });
          return;
        }
        if (message.type === "APPLY_SYNC_STATE") {
          const incoming = message.state && typeof message.state === "object" ? message.state : null;
          const incomingUpdatedAt = Math.floor(Number(incoming?.stateUpdatedAt));
          if (!incoming || !Number.isFinite(incomingUpdatedAt) || incomingUpdatedAt <= 0) {
            callback({ ok: false, error: "Invalid sync payload." });
            return;
          }
          if (!message.force && incomingUpdatedAt <= mem.stateUpdatedAt) {
            const locked = !mem.unlockedUntil || mem.unlockedUntil <= Date.now();
            callback({
              ok: true,
              applied: false,
              requiredScore: REQUIRED_SCORE,
              score: mem.score,
              xp: mem.xp,
              prestige: mem.prestige,
              locked,
              unlockedUntil: locked ? null : mem.unlockedUntil,
              unlockDurationMs: normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs),
              lockoutCooldownMs: normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs),
              stateUpdatedAt: mem.stateUpdatedAt
            });
            return;
          }

          mem.score = Math.round(Number(incoming.score || 0) * 100) / 100;
          mem.xp = Math.round(Number(incoming.xp || 0) * 100) / 100;
          mem.prestige = Math.max(0, Math.floor(Number(incoming.prestige) || 0));
          if (Object.prototype.hasOwnProperty.call(incoming, "lockoutCooldownMs") || Object.prototype.hasOwnProperty.call(incoming, "unlockDurationMs")) {
            const rawCooldown = Object.prototype.hasOwnProperty.call(incoming, "lockoutCooldownMs")
              ? incoming.lockoutCooldownMs
              : incoming.unlockDurationMs;
            mem.lockoutCooldownMs = normalizeLocalLockoutCooldownMs(rawCooldown);
          }
          const incomingUnlock = Math.floor(Number(incoming.unlockedUntil));
          mem.unlockedUntil = Number.isFinite(incomingUnlock) && incomingUnlock > Date.now() ? incomingUnlock : null;
          mem.stateUpdatedAt = incomingUpdatedAt;
          const locked = !mem.unlockedUntil || mem.unlockedUntil <= Date.now();
          callback({
            ok: true,
            applied: true,
            requiredScore: REQUIRED_SCORE,
            score: mem.score,
            xp: mem.xp,
            prestige: mem.prestige,
            locked,
            unlockedUntil: locked ? null : mem.unlockedUntil,
            unlockDurationMs: normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs),
            lockoutCooldownMs: normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs),
            stateUpdatedAt: mem.stateUpdatedAt
          });
          return;
        }
        if (message.type === "GET_SETTINGS") {
          const lockoutCooldownMs = normalizeLocalLockoutCooldownMs(mem.lockoutCooldownMs);
          callback({
            ok: true,
            lockoutCooldownMs,
            minLockoutCooldownMs: MIN_LOCKOUT_COOLDOWN_MS,
            maxLockoutCooldownMs: MAX_LOCKOUT_COOLDOWN_MS
          });
          return;
        }
        if (message.type === "SET_LOCKOUT_COOLDOWN") {
          const rawMinutes = Number(message.minutes);
          if (!Number.isFinite(rawMinutes)) {
            callback({ ok: false, error: "Enter a valid cooldown in minutes." });
            return;
          }
          const requestedMs = Math.floor(rawMinutes * 60 * 1000);
          if (requestedMs < MIN_LOCKOUT_COOLDOWN_MS || requestedMs > MAX_LOCKOUT_COOLDOWN_MS) {
            const minMinutes = MIN_LOCKOUT_COOLDOWN_MS / (60 * 1000);
            const maxMinutes = MAX_LOCKOUT_COOLDOWN_MS / (60 * 1000);
            callback({ ok: false, error: `Cooldown must be between ${minMinutes} and ${maxMinutes} minutes.` });
            return;
          }
          mem.lockoutCooldownMs = normalizeLocalLockoutCooldownMs(requestedMs);
          mem.stateUpdatedAt = Date.now();
          callback({
            ok: true,
            lockoutCooldownMs: mem.lockoutCooldownMs,
            unlockDurationMs: mem.lockoutCooldownMs,
            minutes: Math.floor(mem.lockoutCooldownMs / (60 * 1000)),
            stateUpdatedAt: mem.stateUpdatedAt
          });
          return;
        }
        if (message.type === "GET_SYNC_STATUS") {
          callback({
            ok: true,
            available: false,
            pending: false,
            scheduledFor: null,
            lastAttemptAt: null,
            lastSyncedAt: null,
            lastError: "Chrome sync unavailable in preview mode.",
            writeDebounceMs: 10_000
          });
          return;
        }
        callback({ ok: false, error: "Unknown message type." });
      },
      getURL(path) {
        return path;
      }
    },
    storage: {
      local: {
        get(keys, cb) {
          if (Array.isArray(keys)) {
            const out = {};
            keys.forEach((k) => {
              out[k] = mem[k];
            });
            cb(out);
            return;
          }
          cb(mem);
        },
        set(values, cb) {
          Object.assign(mem, values || {});
          cb?.();
        },
        remove(keys, cb) {
          const list = Array.isArray(keys) ? keys : [keys];
          list.forEach((key) => {
            delete mem[key];
          });
          cb?.();
        }
      }
    }
  };
})();

function sendMessage(payload) {
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage(payload, resolve);
  });
}

function getLocal(keys) {
  return new Promise((resolve) => chromeApi.storage.local.get(keys, resolve));
}

function setLocal(values) {
  return new Promise((resolve) => chromeApi.storage.local.set(values, resolve));
}

function supportsProfileSyncStorage() {
  return Boolean(
    chromeApi?.storage?.sync &&
    typeof chromeApi.storage.sync.get === "function" &&
    typeof chromeApi.storage.sync.set === "function"
  );
}

function getSync(keys) {
  if (!supportsProfileSyncStorage()) return Promise.resolve({});
  return new Promise((resolve) => {
    chromeApi.storage.sync.get(keys, (out) => {
      const err = chromeApi.runtime?.lastError;
      if (err) {
        resolve({});
        return;
      }
      resolve(out || {});
    });
  });
}

function setSync(values) {
  if (!supportsProfileSyncStorage()) return Promise.resolve(false);
  return new Promise((resolve) => {
    chromeApi.storage.sync.set(values, () => {
      const err = chromeApi.runtime?.lastError;
      resolve(!err);
    });
  });
}

function removeLocal(keys) {
  return new Promise((resolve) => chromeApi.storage.local.remove(keys, resolve));
}

function setDomainSettingsVisible(visible) {
  if (!domainSettingsModalEl) return;
  domainSettingsModalEl.hidden = !visible;
  document.body.classList.toggle("modal-open", visible);
  if (domainSettingsToggleEl) {
    domainSettingsToggleEl.setAttribute("aria-expanded", visible ? "true" : "false");
  }
}

function setDomainSettingsFeedback(text, ok = null) {
  if (!domainSettingsFeedbackEl) return;
  domainSettingsFeedbackEl.textContent = text || "";
  domainSettingsFeedbackEl.className = "domain-settings-feedback";
  if (ok === true) domainSettingsFeedbackEl.classList.add("ok");
  if (ok === false) domainSettingsFeedbackEl.classList.add("bad");
}

function setLockoutSettingsFeedback(text, ok = null) {
  if (!lockoutSettingsFeedbackEl) return;
  lockoutSettingsFeedbackEl.textContent = text || "";
  lockoutSettingsFeedbackEl.className = "domain-settings-feedback";
  if (ok === true) lockoutSettingsFeedbackEl.classList.add("ok");
  if (ok === false) lockoutSettingsFeedbackEl.classList.add("bad");
}

function lockoutMinutesFromMs(ms) {
  return Math.max(1, Math.floor(Number(ms || 0) / (60 * 1000)));
}

function renderDomainSettingsList(domains) {
  if (!domainSettingsListEl) return;
  domainSettingsListEl.innerHTML = "";
  if (!Array.isArray(domains) || domains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "domain-settings-empty";
    empty.textContent = "No custom domains added.";
    domainSettingsListEl.appendChild(empty);
    return;
  }

  domains.forEach((domain) => {
    const item = document.createElement("li");
    item.className = "domain-settings-item";

    const name = document.createElement("span");
    name.className = "domain-settings-name";
    name.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "domain-settings-remove";
    removeBtn.dataset.domain = domain;
    removeBtn.textContent = "Remove";

    item.appendChild(name);
    item.appendChild(removeBtn);
    domainSettingsListEl.appendChild(item);
  });
}

async function refreshDomainSettingsList() {
  const res = await sendMessage({ type: "GET_CUSTOM_DOMAINS" });
  if (!res || !res.ok) {
    const err = String(res?.error || "");
    if (/unknown message type/i.test(err)) {
      setDomainSettingsFeedback("Reload extension to enable custom domain settings.", false);
    } else {
      setDomainSettingsFeedback("Could not load custom domain settings.", false);
    }
    return;
  }
  renderDomainSettingsList(res.domains || []);
}

async function refreshLockoutSettings() {
  const res = await sendMessage({ type: "GET_SETTINGS" });
  if (!res || !res.ok) {
    setLockoutSettingsFeedback("Could not load settings.", false);
    return;
  }
  const nextDuration = Number(res.lockoutCooldownMs);
  if (Number.isFinite(nextDuration) && nextDuration > 0) {
    unlockDurationMs = nextDuration;
  }
  const minMs = Number(res.minLockoutCooldownMs);
  const maxMs = Number(res.maxLockoutCooldownMs);
  if (Number.isFinite(minMs) && minMs > 0) minLockoutCooldownMs = minMs;
  if (Number.isFinite(maxMs) && maxMs > minLockoutCooldownMs) maxLockoutCooldownMs = maxMs;
  if (lockoutCooldownInputEl) {
    const minutes = lockoutMinutesFromMs(unlockDurationMs);
    lockoutCooldownInputEl.value = String(minutes);
    lockoutCooldownInputEl.min = String(lockoutMinutesFromMs(minLockoutCooldownMs));
    lockoutCooldownInputEl.max = String(lockoutMinutesFromMs(maxLockoutCooldownMs));
  }
  setLockoutSettingsFeedback("");
}

function initDomainSettingsUi() {
  if (!domainSettingsToggleEl || !domainSettingsModalEl || !domainSettingsPanelEl) return;
  setDomainSettingsVisible(false);

  domainSettingsToggleEl.addEventListener("click", () => {
    const nextVisible = Boolean(domainSettingsModalEl.hidden);
    setDomainSettingsVisible(nextVisible);
    if (nextVisible) {
      void refreshDomainSettingsList();
      void refreshLockoutSettings();
      if (lockoutCooldownInputEl) {
        lockoutCooldownInputEl.focus();
      } else if (domainSettingsInputEl) {
        domainSettingsInputEl.focus();
      }
    }
  });

  if (domainSettingsCloseEl) {
    domainSettingsCloseEl.addEventListener("click", () => {
      setDomainSettingsVisible(false);
    });
  }

  if (domainSettingsBackdropEl) {
    domainSettingsBackdropEl.addEventListener("click", () => {
      setDomainSettingsVisible(false);
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (domainSettingsModalEl.hidden) return;
    setDomainSettingsVisible(false);
  });

  if (domainSettingsFormEl) {
    domainSettingsFormEl.addEventListener("submit", (event) => {
      event.preventDefault();
      const domain = String(domainSettingsInputEl?.value || "").trim();
      if (!domain) {
        setDomainSettingsFeedback("Enter a domain to add.", false);
        return;
      }
      void (async () => {
        const res = await sendMessage({ type: "ADD_CUSTOM_DOMAIN", domain });
        if (!res || !res.ok) {
          setDomainSettingsFeedback(res?.error || "Could not add domain.", false);
          return;
        }
        if (domainSettingsInputEl) domainSettingsInputEl.value = "";
        renderDomainSettingsList(res.domains || []);
        setDomainSettingsFeedback(
          res.added ? `Added ${res.domain}` : `${res.domain} is already in the list.`,
          true
        );
      })();
    });
  }

  if (lockoutSettingsFormEl) {
    lockoutSettingsFormEl.addEventListener("submit", (event) => {
      event.preventDefault();
      const rawMinutes = String(lockoutCooldownInputEl?.value || "").trim();
      const minutes = Number(rawMinutes);
      if (!Number.isFinite(minutes)) {
        setLockoutSettingsFeedback("Enter cooldown minutes.", false);
        return;
      }
      void (async () => {
        const res = await sendMessage({ type: "SET_LOCKOUT_COOLDOWN", minutes });
        if (!res || !res.ok) {
          setLockoutSettingsFeedback(res?.error || "Could not save cooldown.", false);
          return;
        }
        const nextDuration = Number(res.lockoutCooldownMs || res.unlockDurationMs);
        if (Number.isFinite(nextDuration) && nextDuration > 0) {
          unlockDurationMs = nextDuration;
        }
        if (lockoutCooldownInputEl) {
          lockoutCooldownInputEl.value = String(lockoutMinutesFromMs(unlockDurationMs));
        }
        render();
        setLockoutSettingsFeedback(`Saved cooldown: ${lockoutMinutesFromMs(unlockDurationMs)} minutes.`, true);
      })();
    });
  }

  if (domainSettingsListEl) {
    domainSettingsListEl.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const button = target.closest(".domain-settings-remove");
      if (!(button instanceof HTMLElement)) return;
      const domain = button.dataset.domain;
      if (!domain) return;
      void (async () => {
        const res = await sendMessage({ type: "REMOVE_CUSTOM_DOMAIN", domain });
        if (!res || !res.ok) {
          setDomainSettingsFeedback(res?.error || "Could not remove domain.", false);
          return;
        }
        renderDomainSettingsList(res.domains || []);
        setDomainSettingsFeedback(
          res.removed ? `Removed ${domain}` : `${domain} was not in the list.`,
          true
        );
      })();
    });
  }
}

function setTutorVisible(visible) {
  if (tutorPanelEl) tutorPanelEl.style.display = visible ? "" : "none";
  if (aiReopenEl) aiReopenEl.style.display = visible ? "none" : "inline-block";
}

function setXpPanelVisible(visible) {
  if (xpPanelEl) xpPanelEl.style.display = visible ? "" : "none";
  if (xpReopenEl) xpReopenEl.style.display = visible ? "none" : "inline-block";
}

async function initTutorVisibility() {
  const { ai_tutor_hidden: hidden } = await getLocal(["ai_tutor_hidden"]);
  const isHidden = Boolean(hidden);
  setTutorVisible(!isHidden);

  if (tutorPanelEl) {
    tutorPanelEl.addEventListener("pointerdown", () => {
      void tutorApi.ensureTutorUiInitialized?.();
    }, { once: true });
  }
  if (aiInputEl) {
    aiInputEl.addEventListener("focus", () => {
      void tutorApi.ensureTutorUiInitialized?.();
    }, { once: true });
  }
  if (aiFormEl) {
    aiFormEl.addEventListener("submit", (event) => {
      if (tutorUiInitialized) return;
      event.preventDefault();
      void tutorApi.ensureTutorUiInitialized?.();
    }, true);
  }

  if (aiCloseEl) {
    aiCloseEl.addEventListener("click", () => {
      setTutorVisible(false);
      void setLocal({ ai_tutor_hidden: true });
    });
  }
  if (aiReopenEl) {
    aiReopenEl.addEventListener("click", () => {
      setTutorVisible(true);
      void setLocal({ ai_tutor_hidden: false });
      void tutorApi.ensureTutorUiInitialized?.();
    });
  }

  return !isHidden;
}

async function initXpPanelVisibility() {
  const { xp_panel_hidden: hidden } = await getLocal(["xp_panel_hidden"]);
  const isHidden = Boolean(hidden);
  setXpPanelVisible(!isHidden);

  if (xpCloseEl) {
    xpCloseEl.addEventListener("click", () => {
      setXpPanelVisible(false);
      void setLocal({ xp_panel_hidden: true });
    });
  }
  if (xpReopenEl) {
    xpReopenEl.addEventListener("click", () => {
      setXpPanelVisible(true);
      void setLocal({ xp_panel_hidden: false });
    });
  }
}
