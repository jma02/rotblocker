function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickOne(items) {
  return items[randomInt(0, items.length - 1)];
}

function weightedPick(weighted) {
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) return item.value;
  }
  return weighted[weighted.length - 1].value;
}

function setTutorProblemEvent(note) {
  const root = globalThis.RB || (globalThis.RB = {});
  root.tutorProblemEvent = String(note || "").trim().slice(0, 280);
}

/** @param {Problem | null | undefined} problem */
function getSanitizedPrompt(problem) {
  if (problem && typeof problem.__sanitizedPrompt === "string") {
    return problem.__sanitizedPrompt;
  }
  return sanitizeForMathJax(problem?.prompt).trim();
}

/** @param {Problem | null | undefined} problem */
function getSanitizedChoices(problem) {
  if (problem && Array.isArray(problem.__sanitizedChoices)) {
    return problem.__sanitizedChoices;
  }
  if (!problem || !Array.isArray(problem.choices)) return [];
  return problem.choices.map((choice) => sanitizeForMathJax(choice).trim());
}

/** @param {Problem | null | undefined} problem */
function getNormalizedChoices(problem) {
  if (problem && Array.isArray(problem.__normalizedChoices)) {
    return problem.__normalizedChoices;
  }
  return getSanitizedChoices(problem).map((choice) => normalizeChoiceMath(choice));
}

/** @param {Problem | null | undefined} problem */
function prepareProblemForBank(problem) {
  if (!problem || typeof problem !== "object") return null;
  const prepared = { ...problem };
  prepared.__sanitizedPrompt = sanitizeForMathJax(problem.prompt).trim();
  if (prepared.type === "mcq" && Array.isArray(problem.choices)) {
    prepared.__sanitizedChoices = problem.choices.map((choice) => sanitizeForMathJax(choice).trim());
    prepared.__normalizedChoices = prepared.__sanitizedChoices.map((choice) => normalizeChoiceMath(choice));
  }
  return prepared;
}

/** @param {Problem | null | undefined} problem */
function problemLooksRenderable(problem) {
  if (!problem) return false;
  const hasOddUnescapedDollar = (value) => {
    let count = 0;
    const source = String(value || "");
    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === "$" && source[i - 1] !== "\\") count += 1;
    }
    return count % 2 === 1;
  };
  const hasBalancedDelimiters = (value) => {
    const source = String(value || "");
    return (
      (source.match(/\(/g) || []).length === (source.match(/\)/g) || []).length
      && (source.match(/\[/g) || []).length === (source.match(/\]/g) || []).length
      && (source.match(/\{/g) || []).length === (source.match(/\}/g) || []).length
    );
  };
  const hasSevereOcrNoise = (value) => /[]|(?:WARNING:)|(?:\blimx\b)|(?:\bidenity\b)|(?:\bEuqal\b)|(?:hasatleastoneroot)|(?:oaixi)|(?:aixi)/i.test(String(value || ""));
  const looksTruncatedPrompt = (value) => {
    const source = String(value || "").trim();
    if (!source) return true;
    // OCR/import failures often truncate prompts at connector words.
    return (
      /\b(?:if|to|where|when|such that)\s*$/i.test(source)
      || /\b(?:find|determine|compute)\s+(?:the\s+)?(?:value|sum|product|area|measure)\s+of\s*$/i.test(source)
      || /:\s*$/.test(source)
    );
  };

  const prompt = getSanitizedPrompt(problem);
  if (!prompt) return false;
  if (
    hasOddUnescapedDollar(prompt)
    || !hasBalancedDelimiters(prompt)
    || hasSevereOcrNoise(prompt)
    || (problem.type === "input" && looksTruncatedPrompt(prompt))
    || hasUndelimitedMathSyntax(prompt)
  ) return false;
  if (problem.type === "mcq") {
    if (!Array.isArray(problem.choices) || problem.choices.length !== 5) return false;
    const sanitizedChoices = getSanitizedChoices(problem);
    if (sanitizedChoices.some((c) => !c)) return false;
    if (
      sanitizedChoices.some(
        (c) =>
          hasOddUnescapedDollar(c)
          || !hasBalancedDelimiters(c)
          || hasSevereOcrNoise(c)
          || hasUndelimitedMathSyntax(c)
      )
    ) return false;
    if (contestKey(problem) === "upper_level_mcq") {
      const greJoined = `${prompt} ${sanitizedChoices.join(" ")}`;
      if (
        /(?:TRICKS INVOLVED|References?:|GO ON TO THE NEXT P ?AGE)/i.test(greJoined)
        || /Which one of the statements about G cannot be true/i.test(greJoined)
        || /Thereexistsanelement/i.test(greJoined)
        || /x,y̸=e/i.test(greJoined)
        || /inxyz[-\s]*space/i.test(greJoined)
        || /radius of convergence of the series/i.test(greJoined)
        || /2·\s*4·\s*6·\s*\.\.\.\s*·\s*2n/i.test(greJoined)
        || /\bC\d+e[txyz]\b/.test(greJoined)
        || /\bt\d+e[txyz]\b/.test(greJoined)
        || /\\pi\s+\d+\s+\d+/.test(greJoined)
        || /\\sqrt\{\d+\s+\d+\}/.test(greJoined)
        || /\b\d+\s+\d+\s+\d+\b/.test(greJoined)
      ) {
        return false;
      }
      const ambiguousFractionLike = sanitizedChoices.filter((c) => /^[+-]?\s*(?:e|\\pi)?\s*\d+\s+\d+(?:\s+\d+)?\s*$/i.test(c)).length;
      if (ambiguousFractionLike >= 2) return false;
    }
  }
  return true;
}

