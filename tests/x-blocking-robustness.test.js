const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./background-harness");

function isChallengeUrl(url) {
  return typeof url === "string" && /\/rotblocker\+\+\/index\.html$/.test(url);
}

test("locked mode force-redirects x.com navigation via tabs fallback", async () => {
  const h = createBackgroundHarness({
    now: 50_000,
    initialStorage: {
      unlockedUntil: null,
      customBlockedDomains: []
    },
    initialTabs: [{ id: 7, url: "https://example.com" }]
  });

  await h.triggerTabUpdated(7, { url: "https://x.com/home" }, { id: 7, url: "https://x.com/home" });
  assert.equal(h.logs.tabUpdates.length, 1);
  assert.ok(isChallengeUrl(h.logs.tabUpdates[0].updateProperties?.url));
});

test("unlock window skips force-redirect fallback", async () => {
  const h = createBackgroundHarness({
    now: 60_000,
    initialStorage: {
      unlockedUntil: 70_000,
      customBlockedDomains: []
    },
    initialTabs: [{ id: 8, url: "https://example.com" }]
  });

  await h.triggerTabUpdated(8, { url: "https://x.com/explore" }, { id: 8, url: "https://x.com/explore" });
  assert.equal(h.logs.tabUpdates.length, 0);
});

test("tabs fallback also applies custom blocked domains while locked", async () => {
  const h = createBackgroundHarness({
    now: 90_000,
    initialStorage: {
      unlockedUntil: null,
      customBlockedDomains: ["doom.example.com"]
    },
    initialTabs: [{ id: 9, url: "https://example.com" }]
  });

  await h.triggerTabUpdated(9, { url: "https://doom.example.com/feed" }, { id: 9, url: "https://doom.example.com/feed" });
  assert.equal(h.logs.tabUpdates.length, 1);
  assert.ok(isChallengeUrl(h.logs.tabUpdates[0].updateProperties?.url));
});
