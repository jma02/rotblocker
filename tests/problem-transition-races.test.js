const test = require("node:test");
const assert = require("node:assert/strict");
const { loadChallengeFns } = require("./challenge-harness");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mcq(id, answerIndex = 0) {
  return {
    id,
    type: "mcq",
    contest: "amc8",
    label: `MCQ ${id}`,
    weight: 5,
    prompt: `Solve $x_${id.length}=1$.`,
    choices: ["$1$", "$2$", "$3$", "$4$", "$5$"],
    answerIndex,
    answerKey: "ABCDE"[answerIndex],
    answer: String(answerIndex + 1)
  };
}

function inputProblem(id, answer = 17) {
  return {
    id,
    type: "input",
    contest: "aime",
    label: `Input ${id}`,
    weight: 30,
    prompt: `Find $n_${id.length}$.`,
    answer
  };
}

function makeFakeDate(start = 1_000_000) {
  let now = start;
  class FakeDate extends Date {
    static now() {
      return now;
    }
  }
  return {
    Date: FakeDate,
    advance(ms) {
      now += ms;
    },
    now() {
      return now;
    }
  };
}

function makeMathJaxController() {
  const calls = [];
  let heldNext = null;
  return {
    api: {
      typesetClear() {},
      typesetPromise(nodes) {
        calls.push(nodes[0]);
        if (!heldNext) return Promise.resolve();
        const held = heldNext;
        heldNext = null;
        return held.promise;
      }
    },
    calls,
    holdNext() {
      assert.equal(heldNext, null, "only one next typeset can be held");
      heldNext = deferred();
      return heldNext;
    }
  };
}

function makeChromeController() {
  const messages = [];
  const pending = [];
  let throwNextType = "";
  let authoritativeState = {
    ok: true,
    requiredScore: 30,
    score: 0,
    xp: 0,
    prestige: 0,
    unlockedUntil: null,
    stateUpdatedAt: 1
  };
  const chrome = {
    storage: {
      local: {
        get(_keys, callback) {
          callback({});
        },
        set(_values, callback) {
          callback?.();
        }
      },
      sync: {
        get(_keys, callback) {
          callback({});
        },
        set(_values, callback) {
          callback?.();
        }
      }
    },
    runtime: {
      id: "race-test",
      getURL(path) {
        return path;
      },
      sendMessage(message, callback) {
        messages.push(message);
        if (throwNextType && message.type === throwNextType) {
          throwNextType = "";
          throw new Error("injected runtime failure");
        }
        if (message.type === "GET_STATE") {
          callback({ ...authoritativeState });
          return;
        }
        pending.push({ message, callback });
      }
    }
  };
  return {
    chrome,
    messages,
    pending,
    take(type) {
      const index = pending.findIndex((item) => item.message.type === type);
      assert.notEqual(index, -1, `missing pending ${type}`);
      return pending.splice(index, 1)[0];
    },
    count(type) {
      return messages.filter((message) => message.type === type).length;
    },
    throwNext(type) {
      throwNextType = type;
    },
    setAuthoritativeState(next) {
      authoritativeState = { ...authoritativeState, ...next };
    }
  };
}

async function flush(fns) {
  await fns.flushPendingMathTypeset([]);
}

async function settleHandlers() {
  await Promise.resolve();
  await Promise.resolve();
}

