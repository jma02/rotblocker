const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("AI chat submit flow includes loading bubble and submit-button loading state", () => {
  const source = readText("challenge.js");
  assert.match(source, /\bfunction appendChatLoading\b/);
  assert.match(source, /\bfunction removeChatLoading\b/);
  assert.match(source, /\bfunction setTutorSubmitLoading\b/);
  assert.match(source, /setTutorSubmitLoading\(true\)/);
  assert.match(source, /setTutorSubmitLoading\(false\)/);
  assert.match(source, /appendChatLoading\(\)/);
});

test("chat loading animation styles exist for chat and submit button", () => {
  const css = readText("challenge.css");
  assert.match(css, /\.chat-item\.chat-loading/);
  assert.match(css, /\.chat-loading-dots/);
  assert.match(css, /\.chat-loading-dot/);
  assert.match(css, /@keyframes chat-dot-pulse/);
  assert.match(css, /\.ai-form button\.is-loading/);
  assert.match(css, /\.ai-form button\.is-cancel/);
  assert.match(css, /\.ai-form button\.is-cancel \.chat-loading-dot/);
});
