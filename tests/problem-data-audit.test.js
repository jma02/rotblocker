"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  auditManifest,
  auditProblemRows,
  auditReportObjects,
  loadFrontendMath,
  runAudit,
  scanMathStructure
} = require("../scripts/audit_problem_markup");

const ROOT = path.resolve(__dirname, "..");
const frontendMath = loadFrontendMath(ROOT);

function mcq(id, prompt, choices = ["1", "2", "3", "4", "5"], answerIndex = 0, extra = {}) {
  return {
    id,
    type: "mcq",
    contest: "amc8",
    label: "Fixture",
    weight: 5,
    prompt,
    choices,
    answerIndex,
    answerKey: String.fromCharCode(65 + answerIndex),
    answer: choices[answerIndex],
    ...extra
  };
}

function auditRows(rows, options = {}) {
  return auditProblemRows({
    rows,
    file: "data/amc8.json",
    root: options.root || ROOT,
    scope: options.scope || "runtime",
    config: { contest: "amc8", type: "mcq" },
    frontendMath,
    compileMath: options.compileMath || null
  }).findings;
}

function codes(findings) {
  return findings.map((finding) => finding.code);
}

test("math structure scanner accepts display math and catches braces, delimiters, and environments", () => {
  assert.deepEqual(scanMathStructure("Find $$x=\\frac{1}{2}$$."), []);
  assert.deepEqual(
    scanMathStructure(
      "Find $A^2$, where $A$ is defined by $$x=\\sqrt{19}+\\frac{91}{x}$$."
    ),
    []
  );
  assert.ok(codes(scanMathStructure("Malformed $$$x$$$ delimiters.")).includes(
    "suspicious_double_dollar"
  ));
  assert.deepEqual(scanMathStructure("The set is \\{1,2,3\\}."), []);

  const braceCodes = codes(scanMathStructure("$x^{2$"));
  assert.ok(braceCodes.includes("unclosed_brace"));

  const delimiterCodes = codes(scanMathStructure("Find \\(x+1$ now."));
  assert.ok(delimiterCodes.includes("crossed_math_delimiter"));
  assert.ok(delimiterCodes.includes("unclosed_math_delimiter"));

  const environmentCodes = codes(
    scanMathStructure("$\\begin{tabular}{c}x\\end{array}$")
  );
  assert.ok(environmentCodes.includes("unsupported_environment"));
  assert.ok(environmentCodes.includes("mismatched_environment"));
});

test("audit rejects ambiguous compact fractions and choices that collide after frontend normalization", () => {
  const findings = auditRows([
    mcq(
      "fraction-collision",
      "Choose the requested expression.",
      ["frac 12", "7!5!", "7! 5!", "\\frac{3}{4}", "1"],
      0
    )
  ]);

  assert.ok(codes(findings).includes("ambiguous_compact_fraction"));
  assert.ok(codes(findings).includes("bare_fraction_command"));
  assert.ok(codes(findings).includes("frontend_duplicate_choice"));

  const canonical = auditRows([
    mcq(
      "canonical-fractions",
      "Choose a fraction.",
      ["\\frac{1}{2}", "\\frac{2}{3}", "\\frac{3}{4}", "\\frac{4}{5}", "1"],
      0
    )
  ]);
  assert.ok(!codes(canonical).includes("ambiguous_compact_fraction"));
});

test("audit validates answer keys, raw duplicate choices, placeholders, controls, and schema drift", () => {
  const row = mcq(
    "broken-schema",
    "TODO: finish this\u0007",
    ["1", "2", "2", "4", "5"],
    1,
    { answerKey: "E", answer: "wrong", surprise: true }
  );
  const findings = auditRows([row]);
  const resultCodes = codes(findings);

  for (const expected of [
    "answer_key_mismatch",
    "answer_value_mismatch",
    "control_character",
    "duplicate_choice",
    "placeholder_or_truncated_text",
    "schema_drift_unknown_field"
  ]) {
    assert.ok(resultCodes.includes(expected), `missing ${expected}`);
  }
});

