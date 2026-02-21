const statusEl = document.getElementById("status");
const timerEl = document.getElementById("timer");
const livePointsEl = document.getElementById("live-points");
const globalTimerEl = document.getElementById("global-timer");
const rerollBtnEl = document.getElementById("reroll-btn");
const xpSummaryEl = document.getElementById("xp-summary");
const xpFillEl = document.getElementById("xp-fill");
const xpNextEl = document.getElementById("xp-next");
const prestigeSummaryEl = document.getElementById("prestige-summary");
const prestigeBtnEl = document.getElementById("prestige-btn");
const xpPanelEl = document.getElementById("xp-panel");
const xpCloseEl = document.getElementById("xp-close");
const xpReopenEl = document.getElementById("xp-reopen");
const xpAvatarEl = document.getElementById("xp-avatar") || document.querySelector(".xp-avatar");
const syncBoxEl = document.getElementById("sync-box");
const syncStatusEl = document.getElementById("sync-status");
const syncUserEl = document.getElementById("sync-user");
const syncLastEl = document.getElementById("sync-last");
const syncErrorEl = document.getElementById("sync-error");
const syncSignInEl = document.getElementById("sync-signin");
const syncSignOutEl = document.getElementById("sync-signout");
const syncNowEl = document.getElementById("sync-now");
const domainSettingsToggleEl = document.getElementById("domain-settings-toggle");
const domainSettingsModalEl = document.getElementById("domain-settings-modal");
const domainSettingsBackdropEl = document.getElementById("domain-settings-backdrop");
const domainSettingsPanelEl = document.getElementById("domain-settings-panel");
const domainSettingsFormEl = document.getElementById("domain-settings-form");
const domainSettingsInputEl = document.getElementById("domain-settings-input");
const domainSettingsFeedbackEl = document.getElementById("domain-settings-feedback");
const domainSettingsListEl = document.getElementById("domain-settings-list");
const domainSettingsCloseEl = document.getElementById("domain-settings-close");
const lockoutSettingsFormEl = document.getElementById("lockout-settings-form");
const lockoutCooldownInputEl = document.getElementById("lockout-cooldown-input");
const lockoutSettingsFeedbackEl = document.getElementById("lockout-settings-feedback");
const feedbackEl = document.getElementById("feedback");
const problemEl = document.getElementById("problem");
const diagramWrapEl = document.getElementById("diagram-wrap");
const diagramImgEl = document.getElementById("diagram-img");
const formEl = document.getElementById("answer-form");
const answerEl = document.getElementById("answer");
const choicesEl = document.getElementById("choices");
const metaEl = document.getElementById("meta");
const unlockBtn = document.getElementById("unlock");
const relockBtn = document.getElementById("relock");
const quizEl = document.getElementById("quiz");
const themeToggleEl = document.getElementById("theme-toggle");
const tutorPanelEl = document.getElementById("tutor-panel");
const aiCloseEl = document.getElementById("ai-close");
const aiReopenEl = document.getElementById("ai-reopen");

const aiProviderEl = document.getElementById("ai-provider");
const aiModelEl = document.getElementById("ai-model");
const aiTokenEl = document.getElementById("ai-token");
const aiSaveEl = document.getElementById("ai-save");
const aiRefreshModelsEl = document.getElementById("ai-refresh-models");
const aiSystemEl = document.getElementById("ai-system");
const aiChatEl = document.getElementById("ai-chat");
const aiFormEl = document.getElementById("ai-form");
const aiInputEl = document.getElementById("ai-input");
const aiSubmitEl = aiFormEl ? aiFormEl.querySelector('button[type="submit"]') : null;
const poolChipEls = Array.from(document.querySelectorAll(".pool-chip"));

const DECAY_DURATION_BY_CONTEST_MS = {
  amc8: 6 * 60 * 1000,
  amc10: 8 * 60 * 1000,
  amc12: 10 * 60 * 1000,
  aime: Infinity,
  upper_level_mcq: 8 * 60 * 1000,
  calculus: 8 * 60 * 1000
};
const BASE_WEIGHT_BY_CONTEST = {
  amc8: 5,
  amc10: 8,
  amc12: 12,
  aime: 30,
  upper_level_mcq: 5,
  calculus: 5
};
const GUESS_MULTIPLIERS = [1, 0.1, 0.02, 0, 0];
const WRONG_GUESS_PENALTIES = {
  2: 1.0,
  3: 3.0,
  4: 6.0
};
const MODEL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SYSTEM_PROMPT = "You are a mathematics tutoring coach. Your role is to help the user develop problem-solving ability while they work on contest-style math questions. Do not provide full solutions or final answers to active problems. If the user asks to give up, decline and continue with guided support. Provide clear, informative hints that build intuition, emphasize strategy, and break the problem into actionable next steps. Format math using MathJax-compatible LaTeX delimiters: use $...$ for inline math and $$...$$ for display math, keeping normal prose outside math delimiters.";
const AI_PROVIDER_OPENAI = "openai";
const AI_PROVIDER_OPENROUTER = "openrouter";
const SUPPORTED_AI_PROVIDERS = new Set([
  AI_PROVIDER_OPENAI,
  AI_PROVIDER_OPENROUTER
]);

function normalizeAiProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (SUPPORTED_AI_PROVIDERS.has(normalized)) return normalized;
  return AI_PROVIDER_OPENAI;
}

function resolveAiProviderMeta(provider) {
  const normalized = normalizeAiProvider(provider);
  if (normalized === AI_PROVIDER_OPENROUTER) {
    return {
      id: normalized,
      modelsUrl: "https://openrouter.ai/api/v1/models",
      chatUrl: "https://openrouter.ai/api/v1/chat/completions",
      includeOpenRouterHeaders: true
    };
  }

  return {
    id: normalized,
    modelsUrl: "https://api.openai.com/v1/models",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    includeOpenRouterHeaders: false
  };
}

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
    hintUsed,
    isMcq,
    wrongGuesses,
    multipliers
  } = args;
  if (hintUsed) return 0;
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
let syncClient = null;
let syncBusy = false;
let syncIntervalId = null;
let syncDebounceTimer = null;

