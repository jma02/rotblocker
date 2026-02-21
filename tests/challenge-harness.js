const fs = require("node:fs");
const vm = require("node:vm");

function makeElementStub() {
  return {
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    textContent: "",
    innerHTML: "",
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    remove() {},
    setAttribute() {},
    getAttribute() { return null; }
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
    siteBlockerScoring = undefined
  } = options;
  const source = fs.readFileSync("challenge.js", "utf8");
  const document = {
    getElementById() { return makeElementStub(); },
    querySelector() { return makeElementStub(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return makeElementStub(); }
  };
  const window = {
    location: { pathname, search, hash },
    history: historyOverride || { state: null, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    }
  };
  const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const chrome = extensionRuntime ? {
    storage: { local: { get(_key, cb) { cb({}); }, set(_value, cb) { if (cb) cb(); } } },
    runtime: { id: "test", getURL(path) { return path; } }
  } : undefined;
  const sandbox = {
    console,
    document,
    window,
    localStorage,
    chrome,
    RotBlockerScoring: rotBlockerScoring,
    SiteBlockerScoring: siteBlockerScoring,
    MathJax: { typesetPromise: () => Promise.resolve() },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${source}
;globalThis.__challengeFns = { sanitizeForMathJax, normalizeChoiceMath, hasRenderableMathSyntax, levelFromXp, avatarTierFromLevel, resolveAssetPath, resolveScoringApi };`,
    sandbox
  );
  return sandbox.__challengeFns;
}

module.exports = { loadChallengeFns };
