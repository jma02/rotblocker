const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadChallengeFns } = require("./challenge-harness");

const { sanitizeForMathJax, normalizeChoiceMath, hasRenderableMathSyntax } = loadChallengeFns();

test("sanitizer rule coverage: wrappers/macros/currency/layout", () => {
  const cases = [
    {
      name: "strips [tex] wrappers",
      input: "[tex] x [/tex]",
      expected: "x",
      trim: true
    },
    {
      name: "strips [mathjax] wrappers",
      input: "[mathjax]Area is $9$[/mathjax]",
      expected: "Area is 9",
      trim: true
    },
    {
      name: "strips MathML tags",
      input: "<math><mi>x</mi><mo>+</mo><mn>1</mn></math>",
      expected: "x + 1",
      trim: true
    },
    {
      name: "normalizes overarc",
      input: "\\overarc{AB}",
      expected: "\\overset{\\frown}{AB}",
      trim: false
    },
    {
      name: "normalizes emph",
      input: "\\emph{hello}",
      expected: "\\text{hello}",
      trim: false
    },
    {
      name: "removes layout directives",
      input: "\\begingroup A \\setlength{\\tabcolsep}{10pt} \\renewcommand{\\arraystretch}{1.5} \\endgroup",
      expected: "A",
      trim: true
    },
    {
      name: "tabular maps to array",
      input: "\\begin{tabular}{cc}A&B\\\\C&D\\end{tabular}",
      expected: "\\begin{array}{cc}A&B\\\\C&D\\end{array}",
      trim: false
    },
    {
      name: "tabular* maps to array",
      input: "\\begin{tabular*}{\\textwidth}{cc}A&B\\end{tabular*}",
      expected: "\\begin{array}{cc}A&B\\end{array}",
      trim: false
    },
    {
      name: "multicolumn unwraps payload",
      input: "\\multicolumn{2}{c}{ABC}",
      expected: "ABC",
      trim: false
    },
    {
      name: "textdollar macro becomes escaped dollar",
      input: "\\textdollar2.50 each",
      expected: "\\$2.50 each",
      trim: false
    },
    {
      name: "broken currency wrapper is normalized",
      input: "$\\$3$ each",
      expected: "\\$3 each",
      trim: false
    },
    {
      name: "likely currency dollar gets escaped",
      input: "Price is $12 each and next is $13.",
      expected: "Price is \\$12 each and next is \\$13.",
      trim: false
    },
    {
      name: "math span is preserved (not treated as currency)",
      input: "Price is $12 each, math is $2x+1$.",
      expected: "Price is \\$12 each, math is $2x+1$.",
      trim: false
    },
    {
      name: "empty script markers are removed",
      input: "x_{}^{} + y^{}_{ } + z_{   }",
      expected: "x + y + z",
      trim: false
    },
    {
      name: "spacing macros removed",
      input: "\\hspace{1cm}A\\vspace{2mm}B",
      expected: "A B",
      trim: true
    },
    {
      name: "thin rule converted",
      input: "\\rule{0.5cm}{0.15mm}",
      expected: "\\underline{\\phantom{00}}",
      trim: false
    },
    {
      name: "punctuation spacing fixed",
      input: "A , B ; C : D ? E !",
      expected: "A, B; C: D? E!",
      trim: false
    },
    {
      name: "command-containing currency math is preserved",
      input: "$\\$\\underline{1}\\underline{A}\\underline{2}$",
      expected: "$\\$\\underline{1}\\underline{A}\\underline{2}$",
      trim: false
    },
    {
      name: "dangling dollar is escaped",
      input: "$5",
      expected: "\\$5",
      trim: false
    },
    {
      name: "trivial numeric inline math flattens to text",
      input: "If $2$ is added to $20$.",
      expected: "If 2 is added to 20.",
      trim: false
    },
    {
      name: "when TeX command exists, inline math delimiters stay",
      input: "$x$ and $3$ and $\\frac{1}{2}$",
      expected: "$x$ and $3$ and $\\frac{1}{2}$",
      trim: false
    },
    {
      name: "repairs missing backslash frac macro",
      input: "frac14",
      expected: "\\frac{1}{4}",
      trim: false
    },
    {
      name: "repairs mixed-number style malformed frac",
      input: "5\\frac12",
      expected: "5\\frac{1}{2}",
      trim: false
    },
    {
      name: "repairs denominator token after braced numerator",
      input: "\\frac{1}\\pi",
      expected: "\\frac{1}{\\pi}",
      trim: false
    },
    {
      name: "repairs spaced malformed frac with braced denominator",
      input: "frac 7{16}",
      expected: "\\frac{7}{16}",
      trim: false
    }
  ];

  for (const tc of cases) {
    const raw = sanitizeForMathJax(tc.input);
    const got = tc.trim ? raw.trim() : raw;
    assert.equal(got, tc.expected, tc.name);
  }
});

test("normalizeChoiceMath enforces inline-safe choice rendering", () => {
  assert.equal(normalizeChoiceMath("\\[x^2\\]"), "\\(x^2\\)");
  assert.equal(normalizeChoiceMath("x^2+1"), "$x^2+1$");
  assert.equal(normalizeChoiceMath("$x^2$"), "$x^2$");
  assert.equal(normalizeChoiceMath("frac14"), "$\\frac{1}{4}$");
  assert.equal(normalizeChoiceMath("5\\frac12"), "$5\\frac{1}{2}$");
  assert.equal(normalizeChoiceMath("1 3"), "$\\frac{1}{3}$");
  assert.equal(normalizeChoiceMath("e 2"), "$e^2$");
  assert.equal(normalizeChoiceMath("\\pi 2"), "$\\frac{\\pi}{2}$");
});

test("hasRenderableMathSyntax detects math-bearing text", () => {
  assert.equal(hasRenderableMathSyntax("plain sentence"), false);
  assert.equal(hasRenderableMathSyntax("x+1"), false);
  assert.equal(hasRenderableMathSyntax("$x$"), true);
  assert.equal(hasRenderableMathSyntax("\\frac{1}{2}"), true);
  assert.equal(hasRenderableMathSyntax("x_{1}"), true);
});

test("dataset guardrails: no empty script marker artifacts remain", () => {
  const files = ["data/amc8.json", "data/amc10.json", "data/amc12.json", "data/aime.json"];
  for (const file of files) {
    const entries = JSON.parse(fs.readFileSync(file, "utf8"));
    const broken = entries.find((p) => {
      const prompt = String(p.prompt || "");
      const choices = Array.isArray(p.choices) ? p.choices.join(" ") : "";
      return /(?:\^\s*\{\s*\}|_\s*\{\s*\})/.test(`${prompt} ${choices}`);
    });
    assert.equal(Boolean(broken), false, `${file} contains empty script marker artifacts`);
  }
});