const banks = {
  amc8: [],
  amc10: [],
  amc12: [],
  aime: [],
  gre: [],
  calculus: []
};
const POOL_FILE_BY_KEY = {
  amc8: "amc8",
  amc10: "amc10",
  amc12: "amc12",
  aime: "aime",
  gre: "upper_level_mcq",
  calculus: "calculus_mcq_synthetic"
};
const poolWeights = {
  amc8: 35,
  amc10: 20,
  amc12: 15,
  aime: 10,
  gre: 10,
  calculus: 10
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
let lastLockState = null;
const RECENT_PROBLEM_LIMIT = 30;
const recentProblemIds = [];
let mathTypesetQueue = Promise.resolve();

function queueMathTypeset(el) {
  if (!el || typeof window === "undefined") return;
  const mj = window.MathJax;
  if (!mj || typeof mj.typesetPromise !== "function") return;
  mathTypesetQueue = mathTypesetQueue
    .then(() => {
      if (typeof mj.typesetClear === "function") {
        mj.typesetClear([el]);
      }
      return mj.typesetPromise([el]);
    })
    .catch(() => {});
}

function hasRenderableMathSyntax(text) {
  const s = String(text || "");
  return /(?<!\\)\$|\\\(|\\\[|\\[A-Za-z]+|[_^{}]/.test(s);
}

function hasAssistantMarkdownSyntax(text) {
  const s = String(text || "");
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(s) || /\*\*[^*\n]+?\*\*/.test(s) || /(^|[^*])\*[^*\n]+?\*(?!\*)/.test(s);
}

function stabilizePunctuationWrapping(text) {
  // Keep punctuation visually attached to the preceding token when wrapping.
  // \u2060 is WORD JOINER (zero-width, non-breaking).
  // Never inject between TeX escapes like "\," (that breaks MathJax parsing).
  return String(text || "").replace(/([^\\\s])([,.;:!?])/g, "$1\u2060$2");
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitMathSegments(text) {
  const source = String(text || "");
  const pattern = /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$(?:\\.|[^\\$\n])+\$/g;
  const parts = [];
  let index = 0;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > index) {
      parts.push({ kind: "plain", value: source.slice(index, match.index) });
    }
    parts.push({ kind: "math", value: match[0] });
    index = match.index + match[0].length;
  }
  if (index < source.length) {
    parts.push({ kind: "plain", value: source.slice(index) });
  }
  return parts;
}

function renderInlineMarkdownHtml(text) {
  const safeToken = "__CHAT_ESCAPED_ASTERISK__";
  let out = escapeHtml(stabilizePunctuationWrapping(text)).replace(/\\\*/g, safeToken);
  out = out.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(new RegExp(safeToken, "g"), "*");
  return out;
}

function renderAssistantMarkdownLineHtml(line) {
  const headingMatch = String(line || "").match(/^\s{0,3}(#{1,3})\s+(.+)$/);
  const level = headingMatch ? headingMatch[1].length : 0;
  const text = headingMatch ? headingMatch[2] : String(line || "");
  const segments = splitMathSegments(text);
  const inner = segments.map((part) => {
    if (part.kind === "math") return escapeHtml(stabilizePunctuationWrapping(part.value));
    return renderInlineMarkdownHtml(part.value);
  }).join("");
  if (level > 0) {
    return `<span class="chat-md-heading chat-md-h${level}">${inner}</span>`;
  }
  return inner;
}

function renderAssistantMarkdownText(el, text) {
  if (!el) return;
  const sanitized = sanitizeForMathJax(String(text || ""));
  const renderKey = `m::${sanitized}`;
  if (el.dataset.renderKey === renderKey) return;
  const html = sanitized.split(/\r?\n/).map((line) => renderAssistantMarkdownLineHtml(line)).join("<br>");
  el.innerHTML = html;
  el.dataset.renderKey = renderKey;
  if (hasRenderableMathSyntax(sanitized)) {
    queueMathTypeset(el);
  }
}

function renderMathText(el, text, options = {}) {
  const inlineOnly = Boolean(options.inlineOnly);
  const force = Boolean(options.force);
  if (!el) return;
  const nextText = text || "";
  const displayText = stabilizePunctuationWrapping(nextText);
  const renderKey = `${inlineOnly ? "i" : "b"}::${nextText}`;
  if (!force && el.dataset.renderKey === renderKey) return;
  const renderPlain = !hasRenderableMathSyntax(nextText);
  el.textContent = renderPlain ? displayText.replace(/\\\$/g, "$") : displayText;
  el.dataset.renderKey = renderKey;
  if (renderPlain) return;
  queueMathTypeset(el);
}

function normalizeChoiceMath(text) {
  const normalizeAmbiguousChoice = (value) => {
    let out = String(value || "").trim();
    if (!out) return out;

    out = out
      .replace(/\b(?:GO ON TO THE NEXT P ?AGE\.?|SCRATCH WORK|ANSWER KEY)\b.*$/i, "")
      .replace(/\b(?:Linear Algebra|References|Multivariable Calculus|Euclidean Geometry|General Topology|Complex Analysis|Differential Equations)\s*#?\d*\s*$/i, "")
      .replace(/\bReferences?\s*:?\s*\d*\s*$/i, "")
      .replace(/\bProbability\s*#?\d*\s*$/i, "")
      .trim();

    out = out
      .replace(/^([+-]?)\s*(\d+)\s+(\d+)\s*$/, (_m, sign, n, d) => `${sign}\\frac{${n}}{${d}}`)
      .replace(/^([+-]?)\s*e\s+(\d+)\s*$/i, (_m, sign, p) => `${sign}e^{${p}}`)
      .replace(/^([+-]?)\s*e\s+(\d+)\s+(\d+)\s*$/i, (_m, sign, n, d) => `${sign}e^{\\frac{${n}}{${d}}}`)
      .replace(/^([+-]?)\s*\\pi\s+(\d+)\s*$/i, (_m, sign, d) => `${sign}\\frac{\\pi}{${d}}`)
      .replace(/^([+-]?)\s*(\d+)\s+\\pi\s*$/i, (_m, sign, n) => `${sign}${n}\\pi`)
      .replace(/^([+-]?)\s*(\d+)\s+(\d+)\s+\$?\\sqrt\{?\s*(\d+)\s*\}?\$?\s*$/i, (_m, sign, n, d, r) => {
        const numerator = Number(n) === 1 ? `\\sqrt{${r}}` : `${n}\\sqrt{${r}}`;
        return `${sign}\\frac{${numerator}}{${d}}`;
      })
      .replace(/^([+-]?)\s*(\d+)\s+\$?\\sqrt\{?\s*(\d+)\s*\}?\$?\s*$/i, (_m, sign, n, r) => `${sign}${n}\\sqrt{${r}}`)
      .replace(/^([+-]?)\s*(\d+)\s+(\d+)\s+\\sqrt\{?\s*(\d+)\s*\}?\s*$/i, (_m, sign, n, d, r) => {
        const numerator = Number(n) === 1 ? `\\sqrt{${r}}` : `${n}\\sqrt{${r}}`;
        return `${sign}\\frac{${numerator}}{${d}}`;
      });

    return out.trim();
  };

  const raw = normalizeAmbiguousChoice(sanitizeForMathJax(text)).trim();
  if (!raw) return raw;

  // Display math inside buttons causes layout/cropping issues; force inline.
  const inline = raw
    .replace(/\\\[/g, "\\(")
    .replace(/\\\]/g, "\\)");

  const hasDelimiters = /\$|\\\(|\\\[/.test(inline);
  const looksLikeLatex = /\\[a-zA-Z]+|[_^{}]/.test(inline);
  if (!hasDelimiters && looksLikeLatex) {
    return `$${inline}$`;
  }
  return inline;
}

function stripMathJaxWrappers(text) {
  return String(text || "")
    .replace(/<\/?(?:math|mrow|mi|mo|mn|msup|msub|msubsup|mfrac|msqrt|mroot|mstyle|mtext|semantics|annotation(?:-xml)?)\b[^>]*>/gi, " ")
    .replace(/\[\/?\s*mathjax\s*\]/gi, " ")
    .replace(/\[\/?\s*tex\s*\]/gi, " ")
    .replace(/\s+/g, " ");
}

function normalizeUnicodeMathTokens(text) {
  const source = String(text || "");
  const replacements = [
    [/\ufb00/g, "ff"],
    [/\ufb01/g, "fi"],
    [/\ufb02/g, "fl"],
    [/\ufb03/g, "ffi"],
    [/\ufb04/g, "ffl"],
    [/\u00a0/g, " "], // NBSP
    [/\u2009|\u202f/g, " "], // thin no-break spaces
    [/\u2212/g, "-"], // unicode minus
    [/\u00d7/g, "\\times "],
    [/\u00f7/g, "\\div "],
    [/\u00b1/g, "\\pm "],
    [/\u2213/g, "\\mp "],
    [/\u2264/g, "\\le "],
    [/\u2265/g, "\\ge "],
    [/\u2260/g, "\\ne "],
    [/\u2248/g, "\\approx "],
    [/\u221e/g, "\\infty "],
    [/\u2211/g, "\\sum "],
    [/\u220f/g, "\\prod "],
    [/\u222b/g, "\\int "],
    [/\u03b8/g, "\\theta "],
    [/\u03b1/g, "\\alpha "],
    [/\u03b2/g, "\\beta "],
    [/\u03b3/g, "\\gamma "],
    [/\u03bb/g, "\\lambda "],
    [/\u03bc/g, "\\mu "],
    [/\u03c3/g, "\\sigma "],
    [/\u03d5|\u03c6/g, "\\phi "],
    [/\u03c9/g, "\\omega "],
    [/\u2192/g, "\\to "],
    [/\u21a6/g, "\\mapsto "],
    [/\u2032/g, "'"],
    [/\u00bd/g, "\\frac{1}{2}"],
    [/\u00bc/g, "\\frac{1}{4}"],
    [/\u00be/g, "\\frac{3}{4}"],
    [/\u2153/g, "\\frac{1}{3}"],
    [/\u2154/g, "\\frac{2}{3}"],
    [/\u215b/g, "\\frac{1}{8}"],
    [/\u215c/g, "\\frac{3}{8}"],
    [/\u215d/g, "\\frac{5}{8}"],
    [/\u215e/g, "\\frac{7}{8}"]
  ];

  let out = source;
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  out = out
    // OCR often turns pi into "T" in angle expressions like 7T/6.
    .replace(/(\d)\s*T(?=\s*\/\s*\d)/g, "$1π")
    .replace(/\bT(?=\s*\/\s*\d)/g, "π")
    .replace(/\bI(?=\s*\/\s*\d)/g, "1")
    // Normalize bare sqrt followed by a token into MathJax-safe form.
    .replace(/(?<!\\)\bsqrt\s*\(?\s*([A-Za-z0-9][A-Za-z0-9^_+\-*/.]*)\)?/gi, "\\sqrt{$1}")
    .replace(/√\s*([^,;:!?]+)/g, (_m, inner) => `\\sqrt{${String(inner || "").trim()}}`)
    // Some OCR exports use modifier circumflex as a faux integral sign.
    .replace(/\u02c6(?=\s*\d|\s*[A-Za-z])/g, "\\int ")
    .replace(/(?<!\\)\b(arcsin|arccos|arctan|sin|cos|tan|sec|csc|cot|log|ln)\b/gi, (_m, fn) => `\\${String(fn || "").toLowerCase()}`);
  return out;
}

function wrapBareLatexSpans(text) {
  const source = String(text || "");
  if (/(?<!\\)\$|\\\(|\\\[/.test(source)) return source;
  const safeWrap = (input, regex) => input.replace(regex, (span, offset, full) => {
    const trimmed = String(span || "").trim();
    if (!trimmed) return span;
    const prevChar = offset > 0 ? full[offset - 1] : "";
    const nextChar = full[offset + span.length] || "";
    if (prevChar === "{" || prevChar === "_" || prevChar === "^" || prevChar === "\\") return span;
    if (nextChar === "}") return span;
    return `$${trimmed}$`;
  });

  let out = source;
  out = safeWrap(out, /\\int\b[^,;:!?\n]{0,96}?d[A-Za-z]/g);
  out = safeWrap(out, /\\(?:sum|prod)\b[^,;:!?\n]{0,96}/g);
  out = safeWrap(out, /\\(?:arc(?:sin|cos|tan)|sin|cos|tan|sec|csc|cot|log|ln|exp|sqrt)\s*(?:\{[^{}]*\}|\([^()]*\)|[A-Za-z0-9.+\-*/^_]+)/g);
  out = safeWrap(out, /\\(?:theta|alpha|beta|gamma|delta|lambda|mu|sigma|phi|omega|infty|le|ge|ne|neq|cdot|times|div)\b(?:\s*\/\s*[0-9A-Za-z]+)?/g);
  return out;
}

function stripScanNoise(text) {
  let out = String(text || "")
    .replace(/\b(?:GO ON TO THE NEXT P ?AGE\.?|SCRATCH WORK|ANSWER KEY)\b.*$/gi, " ")
    .replace(/\b(?:Linear Algebra|Multivariable Calculus|Euclidean Geometry|General Topology|Complex Analysis|Differential Equations)\s*#?\d*\s*$/gi, " ")
    .replace(/\bReferences?\s*:?\s*\d*\s*$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  out = out.replace(/\s+\d{1,2}\s*$/g, (suffix, offset, full) => {
    const head = full.slice(0, Number(offset)).trimEnd();
    // Trim likely page-number tails only when the preceding tail is prose-ish.
    if (/[A-Za-z]{4,}\s*$/.test(head)) return " ";
    return suffix;
  });
  return out.trim();
}

function normalizeOcrMathPatterns(text) {
  let out = String(text || "");
  out = stripScanNoise(out);
  out = out
    .replace(/\bd\s*d([A-Za-z])\b/g, "\\frac{d}{d$1}")
    .replace(/\blim\s*([A-Za-z])\s*(?:\\to|->)\s*([A-Za-z0-9+\-^{}]+)/gi, "\\lim_{$1\\to $2}")
    .replace(/\blim([A-Za-z])\s*(?:\\to|->)\s*([A-Za-z0-9+\-^{}]+)/gi, "\\lim_{$1\\to $2}")
    // OCR often emits "sinx x" for sin(x)/x.
    .replace(/\(\s*(\\sin|\\cos|\\tan|sin|cos|tan)\s*([A-Za-z])\s+([A-Za-z])\s*\)/gi, (_m, fn, a, b) => {
      if (String(a || "").toLowerCase() !== String(b || "").toLowerCase()) return _m;
      const safeFn = String(fn || "").startsWith("\\") ? String(fn) : `\\${String(fn || "").toLowerCase()}`;
      return `(\\frac{${safeFn} ${a}}{${b}})`;
    })
    .replace(/(^|[^A-Za-z])([A-Za-z])\s+([23])(?=[\s),.;:!?]|$)/g, "$1$2^$3")
    .replace(/√\s*([0-9A-Za-z]+)/g, "\\sqrt{$1}")
    .replace(/\s+/g, " ");
  out = out.replace(/([.?!])\s+\d{1,2}\s*$/, "$1");
  return out.trim();
}

function normalizeUnsupportedLatexEnvironments(text) {
  const stripEmptyScriptMarkers = (value) => {
    let out = String(value || "");
    let prev = "";
    while (out !== prev) {
      prev = out;
      out = out
        // Drop empty script markers attached to symbols, e.g. x_{}^{}.
        .replace(/(?<=\S)\s*(?:\^\s*\{\s*\}|_\s*\{\s*\})+/g, "")
        // Also drop any remaining standalone empty script markers.
        .replace(/(?:\^\s*\{\s*\}|_\s*\{\s*\})+/g, "");
    }
    return out;
  };
  const toEscapedCurrency = (_full, amount) => `\\$${String(amount || "").trim()}`;
  const normalizeInnerEscapedCurrency = (_full, inner) => {
    const seg = String(inner || "").trim();
    // Keep math wrappers when the payload contains LaTeX commands
    // (e.g., $\$\underline{1}\underline{A}\underline{2}$).
    if (seg.includes("\\")) return _full;
    return `\\$${seg}`;
  };
  const normalizeBrokenFractions = (value) => {
    let out = String(value || "");
    // Some imported datasets drop the leading backslash in frac-like commands.
    out = out.replace(/(^|[^\\A-Za-z])(dfrac|tfrac|frac)(?=\s|[0-9{\\+-]|$)/g, (_m, prefix, macro) => `${prefix}\\${macro}`);
    // Normalize common malformed fraction forms into brace-delimited TeX.
    out = out
      // \frac 7{16} -> \frac{7}{16}
      .replace(/\\(dfrac|tfrac|frac)\s*([A-Za-z0-9])\s*\{([^{}]+)\}/g, "\\$1{$2}{$3}")
      // \frac{1}\pi -> \frac{1}{\pi}
      .replace(/\\(dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*(\\[A-Za-z]+|[A-Za-z0-9])(?![A-Za-z0-9])/g, "\\$1{$2}{$3}")
      // \frac mn or \frac12 -> \frac{m}{n}, \frac{1}{2}
      .replace(/\\(dfrac|tfrac|frac)\s+([A-Za-z0-9])\s+([A-Za-z0-9])(?![A-Za-z0-9])/g, "\\$1{$2}{$3}")
      .replace(/\\(dfrac|tfrac|frac)\s*([A-Za-z0-9])\s*([A-Za-z0-9])(?![A-Za-z0-9])/g, "\\$1{$2}{$3}");
    return out;
  };
  const normalized = String(text || "")
    // MathJax support for \multicolumn in imported table fragments is inconsistent.
    // Keep only the cell payload.
    .replace(/\\multicolumn\s*\{[^{}]*\}\s*\{[^{}]*\}\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g, "$1")
    // Normalize unsupported arc macro to a MathJax-safe form.
    .replace(/\\overarc\s*\{([^{}]+)\}/g, "\\overset{\\frown}{$1}")
    // Normalize text-style commands that aren't always available.
    .replace(/\\emph\s*\{/g, "\\text{")
    // Strip layout directives that commonly break MathJax in imported contest data.
    .replace(/\\begingroup\b/g, " ")
    .replace(/\\endgroup\b/g, " ")
    .replace(/\\setlength\s*\{\\tabcolsep\}\s*\{[^{}]*\}/g, " ")
    .replace(/\\renewcommand\s*\{\\arraystretch\}\s*\{[^{}]*\}/g, " ")
    // MathJax doesn't support tabular; convert it to array for rendering.
    .replace(/\\begin\{tabular\*\}\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}\s*\{([^{}]*)\}/g, "\\begin{array}{$1}")
    .replace(/\\begin\{tabular\}\s*(?:\[[^\]]*\])?\s*\{([^{}]*)\}/g, "\\begin{array}{$1}")
    .replace(/\\end\{tabular\*\}/g, "\\end{array}")
    .replace(/\\end\{tabular\}/g, "\\end{array}")
    // Normalize currency-ish macros and malformed wrappers.
    .replace(/\\textdollars?/g, "\\$")
    .replace(/(?<!\S)\$\s*\\\$\s*([^$]+?)\s*\$/g, normalizeInnerEscapedCurrency)
    .replace(/(?<!\S)\$\$(\d+(?:,\d{3})*(?:\.\d+)?)(?=[\s,.;:!?)]|$)/g, toEscapedCurrency)
    .replace(/(?<!\S)\$\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)\$/g, toEscapedCurrency)
    .replace(/(?<!\S)\$\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\$/g, toEscapedCurrency)
    .replace(/\$\$\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)\$/g, toEscapedCurrency)
    .replace(/\\\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\\\$/g, toEscapedCurrency)
    .replace(/([,.;:])\\\$/g, "$1 \\$")
    .replace(/(?<=[A-Za-z])\$(?=[A-Za-z\\0-9])/g, " $")
    .replace(/\\rule\s*\{[^{}]*\}\s*\{(?:0?\.\d+|[0-1](?:\.\d+)?)mm\}/g, "\\underline{\\phantom{00}}")
    // Remove spacing directives that tend to render badly in imported problems.
    .replace(/@\{\\hspace\*?\{[^{}]*\}\}/g, "")
    .replace(/\\(?:hspace|vspace)\*?\{[^{}]*\}/g, " ");
  return stripEmptyScriptMarkers(normalizeBrokenFractions(normalized));
}

const CURRENCY_WORDS = new Set([
  "dollar", "dollars", "cent", "cents", "usd",
  "price", "cost", "costs", "pay", "paid", "more", "less",
  "each", "per", "for", "total", "worth", "charge", "charges",
  "spent", "spend", "earned", "income", "fare", "fares"
]);

function findNextUnescapedDollar(text, start = 0) {
  const source = String(text || "");
  for (let i = Math.max(0, start); i < source.length; i += 1) {
    if (source[i] === "$" && source[i - 1] !== "\\") {
      return i;
    }
  }
  return -1;
}

function looksMathishDollarSegment(segment) {
  const s = String(segment || "").trim();
  if (!s) return true;
  if (!/[A-Za-z]/.test(s)) return true;
  if (/\\[a-zA-Z]+|[=+\-*/^_{}()]/.test(s)) return true;
  if (/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(s)) return true;
  if (/^[A-Za-z](?:\d+)?$/.test(s)) return true;
  return false;
}

function escapeLikelyCurrencyDollars(text) {
  const source = String(text || "");
  return source.replace(/(?<!\\)\$(\d+(?:,\d{3})*(?:\.\d+)?)/g, (match, amount, offset, full) => {
    const after = Number(offset) + String(match).length;
    const nextDollar = findNextUnescapedDollar(full, after);
    if (nextDollar !== -1 && nextDollar - after <= 180) {
      const between = full.slice(after, nextDollar);
      if (looksMathishDollarSegment(between)) {
        return match;
      }
      if (/\s+[A-Za-z]{3,}/.test(between)) {
        return `\\$${amount}`;
      }
      return match;
    }

    const tail = full.slice(after);
    const nextCharMatch = tail.match(/\S/);
    if (!nextCharMatch) return `\\$${amount}`;
    const ch = nextCharMatch[0];

    if ("\\^_{}=+-*/()[]".includes(ch)) return match;
    if (/[.,;:!?)]/.test(ch)) return `\\$${amount}`;

    const wordMatch = tail.match(/^\s*([A-Za-z]+)/);
    if (wordMatch) {
      const w = wordMatch[1].toLowerCase();
      if (CURRENCY_WORDS.has(w) || w.length >= 2) {
        return `\\$${amount}`;
      }
    }
    return match;
  });
}

function repairBrokenDollarEscapes(text) {
  const classify = (segment) => {
    const s = String(segment || "").trim();
    if (!s) return false;
    const strongMath = /\\[a-zA-Z]+|[\\^_{}=+\-*/()<>!:]|(?:\d\.[A-Za-z])|(?:\d\s*:\s*\d)/.test(s);
    const longWordy = /\s+[A-Za-z]{4,}/.test(s);
    if (longWordy && !strongMath) return false;
    if (strongMath) return true;
    // Support short symbolic fragments like "3, 5, 7, a,".
    return /\d/.test(s) && /(?:^|[\s,;])[A-Za-z](?:$|[\s,;])/.test(s);
  };

  let fixed = String(text || "").replace(/(?<!\$)\\\$(.+?)(?<!\\)\$/g, (_m, seg) => {
    const s = String(seg || "").trim();
    // If there is another unescaped '$' inside the span, this match crossed
    // multiple math regions and should be left unchanged.
    if (/(?<!\\)\$/.test(s)) {
      return _m;
    }
    if (classify(s)) {
      // Restore true inline math.
      return `$${s}$`;
    }
    // If this span includes prose, the consumed trailing '$' is likely
    // the start of the next math fragment (e.g., "... gave Sammy $t$ ...").
    if (/\s+[A-Za-z]{3,}/.test(s)) {
      return `\\$${s}$`;
    }
    // Treat as currency/amount text.
    return `\\$${s}`;
  });
  fixed = fixed.replace(/(?<!\\)\$(.+?)\\\$/g, (_m, seg) => {
    const s = String(seg || "").trim();
    // If there is another unescaped '$' inside the span, this match crossed
    // multiple math regions and should be left unchanged.
    if (/(?<!\\)\$/.test(s)) {
      return _m;
    }
    if (classify(s)) {
      return `$${s}$`;
    }
    return `\\$${s}\\$`;
  });
  return fixed;
}

function escapeDanglingDollarDelimiter(text) {
  const source = String(text || "");
  const positions = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === "$" && source[i - 1] !== "\\") {
      positions.push(i);
    }
  }
  if (positions.length % 2 === 0) return source;
  const last = positions[positions.length - 1];
  return `${source.slice(0, last)}\\$${source.slice(last + 1)}`;
}

function simplifyTrivialInlineMath(text) {
  const source = String(text || "");
  // If the prompt contains explicit LaTeX commands, keep inline delimiters
  // so MathJax can format mixed symbolic content consistently.
  if (/\\[A-Za-z]+/.test(source)) return source;
  return source.replace(/(?<!\\)\$([^$]+?)(?<!\\)\$/g, (full, inner) => {
    const token = String(inner || "").trim();
    if (!token) return full;
    if (/^[+-]?\d+(?:,\d{3})*(?:\.\d+)?$/.test(token)) return token;
    if (/^[A-Za-z](?:\d+)?$/.test(token)) return token;
    return full;
  });
}

function sanitizeForMathJax(text) {
  return String(
    simplifyTrivialInlineMath(
      escapeDanglingDollarDelimiter(
        escapeLikelyCurrencyDollars(
          wrapBareLatexSpans(
            repairBrokenDollarEscapes(
              normalizeUnsupportedLatexEnvironments(
                normalizeOcrMathPatterns(
                  normalizeUnicodeMathTokens(stripMathJaxWrappers(text))
                )
              )
            )
          )
        )
      )
    )
  )
    // Keep punctuation attached to the preceding token.
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/(?<=[A-Za-z])\\\$/g, " \\$")
    .replace(/([,.;:])\\\$/g, "$1 \\$")
    .replace(/(?<=[A-Za-z])\$(?=[A-Za-z\\0-9])/g, " $");
}

function canonicalizeRotblockerPreviewPath() {
  if (typeof window === "undefined") return;
  const pathname = String(window.location?.pathname || "");
  if (!/%2b/i.test(pathname)) return;

  const normalizedPath = pathname.replace(/%2B/gi, "+");
  if (normalizedPath === pathname) return;

  const history = window.history;
  if (!history || typeof history.replaceState !== "function") return;
  try {
    history.replaceState(
      history.state,
      "",
      `${normalizedPath}${window.location.search || ""}${window.location.hash || ""}`
    );
  } catch (_err) {
    // Ignore history updates blocked by the runtime.
  }
}

function isRotblockerPreviewPath(pathname) {
  const raw = String(pathname || "");
  const lower = raw.toLowerCase();
  if (lower.includes("/rotblocker++/") || lower.includes("/rotblocker%2b%2b/")) {
    return true;
  }
  try {
    return decodeURIComponent(raw).toLowerCase().includes("/rotblocker++/");
  } catch (_err) {
    return false;
  }
}

function resolveAssetPath(path) {
  const raw = String(path || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const inExtensionRuntime =
    typeof chrome !== "undefined" &&
    Boolean(chrome?.runtime?.id) &&
    typeof chrome?.runtime?.getURL === "function";
  if (inExtensionRuntime) {
    return chrome.runtime.getURL(raw.replace(/^\/+/, ""));
  }
  if (isRotblockerPreviewPath(window.location?.pathname || "")) {
    return `../${raw.replace(/^\/+/, "")}`;
  }
  return raw.replace(/^\/+/, "");
}

function applyDiagramSizing() {
  if (!diagramImgEl) return;
  const w = Number(diagramImgEl.naturalWidth || 0);
  const h = Number(diagramImgEl.naturalHeight || 0);
  diagramImgEl.classList.remove("diagram-tiny", "diagram-small", "diagram-wide", "diagram-tall");
  if (!w || !h) return;

  const maxDim = Math.max(w, h);
  const ratio = w / h;
  if (maxDim <= 36) {
    diagramImgEl.classList.add("diagram-tiny");
  } else if (maxDim <= 96) {
    diagramImgEl.classList.add("diagram-small");
  }
  if (ratio >= 3) diagramImgEl.classList.add("diagram-wide");
  if (ratio <= 0.45) diagramImgEl.classList.add("diagram-tall");
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

function applyStateFromPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  if (Object.prototype.hasOwnProperty.call(payload, "requiredScore")) {
    requiredScore = Number(payload.requiredScore || requiredScore);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "score")) {
    score = Number(payload.score || 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "xp")) {
    xp = Number(payload.xp || 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "prestige")) {
    prestige = Number(payload.prestige || 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "unlockedUntil")) {
    unlockedUntil = payload.unlockedUntil;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "unlockDurationMs")) {
    unlockDurationMs = Number(payload.unlockDurationMs || unlockDurationMs);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "lockoutCooldownMs")) {
    unlockDurationMs = Number(payload.lockoutCooldownMs || unlockDurationMs);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "stateUpdatedAt")) {
    stateUpdatedAt = Math.floor(Number(payload.stateUpdatedAt) || stateUpdatedAt || Date.now());
  }
}

function currentSyncState() {
  return {
    requiredScore,
    score,
    xp,
    prestige,
    unlockedUntil,
    lockoutCooldownMs: unlockDurationMs,
    unlockDurationMs,
    stateUpdatedAt
  };
}

function formatSyncAge(ts) {
  const stamp = Math.floor(Number(ts));
  if (!Number.isFinite(stamp) || stamp <= 0) return "--";
  const ageMs = Math.max(0, Date.now() - stamp);
  if (ageMs < 5000) return "just now";
  if (ageMs < 60 * 1000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60 * 1000) return `${Math.floor(ageMs / (60 * 1000))}m ago`;
  if (ageMs < 24 * 60 * 60 * 1000) return `${Math.floor(ageMs / (60 * 60 * 1000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d ago`;
}

function formatSyncMoment(ts) {
  const stamp = Math.floor(Number(ts));
  if (!Number.isFinite(stamp) || stamp <= 0) return "--";
  const localTime = new Date(stamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  return `${formatSyncAge(stamp)} (${localTime})`;
}

function applySyncDiagnostics(status) {
  if (!syncLastEl || !syncErrorEl || !syncStatusEl) return;
  const data = status && typeof status === "object" ? status : {};
  const available = Boolean(data.available);
  const pending = Boolean(data.pending);
  const lastSyncedAt = Math.floor(Number(data.lastSyncedAt));
  const errorText = String(data.lastError || "").trim();

  if (!available) {
    syncStatusEl.textContent = "Sync: unavailable";
    syncLastEl.textContent = "Last synced: unavailable";
    syncErrorEl.hidden = false;
    syncErrorEl.textContent = `Sync error: ${errorText || "Chrome profile sync unavailable."}`;
    return;
  }

  if (pending) {
    syncStatusEl.textContent = "Sync: queued";
  } else if (errorText) {
    syncStatusEl.textContent = "Sync: error";
  } else {
    syncStatusEl.textContent = "Sync: automatic (Chrome storage sync)";
  }

  if (Number.isFinite(lastSyncedAt) && lastSyncedAt > 0) {
    syncLastEl.textContent = `Last synced: ${formatSyncMoment(lastSyncedAt)}`;
  } else if (pending) {
    syncLastEl.textContent = "Last synced: pending first write";
  } else {
    syncLastEl.textContent = "Last synced: waiting for first write";
  }

  if (errorText) {
    syncErrorEl.hidden = false;
    syncErrorEl.textContent = `Sync error: ${errorText}`;
  } else {
    syncErrorEl.hidden = true;
    syncErrorEl.textContent = "";
  }
}

async function refreshSyncDiagnostics() {
  if (!syncStatusEl || !syncLastEl || !syncErrorEl) return;
  const status = await sendMessage({ type: "GET_SYNC_STATUS" });
  if (!status || !status.ok) {
    applySyncDiagnostics({
      available: false,
      pending: false,
      lastSyncedAt: null,
      lastError: "Could not read sync diagnostics."
    });
    return;
  }
  applySyncDiagnostics(status);
}

function renderSyncUi(statusText = null) {
  if (!syncStatusEl || !syncUserEl) return;
  const status = syncClient?.getStatus?.() || { enabled: false, signedIn: false, configError: "Sync unavailable." };
  const enabled = Boolean(status.enabled);
  const signedIn = Boolean(status.signedIn);
  const message = statusText
    || (enabled
      ? (signedIn ? "Sync: ready" : "Sync: sign in required")
      : `Sync: ${status.configError || "unavailable"}`);
  syncStatusEl.textContent = message;
  syncUserEl.textContent = signedIn ? `Account: ${status.email || status.uid}` : "Account: not signed in";
  if (syncSignInEl) syncSignInEl.disabled = !enabled || signedIn || syncBusy;
  if (syncSignOutEl) syncSignOutEl.disabled = !enabled || !signedIn || syncBusy;
  if (syncNowEl) syncNowEl.disabled = !enabled || !signedIn || syncBusy;
  if (syncBoxEl) syncBoxEl.style.display = "";
}

function scheduleCloudSync(delayMs = 1400) {
  void refreshSyncDiagnostics();
  if (!syncClient) return;
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }
  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = null;
    void runCloudSync("debounced");
  }, delayMs);
}

