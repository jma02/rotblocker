(function registerDom(global) {
  const root = global.RB || (global.RB = {});
  const doc = global.document;

  if (!doc || typeof doc.getElementById !== "function") {
    root.dom = { refs: {} };
    return;
  }

  const aiFormEl = doc.getElementById("ai-form");

  root.dom = {
    refs: {
      statusEl: doc.getElementById("status"),
      timerEl: doc.getElementById("timer"),
      livePointsEl: doc.getElementById("live-points"),
      globalTimerEl: doc.getElementById("global-timer"),
      rerollBtnEl: doc.getElementById("reroll-btn"),
      xpSummaryEl: doc.getElementById("xp-summary"),
      xpFillEl: doc.getElementById("xp-fill"),
      xpNextEl: doc.getElementById("xp-next"),
      prestigeSummaryEl: doc.getElementById("prestige-summary"),
      prestigeBtnEl: doc.getElementById("prestige-btn"),
      xpPanelEl: doc.getElementById("xp-panel"),
      xpCloseEl: doc.getElementById("xp-close"),
      xpReopenEl: doc.getElementById("xp-reopen"),
      xpAvatarEl: doc.getElementById("xp-avatar") || doc.querySelector(".xp-avatar"),
      syncBoxEl: doc.getElementById("sync-box"),
      syncStatusEl: doc.getElementById("sync-status"),
      syncUserEl: doc.getElementById("sync-user"),
      syncLastEl: doc.getElementById("sync-last"),
      syncErrorEl: doc.getElementById("sync-error"),
      syncSignInEl: doc.getElementById("sync-signin"),
      syncSignOutEl: doc.getElementById("sync-signout"),
      syncNowEl: doc.getElementById("sync-now"),
      domainSettingsToggleEl: doc.getElementById("domain-settings-toggle"),
      domainSettingsModalEl: doc.getElementById("domain-settings-modal"),
      domainSettingsBackdropEl: doc.getElementById("domain-settings-backdrop"),
      domainSettingsPanelEl: doc.getElementById("domain-settings-panel"),
      domainSettingsFormEl: doc.getElementById("domain-settings-form"),
      domainSettingsInputEl: doc.getElementById("domain-settings-input"),
      domainSettingsFeedbackEl: doc.getElementById("domain-settings-feedback"),
      domainSettingsListEl: doc.getElementById("domain-settings-list"),
      domainSettingsCloseEl: doc.getElementById("domain-settings-close"),
      lockoutSettingsFormEl: doc.getElementById("lockout-settings-form"),
      lockoutCooldownInputEl: doc.getElementById("lockout-cooldown-input"),
      lockoutSettingsFeedbackEl: doc.getElementById("lockout-settings-feedback"),
      feedbackEl: doc.getElementById("feedback"),
      problemEl: doc.getElementById("problem"),
      diagramWrapEl: doc.getElementById("diagram-wrap"),
      diagramImgEl: doc.getElementById("diagram-img"),
      formEl: doc.getElementById("answer-form"),
      answerEl: doc.getElementById("answer"),
      choicesEl: doc.getElementById("choices"),
      metaEl: doc.getElementById("meta"),
      unlockBtn: doc.getElementById("unlock"),
      relockBtn: doc.getElementById("relock"),
      quizEl: doc.getElementById("quiz"),
      themeToggleEl: doc.getElementById("theme-toggle"),
      tutorPanelEl: doc.getElementById("tutor-panel"),
      aiCloseEl: doc.getElementById("ai-close"),
      aiReopenEl: doc.getElementById("ai-reopen"),
      aiProviderEl: doc.getElementById("ai-provider"),
      aiModelEl: doc.getElementById("ai-model"),
      aiTokenEl: doc.getElementById("ai-token"),
      aiSaveEl: doc.getElementById("ai-save"),
      aiRefreshModelsEl: doc.getElementById("ai-refresh-models"),
      aiSystemEl: doc.getElementById("ai-system"),
      aiChatEl: doc.getElementById("ai-chat"),
      aiFormEl,
      aiInputEl: doc.getElementById("ai-input"),
      aiSubmitEl: aiFormEl ? aiFormEl.querySelector('button[type="submit"]') : null,
      poolChipEls: Array.from(doc.querySelectorAll(".pool-chip"))
    }
  };
})(globalThis);
