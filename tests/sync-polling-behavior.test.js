const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

test("desiredSyncDiagnosticsIntervalMs selects fast vs slow intervals", () => {
  const fns = loadChallengeFns({ extensionRuntime: false });
  assert.equal(fns.desiredSyncDiagnosticsIntervalMs({ available: false }), 5000);
  assert.equal(fns.desiredSyncDiagnosticsIntervalMs({ available: true, pending: true }), 5000);
  assert.equal(
    fns.desiredSyncDiagnosticsIntervalMs({ available: true, pending: false, lastError: "sync write failed" }),
    5000
  );
  assert.equal(fns.desiredSyncDiagnosticsIntervalMs({ available: true, pending: false, lastError: "" }), 30000);
});

test("sync diagnostics polling starts only while visible and restarts cleanly", () => {
  const setIntervalCalls = [];
  const clearIntervalCalls = [];
  let nextId = 1;

  const fns = loadChallengeFns({
    extensionRuntime: false,
    visibilityState: "hidden",
    setIntervalImpl(_fn, ms) {
      setIntervalCalls.push(ms);
      return nextId++;
    },
    clearIntervalImpl(id) {
      clearIntervalCalls.push(id);
    }
  });

  fns.restartSyncDiagnosticsPolling();
  assert.equal(setIntervalCalls.length, 0);

  fns.__sandbox.document.visibilityState = "visible";
  fns.restartSyncDiagnosticsPolling();
  assert.deepEqual(setIntervalCalls, [5000]);

  fns.restartSyncDiagnosticsPolling();
  assert.deepEqual(setIntervalCalls, [5000, 5000]);
  assert.deepEqual(clearIntervalCalls, [1]);

  fns.stopSyncDiagnosticsPolling();
  assert.deepEqual(clearIntervalCalls, [1, 2]);
});
