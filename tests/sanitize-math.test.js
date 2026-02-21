const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadChallengeFns } = require("./challenge-harness");

const { sanitizeForMathJax } = loadChallengeFns();

test("currency wrapper normalization preserves the matched amount", () => {
  const input = "Asters cost $\\$1$ each, cannas $\\$2$ each, and Easter lilies $$ $3$ each.";
  const output = sanitizeForMathJax(input);
  assert.equal(
    output,
    "Asters cost \\$1 each, cannas \\$2 each, and Easter lilies \\$3 each."
  );
});

test("rose flower-bed prompt keeps all price amounts", () => {
  const amc10 = JSON.parse(fs.readFileSync("data/amc10.json", "utf8"));
  const rose = amc10.find((p) => String(p.prompt || "").includes("Rose fills each of the rectangular regions"));
  assert.ok(rose, "expected Rose prompt in AMC10 dataset");
  const out = sanitizeForMathJax(rose.prompt);
  assert.match(out, /\\\$1 each/);
  assert.match(out, /\\\$1\.50 each/);
  assert.match(out, /\\\$2 each/);
  assert.match(out, /\\\$2\.50 each/);
  assert.match(out, /\\\$3 each/);
});

test("empty script markers are removed from coin-toss prompt", () => {
  const aime = JSON.parse(fs.readFileSync("data/aime.json", "utf8"));
  const prompt = aime.find((p) => p.id === "amio-161edc1db5e74a0c2e2402ce15daae4b");
  assert.ok(prompt, "expected coin toss prompt in AIME dataset");
  const out = sanitizeForMathJax(prompt.prompt);
  assert.equal(
    out,
    "A fair coin is to be tossed $10$ times. Let $\\frac{i}{j}$, in lowest terms, be the probability that heads never occur on consecutive tosses. Find $i+j$"
  );
});

test("trivial inline numeric math is flattened for prose prompts", () => {
  const amc10 = JSON.parse(fs.readFileSync("data/amc10.json", "utf8"));
  const prompt = amc10.find((p) => p.id === "amio-e278cfd0dbc6f6131d0c7c0487d25160");
  assert.ok(prompt, "expected arithmetic/geometric progression prompt in AMC10 dataset");
  const out = sanitizeForMathJax(prompt.prompt);
  assert.equal(
    out,
    "A sequence of three real numbers forms an arithmetic progression with a first term of 9. If 2 is added to the second term and 20 is added to the third term, the three resulting numbers form a geometric progression. What is the smallest possible value for the third term in the geometric progression?"
  );
});

test("punctuation spacing is normalized in prose/math joins", () => {
  const input = "numbers form a progression . What is the value, in dollars , for her garden ?";
  const out = sanitizeForMathJax(input);
  assert.equal(out, "numbers form a progression. What is the value, in dollars, for her garden?");
});

test("GRE OCR lim and scan-noise fragments are normalized", () => {
  const input = "Evaluate: limx→0+ (sinx x )1/x^2. 25";
  const out = sanitizeForMathJax(input);
  assert.equal(out, "Evaluate: \\lim_{x\\to 0+} (\\frac{\\sin x}{x})1/x^2.");
});

test("scan footer labels are stripped from noisy choice strings", () => {
  const input = "ST +TS is the identity map of V Linear Algebra #2";
  const out = sanitizeForMathJax(input);
  assert.equal(out, "ST +TS is the identity map of V");
});
