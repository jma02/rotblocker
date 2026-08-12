#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const CURRENT_ARTIFACT_VERSION = "v3";

const BANKS = [
  { file: "data/amc8.json", scope: "runtime", contest: "amc8", type: "mcq" },
  { file: "data/amc10.json", scope: "runtime", contest: "amc10", type: "mcq" },
  { file: "data/amc12.json", scope: "runtime", contest: "amc12", type: "mcq" },
  { file: "data/aime.json", scope: "runtime", contest: "aime", type: "input" },
  {
    file: "data/olympiad.json",
    scope: "runtime",
    contest: "olympiad",
    type: "input"
  },
  {
    file: "data/upper_level_mcq.json",
    scope: "runtime",
    contest: "upper_level_mcq",
    type: "mcq"
  },
  {
    file: "data/calculus_mcq_synthetic.json",
    scope: "runtime",
    contest: "calculus",
    type: "mcq"
  },
  {
    file: "data/calculus_mcq.json",
    scope: "archival",
    contest: "calculus",
    type: "mcq"
  }
];

const COMMON_FIELDS = new Set([
  "id",
  "type",
  "contest",
  "label",
  "weight",
  "prompt",
  "choices",
  "answerIndex",
  "answerKey",
  "answer",
  "acceptableAnswers",
  "diagramPng",
  "diagramSvg",
  "diagramPngs",
  "diagramSvgs",
  "source",
  "topic"
]);

const DIAGRAM_FIELDS = ["diagramPng", "diagramSvg", "diagramPngs", "diagramSvgs"];
const UNSUPPORTED_ENVIRONMENTS = new Set([
  "tabular",
  "tabular*",
  "align",
  "align*",
  "eqnarray",
  "eqnarray*"
]);

