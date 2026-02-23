const RB_TUTOR_ROOT = globalThis.RB || (globalThis.RB = {});
const RB_TUTOR_CONSTANTS = RB_TUTOR_ROOT.constants || {};
const MODEL_CACHE_TTL_MS = RB_TUTOR_CONSTANTS.MODEL_CACHE_TTL_MS || 6 * 60 * 60 * 1000;
const DEFAULT_SYSTEM_PROMPT = RB_TUTOR_CONSTANTS.DEFAULT_SYSTEM_PROMPT || "You are a mathematics tutoring coach. Your role is to help the user develop problem-solving ability while they work on contest-style math questions. Do not provide full solutions or final answers to active problems. If the user asks to give up, decline and continue with guided support. Provide clear, informative hints that build intuition, emphasize strategy, and break the problem into actionable next steps. Format math using MathJax-compatible LaTeX delimiters: use $...$ for inline math and $$...$$ for display math, keeping normal prose outside math delimiters.";
const AI_PROVIDER_OPENAI = RB_TUTOR_CONSTANTS.AI_PROVIDER_OPENAI || "openai";
const AI_PROVIDER_OPENROUTER = RB_TUTOR_CONSTANTS.AI_PROVIDER_OPENROUTER || "openrouter";
const SUPPORTED_AI_PROVIDERS = RB_TUTOR_CONSTANTS.SUPPORTED_AI_PROVIDERS || new Set([
  AI_PROVIDER_OPENAI,
  AI_PROVIDER_OPENROUTER
]);

function normalizeAiProvider(provider) {
  const normalized = String(provider || "").trim().toLowerCase();
  if (SUPPORTED_AI_PROVIDERS.has(normalized)) return normalized;
  return AI_PROVIDER_OPENAI;
}

