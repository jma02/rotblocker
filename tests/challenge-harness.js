const fs = require("node:fs");
const vm = require("node:vm");

function makeElementStub(tagName = "div") {
  const classNames = new Set();
  const listeners = {};
  const attributes = new Map();
  const element = {
    tagName: String(tagName || "div").toUpperCase(),
    dataset: {},
    style: {},
    textContent: "",
    value: "",
    children: [],
    parentNode: null,
    hidden: false,
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    __submitButton: null,
    __focused: false,
    classList: {
      add(...tokens) {
        tokens.forEach((token) => {
          const value = String(token || "").trim();
          if (value) classNames.add(value);
        });
      },
      remove(...tokens) {
        tokens.forEach((token) => classNames.delete(String(token || "").trim()));
      },
      toggle(token, force) {
        const value = String(token || "").trim();
        if (!value) return false;
        if (typeof force === "boolean") {
          if (force) classNames.add(value);
          else classNames.delete(value);
          return force;
        }
        if (classNames.has(value)) {
          classNames.delete(value);
          return false;
        }
        classNames.add(value);
        return true;
      },
      contains(token) {
        return classNames.has(String(token || "").trim());
      }
    },
    addEventListener(type, handler) {
      const key = String(type || "");
      if (!key || typeof handler !== "function") return;
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(handler);
    },
    removeEventListener(type, handler) {
      const key = String(type || "");
      if (!key || !listeners[key]) return;
      listeners[key] = listeners[key].filter((fn) => fn !== handler);
    },
    dispatchEvent(event) {
      const key = String(event?.type || "");
      const handlers = listeners[key] || [];
      handlers.forEach((handler) => handler.call(element, event));
    },
    querySelector(selector) {
      if (selector === "button[type=\"submit\"]") {
        return element.__submitButton;
      }
      return null;
    },
    querySelectorAll(selector) {
      const matches = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (
            selector === "[data-math-revision], mjx-container"
            && (
              child.tagName === "MJX-CONTAINER"
              || Boolean(child.dataset?.mathRevision)
            )
          ) {
            matches.push(child);
          } else if (
            String(selector || "").startsWith(".")
            && child.classList?.contains(String(selector).slice(1))
          ) {
            matches.push(child);
          }
          visit(child);
        }
      };
      visit(element);
      return matches;
    },
    appendChild(child) {
      if (!child || typeof child !== "object") return child;
      child.parentNode = element;
      element.children.push(child);
      element.scrollHeight = element.children.length;
      return child;
    },
    removeChild(child) {
      element.children = element.children.filter((node) => node !== child);
      if (child && typeof child === "object") {
        child.parentNode = null;
      }
    },
    remove() {
      if (element.parentNode && typeof element.parentNode.removeChild === "function") {
        element.parentNode.removeChild(element);
      }
    },
    setAttribute(name, value) {
      attributes.set(String(name), String(value));
      if (name === "class") {
        classNames.clear();
        String(value || "").split(/\s+/).filter(Boolean).forEach((token) => classNames.add(token));
      }
      if (name === "aria-hidden") {
        element.ariaHidden = String(value);
      }
    },
    getAttribute(name) {
      return attributes.has(String(name)) ? attributes.get(String(name)) : null;
    },
    removeAttribute(name) {
      attributes.delete(String(name));
    },
    closest(selector) {
      if (!selector || selector[0] !== ".") return null;
      const token = selector.slice(1);
      return element.classList.contains(token) ? element : null;
    },
    focus() {
      element.__focused = true;
    }
  };

  Object.defineProperty(element, "className", {
    get() {
      return Array.from(classNames).join(" ");
    },
    set(next) {
      classNames.clear();
      String(next || "").split(/\s+/).filter(Boolean).forEach((token) => classNames.add(token));
    }
  });
  let innerHtml = "";
  Object.defineProperty(element, "innerHTML", {
    get() {
      return innerHtml;
    },
    set(next) {
      innerHtml = String(next || "");
      if (innerHtml === "") {
        for (const child of element.children) {
          if (child && typeof child === "object") child.parentNode = null;
        }
        element.children = [];
      }
    }
  });

  return element;
}