function normalizeSnippet(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function isEscapedAt(source, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function finding(code, message, extra = {}) {
  return {
    severity: extra.severity || "error",
    code,
    message,
    ...extra
  };
}

function scanMathStructure(text) {
  const source = String(text || "");
  const findings = [];
  const delimiters = [];
  const environments = [];
  const braces = [];

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "$" && !isEscapedAt(source, i)) {
      const token = source[i + 1] === "$" && !isEscapedAt(source, i + 1)
        ? "$$"
        : "$";
      if (token === "$$") i += 1;
      const top = delimiters[delimiters.length - 1];
      if (top === token) {
        delimiters.pop();
      } else if (top) {
        findings.push(finding(
          "crossed_math_delimiter",
          `Found ${token} before closing ${top}.`
        ));
        delimiters.push(token);
      } else {
        delimiters.push(token);
      }
      continue;
    }

    if (ch === "\\" && !isEscapedAt(source, i)) {
      const token = source.slice(i, i + 2);
      if (token === "\\(" || token === "\\[") {
        if (delimiters.length) {
          findings.push(finding(
            "crossed_math_delimiter",
            `Found ${token} inside ${delimiters[delimiters.length - 1]}.`
          ));
        }
        delimiters.push(token);
        i += 1;
        continue;
      }
      if (token === "\\)" || token === "\\]") {
        const expected = token === "\\)" ? "\\(" : "\\[";
        if (delimiters.pop() !== expected) {
          findings.push(finding(
            "crossed_math_delimiter",
            `Closing ${token} does not match the active delimiter.`
          ));
        }
        i += 1;
        continue;
      }
    }

    // Escaped braces (\{ and \}) are literal glyphs, not TeX grouping.
    if (ch === "{" && !isEscapedAt(source, i)) braces.push(i);
    if (ch === "}" && !isEscapedAt(source, i)) {
      if (braces.length) braces.pop();
      else findings.push(finding("unexpected_closing_brace", "Found an unmatched closing brace."));
    }
  }

  if (braces.length) {
    findings.push(finding("unclosed_brace", `Found ${braces.length} unclosed brace(s).`));
  }
  if (delimiters.length) {
    findings.push(finding(
      "unclosed_math_delimiter",
      `Unclosed math delimiter(s): ${delimiters.join(", ")}.`
    ));
  }

  const environmentPattern = /\\(begin|end)\{([^{}]+)\}/g;
  let match;
  while ((match = environmentPattern.exec(source)) !== null) {
    const [, action, name] = match;
    if (UNSUPPORTED_ENVIRONMENTS.has(name)) {
      findings.push(finding(
        "unsupported_environment",
        `Environment ${name} should be normalized before shipping.`
      ));
    }
    if (action === "begin") {
      environments.push(name);
    } else {
      const opened = environments.pop();
      if (opened !== name) {
        findings.push(finding(
          "mismatched_environment",
          `Environment ${opened || "(none)"} closes as ${name}.`
        ));
      }
    }
  }
  for (const name of environments) {
    findings.push(finding("unclosed_environment", `Environment ${name} is not closed.`));
  }

  if (/(?:\^|_)\s*(?=(?:\$|\\\)|\\\]|[}\])]|$))/.test(source)) {
    findings.push(finding("dangling_script", "A TeX superscript/subscript has no operand."));
  }
  if (/(^|[^\\A-Za-z])(?:dfrac|tfrac|frac)(?=\s|[0-9{\\+-]|$)/.test(source)) {
    findings.push(finding("bare_fraction_command", "Fraction command is missing its leading backslash."));
  }
  if (
    /(?:^|[^\\A-Za-z])(?:dfrac|tfrac|frac)\s*(?:[A-Za-z0-9]\s+[A-Za-z0-9]|\d{2})(?![A-Za-z0-9{])/.test(source)
    || /\\(?:dfrac|tfrac|frac)\s+[A-Za-z0-9]\s+[A-Za-z0-9](?![A-Za-z0-9{])/.test(source)
  ) {
    findings.push(finding(
      "ambiguous_compact_fraction",
      "Compact fraction operands should use explicit braces."
    ));
  }

  // Proper $$...$$ display math is valid. Only flag genuinely repeated or
  // empty delimiter runs that MathJax cannot interpret predictably.
  if (/(?<!\\)\${3,}|\$\$\s*\$\$/.test(source)) {
    findings.push(finding("suspicious_double_dollar", "Malformed or empty repeated dollar delimiter."));
  }

  return dedupeFindings(findings);
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.severity}|${item.code}|${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function loadFrontendMath(root = ROOT) {
  const source = fs.readFileSync(path.join(root, "challenge-modules", "math.js"), "utf8");
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: { querySelectorAll() { return []; } },
    window: { MathJax: null, location: { pathname: "", search: "", hash: "" } },
    globalThis: null,
    setInterval() { return 0; },
    clearInterval() {},
    mathTypesetQueue: Promise.resolve(),
    mathPendingRetryTimer: null
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, {
    filename: path.join(root, "challenge-modules", "math.js")
  });
  return {
    sanitizeForMathJax: sandbox.RB.math.sanitizeForMathJax,
    normalizeChoiceMath: sandbox.RB.math.normalizeChoiceMath,
    splitMathSegments: sandbox.RB.math.splitMathSegments,
    hasMalformedMathSyntax: sandbox.RB.math.hasMalformedMathSyntax,
    problemRequiresExternalVisual: sandbox.RB.math.problemRequiresExternalVisual
  };
}

function canonicalText(text) {
  return String(text || "")
    .normalize("NFKC")
    .replace(/\u2060/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function diagramReferences(row) {
  const references = [];
  for (const field of DIAGRAM_FIELDS) {
    const value = row?.[field];
    if (Array.isArray(value)) {
      value.forEach((item) => references.push({ field, value: item }));
    } else if (value !== undefined && value !== null && value !== "") {
      references.push({ field, value });
    }
  }
  return references;
}

function isSafeRepositoryPath(root, reference) {
  const raw = String(reference || "");
  if (!raw || path.isAbsolute(raw)) return false;
  const resolved = path.resolve(root, raw);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

function stringItems(row) {
  const items = [{ field: "prompt", text: row?.prompt }];
  if (Array.isArray(row?.choices)) {
    row.choices.forEach((choice, index) => {
      items.push({ field: `choices[${index}]`, text: choice });
    });
  }
  return items;
}

function isAbruptPrompt(text) {
  const source = String(text || "").trim();
  if (!source) return true;
  // "Which value is closest to?" is a conventional MCQ stem whose comparison
  // target is encoded in the choices; ending in "to" is not truncation here.
  if (/\bclosest\s+to\s*\??$/i.test(source)) return false;
  return (
    /\b(?:if|where|when|such that|given that|equal to|of|from|to)\s*\??$/i.test(source)
    || /\b(?:find|determine|compute)\s+(?:the\s+)?(?:value|sum|product|area|measure)\s+of\s*\??$/i.test(source)
  );
}

function withContext(base, context, severity) {
  return {
    ...base,
    severity: base.severity || severity,
    file: context.file,
    id: context.id,
    field: context.field,
    snippet: normalizeSnippet(context.text)
  };
}

function loadReviewedMissingVisualIds(root) {
  const file = path.resolve(root, "data", "reviewed_missing_visuals.json");
  if (!fs.existsSync(file)) return new Set();
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return new Set(
      Array.isArray(payload?.ids)
        ? payload.ids.filter((id) => typeof id === "string" && id.trim())
        : []
    );
  } catch (_error) {
    return new Set();
  }
}

function auditProblemRows({
  rows,
  file,
  root = ROOT,
  scope = "runtime",
  config = {},
  frontendMath = loadFrontendMath(root),
  compileMath = null
}) {
  const findings = [];
  const rowList = Array.isArray(rows) ? rows : [];
  const defaultSeverity = scope === "runtime" ? "error" : "warning";
  const exactSignatures = new Map();
  const promptSignatures = new Map();
  const ids = new Set();
  const reviewedMissingVisualIds = loadReviewedMissingVisualIds(root);

  const push = (code, message, row, field = "row", text = "", severity = defaultSeverity) => {
    findings.push(finding(code, message, {
      severity,
      file,
      id: row?.id,
      field,
      snippet: normalizeSnippet(text)
    }));
  };

  rowList.forEach((row, rowIndex) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      push("schema_invalid_row", `Row ${rowIndex} is not an object.`, null);
      return;
    }
    if (typeof row.id !== "string" || !row.id.trim()) {
      push("schema_missing_id", "Problem id must be a nonempty string.", row);
    } else if (ids.has(row.id)) {
      push("duplicate_id", `Problem id ${row.id} is duplicated.`, row);
    } else {
      ids.add(row.id);
    }
    for (const key of Object.keys(row)) {
      if (!COMMON_FIELDS.has(key)) {
        push("schema_drift_unknown_field", `Unknown problem field ${key}.`, row, key, row[key]);
      }
    }
    if (row.type !== "mcq" && row.type !== "input") {
      push("schema_invalid_type", "Problem type must be mcq or input.", row, "type", row.type);
    }
    if (config.type && row.type !== config.type) {
      push("schema_bank_type_mismatch", `Expected type ${config.type}.`, row, "type", row.type);
    }
    if (config.contest && row.contest !== config.contest) {
      push(
        "schema_bank_contest_mismatch",
        `Expected contest ${config.contest}.`,
        row,
        "contest",
        row.contest
      );
    }
    if (typeof row.prompt !== "string" || !row.prompt.trim()) {
      push("schema_missing_prompt", "Prompt must be a nonempty string.", row, "prompt", row.prompt);
    }
    if (!Number.isFinite(Number(row.weight)) || Number(row.weight) <= 0) {
      push("schema_invalid_weight", "Weight must be a positive number.", row, "weight", row.weight);
    }

    if (row.type === "mcq") {
      if (!Array.isArray(row.choices) || row.choices.length !== 5) {
        push("schema_invalid_choices", "MCQ problems must have exactly five choices.", row, "choices");
      } else {
        if (row.choices.some((choice) => typeof choice !== "string" || !choice.trim())) {
          push("blank_choice", "Every MCQ choice must be a nonempty string.", row, "choices");
        }
        const rawChoices = row.choices.map(canonicalText);
        if (new Set(rawChoices).size !== rawChoices.length) {
          push("duplicate_choice", "Raw choices collide after whitespace/case normalization.", row, "choices");
        }
        const normalizedChoices = row.choices.map((choice) =>
          canonicalText(frontendMath.normalizeChoiceMath(choice)).replace(/\s+/g, "")
        );
        if (new Set(normalizedChoices).size !== normalizedChoices.length) {
          push(
            "frontend_duplicate_choice",
            "Choices collide after the frontend MathJax normalization path.",
            row,
            "choices"
          );
        }
      }
      if (!Number.isInteger(row.answerIndex) || row.answerIndex < 0 || row.answerIndex > 4) {
        push("schema_invalid_answer_index", "answerIndex must be an integer from 0 through 4.", row);
      } else if (Array.isArray(row.choices) && row.choices.length > row.answerIndex) {
        const expectedKey = String.fromCharCode(65 + row.answerIndex);
        if (row.answerKey !== expectedKey) {
          push("answer_key_mismatch", `answerKey should be ${expectedKey}.`, row, "answerKey", row.answerKey);
        }
        if (canonicalText(row.answer) !== canonicalText(row.choices[row.answerIndex])) {
          push(
            "answer_value_mismatch",
            "answer does not match choices[answerIndex].",
            row,
            "answer",
            row.answer
          );
        }
      }
    } else if (row.type === "input") {
      const accepted = Array.isArray(row.acceptableAnswers) && row.acceptableAnswers.length
        ? row.acceptableAnswers
        : [row.answer];
      if (!accepted.length || accepted.some((answer) => answer === undefined || answer === null || answer === "")) {
        push("schema_missing_answer", "Input problem has no usable answer.", row, "answer");
      }
    }

    for (const item of stringItems(row)) {
      const text = String(item.text || "");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        push("control_character", "Text contains a control character.", row, item.field, text);
      }
      if (/\b(?:TODO|TBD|FIXME|PLACEHOLDER)\b/i.test(text)) {
        push(
          "placeholder_or_truncated_text",
          "Text contains a placeholder marker.",
          row,
          item.field,
          text
        );
      }
      for (const structural of scanMathStructure(text)) {
        findings.push(withContext(structural, {
          file,
          id: row.id,
          field: item.field,
          text
        }, defaultSeverity));
      }
      if (
        compileMath
        && typeof compileMath === "function"
        && !scanMathStructure(text).some((itemFinding) => itemFinding.severity === "error")
      ) {
        const normalized = item.field === "prompt"
          ? frontendMath.sanitizeForMathJax(text)
          : frontendMath.normalizeChoiceMath(text);
        const compileFailures = compileMath(normalized) || [];
        for (const failure of compileFailures) {
          push(
            "mathjax_compile_error",
            String(failure || "MathJax failed to compile a segment."),
            row,
            item.field,
            normalized
          );
        }
      }
    }
    if (typeof row.prompt === "string" && isAbruptPrompt(row.prompt)) {
      push("abrupt_prompt", "Prompt appears to end at a connector or unfinished clause.", row, "prompt", row.prompt);
    }

    const references = diagramReferences(row);
    for (const { field, value } of references) {
      if (typeof value !== "string" || !value.trim()) {
        push("invalid_diagram_reference", "Diagram references must be nonempty strings.", row, field, value);
        continue;
      }
      if (!isSafeRepositoryPath(root, value)) {
        push("unsafe_diagram_reference", "Diagram path escapes the repository.", row, field, value);
        continue;
      }
      if (!String(value).startsWith("assets/diagrams/")) {
        push(
          "unsupported_diagram_location",
          "Diagram paths must be stored under assets/diagrams/.",
          row,
          field,
          value
        );
        continue;
      }
      if (!fs.existsSync(path.resolve(root, value))) {
        push("missing_diagram_asset", "Referenced diagram does not exist.", row, field, value);
      }
    }
    if (frontendMath.problemRequiresExternalVisual(row)) {
      const reviewed = reviewedMissingVisualIds.has(row.id);
      push(
        "diagram_mentioned_without_asset",
        reviewed
          ? "Reviewed missing-source visual; row is preserved but excluded at runtime."
          : "Prompt explicitly depends on a visual but has no diagram reference.",
        row,
        "prompt",
        row.prompt,
        reviewed ? "info" : "warning"
      );
    }

    const promptSignature = canonicalText(frontendMath.sanitizeForMathJax(row.prompt));
    const choiceSignature = Array.isArray(row.choices)
      ? row.choices.map((choice) => canonicalText(frontendMath.normalizeChoiceMath(choice))).join("\u241f")
      : "";
    const diagramSignature = references.map(({ value }) => String(value)).sort().join("\u241f");
    const exactSignature = `${promptSignature}\u241e${choiceSignature}\u241e${diagramSignature}`;
    if (exactSignatures.has(exactSignature)) {
      push(
        "duplicate_problem_signature",
        `Duplicates ${exactSignatures.get(exactSignature)} after frontend normalization.`,
        row,
        "prompt",
        row.prompt,
        "warning"
      );
    } else {
      exactSignatures.set(exactSignature, row.id || `row-${rowIndex}`);
    }
    const promptAndChoices = `${promptSignature}\u241e${choiceSignature}`;
    if (
      promptSignatures.has(promptAndChoices)
      && promptSignatures.get(promptAndChoices).diagramSignature !== diagramSignature
    ) {
      push(
        "reused_prompt_variant",
        `Reuses ${promptSignatures.get(promptAndChoices).id} with different diagram identity.`,
        row,
        "prompt",
        row.prompt,
        "warning"
      );
    } else if (!promptSignatures.has(promptAndChoices)) {
      promptSignatures.set(promptAndChoices, {
        id: row.id || `row-${rowIndex}`,
        diagramSignature
      });
    }
  });

  return {
    file,
    scope,
    rowCount: rowList.length,
    findings: dedupeContextualFindings(findings)
  };
}

function dedupeContextualFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = [
      item.severity,
      item.code,
      item.file,
      item.id,
      item.field,
      item.message
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function countJsonEntries(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (Array.isArray(parsed)) return parsed.length;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.items)) return parsed.items.length;
    if (Array.isArray(parsed.rejects)) return parsed.rejects.length;
  }
  return null;
}