function enabledPools() {
  return Object.keys(poolEnabled).filter((key) => poolLoaded[key] && poolEnabled[key] && poolAvailable[key]);
}

function poolDisplayName(key) {
  const names = {
    amc8: "AMC8",
    amc10: "AMC10",
    amc12: "AMC12",
    aime: "AIME",
    gre: "GRE",
    calculus: "Calculus"
  };
  return names[key] || String(key || "").toUpperCase();
}

function syncPoolChipUi() {
  poolChipEls.forEach((el) => {
    const key = String(el.dataset.pool || "");
    const available = Boolean(poolAvailable[key]);
    const on = Boolean(poolEnabled[key]);
    el.setAttribute("aria-pressed", on ? "true" : "false");
    el.setAttribute("aria-disabled", available ? "false" : "true");
    el.disabled = !available;
    if (!available) {
      el.title = `${poolDisplayName(key)} dataset unavailable`;
    } else {
      el.removeAttribute("title");
    }
  });
}

function initPoolChips() {
  syncPoolChipUi();
  poolChipEls.forEach((el) => {
    el.addEventListener("click", () => {
      void (async () => {
        const key = String(el.dataset.pool || "");
        if (!Object.prototype.hasOwnProperty.call(poolEnabled, key)) return;

        const currentlyOn = Boolean(poolEnabled[key]);
        if (currentlyOn) {
          if (enabledPools().length === 1) {
            setFeedback("Keep at least one problem pool enabled.", false);
            return;
          }
          poolEnabled[key] = false;
          syncPoolChipUi();
          setFeedback(`${poolDisplayName(key)} pool disabled.`, true);
          nextProblem();
          render();
          return;
        }

        if (!poolLoaded[key]) {
          el.disabled = true;
          const available = await loadPoolBank(key);
          syncPoolChipUi();
          if (!available) {
            setFeedback(`${poolDisplayName(key)} dataset unavailable in this build.`, false);
            render();
            return;
          }
        }

        if (!poolAvailable[key]) {
          setFeedback(`${poolDisplayName(key)} dataset unavailable in this build.`, false);
          return;
        }

        poolEnabled[key] = true;
        syncPoolChipUi();
        setFeedback(`${poolDisplayName(key)} pool enabled.`, true);
        nextProblem();
        render();
      })();
    });
  });
}

function guessMultiplierNow() {
  const guessNumber = Math.min(mcqWrongGuesses + 1, 5);
  return scoringApi.guessMultiplier(guessNumber, GUESS_MULTIPLIERS);
}

function contestKey(problem) {
  if (!problem) return "amc10";
  if (problem.contest) {
    const key = String(problem.contest).toLowerCase();
    if (key === "upper_level_mcq") return "upper_level_mcq";
    if (key === "calculus") return "calculus";
    return key;
  }

  const label = String(problem.label || "").toLowerCase();
  if (label.includes("amc 8") || label.includes("amc8")) return "amc8";
  if (label.includes("amc 10") || label.includes("amc10")) return "amc10";
  if (label.includes("amc 12") || label.includes("amc12")) return "amc12";
  if (label.includes("aime")) return "aime";
  if (label.includes("gre")) return "upper_level_mcq";
  if (label.includes("calculus")) return "calculus";
  return "amc10";
}