function createDocumentStub(visibilityState = "visible", poolKeys = []) {
  const listeners = {};
  const elementsById = new Map();
  const poolChips = Array.from(poolKeys || [], (poolKey) => {
    const chip = makeElementStub("button");
    chip.dataset.pool = String(poolKey || "");
    return chip;
  });

  function getOrCreateById(id) {
    const key = String(id || "");
    if (!elementsById.has(key)) {
      const el = makeElementStub("div");
      if (key === "ai-form" || key === "answer-form") {
        const submitBtn = makeElementStub("button");
        submitBtn.type = "submit";
        submitBtn.textContent = key === "ai-form" ? "Ask Tutor" : "Submit";
        el.__submitButton = submitBtn;
      }
      elementsById.set(key, el);
    }
    return elementsById.get(key);
  }

  return {
    visibilityState,
    body: makeElementStub("body"),
    __elementsById: elementsById,
    __poolChips: poolChips,
    getElementById(id) {
      return getOrCreateById(id);
    },
    querySelector(selector) {
      if (selector === ".xp-avatar") return makeElementStub("div");
      return makeElementStub("div");
    },
    querySelectorAll(selector) {
      return selector === ".pool-chip" ? poolChips : [];
    },
    addEventListener(type, handler) {
      const key = String(type || "");
      if (!key || typeof handler !== "function") return;
      if (!listeners[key]) listeners[key] = [];
      listeners[key].push(handler);
    },
    removeEventListener(type, handler) {
      const key = String(type || "");
      if (!key || !listeners[key]) return;
      listeners[key] = listeners[key].filter((fn) => fn !== handler);
    },
    createElement(tagName) {
      return makeElementStub(tagName);
    }
  };
}

