const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

test("assistant markdown supports headings and bold while preserving inline math", async () => {
  const typesetCalls = [];
  const fns = loadChallengeFns({
    windowMathJax: {
      typesetPromise: async (nodes) => {
        typesetCalls.push(nodes);
      }
    }
  });

  const el = fns.__sandbox.document.createElement("div");
  fns.renderAssistantMarkdownText(el, "# Strategy\nUse **parity** with $x+1$.");
  await fns.flushPendingMathTypeset();

  assert.match(el.innerHTML, /chat-md-heading chat-md-h1/);
  assert.match(el.innerHTML, /<strong>parity<\/strong>/);
  assert.match(el.innerHTML, /\$x\+1\$/);
  assert.equal(typesetCalls.length, 1);
});

test("assistant markdown keeps escaped asterisks literal inside and outside math", () => {
  const fns = loadChallengeFns();
  const el = fns.__sandbox.document.createElement("div");

  fns.renderAssistantMarkdownText(el, "Keep \\*literal\\* and $\\*x\\*$ then **bold**.");

  assert.match(el.innerHTML, /\*literal\*/);
  assert.doesNotMatch(el.innerHTML, /<em>literal<\/em>/);
  assert.match(el.innerHTML, /\\\*x\\\*/);
  assert.match(el.innerHTML, /<strong>bold<\/strong>/);
});

test("markdown-only follow-up clears prior math-pending marker", () => {
  const fns = loadChallengeFns({
    windowMathJax: null,
    setTimeoutImpl: () => 0,
    clearTimeoutImpl() {}
  });
  const el = fns.__sandbox.document.createElement("div");

  fns.renderAssistantMarkdownText(el, "Compute $x^2 + 1$.");
  assert.equal(el.dataset.mathPending, "1");

  fns.renderAssistantMarkdownText(el, "**Done**.");
  assert.equal(el.dataset.mathPending, undefined);
  assert.match(el.innerHTML, /<strong>Done<\/strong>/);
});