async function runCloudSync(reason = "auto", options = {}) {
  if (!syncClient) return;
  if (syncBusy && !options.force) return;
  syncBusy = true;
  renderSyncUi("Sync: working...");

  try {
    const stateRes = await sendMessage({ type: "GET_STATE" });
    if (!stateRes || !stateRes.ok) {
      throw new Error("Could not read local state for sync.");
    }
    applyStateFromPayload(stateRes);

    const result = await syncClient.syncState(currentSyncState());
    if (!result || !result.ok) {
      if (result?.code === "not_signed_in") {
        renderSyncUi("Sync: sign in required");
        if (options.manual) {
          setFeedback("Sign in to enable cloud sync.", false);
        }
        return;
      }
      throw new Error(result?.message || "Cloud sync failed.");
    }

    if (result.action === "apply_remote" && result.remoteState) {
      const applyRes = await sendMessage({ type: "APPLY_SYNC_STATE", state: result.remoteState });
      if (!applyRes || !applyRes.ok) {
        throw new Error("Failed to apply remote state.");
      }
      applyStateFromPayload(applyRes);
      render();
      renderLevelUi();
      renderSyncUi("Sync: pulled cloud state");
      if (options.manual) {
        setFeedback("Cloud state pulled to this device.", true);
      }
      return;
    }

    if (result.action === "pushed_local") {
      renderSyncUi("Sync: pushed local state");
      if (options.manual) {
        setFeedback("Local state pushed to cloud.", true);
      }
      return;
    }

    renderSyncUi("Sync: already up to date");
    if (options.manual) {
      setFeedback("Cloud and local state are in sync.", true);
    }
  } catch (err) {
    renderSyncUi("Sync: error");
    if (options.manual) {
      setFeedback(err instanceof Error ? err.message : "Cloud sync failed.", false);
    }
  } finally {
    syncBusy = false;
    renderSyncUi();
  }
}