test("audit enforces the configured contest identity for each bank", () => {
  const findings = auditRows([
    mcq("wrong-contest", "Choose the answer.", undefined, 0, { contest: "amc10" })
  ]);

  assert.ok(codes(findings).includes("schema_bank_contest_mismatch"));
});

test("problem signatures include normalized choices and diagram identity", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-"));
  fs.mkdirSync(path.join(tempRoot, "assets"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "assets", "a.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
  fs.writeFileSync(path.join(tempRoot, "assets", "b.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");

  const rows = [
    mcq("variant-a", "Use the graph shown.", ["1", "2", "3", "4", "5"], 0, {
      diagramSvg: "assets/a.svg"
    }),
    mcq("variant-b", "Use the graph shown.", ["1", "2", "3", "4", "5"], 0, {
      diagramSvg: "assets/b.svg"
    }),
    mcq("exact-a", "Which value is correct?"),
    mcq("exact-b", "Which value is correct?")
  ];
  const findings = auditRows(rows, { root: tempRoot });
  const duplicateFindings = findings.filter(
    (finding) => finding.code === "duplicate_problem_signature"
  );
  const variantFindings = findings.filter((finding) => finding.code === "reused_prompt_variant");

  assert.equal(duplicateFindings.length, 1);
  assert.equal(duplicateFindings[0].id, "exact-b");
  assert.equal(variantFindings.length, 1);
  assert.equal(variantFindings[0].id, "variant-b");
});

test("asset audit reports missing files and rejects paths outside the repository", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-assets-"));
  const findings = auditRows(
    [
      mcq("missing-asset", "Use this figure.", undefined, 0, {
        diagramPng: "assets/diagrams/missing.png"
      }),
      mcq("unsafe-asset", "Use this figure.", undefined, 0, {
        diagramPng: "../outside.png"
      })
    ],
    { root: tempRoot }
  );

  assert.ok(codes(findings).includes("missing_diagram_asset"));
  assert.ok(codes(findings).includes("unsafe_diagram_reference"));
});

test("asset audit rejects diagram files outside assets/diagrams", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-asset-location-"));
  fs.mkdirSync(path.join(tempRoot, "images"), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, "images", "diagram.svg"),
    "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
  );
  const findings = auditRows([
    mcq("unsupported-location", "Use the supplied figure.", undefined, 0, {
      diagramSvg: "images/diagram.svg"
    })
  ], { root: tempRoot });

  assert.ok(codes(findings).includes("unsupported_diagram_location"));
  assert.ok(!codes(findings).includes("missing_diagram_asset"));
});

test("asset audit validates plural PNG and SVG references", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-plural-assets-"));
  fs.mkdirSync(path.join(tempRoot, "assets"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "assets", "one.png"), "not-a-real-png");
  fs.writeFileSync(
    path.join(tempRoot, "assets", "two.svg"),
    "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
  );

  const findings = auditRows([
    mcq("plural-assets", "Use the supplied diagrams.", undefined, 0, {
      diagramPngs: ["assets/one.png"],
      diagramSvgs: ["assets/two.svg"]
    })
  ], { root: tempRoot });

  assert.ok(!codes(findings).includes("missing_diagram_asset"));
  assert.ok(!codes(findings).includes("schema_drift_unknown_field"));
});

test("asset audit recognizes broad, explicit visual dependencies", () => {
  const findings = auditRows([
    mcq("figure-dependent", "In the figure, segment AB has length 4."),
    mcq("table-dependent", "Use the data in the accompanying paragraph and table.")
  ]);

  assert.equal(
    findings.filter((finding) => finding.code === "diagram_mentioned_without_asset").length,
    2
  );
});

