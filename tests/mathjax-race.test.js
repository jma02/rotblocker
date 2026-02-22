const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

function makeEl() {
  return {
    dataset: {},
    textContent: "",
    innerHTML: ""
  };
}

test("renderMathText marks pending when MathJax is unavailable, then recovers", async () => {
  const fns = loadChallengeFns({ windowMathJax: null });
  const el = makeEl();

  fns.renderMathText(el, "$x^2+1$");
  assert.equal(el.dataset.mathPending, "1");

  let clearCalls = 0;
  let typesetCalls = 0;
  fns.__sandbox.window.MathJax = {
    typesetClear() {
      clearCalls += 1;
    },
    typesetPromise() {
      typesetCalls += 1;
      return Promise.resolve();
    }
  };

  await fns.flushPendingMathTypeset([el]);

  assert.equal(clearCalls, 1);
  assert.equal(typesetCalls, 1);
  assert.equal(el.dataset.mathPending, undefined);
});

test("assistant markdown math path also recovers after MathJax appears", async () => {
  const fns = loadChallengeFns({ windowMathJax: null });
  const el = makeEl();

  fns.renderAssistantMarkdownText(el, "Try **this**: $\\frac{1}{2}$");
  assert.equal(el.dataset.mathPending, "1");

  let typesetCalls = 0;
  fns.__sandbox.window.MathJax = {
    typesetPromise() {
      typesetCalls += 1;
      return Promise.resolve();
    }
  };

  await fns.flushPendingMathTypeset([el]);

  assert.equal(typesetCalls, 1);
  assert.equal(el.dataset.mathPending, undefined);
});

test("assistant markdown without math clears any prior pending marker", () => {
  const fns = loadChallengeFns({ windowMathJax: null });
  const el = makeEl();
  el.dataset.mathPending = "1";

  fns.renderAssistantMarkdownText(el, "Use **parity** and *mod arithmetic*.");

  assert.equal(el.dataset.mathPending, undefined);
  assert.match(el.innerHTML, /<strong>parity<\/strong>/);
});