test("initial held MathJax blocks every control and freezes the new-problem timer", async () => {
  const clock = makeFakeDate();
  const math = makeMathJaxController();
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    DateOverride: clock.Date,
    windowMathJax: math.api,
    chromeOverride: chrome.chrome
  });
  const problem = mcq("held-initial");
  const held = math.holdNext();

  fns.__transitionProblemForTest(problem);
  const blocked = fns.__getGameplayStateForTest();
  const choices = fns.__elementsById.get("choices");
  const prompt = fns.__elementsById.get("problem");
  const meta = fns.__elementsById.get("meta");

  assert.equal(blocked.readyProblemRenderRevision, 0);
  assert.equal(prompt.style.visibility, "hidden");
  assert.equal(meta.style.visibility, "hidden");
  assert.equal(choices.style.display, "none");
  assert.ok(choices.children.every((button) => button.disabled));

  clock.advance(120_000);
  assert.equal(fns.__getGameplayStateForTest().elapsedMs, 0);
  choices.children[0].dispatchEvent({ type: "click" });
  assert.equal(chrome.count("ADD_SCORE"), 0);

  const draining = fns.flushPendingMathTypeset([]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(math.calls.length, 1, "prompt typeset should be the held first operation");
  held.resolve();
  await draining;

  const ready = fns.__getGameplayStateForTest();
  assert.equal(ready.readyProblemRenderRevision, ready.problemRenderRevision);
  assert.equal(prompt.style.visibility, "visible");
  assert.equal(meta.style.visibility, "visible");
  assert.equal(choices.style.display, "grid");
  assert.ok(choices.children.every((button) => button.disabled === false));
  assert.ok(choices.children.every((button) => button.dataset.mathTypeset === "1"));
  assert.equal(ready.elapsedMs, 0);

  clock.advance(1_250);
  assert.equal(fns.__getGameplayStateForTest().elapsedMs, 1_250);
});

test("stale MCQ and programmatic AIME controls stay inert across a held transition", async () => {
  const math = makeMathJaxController();
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    includeBootstrap: true,
    windowMathJax: math.api,
    chromeOverride: chrome.chrome,
    fetchImpl: () => new Promise(() => {})
  });
  const oldProblem = mcq("old");
  const nextInput = inputProblem("next", 23);
  const finalProblem = mcq("final");

  fns.__transitionProblemForTest(oldProblem);
  await flush(fns);
  const oldButton = fns.__elementsById.get("choices").children[0];

  const blocker = fns.__sandbox.document.createElement("div");
  const held = math.holdNext();
  fns.renderMathText(blocker, "$z$");
  await Promise.resolve();
  fns.__transitionProblemForTest(nextInput, "New input is pending.");

  const form = fns.__elementsById.get("answer-form");
  const answer = fns.__elementsById.get("answer");
  const submit = form.__submitButton;
  const pendingState = fns.__getGameplayStateForTest();
  assert.equal(pendingState.readyProblemRenderRevision, 0);
  assert.equal(form.style.display, "none");
  assert.equal(answer.disabled, true);
  assert.equal(submit.disabled, true);

  oldButton.dispatchEvent({ type: "click" });
  answer.value = "23";
  form.dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(
    await fns.handleInputAnswer("23", nextInput, pendingState.problemRenderRevision),
    false
  );
  assert.equal(chrome.count("ADD_SCORE"), 0);

  held.resolve();
  await flush(fns);
  const readyState = fns.__getGameplayStateForTest();
  assert.equal(form.style.display, "flex");
  assert.equal(answer.disabled, false);
  assert.equal(submit.disabled, false);
  oldButton.dispatchEvent({ type: "click" });
  assert.equal(chrome.count("ADD_SCORE"), 0);

  assert.equal(
    await fns.handleInputAnswer("   ", nextInput, readyState.problemRenderRevision),
    false
  );
  assert.equal(chrome.count("ADD_SCORE"), 0);

  const first = fns.handleInputAnswer("23", nextInput, readyState.problemRenderRevision);
  const duplicate = fns.handleInputAnswer("23", nextInput, readyState.problemRenderRevision);
  assert.equal(await duplicate, false);
  assert.equal(chrome.count("ADD_SCORE"), 1);

  fns.__transitionProblemForTest(finalProblem, "Final problem is active.");
  await flush(fns);
  fns.__elementsById.get("feedback").textContent = "new feedback";
  chrome.take("ADD_SCORE").callback({
    ok: true,
    score: 30,
    xp: 30,
    prestige: 0,
    stateUpdatedAt: 10
  });
  await first;

  const finalState = fns.__getGameplayStateForTest();
  assert.equal(finalState.currentProblem, finalProblem);
  assert.equal(finalState.score, 30);
  assert.equal(finalState.xp, 30);
  assert.equal(finalState.tutorProblemEvent, "Final problem is active.");
  assert.equal(fns.__elementsById.get("feedback").textContent, "new feedback");
});

