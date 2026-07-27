const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadChallengeFns } = require("./challenge-harness");

test("short OCR fractions and missing sqrt escapes normalize without losing operands", () => {
  const fns = loadChallengeFns();

  assert.equal(fns.normalizeChoiceMath("frac 12"), "$\\frac{1}{2}$");
  assert.equal(fns.normalizeChoiceMath("\\frac 12"), "$\\frac{1}{2}$");
  assert.equal(fns.normalizeChoiceMath("frac12"), "$\\frac{1}{2}$");
  assert.equal(fns.normalizeChoiceMath("sqrt{2}"), "$\\sqrt{2}$");
});

test("interior-notation repair does not rewrite ordinary prose ending in o", () => {
  const fns = loadChallengeFns();

  assert.equal(fns.sanitizeForMathJax("To No So Jo Do"), "To No So Jo Do");
  const notation = fns.sanitizeForMathJax(
    "f-1(Ao) = (f-1(A))o, where So denotes interior of S"
  );
  assert.match(notation, /A\^\\circ/);
  assert.match(notation, /\)\^\\circ/);
  assert.match(notation, /S\^\\circ denotes interior/);
});

test("choice rendering coerces both display delimiter styles to inline math", () => {
  const fns = loadChallengeFns();

  assert.equal(fns.normalizeChoiceMath("$$x^2+1$$"), "$x^2+1$");
  assert.equal(fns.normalizeChoiceMath("\\[x^2+1\\]"), "\\(x^2+1\\)");
  assert.equal(
    fns.normalizeChoiceMath("pi+$\\sqrt{2}$"),
    "$\\pi+\\sqrt{2}$"
  );
  assert.equal(
    fns.normalizeChoiceMath("[729,$\\infty$)"),
    "$[729,\\infty)$"
  );

  const button = fns.__sandbox.document.createElement("button");
  fns.renderMathText(button, "A. $$x^2+1$$", { inlineOnly: true });
  assert.equal(button.textContent, "A\u2060. $x^2+1$");
});

test("punctuation stabilization never injects word joiners into TeX", () => {
  const fns = loadChallengeFns();
  const el = fns.__sandbox.document.createElement("div");

  fns.renderMathText(el, "Compare $x, y$ next.");

  assert.match(el.textContent, /\$x, y\$/);
  assert.doesNotMatch(el.textContent, /\$x\u2060,/);
  assert.match(el.textContent, /next\u2060\./);
});

test("escaped currency is not mistaken for an inline-math opener", () => {
  const fns = loadChallengeFns();
  const parts = fns.splitMathSegments(
    "The fare is \\$2.40, then $\\frac{1}{2}$ per mile."
  );
  const mathParts = parts.filter((part) => part.kind === "math");

  assert.deepEqual(
    Array.from(mathParts, (part) => part.value),
    ["$\\frac{1}{2}$"]
  );
  assert.deepEqual(
    Array.from(
      fns.splitMathSegments("Cost \\$5 and $x$"),
      (part) => `${part.kind}:${part.value}`
    ),
    ["plain:Cost \\$5 and ", "math:$x$"]
  );
});

test("AMC8 postage currency stays literal while genuine numeric math stays segmented", () => {
  const fns = loadChallengeFns();
  const row = JSON.parse(fs.readFileSync("data/amc8.json", "utf8"))
    .find((item) => item.id === "amio-3ef8ec3920ddf121e8fedaa622fe1732");
  assert.ok(row);

  const once = fns.sanitizeForMathJax(row.prompt);
  const twice = fns.sanitizeForMathJax(once);
  const segments = fns.splitMathSegments(once);
  const math = segments.filter((part) => part.kind === "math").map((part) => part.value);

  assert.equal(twice, once);
  assert.equal((once.match(/\\\$7\.10/g) || []).length, 2);
  assert.ok(math.includes("$7$"));
  assert.ok(math.includes("$10$"));
  assert.ok(math.includes("$100$"));
  assert.equal(
    math.some((segment) => /postage|The amount|One dollar|\\\$7\.10/i.test(segment)),
    false
  );
});

