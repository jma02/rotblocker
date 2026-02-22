const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let playwright = null;
try {
  playwright = require("playwright");
} catch (_err) {
  // Optional dependency; these tests skip when unavailable.
}

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
};

function startStaticServer(rootDir) {
  const server = http.createServer((req, res) => {
    try {
      const reqPath = String(req.url || "/").split("?")[0];
      const decoded = decodeURIComponent(reqPath);
      const safe = decoded.replace(/^\/+/, "");
      let filePath = path.join(rootDir, safe);

      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
      }
      if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end("not found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME_BY_EXT[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    } catch (_err) {
      res.writeHead(500);
      res.end("server error");
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: addr.port });
    });
  });
}

let browser = null;
let serverRef = null;
let baseUrl = "";
let skipReason = null;

test.before(async () => {
  if (!playwright) {
    skipReason = "playwright package is not installed";
    return;
  }
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    const raw = String(err && err.message ? err.message : err);
    const firstLine = raw.split("\n")[0];
    skipReason = `playwright chromium is unavailable: ${firstLine}`;
    return;
  }
  serverRef = await startStaticServer(process.cwd());
  baseUrl = `http://127.0.0.1:${serverRef.port}`;
});

test.after(async () => {
  if (browser) {
    await browser.close();
  }
  if (serverRef?.server) {
    await new Promise((resolve) => serverRef.server.close(resolve));
  }
});

function ensureE2eAvailable(t) {
  if (skipReason) {
    t.skip(skipReason);
    return false;
  }
  return true;
}

