const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadChallengeFns } = require("./challenge-harness");

const {
  sanitizeForMathJax,
  normalizeChoiceMath,
  hasRenderableMathSyntax,
  problemLooksRenderable
} = loadChallengeFns();

const mathJaxReady = require("mathjax/es5/node-main.js").init({
  loader: { load: ["input/tex", "output/svg"] }
});
const GRE_SANITY_BANS = [
  /\bSTOP If you finished before time is called\b/i,
  /\bNone\s+(Combinatorics|Algebra|Analysis|Topology|Geometry|Probability)\b/i,
  /\bf-1\s*\(/,
  /\bAo\b/,
  /\bAc\b/,
  /\baxa2\b/,
  /\b[A-Z]n\s*=\s*Id\b/,
  /\bhasatleastoneroot\b/i,
  /\boaixi\b/i,
  /\baixi\b/i,
  /\bC\d+e[txyz]\b/,
  /\bt\d+e[txyz]\b/,
  /\but-uux\s*=\s*0\b/i,
  /\bux-u2ut\s*=\s*0\b/i,
  /\bux\s*\+tut\s*=\s*0\b/i,
  /\but\s*\+ux\(ut\)2\s*=\s*0\b/i,
  /\but\s*\+uux\s*=\s*0\b/i
];

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
  if (source.startsWith("$$") && source.endsWith("$$")) return { tex: source.slice(2, -2), display: true };
  if (source.startsWith("$") && source.endsWith("$")) return { tex: source.slice(1, -1), display: false };
  if (source.startsWith("\\[") && source.endsWith("\\]")) return { tex: source.slice(2, -2), display: true };
  if (source.startsWith("\\(") && source.endsWith("\\)")) return { tex: source.slice(2, -2), display: false };
  return { tex: source, display: false };
}

function compileTextWithMathJax(text, mathjaxApi, adaptor) {
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
      return { ok: false, reason: "mathjax_throw", segment };
    }
    if (
      /data-mjx-error|mjx-merror|data-mml-node="mtext"[^>]*(?:fill|stroke)="red"/i.test(
        html
      )
    ) {
      return { ok: false, reason: "mathjax_merror", segment };
    }
  }
  return { ok: true };
}

test("GRE dataset has curated coverage, provenance, and balanced answers", () => {
  const rows = JSON.parse(fs.readFileSync("data/upper_level_mcq.json", "utf8"));
  assert.equal(rows.length, 80, "GRE bank size must remain intentionally curated");

  const ids = new Set();
  const prompts = new Set();
  const topicCounts = new Map();
  const answerCounts = [0, 0, 0, 0, 0];

  for (const row of rows) {
    assert.equal(row.type, "mcq", `${row.id}: expected mcq type`);
    assert.equal(row.contest, "upper_level_mcq", `${row.id}: wrong contest`);
    assert.ok(!ids.has(row.id), `${row.id}: duplicate id`);
    ids.add(row.id);

    const normalizedPrompt = String(row.prompt || "").replace(/\s+/g, " ").trim().toLowerCase();
    assert.ok(normalizedPrompt, `${row.id}: empty prompt`);
    assert.ok(!prompts.has(normalizedPrompt), `${row.id}: duplicate prompt`);
    prompts.add(normalizedPrompt);

    assert.notEqual(row.topic, "other_upper_level", `${row.id}: topic must be specific`);
    topicCounts.set(row.topic, (topicCounts.get(row.topic) || 0) + 1);
    assert.equal(row.choices.length, 5, `${row.id}: expected five choices`);
    assert.equal(new Set(row.choices.map((choice) => String(choice).trim())).size, 5, `${row.id}: choices must be unique`);
    assert.ok(Number.isInteger(row.answerIndex) && row.answerIndex >= 0 && row.answerIndex < 5, `${row.id}: invalid answerIndex`);
    assert.equal(row.answer, row.choices[row.answerIndex], `${row.id}: answer text does not match answerIndex`);
    assert.equal(row.answerKey, "ABCDE"[row.answerIndex], `${row.id}: answerKey does not match answerIndex`);
    answerCounts[row.answerIndex] += 1;
    assert.ok(row.source && row.source.dataset, `${row.id}: missing source dataset`);
  }

  const requiredTopicMinima = {
    calculus: 3,
    multivariable_calculus: 3,
    real_analysis: 3,
    complex_analysis: 3,
    linear_algebra: 3,
    abstract_algebra: 3,
    number_theory: 3,
    topology: 3,
    combinatorics: 3,
    probability: 3,
    foundations: 3
  };
  for (const [topic, minimum] of Object.entries(requiredTopicMinima)) {
    assert.ok((topicCounts.get(topic) || 0) >= minimum, `${topic}: expected at least ${minimum} rows`);
  }

  const originals = rows.filter((row) => row.source.dataset === "rotblocker_original_gre_v1");
  assert.equal(originals.length, 36, "expected 36 independently authored GRE-style questions");
  for (const row of originals) {
    assert.equal(row.source.authoring, "original", `${row.id}: missing original-authoring marker`);
    assert.ok(String(row.source.verification || "").trim(), `${row.id}: missing answer verification`);
    assert.ok(String(row.source.concept || "").trim(), `${row.id}: missing concept metadata`);
    assert.ok(["easy", "medium", "hard"].includes(row.source.difficulty), `${row.id}: invalid difficulty`);
  }

  for (let index = 0; index < answerCounts.length; index += 1) {
    assert.ok(answerCounts[index] >= 12 && answerCounts[index] <= 20, `answer ${"ABCDE"[index]} is over- or under-represented`);
  }
});

test("GRE dataset rows are renderable by frontend sanitizer + MathJax", async () => {
  const rows = JSON.parse(fs.readFileSync("data/upper_level_mcq.json", "utf8"));
  const mathjaxApi = await mathJaxReady;
  const adaptor = mathjaxApi.startup.adaptor;
  const failures = [];

  for (const row of rows) {
    const prompt = sanitizeForMathJax(row.prompt).trim();
    const choices = row.choices.map((choice) => normalizeChoiceMath(sanitizeForMathJax(choice)).trim());
    const joined = `${prompt} ${choices.join(" ")}`;
    for (const ban of GRE_SANITY_BANS) {
      if (ban.test(joined)) {
        failures.push(`${row.id}: banned artifact ${ban}`);
        break;
      }
    }
    const normalized = {
      ...row,
      type: "mcq",
      prompt,
      choices
    };

    if (!problemLooksRenderable(normalized)) {
      failures.push(`${row.id}: failed problemLooksRenderable`);
      continue;
    }

    const promptCheck = compileTextWithMathJax(prompt, mathjaxApi, adaptor);
    if (!promptCheck.ok) {
      failures.push(`${row.id}: prompt ${promptCheck.reason}`);
      continue;
    }
    let choiceFailed = false;
    for (let i = 0; i < choices.length; i += 1) {
      const choiceCheck = compileTextWithMathJax(choices[i], mathjaxApi, adaptor);
      if (!choiceCheck.ok) {
        failures.push(`${row.id}: choice ${i} ${choiceCheck.reason}`);
        choiceFailed = true;
        break;
      }
    }
    if (choiceFailed) continue;
  }

  assert.equal(
    failures.length,
    0,
    `Found non-renderable GRE rows:\n${failures.slice(0, 20).join("\n")}`
  );
});