test("AMC12 log-base operands remain operands instead of inferred exponents", () => {
  const fns = loadChallengeFns();
  const row = JSON.parse(fs.readFileSync("data/amc12.json", "utf8"))
    .find((item) => item.id === "amio-b4d0972c5fb5351b74e4648e973fe3a0");
  assert.ok(row);

  const sanitized = fns.sanitizeForMathJax(row.prompt);
  assert.equal(sanitized, row.prompt);
  assert.match(sanitized, /y=\\log_(?:x|\{x\}) 3,/);
  assert.doesNotMatch(sanitized, /\\log_(?:x|\{x\})\^3/);
  assert.equal(fns.sanitizeForMathJax(sanitized), sanitized);
});

test("AMC12 prose explaining log notation stays outside math delimiters", () => {
  const fns = loadChallengeFns();
  const row = JSON.parse(fs.readFileSync("data/amc12.json", "utf8"))
    .find((item) => item.id === "amio-536444f8c922ff0dba205bd5e4ccbfd6");
  assert.ok(row);

  const sanitized = fns.sanitizeForMathJax(row.prompt);
  assert.equal(sanitized, row.prompt);
  assert.match(sanitized, /where log denotes the base \$10\$ logarithm/);
  assert.doesNotMatch(sanitized, /\$\\log denotes\$/);
  assert.equal(fns.sanitizeForMathJax(sanitized), sanitized);
});

test("AMC8 signed-currency choices display one literal dollar sign", () => {
  const fns = loadChallengeFns();
  const row = JSON.parse(fs.readFileSync("data/amc8.json", "utf8"))
    .find((item) => item.id === "amio-fe3731a3a59d156070d78b30c9e0d888");
  assert.ok(row);

  const legacyWrapped = {
    ...row,
    choices: ["$-\\$ 1.06$", "$-\\$ 0.53$", ...row.choices.slice(2)]
  };
  for (const problem of [row, legacyWrapped]) {
    const prepared = fns.prepareProblemForBank(problem);
    assert.ok(prepared);
    assert.deepEqual(
      Array.from(prepared.__normalizedChoices.slice(0, 2)),
      ["-\\$1.06", "-\\$0.53"]
    );
  }

  const prepared = fns.prepareProblemForBank(legacyWrapped);
  for (const [index, expected] of ["-$1.06", "-$0.53"].entries()) {
    const button = fns.__sandbox.document.createElement("button");
    const label = "AB"[index];
    fns.renderMathText(
      button,
      `${label}. ${prepared.__normalizedChoices[index]}`,
      { inlineOnly: true }
    );
    assert.equal(button.textContent, `${label}\u2060. ${expected}`);
  }
});

test("trailing numeric math and plain trailing numbers survive repeated sanitization", () => {
  const fns = loadChallengeFns();
  for (const value of [
    "The answer is $24$",
    "Choose $7$",
    "Then obtain $19$",
    "The minimum is $0$",
    "There are $3$",
    "A scan ends with the page-relevant number 24"
  ]) {
    const once = fns.sanitizeForMathJax(value);
    assert.equal(fns.sanitizeForMathJax(once), once, value);
    assert.match(once, /\d+/, value);
  }
});

test("shipped AMC8 choices contain no leaked diagram notes or credits", () => {
  const rows = JSON.parse(fs.readFileSync("data/amc8.json", "utf8"));
  const noteLeak = rows.find((item) => item.id === "amio-b9979cb9613ec70e0886881b00e6a7ab");
  const creditLeak = rows.find((item) => item.id === "amio-fe18aad6e52038198dd0f9c9c01eecef");

  assert.equal(noteLeak.choices[4], "5");
  assert.equal(creditLeak.choices[4], "32");
  assert.equal(creditLeak.answer, "32");
});

test("escaped literal braces do not make plain prose look mathematical or malformed", () => {
  const fns = loadChallengeFns();

  assert.equal(fns.hasRenderableMathSyntax("Use the literal set braces \\{ and \\}."), false);
  assert.equal(fns.hasMalformedMathSyntax("Use \\{1,2,3\\} as a set."), false);
});

test("bare legacy display environments become valid delimited math", () => {
  const fns = loadChallengeFns();
  const sanitized = fns.sanitizeForMathJax(
    "Compute \\begin{align*}a &= $x^2$\\\\b &= y\\end{align*} now."
  );

  assert.match(
    sanitized,
    /\\\[\\begin\{aligned\}a &= x\^2\\\\b &= y\\end\{aligned\}\\\]/
  );
  assert.doesNotMatch(sanitized, /\\begin\{align\*\}/);
  assert.equal(
    fns.sanitizeForMathJax("$$\\begin{aligned}x&=1\\end{aligned}$$"),
    "$$\\begin{aligned}x&=1\\end{aligned}$$"
  );
});

