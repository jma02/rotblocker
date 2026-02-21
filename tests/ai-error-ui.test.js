const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("AI integration routes failures through appendChatError", () => {
  const source = readText("challenge.js");
  assert.match(source, /\bfunction appendChatError\b/);
  assert.match(source, /appendChatError\(err,\s*"models"\)/);
  assert.match(source, /appendChatError\(err,\s*"chat"\)/);
  assert.match(source, /\bfunction formatTutorError\b/);
});

test("chat stylesheet includes dedicated error card styling", () => {
  const css = readText("challenge.css");
  assert.match(css, /\.chat-item\.chat-error/);
  assert.match(css, /\.chat-error-label/);
  assert.match(css, /\.chat-error-summary/);
  assert.match(css, /\.chat-error-detail/);
  assert.match(css, /body\.theme-dark \.chat-item\.chat-error/);
});