function resolveAiProviderMeta(provider) {
  const normalized = normalizeAiProvider(provider);
  if (normalized === AI_PROVIDER_OPENROUTER) {
    return {
      id: normalized,
      modelsUrl: "https://openrouter.ai/api/v1/models",
      chatUrl: "https://openrouter.ai/api/v1/chat/completions",
      includeOpenRouterHeaders: true
    };
  }

  return {
    id: normalized,
    modelsUrl: "https://api.openai.com/v1/models",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    includeOpenRouterHeaders: false
  };
}
function appendChat(role, text) {
  if (!aiChatEl) return;
  const div = document.createElement("div");
  div.className = `chat-item ${role}`;
  const content = String(text || "");
  const roleLabel = role === "user" ? "YOU" : role === "assistant" ? "PoBot" : "System";

  const prefixEl = document.createElement("span");
  prefixEl.className = "chat-role-prefix";
  prefixEl.textContent = `${roleLabel}:`;
  div.appendChild(prefixEl);

  const bodyEl = document.createElement("span");
  bodyEl.className = "chat-message-body";
  const shouldRenderMarkdown = role === "assistant" && hasAssistantMarkdownSyntax(content);
  const shouldRenderMath =
    role === "assistant" &&
    /(?<!\\)\$|\\\(|\\\[|\\(?:frac|sqrt|cdot|times|otimes|sum|int|theta|alpha|beta|gamma|pi|leq|geq|left|right|begin|end|boxed|overline|underline)/.test(content);
  if (shouldRenderMarkdown) {
    renderAssistantMarkdownText(bodyEl, content);
  } else if (shouldRenderMath) {
    renderMathText(bodyEl, sanitizeForMathJax(content));
  } else {
    bodyEl.textContent = content;
  }
  div.appendChild(bodyEl);
  aiChatEl.appendChild(div);
  aiChatEl.scrollTop = aiChatEl.scrollHeight;
}

function appendChatLoading() {
  if (!aiChatEl || aiLoadingMessageEl) return;
  const div = document.createElement("div");
  div.className = "chat-item assistant chat-loading";
  div.setAttribute("aria-live", "polite");
  div.setAttribute("aria-label", "PoBot is thinking");

  const role = document.createElement("span");
  role.className = "chat-role-prefix chat-loading-role";
  role.textContent = "PoBot:";
  div.appendChild(role);

  const dots = document.createElement("span");
  dots.className = "chat-loading-dots";
  for (let i = 0; i < 3; i += 1) {
    const dot = document.createElement("span");
    dot.className = "chat-loading-dot";
    dots.appendChild(dot);
  }
  div.appendChild(dots);

  aiChatEl.appendChild(div);
  aiChatEl.scrollTop = aiChatEl.scrollHeight;
  aiLoadingMessageEl = div;
}

function removeChatLoading() {
  if (aiLoadingMessageEl && typeof aiLoadingMessageEl.remove === "function") {
    aiLoadingMessageEl.remove();
  }
  aiLoadingMessageEl = null;
}

function setTutorSubmitLoading(loading) {
  const isLoading = Boolean(loading);
  if (!aiSubmitEl) return;
  aiSubmitEl.disabled = false;
  aiSubmitEl.classList.toggle("is-loading", isLoading);
  aiSubmitEl.classList.toggle("is-cancel", isLoading);
  if (isLoading) {
    aiSubmitEl.innerHTML = "<span class=\"ai-submit-text\">Cancel</span><span class=\"chat-loading-dots\" aria-hidden=\"true\"><span class=\"chat-loading-dot\"></span><span class=\"chat-loading-dot\"></span><span class=\"chat-loading-dot\"></span></span>";
    aiSubmitEl.setAttribute("aria-label", "Cancel request");
  } else {
    aiSubmitEl.textContent = "Ask Tutor";
    aiSubmitEl.setAttribute("aria-label", "Ask Tutor");
  }
}

function isAbortError(err) {
  if (!err) return false;
  const name = String(err.name || "");
  const message = String(err.message || "");
  return name === "AbortError" || /aborted|abort/i.test(message);
}

function extractApiErrorDetail(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text);
    const fromError = parsed?.error;
    if (typeof fromError === "string" && fromError.trim()) {
      return fromError.trim();
    }
    const fromMessage = parsed?.error?.message || parsed?.message || parsed?.detail;
    if (typeof fromMessage === "string" && fromMessage.trim()) {
      return fromMessage.trim();
    }
  } catch (_err) {
    // Fallback to plain-text normalization.
  }
  return text.replace(/\s+/g, " ").trim();
}

function summarizeTutorHttpError(status, context = "chat") {
  if (status === 400) return "Invalid request sent to the AI provider.";
  if (status === 401 || status === 403) return "Authentication failed. Check provider and API token.";
  if (status === 404) {
    return context === "models"
      ? "Model catalog endpoint was not found."
      : "Selected model or endpoint was not found.";
  }
  if (status === 408) return "Provider timed out. Try again.";
  if (status === 429) return "Rate limit reached. Wait a moment and retry.";
  if (status >= 500) return "AI provider is temporarily unavailable.";
  return `AI provider returned HTTP ${status}.`;
}

function formatTutorError(err, context = "chat") {
  const fallbackSummary = context === "models" ? "Could not load models." : "Tutor request failed.";
  const raw = err instanceof Error ? String(err.message || "") : String(err || "");
  const msg = raw.trim();

  const apiPattern = /^(?:API error|Model fetch failed)\s+(\d+):\s*([\s\S]*)$/i;
  const matched = msg.match(apiPattern);
  if (matched) {
    const status = Number.parseInt(matched[1], 10);
    const detail = extractApiErrorDetail(matched[2]).slice(0, 240);
    return {
      summary: summarizeTutorHttpError(status, context),
      detail: detail || `HTTP ${status}`
    };
  }

  if (/network|failed to fetch|fetch failed|load failed/i.test(msg)) {
    return {
      summary: "Network error while contacting AI provider.",
      detail: msg || "Check connection and try again."
    };
  }

  if (!msg) {
    return {
      summary: fallbackSummary,
      detail: ""
    };
  }

  return {
    summary: fallbackSummary,
    detail: msg.slice(0, 240)
  };
}

