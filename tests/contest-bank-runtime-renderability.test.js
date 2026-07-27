const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadChallengeFns } = require("./challenge-harness");
const { runAudit } = require("../scripts/audit_problem_markup");

const fns = loadChallengeFns();
const mathJaxReady = require("mathjax/es5/node-main.js").init({
  loader: { load: ["input/tex", "output/svg"] }
});

const BANKS = [
  "amc8",
  "amc10",
  "amc12",
  "aime",
  "upper_level_mcq",
  "calculus_mcq_synthetic"
];
const REVIEWED_MISSING_VISUAL_IDS = JSON.parse(
  fs.readFileSync("data/reviewed_missing_visuals.json", "utf8")
).ids;

function segmentToTex(segment) {
  const source = String(segment || "");
  if (source.startsWith("$$")) return source.slice(2, -2);
  if (source.startsWith("$")) return source.slice(1, -1);
  return source.slice(2, -2);
}

function mathJaxErrors(text, mathjaxApi, adaptor) {
  const failures = [];
  for (const part of fns.splitMathSegments(text)) {
    if (part.kind !== "math") continue;
    const tex = segmentToTex(part.value);
    let html;
    try {
      html = adaptor.outerHTML(mathjaxApi.tex2svg(tex));
    } catch (err) {
      failures.push(`throw: ${String(err?.message || err)}`);
      continue;
    }
    if (
      /data-mjx-error|mjx-merror|data-mml-node="mtext"[^>]*(?:fill|stroke)="red"/i.test(
        html
      )
    ) {
      failures.push(`merror: ${part.value.slice(0, 140)}`);
    }
  }
  return failures;
}

test("runtime compiles 2,467 accepted rows and excludes exactly 27 reviewed missing visuals", async () => {
  const mathjaxApi = await mathJaxReady;
  const adaptor = mathjaxApi.startup.adaptor;
  const failures = [];
  let totalRows = 0;
  let totalAccepted = 0;
  const runtimeExcludedIds = [];

  for (const bank of BANKS) {
    const rows = JSON.parse(fs.readFileSync(`data/${bank}.json`, "utf8"));
    totalRows += rows.length;
    let accepted = 0;
    let excluded = 0;
    for (const row of rows) {
      const prepared = fns.prepareProblemForBank(row);
      if (!fns.problemLooksRenderable(prepared)) {
        excluded += 1;
        runtimeExcludedIds.push(row.id);
        assert.equal(
          fns.problemRequiresExternalVisual(row),
          true,
          `${bank}/${row.id} was rejected for an unreviewed reason`
        );
        continue;
      }
      accepted += 1;
      totalAccepted += 1;

      const promptFailures = mathJaxErrors(
        prepared.__sanitizedPrompt,
        mathjaxApi,
        adaptor
      );
      for (const reason of promptFailures) {
        failures.push(`${bank}/${row.id} prompt ${reason}`);
      }

      for (let index = 0; index < (prepared.__normalizedChoices || []).length; index += 1) {
        const choiceFailures = mathJaxErrors(
          prepared.__normalizedChoices[index],
          mathjaxApi,
          adaptor
        );
        for (const reason of choiceFailures) {
          failures.push(`${bank}/${row.id} choice ${index} ${reason}`);
        }
      }
    }

    assert.equal(
      accepted + excluded,
      rows.length,
      `${bank} lost a row outside the reviewed missing-visual set`
    );
  }

  assert.equal(totalRows, 2494);
  assert.equal(totalAccepted, 2467);
  assert.equal(runtimeExcludedIds.length, 27);
  for (const id of REVIEWED_MISSING_VISUAL_IDS) {
    assert.ok(runtimeExcludedIds.includes(id), `reviewed missing visual ${id} became selectable`);
  }
  assert.equal(
    failures.length,
    0,
    `Accepted rows with MathJax failures:\n${failures.slice(0, 25).join("\n")}`
  );

  const audit = await runAudit({
    root: process.cwd(),
    runtimeOnly: true,
    noMathJax: true
  });
  const auditMissingIds = audit.findings
    .filter((item) => item.code === "diagram_mentioned_without_asset")
    .map((item) => item.id)
    .sort();
  assert.deepEqual(runtimeExcludedIds.sort(), auditMissingIds);
});

test("prepared fraction-choice row remains selectable with distinct answers", () => {
  const rows = JSON.parse(fs.readFileSync("data/amc8.json", "utf8"));
  const row = rows.find((item) => item.id === "amio-ec1bd04eda2f3ecfc45d94adee4ba7bb");
  assert.ok(row, "expected AMC8 fraction-choice regression row");

  const prepared = fns.prepareProblemForBank(row);
  assert.equal(fns.problemLooksRenderable(prepared), true);
  assert.equal(new Set(prepared.__normalizedChoices).size, 5);
  assert.deepEqual(
    Array.from(prepared.__normalizedChoices),
    [
      "$\\frac{1}{2}$",
      "$\\frac{2}{3}$",
      "$\\frac{3}{4}$",
      "$\\frac{5}{6}$",
      "$\\frac{7}{8}$"
    ]
  );
});

test("static guard rejects a normalized choice with a MathJax-dangling script", () => {
  const malformed = {
    id: "malformed-choice",
    contest: "AMC 12",
    type: "mcq",
    prompt: "Choose the valid expression.",
    choices: ["$\\log_$", "$1$", "$2$", "$3$", "$4$"],
    answerIndex: 1
  };

  assert.equal(fns.problemLooksRenderable(fns.prepareProblemForBank(malformed)), false);
});

test("MathJax compile guard rejects silent red unknown-command output", async () => {
  const mathjaxApi = await mathJaxReady;
  const adaptor = mathjaxApi.startup.adaptor;
  assert.deepEqual(
    mathJaxErrors(String.raw`$1\thickspace 2$`, mathjaxApi, adaptor),
    [String.raw`merror: $1\thickspace 2$`]
  );
});
