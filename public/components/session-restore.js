/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// session-restore — Saved terminal tab restoration overlay
//
// Extracted from app.js: checkSavedSessions + formatSessionTime
// plus overlay event wiring.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

/** @returns {QCLI} */
function Q() { return /** @type {QCLI} */ (window.QCLI || {}); }

/** @param {Date} date */
function formatSessionTime(date) {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return diffMin + "m ago";
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return diffHr + "h ago";
  const diffDay = Math.floor(diffHr / 24);
  return diffDay + "d ago";
}

async function checkSavedSessions() {
  // Wait for CLIs to finish loading
  await new Promise(function(r) { setTimeout(r, 500); });
  if (!Q().SessionStore) return;
  try {
    const sessions = await Q().SessionStore.loadAllSessions();
    if (!sessions || sessions.length === 0) {
      // No saved sessions — auto-launch default CLI
      if (Q().launchDefaultCLI) Q().launchDefaultCLI();
      return;
    }

    const overlay = document.getElementById("session-restore-overlay");
    const list = document.getElementById("session-restore-list");
    const countEl = document.getElementById("session-restore-count");
    if (!overlay || !list) return;

    // Update count
    if (countEl) countEl.textContent = sessions.length + " tab" + (sessions.length > 1 ? "s" : "");

    // Populate list
    list.innerHTML = "";
    sessions.forEach(function(session) {
      const item = document.createElement("div");
      item.className = "session-restore-item selected";
      item.dataset.tabId = session.tabId;

      // Icon
      const icon = document.createElement("span");
      icon.className = "sr-item-icon";
      icon.textContent = session.icon || "\u25B6";
      item.appendChild(icon);

      // Info
      const info = document.createElement("div");
      info.className = "sr-item-info";

      const name = document.createElement("div");
      name.className = "sr-item-name";
      name.textContent = session.name || session.cliId || "Terminal";
      info.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "sr-item-meta";

      const timeStr = session.timestamp ? formatSessionTime(new Date(session.timestamp)) : "";
      const timeSpan = document.createElement("span");
      timeSpan.className = "sr-item-time";
      timeSpan.textContent = timeStr;
      meta.appendChild(timeSpan);

      const bufSize = session.buffer ? session.buffer.length : 0;
      const sizeSpan = document.createElement("span");
      sizeSpan.textContent = bufSize > 0 ? (bufSize / 1024).toFixed(0) + "KB" : "(empty)";
      sizeSpan.style.cssText = "font-size:9px;opacity:0.5";
      meta.appendChild(sizeSpan);

      info.appendChild(meta);
      item.appendChild(info);

      // Checkbox
      const checkbox = document.createElement("span");
      checkbox.className = "sr-item-checkbox";
      checkbox.textContent = "\u2713";
      item.appendChild(checkbox);

      // Click to toggle selection
      item.addEventListener("click", function() {
        item.classList.toggle("selected");
        const check = item.querySelector(".sr-item-checkbox");
        if (check) {
          check.textContent = item.classList.contains("selected") ? "\u2713" : "";
        }
      });

      list.appendChild(item);
    });

    // Wire up buttons
    const ignoreBtn = document.getElementById("session-restore-ignore");
    const restoreBtn = document.getElementById("session-restore-all");

    if (ignoreBtn) {
      ignoreBtn.onclick = function() {
        overlay.classList.add("hidden");
        // Auto-launch default CLI when user dismisses session restore
        if (Q().launchDefaultCLI) Q().launchDefaultCLI();
      };
    }

    if (restoreBtn) {
      restoreBtn.onclick = function() {
        const selectedItems = list.querySelectorAll(".session-restore-item.selected");
        const selectedSessions = [];
        selectedItems.forEach(function(el) {
          const s = sessions.find(function(sess) { return sess.tabId === el.dataset.tabId; });
          if (s) selectedSessions.push(s);
        });

        if (selectedSessions.length > 0 && Q().Tabs) {
          Q().Tabs.restoreSessions(selectedSessions);
          // Set pending init for each restored tab
          for (let i = 0; i < selectedSessions.length; i++) {
            const s = selectedSessions[i];
            if (s.init && Q()._pendingInit) Q()._pendingInit.set(s.cliId, s.init);
          }
        }
        overlay.classList.add("hidden");
        if (Q().SessionStore) {
          Q().SessionStore.clearAllSessions();
        }
      };
    }

    // Show overlay
    overlay.classList.remove("hidden");
  } catch (e) {
    console.warn("[SessionStore] Check error:", /** @type {Error} */ (e).message);
  }
}

// ============================================================
// Auto-init — patch onto QCLI for backward compat
// ============================================================
Promise.resolve().then(function() {
  const q = Q();
  q.checkSavedSessions = checkSavedSessions;
});