async function initCloudSync() {
  if (!syncStatusEl || !syncUserEl) return;
  syncStatusEl.textContent = "Sync: automatic (Chrome storage sync)";
  syncUserEl.textContent = "Account: managed by your Chrome profile";
  if (syncLastEl) syncLastEl.textContent = "Last synced: waiting for first write";
  if (syncErrorEl) {
    syncErrorEl.hidden = true;
    syncErrorEl.textContent = "";
  }
  if (syncSignInEl) syncSignInEl.style.display = "none";
  if (syncSignOutEl) syncSignOutEl.style.display = "none";
  if (syncNowEl) syncNowEl.style.display = "none";
  await refreshSyncDiagnostics();
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
  }
  syncIntervalId = setInterval(() => {
    void refreshSyncDiagnostics();
  }, 5000);
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
    });
  }
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

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne(items) {
  return items[randomInt(0, items.length - 1)];
}

function weightedPick(weighted) {
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return weighted[weighted.length - 1].value;
}

function problemLooksRenderable(problem) {
  if (!problem) return false;
  const hasOddUnescapedDollar = (value) => {
    let count = 0;
    const source = String(value || "");
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === "$" && source[i - 1] !== "\\") count += 1;
    }
    return count % 2 === 1;
  };
  const hasBalancedDelimiters = (value) => {
    const source = String(value || "");
    return (
      (source.match(/\(/g) || []).length === (source.match(/\)/g) || []).length
      && (source.match(/\[/g) || []).length === (source.match(/\]/g) || []).length
      && (source.match(/\{/g) || []).length === (source.match(/\}/g) || []).length
    );
  };
  const hasSevereOcrNoise = (value) => /[]|(?:WARNING:)|(?:\blimx\b)|(?:\bidenity\b)|(?:\bEuqal\b)/i.test(String(value || ""));

  const prompt = sanitizeForMathJax(problem.prompt).trim();
  if (!prompt) return false;
  if (hasOddUnescapedDollar(prompt) || !hasBalancedDelimiters(prompt) || hasSevereOcrNoise(prompt)) return false;
  if (problem.type === "mcq") {
    if (!Array.isArray(problem.choices) || problem.choices.length !== 5) return false;
    const normalizedChoices = problem.choices.map((c) => sanitizeForMathJax(c).trim());
    if (normalizedChoices.some((c) => !c)) return false;
    if (normalizedChoices.some((c) => hasOddUnescapedDollar(c) || !hasBalancedDelimiters(c) || hasSevereOcrNoise(c))) return false;
    if (contestKey(problem) === "upper_level_mcq") {
      const greJoined = `${prompt} ${normalizedChoices.join(" ")}`;
      if (
        /(?:TRICKS INVOLVED|References?:|GO ON TO THE NEXT P ?AGE)/i.test(greJoined)
        || /\\pi\s+\d+\s+\d+/.test(greJoined)
        || /\\sqrt\{\d+\s+\d+\}/.test(greJoined)
        || /\b\d+\s+\d+\s+\d+\b/.test(greJoined)
      ) {
        return false;
      }
      const ambiguousFractionLike = normalizedChoices.filter((c) => /^[+-]?\s*(?:e|\\pi)?\s*\d+\s+\d+(?:\s+\d+)?\s*$/i.test(c)).length;
      if (ambiguousFractionLike >= 2) return false;
    }
  }
  return true;
}