function appendChatError(err, context = "chat") {
  if (!aiChatEl) return;
  const { summary, detail } = formatTutorError(err, context);

  const card = document.createElement("div");
  card.className = "chat-item system chat-error";

  const role = document.createElement("div");
  role.className = "chat-role-prefix chat-error-role";
  role.textContent = "PoBot:";
  card.appendChild(role);

  const label = document.createElement("div");
  label.className = "chat-error-label";
  label.textContent = context === "models" ? "Model Error" : "Tutor Error";
  card.appendChild(label);

  const summaryEl = document.createElement("div");
  summaryEl.className = "chat-error-summary";
  summaryEl.textContent = summary;
  card.appendChild(summaryEl);

  if (detail && detail !== summary) {
    const detailEl = document.createElement("div");
    detailEl.className = "chat-error-detail";
    detailEl.textContent = detail;
    card.appendChild(detailEl);
  }

  aiChatEl.appendChild(card);
  aiChatEl.scrollTop = aiChatEl.scrollHeight;
}

/** @returns {AiConfig | null} */
function getApiConfig() {
  if (!aiProviderEl || !aiModelEl || !aiTokenEl) return null;
  return {
    provider: normalizeAiProvider(aiProviderEl.value),
    model: aiModelEl.value.trim(),
    token: aiTokenEl.value.trim()
  };
}

function modelCacheKey(provider, token) {
  const suffix = (token || "").slice(-8) || "no_token";
  return `ai_models_cache_${provider}_${suffix}`;
}

function setModelOptions(models, selectedModel) {
  if (!aiModelEl) return;
  aiModelEl.innerHTML = "";
  const list = Array.isArray(models) ? models : [];
  const usable = list.length > 0 ? list : ["gpt-4o-mini"];
  usable.forEach((id) => {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    aiModelEl.appendChild(opt);
  });
  aiModelEl.value = usable.includes(selectedModel) ? selectedModel : usable[0];
}