test("MCQ double click admits one score mutation and a stale response cannot advance", async () => {
  const chrome = makeChromeController();
  const fns = loadChallengeFns({ chromeOverride: chrome.chrome });
  const firstProblem = mcq("mcq-first", 0);
  const secondProblem = mcq("mcq-second", 1);
  fns.__transitionProblemForTest(firstProblem);
  await flush(fns);
  const revision = fns.__getGameplayStateForTest().problemRenderRevision;

  const first = fns.handleMcqChoice(0, firstProblem, revision);
  const duplicate = fns.handleMcqChoice(0, firstProblem, revision);
  assert.equal(await duplicate, false);
  assert.equal(chrome.count("ADD_SCORE"), 1);

  fns.__transitionProblemForTest(secondProblem, "Second MCQ remains current.");
  await flush(fns);
  fns.__elementsById.get("feedback").textContent = "second feedback";
  chrome.take("ADD_SCORE").callback({
    ok: true,
    score: 5,
    xp: 5,
    prestige: 0,
    stateUpdatedAt: 20
  });
  await first;

  const state = fns.__getGameplayStateForTest();
  assert.equal(state.currentProblem, secondProblem);
  assert.equal(state.score, 5);
  assert.equal(state.tutorProblemEvent, "Second MCQ remains current.");
  assert.equal(fns.__elementsById.get("feedback").textContent, "second feedback");
});

test("newer equal-timestamp score response cannot be overwritten by an older request", async () => {
  const chrome = makeChromeController();
  const fns = loadChallengeFns({ chromeOverride: chrome.chrome });
  const firstProblem = mcq("score-order-a", 0);
  const secondProblem = mcq("score-order-b", 0);
  const finalProblem = mcq("score-order-c", 0);

  fns.__transitionProblemForTest(firstProblem);
  await flush(fns);
  const firstRevision = fns.__getGameplayStateForTest().problemRenderRevision;
  const firstScore = fns.handleMcqChoice(0, firstProblem, firstRevision);

  fns.__transitionProblemForTest(secondProblem);
  await flush(fns);
  const secondRevision = fns.__getGameplayStateForTest().problemRenderRevision;
  const secondScore = fns.handleMcqChoice(0, secondProblem, secondRevision);
  const firstPending = chrome.take("ADD_SCORE");
  const secondPending = chrome.take("ADD_SCORE");
  fns.__setProblemBankForTest("amc8", [finalProblem]);

  secondPending.callback({
    ok: true,
    score: 10,
    xp: 10,
    prestige: 0,
    stateUpdatedAt: 100
  });
  await secondScore;
  await flush(fns);
  assert.equal(fns.__getGameplayStateForTest().currentProblem, finalProblem);
  assert.equal(fns.__getGameplayStateForTest().score, 10);

  firstPending.callback({
    ok: true,
    score: 5,
    xp: 5,
    prestige: 0,
    stateUpdatedAt: 100
  });
  await firstScore;
  const state = fns.__getGameplayStateForTest();
  assert.equal(state.currentProblem, finalProblem);
  assert.equal(state.score, 10);
  assert.equal(state.xp, 10);
});

