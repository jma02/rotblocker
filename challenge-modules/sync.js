const RB_SYNC_ROOT = globalThis.RB || (globalThis.RB = {});
const RB_SYNC_CONSTANTS = RB_SYNC_ROOT.constants || {};
const SYNC_FAST_INTERVAL_MS = RB_SYNC_CONSTANTS.SYNC_DIAGNOSTICS_FAST_MS || 5000;
const SYNC_SLOW_INTERVAL_MS = RB_SYNC_CONSTANTS.SYNC_DIAGNOSTICS_SLOW_MS || 30000;

/** @param {AppState | null | undefined} payload */
function applyStateFromPayload(payload) {
  if (!payload || typeof payload !== "object") return;
  if (Object.prototype.hasOwnProperty.call(payload, "requiredScore")) {
    requiredScore = Number(payload.requiredScore || requiredScore);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "score")) {
    score = Number(payload.score || 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "xp")) {
    xp = Number(payload.xp || 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "prestige")) {
    prestige = Number(payload.prestige || 0);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "unlockedUntil")) {
    unlockedUntil = payload.unlockedUntil;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "unlockDurationMs")) {
    unlockDurationMs = Number(payload.unlockDurationMs || unlockDurationMs);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "lockoutCooldownMs")) {
    unlockDurationMs = Number(payload.lockoutCooldownMs || unlockDurationMs);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "stateUpdatedAt")) {
    stateUpdatedAt = Math.floor(Number(payload.stateUpdatedAt) || stateUpdatedAt || Date.now());
  }
}

function currentSyncState() {
  return {
    requiredScore,
    score,
    xp,
    prestige,
    unlockedUntil,
    lockoutCooldownMs: unlockDurationMs,
    unlockDurationMs,
    stateUpdatedAt
  };
}

function formatSyncAge(ts) {
  const stamp = Math.floor(Number(ts));
  if (!Number.isFinite(stamp) || stamp <= 0) return "--";
  const ageMs = Math.max(0, Date.now() - stamp);
  if (ageMs < 5000) return "just now";
  if (ageMs < 60 * 1000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60 * 1000) return `${Math.floor(ageMs / (60 * 1000))}m ago`;
  if (ageMs < 24 * 60 * 60 * 1000) return `${Math.floor(ageMs / (60 * 60 * 1000))}h ago`;
  return `${Math.floor(ageMs / (24 * 60 * 60 * 1000))}d ago`;
}

function formatSyncMoment(ts) {
  const stamp = Math.floor(Number(ts));
  if (!Number.isFinite(stamp) || stamp <= 0) return "--";
  const localTime = new Date(stamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
  return `${formatSyncAge(stamp)} (${localTime})`;
}

function applySyncDiagnostics(status) {
  if (!syncLastEl || !syncErrorEl || !syncStatusEl) return;
  const data = status && typeof status === "object" ? status : {};
  const available = Boolean(data.available);
  const pending = Boolean(data.pending);
  const lastSyncedAt = Math.floor(Number(data.lastSyncedAt));
  const errorText = String(data.lastError || "").trim();

  if (!available) {
    syncStatusEl.textContent = "Sync: unavailable";
    syncLastEl.textContent = "Last synced: unavailable";
    syncErrorEl.hidden = false;
    syncErrorEl.textContent = `Sync error: ${errorText || "Chrome profile sync unavailable."}`;
    return;
  }

  if (pending) {
    syncStatusEl.textContent = "Sync: queued";
  } else if (errorText) {
    syncStatusEl.textContent = "Sync: error";
  } else {
    syncStatusEl.textContent = "Sync: automatic (Chrome storage sync)";
  }

  if (Number.isFinite(lastSyncedAt) && lastSyncedAt > 0) {
    syncLastEl.textContent = `Last synced: ${formatSyncMoment(lastSyncedAt)}`;
  } else if (pending) {
    syncLastEl.textContent = "Last synced: pending first write";
  } else {
    syncLastEl.textContent = "Last synced: waiting for first write";
  }

  if (errorText) {
    syncErrorEl.hidden = false;
    syncErrorEl.textContent = `Sync error: ${errorText}`;
  } else {
    syncErrorEl.hidden = true;
    syncErrorEl.textContent = "";
  }
}

function desiredSyncDiagnosticsIntervalMs(status) {
  const data = status && typeof status === "object" ? status : {};
  const available = Boolean(data.available);
  const pending = Boolean(data.pending);
  const hasError = String(data.lastError || "").trim().length > 0;
  if (!available || pending || hasError) {
    return SYNC_FAST_INTERVAL_MS;
  }
  return SYNC_SLOW_INTERVAL_MS;
}

function stopSyncDiagnosticsPolling() {
  if (syncDiagnosticsIntervalId) {
    clearInterval(syncDiagnosticsIntervalId);
    syncDiagnosticsIntervalId = null;
  }
}

function restartSyncDiagnosticsPolling() {
  stopSyncDiagnosticsPolling();
  if (!isDocumentVisible()) return;
  syncDiagnosticsIntervalId = setInterval(() => {
    void refreshSyncDiagnostics();
  }, syncDiagnosticsIntervalMs);
}

async function refreshSyncDiagnostics() {
  if (!syncStatusEl || !syncLastEl || !syncErrorEl) return null;
  let normalizedStatus = null;
  const status = await sendMessage({ type: "GET_SYNC_STATUS" });
  if (!status || !status.ok) {
    normalizedStatus = {
      available: false,
      pending: false,
      lastSyncedAt: null,
      lastError: "Could not read sync diagnostics."
    };
  } else {
    normalizedStatus = status;
  }
  applySyncDiagnostics(normalizedStatus);
  const nextInterval = desiredSyncDiagnosticsIntervalMs(normalizedStatus);
  if (nextInterval !== syncDiagnosticsIntervalMs) {
    syncDiagnosticsIntervalMs = nextInterval;
    if (cloudSyncInitialized) {
      restartSyncDiagnosticsPolling();
    }
  }
  return normalizedStatus;
}

function renderSyncUi(statusText = null) {
  if (!syncStatusEl || !syncUserEl) return;
  const status = syncClient?.getStatus?.() || { enabled: false, signedIn: false, configError: "Sync unavailable." };
  const enabled = Boolean(status.enabled);
  const signedIn = Boolean(status.signedIn);
  const message = statusText
    || (enabled
      ? (signedIn ? "Sync: ready" : "Sync: sign in required")
      : `Sync: ${status.configError || "unavailable"}`);
  syncStatusEl.textContent = message;
  syncUserEl.textContent = signedIn ? `Account: ${status.email || status.uid}` : "Account: not signed in";
  if (syncSignInEl) syncSignInEl.disabled = !enabled || signedIn || syncBusy;
  if (syncSignOutEl) syncSignOutEl.disabled = !enabled || !signedIn || syncBusy;
  if (syncNowEl) syncNowEl.disabled = !enabled || !signedIn || syncBusy;
  if (syncBoxEl) syncBoxEl.style.display = "";
}

function scheduleCloudSync(delayMs = 1400) {
  if (cloudSyncInitialized) {
    syncDiagnosticsIntervalMs = SYNC_FAST_INTERVAL_MS;
    restartSyncDiagnosticsPolling();
  }
  void refreshSyncDiagnostics();
  if (!syncClient) return;
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer);
  }
  syncDebounceTimer = setTimeout(() => {
    syncDebounceTimer = null;
    void runCloudSync("debounced");
  }, delayMs);
}

