#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const files = ["data/amc8.json", "data/amc10.json", "data/amc12.json", "data/aime.json"];
const LEADING_ARTICLE_WORDS_RE = /^(?:regular|palindrome|circle|parabola|subset|sphere|sequence|fair|positive|hexagon|function|point|convex|triangle)\b/;

function countMatches(text, re) {
  const m = String(text || "").match(re);
  return m ? m.length : 0;
}

function countUnescapedDollars(text) {
  return countMatches(text, /(?<!\\)\$/g);
}

function normalizeSnippet(text) {
  return String(text || "").replace(/\s+/g, " ").slice(0, 220);
}

const checks = [
  {
    id: "mathml_markup",
    test: (s) => /<\/?(?:math|mrow|mi|mo|mn|msup|msub|mfrac)\b/i.test(s)
  },
  {
    id: "legacy_math_wrappers",
    test: (s) => /\[\/?\s*(?:mathjax|tex)\s*\]/i.test(s)
  },
  {
    id: "unsupported_tabular",
    test: (s) => /\\(?:begin|end)\{tabular\*?\}/.test(s)
  },
  {
    id: "unsupported_layout_directive",
    test: (s) => /\\(?:begingroup|endgroup)\b|\\setlength\s*\{\\tabcolsep\}|\\renewcommand\s*\{\\arraystretch\}/.test(s)
  },
  {
    id: "unsupported_emph_macro",
    test: (s) => /\\emph\s*\{/.test(s)
  },
  {
    id: "textdollar_macro",
    test: (s) => /\\textdollars?/.test(s)
  },
  {
    id: "unsupported_spacing_macros",
    test: (s) => /\\(?:hspace|vspace)\*?\{/.test(s)
  },
  {
    id: "suspicious_lowercase_lead",
    test: (s, ctx) => ctx.kind === "prompt" && LEADING_ARTICLE_WORDS_RE.test(String(s || "").trim())
  },
  {
    id: "empty_script_markers",
    test: (s) => /(?:\^\s*\{\s*\}|_\s*\{\s*\})/.test(s)
  },
  {
    id: "suspicious_double_dollar",
    test: (s) => /\$\$[0-9A-Za-z\\]/.test(s)
  },
  {
    id: "escaped_dollar_then_closing_dollar",
    test: (s) => /\\\$\d+(?:,\d{3})*(?:\.\d+)?\$/.test(s)
  },
  {
    id: "broken_text_macro",
    test: (s) => /(^|[^\\])text\{/.test(s)
  },
  {
    id: "choice_trailing_escaped_dollar",
    test: (_s, ctx) => ctx.kind === "choice" && /\\\$\s*$/.test(ctx.text)
  },
  {
    id: "unbalanced_unescaped_dollars",
    test: (s) => countUnescapedDollars(s) % 2 !== 0
  },
  {
    id: "unbalanced_display_delimiters",
    test: (s) => countMatches(s, /\\\[/g) !== countMatches(s, /\\\]/g)
  },
  {
    id: "unbalanced_inline_delimiters",
    test: (s) => countMatches(s, /\\\(/g) !== countMatches(s, /\\\)/g)
  }
];

const findings = new Map();
for (const check of checks) findings.set(check.id, []);

for (const file of files) {
  const abs = path.resolve(file);
  const data = JSON.parse(fs.readFileSync(abs, "utf8"));
  for (const problem of data) {
    const items = [{ kind: "prompt", text: problem.prompt }];
    if (Array.isArray(problem.choices)) {
      problem.choices.forEach((choice, idx) => {
        items.push({ kind: `choice_${idx}`, text: choice });
      });
    }
    for (const item of items) {
      const text = String(item.text || "");
      for (const check of checks) {
        if (check.test(text, { kind: item.kind.startsWith("choice") ? "choice" : "prompt", text })) {
          const bucket = findings.get(check.id);
          if (bucket.length < 8) {
            bucket.push({
              file,
              id: problem.id,
              kind: item.kind,
              snippet: normalizeSnippet(text)
            });
          }
        }
      }
    }
  }
}

let total = 0;
for (const [id, bucket] of findings.entries()) {
  if (!bucket.length) continue;
  total += bucket.length;
  console.log(`\n[${id}] sample findings: ${bucket.length}`);
  for (const f of bucket) {
    console.log(`- ${f.file} ${f.id} ${f.kind}: ${f.snippet}`);
  }
}

if (total > 0) {
  console.error(`\nProblem markup audit failed with ${total} sampled findings.`);
  process.exit(1);
}

console.log("Problem markup audit passed.");
