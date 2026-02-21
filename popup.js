const modeEl = document.getElementById("mode");
const windowEl = document.getElementById("window");
const remainingEl = document.getElementById("remaining");
const xpEl = document.getElementById("xp");
const levelEl = document.getElementById("level");
const prestigeEl = document.getElementById("prestige");
const xpMultiplierEl = document.getElementById("xp-multiplier");
const openBtn = document.getElementById("open-app");
const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const panelStatusEl = document.getElementById("panel-status");
const panelSettingsEl = document.getElementById("panel-settings");
const domainFormEl = document.getElementById("domain-form");
const domainInputEl = document.getElementById("domain-input");
const domainFeedbackEl = document.getElementById("domain-feedback");
const domainListEl = document.getElementById("domain-list");

function sendMessage(payload) {
  return new Promise((resolve) => chrome.runtime.sendMessage(payload, resolve));
}

function format(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  return `${m}m ${sec}s`;
}

function levelFromXp(totalXp) {
  const xpSafe = Math.max(0, Number(totalXp) || 0);
  return Math.max(1, Math.floor(Math.sqrt(xpSafe / 25)) + 1);
}

function setActiveTab(tab) {
  const isStatus = tab === "status";
  if (panelStatusEl) panelStatusEl.classList.toggle("active", isStatus);
  if (panelSettingsEl) panelSettingsEl.classList.toggle("active", !isStatus);
  tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
  });
}

function setDomainFeedback(text, ok = null) {
  if (!domainFeedbackEl) return;
  domainFeedbackEl.textContent = text || "";
  domainFeedbackEl.className = "feedback";
  if (ok === true) domainFeedbackEl.classList.add("ok");
  if (ok === false) domainFeedbackEl.classList.add("bad");
}

function renderDomainList(domains) {
  if (!domainListEl) return;
  domainListEl.innerHTML = "";
  if (!Array.isArray(domains) || domains.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-note";
    empty.textContent = "No custom domains yet.";
    domainListEl.appendChild(empty);
    return;
  }

  domains.forEach((domain) => {
    const li = document.createElement("li");
    li.className = "domain-item";

    const name = document.createElement("span");
    name.className = "domain-name";
    name.textContent = domain;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "domain-remove";
    removeBtn.dataset.domain = domain;
    removeBtn.textContent = "Remove";

    li.appendChild(name);
    li.appendChild(removeBtn);
    domainListEl.appendChild(li);
  });
}

let unlockedUntil = null;
let unlockDurationMs = 2 * 60 * 60 * 1000;

async function refreshState() {
  const state = await sendMessage({ type: "GET_STATE" });
  if (!state || !state.ok) {
    modeEl.textContent = "State unavailable";
    return;
  }

  unlockedUntil = state.unlockedUntil;
  unlockDurationMs = Number(state.unlockDurationMs || unlockDurationMs);

  const xp = Number(state.xp || 0);
  const level = levelFromXp(xp);
  const prestige = Math.max(0, Number(state.prestige) || 0);
  const xpMultiplier = 1 + prestige * 0.05;
  if (xpEl) xpEl.textContent = `XP: ${xp.toFixed(2)}`;
  if (levelEl) levelEl.textContent = `Level: ${level}`;
  if (prestigeEl) prestigeEl.textContent = `Prestige: ${prestige}`;
  if (xpMultiplierEl) xpMultiplierEl.textContent = `XP Gain: x${xpMultiplier.toFixed(2)}`;

  windowEl.textContent = `Window: ${format(unlockDurationMs)}`;

  if (!unlockedUntil || unlockedUntil <= Date.now()) {
    modeEl.textContent = "Status: Locked";
    remainingEl.textContent = "Remaining: 0s (revalidation needed)";
    return;
  }

  modeEl.textContent = "Status: Unlocked";
  remainingEl.textContent = `Remaining: ${format(unlockedUntil - Date.now())}`;
}

async function refreshCustomDomains() {
  const res = await sendMessage({ type: "GET_CUSTOM_DOMAINS" });
  if (!res || !res.ok) {
    setDomainFeedback("Could not load custom domains.", false);
    return;
  }
  renderDomainList(res.domains || []);
}

if (openBtn) {
  openBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("rotblocker++/index.html") });
  });
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveTab(btn.dataset.tab || "status");
  });
});

if (domainFormEl) {
  domainFormEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const domain = String(domainInputEl?.value || "").trim();
    if (!domain) {
      setDomainFeedback("Enter a domain to add.", false);
      return;
    }
    void (async () => {
      const res = await sendMessage({ type: "ADD_CUSTOM_DOMAIN", domain });
      if (!res || !res.ok) {
        setDomainFeedback(res?.error || "Could not add domain.", false);
        return;
      }
      if (domainInputEl) domainInputEl.value = "";
      renderDomainList(res.domains || []);
      setDomainFeedback(res.added ? `Added ${res.domain}` : `${res.domain} is already in the list.`, true);
    })();
  });
}

if (domainListEl) {
  domainListEl.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest(".domain-remove");
    if (!(btn instanceof HTMLElement)) return;
    const domain = btn.dataset.domain;
    if (!domain) return;
    void (async () => {
      const res = await sendMessage({ type: "REMOVE_CUSTOM_DOMAIN", domain });
      if (!res || !res.ok) {
        setDomainFeedback(res?.error || "Could not remove domain.", false);
        return;
      }
      renderDomainList(res.domains || []);
      setDomainFeedback(res.removed ? `Removed ${domain}` : `${domain} was not in the list.`, true);
    })();
  });
}

setInterval(refreshState, 1000);
void refreshState();
void refreshCustomDomains();