function loadChallengeFns(options = {}) {
  const {
    pathname = "/rotblocker++/index.html",
    search = "",
    hash = "",
    extensionRuntime = true,
    historyOverride = null,
    rotBlockerScoring = undefined,
    siteBlockerScoring = undefined,
    windowMathJax = { typesetPromise: () => Promise.resolve() },
    includeBootstrap = false,
    fetchImpl = undefined,
    chromeOverride = undefined,
    localStorageOverride = undefined,
    documentOverride = undefined,
    visibilityState = "visible",
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    setIntervalImpl = () => 0,
    clearIntervalImpl = () => {},
    DateOverride = undefined,
    poolKeys = []
  } = options;
  const parts = [
    fs.readFileSync("challenge-modules/constants.js", "utf8"),
    fs.readFileSync("challenge-modules/dom.js", "utf8"),
    fs.readFileSync("challenge-modules/math.js", "utf8"),
    fs.readFileSync("challenge-modules/sync.js", "utf8"),
    fs.readFileSync("challenge-modules/tutor.js", "utf8"),
    fs.readFileSync("challenge-modules/gameplay.js", "utf8"),
    fs.readFileSync("challenge.js", "utf8")
  ];
  if (includeBootstrap) {
    parts.push(fs.readFileSync("challenge-modules/bootstrap.js", "utf8"));
  }
  const source = parts.join("\n");
  const document = documentOverride || createDocumentStub(visibilityState, poolKeys);
  const window = {
    location: { pathname, search, hash },
    history: historyOverride || { state: null, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    MathJax: windowMathJax || undefined,
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    }
  };
  const localStorage = localStorageOverride || { getItem() { return null; }, setItem() {}, removeItem() {} };
  const chrome = chromeOverride || (extensionRuntime ? {
    storage: { local: { get(_key, cb) { cb({}); }, set(_value, cb) { if (cb) cb(); } } },
    runtime: { id: "test", getURL(path) { return path; } }
  } : undefined);
  const sandbox = {
    console,
    document,
    window,
    localStorage,
    chrome,
    fetch: fetchImpl,
    RotBlockerScoring: rotBlockerScoring,
    SiteBlockerScoring: siteBlockerScoring,
    MathJax: windowMathJax || undefined,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    setInterval: setIntervalImpl,
    clearInterval: clearIntervalImpl,
    HTMLElement: function HTMLElement() {},
    Date: DateOverride || Date
  };
  window.fetch = fetchImpl;
  vm.createContext(sandbox);
  vm.runInContext(
    `${source}
;globalThis.__challengeFns = {
  sanitizeForMathJax,
  normalizeChoiceMath,
  hasRenderableMathSyntax,
  hasMalformedMathSyntax,
  hasAssistantMarkdownSyntax,
  problemRequiresExternalVisual,
  splitMathSegments,
  prepareProblemForBank,
  getSanitizedPrompt,
  getSanitizedChoices,
  getNormalizedChoices,
  problemLooksRenderable,
  levelFromXp,
  avatarTierFromLevel,
  resolveAssetPath,
  resolveScoringApi,
  renderMathText,
  renderAssistantMarkdownText,
  renderProblem,
  render,
  queueMathTypeset,
  replaceMathContainer,
  flushPendingMathTypeset,
  bindMathJaxReadyRetry,
  handleMcqChoice,
  handleInputAnswer,
  isProblemInteractionReady,
  isProblemStateMutationInFlight,
  suspendProblemInteractionsForStateMutation,
  finishProblemStateMutation,
  problemElapsedMsNow,
  tickUi,
  appendChat,
  submitTutorPrompt,
  cancelTutorRequest,
  cancelTutorForProblemTransition,
  initTutorUi,
  initPoolChips,
  updateModelOptionsForConfig,
  __setGameplayStateForTest(next = {}) {
    if (Object.prototype.hasOwnProperty.call(next, "currentProblem")) currentProblem = next.currentProblem;
    if (Object.prototype.hasOwnProperty.call(next, "mcqWrongGuesses")) mcqWrongGuesses = Number(next.mcqWrongGuesses) || 0;
    if (Object.prototype.hasOwnProperty.call(next, "usedChoices")) usedChoices = new Set(next.usedChoices || []);
    if (Object.prototype.hasOwnProperty.call(next, "score")) score = Number(next.score) || 0;
    if (Object.prototype.hasOwnProperty.call(next, "xp")) xp = Number(next.xp) || 0;
    if (Object.prototype.hasOwnProperty.call(next, "prestige")) prestige = Number(next.prestige) || 0;
    if (Object.prototype.hasOwnProperty.call(next, "unlockedUntil")) unlockedUntil = next.unlockedUntil;
    if (Object.prototype.hasOwnProperty.call(next, "stateUpdatedAt")) stateUpdatedAt = Number(next.stateUpdatedAt) || 0;
    if (Object.prototype.hasOwnProperty.call(next, "aiHistory")) aiHistory = Array.from(next.aiHistory || []);
  },
  __transitionProblemForTest(problem, note = "Test problem transition.") {
    tutorApi.cancelTutorForProblemTransition?.();
    currentProblem = problem;
    resetProblemTimer(currentProblem);
    aiHistory = [];
    mcqWrongGuesses = 0;
    usedChoices = new Set();
    setTutorProblemEvent(note);
    renderProblem();
  },
  __setProblemBankForTest(poolKey, rows) {
    Object.keys(poolEnabled).forEach((key) => {
      poolEnabled[key] = false;
    });
    const key = String(poolKey || "amc8");
    banks[key] = Array.from(rows || []);
    poolLoaded[key] = true;
    poolAvailable[key] = banks[key].length > 0;
    poolEnabled[key] = poolAvailable[key];
  },
  __getGameplayStateForTest() {
    return {
      currentProblem,
      problemRenderRevision,
      readyProblemRenderRevision,
      claimedProblemRenderRevision,
      mcqWrongGuesses,
      usedChoices: Array.from(usedChoices),
      score,
      xp,
      prestige,
      unlockedUntil,
      stateUpdatedAt,
      aiHistory: Array.from(aiHistory),
      aiBusy,
      tutorRequestRevision,
      scoreResponseGeneration,
      scoreRequestSequence,
      latestAppliedScoreRequestSequence,
      problemStateMutationDepth,
      poolIntentRevision,
      poolEnabled: { ...poolEnabled },
      poolLoaded: { ...poolLoaded },
      poolAvailable: { ...poolAvailable },
      elapsedMs: problemElapsedMsNow(),
      tutorProblemEvent: globalThis.RB?.tutorProblemEvent || ""
    };
  },
  canonicalizeRotblockerPreviewPath,
  desiredSyncDiagnosticsIntervalMs: typeof desiredSyncDiagnosticsIntervalMs === "function" ? desiredSyncDiagnosticsIntervalMs : undefined,
  restartSyncDiagnosticsPolling: typeof restartSyncDiagnosticsPolling === "function" ? restartSyncDiagnosticsPolling : undefined,
  stopSyncDiagnosticsPolling: typeof stopSyncDiagnosticsPolling === "function" ? stopSyncDiagnosticsPolling : undefined,
  refreshSyncDiagnostics: typeof refreshSyncDiagnostics === "function" ? refreshSyncDiagnostics : undefined,
  formatTutorError: typeof formatTutorError === "function" ? formatTutorError : undefined,
  appendChatError: typeof appendChatError === "function" ? appendChatError : undefined,
  extractApiErrorDetail: typeof extractApiErrorDetail === "function" ? extractApiErrorDetail : undefined,
  summarizeTutorHttpError: typeof summarizeTutorHttpError === "function" ? summarizeTutorHttpError : undefined,
  modelCacheKey: typeof modelCacheKey === "function" ? modelCacheKey : undefined,
  fetchAndCacheModels: typeof fetchAndCacheModels === "function" ? fetchAndCacheModels : undefined,
  sendMessage: typeof sendMessage === "function" ? sendMessage : undefined,
  saveAiConfig: typeof saveAiConfig === "function" ? saveAiConfig : undefined,
  loadAiConfig: typeof loadAiConfig === "function" ? loadAiConfig : undefined,
  bootstrapChallengeApp: typeof bootstrapChallengeApp === "function" ? bootstrapChallengeApp : undefined,
  runWhenIdle: typeof runWhenIdle === "function" ? runWhenIdle : undefined
};`,
    sandbox
  );
  return {
    ...sandbox.__challengeFns,
    __sandbox: sandbox,
    __elementsById: document.__elementsById || null,
    __poolChips: document.__poolChips || []
  };
}

module.exports = { loadChallengeFns };