function auditManifest({ root = ROOT, file, manifest }) {
  const findings = [];
  const relativeFile = path.relative(root, file).replaceAll(path.sep, "/");
  const versionFromName = path.basename(file).match(/^manifest_(v[^.]+)\.json$/)?.[1] || "";
  // Currentness is a property of the checked-in filename. A corrupt
  // artifact_version must not be able to downgrade current-manifest failures.
  const current = relativeFile === `artifacts/manifest_${CURRENT_ARTIFACT_VERSION}.json`;
  const severity = current ? "error" : "warning";
  const push = (code, message, field = "manifest") => {
    findings.push(finding(code, message, {
      severity,
      file: relativeFile,
      field
    }));
  };

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    push("manifest_schema_invalid", "Manifest must be a JSON object.");
    return findings;
  }
  if (manifest.schema_version !== 1) {
    push("manifest_schema_invalid", "schema_version must equal 1.", "schema_version");
  }
  if (typeof manifest.artifact_version !== "string" || !manifest.artifact_version) {
    push("manifest_schema_invalid", "artifact_version must be a nonempty string.", "artifact_version");
  } else if (versionFromName && manifest.artifact_version !== versionFromName) {
    push(
      "manifest_schema_invalid",
      `artifact_version ${manifest.artifact_version} does not match filename ${versionFromName}.`,
      "artifact_version"
    );
  }
  for (const sectionName of ["inputs", "outputs"]) {
    const section = manifest[sectionName];
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      push("manifest_schema_invalid", `${sectionName} must be an object.`, sectionName);
      continue;
    }
    for (const [name, entry] of Object.entries(section)) {
      const field = `${sectionName}.${name}`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        push("manifest_schema_invalid", `${field} must be an object.`, field);
        continue;
      }
      if (typeof entry.path !== "string" || !entry.path) {
        push("manifest_schema_invalid", `${field}.path must be a nonempty string.`, `${field}.path`);
        continue;
      }
      if (!isSafeRepositoryPath(root, entry.path)) {
        push("manifest_schema_invalid", `${field}.path escapes the repository.`, `${field}.path`);
        continue;
      }
      const target = path.resolve(root, entry.path);
      if (!fs.existsSync(target)) {
        push("manifest_missing_target", `${entry.path} does not exist.`, `${field}.path`);
        continue;
      }
      if (!/^[a-f0-9]{64}$/i.test(String(entry.sha256 || ""))) {
        push("manifest_schema_invalid", `${field}.sha256 must be a 64-digit hex digest.`, `${field}.sha256`);
      } else {
        const actual = sha256File(target);
        if (actual !== String(entry.sha256).toLowerCase()) {
          push("manifest_checksum_drift", `${entry.path} checksum differs from the manifest.`, `${field}.sha256`);
        }
      }
      if (entry.count !== undefined) {
        if (!Number.isInteger(entry.count) || entry.count < 0) {
          push("manifest_schema_invalid", `${field}.count must be a nonnegative integer.`, `${field}.count`);
        } else {
          let actualCount = null;
          try {
            actualCount = countJsonEntries(target);
          } catch (error) {
            push("manifest_target_invalid_json", `${entry.path}: ${error.message}`, `${field}.path`);
          }
          if (actualCount !== null && actualCount !== entry.count) {
            push(
              "manifest_count_drift",
              `${entry.path} has ${actualCount} entries; manifest says ${entry.count}.`,
              `${field}.count`
            );
          }
        }
      }
    }
  }
  return findings;
}