function enabledPools() {
  return Object.keys(poolEnabled).filter((key) => poolEnabled[key] && poolAvailable[key]);
}

function poolDisplayName(key) {
  const names = {
    amc8: "AMC8",
    amc10: "AMC10",
    amc12: "AMC12",
    aime: "AIME",
    gre: "GRE",
    calculus: "Calculus"
  };
  return names[key] || String(key || "").toUpperCase();
}

function syncPoolChipUi() {
  poolChipEls.forEach((el) => {
    const key = String(el.dataset.pool || "");
    const available = Boolean(poolAvailable[key]);
    const on = Boolean(poolEnabled[key]);
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.setAttribute("aria-disabled", available ? "false" : "true");
    el.disabled = !available;
    if (!available) {
      el.title = `${poolDisplayName(key)} dataset unavailable`;
    } else {
      el.removeAttribute("title");
    }
  });
}

function initPoolChips() {
  syncPoolChipUi();
  poolChipEls.forEach((el) => {
    el.addEventListener("click", () => {
      const key = String(el.dataset.pool || "");
      if (!Object.prototype.hasOwnProperty.call(poolEnabled, key)) return;
      if (!poolAvailable[key]) {
        setFeedback(`${poolDisplayName(key)} dataset unavailable in this build.`, false);
        return;
      }
      const currentlyOn = Boolean(poolEnabled[key]);
      if (currentlyOn && enabledPools().length === 1) {
        setFeedback("Keep at least one problem pool enabled.", false);
        return;
      }
      poolEnabled[key] = !currentlyOn;
      syncPoolChipUi();
      setFeedback(`${poolDisplayName(key)} pool ${poolEnabled[key] ? "enabled" : "disabled"}.`, true);
      nextProblem();
      render();
    });
  });
}

function guessMultiplierNow() {
  const guessNumber = Math.min(mcqWrongGuesses + 1, 5);
  return scoringApi.guessMultiplier(guessNumber, GUESS_MULTIPLIERS);
}

function contestKey(problem) {
  if (!problem) return "amc10";
  if (problem.contest) {
    const key = String(problem.contest).toLowerCase();
    if (key === "upper_level_mcq") return "upper_level_mcq";
    if (key === "calculus") return "calculus";
    return key;
  }

  const label = String(problem.label || "").toLowerCase();
  if (label.includes("amc 8") || label.includes("amc8")) return "amc8";
  if (label.includes("amc 10") || label.includes("amc10")) return "amc10";
  if (label.includes("amc 12") || label.includes("amc12")) return "amc12";
  if (label.includes("aime")) return "aime";
  if (label.includes("gre")) return "upper_level_mcq";
  if (label.includes("calculus")) return "calculus";
  return "amc10";
}

function decayDurationNow() {
  const key = contestKey(currentProblem);
  return DECAY_DURATION_BY_CONTEST_MS[key] || 8 * 60 * 1000;
}

function baseWeightNow() {
  if (!currentProblem) return 0;
  const key = contestKey(currentProblem);
  return BASE_WEIGHT_BY_CONTEST[key] || Number(currentProblem.weight || 0);
}

function decayedBaseNow() {
  if (!currentProblem) return 0;
  if (contestKey(currentProblem) === "aime") return baseWeightNow();
  return scoringApi.decayedBasePoints(
    baseWeightNow(),
    Date.now() - problemStartMs,
    decayDurationNow()
  );
}

function pointsIfCorrectNow() {
  if (!currentProblem) return 0;
  const isAime = contestKey(currentProblem) === "aime";
  return scoringApi.pointsIfCorrectNow({
    baseWeight: baseWeightNow(),
    elapsedMs: isAime ? 0 : Date.now() - problemStartMs,
    durationMs: decayDurationNow(),
    hintUsed: false,
    isMcq: currentProblem.type === "mcq",
    wrongGuesses: mcqWrongGuesses,
    multipliers: GUESS_MULTIPLIERS
  });
}

function levelFromXp(totalXp) {
  const xpSafe = Math.max(0, Number(totalXp) || 0);
  const lvl = Math.floor(Math.sqrt(xpSafe / 25)) + 1;
  return Math.max(1, lvl);
}

function avatarTierFromLevel(level) {
  const lvl = Math.max(1, Number(level) || 1);
  if (lvl >= 10) return "legend";
  if (lvl >= 7) return "veteran";
  if (lvl >= 4) return "adept";
  return "rookie";
}

function avatarPrestigeTier(prestigeCount) {
  const p = Math.max(0, Number(prestigeCount) || 0);
  if (p >= 3) return 3;
  if (p >= 2) return 2;
  if (p >= 1) return 1;
  return 0;
}

function renderAvatarUi(level, prestigeCount) {
  if (!xpAvatarEl) return;
  const tier = avatarTierFromLevel(level);
  xpAvatarEl.classList.remove("avatar-rookie", "avatar-adept", "avatar-veteran", "avatar-legend");
  xpAvatarEl.classList.add(`avatar-${tier}`);

  const prestigeTier = avatarPrestigeTier(prestigeCount);
  xpAvatarEl.setAttribute("data-prestige", String(prestigeTier));
  xpAvatarEl.setAttribute("title", `Avatar tier: ${tier}${prestigeTier > 0 ? ` • prestige ${prestigeTier}` : ""}`);
}

function xpForLevel(level) {
  const l = Math.max(1, level);
  return 25 * (l - 1) * (l - 1);
}

function canPrestigeNow() {
  return levelFromXp(xp) >= 10;
}

function xpMultiplierFromPrestige() {
  return 1 + Math.max(0, Number(prestige) || 0) * 0.05;
}

