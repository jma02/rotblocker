const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadChallengeFns } = require("./challenge-harness");

const BANKS = [
  "amc8",
  "amc10",
  "amc12",
  "aime",
  "olympiad",
  "upper_level_mcq",
  "calculus_mcq_synthetic"
];

test("all 16,852 shipped prompt, choice, and answer strings sanitize idempotently", () => {
  const fns = loadChallengeFns();
  const failures = [];
  let checked = 0;

  for (const bank of BANKS) {
    const rows = JSON.parse(fs.readFileSync(`data/${bank}.json`, "utf8"));
    for (const row of rows) {
      const fields = [
        ["prompt", row.prompt],
        ...(row.choices || []).map((choice, index) => [`choices[${index}]`, choice]),
        ["answer", row.answer]
      ];
      for (const [field, raw] of fields) {
        if (typeof raw !== "string") continue;
        checked += 1;
        const once = fns.sanitizeForMathJax(raw);
        const twice = fns.sanitizeForMathJax(once);
        const segments = fns.splitMathSegments(once);
        const mathSegments = segments.filter((part) => part.kind === "math");
        const swallowedProse = mathSegments.some((part) => {
          const withoutTextMacros = part.value
            .replace(/\\(?:text|textbf|mathrm|mathbf)\{[^{}]*\}/g, "");
          if (/\\begin\{(?:array|matrix|aligned)\}/.test(withoutTextMacros)) return false;
          return /\b(?:what|which|suppose|postage|the amount|one dollar|find|determine|compute|according to|shown below)\b/i
            .test(withoutTextMacros);
        });

        if (
          once !== twice
          || (raw.trim() && !once.trim())
          || fns.hasMalformedMathSyntax(once)
          || segments.map((part) => part.value).join("") !== once
          || mathSegments.some((part) => /\\\$\d/.test(part.value))
          || swallowedProse
        ) {
          failures.push({
            bank,
            id: row.id,
            field,
            raw,
            once,
            twice
          });
        }
      }
    }
  }

  assert.equal(checked, 16852);
  assert.deepEqual(failures, []);
});