test("held wrong-guess penalty preserves the new problem and freezes hidden wait time", async () => {
  const clock = makeFakeDate();
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    DateOverride: clock.Date,
    chromeOverride: chrome.chrome
  });
  const oldProblem = mcq("penalty", 0);
  const nextProblem = mcq("after-penalty", 0);
  fns.__setGameplayStateForTest({
    currentProblem: oldProblem,
    mcqWrongGuesses: 1,
    score: 10
  });
  fns.renderProblem();
  await flush(fns);
  clock.advance(4_000);
  const revision = fns.__getGameplayStateForTest().problemRenderRevision;
  const wrong = fns.handleMcqChoice(1, oldProblem, revision);
  assert.equal(chrome.count("ADD_SCORE"), 1);

  clock.advance(90_000);
  assert.equal(fns.__getGameplayStateForTest().elapsedMs, 4_000);
  fns.__transitionProblemForTest(nextProblem, "Penalty transition stays current.");
  await flush(fns);
  fns.__elementsById.get("feedback").textContent = "new penalty feedback";
  chrome.take("ADD_SCORE").callback({
    ok: true,
    score: 9,
    xp: 0,
    prestige: 0,
    stateUpdatedAt: 30
  });
  await wrong;

  const state = fns.__getGameplayStateForTest();
  assert.equal(state.currentProblem, nextProblem);
  assert.equal(state.mcqWrongGuesses, 0);
  assert.deepEqual(Array.from(state.usedChoices), []);
  assert.equal(state.score, 9);
  assert.equal(state.tutorProblemEvent, "Penalty transition stays current.");
  assert.equal(fns.__elementsById.get("feedback").textContent, "new penalty feedback");
});

test("same-problem wrong-guess rerender resumes the timer without charging backend wait", async () => {
  const clock = makeFakeDate();
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    DateOverride: clock.Date,
    chromeOverride: chrome.chrome
  });
  const problem = mcq("same-problem", 0);
  fns.__setGameplayStateForTest({
    currentProblem: problem,
    mcqWrongGuesses: 1,
    score: 10
  });
  fns.renderProblem();
  await flush(fns);
  clock.advance(3_000);
  const revision = fns.__getGameplayStateForTest().problemRenderRevision;
  const wrong = fns.handleMcqChoice(1, problem, revision);
  clock.advance(60_000);
  chrome.take("ADD_SCORE").callback({
    ok: true,
    score: 9,
    xp: 0,
    prestige: 0,
    stateUpdatedAt: 40
  });
  await wrong;
  await flush(fns);

  assert.equal(fns.__getGameplayStateForTest().elapsedMs, 3_000);
  clock.advance(2_000);
  assert.equal(fns.__getGameplayStateForTest().elapsedMs, 5_000);
});

test("thrown correct and penalty score requests rerender instead of stranding controls", async () => {
  const chrome = makeChromeController();
  const fns = loadChallengeFns({ chromeOverride: chrome.chrome });
  const problem = mcq("score-throws", 0);
  fns.__transitionProblemForTest(problem);
  await flush(fns);

  chrome.throwNext("ADD_SCORE");
  let revision = fns.__getGameplayStateForTest().problemRenderRevision;
  await fns.handleMcqChoice(0, problem, revision);
  await flush(fns);
  let state = fns.__getGameplayStateForTest();
  assert.equal(state.currentProblem, problem);
  assert.equal(state.readyProblemRenderRevision, state.problemRenderRevision);

  fns.__setGameplayStateForTest({
    currentProblem: problem,
    mcqWrongGuesses: 1,
    usedChoices: []
  });
  fns.renderProblem();
  await flush(fns);
  chrome.throwNext("ADD_SCORE");
  revision = fns.__getGameplayStateForTest().problemRenderRevision;
  await fns.handleMcqChoice(1, problem, revision);
  await flush(fns);
  state = fns.__getGameplayStateForTest();
  assert.equal(state.currentProblem, problem);
  assert.equal(state.readyProblemRenderRevision, state.problemRenderRevision);
});