function renderLevelUi() {
  if (!xpSummaryEl || !xpFillEl || !xpNextEl) return;
  const level = levelFromXp(xp);
  const currBase = xpForLevel(level);
  const nextBase = xpForLevel(level + 1);
  const inLevel = Math.max(0, xp - currBase);
  const span = Math.max(1, nextBase - currBase);
  const pct = Math.max(0, Math.min(100, (inLevel / span) * 100));

  xpSummaryEl.textContent = `Level ${level} • XP ${xp.toFixed(2)}`;
  xpFillEl.style.width = `${pct}%`;
  xpNextEl.textContent = `Next level in ${(nextBase - xp).toFixed(2)} XP`;
  if (prestigeSummaryEl) {
    prestigeSummaryEl.textContent = `Prestige ${prestige} • XP gain x${xpMultiplierFromPrestige().toFixed(2)}`;
  }
  if (prestigeBtnEl) {
    prestigeBtnEl.disabled = !canPrestigeNow();
  }
  renderAvatarUi(level, prestige);
}

function formatClock(ms) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function renderGlobalTimer() {
  if (!globalTimerEl) return;
  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  if (locked) {
    globalTimerEl.textContent = "Revalidation: required now";
    return;
  }

  const remaining = unlockedUntil - Date.now();
  globalTimerEl.textContent = `Revalidation in: ${formatClock(remaining)}`;
}

function renderLiveStats() {
  const hasPrestige = Math.max(0, Number(prestige) || 0) > 0;
  if (livePointsEl) livePointsEl.style.display = "";

  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  if (!locked || !currentProblem) {
    if (timerEl) timerEl.textContent = "Time: --";
    if (livePointsEl) livePointsEl.textContent = "Current Value: --";
    renderGlobalTimer();
    return;
  }

  if (timerEl) {
    if (contestKey(currentProblem) === "aime") {
      timerEl.textContent = "Decay: none (AIME)";
    } else {
      const remainingMs = Math.max(0, decayDurationNow() - (Date.now() - problemStartMs));
      const seconds = Math.ceil(remainingMs / 1000);
      timerEl.textContent = `Decay Timer: ${seconds}s`;
    }
  }

  if (livePointsEl) {
    const value = pointsIfCorrectNow().toFixed(2);
    livePointsEl.textContent = hasPrestige
      ? `Current Value: ${value} • XP x${xpMultiplierFromPrestige().toFixed(2)}`
      : `Current Value: ${value}`;
  }

  renderGlobalTimer();
}

async function fetchDataJson(name) {
  const paths = [
    resolveAssetPath(`data/${name}.json`),
    `../data/${name}.json`,
    `data/${name}.json`
  ];
  for (const p of Array.from(new Set(paths.filter(Boolean)))) {
    try {
      const res = await fetch(p, { cache: "no-store" });
      if (res.ok) return res.json();
    } catch (_err) {
      // Try the next candidate path.
    }
  }
  throw new Error(`Failed to load ${name}.json`);
}

async function loadBanks() {
  const failed = [];
  const loads = Object.entries(POOL_FILE_BY_KEY).map(async ([poolKey, fileKey]) => {
    try {
      const loaded = await fetchDataJson(fileKey);
      const rows = Array.isArray(loaded) ? loaded : [];
      const seen = new Set();
      const filtered = [];
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        if (!problemLooksRenderable(row)) continue;
        const dedupeKey = String(row.id || sanitizeForMathJax(row.prompt || "").toLowerCase());
        if (!dedupeKey || seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        filtered.push(row);
      }
      banks[poolKey] = filtered;
      poolAvailable[poolKey] = banks[poolKey].length > 0;
      if (!poolAvailable[poolKey]) {
        failed.push(poolDisplayName(poolKey));
      }
    } catch (_err) {
      banks[poolKey] = [];
      poolAvailable[poolKey] = false;
      failed.push(poolDisplayName(poolKey));
    }
    if (!poolAvailable[poolKey]) {
      poolEnabled[poolKey] = false;
    }
  });
  await Promise.all(loads);
  const availableCount = Object.keys(poolAvailable).filter((key) => poolAvailable[key]).length;
  if (availableCount === 0) {
    throw new Error("No problem datasets loaded.");
  }
  if (enabledPools().length === 0) {
    const firstAvailable = Object.keys(poolAvailable).find((key) => poolAvailable[key]);
    if (firstAvailable) poolEnabled[firstAvailable] = true;
  }
  return { failed };
}

function nextProblem() {
  currentProblem = buildNextProblemCandidate();

  if (!currentProblem) {
    setFeedback("No enabled problem pools with data.", false);
    return;
  }

  problemStartMs = Date.now();
  mcqWrongGuesses = 0;
  usedChoices = new Set();
  if (currentProblem.id) {
    recentProblemIds.push(currentProblem.id);
    if (recentProblemIds.length > RECENT_PROBLEM_LIMIT) {
      recentProblemIds.splice(0, recentProblemIds.length - RECENT_PROBLEM_LIMIT);
    }
  }
  renderProblem();
}

function buildNextProblemCandidate() {
  const candidates = enabledPools().filter((key) => Array.isArray(banks[key]) && banks[key].length > 0);
  if (candidates.length === 0) return null;

  const weighted = candidates.map((key) => ({ value: key, weight: poolWeights[key] || 1 }));
  let fallback = null;
  const attempts = Math.max(80, candidates.length * 20);
  for (let i = 0; i < attempts; i += 1) {
    const category = weightedPick(weighted);
    const pool = banks[category];
    if (!pool || pool.length === 0) continue;
    const candidate = pickOne(pool);
    if (!problemLooksRenderable(candidate)) continue;
    fallback = fallback || candidate;
    if (!candidate.id || !recentProblemIds.includes(candidate.id)) {
      return candidate;
    }
  }
  return fallback;
}

function setFeedback(text, ok) {
  if (!feedbackEl) return;
  feedbackEl.textContent = text;
  feedbackEl.className = `feedback ${ok ? "ok" : "bad"}`;
}

function renderProblem() {
  if (!currentProblem) return;

  if (metaEl) metaEl.textContent = `${currentProblem.label} • Base ${baseWeightNow()} points`;
  renderMathText(problemEl, sanitizeForMathJax(currentProblem.prompt));
  if (diagramWrapEl && diagramImgEl) {
    const sourceCandidates = [currentProblem.diagramPng, currentProblem.diagramSvg]
      .map((p) => resolveAssetPath(p))
      .filter(Boolean);
    if (sourceCandidates.length > 0) {
      diagramImgEl.classList.remove("diagram-tiny", "diagram-small", "diagram-wide", "diagram-tall");
      let srcIndex = 0;
      const setSource = () => {
        if (srcIndex >= sourceCandidates.length) {
          diagramImgEl.removeAttribute("src");
          diagramWrapEl.style.display = "none";
          return;
        }
        diagramImgEl.src = sourceCandidates[srcIndex];
      };
      diagramImgEl.onerror = () => {
        srcIndex += 1;
        setSource();
      };
      diagramImgEl.onload = () => {
        diagramImgEl.onerror = null;
        applyDiagramSizing();
      };
      diagramWrapEl.style.display = "block";
      setSource();
    } else {
      diagramImgEl.removeAttribute("src");
      diagramWrapEl.style.display = "none";
    }
  }
  if (currentProblem.type === "input") {
    if (formEl) formEl.style.display = "flex";
    if (choicesEl) {
      choicesEl.style.display = "none";
      choicesEl.innerHTML = "";
    }
    if (answerEl) {
      answerEl.value = "";
      answerEl.focus();
    }
  } else {
    if (formEl) formEl.style.display = "none";
    if (choicesEl) {
      choicesEl.style.display = "grid";
      choicesEl.innerHTML = "";
    }

    currentProblem.choices.forEach((choiceValue, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      const label = String.fromCharCode(65 + index);
      const normalizedChoice = normalizeChoiceMath(sanitizeForMathJax(choiceValue));
      renderMathText(btn, `${label}. ${normalizedChoice}`, { inlineOnly: true });
      btn.disabled = usedChoices.has(index);
      btn.addEventListener("click", () => {
        void handleMcqChoice(index);
      });
      if (choicesEl) choicesEl.appendChild(btn);
    });
  }

  renderLiveStats();
  renderLevelUi();
}

function render() {
  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  lastLockState = locked;

  if (locked) {
    if (statusEl) statusEl.textContent = `Score: ${score.toFixed(2)}/${requiredScore}`;
    if (quizEl) quizEl.style.display = "block";
    if (unlockBtn) {
      unlockBtn.disabled = score < requiredScore;
      unlockBtn.textContent = "Unlock Sites";
    }
  } else {
    if (statusEl) statusEl.textContent = `Unlocked for ${formatClock(unlockDurationMs)} total.`;
    if (quizEl) quizEl.style.display = "none";
    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.textContent = "Already Unlocked";
    }
  }

  renderLiveStats();
}

function tickUi() {
  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  if (lastLockState === null || locked !== lastLockState) {
    render();
    return;
  }
  renderLiveStats();
}

async function refreshState() {
  const state = await sendMessage({ type: "GET_STATE" });
  if (!state || !state.ok) {
    setFeedback("Could not load extension state.", false);
    return;
  }

  applyStateFromPayload(state);
  render();
  renderLevelUi();
}

async function awardPointsAndAdvance(points) {
  if (points <= 0) {
    setFeedback("Correct, but this question is worth +0 due to timer/guess penalties.", false);
    nextProblem();
    render();
    return;
  }

  const res = await sendMessage({ type: "ADD_SCORE", points });
  if (!res || !res.ok) {
    setFeedback("Could not record score.", false);
    return;
  }

  score = Number(res.score || 0);
  xp = Number(res.xp || xp);
  prestige = Number(res.prestige || prestige);
  stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
  setFeedback(`Correct. +${points.toFixed(2)} points.`, true);
  nextProblem();
  render();
  scheduleCloudSync();
}

async function handleMcqChoice(index) {
  if (!currentProblem || currentProblem.type !== "mcq") return;
  if (usedChoices.has(index)) return;

  const isCorrect = index === currentProblem.answerIndex;
  if (isCorrect) {
    await awardPointsAndAdvance(pointsIfCorrectNow());
    return;
  }

  usedChoices.add(index);
  mcqWrongGuesses += 1;

  const penalty = WRONG_GUESS_PENALTIES[mcqWrongGuesses] || 0;
  if (penalty > 0) {
    const res = await sendMessage({ type: "ADD_SCORE", points: -penalty });
    if (res && res.ok) {
      score = Number(res.score || score);
      xp = Number(res.xp || xp);
      prestige = Number(res.prestige || prestige);
      stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
      setFeedback(
        `Incorrect. -${penalty.toFixed(2)} points. Next correct guess multiplier: x${guessMultiplierNow()}.`,
        false
      );
      scheduleCloudSync();
    } else {
      setFeedback(`Incorrect. Next correct guess multiplier: x${guessMultiplierNow()}.`, false);
    }
  } else {
    setFeedback(`Incorrect. Next correct guess multiplier: x${guessMultiplierNow()}.`, false);
  }
  renderProblem();
  render();
}

