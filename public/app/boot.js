// @ts-check
// ============================================================
// Boot — 初始化入口、UI 面板事件绑定
//
// 原 app.js §18(部分) + §21 + §20(部分) + §22
// ============================================================

/** @typedef {import('../types').QCLI} QCLI */

import { state, dom, setupCategoryFilters } from '../state.js';
import { __ as _i18n__, setLanguage, applyLanguage, _locale } from '../i18n.js';
import { pendingInit, setReconnecting } from './shared.js';
import { initTerminal, restoreFontSize } from './terminal.js';
import { initSidebar, loadCLIs } from './sidebar.js';
import { getPreferredTheme, applyTheme } from '../components/theme-switcher.js';
import { safeStorage } from '../lib/storage.js';

const __ = _i18n__ || function(k) { return k; };
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});
const wsSend = (...args) => Q.wsSend(...args);

// ──────────────────────────────────────────────
// Ctrl+I — toggle chat panel
// ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'i' && !e.repeat) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    Q.ChatUI?.toggleChat?.();
  }
});

// ──────────────────────────────────────────────
// Inject spin keyframe animation
// ──────────────────────────────────────────────
(function injectSpinStyle() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
})();

// ──────────────────────────────────────────────
// Init — main entry point
// ──────────────────────────────────────────────
function init() {
  initTerminal();
  setupCategoryFilters();
  initSidebar();

  // ── Connection Lost — click to reconnect ──
  if (dom.connectionLost) {
    dom.connectionLost.addEventListener('click', () => {
      const reconnectingFromLost = true; // local flag for this click scope
      // Show spinner
      const spinner = dom.connectionLost.querySelector('.reconnect-spinner');
      if (spinner) spinner.classList.remove('hidden');
      dom.connectionLost.classList.remove('visible');

      setTimeout(() => {
        state.reconnectAttempts = 0;
        Q.showProgressBar?.();
        dom.welcomeOverlay.classList.remove('welcome-loaded');
        Q.wsConnect();
        loadCLIs();
        if (spinner) spinner.classList.add('hidden');
        setReconnecting(false);
      }, 500);
    });
  }

  // ── Wire up Custom CSS button ──
  const cssBtn = document.getElementById('custom-css-btn');
  if (cssBtn && Q.CustomCSS) {
    cssBtn.addEventListener('click', () => Q.CustomCSS.open());
  }

  // ── Wire up Settings button ──
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn && Q.Settings) {
    settingsBtn.addEventListener('click', () => Q.Settings.open());
  }

  // ── Wire up AI Settings modal ──
  const aiSettingsBtn = document.getElementById('ai-settings-btn');
  const aiSettingsOverlay = document.getElementById('ai-settings-overlay');
  const aiSettingsForm = document.getElementById('ai-settings-form');
  const aiSettingsCancel = document.getElementById('ai-settings-cancel');
  const aiSettingsStatus = document.getElementById('ai-settings-status');

  if (aiSettingsBtn && aiSettingsOverlay) {
    aiSettingsBtn.addEventListener('click', () => {
      const savedProvider = Q.ChatAPI?.getProvider?.() || 'openai';
      const savedKey = Q.ChatAPI?.getApiKey?.() || '';
      const savedModel = Q.ChatAPI?.getModel?.() || '';
      const savedPlanModel = Q.ChatAPI?.getPlanModel?.() || '';
      const savedBaseUrl = Q.ChatAPI?.getBaseUrl?.() || '';
      const provEl = document.getElementById('ai-provider');
      const keyEl = document.getElementById('ai-api-key');
      const modelEl = document.getElementById('ai-model');
      const planModelEl = document.getElementById('ai-model-plan');
      const baseUrlEl = document.getElementById('ai-base-url');
      if (provEl) provEl.value = savedProvider;
      if (keyEl) keyEl.value = savedKey;
      if (modelEl) modelEl.value = savedModel;
      if (planModelEl) planModelEl.value = savedPlanModel;
      if (baseUrlEl) baseUrlEl.value = savedBaseUrl;
      if (aiSettingsStatus) { aiSettingsStatus.classList.add('hidden'); aiSettingsStatus.textContent = ''; }
      aiSettingsOverlay.classList.remove('hidden');
    });

    aiSettingsOverlay.addEventListener('click', (e) => {
      if (e.target === aiSettingsOverlay) aiSettingsOverlay.classList.add('hidden');
    });
  }

  if (aiSettingsForm && aiSettingsCancel) {
    aiSettingsCancel.addEventListener('click', () => {
      aiSettingsOverlay.classList.add('hidden');
    });

    aiSettingsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const provEl = document.getElementById('ai-provider');
      const keyEl = document.getElementById('ai-api-key');
      const modelEl = document.getElementById('ai-model');
      const planModelEl = document.getElementById('ai-model-plan');
      const baseUrlEl = document.getElementById('ai-base-url');
      const provider = provEl ? provEl.value : 'openai';
      const apiKey = keyEl ? keyEl.value.trim() : '';
      const model = modelEl ? modelEl.value.trim() : '';
      const planModel = planModelEl ? planModelEl.value.trim() : '';
      const baseUrl = baseUrlEl ? baseUrlEl.value.trim() : '';

      Q.ChatAPI?.setProvider?.(provider);
      Q.ChatAPI?.setApiKey?.(apiKey);
      Q.ChatAPI?.setModel?.(model);
      Q.ChatAPI?.setPlanModel?.(planModel);
      Q.ChatAPI?.setBaseUrl?.(baseUrl);

      if (aiSettingsStatus) {
        aiSettingsStatus.textContent = apiKey
          ? '\u2714 API Key \u5df2\u4fdd\u5b58'
          : '\u26a0 \u672a\u8bbe\u7f6e API Key\uff0c\u5c06\u4f7f\u7528\u73af\u5883\u53d8\u91cf\u6216\u6a21\u62df\u56de\u7b54';
        aiSettingsStatus.className = 'ai-status';
        aiSettingsStatus.classList.remove('hidden');
      }
      setTimeout(() => aiSettingsOverlay.classList.add('hidden'), 1500);
    });
  }

  // ── Load workflows & agents ──
  Q.Workflows?.loadWorkflows?.();
  Q.Agents?.loadAgents?.();

  // ── Request notification permission ──
  Q.requestNotificationPermission?.();

  // ── Render pinned output ──
  Q.renderPinnedList?.();

  // ── Wire terminal context menu ──
  const ctxMenu = document.getElementById('terminal-context-menu');
  if (ctxMenu) {
    document.addEventListener('click', (e) => {
      if (!ctxMenu.contains(e.target) && Q.hideContextMenu) Q.hideContextMenu();
    });
    document.getElementById('ctx-copy')?.addEventListener('click', () => { Q.copySelection?.(); });
    document.getElementById('ctx-pin')?.addEventListener('click', () => { Q.pinSelectedOutput?.(); });
    document.getElementById('ctx-search-sel')?.addEventListener('click', () => { Q.searchSelection?.(); });
    document.getElementById('ctx-paste')?.addEventListener('click', () => { Q.pasteClipboard?.(); });
    document.getElementById('ctx-clear')?.addEventListener('click', () => {
      Q.hideContextMenu?.();
      if (Q.Tabs?.term) Q.Tabs.term.reset();
    });
    document.getElementById('ctx-search')?.addEventListener('click', () => {
      Q.hideContextMenu?.();
      Q.showSearchBar?.();
    });
  }

  // ── Wire pinned buttons ──
  document.getElementById('pinned-clear-btn')?.addEventListener('click', async () => {
    const store = Q.PinStore;
    if (store) {
      await store.clear();
      await Q.renderPinnedList?.();
      Q.showToast?.('\u5df2\u6e05\u9664\u6240\u6709\u56fa\u5b9a\u8f93\u51fa', 'info');
    }
  });
  document.getElementById('pinned-report-btn')?.addEventListener('click', () => {
    Q.PinReport?.openReportPanel?.();
  });
  document.getElementById('pin-report-export-btn')?.addEventListener('click', () => {
    Q.PinReport?.exportPinsToMarkdown?.();
  });

  // ── Wire history panel ──
  const historySearch = document.getElementById('history-search-input');
  if (historySearch) {
    historySearch.addEventListener('input', () => {
      Q.renderHistoryList?.(historySearch.value);
    });
  }
  document.getElementById('history-close-btn')?.addEventListener('click', () => { Q.closeHistoryPanel?.(); });
  document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
    const store = Q.HistoryStore;
    if (store) {
      if (confirm('Clear all command history?')) {
        await store.clear();
        await Q.renderHistoryList?.('');
      }
    }
  });
  document.getElementById('history-panel')?.addEventListener('click', (e) => {
    const hp = document.getElementById('history-panel');
    const bg = document.getElementById('history-panel-bg');
    if (e.target === hp || e.target === bg) Q.closeHistoryPanel?.();
  });

  // ── Wire snippet panel ──
  document.getElementById('snippet-close-btn')?.addEventListener('click', () => { Q.closeSnippetPanel?.(); });
  document.getElementById('snippet-add-btn')?.addEventListener('click', () => {
    document.getElementById('add-snippet-modal')?.classList.remove('hidden');
    document.getElementById('snippet-name')?.focus();
  });
  document.getElementById('snippet-overlay')?.addEventListener('click', (e) => {
    const so = document.getElementById('snippet-overlay');
    const bg = document.getElementById('snippet-overlay-bg');
    if (e.target === so || e.target === bg) Q.closeSnippetPanel?.();
  });

  const snippetForm = document.getElementById('add-snippet-form');
  if (snippetForm) {
    snippetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('snippet-name')?.value?.trim();
      const command = document.getElementById('snippet-command')?.value?.trim();
      const desc = document.getElementById('snippet-desc')?.value?.trim();
      if (!name || !command) {
        const errEl = document.getElementById('add-snippet-error');
        if (errEl) { errEl.textContent = 'Name and command cannot be empty'; errEl.classList.remove('hidden'); }
        return;
      }
      const store = Q.SnippetStore;
      if (store) {
        await store.add(name, command, desc);
        document.getElementById('add-snippet-modal')?.classList.add('hidden');
        document.getElementById('add-snippet-error')?.classList.add('hidden');
        snippetForm.reset();
        Q.showToast?.(`Snippet "${name}" added`, 'success');
        await Q.renderSnippetList?.();
      }
    });
    document.getElementById('add-snippet-cancel')?.addEventListener('click', () => {
      document.getElementById('add-snippet-modal')?.classList.add('hidden');
      document.getElementById('add-snippet-error')?.classList.add('hidden');
    });
  }

  // ── Wire workspace panel ──
  document.getElementById('workspace-close-btn')?.addEventListener('click', () => { Q.closeWorkspacePanel?.(); });
  document.getElementById('workspace-save-btn')?.addEventListener('click', async () => {
    const tabs = Q.Tabs;
    if (!tabs || tabs.tabs.length === 0) {
      Q.showToast?.('No tabs available to save. Start a CLI first.', 'info');
      return;
    }
    const name = prompt('Workspace name:');
    if (!name || !name.trim()) return;
    const store = Q.WorkspaceStore;
    if (store) {
      await store.save(name.trim(), tabs.tabs);
      Q.showToast?.(`Workspace "${name.trim()}" saved`, 'success');
      await Q.renderWorkspaceList?.();
    }
  });
  document.getElementById('workspace-overlay')?.addEventListener('click', (e) => {
    const wo = document.getElementById('workspace-overlay');
    const bg = document.getElementById('workspace-overlay-bg');
    if (e.target === wo || e.target === bg) Q.closeWorkspacePanel?.();
  });

  // ── Apply theme (direct import to avoid microtask timing issue) ──
  applyTheme(getPreferredTheme());
  if (dom.themeToggle) {
    dom.themeToggle.addEventListener('click', () => { Q.toggleTheme?.(); });
  }

  // ── Restore & wire language ──
  const savedLang = safeStorage.get('qcli-lang');
  if (savedLang === 'en' || savedLang === 'zh') {
    _locale.current = savedLang;
  }

  const langBtn = document.getElementById('lang-toggle-btn');
  if (langBtn) {
    langBtn.textContent = _locale.current === 'zh' ? '\u4e2d' : 'EN';
    langBtn.title = __('lang.switch');
    langBtn.addEventListener('click', () => {
      const newLang = _locale.current === 'zh' ? 'en' : 'zh';
      setLanguage(newLang);
    });
  }

  // ── Welcome carousel ──
  Q.initWelcomeCarousel?.();

  // ── Apply saved language ──
  applyLanguage();

  // ── Boot sequence: progress → connect → load CLIs → check sessions ──
  Q.showProgressBar?.();
  restoreFontSize();
  Q.wsConnect();
  loadCLIs();
  Q.checkSavedSessions?.();
}

// ──────────────────────────────────────────────
// Q namespace exports
// ──────────────────────────────────────────────
Q.onDefaultCLIChanged = function(val) {
  console.log('[DefaultCLI] Changed to:', val || '(none)');
};

Q.launchDefaultCLI = function launchDefaultCLI() {
  if (state.launched || state.launching) return;
  const defaultCliId = safeStorage.get('qcli-default-cli');
  if (!defaultCliId) return;
  const cliObj = state.clis?.find(c => c.id === defaultCliId);
  if (!cliObj) return;
  console.log('[DefaultCLI] Auto-launching', defaultCliId);
  Q.Sidebar?.launchCLI?.(defaultCliId);
};

export { init };