test("failed unlock refreshes score state after invalidating an in-flight penalty", async () => {
  const chrome = makeChromeController();
  chrome.setAuthoritativeState({ score: 30, stateUpdatedAt: 70 });
  const fns = loadChallengeFns({
    includeBootstrap: true,
    chromeOverride: chrome.chrome,
    fetchImpl: () => new Promise(() => {})
  });
  const problem = mcq("penalty-unlock", 0);
  fns.__setGameplayStateForTest({
    currentProblem: problem,
    mcqWrongGuesses: 1,
    score: 30,
    stateUpdatedAt: 69
  });
  fns.renderProblem();
  await flush(fns);
  fns.render();

  const revision = fns.__getGameplayStateForTest().problemRenderRevision;
  const penalty = fns.handleMcqChoice(1, problem, revision);
  fns.__elementsById.get("unlock").dispatchEvent({ type: "click" });
  assert.equal(chrome.count("ADD_SCORE"), 1);
  assert.equal(chrome.count("REQUEST_UNLOCK"), 1);

  chrome.setAuthoritativeState({ score: 29, stateUpdatedAt: 71 });
  chrome.take("ADD_SCORE").callback({
    ok: true,
    score: 29,
    xp: 0,
    prestige: 0,
    stateUpdatedAt: 71
  });
  await penalty;
  chrome.take("REQUEST_UNLOCK").callback({
    ok: false,
    error: "Need 1 more point."
  });
  await settleHandlers();
  await flush(fns);

  const state = fns.__getGameplayStateForTest();
  assert.equal(state.score, 29);
  assert.equal(state.stateUpdatedAt, 71);
  assert.equal(state.currentProblem, problem);
  assert.equal(state.readyProblemRenderRevision, state.problemRenderRevision);
  assert.equal(fns.__elementsById.get("unlock").disabled, true);
});

test("unlock is deduped, blocks grading/reroll, recovers on failure, and restarts after expiry", async () => {
  const clock = makeFakeDate();
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    includeBootstrap: true,
    DateOverride: clock.Date,
    chromeOverride: chrome.chrome,
    fetchImpl: () => new Promise(() => {})
  });
  const active = mcq("unlock-active", 0);
  const afterExpiry = mcq("after-expiry", 0);
  fns.__transitionProblemForTest(active);
  await flush(fns);
  fns.__setProblemBankForTest("amc8", [afterExpiry]);
  fns.__setGameplayStateForTest({ score: 30 });
  fns.render();

  const unlock = fns.__elementsById.get("unlock");
  const reroll = fns.__elementsById.get("reroll-btn");
  const oldButton = fns.__elementsById.get("choices").children[0];
  unlock.dispatchEvent({ type: "click" });
  unlock.dispatchEvent({ type: "click" });
  assert.equal(chrome.count("REQUEST_UNLOCK"), 1);
  assert.equal(fns.__getGameplayStateForTest().problemStateMutationDepth, 1);
  reroll.dispatchEvent({ type: "click" });
  oldButton.dispatchEvent({ type: "click" });
  assert.equal(fns.__getGameplayStateForTest().currentProblem, active);
  assert.equal(chrome.count("ADD_SCORE"), 0);

  chrome.take("REQUEST_UNLOCK").callback({ ok: false, error: "try again" });
  await settleHandlers();
  await flush(fns);
  let state = fns.__getGameplayStateForTest();
  assert.equal(state.problemStateMutationDepth, 0);
  assert.equal(state.readyProblemRenderRevision, state.problemRenderRevision);

  unlock.dispatchEvent({ type: "click" });
  assert.equal(chrome.count("REQUEST_UNLOCK"), 2);
  chrome.take("REQUEST_UNLOCK").callback({
    ok: true,
    unlockedUntil: clock.now() + 5_000,
    unlockDurationMs: 5_000,
    stateUpdatedAt: 50
  });
  await settleHandlers();
  state = fns.__getGameplayStateForTest();
  assert.equal(state.score, 0);
  assert.equal(state.problemStateMutationDepth, 0);
  assert.equal(fns.__elementsById.get("quiz").style.display, "none");

  clock.advance(6_000);
  fns.tickUi();
  await flush(fns);
  state = fns.__getGameplayStateForTest();
  assert.equal(state.currentProblem, afterExpiry);
  assert.equal(state.readyProblemRenderRevision, state.problemRenderRevision);
  assert.equal(state.elapsedMs, 0);
});

