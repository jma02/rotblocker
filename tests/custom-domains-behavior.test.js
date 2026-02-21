const test = require("node:test");
const assert = require("node:assert/strict");
const { createBackgroundHarness } = require("./background-harness");

const CUSTOM_RULE_ID_BASE = 10000;
const CUSTOM_RULE_ID_LIMIT = 500;
const MAX_CUSTOM_DOMAINS = 200;

function normalizeDomainOracle(input) {
  let domain = String(input || "").trim().toLowerCase();
  if (!domain) return null;

  domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  domain = domain.replace(/^\/+/, "");
  domain = domain.split(/[/?#]/)[0];
  domain = domain.replace(/:\d+$/, "");
  domain = domain.replace(/^\*\./, "");
  domain = domain.replace(/\.$/, "");
  if (domain.startsWith("www.")) domain = domain.slice(4);
  if (!domain) return null;
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  if (domain.includes("..")) return null;
  if (domain === "localhost") return domain;

  const labels = domain.split(".");
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (!/^[a-z0-9-]+$/.test(label)) return null;
    if (label.startsWith("-") || label.endsWith("-")) return null;
    if (label.length > 63) return null;
  }
  if (labels[labels.length - 1].length < 2) return null;
  return domain;
}

function managedRulesFrom(harness) {
  return harness.getDynamicRules()
    .filter((rule) => rule.id >= CUSTOM_RULE_ID_BASE && rule.id < CUSTOM_RULE_ID_BASE + CUSTOM_RULE_ID_LIMIT)
    .sort((a, b) => a.id - b.id);
}

function assertManagedRulesMatchDomains(harness, expectedDomains) {
  const managed = managedRulesFrom(harness);
  assert.equal(managed.length, expectedDomains.length);
  for (let i = 0; i < managed.length; i += 1) {
    const rule = managed[i];
    assert.equal(rule.id, CUSTOM_RULE_ID_BASE + i);
    assert.equal(rule.action?.type, "block");
    assert.equal(rule.condition?.urlFilter, `||${expectedDomains[i]}`);
    assert.deepEqual(rule.condition?.resourceTypes, ["main_frame"]);
  }
}

test("custom domain add/remove normalizes inputs, deduplicates, and enforces limit", async () => {
  const h = createBackgroundHarness({
    now: 10_000,
    initialStorage: {
      unlockedUntil: null,
      customBlockedDomains: [],
      customDomainsUpdatedAt: 0
    }
  });

  const expected = [];
  const samples = [
    "HTTP://WWW.Example.COM/path?x=1",
    "https://foo.bar:443",
    "*.docs.google.com",
    "localhost",
    "bad_domain",
    "bad..domain.com",
    "-bad.com",
    "bad-.com",
    "a",
    "",
    "www.example.com"
  ];

  for (let i = 0; i < 260; i += 1) {
    const candidate = i < samples.length
      ? samples[i]
      : `https://www.d${i}.example.com/path?q=${i}`;
    const normalized = normalizeDomainOracle(candidate);
    const res = await h.sendMessage({ type: "ADD_CUSTOM_DOMAIN", domain: candidate });

    if (!normalized) {
      assert.equal(res.response.ok, false, `expected invalid for ${candidate}`);
      continue;
    }
    if (expected.includes(normalized)) {
      assert.equal(res.response.ok, true);
      assert.equal(res.response.added, false);
      continue;
    }
    if (expected.length >= MAX_CUSTOM_DOMAINS) {
      assert.equal(res.response.ok, false);
      assert.match(res.response.error, new RegExp(`Limit reached \\(${MAX_CUSTOM_DOMAINS} domains\\)`));
      continue;
    }

    expected.push(normalized);
    assert.equal(res.response.ok, true);
    assert.equal(res.response.added, true);
    assert.equal(res.response.domain, normalized);
  }

  const list = await h.sendMessage({ type: "GET_CUSTOM_DOMAINS" });
  assert.equal(list.response.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(list.response.domains)), expected);
  assert.equal(expected.length, MAX_CUSTOM_DOMAINS);
  assertManagedRulesMatchDomains(h, expected);

  const removals = [
    "WWW.EXAMPLE.COM",
    "https://docs.google.com/path",
    "*.d205.example.com",
    "invalid_domain",
    "localhost"
  ];

  for (const item of removals) {
    const normalized = normalizeDomainOracle(item);
    const before = await h.sendMessage({ type: "GET_CUSTOM_DOMAINS" });
    const res = await h.sendMessage({ type: "REMOVE_CUSTOM_DOMAIN", domain: item });
    const had = normalized ? before.response.domains.includes(normalized) : false;

    if (!normalized) {
      assert.equal(res.response.ok, false);
      continue;
    }
    assert.equal(res.response.ok, true);
    assert.equal(res.response.removed, had);
  }

  const after = await h.sendMessage({ type: "GET_CUSTOM_DOMAINS" });
  assertManagedRulesMatchDomains(h, after.response.domains);
});