test("reviewed missing-source visuals are informational runtime exclusions", () => {
  const findings = auditRows([
    mcq(
      "amio-1fb2fe29e045b8003a0854862002229b",
      "Use the figure shown below to choose the answer."
    )
  ]);
  const missing = findings.find(
    (finding) => finding.code === "diagram_mentioned_without_asset"
  );

  assert.equal(missing.severity, "info");
  assert.match(missing.message, /excluded at runtime/);
});

test("asset audit recognizes shown-figure phrasing without inference false positives", () => {
  const findings = auditRows([
    mcq("missed-181678", "Four semicircles are drawn, as shown, creating two regions."),
    mcq("missed-3b39", "Two closest vertices are separated, as shown below. Find the area."),
    mcq("missed-61c3", "The points lie on a circle, as shown. Find the arc."),
    mcq("missed-68be", "The square is rotated, as shown below. Find the angle."),
    mcq("missed-9ac6", "The pieces are joined as shown in the second diagram."),
    mcq("missed-c976", "Part of the graph of $f$ is shown. Find its slope."),
    mcq("missed-acb25", "Three hexagons are shown below. Continue the pattern."),
    mcq("missed-e694", "A corner of a tiled floor is shown. Find the dark fraction."),
    mcq("proof-that", "It is shown that $x=2$. Which statement follows?"),
    mcq("proof-to-be", "The function is shown to be continuous. Which result applies?"),
    mcq(
      "embedded-calendar",
      "A calendar is shown below: $\\begin{array}{ccc}1&2&3\\\\4&5&6\\end{array}$. Find the sum."
    )
  ]);
  const missingIds = findings
    .filter((item) => item.code === "diagram_mentioned_without_asset")
    .map((item) => item.id);

  assert.deepEqual(missingIds, [
    "missed-181678",
    "missed-3b39",
    "missed-61c3",
    "missed-68be",
    "missed-9ac6",
    "missed-c976",
    "missed-acb25",
    "missed-e694"
  ]);
  assert.ok(!missingIds.includes("proof-that"));
  assert.ok(!missingIds.includes("proof-to-be"));
  assert.ok(!missingIds.includes("embedded-calendar"));
});

test("inline TeX arrays satisfy an explicit table dependency", () => {
  const findings = auditRows([
    mcq(
      "inline-array",
      "Using the table $\\begin{array}{c|c}x&f(x)\\\\1&2\\end{array}$, choose the answer."
    )
  ]);

  assert.ok(!codes(findings).includes("diagram_mentioned_without_asset"));
});

test("conventional closest-to prompts are not treated as abrupt", () => {
  const findings = auditRows([
    mcq("closest-to", "The value of the expression is closest to?")
  ]);

  assert.ok(!codes(findings).includes("abrupt_prompt"));
});

test("artifact manifest audit verifies target counts and checksums without making history fatal", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-manifest-"));
  fs.mkdirSync(path.join(tempRoot, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "artifacts", "bank.json"), "[]\n");
  const manifestPath = path.join(tempRoot, "artifacts", "manifest_v7.json");
  const findings = auditManifest({
    root: tempRoot,
    file: manifestPath,
    manifest: {
      schema_version: 1,
      artifact_version: "v7",
      inputs: {},
      outputs: {
        bank: {
          path: "artifacts/bank.json",
          count: 3,
          sha256: "0".repeat(64)
        }
      }
    }
  });

  assert.ok(codes(findings).includes("manifest_checksum_drift"));
  assert.ok(codes(findings).includes("manifest_count_drift"));
  assert.ok(findings.every((finding) => finding.severity === "warning"));
});