test("relock is deduped and owns exactly one problem transition", async () => {
  const clock = makeFakeDate();
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    includeBootstrap: true,
    DateOverride: clock.Date,
    chromeOverride: chrome.chrome,
    fetchImpl: () => new Promise(() => {})
  });
  const duringUnlock = mcq("during-unlock");
  const afterRelock = mcq("after-relock");
  fns.__setGameplayStateForTest({ unlockedUntil: clock.now() + 60_000 });
  fns.__transitionProblemForTest(duringUnlock);
  fns.__setProblemBankForTest("amc8", [afterRelock]);
  fns.render();

  const relock = fns.__elementsById.get("relock");
  relock.dispatchEvent({ type: "click" });
  relock.dispatchEvent({ type: "click" });
  assert.equal(chrome.count("RELOCK"), 1);
  const suspendedRevision = fns.__getGameplayStateForTest().problemRenderRevision;

  chrome.take("RELOCK").callback({ ok: true, stateUpdatedAt: 60 });
  await settleHandlers();
  await flush(fns);
  const state = fns.__getGameplayStateForTest();
  assert.equal(state.currentProblem, afterRelock);
  assert.equal(state.problemRenderRevision, suspendedRevision + 1);
  assert.equal(state.problemStateMutationDepth, 0);
  assert.equal(relock.disabled, true);
  assert.equal(relock.hidden, true);
});

test("locked relock clicks are inert and cannot erase accumulated score", async () => {
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    includeBootstrap: true,
    chromeOverride: chrome.chrome,
    fetchImpl: () => new Promise(() => {})
  });
  fns.__setGameplayStateForTest({
    score: 18.5,
    unlockedUntil: null
  });
  fns.render();

  const relock = fns.__elementsById.get("relock");
  assert.equal(relock.disabled, true);
  assert.equal(relock.hidden, true);
  relock.dispatchEvent({ type: "click" });
  await settleHandlers();

  assert.equal(chrome.count("RELOCK"), 0);
  assert.equal(fns.__getGameplayStateForTest().score, 18.5);
  assert.equal(fns.__getGameplayStateForTest().problemStateMutationDepth, 0);
});

test("thrown unlock request releases the global mutation gate and restores controls", async () => {
  const chrome = makeChromeController();
  const fns = loadChallengeFns({
    includeBootstrap: true,
    chromeOverride: chrome.chrome,
    fetchImpl: () => new Promise(() => {})
  });
  const problem = mcq("throw-unlock");
  fns.__transitionProblemForTest(problem);
  await flush(fns);
  fns.__setGameplayStateForTest({ score: 30 });
  fns.render();
  chrome.throwNext("REQUEST_UNLOCK");

  fns.__elementsById.get("unlock").dispatchEvent({ type: "click" });
  await settleHandlers();
  await flush(fns);
  const state = fns.__getGameplayStateForTest();
  assert.equal(state.problemStateMutationDepth, 0);
  assert.equal(state.readyProblemRenderRevision, state.problemRenderRevision);
});