async function runCloudSync(reason = "auto", options = {}) {
  if (!syncClient) return;
  if (syncBusy && !options.force) return;
  syncBusy = true;
  renderSyncUi("Sync: working...");

  try {
    const stateRes = await sendMessage({ type: "GET_STATE" });
    if (!stateRes || !stateRes.ok) {
      throw new Error("Could not read local state for sync.");
    }
    applyStateFromPayload(stateRes);

    const result = await syncClient.syncState(currentSyncState());
    if (!result || !result.ok) {
      if (result?.code === "not_signed_in") {
        renderSyncUi("Sync: sign in required");
        if (options.manual) {
          setFeedback("Sign in to enable cloud sync.", false);
        }
        return;
      }
      throw new Error(result?.message || "Cloud sync failed.");
    }

    if (result.action === "apply_remote" && result.remoteState) {
      const applyRes = await sendMessage({ type: "APPLY_SYNC_STATE", state: result.remoteState });
      if (!applyRes || !applyRes.ok) {
        throw new Error("Failed to apply remote state.");
      }
      applyStateFromPayload(applyRes);
      render();
      renderLevelUi();
      renderSyncUi("Sync: pulled cloud state");
      if (options.manual) {
        setFeedback("Cloud state pulled to this device.", true);
      }
      return;
    }

    if (result.action === "pushed_local") {
      renderSyncUi("Sync: pushed local state");
      if (options.manual) {
        setFeedback("Local state pushed to cloud.", true);
      }
      return;
    }

    renderSyncUi("Sync: already up to date");
    if (options.manual) {
      setFeedback("Cloud and local state are in sync.", true);
    }
  } catch (err) {
    renderSyncUi("Sync: error");
    if (options.manual) {
      setFeedback(err instanceof Error ? err.message : "Cloud sync failed.", false);
    }
  } finally {
    syncBusy = false;
    renderSyncUi();
  }
}

async function initCloudSync() {
  if (!syncStatusEl || !syncUserEl) return;
  cloudSyncInitialized = true;
  syncStatusEl.textContent = "Sync: automatic (Chrome storage sync)";
  syncUserEl.textContent = "Account: managed by your Chrome profile";
  if (syncLastEl) syncLastEl.textContent = "Last synced: waiting for first write";
  if (syncErrorEl) {
    syncErrorEl.hidden = true;
    syncErrorEl.textContent = "";
  }
  if (syncSignInEl) syncSignInEl.style.display = "none";
  if (syncSignOutEl) syncSignOutEl.style.display = "none";
  if (syncNowEl) syncNowEl.style.display = "none";
  syncDiagnosticsIntervalMs = SYNC_FAST_INTERVAL_MS;
  await refreshSyncDiagnostics();
  restartSyncDiagnosticsPolling();
}

RB_SYNC_ROOT.sync = {
  ...RB_SYNC_ROOT.sync,
  applyStateFromPayload,
  currentSyncState,
  formatSyncAge,
  formatSyncMoment,
  applySyncDiagnostics,
  desiredSyncDiagnosticsIntervalMs,
  stopSyncDiagnosticsPolling,
  restartSyncDiagnosticsPolling,
  refreshSyncDiagnostics,
  renderSyncUi,
  scheduleCloudSync,
  runCloudSync,
  initCloudSync
};