function buildProblemContext() {
  if (!currentProblem) {
    return "No active problem yet.";
  }

  const parts = [
    `Problem label: ${currentProblem.label}`,
    `Problem type: ${currentProblem.type}`,
    `Prompt: ${sanitizeForMathJax(currentProblem.prompt)}`,
    `Base points: ${baseWeightNow()}`,
    `Time-decayed points now: ${pointsIfCorrectNow().toFixed(2)}`,
    `Wrong guesses so far: ${mcqWrongGuesses}`
  ];

  if (currentProblem.type === "mcq") {
    parts.push(`Choices: ${currentProblem.choices.map((v, i) => `${String.fromCharCode(65 + i)}. ${sanitizeForMathJax(v)}`).join(" | ")}`);
  }

  return parts.join("\n");
}

function isInputAnswerCorrect(submitted, problem) {
  if (!problem) return false;
  if (Array.isArray(problem.acceptableAnswers) && problem.acceptableAnswers.length > 0) {
    return problem.acceptableAnswers.some((v) => Number(v) === submitted);
  }
  return submitted === Number(problem.answer);
}

function appendChat(role, text) {
  if (!aiChatEl) return;
  const div = document.createElement("div");
  div.className = `chat-item ${role}`;
  const content = String(text || "");
  const roleLabel = role === "user" ? "YOU" : role === "assistant" ? "PoBot" : "System";

  const prefixEl = document.createElement("span");
  prefixEl.className = "chat-role-prefix";
  prefixEl.textContent = `${roleLabel}:`;
  div.appendChild(prefixEl);

  const bodyEl = document.createElement("span");
  bodyEl.className = "chat-message-body";
  const shouldRenderMarkdown = role === "assistant" && hasAssistantMarkdownSyntax(content);
  const shouldRenderMath =
    role === "assistant" &&
    /(?<!\\)\$|\\\(|\\\[|\\(?:frac|sqrt|cdot|times|otimes|sum|int|theta|alpha|beta|gamma|pi|leq|geq|left|right|begin|end|boxed|overline|underline)/.test(content);
  if (shouldRenderMarkdown) {
    renderAssistantMarkdownText(bodyEl, content);
  } else if (shouldRenderMath) {
    renderMathText(bodyEl, sanitizeForMathJax(content));
  } else {
    bodyEl.textContent = content;
  }
  div.appendChild(bodyEl);
  aiChatEl.appendChild(div);
  aiChatEl.scrollTop = aiChatEl.scrollHeight;
}

function appendChatLoading() {
  if (!aiChatEl || aiLoadingMessageEl) return;
  const div = document.createElement("div");
  div.className = "chat-item assistant chat-loading";
  div.setAttribute("aria-live", "polite");
  div.setAttribute("aria-label", "PoBot is thinking");

  const role = document.createElement("span");
  role.className = "chat-role-prefix chat-loading-role";
  role.textContent = "PoBot:";
  div.appendChild(role);

  const dots = document.createElement("span");
  dots.className = "chat-loading-dots";
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement("span");
    dot.className = "chat-loading-dot";
    dots.appendChild(dot);
  }
  div.appendChild(dots);

  aiChatEl.appendChild(div);
  aiChatEl.scrollTop = aiChatEl.scrollHeight;
  aiLoadingMessageEl = div;
}

function removeChatLoading() {
  if (aiLoadingMessageEl && typeof aiLoadingMessageEl.remove === "function") {
    aiLoadingMessageEl.remove();
  }
  aiLoadingMessageEl = null;
}

function setTutorSubmitLoading(loading) {
  const isLoading = Boolean(loading);
  if (!aiSubmitEl) return;
  aiSubmitEl.disabled = false;
  aiSubmitEl.classList.toggle("is-loading", isLoading);
  aiSubmitEl.classList.toggle("is-cancel", isLoading);
  if (isLoading) {
    aiSubmitEl.innerHTML = "<span class=\"ai-submit-text\">Cancel</span><span class=\"chat-loading-dots\" aria-hidden=\"true\"><span class=\"chat-loading-dot\"></span><span class=\"chat-loading-dot\"></span><span class=\"chat-loading-dot\"></span></span>";
    aiSubmitEl.setAttribute("aria-label", "Cancel request");
  } else {
    aiSubmitEl.textContent = "Ask Tutor";
    aiSubmitEl.setAttribute("aria-label", "Ask Tutor");
  }
}

function isAbortError(err) {
  if (!err) return false;
  const name = String(err.name || "");
  const message = String(err.message || "");
  return name === "AbortError" || /aborted|abort/i.test(message);
}

function extractApiErrorDetail(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    const fromError = parsed?.error;
    if (typeof fromError === "string" && fromError.trim()) {
      return fromError.trim();
    }
    const fromMessage = parsed?.error?.message || parsed?.message || parsed?.detail;
    if (typeof fromMessage === "string" && fromMessage.trim()) {
      return fromMessage.trim();
    }
  } catch (_err) {
    // Fallback to plain-text normalization.
  }
  return text.replace(/\s+/g, " ").trim();
}

function summarizeTutorHttpError(status, context = "chat") {
  if (status === 400) return "Invalid request sent to the AI provider.";
  if (status === 401 || status === 403) return "Authentication failed. Check provider and API token.";
  if (status === 404) {
    return context === "models"
      ? "Model catalog endpoint was not found."
      : "Selected model or endpoint was not found.";
  }
  if (status === 408) return "Provider timed out. Try again.";
  if (status === 429) return "Rate limit reached. Wait a moment and retry.";
  if (status >= 500) return "AI provider is temporarily unavailable.";
  return `AI provider returned HTTP ${status}.`;
}

function formatTutorError(err, context = "chat") {
  const fallbackSummary = context === "models" ? "Could not load models." : "Tutor request failed.";
  const raw = err instanceof Error ? String(err.message || "") : String(err || "");
  const msg = raw.trim();

  const apiPattern = /^(?:API error|Model fetch failed)\s+(\d+):\s*([\s\S]*)$/i;
  const matched = msg.match(apiPattern);
  if (matched) {
    const status = Number.parseInt(matched[1], 10);
    const detail = extractApiErrorDetail(matched[2]).slice(0, 240);
    return {
      summary: summarizeTutorHttpError(status, context),
      detail: detail || `HTTP ${status}`
    };
  }

  if (/network|failed to fetch|fetch failed|load failed/i.test(msg)) {
    return {
      summary: "Network error while contacting AI provider.",
      detail: msg || "Check connection and try again."
    };
  }

  if (!msg) {
    return {
      summary: fallbackSummary,
      detail: ""
    };
  }

  return {
    summary: fallbackSummary,
    detail: msg.slice(0, 240)
  };
}

function appendChatError(err, context = "chat") {
  if (!aiChatEl) return;
  const { summary, detail } = formatTutorError(err, context);

  const card = document.createElement("div");
  card.className = "chat-item system chat-error";

  const role = document.createElement("div");
  role.className = "chat-role-prefix chat-error-role";
  role.textContent = "PoBot:";
  card.appendChild(role);

  const label = document.createElement("div");
  label.className = "chat-error-label";
  label.textContent = context === "models" ? "Model Error" : "Tutor Error";
  card.appendChild(label);

  const summaryEl = document.createElement("div");
  summaryEl.className = "chat-error-summary";
  summaryEl.textContent = summary;
  card.appendChild(summaryEl);

  if (detail && detail !== summary) {
    const detailEl = document.createElement("div");
    detailEl.className = "chat-error-detail";
    detailEl.textContent = detail;
    card.appendChild(detailEl);
  }

  aiChatEl.appendChild(card);
  aiChatEl.scrollTop = aiChatEl.scrollHeight;
}

function getApiConfig() {
  if (!aiProviderEl || !aiModelEl || !aiTokenEl) return null;
  return {
    provider: normalizeAiProvider(aiProviderEl.value),
    model: aiModelEl.value.trim(),
    token: aiTokenEl.value.trim()
  };
}

function modelCacheKey(provider, token) {
  const suffix = (token || "").slice(-8) || "no_token";
  return `ai_models_cache_${provider}_${suffix}`;
}

function setModelOptions(models, selectedModel) {
  if (!aiModelEl) return;
  aiModelEl.innerHTML = "";
  const list = Array.isArray(models) ? models : [];
  const usable = list.length > 0 ? list : ["gpt-4o-mini"];
  usable.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    aiModelEl.appendChild(opt);
  });
  aiModelEl.value = usable.includes(selectedModel) ? selectedModel : usable[0];
}

