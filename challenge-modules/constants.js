(function registerConstants(global) {
  const root = global.RB || (global.RB = {});

  /** @type {Record<string, number>} */
  const DECAY_DURATION_BY_CONTEST_MS = {
    amc8: 6 * 60 * 1000,
    amc10: 8 * 60 * 1000,
    amc12: 10 * 60 * 1000,
    aime: Infinity,
    upper_level_mcq: 8 * 60 * 1000,
    calculus: 8 * 60 * 1000
  };

  /** @type {Record<string, number>} */
  const BASE_WEIGHT_BY_CONTEST = {
    amc8: 5,
    amc10: 8,
    amc12: 12,
    aime: 30,
    upper_level_mcq: 5,
    calculus: 5
  };

  /** @type {Record<string, string>} */
  const POOL_FILE_BY_KEY = {
    amc8: "amc8",
    amc10: "amc10",
    amc12: "amc12",
    aime: "aime",
    gre: "upper_level_mcq",
    calculus: "calculus_mcq_synthetic"
  };

  /** @type {Record<string, number>} */
  const POOL_WEIGHTS = {
    amc8: 35,
    amc10: 20,
    amc12: 15,
    aime: 10,
    gre: 10,
    calculus: 10
  };

  root.constants = {
    ...root.constants,
    DECAY_DURATION_BY_CONTEST_MS,
    BASE_WEIGHT_BY_CONTEST,
    POOL_FILE_BY_KEY,
    POOL_WEIGHTS,
    GUESS_MULTIPLIERS: [1, 0.1, 0.02, 0, 0],
    WRONG_GUESS_PENALTIES: { 2: 1.0, 3: 3.0, 4: 6.0 },
    RECENT_PROBLEM_LIMIT: 30,
    UI_TICK_INTERVAL_MS: 1000,
    SYNC_DIAGNOSTICS_FAST_MS: 5000,
    SYNC_DIAGNOSTICS_SLOW_MS: 30000,
    MODEL_CACHE_TTL_MS: 6 * 60 * 60 * 1000,
    DEFAULT_SYSTEM_PROMPT: "You are a mathematics tutoring coach. Your role is to help the user develop problem-solving ability while they work on contest-style math questions. Do not provide full solutions or final answers to active problems. If the user asks to give up, decline and continue with guided support. Provide clear, informative hints that build intuition, emphasize strategy, and break the problem into actionable next steps. Format math using MathJax-compatible LaTeX delimiters: use $...$ for inline math and $$...$$ for display math, keeping normal prose outside math delimiters.",
    AI_PROVIDER_OPENAI: "openai",
    AI_PROVIDER_OPENROUTER: "openrouter",
    SUPPORTED_AI_PROVIDERS: new Set(["openai", "openrouter"])
  };
})(globalThis);