test("assistant rendering preserves line structure and multiline display math", () => {
  const fns = loadChallengeFns();
  const el = fns.__sandbox.document.createElement("div");

  fns.renderAssistantMarkdownText(
    el,
    "# Plan\nFirst step.\n$$\nx^2+1\n$$\n**Done**"
  );

  assert.match(el.innerHTML, /chat-md-heading chat-md-h1/);
  assert.match(el.innerHTML, /<\/span><br>First/);
  assert.match(el.innerHTML, /\$\$\nx\^2\+1\n\$\$/);
  assert.doesNotMatch(el.innerHTML, /\$\$<br>x\^2/);
  assert.doesNotMatch(el.innerHTML, /x\^2\+1<br>\$\$/);
  assert.match(el.innerHTML, /<br><strong>Done<\/strong>/);
});

test("assistant rendering does not apply lossy OCR guesses to valid model math", () => {
  const fns = loadChallengeFns();
  const el = fns.__sandbox.document.createElement("div");

  fns.renderAssistantMarkdownText(
    el,
    "Keep $T/2$, $I/2$, and $f-1(x)$ exactly as written."
  );

  assert.match(el.innerHTML, /\$T\/2\$/);
  assert.match(el.innerHTML, /\$I\/2\$/);
  assert.match(el.innerHTML, /\$f-1\(x\)\$/);
  assert.doesNotMatch(el.innerHTML, /\\pi|f\^\{-1\}/);
});

test("appendChat routes assistant math through the lossless renderer", () => {
  const fns = loadChallengeFns();
  fns.appendChat("assistant", "Keep $T/2$, $I/2$, and $f-1(x)$ exactly.");

  const chat = fns.__elementsById.get("ai-chat");
  const body = chat.children.at(-1).children[1];
  assert.match(body.innerHTML, /\$T\/2\$/);
  assert.match(body.innerHTML, /\$I\/2\$/);
  assert.match(body.innerHTML, /\$f-1\(x\)\$/);
  assert.doesNotMatch(body.innerHTML, /\\pi|f\^\{-1\}/);
});

test("malformed TeX guard rejects dangling scripts and mismatched environments", () => {
  const fns = loadChallengeFns();

  assert.equal(fns.hasMalformedMathSyntax("$\\log_$"), true);
  assert.equal(
    fns.hasMalformedMathSyntax("$$\\begin{aligned}x&=1\\end{array}$$"),
    true
  );
  assert.equal(
    fns.hasMalformedMathSyntax("$$\\begin{aligned}x&=1\\end{aligned}$$"),
    false
  );
});

test("queued MathJax work drops an obsolete render revision", async () => {
  const typesetInputs = [];
  let clearCalls = 0;
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear() {
        clearCalls += 1;
      },
      typesetPromise(nodes) {
        typesetInputs.push(nodes[0].textContent);
        return Promise.resolve();
      }
    }
  });
  const el = fns.__sandbox.document.createElement("div");

  fns.renderMathText(el, "$x$");
  fns.renderMathText(el, "$y$");
  await fns.flushPendingMathTypeset([]);

  assert.deepEqual(typesetInputs, ["$y$"]);
  assert.equal(clearCalls, 2);
  assert.equal(el.dataset.mathPending, undefined);
  assert.equal(el.dataset.mathTypeset, "1");
});

test("concurrent flushes coalesce the same element revision", async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear() {},
      typesetPromise() {
        calls += 1;
        return held;
      }
    }
  });
  const el = fns.__sandbox.document.createElement("div");
  fns.renderMathText(el, "$x$");

  const first = fns.flushPendingMathTypeset([el]);
  const second = fns.flushPendingMathTypeset([el]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);

  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(el.dataset.mathTypeset, "1");
});

test("synchronous MathJax clear/typeset throws still settle the render callback", async () => {
  let committed = 0;
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear() {
        throw new Error("clear failed");
      },
      typesetPromise() {
        throw new Error("typeset failed");
      }
    }
  });
  const el = fns.__sandbox.document.createElement("div");
  fns.renderMathText(el, "$x$", {
    onCommitted() {
      committed += 1;
    }
  });
  await fns.flushPendingMathTypeset([]);

  assert.equal(committed, 1);
  assert.equal(el.textContent, "$x$");
  assert.equal(el.dataset.mathPending, "1");
});