async function fetchAndCacheModels(provider, token, force = false) {
  if (!provider || !token) {
    return ["gpt-4o-mini"];
  }

  const providerMeta = resolveAiProviderMeta(provider);
  const cacheKey = modelCacheKey(providerMeta.id, token);
  const cached = await getLocal([cacheKey]);
  const entry = cached?.[cacheKey];
  if (
    !force &&
    entry &&
    Array.isArray(entry.models) &&
    entry.models.length > 0 &&
    Number.isFinite(entry.fetchedAt) &&
    Date.now() - entry.fetchedAt < MODEL_CACHE_TTL_MS
  ) {
    return entry.models;
  }

  const url = providerMeta.modelsUrl;

  const headers = {
    Authorization: `Bearer ${token}`
  };
  if (providerMeta.includeOpenRouterHeaders) {
    headers["HTTP-Referer"] = chromeApi.runtime.getURL("rotblocker++/index.html");
    headers["X-Title"] = "rotblocker++";
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Model fetch failed ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = await res.json();
  const raw = Array.isArray(json?.data) ? json.data : [];
  const models = raw
    .map((m) => String(m?.id || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  if (models.length === 0) {
    return ["gpt-4o-mini"];
  }

  await setLocal({
    [cacheKey]: {
      models,
      fetchedAt: Date.now()
    }
  });
  return models;
}

async function saveAiConfig() {
  const cfg = getApiConfig();
  if (!cfg) return;
  const payload = {
    provider: cfg.provider,
    model: cfg.model,
    token: cfg.token
  };
  await setLocal({
    ai_config: payload
  });
  const synced = await setSync({ ai_config: payload });
  if (synced) {
    appendChat("system", "Saved API settings.");
  } else {
    appendChat("system", "Saved API settings locally. Profile sync unavailable.");
  }
}

async function loadAiConfig() {
  if (!aiProviderEl || !aiModelEl || !aiTokenEl) return;
  const [syncOut, localOut] = await Promise.all([
    getSync(["ai_config"]),
    getLocal(["ai_config"])
  ]);
  const syncCfg = syncOut?.ai_config;
  const localCfg = localOut?.ai_config;
  const cfg = (syncCfg && typeof syncCfg === "object")
    ? syncCfg
    : ((localCfg && typeof localCfg === "object") ? localCfg : null);

  if (cfg && typeof cfg === "object") {
    // Keep local storage warm for extension startup and local preview mode.
    await setLocal({ ai_config: cfg });
    // One-time migration for existing local-only tokens into synced profile storage.
    if (!syncCfg) {
      await setSync({ ai_config: cfg });
    }
  }

  let preferredModel = "gpt-4o-mini";
  if (cfg && typeof cfg === "object") {
    const provider = normalizeAiProvider(cfg.provider || AI_PROVIDER_OPENAI);
    aiProviderEl.value = provider;
    preferredModel = cfg.model || "gpt-4o-mini";
    aiTokenEl.value = cfg.token || "";
  }

  try {
    const models = await fetchAndCacheModels(aiProviderEl.value, aiTokenEl.value, false);
    setModelOptions(models, preferredModel);
  } catch (_err) {
    setModelOptions(["gpt-4o-mini"], preferredModel);
  }
}

async function callTutor(userText, signal = undefined) {
  const cfg = getApiConfig();
  if (!cfg || !cfg.token || !cfg.model) {
    throw new Error("Set provider/model/token first.");
  }

  const providerMeta = resolveAiProviderMeta(cfg.provider);
  const url = providerMeta.chatUrl;

  const messages = [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    { role: "system", content: `Current problem context:\n${buildProblemContext()}` },
    ...aiHistory.slice(-8),
    { role: "user", content: userText }
  ];

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.token}`
  };

  if (providerMeta.includeOpenRouterHeaders) {
    headers["HTTP-Referer"] = chromeApi.runtime.getURL("rotblocker++/index.html");
    headers["X-Title"] = "rotblocker++";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.4
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text.slice(0, 180)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No assistant message returned.");
  }
  return String(content);
}

async function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  if (themeToggleEl) {
    themeToggleEl.textContent = isDark ? "Light mode" : "Dark mode";
  }
}

async function initTheme() {
  const { ui_theme: storedTheme } = await getLocal(["ui_theme"]);
  if (storedTheme === "dark" || storedTheme === "light") {
    await applyTheme(storedTheme);
  } else {
    const prefersDark = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    await applyTheme(prefersDark ? "dark" : "light");
  }

  if (themeToggleEl) {
    themeToggleEl.addEventListener("click", () => {
      const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
      void applyTheme(next);
      void setLocal({ ui_theme: next });
    });
  }
}

function initTutorUi() {
  if (!aiSystemEl || !aiFormEl || !aiInputEl) return;
  aiSystemEl.value = DEFAULT_SYSTEM_PROMPT;

  void loadAiConfig();
  appendChat("system", "Tutor ready. Ask for intuition, patterns, and next steps.");
  setTutorSubmitLoading(false);

  if (aiSaveEl) {
    aiSaveEl.addEventListener("click", () => {
      void (async () => {
        try {
          const cfg = getApiConfig();
          if (cfg?.token) {
            const models = await fetchAndCacheModels(cfg.provider, cfg.token, false);
            setModelOptions(models, cfg.model);
          }
          await saveAiConfig();
        } catch (err) {
          appendChatError(err, "models");
        }
      })();
    });
  }

  if (aiRefreshModelsEl) {
    aiRefreshModelsEl.addEventListener("click", () => {
      void (async () => {
        const cfg = getApiConfig();
        if (!cfg?.token) {
          appendChat("system", "Enter an API token first to fetch models.");
          return;
        }
        try {
          const models = await fetchAndCacheModels(cfg.provider, cfg.token, true);
          setModelOptions(models, cfg.model);
          appendChat("system", `Loaded ${models.length} models from ${cfg.provider}.`);
        } catch (err) {
          appendChatError(err, "models");
        }
      })();
    });
  }

  if (aiProviderEl) {
    aiProviderEl.addEventListener("change", () => {
      void (async () => {
        const cfg = getApiConfig();
        if (!cfg?.token) {
          setModelOptions(["gpt-4o-mini"], "gpt-4o-mini");
          return;
        }
        try {
          const models = await fetchAndCacheModels(cfg.provider, cfg.token, false);
          setModelOptions(models, cfg.model);
        } catch (err) {
          appendChatError(err, "models");
          setModelOptions(["gpt-4o-mini"], cfg.model);
        }
      })();
    });
  }

  aiFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    if (aiBusy) {
      if (!aiAbortController) return;
      try {
        aiAbortController.abort();
      } catch (_err) {
        // Ignore abort errors from non-standard runtimes.
      }
      return;
    }

    const text = aiInputEl.value.trim();
    if (!text) return;

    aiInputEl.value = "";
    appendChat("user", text);

    aiBusy = true;
    aiInputEl.disabled = true;
    setTutorSubmitLoading(true);
    appendChatLoading();
    aiAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;

    void (async () => {
      try {
        const answer = await callTutor(text, aiAbortController?.signal);
        aiHistory.push({ role: "user", content: text });
        aiHistory.push({ role: "assistant", content: answer });
        removeChatLoading();
        appendChat("assistant", answer);
      } catch (err) {
        removeChatLoading();
        if (isAbortError(err)) {
          appendChat("system", "Request canceled.");
        } else {
          appendChatError(err, "chat");
        }
      } finally {
        removeChatLoading();
        aiAbortController = null;
        aiBusy = false;
        aiInputEl.disabled = false;
        setTutorSubmitLoading(false);
        aiInputEl.focus();
      }
    })();
  });
}

if (formEl) {
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentProblem || currentProblem.type !== "input") return;

    const submitted = Number(answerEl?.value);
    if (!Number.isFinite(submitted)) {
      setFeedback("Enter a valid number.", false);
      return;
    }

    if (!isInputAnswerCorrect(submitted, currentProblem)) {
      setFeedback("Incorrect. Next question.", false);
      nextProblem();
      render();
      return;
    }

    void awardPointsAndAdvance(pointsIfCorrectNow());
  });
}

if (rerollBtnEl) {
  rerollBtnEl.addEventListener("click", () => {
    const locked = !unlockedUntil || unlockedUntil <= Date.now();
    if (!locked) {
      setFeedback("Reroll is available while challenge mode is active.", false);
      return;
    }
    if (Date.now() < rerollLockedUntil) return;
    rerollLockedUntil = Date.now() + 350;
    rerollBtnEl.disabled = true;
    nextProblem();
    setFeedback("Rerolled. No score change.", true);
    setTimeout(() => {
      rerollBtnEl.disabled = false;
    }, 350);
  });
}

if (prestigeBtnEl) {
  prestigeBtnEl.addEventListener("click", async () => {
    if (!canPrestigeNow()) {
      setFeedback("Reach level 10 to prestige.", false);
      return;
    }
    const confirmed = window.confirm("Prestige now? This resets current XP and score to 0.");
    if (!confirmed) return;

    const res = await sendMessage({ type: "PRESTIGE" });
    if (!res || !res.ok) {
      setFeedback(res?.error || "Prestige failed.", false);
      return;
    }

    prestige = Number(res.prestige || prestige + 1);
    xp = Number(res.xp || 0);
    score = Number(res.score || 0);
    stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
    setFeedback(`Prestige ${prestige} unlocked. XP gain is now x${xpMultiplierFromPrestige().toFixed(2)}.`, true);
    render();
    renderLevelUi();
    scheduleCloudSync();
  });
}


if (unlockBtn) {
  unlockBtn.addEventListener("click", async () => {
    const res = await sendMessage({ type: "REQUEST_UNLOCK" });
    if (!res || !res.ok) {
      setFeedback(res?.error || "Unlock failed.", false);
      return;
    }

    unlockedUntil = res.unlockedUntil;
    if (Object.prototype.hasOwnProperty.call(res, "unlockDurationMs")) {
      unlockDurationMs = Number(res.unlockDurationMs || unlockDurationMs);
    }
    if (Object.prototype.hasOwnProperty.call(res, "lockoutCooldownMs")) {
      unlockDurationMs = Number(res.lockoutCooldownMs || unlockDurationMs);
    }
    stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
    score = 0;
    setFeedback(`Unlocked. Doomscroll timer started (${formatClock(unlockDurationMs)}).`, true);
    render();
    scheduleCloudSync();
  });
}

if (relockBtn) {
  relockBtn.addEventListener("click", async () => {
    const res = await sendMessage({ type: "RELOCK" });
    if (!res || !res.ok) {
      setFeedback("Could not re-lock sites.", false);
      return;
    }

    unlockedUntil = null;
    score = 0;
    stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
    setFeedback("Sites locked again.", true);
    nextProblem();
    render();
    scheduleCloudSync();
  });
}

canonicalizeRotblockerPreviewPath();
setInterval(tickUi, 250);

(async function init() {
  let loadResult = { failed: [] };
  try {
    loadResult = await loadBanks();
  } catch (_err) {
    setFeedback("Failed to load problem datasets.", false);
    return;
  }

  await initTheme();
  await initTutorVisibility();
  await initXpPanelVisibility();
  initPoolChips();
  initDomainSettingsUi();
  initTutorUi();
  await refreshState();
  await initCloudSync();
  nextProblem();
  if (Array.isArray(loadResult.failed) && loadResult.failed.length > 0) {
    setFeedback(`Unavailable pools: ${loadResult.failed.join(", ")}.`, false);
  }
})();