function decayDurationNow() {
  const key = contestKey(currentProblem);
  return DECAY_DURATION_BY_CONTEST_MS[key] || 8 * 60 * 1000;
}

/** @param {Problem | null | undefined} problem */
function resolveDiagramMultiSources(problem) {
  const raw = [
    ...(Array.isArray(problem?.diagramPngs) ? problem.diagramPngs : []),
    ...(Array.isArray(problem?.diagramSvgs) ? problem.diagramSvgs : [])
  ];
  const out = [];
  const seen = new Set();
  raw.forEach((value) => {
    const resolved = resolveAssetPath(value);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
  });
  return out;
}

/** @param {Problem | null | undefined} problem */
function resolveDiagramFallbackSources(problem) {
  const raw = [problem?.diagramPng, problem?.diagramSvg];
  const out = [];
  const seen = new Set();
  raw.forEach((value) => {
    const resolved = resolveAssetPath(value);
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    out.push(resolved);
  });
  return out;
}

function baseWeightNow() {
  if (!currentProblem) return 0;
  const key = contestKey(currentProblem);
  return BASE_WEIGHT_BY_CONTEST[key] || Number(currentProblem.weight || 0);
}

function decayedBaseNow() {
  if (!currentProblem) return 0;
  if (contestKey(currentProblem) === "aime") return baseWeightNow();
  return scoringApi.decayedBasePoints(
    baseWeightNow(),
    Date.now() - problemStartMs,
    decayDurationNow()
  );
}

function pointsIfCorrectNow() {
  if (!currentProblem) return 0;
  const isAime = contestKey(currentProblem) === "aime";
  return scoringApi.pointsIfCorrectNow({
    baseWeight: baseWeightNow(),
    elapsedMs: isAime ? 0 : Date.now() - problemStartMs,
    durationMs: decayDurationNow(),
    isMcq: currentProblem.type === "mcq",
    wrongGuesses: mcqWrongGuesses,
    multipliers: GUESS_MULTIPLIERS
  });
}

function levelFromXp(totalXp) {
  const xpSafe = Math.max(0, Number(totalXp) || 0);
  const lvl = Math.floor(Math.sqrt(xpSafe / 25)) + 1;
  return Math.max(1, lvl);
}

function avatarTierFromLevel(level) {
  const lvl = Math.max(1, Number(level) || 1);
  if (lvl >= 10) return "legend";
  if (lvl >= 7) return "veteran";
  if (lvl >= 4) return "adept";
  return "rookie";
}

function avatarPrestigeTier(prestigeCount) {
  const p = Math.max(0, Number(prestigeCount) || 0);
  if (p >= 3) return 3;
  if (p >= 2) return 2;
  if (p >= 1) return 1;
  return 0;
}

function renderAvatarUi(level, prestigeCount) {
  if (!xpAvatarEl) return;
  const tier = avatarTierFromLevel(level);
  xpAvatarEl.classList.remove("avatar-rookie", "avatar-adept", "avatar-veteran", "avatar-legend");
  xpAvatarEl.classList.add(`avatar-${tier}`);

  const prestigeTier = avatarPrestigeTier(prestigeCount);
  xpAvatarEl.setAttribute("data-prestige", String(prestigeTier));
  xpAvatarEl.setAttribute("title", `Avatar tier: ${tier}${prestigeTier > 0 ? ` • prestige ${prestigeTier}` : ""}`);
}

function xpForLevel(level) {
  const l = Math.max(1, level);
  return 25 * (l - 1) * (l - 1);
}

function canPrestigeNow() {
  return levelFromXp(xp) >= 10;
}

function xpMultiplierFromPrestige() {
  return 1 + Math.max(0, Number(prestige) || 0) * 0.05;
}

