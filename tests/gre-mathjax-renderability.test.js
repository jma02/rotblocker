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
    if (/data-mjx-error|mjx-merror/i.test(html)) {
      return { ok: false, reason: "mathjax_merror", segment };
    }
  }
  return { ok: true };
}

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
