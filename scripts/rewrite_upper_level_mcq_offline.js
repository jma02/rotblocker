#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const INPUT = path.join(ROOT, "data", "upper_level_mcq.json");
const REPORT = path.join(ROOT, "data", "upper_level_mcq_rewrite_report.json");
const ARTIFACT_PATTERNS = [
  /\\\$/,
  /\$\$/,
  /\$\\sum\s*\$/i,
  /\\sum\s*\$\\infty/i,
  /\\int\s*\$\\infty/i,
  /\$\\infty\$\s*[A-Za-z0-9]/i,
  /Euclidean Geometry and Miscellaneous Problems/i,
  /\bSTOP If you finished before time is called\b/i,
  /\bas defined above\b/i,
  /\+b\s*3\$?\\sqrt\{?4\}?/i,
  /^\s*A positive number less than\s*$/i,
  /^\s*A finite number greater than\s*$/i
];
const LOW_CONFIDENCE_WORDS_RE = /\b(?:soultions|mininimum|diagonlizable|maxi-\s*mum|determinate|idenity|Euqal|Fow|cordinate)\b/i;
const TOKENIZED_DENOMINATOR_RE = /[A-Za-z)\]}](?:\^[0-9]+)?\s+[0-9](?:\b|[^A-Za-z])/;

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

