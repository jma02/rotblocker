const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

test("bootstrap module executes without reference/runtime wiring errors", () => {
  const fns = loadChallengeFns({
    includeBootstrap: true,
    extensionRuntime: false,
    fetchImpl: async () => ({ ok: false, json: async () => [], text: async () => "" }),
    setTimeoutImpl: () => 0,
    clearTimeoutImpl() {},
    setIntervalImpl: () => 0,
    clearIntervalImpl() {}
  });

  assert.equal(typeof fns.bootstrapChallengeApp, "function");
  assert.equal(typeof fns.__sandbox.RB?.bootstrap?.bootstrapChallengeApp, "function");
});