function renderLevelUi() {
  if (!xpSummaryEl || !xpFillEl || !xpNextEl) return;
  const level = levelFromXp(xp);
  const currBase = xpForLevel(level);
  const nextBase = xpForLevel(level + 1);
  const inLevel = Math.max(0, xp - currBase);
  const span = Math.max(1, nextBase - currBase);
  const pct = Math.max(0, Math.min(100, (inLevel / span) * 100));

  xpSummaryEl.textContent = `Level ${level} • XP ${xp.toFixed(2)}`;
  xpFillEl.style.width = `${pct}%`;
  xpNextEl.textContent = `Next level in ${(nextBase - xp).toFixed(2)} XP`;
  if (prestigeSummaryEl) {
    prestigeSummaryEl.textContent = `Prestige ${prestige} • XP gain x${xpMultiplierFromPrestige().toFixed(2)}`;
  }
  if (prestigeBtnEl) {
    prestigeBtnEl.disabled = !canPrestigeNow();
  }
  renderAvatarUi(level, prestige);
}

function formatClock(ms) {
  const safe = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function renderGlobalTimer() {
  if (!globalTimerEl) return;
  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  if (locked) {
    globalTimerEl.textContent = "Revalidation: required now";
    return;
  }

  const remaining = unlockedUntil - Date.now();
  globalTimerEl.textContent = `Revalidation in: ${formatClock(remaining)}`;
}

function renderLiveStats() {
  const hasPrestige = Math.max(0, Number(prestige) || 0) > 0;
  if (livePointsEl) livePointsEl.style.display = "";

  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  if (!locked || !currentProblem) {
    if (timerEl) timerEl.textContent = "Time: --";
    if (livePointsEl) livePointsEl.textContent = "Current Value: --";
    renderGlobalTimer();
    return;
  }

  if (timerEl) {
    if (contestKey(currentProblem) === "aime") {
      timerEl.textContent = "Decay: none (AIME)";
    } else {
      const remainingMs = Math.max(0, decayDurationNow() - (Date.now() - problemStartMs));
      const seconds = Math.ceil(remainingMs / 1000);
      timerEl.textContent = `Decay Timer: ${seconds}s`;
    }
  }

  if (livePointsEl) {
    const value = pointsIfCorrectNow().toFixed(2);
    livePointsEl.textContent = hasPrestige
      ? `Current Value: ${value} • XP x${xpMultiplierFromPrestige().toFixed(2)}`
      : `Current Value: ${value}`;
  }

  renderGlobalTimer();
}

async function fetchDataJson(name) {
  const paths = [
    resolveAssetPath(`data/${name}.json`),
    `../data/${name}.json`,
    `data/${name}.json`
  ];
  for (const p of Array.from(new Set(paths.filter(Boolean)))) {
    try {
      const res = await fetch(p);
      if (res.ok) return res.json();
    } catch (_err) {
      // Try the next candidate path.
    }
  }
  throw new Error(`Failed to load ${name}.json`);
}

async function loadPoolBank(poolKey) {
  if (!Object.prototype.hasOwnProperty.call(POOL_FILE_BY_KEY, poolKey)) {
    return false;
  }
  if (poolLoaded[poolKey]) {
    return Boolean(poolAvailable[poolKey]);
  }

  const fileKey = POOL_FILE_BY_KEY[poolKey];
  try {
    const loaded = await fetchDataJson(fileKey);
    const rows = Array.isArray(loaded) ? loaded : [];
    const seen = new Set();
    const filtered = [];
    for (const row of rows) {
      const prepared = prepareProblemForBank(row);
      if (!prepared) continue;
      if (!problemLooksRenderable(prepared)) continue;
      const dedupeKey = String(prepared.id || prepared.__sanitizedPrompt.toLowerCase());
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      filtered.push(prepared);
    }
    banks[poolKey] = filtered;
    poolAvailable[poolKey] = banks[poolKey].length > 0;
  } catch (_err) {
    banks[poolKey] = [];
    poolAvailable[poolKey] = false;
  }

  poolLoaded[poolKey] = true;
  if (!poolAvailable[poolKey]) {
    poolEnabled[poolKey] = false;
  }
  return Boolean(poolAvailable[poolKey]);
}

async function loadBanks() {
  const failed = [];
  const initialKeys = Object.keys(poolEnabled).filter((key) => poolEnabled[key]);
  await Promise.all(initialKeys.map(async (poolKey) => {
    const available = await loadPoolBank(poolKey);
    if (!available) {
      failed.push(poolDisplayName(poolKey));
    }
  }));

  let loadedAvailableCount = Object.keys(poolAvailable).filter((key) => poolLoaded[key] && poolAvailable[key]).length;
  if (loadedAvailableCount === 0) {
    const fallbackKeys = Object.keys(poolEnabled).filter((key) => !poolLoaded[key]);
    for (const key of fallbackKeys) {
      const available = await loadPoolBank(key);
      if (!available) continue;
      poolEnabled[key] = true;
      loadedAvailableCount += 1;
      break;
    }
  }

  if (loadedAvailableCount === 0) {
    throw new Error("No problem datasets loaded.");
  }

  if (enabledPools().length === 0) {
    const firstAvailable = Object.keys(poolAvailable).find((key) => poolLoaded[key] && poolAvailable[key]);
    if (firstAvailable) poolEnabled[firstAvailable] = true;
  }
  return { failed };
}

function nextProblem(eventNote = null) {
  currentProblem = buildNextProblemCandidate();

  if (!currentProblem) {
    setTutorProblemEvent("No enabled problem pools with data.");
    setFeedback("No enabled problem pools with data.", false);
    return;
  }

  setTutorProblemEvent(eventNote || "Loaded a new problem.");
  aiHistory = [];
  problemStartMs = Date.now();
  mcqWrongGuesses = 0;
  usedChoices = new Set();
  if (currentProblem.id) {
    recentProblemIds.push(currentProblem.id);
    if (recentProblemIds.length > RECENT_PROBLEM_LIMIT) {
      recentProblemIds.splice(0, recentProblemIds.length - RECENT_PROBLEM_LIMIT);
    }
  }
  renderProblem();
}

function buildNextProblemCandidate() {
  const candidates = enabledPools().filter((key) => Array.isArray(banks[key]) && banks[key].length > 0);
  if (candidates.length === 0) return null;

  const weighted = candidates.map((key) => ({ value: key, weight: poolWeights[key] || 1 }));
  let fallback = null;
  const attempts = Math.max(80, candidates.length * 20);
  for (let i = 0; i < attempts; i += 1) {
    const category = weightedPick(weighted);
    const pool = banks[category];
    if (!pool || pool.length === 0) continue;
    const candidate = pickOne(pool);
    if (!problemLooksRenderable(candidate)) continue;
    fallback = fallback || candidate;
    if (!candidate.id || !recentProblemIds.includes(candidate.id)) {
      return candidate;
    }
  }
  return fallback;
}

function setFeedback(text, ok) {
  if (!feedbackEl) return;
  feedbackEl.textContent = text;
  feedbackEl.className = `feedback ${ok ? "ok" : "bad"}`;
}

function renderProblem() {
  if (!currentProblem) return;

  if (metaEl) metaEl.textContent = `${currentProblem.label} • Base ${baseWeightNow()} points`;
  renderMathText(problemEl, getSanitizedPrompt(currentProblem));
  if (diagramWrapEl && diagramImgEl) {
    const extraImgs = Array.from(diagramWrapEl.querySelectorAll(".diagram-img-extra"));
    extraImgs.forEach((el) => el.remove());
    diagramWrapEl.classList.remove("diagram-multi");
    diagramImgEl.classList.remove("diagram-tiny", "diagram-small", "diagram-wide", "diagram-tall");
    diagramImgEl.onerror = null;
    diagramImgEl.onload = null;

    const multiSources = resolveDiagramMultiSources(currentProblem);
    if (multiSources.length > 0) {
      const createImg = (src, isPrimary) => {
        const img = isPrimary ? diagramImgEl : document.createElement("img");
        img.className = `diagram-img${isPrimary ? "" : " diagram-img-extra"}`;
        img.alt = `Problem diagram ${isPrimary ? "1" : ""}`.trim();
        img.loading = "lazy";
        img.decoding = "async";
        img.style.display = "inline-block";
        img.onerror = () => {
          img.style.display = "none";
        };
        img.onload = () => {
          applyDiagramSizing(img);
        };
        img.src = src;
        if (!isPrimary) diagramWrapEl.appendChild(img);
      };
      diagramWrapEl.classList.add("diagram-multi");
      diagramWrapEl.style.display = "block";
      multiSources.forEach((src, idx) => createImg(src, idx === 0));
    } else {
      const fallbackSources = resolveDiagramFallbackSources(currentProblem);
      if (fallbackSources.length > 0) {
        let srcIndex = 0;
        const setSource = () => {
          if (srcIndex >= fallbackSources.length) {
            diagramImgEl.removeAttribute("src");
            diagramImgEl.style.display = "none";
            diagramWrapEl.style.display = "none";
            return;
          }
          diagramImgEl.style.display = "inline-block";
          diagramImgEl.src = fallbackSources[srcIndex];
        };
        diagramImgEl.onerror = () => {
          srcIndex += 1;
          setSource();
        };
        diagramImgEl.onload = () => {
          diagramImgEl.onerror = null;
          applyDiagramSizing(diagramImgEl);
        };
        diagramWrapEl.style.display = "block";
        setSource();
      } else {
        diagramImgEl.removeAttribute("src");
        diagramImgEl.style.display = "none";
        diagramWrapEl.style.display = "none";
      }
    }
  }
  if (currentProblem.type === "input") {
    if (formEl) formEl.style.display = "flex";
    if (choicesEl) {
      choicesEl.style.display = "none";
      choicesEl.innerHTML = "";
    }
    if (answerEl) {
      answerEl.value = "";
      answerEl.focus();
    }
  } else {
    if (formEl) formEl.style.display = "none";
    if (choicesEl) {
      choicesEl.style.display = "grid";
      choicesEl.innerHTML = "";
    }

    const normalizedChoices = getNormalizedChoices(currentProblem);
    normalizedChoices.forEach((normalizedChoice, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      const label = String.fromCharCode(65 + index);
      renderMathText(btn, `${label}. ${normalizedChoice}`, { inlineOnly: true });
      btn.disabled = usedChoices.has(index);
      btn.addEventListener("click", () => {
        void handleMcqChoice(index);
      });
      if (choicesEl) choicesEl.appendChild(btn);
    });
  }

  renderLiveStats();
  renderLevelUi();
}

function render() {
  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  lastLockState = locked;

  if (locked) {
    if (statusEl) statusEl.textContent = `Score: ${score.toFixed(2)}/${requiredScore}`;
    if (quizEl) quizEl.style.display = "block";
    if (unlockBtn) {
      unlockBtn.disabled = score < requiredScore;
      unlockBtn.textContent = "Unlock Sites";
    }
  } else {
    if (statusEl) statusEl.textContent = `Unlocked for ${formatClock(unlockDurationMs)} total.`;
    if (quizEl) quizEl.style.display = "none";
    if (unlockBtn) {
      unlockBtn.disabled = true;
      unlockBtn.textContent = "Already Unlocked";
    }
  }

  renderLiveStats();
}

function tickUi() {
  const locked = !unlockedUntil || unlockedUntil <= Date.now();
  if (lastLockState === null || locked !== lastLockState) {
    render();
    return;
  }
  renderLiveStats();
}

function startUiTickLoop() {
  if (uiTickIntervalId || !isDocumentVisible()) return;
  uiTickIntervalId = setInterval(tickUi, UI_TICK_INTERVAL_MS);
}

function stopUiTickLoop() {
  if (!uiTickIntervalId) return;
  clearInterval(uiTickIntervalId);
  uiTickIntervalId = null;
}

function handleVisibilityPerformanceMode() {
  if (isDocumentVisible()) {
    startUiTickLoop();
    if (cloudSyncInitialized) {
      syncApi.restartSyncDiagnosticsPolling?.();
      void syncApi.refreshSyncDiagnostics?.();
    }
    return;
  }
  stopUiTickLoop();
  if (cloudSyncInitialized) {
    syncApi.stopSyncDiagnosticsPolling?.();
  }
}

async function refreshState() {
  const state = await sendMessage({ type: "GET_STATE" });
  if (!state || !state.ok) {
    setFeedback("Could not load extension state.", false);
    return;
  }

  syncApi.applyStateFromPayload?.(state);
  render();
  renderLevelUi();
}

async function awardPointsAndAdvance(points) {
  if (points <= 0) {
    setFeedback("Correct, but this question is worth +0 due to timer/guess penalties.", false);
    nextProblem("Previous problem was answered correctly, but earned +0 points due to penalties.");
    render();
    return;
  }

  const res = await sendMessage({ type: "ADD_SCORE", points });
  if (!res || !res.ok) {
    setFeedback("Could not record score.", false);
    return;
  }

  score = Number(res.score || 0);
  xp = Number(res.xp || xp);
  prestige = Number(res.prestige || prestige);
  stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
  setFeedback(`Correct. +${points.toFixed(2)} points.`, true);
  nextProblem(`Previous problem was answered correctly (+${points.toFixed(2)} points).`);
  render();
  syncApi.scheduleCloudSync?.();
}

async function handleMcqChoice(index) {
  if (!currentProblem || currentProblem.type !== "mcq") return;
  if (usedChoices.has(index)) return;

  const isCorrect = index === currentProblem.answerIndex;
  if (isCorrect) {
    await awardPointsAndAdvance(pointsIfCorrectNow());
    return;
  }

  usedChoices.add(index);
  mcqWrongGuesses += 1;

  const penalty = WRONG_GUESS_PENALTIES[mcqWrongGuesses] || 0;
  if (penalty > 0) {
    const res = await sendMessage({ type: "ADD_SCORE", points: -penalty });
    if (res && res.ok) {
      score = Number(res.score || score);
      xp = Number(res.xp || xp);
      prestige = Number(res.prestige || prestige);
      stateUpdatedAt = Math.floor(Number(res.stateUpdatedAt) || stateUpdatedAt || Date.now());
      setFeedback(
        `Incorrect. -${penalty.toFixed(2)} points. Next correct guess multiplier: x${guessMultiplierNow()}.`,
        false
      );
      syncApi.scheduleCloudSync?.();
    } else {
      setFeedback(`Incorrect. Next correct guess multiplier: x${guessMultiplierNow()}.`, false);
    }
  } else {
    setFeedback(`Incorrect. Next correct guess multiplier: x${guessMultiplierNow()}.`, false);
  }
  renderProblem();
  render();
}

/** @returns {string} */
function buildProblemContext() {
  if (!currentProblem) {
    return "No active problem yet.";
  }

  const parts = [
    `Problem label: ${currentProblem.label}`,
    `Problem type: ${currentProblem.type}`,
    `Prompt: ${getSanitizedPrompt(currentProblem)}`,
    `Base points: ${baseWeightNow()}`,
    `Time-decayed points now: ${pointsIfCorrectNow().toFixed(2)}`,
    `Wrong guesses so far: ${mcqWrongGuesses}`
  ];

  if (currentProblem.type === "mcq") {
    const choices = getSanitizedChoices(currentProblem);
    parts.push(`Choices: ${choices.map((v, i) => `${String.fromCharCode(65 + i)}. ${v}`).join(" | ")}`);
  }

  return parts.join("\n");
}

function isInputAnswerCorrect(submitted, problem) {
  if (!problem) return false;
  if (Array.isArray(problem.acceptableAnswers) && problem.acceptableAnswers.length > 0) {
    return problem.acceptableAnswers.some((v) => Number(v) === submitted);
  }
  return submitted === Number(problem.answer);
}

const RB_GAMEPLAY_ROOT = globalThis.RB || (globalThis.RB = {});
RB_GAMEPLAY_ROOT.gameplay = {
  ...RB_GAMEPLAY_ROOT.gameplay,
  randomInt,
  pickOne,
  weightedPick,
  getSanitizedPrompt,
  getSanitizedChoices,
  getNormalizedChoices,
  prepareProblemForBank,
  problemLooksRenderable,
  enabledPools,
  poolDisplayName,
  syncPoolChipUi,
  initPoolChips,
  guessMultiplierNow,
  contestKey,
  decayDurationNow,
  baseWeightNow,
  decayedBaseNow,
  pointsIfCorrectNow,
  levelFromXp,
  avatarTierFromLevel,
  avatarPrestigeTier,
  renderAvatarUi,
  xpForLevel,
  canPrestigeNow,
  xpMultiplierFromPrestige,
  renderLevelUi,
  formatClock,
  renderGlobalTimer,
  renderLiveStats,
  fetchDataJson,
  loadPoolBank,
  loadBanks,
  nextProblem,
  buildNextProblemCandidate,
  setFeedback,
  renderProblem,
  render,
  tickUi,
  startUiTickLoop,
  stopUiTickLoop,
  handleVisibilityPerformanceMode,
  refreshState,
  awardPointsAndAdvance,
  handleMcqChoice,
  buildProblemContext,
  isInputAnswerCorrect
};