test("Tutor transition generation discards old responses without clearing a newer request", async () => {
  const responses = [deferred(), deferred()];
  let fetchIndex = 0;
  const fns = loadChallengeFns({
    fetchImpl: () => responses[fetchIndex++].promise
  });
  const firstProblem = mcq("tutor-first");
  const secondProblem = mcq("tutor-second");
  fns.__transitionProblemForTest(firstProblem);
  await flush(fns);
  fns.__elementsById.get("ai-provider").value = "openai";
  fns.__elementsById.get("ai-model").value = "model";
  fns.__elementsById.get("ai-token").value = "token";

  const oldRequest = fns.submitTutorPrompt("old question");
  assert.equal(fns.__getGameplayStateForTest().aiBusy, true);
  fns.__transitionProblemForTest(secondProblem, "Tutor moved to second problem.");
  await flush(fns);
  const newRequest = fns.submitTutorPrompt("new question");
  assert.equal(fns.__getGameplayStateForTest().aiBusy, true);

  responses[0].resolve({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "OLD ANSWER" } }] })
  });
  assert.equal(await oldRequest, false);
  assert.equal(fns.__getGameplayStateForTest().aiBusy, true);
  assert.deepEqual(Array.from(fns.__getGameplayStateForTest().aiHistory), []);

  responses[1].resolve({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "NEW ANSWER" } }] })
  });
  assert.equal(await newRequest, true);
  const state = fns.__getGameplayStateForTest();
  assert.equal(state.aiBusy, false);
  assert.deepEqual(
    Array.from(state.aiHistory, (item) => item.content),
    ["new question", "NEW ANSWER"]
  );
});

test("manual Tutor cancel invalidates a provider response that ignores AbortSignal", async () => {
  const response = deferred();
  const fns = loadChallengeFns({ fetchImpl: () => response.promise });
  fns.initTutorUi();
  await settleHandlers();
  const input = fns.__elementsById.get("ai-input");
  fns.__elementsById.get("ai-provider").value = "openai";
  fns.__elementsById.get("ai-model").value = "model";
  fns.__elementsById.get("ai-token").value = "token";
  input.value = "please help";
  const form = fns.__elementsById.get("ai-form");

  form.dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(fns.__getGameplayStateForTest().aiBusy, true);
  form.dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(fns.__getGameplayStateForTest().aiBusy, false);

  response.resolve({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "LATE ANSWER" } }] })
  });
  await settleHandlers();
  assert.deepEqual(Array.from(fns.__getGameplayStateForTest().aiHistory), []);

  input.__focused = false;
  fns.cancelTutorForProblemTransition();
  assert.equal(input.__focused, false, "no-active transition cancel must not steal focus");
});

test("wrong-choice rerender keeps a same-problem Tutor request valid", async () => {
  const response = deferred();
  const fns = loadChallengeFns({ fetchImpl: () => response.promise });
  const problem = mcq("tutor-wrong", 0);
  fns.__transitionProblemForTest(problem);
  await flush(fns);
  fns.__elementsById.get("ai-provider").value = "openai";
  fns.__elementsById.get("ai-model").value = "model";
  fns.__elementsById.get("ai-token").value = "token";
  const tutor = fns.submitTutorPrompt("hint");
  const revision = fns.__getGameplayStateForTest().problemRenderRevision;

  assert.equal(await fns.handleMcqChoice(1, problem, revision), true);
  await flush(fns);
  assert.equal(fns.__getGameplayStateForTest().aiBusy, true);

  response.resolve({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "STILL CURRENT" } }] })
  });
  assert.equal(await tutor, true);
  const state = fns.__getGameplayStateForTest();
  assert.equal(state.aiBusy, false);
  assert.deepEqual(
    Array.from(state.aiHistory, (item) => item.content),
    ["hint", "STILL CURRENT"]
  );
});