async function withChallengePage(t, options, run) {
  if (!ensureE2eAvailable(t)) return;

  const opts = options || {};
  const relPath = opts.path || "/rotblocker%2B%2B/";
  const waitForProblem = opts.waitForProblem !== false;
  const allowedConsoleErrorPatterns = Array.isArray(opts.allowedConsoleErrorPatterns)
    ? opts.allowedConsoleErrorPatterns
    : [];

  const context = await browser.newContext();
  if (typeof opts.initScript === "function") {
    await context.addInitScript(opts.initScript);
  }
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      const allowed = allowedConsoleErrorPatterns.some((pattern) => {
        if (pattern instanceof RegExp) return pattern.test(text);
        return String(text).includes(String(pattern));
      });
      if (!allowed) {
        consoleErrors.push(text);
      }
    }
  });

  try {
    if (typeof opts.beforeGoto === "function") {
      await opts.beforeGoto(page);
    }

    await page.goto(`${baseUrl}${relPath}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#status", { timeout: 20_000 });
    if (waitForProblem) {
      await page.waitForSelector("#problem", { timeout: 20_000 });
    }
    await run({ page, context, pageErrors, consoleErrors });
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await context.close();
  }
}

async function ensureTutorInitialized(page) {
  await page.waitForSelector("#ai-input", { timeout: 20_000 });
  await page.click("#ai-input");
  await page.waitForFunction(() => {
    const chat = document.getElementById("ai-chat");
    return Boolean(chat && String(chat.textContent || "").includes("Tutor ready."));
  }, { timeout: 20_000 });
}

async function sendTutorMessage(page, text) {
  await page.fill("#ai-input", text);
  await page.press("#ai-input", "Enter");
}

function extensionChromeInitScript() {
  const mem = {
    requiredScore: 30,
    score: 35,
    xp: 0,
    prestige: 0,
    unlockedUntil: null,
    lockoutCooldownMs: 15 * 60 * 1000,
    stateUpdatedAt: Date.now(),
    customBlockedDomains: []
  };

  function pickKeys(store, keys) {
    if (Array.isArray(keys)) {
      const out = {};
      keys.forEach((key) => {
        out[key] = store[key];
      });
      return out;
    }
    if (typeof keys === "string") {
      return { [keys]: store[keys] };
    }
    return { ...store };
  }

  function normalizeDomain(input) {
    let domain = String(input || "").trim().toLowerCase();
    if (!domain) return null;
    domain = domain.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    domain = domain.replace(/^\/+/, "");
    domain = domain.split(/[/?#]/)[0];
    domain = domain.replace(/:\d+$/, "");
    domain = domain.replace(/^\*\./, "");
    domain = domain.replace(/\.$/, "");
    if (domain.startsWith("www.")) domain = domain.slice(4);
    if (!domain || !/^[a-z0-9.-]+$/.test(domain) || domain.includes("..")) return null;
    return domain;
  }

  const localStore = {};
  const runtime = {
    id: "pw-test",
    lastError: null,
    getURL(path) {
      return String(path || "");
    },
    sendMessage(message, callback) {
      if (!message || typeof message !== "object") {
        callback?.({ ok: false, error: "Invalid message." });
        return;
      }
      if (message.type === "GET_STATE") {
        const locked = !mem.unlockedUntil || mem.unlockedUntil <= Date.now();
        callback?.({
          ok: true,
          requiredScore: mem.requiredScore,
          score: mem.score,
          xp: mem.xp,
          prestige: mem.prestige,
          locked,
          unlockedUntil: locked ? null : mem.unlockedUntil,
          unlockDurationMs: mem.lockoutCooldownMs,
          lockoutCooldownMs: mem.lockoutCooldownMs,
          stateUpdatedAt: mem.stateUpdatedAt
        });
        return;
      }
      if (message.type === "REQUEST_UNLOCK") {
        if (mem.score < mem.requiredScore) {
          callback?.({ ok: false, error: "Need more points." });
          return;
        }
        mem.unlockedUntil = Date.now() + mem.lockoutCooldownMs;
        mem.score = 0;
        mem.stateUpdatedAt = Date.now();
        callback?.({
          ok: true,
          unlockedUntil: mem.unlockedUntil,
          unlockDurationMs: mem.lockoutCooldownMs,
          lockoutCooldownMs: mem.lockoutCooldownMs,
          stateUpdatedAt: mem.stateUpdatedAt
        });
        return;
      }
      if (message.type === "RELOCK") {
        mem.unlockedUntil = null;
        mem.score = 0;
        mem.stateUpdatedAt = Date.now();
        callback?.({ ok: true, stateUpdatedAt: mem.stateUpdatedAt });
        return;
      }
      if (message.type === "GET_SYNC_STATUS") {
        callback?.({
          ok: true,
          available: false,
          pending: false,
          scheduledFor: null,
          lastAttemptAt: null,
          lastSyncedAt: null,
          lastError: "Chrome sync unavailable in test runtime.",
          writeDebounceMs: 10_000
        });
        return;
      }
      if (message.type === "GET_CUSTOM_DOMAINS") {
        callback?.({ ok: true, domains: [...mem.customBlockedDomains] });
        return;
      }
      if (message.type === "ADD_CUSTOM_DOMAIN") {
        const domain = normalizeDomain(message.domain);
        if (!domain) {
          callback?.({ ok: false, error: "Enter a valid domain (example.com)." });
          return;
        }
        if (!mem.customBlockedDomains.includes(domain)) {
          mem.customBlockedDomains.push(domain);
        }
        callback?.({ ok: true, domains: [...mem.customBlockedDomains], added: true, domain });
        return;
      }
      if (message.type === "REMOVE_CUSTOM_DOMAIN") {
        const domain = normalizeDomain(message.domain);
        const next = mem.customBlockedDomains.filter((d) => d !== domain);
        const removed = next.length !== mem.customBlockedDomains.length;
        mem.customBlockedDomains = next;
        callback?.({ ok: true, domains: [...mem.customBlockedDomains], removed, domain });
        return;
      }
      if (message.type === "GET_SETTINGS") {
        callback?.({
          ok: true,
          lockoutCooldownMs: mem.lockoutCooldownMs,
          minLockoutCooldownMs: 5 * 60 * 1000,
          maxLockoutCooldownMs: 24 * 60 * 60 * 1000
        });
        return;
      }
      if (message.type === "SET_LOCKOUT_COOLDOWN") {
        const minutes = Math.floor(Number(message.minutes));
        if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440) {
          callback?.({ ok: false, error: "Cooldown must be between 5 and 1440 minutes." });
          return;
        }
        mem.lockoutCooldownMs = minutes * 60 * 1000;
        mem.stateUpdatedAt = Date.now();
        callback?.({
          ok: true,
          lockoutCooldownMs: mem.lockoutCooldownMs,
          unlockDurationMs: mem.lockoutCooldownMs,
          minutes,
          stateUpdatedAt: mem.stateUpdatedAt
        });
        return;
      }
      callback?.({ ok: false, error: "Unknown message type." });
    }
  };

  const local = {
    get(keys, cb) {
      cb?.(pickKeys(localStore, keys));
    },
    set(values, cb) {
      Object.assign(localStore, values || {});
      cb?.();
    },
    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach((key) => delete localStore[key]);
      cb?.();
    }
  };

  const sync = {
    get(_keys, cb) {
      cb?.({});
    },
    set(_values, cb) {
      cb?.();
    }
  };

  window.chrome = {
    runtime,
    storage: {
      local,
      sync
    }
  };
}

test("challenge page boots and mounts core UI without uncaught errors", { timeout: 60_000 }, async (t) => {
  await withChallengePage(t, {}, async ({ page }) => {
    await page.waitForFunction(() => {
      const problem = document.getElementById("problem");
      const status = document.getElementById("status");
      return Boolean(problem && status);
    }, { timeout: 20_000 });

    const pathname = await page.evaluate(() => window.location.pathname);
    assert.ok(pathname.includes("/rotblocker++/"), `expected canonicalized path, got: ${pathname}`);
  });
});

test("favicon links resolve and manifest icons are wired", { timeout: 60_000 }, async (t) => {
  await withChallengePage(t, {}, async ({ page }) => {
    const iconHref = await page.getAttribute('link[rel="icon"][sizes="32x32"]', "href");
    assert.ok(iconHref, "expected 32x32 favicon link");
    assert.match(iconHref, /icon32\.png$/);

    const iconUrl = await page.evaluate((rel) => new URL(rel, window.location.href).toString(), iconHref);
    const iconRes = await page.request.get(iconUrl);
    assert.equal(iconRes.status(), 200);

    const manifestRes = await page.request.get(`${baseUrl}/manifest.json`);
    assert.equal(manifestRes.status(), 200);
    const manifest = await manifestRes.json();

    assert.equal(manifest?.icons?.["16"], "assets/logo/icon16.png");
    assert.equal(manifest?.icons?.["32"], "assets/logo/icon32.png");
    assert.equal(manifest?.icons?.["48"], "assets/logo/icon48.png");
    assert.equal(manifest?.icons?.["128"], "assets/logo/icon128.png");
  });
});

test("tutor send flow exposes cancel loading state and supports cancel", { timeout: 60_000 }, async (t) => {
  let chatRequests = 0;
  await withChallengePage(
    t,
    {
      beforeGoto: async (page) => {
        await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
          chatRequests += 1;
          await new Promise((resolve) => setTimeout(resolve, 1200));
          try {
            await route.fulfill({
              status: 200,
              contentType: "application/json",
              body: JSON.stringify({
                choices: [{ message: { content: "Try isolating the variable first." } }]
              })
            });
          } catch (_err) {
            // Request may be aborted by the page.
          }
        });
      }
    },
    async ({ page }) => {
      await ensureTutorInitialized(page);
      await page.fill("#ai-token", "sk-test");
      await sendTutorMessage(page, "Need a hint");

      await page.waitForFunction(() => {
        const btn = document.querySelector('#ai-form button[type="submit"]');
        return Boolean(btn && btn.classList.contains("is-cancel") && /cancel/i.test(btn.textContent || ""));
      }, { timeout: 20_000 });

      await page.click('#ai-form button[type="submit"]');
      await page.waitForSelector("#ai-chat .chat-item.system", { timeout: 20_000 });
      await page.waitForFunction(() => {
        const chat = document.getElementById("ai-chat");
        return Boolean(chat && /Request canceled\./.test(chat.textContent || ""));
      }, { timeout: 20_000 });

      await page.waitForFunction(() => {
        const btn = document.querySelector('#ai-form button[type="submit"]');
        return Boolean(btn && !btn.classList.contains("is-cancel") && /Ask Tutor/i.test(btn.textContent || ""));
      }, { timeout: 20_000 });

      assert.equal(chatRequests, 1);
    }
  );
});

test("tutor error cards render mapped messaging for 401 and 429", { timeout: 60_000 }, async (t) => {
  await withChallengePage(
    t,
    {
      allowedConsoleErrorPatterns: [
        /status of 401/i,
        /status of 429/i
      ],
      beforeGoto: async (page) => {
        await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
          await route.fulfill({
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({ error: { message: "Invalid API key provided." } })
          });
        });
        await page.route("https://openrouter.ai/api/v1/models", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: [{ id: "openrouter/auto" }] })
          });
        });
        await page.route("https://openrouter.ai/api/v1/chat/completions", async (route) => {
          await route.fulfill({
            status: 429,
            contentType: "application/json",
            body: JSON.stringify({ error: "Too many requests" })
          });
        });
      }
    },
    async ({ page }) => {
      await ensureTutorInitialized(page);
      await page.fill("#ai-token", "sk-test");

      await sendTutorMessage(page, "first");
      await page.waitForFunction(() => {
        const summaries = Array.from(document.querySelectorAll("#ai-chat .chat-error-summary"));
        return summaries.some((el) => /Authentication failed/i.test(String(el.textContent || "")));
      }, { timeout: 20_000 });

      await page.selectOption("#ai-provider", "openrouter");
      await sendTutorMessage(page, "second");
      await page.waitForFunction(() => {
        const summaries = Array.from(document.querySelectorAll("#ai-chat .chat-error-summary"));
        return summaries.some((el) => /Rate limit reached/i.test(String(el.textContent || "")));
      }, { timeout: 20_000 });
    }
  );
});

test("assistant markdown and math responses render with expected structure", { timeout: 60_000 }, async (t) => {
  await withChallengePage(
    t,
    {
      beforeGoto: async (page) => {
        await page.route("https://api.openai.com/v1/chat/completions", async (route) => {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              choices: [{
                message: {
                  content: "# Plan\nUse **factoring** then *simplify* around $x^2$."
                }
              }]
            })
          });
        });
      }
    },
    async ({ page }) => {
      await ensureTutorInitialized(page);
      await page.fill("#ai-token", "sk-test");
      await sendTutorMessage(page, "show me structure");

      await page.waitForSelector("#ai-chat .chat-item.assistant", { timeout: 20_000 });
      await page.waitForSelector("#ai-chat .chat-item.assistant .chat-md-heading", { timeout: 20_000 });
      await page.waitForSelector("#ai-chat .chat-item.assistant strong", { timeout: 20_000 });
      await page.waitForSelector("#ai-chat .chat-item.assistant em", { timeout: 20_000 });

      const hasMathMarkup = await page.evaluate(() => {
        const assistantItems = document.querySelectorAll("#ai-chat .chat-item.assistant");
        const last = assistantItems[assistantItems.length - 1];
        if (!last) return false;
        const html = String(last.innerHTML || "");
        return /mjx-container/.test(html) || /\$x\^2\$/.test(html) || /x\^2/.test(last.textContent || "");
      });
      assert.equal(hasMathMarkup, true);
    }
  );
});

test("custom domains modal supports add/remove flow and persists empty state", { timeout: 60_000 }, async (t) => {
  await withChallengePage(t, {}, async ({ page }) => {
    await page.click("#domain-settings-toggle");
    await page.waitForSelector("#domain-settings-modal:not([hidden])", { timeout: 20_000 });

    await page.fill("#domain-settings-input", "example.com");
    await page.click("#domain-settings-add");
    await page.waitForFunction(() => {
      const list = document.getElementById("domain-settings-list");
      return Boolean(list && /example\.com/.test(list.textContent || ""));
    }, { timeout: 20_000 });

    await page.click("#domain-settings-list .domain-settings-remove");
    await page.waitForFunction(() => {
      const list = document.getElementById("domain-settings-list");
      return Boolean(list && /No custom domains added\./.test(list.textContent || ""));
    }, { timeout: 20_000 });

    await page.click("#domain-settings-close");
    await page.waitForFunction(() => {
      const modal = document.getElementById("domain-settings-modal");
      return Boolean(modal && modal.hidden);
    }, { timeout: 20_000 });
    await page.click("#domain-settings-toggle");
    await page.waitForFunction(() => {
      const list = document.getElementById("domain-settings-list");
      return Boolean(list && /No custom domains added\./.test(list.textContent || ""));
    }, { timeout: 20_000 });
  });
});

test("unlock and relock flow updates status and lock controls", { timeout: 60_000 }, async (t) => {
  await withChallengePage(
    t,
    {
      initScript: extensionChromeInitScript,
      allowedConsoleErrorPatterns: [/status of 404/i]
    },
    async ({ page }) => {
      await page.waitForFunction(() => {
        const unlock = document.getElementById("unlock");
        return Boolean(unlock && !unlock.disabled);
      }, { timeout: 20_000 });

      await page.click("#unlock");
      await page.waitForFunction(() => {
        const status = document.getElementById("status");
        const unlock = document.getElementById("unlock");
        return Boolean(
          status &&
          /Unlocked for/.test(status.textContent || "") &&
          unlock &&
          /Already Unlocked/.test(unlock.textContent || "")
        );
      }, { timeout: 20_000 });

      await page.click("#relock");
      await page.waitForFunction(() => {
        const status = document.getElementById("status");
        const unlock = document.getElementById("unlock");
        return Boolean(
          status &&
          /Score:\s*0\.00\/30/.test(status.textContent || "") &&
          unlock &&
          /Unlock Sites/.test(unlock.textContent || "")
        );
      }, { timeout: 20_000 });
    }
  );
});

test("encoded rotblocker path canonicalizes while preserving search and hash", { timeout: 60_000 }, async (t) => {
  await withChallengePage(
    t,
    { path: "/rotblocker%2B%2B/index.html?tab=preview#math" },
    async ({ page }) => {
      await page.waitForFunction(() => window.location.pathname.includes("/rotblocker++/"), { timeout: 20_000 });
      const loc = await page.evaluate(() => ({
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash
      }));
      assert.equal(loc.pathname, "/rotblocker++/index.html");
      assert.equal(loc.search, "?tab=preview");
      assert.equal(loc.hash, "#math");
    }
  );
});
