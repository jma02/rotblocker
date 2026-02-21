const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

test("assistant chat includes minimal markdown parsing helpers", () => {
  const source = readText("challenge.js");
  assert.match(source, /\bfunction hasAssistantMarkdownSyntax\b/);
  assert.match(source, /\bfunction renderAssistantMarkdownText\b/);
  assert.match(source, /<strong>\$1<\/strong>/);
  assert.match(source, /<em>\$2<\/em>/);
  assert.match(source, /splitMathSegments/);
});

test("appendChat routes assistant markdown through markdown renderer", () => {
  const source = readText("challenge.js");
  assert.match(source, /const shouldRenderMarkdown = role === "assistant" && hasAssistantMarkdownSyntax\(content\)/);
  assert.match(source, /if \(shouldRenderMarkdown\) {\s*renderAssistantMarkdownText\(bodyEl, content\);/);
});

test("chat stylesheet includes markdown heading styles", () => {
  const css = readText("challenge.css");
  assert.match(css, /\.chat-md-heading/);
  assert.match(css, /\.chat-md-h1/);
  assert.match(css, /\.chat-md-h2/);
  assert.match(css, /\.chat-md-h3/);
});