test("out-of-order model catalogs cannot overwrite the newest provider/token selection", async () => {
  const responses = [deferred(), deferred()];
  let fetchIndex = 0;
  const fns = loadChallengeFns({
    fetchImpl: () => responses[fetchIndex++].promise
  });
  const provider = fns.__elementsById.get("ai-provider");
  const token = fns.__elementsById.get("ai-token");
  const model = fns.__elementsById.get("ai-model");

  provider.value = "openai";
  token.value = "token-a";
  model.value = "old-selection";
  const oldRequest = fns.updateModelOptionsForConfig(
    "openai",
    "token-a",
    "old-selection",
    true
  );

  provider.value = "openrouter";
  token.value = "token-b";
  model.value = "new-selection";
  const newRequest = fns.updateModelOptionsForConfig(
    "openrouter",
    "token-b",
    "new-model",
    true
  );

  responses[1].resolve({
    ok: true,
    json: async () => ({ data: [{ id: "new-model" }] })
  });
  assert.deepEqual(Array.from(await newRequest), ["new-model"]);
  assert.equal(model.value, "new-model");

  responses[0].resolve({
    ok: true,
    json: async () => ({ data: [{ id: "old-model" }] })
  });
  assert.equal(await oldRequest, null);
  assert.equal(model.value, "new-model");
});

test("out-of-order pool loads apply only the latest chip intent and advance once", async () => {
  const loads = {
    amc10: deferred(),
    amc12: deferred()
  };
  const fetchCalls = [];
  const fns = loadChallengeFns({
    poolKeys: ["amc10", "amc12"],
    fetchImpl: (url) => {
      const value = String(url);
      const key = value.includes("amc12") ? "amc12" : "amc10";
      fetchCalls.push(key);
      return loads[key].promise;
    }
  });
  const initial = mcq("pool-initial");
  fns.__setProblemBankForTest("amc8", [initial]);
  fns.__transitionProblemForTest(initial);
  await flush(fns);
  const initialRevision = fns.__getGameplayStateForTest().problemRenderRevision;
  fns.initPoolChips();

  fns.__poolChips[0].dispatchEvent({ type: "click" });
  fns.__poolChips[1].dispatchEvent({ type: "click" });
  await settleHandlers();
  assert.deepEqual(fetchCalls, ["amc10", "amc12"]);

  loads.amc12.resolve({
    ok: true,
    json: async () => [mcq("pool-amc12")]
  });
  await settleHandlers();
  await flush(fns);
  let state = fns.__getGameplayStateForTest();
  assert.equal(state.poolEnabled.amc12, true);
  assert.equal(state.poolEnabled.amc10, false);
  assert.equal(state.problemRenderRevision, initialRevision + 1);

  loads.amc10.resolve({
    ok: true,
    json: async () => [mcq("pool-amc10")]
  });
  await settleHandlers();
  await flush(fns);
  state = fns.__getGameplayStateForTest();
  assert.equal(state.poolLoaded.amc10, true, "stale load may still warm the bank cache");
  assert.equal(state.poolEnabled.amc10, false, "stale load cannot change selection");
  assert.equal(state.problemRenderRevision, initialRevision + 1);
});

test("duplicate clicks share one pool fetch and only the latest handler advances", async () => {
  const load = deferred();
  let fetchCalls = 0;
  const fns = loadChallengeFns({
    poolKeys: ["amc10"],
    fetchImpl: () => {
      fetchCalls += 1;
      return load.promise;
    }
  });
  const initial = mcq("pool-double-initial");
  fns.__setProblemBankForTest("amc8", [initial]);
  fns.__transitionProblemForTest(initial);
  await flush(fns);
  const initialRevision = fns.__getGameplayStateForTest().problemRenderRevision;
  fns.initPoolChips();

  const chip = fns.__poolChips[0];
  chip.dispatchEvent({ type: "click" });
  chip.dispatchEvent({ type: "click" });
  await settleHandlers();
  assert.equal(fetchCalls, 1);

  load.resolve({
    ok: true,
    json: async () => [mcq("pool-double-loaded")]
  });
  await settleHandlers();
  await flush(fns);
  const state = fns.__getGameplayStateForTest();
  assert.equal(state.poolEnabled.amc10, true);
  assert.equal(state.problemRenderRevision, initialRevision + 1);
});
