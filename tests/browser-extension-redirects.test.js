const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

let playwright = null;
try {
  playwright = require("playwright");
} catch (_err) {
  // Optional dependency; this test skips when unavailable.
}

function normalizeSkipMessage(err) {
  const raw = String(err && err.message ? err.message : err || "");
  return raw.split("\n")[0] || "unavailable";
}

test(
  "extension redirects twitter.com and linkedin.com to rotblocker challenge page",
  { timeout: 90_000 },
  async (t) => {
    if (!playwright) {
      t.skip("playwright package is not installed");
      return;
    }

    const extensionPath = process.cwd();
    const manifestPath = path.join(extensionPath, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      t.skip(`manifest not found at ${manifestPath}`);
      return;
    }

    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "rb-pw-ext-"));
    let context;
    try {
      try {
        context = await playwright.chromium.launchPersistentContext(userDataDir, {
          channel: "chromium",
          headless: true,
          args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`
          ]
        });
      } catch (err) {
        t.skip(`playwright extension context is unavailable: ${normalizeSkipMessage(err)}`);
        return;
      }

      const page = context.pages()[0] || await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (err) => {
        pageErrors.push(String(err && err.message ? err.message : err));
      });

      const targets = [
        "https://twitter.com/home",
        "https://linkedin.com/feed"
      ];

      for (const target of targets) {
        await page.goto(target, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () =>
            window.location.protocol === "chrome-extension:"
            && /\/rotblocker\+\+\/index\.html$/.test(window.location.pathname),
          { timeout: 20_000 }
        );
        const href = page.url();
        assert.match(
          href,
          /^chrome-extension:\/\/[^/]+\/rotblocker\+\+\/index\.html(?:[?#].*)?$/,
          `expected redirect to extension challenge page for ${target}, got ${href}`
        );
      }

      assert.deepEqual(pageErrors, []);
    } finally {
      if (context) {
        await context.close();
      }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
);
