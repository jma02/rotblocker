const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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

test("calculus dataset is diverse and renderable by sanitizer + MathJax", async () => {
  const rows = JSON.parse(fs.readFileSync("data/calculus_mcq_synthetic.json", "utf8"));
  const mathjaxApi = await mathJaxReady;
  const adaptor = mathjaxApi.startup.adaptor;
  const failures = [];
  const topicCounts = {};
  let definiteIntegrals = 0;
  let indefiniteIntegrals = 0;
  let plotRows = 0;
  let plotRowsWithDiagram = 0;

  for (const row of rows) {
    topicCounts[row.topic] = (topicCounts[row.topic] || 0) + 1;
    if (row.topic === "plot_interpretation") {
      plotRows += 1;
      if (typeof row.diagramSvg === "string") {
        const fullPath = path.resolve(row.diagramSvg);
        if (fs.existsSync(fullPath)) {
          const svg = fs.readFileSync(fullPath, "utf8");
          if (/<svg[\s>]/i.test(svg)) {
            plotRowsWithDiagram += 1;
          }
        }
      }
    }
    if (row.topic === "integration") {
      const p = String(row.prompt || "");
      if (/\\int\s*_/.test(p) || /\\int_\{/.test(p)) {
        definiteIntegrals += 1;
      } else if (/\\int/.test(p) || /antiderivative/i.test(p)) {
        indefiniteIntegrals += 1;
      }
    }

    const prompt = sanitizeForMathJax(row.prompt).trim();
    const choices = row.choices.map((choice) => normalizeChoiceMath(sanitizeForMathJax(choice)).trim());
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

  assert.ok(rows.length >= 300, `expected at least 300 calculus rows, got ${rows.length}`);
  assert.ok((topicCounts.integration || 0) >= 60, `expected >=60 integration rows, got ${topicCounts.integration || 0}`);
  assert.ok(plotRows >= 30, `expected >=30 plot rows, got ${plotRows}`);
  assert.ok(plotRowsWithDiagram >= 30, `expected >=30 plot rows with valid svg, got ${plotRowsWithDiagram}`);
  assert.ok(definiteIntegrals >= 20, `expected >=20 definite integral prompts, got ${definiteIntegrals}`);
  assert.ok(indefiniteIntegrals >= 20, `expected >=20 indefinite integral prompts, got ${indefiniteIntegrals}`);
  assert.equal(
    failures.length,
    0,
    `Found non-renderable calculus rows:\n${failures.slice(0, 20).join("\n")}`
  );
});
