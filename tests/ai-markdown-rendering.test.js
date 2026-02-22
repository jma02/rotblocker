const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadChallengeFns } = require("./challenge-harness");

function readText(relPath) {
  return fs.readFileSync(path.join(process.cwd(), relPath), "utf8");
}

function readAppSource() {
  return [
    "challenge-modules/constants.js",
    "challenge-modules/dom.js",
    "challenge-modules/math.js",
    "challenge-modules/sync.js",
    "challenge-modules/tutor.js",
    "challenge.js",
    "challenge-modules/gameplay.js",
    "challenge-modules/bootstrap.js"
  ].map(readText).join("\n");
}

function makeEl() {
  return {
    dataset: {},
    textContent: "",
    innerHTML: ""
  };
}

test("markdown detection distinguishes prose formatting from plain text", () => {
  const fns = loadChallengeFns();
  assert.equal(fns.hasAssistantMarkdownSyntax("plain response"), false);
  assert.equal(fns.hasAssistantMarkdownSyntax("## Strategy"), true);
  assert.equal(fns.hasAssistantMarkdownSyntax("Use **factorization** next"), true);
  assert.equal(fns.hasAssistantMarkdownSyntax("Try *substitution*"), true);
});

test("assistant markdown renderer applies heading, bold, and italics", () => {
  const fns = loadChallengeFns();
  const el = makeEl();
  fns.renderAssistantMarkdownText(el, "# Plan\nUse **factoring** and then *simplify*.");
  assert.match(el.innerHTML, /chat-md-heading chat-md-h1/);
  assert.match(el.innerHTML, /<strong>factoring<\/strong>/);
  assert.match(el.innerHTML, /<em>simplify<\/em>/);
});

test("assistant markdown renderer escapes raw html", () => {
  const fns = loadChallengeFns();
  const el = makeEl();
  fns.renderAssistantMarkdownText(el, "<img src=x onerror=alert(1)> **safe**");
  assert.doesNotMatch(el.innerHTML, /<img/i);
  assert.match(el.innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(el.innerHTML, /<strong>safe<\/strong>/);
});

test("assistant markdown renderer does not parse markdown inside math delimiters", () => {
  const fns = loadChallengeFns();
  const el = makeEl();
  fns.renderAssistantMarkdownText(el, "Keep $*x* + **y**$ literal and **outside**.");
  assert.match(el.innerHTML, /\$\*x\* \+ \*\*y\*\*\$/);
  assert.match(el.innerHTML, /<strong>outside<\/strong>/);
  assert.doesNotMatch(el.innerHTML, /<em>x<\/em>/);
  assert.doesNotMatch(el.innerHTML, /<strong>y<\/strong>/);
});

test("escaped asterisks remain literal text", () => {
  const fns = loadChallengeFns();
  const el = makeEl();
  fns.renderAssistantMarkdownText(el, "Keep \\*literal\\* and \\*\\*also literal\\*\\*.");
  assert.match(el.innerHTML, /\*literal\*/);
  assert.match(el.innerHTML, /\*\*also literal\*\*/);
  assert.doesNotMatch(el.innerHTML, /<em>/);
  assert.doesNotMatch(el.innerHTML, /<strong>/);
});

test("appendChat routes assistant markdown through markdown renderer", () => {
  const source = readAppSource();
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