test("DOM replacement waits for an in-flight MathJax typeset", async () => {
  let releaseFirst;
  const firstTypeset = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const inputs = [];
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear() {},
      typesetPromise(nodes) {
        inputs.push(nodes[0].textContent);
        return inputs.length === 1 ? firstTypeset : Promise.resolve();
      }
    }
  });
  const el = fns.__sandbox.document.createElement("div");

  fns.renderMathText(el, "$x$");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(inputs, ["$x$"]);

  fns.renderMathText(el, "$y$");
  assert.equal(el.textContent, "$x$", "must not mutate source DOM during an active typeset");

  releaseFirst();
  await fns.flushPendingMathTypeset([]);
  assert.equal(el.textContent, "$y$");
  assert.deepEqual(inputs, ["$x$", "$y$"]);
});

test("queued MathJax work skips a real detached node", async () => {
  let typesetCalls = 0;
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear() {},
      typesetPromise() {
        typesetCalls += 1;
        return Promise.resolve();
      }
    }
  });
  const el = fns.__sandbox.document.createElement("div");

  fns.renderMathText(el, "$x$");
  Object.defineProperty(el, "isConnected", { value: false, configurable: true });
  await fns.flushPendingMathTypeset([]);

  assert.equal(typesetCalls, 0);
});

test("a choice attached before rendering is populated with real isConnected semantics", async () => {
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear() {},
      typesetPromise() {
        return Promise.resolve();
      }
    }
  });
  const container = fns.__sandbox.document.createElement("div");
  const choice = fns.__sandbox.document.createElement("button");
  Object.defineProperty(choice, "isConnected", {
    configurable: true,
    get() {
      return choice.parentNode === container;
    }
  });

  container.appendChild(choice);
  fns.renderMathText(choice, "A. $x$");
  await fns.flushPendingMathTypeset([]);

  assert.equal(choice.textContent, "A\u2060. $x$");
  assert.equal(choice.dataset.mathTypeset, "1");
});

test("a newly created tutor node is populated before append and typeset after append", async () => {
  let typesetCalls = 0;
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear() {},
      typesetPromise() {
        typesetCalls += 1;
        return Promise.resolve();
      }
    }
  });
  const container = fns.__sandbox.document.createElement("div");
  const body = fns.__sandbox.document.createElement("span");
  Object.defineProperty(body, "isConnected", {
    configurable: true,
    get() {
      return body.parentNode === container;
    }
  });

  fns.renderAssistantMarkdownText(body, "Use $x^2$.");
  assert.match(body.innerHTML, /\$x\^2\$/);
  container.appendChild(body);
  await fns.flushPendingMathTypeset([]);

  assert.equal(typesetCalls, 1);
  assert.equal(body.dataset.mathTypeset, "1");
});

test("container replacement clears descendants and cancels their queued typesets", async () => {
  const cleared = [];
  const typeset = [];
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetClear(nodes) {
        cleared.push(nodes[0]);
      },
      typesetPromise(nodes) {
        typeset.push(nodes[0]);
        return Promise.resolve();
      }
    }
  });
  const container = fns.__sandbox.document.createElement("div");
  const child = fns.__sandbox.document.createElement("button");
  container.appendChild(child);

  fns.renderMathText(child, "$x$");
  await fns.replaceMathContainer(container, () => {
    container.removeChild(child);
    Object.defineProperty(child, "isConnected", { value: false, configurable: true });
  });
  await fns.flushPendingMathTypeset([]);

  assert.equal(typeset.includes(child), false);
  assert.equal(cleared.includes(container), true);
});

test("MathJax startup is manual and tutor display math has overflow protection", () => {
  const config = fs.readFileSync("mathjax-config.js", "utf8");
  const css = fs.readFileSync("challenge.css", "utf8");

  assert.match(config, /startup:\s*\{[\s\S]*?typeset:\s*false/);
  assert.match(config, /processEnvironments:\s*true/);
  assert.match(css, /\.chat-message-body mjx-container\[display="true"\]/);
  assert.match(css, /overflow-x:\s*auto/);
});
