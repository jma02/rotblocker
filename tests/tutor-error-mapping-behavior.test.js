const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

test("formatTutorError maps auth and rate-limit responses to user-friendly messages", () => {
  const fns = loadChallengeFns({ extensionRuntime: false });

  const auth = fns.formatTutorError(
    "API error 401: {\"error\":{\"message\":\"Invalid API key\"}}",
    "chat"
  );
  assert.equal(auth.summary, "Authentication failed. Check provider and API token.");
  assert.equal(auth.detail, "Invalid API key");

  const rateLimit = fns.formatTutorError(
    "API error 429: {\"error\":\"Too many requests\"}",
    "chat"
  );
  assert.equal(rateLimit.summary, "Rate limit reached. Wait a moment and retry.");
  assert.equal(rateLimit.detail, "Too many requests");
});

test("formatTutorError safely normalizes malformed provider payloads", () => {
  const fns = loadChallengeFns({ extensionRuntime: false });
  const parsed = fns.formatTutorError(
    "API error 500: <html> upstream unavailable </html>\n\nplease retry",
    "chat"
  );
  assert.equal(parsed.summary, "AI provider is temporarily unavailable.");
  assert.match(parsed.detail, /upstream unavailable/i);
});

test("appendChatError renders an error card with mapped summary/detail", () => {
  const fns = loadChallengeFns({ extensionRuntime: false });
  const aiChatEl = fns.__sandbox.RB.dom.refs.aiChatEl;
  assert.ok(aiChatEl, "expected ai chat element");

  fns.appendChatError("API error 429: {\"error\":\"quota exceeded\"}", "chat");

  assert.equal(aiChatEl.children.length, 1);
  assert.equal(aiChatEl.scrollTop, aiChatEl.scrollHeight);

  const card = aiChatEl.children[0];
  assert.equal(card.className, "chat-item system chat-error");
  assert.equal(card.children[1].textContent, "Tutor Error");
  assert.equal(card.children[2].textContent, "Rate limit reached. Wait a moment and retry.");
  assert.equal(card.children[3].textContent, "quota exceeded");
});