test("custom domain dynamic rules toggle with lock/unlock transitions", async () => {
  const h = createBackgroundHarness({
    now: 20_000,
    initialStorage: {
      score: 0,
      unlockedUntil: null,
      customBlockedDomains: [],
      customDomainsUpdatedAt: 0
    }
  });

  await h.sendMessage({ type: "ADD_CUSTOM_DOMAIN", domain: "a.example.com" });
  await h.sendMessage({ type: "ADD_CUSTOM_DOMAIN", domain: "b.example.com" });
  assertManagedRulesMatchDomains(h, ["a.example.com", "b.example.com"]);

  h.setStorage({ score: 30 });
  const unlocked = await h.sendMessage({ type: "REQUEST_UNLOCK" });
  assert.equal(unlocked.response.ok, true);
  assertManagedRulesMatchDomains(h, []);

  const relocked = await h.sendMessage({ type: "RELOCK" });
  assert.equal(relocked.response.ok, true);
  assertManagedRulesMatchDomains(h, ["a.example.com", "b.example.com"]);
});

test("startup applies custom domain rules based on lock state and preserves unmanaged rules", async () => {
  const unmanaged = {
    id: 99,
    priority: 1,
    action: { type: "allow" },
    condition: { urlFilter: "||safe.example", resourceTypes: ["main_frame"] }
  };

  const hUnlocked = createBackgroundHarness({
    now: 5_000,
    initialStorage: {
      unlockedUntil: 10_000,
      customBlockedDomains: ["a.example.com", "b.example.com"],
      customDomainsUpdatedAt: 1
    },
    initialDynamicRules: [
      unmanaged,
      { id: 10000, priority: 1, action: { type: "block" }, condition: { urlFilter: "||old.example", resourceTypes: ["main_frame"] } }
    ]
  });
  await hUnlocked.triggerStartup();
  assertManagedRulesMatchDomains(hUnlocked, []);
  assert.ok(hUnlocked.getDynamicRules().some((r) => r.id === unmanaged.id), "unmanaged rule should be preserved");

  const hLocked = createBackgroundHarness({
    now: 5_000,
    initialStorage: {
      unlockedUntil: null,
      customBlockedDomains: ["a.example.com", "b.example.com"],
      customDomainsUpdatedAt: 1
    },
    initialDynamicRules: [
      unmanaged,
      { id: 10000, priority: 1, action: { type: "block" }, condition: { urlFilter: "||stale.example", resourceTypes: ["main_frame"] } }
    ]
  });
  await hLocked.triggerStartup();
  assertManagedRulesMatchDomains(hLocked, ["a.example.com", "b.example.com"]);
  assert.ok(hLocked.getDynamicRules().some((r) => r.id === unmanaged.id), "unmanaged rule should be preserved");
});
