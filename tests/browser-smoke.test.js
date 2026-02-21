const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

let playwright = null;
try {
  playwright = require("playwright");
} catch (_err) {
  // Optional dependency; test skips when unavailable.
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
      res.writeHead(200, {
        "Content-Type": MIME_BY_EXT[ext] || "application/octet-stream"
      });
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

test("browser smoke: rotblocker page loads without uncaught errors", { timeout: 60_000 }, async (t) => {
  if (!playwright) {
    t.skip("playwright package is not installed");
    return;
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ headless: true });
  } catch (err) {
    t.skip(`playwright chromium is unavailable: ${err.message}`);
    return;
  }

  const { server, port } = await startStaticServer(process.cwd());
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];

  page.on("pageerror", (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  try {
    await page.goto(`http://127.0.0.1:${port}/rotblocker%2B%2B/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#problem", { timeout: 20_000 });
    await page.waitForSelector("#status", { timeout: 20_000 });
    await page.waitForFunction(() => {
      const el = document.getElementById("problem");
      return Boolean(el && String(el.textContent || "").trim() && String(el.textContent || "").trim() !== "--");
    }, { timeout: 20_000 });

    const pathname = await page.evaluate(() => window.location.pathname);
    assert.ok(
      pathname.includes("/rotblocker++/"),
      `expected canonicalized path, got: ${pathname}`
    );
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