async function fetchAndCacheModels(provider, token, force = false) {
  if (!provider || !token) {
    return ["gpt-4o-mini"];
  }

  const providerMeta = resolveAiProviderMeta(provider);
  const cacheKey = modelCacheKey(providerMeta.id, token);
  const cached = await getLocal([cacheKey]);
  const entry = cached?.[cacheKey];
  if (
    !force &&
    entry &&
    Array.isArray(entry.models) &&
    entry.models.length > 0 &&
    Number.isFinite(entry.fetchedAt) &&
    Date.now() - entry.fetchedAt < MODEL_CACHE_TTL_MS
  ) {
    return entry.models;
  }

  const url = providerMeta.modelsUrl;

  const headers = {
    Authorization: `Bearer ${token}`
  };
  if (providerMeta.includeOpenRouterHeaders) {
    headers["HTTP-Referer"] = chromeApi.runtime.getURL("rotblocker++/index.html");
    headers["X-Title"] = "rotblocker++";
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Model fetch failed ${res.status}: ${text.slice(0, 120)}`);
  }
  const json = await res.json();
  const raw = Array.isArray(json?.data) ? json.data : [];
  const models = raw
    .map((m) => String(m?.id || "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  if (models.length === 0) {
    return ["gpt-4o-mini"];
  }

  await setLocal({
    [cacheKey]: {
      models,
      fetchedAt: Date.now()
    }
  });
  return models;
}

async function saveAiConfig() {
  const cfg = getApiConfig();
  if (!cfg) return;
  const payload = {
    provider: cfg.provider,
    model: cfg.model,
    token: cfg.token
  };
  await setLocal({
    ai_config: payload
  });
  const synced = await setSync({ ai_config: payload });
  if (synced) {
    appendChat("system", "Saved API settings.");
  } else {
    appendChat("system", "Saved API settings locally. Profile sync unavailable.");
  }
}

async function loadAiConfig() {
  if (!aiProviderEl || !aiModelEl || !aiTokenEl) return;
  const [syncOut, localOut] = await Promise.all([
    getSync(["ai_config"]),
    getLocal(["ai_config"])
  ]);
  const syncCfg = syncOut?.ai_config;
  const localCfg = localOut?.ai_config;
  const cfg = (syncCfg && typeof syncCfg === "object")
    ? syncCfg
    : ((localCfg && typeof localCfg === "object") ? localCfg : null);

  if (cfg && typeof cfg === "object") {
    // Keep local storage warm for extension startup and local preview mode.
    await setLocal({ ai_config: cfg });
    // One-time migration for existing local-only tokens into synced profile storage.
    if (!syncCfg) {
      await setSync({ ai_config: cfg });
    }
  }

  let preferredModel = "gpt-4o-mini";
  if (cfg && typeof cfg === "object") {
    const provider = normalizeAiProvider(cfg.provider || AI_PROVIDER_OPENAI);
    aiProviderEl.value = provider;
    preferredModel = cfg.model || "gpt-4o-mini";
    aiTokenEl.value = cfg.token || "";
  }

  try {
    const models = await fetchAndCacheModels(aiProviderEl.value, aiTokenEl.value, false);
    setModelOptions(models, preferredModel);
  } catch (_err) {
    setModelOptions(["gpt-4o-mini"], preferredModel);
  }
}

function getTutorProblemEvent() {
  const root = globalThis.RB || {};
  const value = typeof root.tutorProblemEvent === "string" ? root.tutorProblemEvent : "";
  return value.trim().slice(0, 280);
}

function buildTutorUserPrompt(userText) {
  const context = typeof buildProblemContext === "function"
    ? buildProblemContext()
    : "No active problem yet.";
  const event = getTutorProblemEvent() || "No recent problem transition.";
  const prompt = String(userText || "").trim();
  return [
    "CURRENT PROBLEM:",
    context,
    "",
    `RECENT STATE: ${event}`,
    "",
    "USER PROMPT:",
    prompt || "(empty)"
  ].join("\n");
}

async function callTutor(userText, signal = undefined) {
  const cfg = getApiConfig();
  if (!cfg || !cfg.token || !cfg.model) {
    throw new Error("Set provider/model/token first.");
  }

  const providerMeta = resolveAiProviderMeta(cfg.provider);
  const url = providerMeta.chatUrl;

  const contextualizedUserPrompt = buildTutorUserPrompt(userText);
  const messages = [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    ...aiHistory.slice(-8),
    { role: "user", content: contextualizedUserPrompt }
  ];

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.token}`
  };

  if (providerMeta.includeOpenRouterHeaders) {
    headers["HTTP-Referer"] = chromeApi.runtime.getURL("rotblocker++/index.html");
    headers["X-Title"] = "rotblocker++";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: 0.4
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text.slice(0, 180)}`);
  }

  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("No assistant message returned.");
  }
  return String(content);
}

async function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("theme-dark", isDark);
  if (themeToggleEl) {
    themeToggleEl.textContent = isDark ? "Light mode" : "Dark mode";
  }
}

async function initTheme() {
  const { ui_theme: storedTheme } = await getLocal(["ui_theme"]);
  if (storedTheme === "dark" || storedTheme === "light") {
    await applyTheme(storedTheme);
  } else {
    const prefersDark = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    await applyTheme(prefersDark ? "dark" : "light");
  }

  if (themeToggleEl) {
    themeToggleEl.addEventListener("click", () => {
      const next = document.body.classList.contains("theme-dark") ? "light" : "dark";
      void applyTheme(next);
      void setLocal({ ui_theme: next });
    });
  }
}

function initTutorUi() {
  if (tutorUiInitialized) return;
  if (!aiSystemEl || !aiFormEl || !aiInputEl) return;
  tutorUiInitialized = true;
  aiSystemEl.value = DEFAULT_SYSTEM_PROMPT;

  perfMark("tutor:config_load_start");
  void loadAiConfig().finally(() => {
    perfMark("tutor:config_load_end");
    perfMeasure("tutor:config_load_ms", "tutor:config_load_start", "tutor:config_load_end");
  });
  appendChat("system", "Tutor ready. Ask for intuition, patterns, and next steps.");
  setTutorSubmitLoading(false);

  if (aiSaveEl) {
    aiSaveEl.addEventListener("click", () => {
      void (async () => {
        try {
          const cfg = getApiConfig();
          if (cfg?.token) {
            const models = await fetchAndCacheModels(cfg.provider, cfg.token, false);
            setModelOptions(models, cfg.model);
          }
          await saveAiConfig();
        } catch (err) {
          appendChatError(err, "models");
        }
      })();
    });
  }

  if (aiRefreshModelsEl) {
    aiRefreshModelsEl.addEventListener("click", () => {
      void (async () => {
        const cfg = getApiConfig();
        if (!cfg?.token) {
          appendChat("system", "Enter an API token first to fetch models.");
          return;
        }
        try {
          const models = await fetchAndCacheModels(cfg.provider, cfg.token, true);
          setModelOptions(models, cfg.model);
          appendChat("system", `Loaded ${models.length} models from ${cfg.provider}.`);
        } catch (err) {
          appendChatError(err, "models");
        }
      })();
    });
  }

  if (aiProviderEl) {
    aiProviderEl.addEventListener("change", () => {
      void (async () => {
        const cfg = getApiConfig();
        if (!cfg?.token) {
          setModelOptions(["gpt-4o-mini"], "gpt-4o-mini");
          return;
        }
        try {
          const models = await fetchAndCacheModels(cfg.provider, cfg.token, false);
          setModelOptions(models, cfg.model);
        } catch (err) {
          appendChatError(err, "models");
          setModelOptions(["gpt-4o-mini"], cfg.model);
        }
      })();
    });
  }

  aiFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    if (aiBusy) {
      if (!aiAbortController) return;
      try {
        aiAbortController.abort();
      } catch (_err) {
        // Ignore abort errors from non-standard runtimes.
      }
      return;
    }

    const text = aiInputEl.value.trim();
    if (!text) return;

    aiInputEl.value = "";
    appendChat("user", text);

    aiBusy = true;
    aiInputEl.disabled = true;
    setTutorSubmitLoading(true);
    appendChatLoading();
    aiAbortController = typeof AbortController !== "undefined" ? new AbortController() : null;

    void (async () => {
      try {
        const answer = await callTutor(text, aiAbortController?.signal);
        aiHistory.push({ role: "user", content: text });
        aiHistory.push({ role: "assistant", content: answer });
        removeChatLoading();
        appendChat("assistant", answer);
      } catch (err) {
        removeChatLoading();
        if (isAbortError(err)) {
          appendChat("system", "Request canceled.");
        } else {
          appendChatError(err, "chat");
        }
      } finally {
        removeChatLoading();
        aiAbortController = null;
        aiBusy = false;
        aiInputEl.disabled = false;
        setTutorSubmitLoading(false);
        aiInputEl.focus();
      }
    })();
  });
}

function runWhenIdle(task, timeout = 1200) {
  if (typeof task !== "function") return;
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(() => { void task(); }, { timeout });
    return;
  }
  setTimeout(() => { void task(); }, 0);
}

async function ensureTutorUiInitialized() {
  if (tutorUiInitialized) return;
  perfMark("tutor:init_start");
  initTutorUi();
  perfMark("tutor:init_end");
  perfMeasure("tutor:init_ms", "tutor:init_start", "tutor:init_end");
}

RB_TUTOR_ROOT.tutor = {
  ...RB_TUTOR_ROOT.tutor,
  normalizeAiProvider,
  resolveAiProviderMeta,
  appendChat,
  appendChatLoading,
  removeChatLoading,
  setTutorSubmitLoading,
  isAbortError,
  extractApiErrorDetail,
  summarizeTutorHttpError,
  formatTutorError,
  appendChatError,
  getApiConfig,
  modelCacheKey,
  setModelOptions,
  getTutorProblemEvent,
  buildTutorUserPrompt,
  fetchAndCacheModels,
  saveAiConfig,
  loadAiConfig,
  callTutor,
  applyTheme,
  initTheme,
  initTutorUi,
  runWhenIdle,
  ensureTutorUiInitialized
};