function isAbsoluteLike(value) {
  const source = String(value || "");
  return path.posix.isAbsolute(source)
    || path.win32.isAbsolute(source)
    || /^file:\/\//i.test(source);
}

function auditReportObjects({ objects, banks, root = ROOT }) {
  const findings = [];
  const push = (code, message, file, field, severity = "warning") => {
    findings.push(finding(code, message, { severity, file, field }));
  };

  for (const [file, report] of objects.entries()) {
    if (!report || typeof report !== "object" || Array.isArray(report)) continue;
    for (const [key, value] of Object.entries(report)) {
      if (/source|path/i.test(key) && typeof value === "string" && isAbsoluteLike(value)) {
        push(
          "nonportable_report_source",
          `${key} contains a machine-specific absolute path.`,
          file,
          key,
          "error"
        );
      }
    }

    const lower = file.toLowerCase();
    let bankFile = null;
    if (lower.includes("calculus_mcq") && !lower.includes("synthetic")) {
      bankFile = "data/calculus_mcq.json";
    } else if (lower.includes("upper_level_mcq")) {
      bankFile = "data/upper_level_mcq.json";
    } else if (lower.includes("synthetic")) {
      bankFile = "data/calculus_mcq_synthetic.json";
    }
    if (!bankFile || !banks.has(bankFile)) continue;
    const pipelineStage = String(
      report.pipeline_stage || report.pipelineStage || ""
    ).toLowerCase();
    if (
      pipelineStage.includes("pre_rewrite")
      || pipelineStage.includes("raw_import")
      || pipelineStage.includes("preview_only")
    ) {
      continue;
    }
    const expected = banks.get(bankFile).length;
    const reported = Number.isInteger(report.kept_count)
      ? report.kept_count
      : Number.isInteger(report.keptCount)
        ? report.keptCount
        : Number.isInteger(report.count)
          ? report.count
          : Number.isInteger(report.final_count)
            ? report.final_count
            : null;
    if (reported !== null && reported !== expected) {
      push(
        "report_output_drift",
        `Report says ${reported} kept rows but ${bankFile} contains ${expected}.`,
        file,
        "count"
      );
    }
  }
  return findings;
}