function loadChallengeFns() {
  const source = fs.readFileSync(path.join(ROOT, "challenge.js"), "utf8");
  const document = {
    getElementById() { return makeElementStub(); },
    querySelector() { return makeElementStub(); },
    querySelectorAll() { return []; },
    addEventListener() {},
    createElement() { return makeElementStub(); }
  };
  const window = {
    location: { pathname: "/rotblocker++/index.html", search: "", hash: "" },
    history: { state: null, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    matchMedia() {
      return { matches: false, addEventListener() {}, removeEventListener() {} };
    }
  };
  const localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const chrome = {
    storage: { local: { get(_key, cb) { cb({}); }, set(_value, cb) { if (cb) cb(); } } },
    runtime: { id: "offline-rewrite", getURL(p) { return p; } }
  };
  const sandbox = {
    console,
    document,
    window,
    localStorage,
    chrome,
    MathJax: { typesetPromise: () => Promise.resolve() },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {}
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${source}
;globalThis.__rewriteFns = {
  sanitizeForMathJax,
  normalizeChoiceMath,
  hasRenderableMathSyntax,
  problemLooksRenderable
};`,
    sandbox
  );
  return sandbox.__rewriteFns;
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function extractMathSegments(text) {
  const source = String(text || "");
  const pattern = /\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$(?:\\.|[^\\$\n])+\$/g;
  const segments = [];
  let match;
  while ((match = pattern.exec(source)) !== null) {
    segments.push(match[0]);
  }
  return segments;
}

function segmentToTex(segment) {
  const source = String(segment || "");
  if (source.startsWith("$$") && source.endsWith("$$")) {
    return { tex: source.slice(2, -2), display: true };
  }
  if (source.startsWith("$") && source.endsWith("$")) {
    return { tex: source.slice(1, -1), display: false };
  }
  if (source.startsWith("\\[") && source.endsWith("\\]")) {
    return { tex: source.slice(2, -2), display: true };
  }
  if (source.startsWith("\\(") && source.endsWith("\\)")) {
    return { tex: source.slice(2, -2), display: false };
  }
  return { tex: source, display: false };
}

function mathJaxRenderableText(text, hasRenderableMathSyntax, mathjaxApi, adaptor) {
  const source = String(text || "").trim();
  if (!source) return { ok: false, reason: "empty_text" };

  const segments = extractMathSegments(source);
  if (hasRenderableMathSyntax(source) && segments.length === 0) {
    return { ok: false, reason: "math_without_delimiters" };
  }

  for (const segment of segments) {
    const { tex, display } = segmentToTex(segment);
    let html = "";
    try {
      html = adaptor.outerHTML(mathjaxApi.tex2svg(tex, { display }));
    } catch (_err) {
      return { ok: false, reason: "mathjax_throw" };
    }
    if (/data-mjx-error|mjx-merror/i.test(html)) {
      return { ok: false, reason: "mathjax_merror" };
    }
  }
  return { ok: true };
}

function normalizeRow(row, fns, mathjaxApi, adaptor) {
  const {
    sanitizeForMathJax,
    normalizeChoiceMath,
    hasRenderableMathSyntax,
    problemLooksRenderable
  } = fns;
  if (!row || typeof row !== "object") return { drop: "row_not_object" };
  if (!Array.isArray(row.choices) || row.choices.length !== 5) return { drop: "choices_shape" };
  if (!Number.isInteger(row.answerIndex) || row.answerIndex < 0 || row.answerIndex > 4) {
    return { drop: "answer_index" };
  }

  const out = clone(row);
  out.prompt = sanitizeForMathJax(out.prompt).trim();
  out.choices = out.choices.map((c) => normalizeChoiceMath(sanitizeForMathJax(c)).trim());
  if (!out.prompt) return { drop: "empty_prompt" };
  if (out.choices.some((c) => !c)) return { drop: "empty_choice" };
  if (new Set(out.choices).size < 5) return { drop: "duplicate_choices" };

  out.answerKey = "ABCDE"[out.answerIndex];
  out.answer = out.choices[out.answerIndex];

  if (!problemLooksRenderable(out)) return { drop: "not_renderable" };

  const joined = `${out.prompt} ${out.choices.join(" ")}`;
  if (ARTIFACT_PATTERNS.some((re) => re.test(joined))) {
    return { drop: "artifact_pattern" };
  }
  const texts = [out.prompt, ...out.choices];
  if (texts.some((t) => /\s\d{2}\s*$/.test(t))) {
    return { drop: "scan_page_suffix" };
  }
  if (texts.some((t) => LOW_CONFIDENCE_WORDS_RE.test(t))) {
    return { drop: "ocr_wording" };
  }
  if (out.choices.some((c) => TOKENIZED_DENOMINATOR_RE.test(c) && !/(\\frac|\/)/.test(c))) {
    return { drop: "ambiguous_math_tokenization" };
  }

  const promptRenderable = mathJaxRenderableText(
    out.prompt,
    hasRenderableMathSyntax,
    mathjaxApi,
    adaptor
  );
  if (!promptRenderable.ok) return { drop: promptRenderable.reason };
  for (const choice of out.choices) {
    const choiceRenderable = mathJaxRenderableText(
      choice,
      hasRenderableMathSyntax,
      mathjaxApi,
      adaptor
    );
    if (!choiceRenderable.ok) return { drop: choiceRenderable.reason };
  }

  return { row: out };
}

async function main() {
  const fns = loadChallengeFns();
  const mathjaxApi = await require("mathjax/es5/node-main.js").init({
    loader: { load: ["input/tex", "output/svg"] }
  });
  const adaptor = mathjaxApi.startup.adaptor;
  const inputRows = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const reasons = new Map();
  const keep = [];
  const droppedExamples = [];
  const seenPrompt = new Set();

  const bump = (reason) => reasons.set(reason, (reasons.get(reason) || 0) + 1);

  for (const row of inputRows) {
    const result = normalizeRow(row, fns, mathjaxApi, adaptor);
    if (result.drop) {
      bump(result.drop);
      if (droppedExamples.length < 40) {
        droppedExamples.push({ id: row?.id || null, reason: result.drop });
      }
      continue;
    }
    const cleaned = result.row;
    const dedupeKey = cleaned.prompt.toLowerCase();
    if (seenPrompt.has(dedupeKey)) {
      bump("duplicate_prompt");
      if (droppedExamples.length < 40) {
        droppedExamples.push({ id: cleaned.id || null, reason: "duplicate_prompt" });
      }
      continue;
    }
    seenPrompt.add(dedupeKey);
    keep.push(cleaned);
  }

  keep.sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")));
  fs.writeFileSync(INPUT, `${JSON.stringify(keep, null, 2)}\n`, "utf8");

  const bySource = {};
  for (const row of keep) {
    const src = String(row?.source?.dataset || "unknown");
    bySource[src] = (bySource[src] || 0) + 1;
  }

  const report = {
    rewrittenAt: new Date().toISOString(),
    inputCount: inputRows.length,
    keptCount: keep.length,
    droppedCount: inputRows.length - keep.length,
    droppedReasons: Object.fromEntries(Array.from(reasons.entries()).sort((a, b) => b[1] - a[1])),
    keptBySource: bySource,
    droppedExamples
  };
  fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log("Rewrote data/upper_level_mcq.json");
  console.log(`Kept ${keep.length}/${inputRows.length}`);
  console.log("By source:", bySource);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