test("current v3 manifest checksum, count, and schema defects are errors", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-current-manifest-"));
  fs.mkdirSync(path.join(tempRoot, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "artifacts", "bank.json"), "[]\n");
  const manifestPath = path.join(tempRoot, "artifacts", "manifest_v3.json");
  const findings = auditManifest({
    root: tempRoot,
    file: manifestPath,
    manifest: {
      schema_version: 1,
      artifact_version: "v3",
      inputs: {},
      outputs: {
        bank: {
          path: "artifacts/bank.json",
          count: 3,
          sha256: "0".repeat(64)
        },
        malformed: {
          path: "artifacts/bank.json",
          count: -1,
          sha256: "not-a-digest"
        }
      }
    }
  });

  for (const expected of [
    "manifest_checksum_drift",
    "manifest_count_drift",
    "manifest_schema_invalid"
  ]) {
    const matching = findings.filter((item) => item.code === expected);
    assert.ok(matching.length > 0, `missing ${expected}`);
    assert.ok(matching.every((item) => item.severity === "error"));
  }
});

test("a current manifest with the wrong embedded version stays fatal", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-wrong-version-"));
  fs.mkdirSync(path.join(tempRoot, "artifacts"), { recursive: true });
  const manifestPath = path.join(tempRoot, "artifacts", "manifest_v3.json");
  const findings = auditManifest({
    root: tempRoot,
    file: manifestPath,
    manifest: {
      schema_version: 1,
      artifact_version: "v2",
      inputs: {},
      outputs: {}
    }
  });

  const mismatch = findings.find((item) => item.code === "manifest_schema_invalid");
  assert.ok(mismatch);
  assert.equal(mismatch.severity, "error");
});

test("full audit errors when the required current manifest is absent", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rotblocker-audit-no-current-manifest-"));
  fs.mkdirSync(path.join(tempRoot, "challenge-modules"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "artifacts"), { recursive: true });
  fs.copyFileSync(
    path.join(ROOT, "challenge-modules", "math.js"),
    path.join(tempRoot, "challenge-modules", "math.js")
  );
  const result = await runAudit({
    root: tempRoot,
    noMathJax: true,
    runtimeOnly: false
  });

  const missing = result.findings.find((item) => item.code === "missing_current_manifest");
  assert.ok(missing);
  assert.equal(missing.severity, "error");
});

test("report audit catches absolute source paths and stale output counts", () => {
  const objects = new Map([
    [
      "data/calculus_mcq_quality_report.json",
      {
        source: "/Users/example/project/data/calculus_mcq.json",
        input_count: 12,
        kept_count: 10,
        dropped_count: 2,
        drop_reasons: { malformed: 2 }
      }
    ],
    [
      "data/upper_level_mcq_rewrite_report.json",
      { inputCount: 44, keptCount: 44, droppedCount: 0 }
    ]
  ]);
  const banks = new Map([
    ["data/calculus_mcq.json", Array.from({ length: 9 }, () => ({}))],
    ["data/upper_level_mcq.json", Array.from({ length: 43 }, () => ({}))]
  ]);
  const findings = auditReportObjects({ objects, banks, root: ROOT });

  assert.ok(codes(findings).includes("nonportable_report_source"));
  assert.ok(codes(findings).includes("report_output_drift"));
  assert.equal(
    findings.find((item) => item.code === "nonportable_report_source").severity,
    "error"
  );
});

test("report audit does not compare pre-rewrite counts to the shipped bank", () => {
  const objects = new Map([
    [
      "data/upper_level_mcq_quality_report.json",
      {
        pipeline_stage: "pre_rewrite_quality_filter",
        input_count: 222,
        kept_count: 175
      }
    ],
    [
      "data/upper_level_mcq_report.json",
      {
        pipeline_stage: "raw_import_pre_quality_rewrite",
        final_count: 222
      }
    ],
    [
      "data/upper_level_mcq_rewrite_preview_report.json",
      {
        pipelineStage: "rewrite_preview_only",
        keptCount: 41
      }
    ]
  ]);
  const banks = new Map([
    ["data/upper_level_mcq.json", Array.from({ length: 44 }, () => ({}))]
  ]);

  const findings = auditReportObjects({ objects, banks, root: ROOT });

  assert.ok(!codes(findings).includes("report_output_drift"));
});