async function createMathJaxCompiler(frontendMath) {
  const mathjaxApi = await require("mathjax/es5/node-main.js").init({
    loader: { load: ["input/tex", "output/svg"] }
  });
  const adaptor = mathjaxApi.startup.adaptor;
  const segmentToTex = (segment) => {
    if (segment.startsWith("$$")) return segment.slice(2, -2);
    if (segment.startsWith("$")) return segment.slice(1, -1);
    return segment.slice(2, -2);
  };
  return (text) => {
    const failures = [];
    for (const part of frontendMath.splitMathSegments(text)) {
      if (part.kind !== "math") continue;
      try {
        const rendered = adaptor.outerHTML(mathjaxApi.tex2svg(segmentToTex(part.value)));
        if (/data-mjx-error|mjx-merror/i.test(rendered)) {
          failures.push(`MathJax merror in ${normalizeSnippet(part.value)}`);
        }
      } catch (error) {
        failures.push(String(error?.message || error));
      }
    }
    return failures;
  };
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function parseArgs(argv) {
  return {
    strictWarnings: argv.includes("--strict-warnings"),
    runtimeOnly: argv.includes("--runtime-only"),
    noMathJax: argv.includes("--no-mathjax"),
    json: argv.includes("--json")
  };
}

async function runAudit(options = {}) {
  const root = options.root || ROOT;
  const frontendMath = loadFrontendMath(root);
  const compileMath = options.noMathJax ? null : await createMathJaxCompiler(frontendMath);
  const findings = [];
  const banks = new Map();
  const summaries = [];

  for (const config of BANKS) {
    if (options.runtimeOnly && config.scope !== "runtime") continue;
    const absolute = path.resolve(root, config.file);
    if (!fs.existsSync(absolute)) {
      findings.push(finding("missing_problem_bank", `${config.file} does not exist.`, {
        severity: config.scope === "runtime" ? "error" : "warning",
        file: config.file
      }));
      continue;
    }
    const rows = loadJson(absolute);
    banks.set(config.file, rows);
    const result = auditProblemRows({
      rows,
      file: config.file,
      root,
      scope: config.scope,
      config,
      frontendMath,
      compileMath
    });
    findings.push(...result.findings);
    summaries.push({
      file: config.file,
      scope: config.scope,
      rows: result.rowCount,
      errors: result.findings.filter((item) => item.severity === "error").length,
      warnings: result.findings.filter((item) => item.severity === "warning").length
    });
  }

  if (!options.runtimeOnly) {
    const artifactDir = path.resolve(root, "artifacts");
    let foundCurrentManifest = false;
    if (fs.existsSync(artifactDir)) {
      for (const name of fs.readdirSync(artifactDir).filter((item) => /^manifest_.*\.json$/.test(item)).sort()) {
        if (name === `manifest_${CURRENT_ARTIFACT_VERSION}.json`) {
          foundCurrentManifest = true;
        }
        const file = path.join(artifactDir, name);
        try {
          findings.push(...auditManifest({ root, file, manifest: loadJson(file) }));
        } catch (error) {
          findings.push(finding("manifest_invalid_json", error.message, {
            severity: name === `manifest_${CURRENT_ARTIFACT_VERSION}.json` ? "error" : "warning",
            file: path.relative(root, file).replaceAll(path.sep, "/")
          }));
        }
      }
    }
    if (!foundCurrentManifest) {
      findings.push(finding(
        "missing_current_manifest",
        `Required artifacts/manifest_${CURRENT_ARTIFACT_VERSION}.json is missing.`,
        {
          severity: "error",
          file: `artifacts/manifest_${CURRENT_ARTIFACT_VERSION}.json`
        }
      ));
    }

    const reportObjects = new Map();
    const dataDir = path.resolve(root, "data");
    if (fs.existsSync(dataDir)) {
      for (const name of fs.readdirSync(dataDir).filter((item) => /report.*\.json$|_report\.json$/i.test(item)).sort()) {
        const file = path.join(dataDir, name);
        try {
          reportObjects.set(`data/${name}`, loadJson(file));
        } catch (error) {
          findings.push(finding("report_invalid_json", error.message, {
            severity: "error",
            file: `data/${name}`
          }));
        }
      }
    }
    findings.push(...auditReportObjects({ objects: reportObjects, banks, root }));
  }

  return {
    summaries,
    findings: dedupeContextualFindings(findings)
  };
}

function printHuman(result) {
  for (const summary of result.summaries) {
    console.log(
      `${summary.file}: ${summary.rows} rows, ${summary.errors} errors, ${summary.warnings} warnings`
    );
  }
  const grouped = new Map();
  for (const item of result.findings) {
    const key = `${item.severity}:${item.code}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  for (const [key, items] of grouped.entries()) {
    console.log(`\n[${key}] ${items.length}`);
    for (const item of items.slice(0, 8)) {
      const location = [item.file, item.id, item.field].filter(Boolean).join(" ");
      console.log(`- ${location}: ${item.message}${item.snippet ? ` — ${item.snippet}` : ""}`);
    }
  }
  const errors = result.findings.filter((item) => item.severity === "error").length;
  const warnings = result.findings.filter((item) => item.severity === "warning").length;
  console.log(`\nProblem data audit: ${errors} errors, ${warnings} warnings.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await runAudit(options);
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  const errors = result.findings.filter((item) => item.severity === "error").length;
  const warnings = result.findings.filter((item) => item.severity === "warning").length;
  if (errors || (options.strictWarnings && warnings)) process.exitCode = 1;
}

module.exports = {
  BANKS,
  CURRENT_ARTIFACT_VERSION,
  auditManifest,
  auditProblemRows,
  auditReportObjects,
  createMathJaxCompiler,
  isAbruptPrompt,
  loadFrontendMath,
  runAudit,
  scanMathStructure
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
