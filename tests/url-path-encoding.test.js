const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

test("preview mode resolves assets from encoded rotblocker++ path", () => {
  const { resolveAssetPath } = loadChallengeFns({
    pathname: "/rotblocker%2B%2B/index.html",
    extensionRuntime: false
  });
  assert.equal(resolveAssetPath("data/amc8.json"), "../data/amc8.json");
  assert.equal(resolveAssetPath("/data/amc8.json"), "../data/amc8.json");
});

test("preview mode normalizes %2B path segments in the address bar", () => {
  const calls = [];
  const historyOverride = {
    state: { test: true },
    replaceState(state, _title, url) {
      calls.push({ state, url });
    }
  };

  const { canonicalizeRotblockerPreviewPath } = loadChallengeFns({
    pathname: "/rotblocker%2B%2B/index.html",
    search: "?tab=preview",
    hash: "#math",
    extensionRuntime: false,
    historyOverride
  });
  canonicalizeRotblockerPreviewPath();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    state: { test: true },
    url: "/rotblocker++/index.html?tab=preview#math"
  });
});
