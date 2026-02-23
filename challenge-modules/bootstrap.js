function bootstrapChallengeApp() {
if (formEl) {
  formEl.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentProblem || currentProblem.type !== "input") return;

    const submitted = Number(answerEl?.value);
    if (!Number.isFinite(submitted)) {
      setFeedback("Enter a valid number.", false);
      return;
    }

    if (!isInputAnswerCorrect(submitted, currentProblem)) {
      setFeedback("Incorrect. Next question.", false);
      nextProblem("Previous problem was answered incorrectly. Loaded a new problem.");
      render();
      return;
    }

    void awardPointsAndAdvance(pointsIfCorrectNow());
  });
}

if (rerollBtnEl) {
  rerollBtnEl.addEventListener("click", () => {
    const locked = !unlockedUntil || unlockedUntil <= Date.now();
    if (!locked) {
      setFeedback("Reroll is available while challenge mode is active.", false);
      return;
    }
    if (Date.now() < rerollLockedUntil) return;
    rerollLockedUntil = Date.now() + 350;
    rerollBtnEl.disabled = true;
    nextProblem("User rerolled the problem. Loaded a new problem.");
    setFeedback("Rerolled. No score change.", true);
    setTimeout(() => {
      rerollBtnEl.disabled = false;
    }, 350);
  });
}

if (prestigeBtnEl) {
  prestigeBtnEl.addEventListener("click", async () => {
    if (!canPrestigeNow()) {
      setFeedback("Reach level 10 to prestige.", false);
      return;
    }
    const confirmed = window.confirm("Prestige now? This resets current XP and score to 0.");
    if (!confirmed) return;

    const res = await sendMessage({ type: "PRESTIGE" });
    if (!res || !res.ok) {
      setFeedback(res?.error || "Prestige failed.", false);
      return;
    }

    prestige = Number(res.prestige || prestige + 1);
    xp = Number(res.xp || 0);
    score = Number(res.score || 0);
    stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
    setFeedback(`Prestige ${prestige} unlocked. XP gain is now x${xpMultiplierFromPrestige().toFixed(2)}.`, true);
    render();
    renderLevelUi();
    syncApi.scheduleCloudSync?.();
  });
}


if (unlockBtn) {
  unlockBtn.addEventListener("click", async () => {
    const res = await sendMessage({ type: "REQUEST_UNLOCK" });
    if (!res || !res.ok) {
      setFeedback(res?.error || "Unlock failed.", false);
      return;
    }

    unlockedUntil = res.unlockedUntil;
    if (Object.prototype.hasOwnProperty.call(res, "unlockDurationMs")) {
      unlockDurationMs = Number(res.unlockDurationMs || unlockDurationMs);
    }
    if (Object.prototype.hasOwnProperty.call(res, "lockoutCooldownMs")) {
      unlockDurationMs = Number(res.lockoutCooldownMs || unlockDurationMs);
    }
    stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
    score = 0;
    setFeedback(`Unlocked. Doomscroll timer started (${formatClock(unlockDurationMs)}).`, true);
    render();
    syncApi.scheduleCloudSync?.();
  });
}

if (relockBtn) {
  relockBtn.addEventListener("click", async () => {
    const res = await sendMessage({ type: "RELOCK" });
    if (!res || !res.ok) {
      setFeedback("Could not re-lock sites.", false);
      return;
    }

    unlockedUntil = null;
    score = 0;
    stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
    setFeedback("Sites locked again.", true);
    nextProblem("Challenge was relocked. Loaded a new problem.");
    render();
    syncApi.scheduleCloudSync?.();
  });
}

canonicalizeRotblockerPreviewPath();
bindMathJaxReadyRetry();
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", handleVisibilityPerformanceMode);
}
handleVisibilityPerformanceMode();

(async function init() {
  perfMark("init:start");
  let loadResult = { failed: [] };
  try {
    loadResult = await loadBanks();
  } catch (_err) {
    setFeedback("Failed to load problem datasets.", false);
    return;
  }
  perfMark("init:banks_loaded");
  perfMeasure("init:banks_load_ms", "init:start", "init:banks_loaded");

  await initTheme();
  const tutorVisibleOnInit = await initTutorVisibility();
  await initXpPanelVisibility();
  initPoolChips();
  initDomainSettingsUi();
  await refreshState();
  perfMark("init:first_problem_start");
  nextProblem("Challenge started. Loaded a new problem.");
  perfMark("init:first_problem_end");
  perfMeasure("init:first_problem_render_ms", "init:first_problem_start", "init:first_problem_end");
  tutorApi.runWhenIdle(async () => {
    await syncApi.initCloudSync?.();
  });
  if (tutorVisibleOnInit) {
    tutorApi.runWhenIdle(async () => {
      await tutorApi.ensureTutorUiInitialized?.();
    });
  }
  if (Array.isArray(loadResult.failed) && loadResult.failed.length > 0) {
    setFeedback(`Unavailable pools: ${loadResult.failed.join(", ")}.`, false);
  }
  perfMark("init:done");
  perfMeasure("init:total_ms", "init:start", "init:done");
})();
}

const RB_BOOTSTRAP_ROOT = globalThis.RB || (globalThis.RB = {});
RB_BOOTSTRAP_ROOT.bootstrap = {
  ...RB_BOOTSTRAP_ROOT.bootstrap,
  bootstrapChallengeApp
};

bootstrapChallengeApp();
