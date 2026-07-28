// @ts-check
// ============================================================
// Settings Module — Export/import, env vars, config management
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

import { safeStorage, safeSession } from './lib/storage.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// The AI API key is a secret managed by ChatAPI in sessionStorage (per-tab,
// not persisted to disk). It is deliberately NOT part of SETTINGS_KEYS so it
// never ends up in the exported settings JSON. Import/reset handle it specially.
const AI_KEY = 'qcli-ai-key';

const SETTINGS_KEYS = {
  fontSize: 'qcli-font-size',
  sidebarCollapsed: 'qcli-sidebar-collapsed',
  sidebarWidth: 'qcli-sidebar-width',
  chatHeight: 'qcli-chat-height',
  chatOpen: 'qcli-chat-open',
  chatHistory: 'qcli-chat-history',
  theme: 'qcli-theme',
  lang: 'qcli-lang',
  css: 'qcli-custom-css',
  aiProvider: 'qcli-ai-provider',
  aiModel: 'qcli-ai-model',
  aiModelPlan: 'qcli-ai-model-plan',
  aiBaseUrl: 'qcli-ai-base-url',
  defaultCLI: 'qcli-default-cli',
};

/**
 * Export all settings as a JSON download.
 */
async function exportSettings() {
  // Collect all localStorage settings
  const localSettings = {};
  for (const [, key] of Object.entries(SETTINGS_KEYS)) {
      const val = safeStorage.get(key);
      if (val !== null) localSettings[key] = val;
  }

  // Fetch server-side config (registry + folders)
  let serverConfig = {};
  try {
    const resp = await fetch('/api/settings');
    if (resp.ok) serverConfig = await resp.json();
  } catch (e) { /* ignore */ }

  const exportData = {
    version: 2,
    exportedAt: new Date().toISOString(),
    localSettings,
    serverConfig,
  };

  // Trigger download
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qcli-settings-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showSettingsToast('Settings exported', 'success');
}

/**
 * Import settings from a JSON file.
 */
function importSettings(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.version || !data.localSettings) {
        showSettingsToast('Invalid settings file format', 'error');
        return;
      }

      // Apply localStorage settings
      let applied = 0;
      for (const [key, val] of Object.entries(data.localSettings)) {
          if (key === AI_KEY) {
            // Never re-persist a secret to disk — route legacy exports that
            // still carry the key into session-only storage.
            safeSession.set(AI_KEY, val);
          } else {
            safeStorage.set(key, val);
          }
          applied++;
      }

      // Import server config if present
      if (data.serverConfig && data.serverConfig.registry) {
        try {
          await fetch('/api/settings/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data.serverConfig),
          });
        } catch (e) { console.warn('[Settings] import server config:', e?.message); }
      }

      showSettingsToast(`Imported ${applied} settings → reload to apply`, 'success');

      // Reload after a brief delay
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      showSettingsToast('Failed to parse settings file: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/**
 * Reset all settings to defaults.
 */
function resetSettings() {
  if (!confirm('Reset ALL settings to defaults? This will:\n• Clear custom CSS\n• Reset theme to system preference\n• Reset font size\n• Clear chat history\n• Remove AI API key\n\nThis cannot be undone.')) return;

  const keys = Object.values(SETTINGS_KEYS);
  for (const key of keys) {
    safeStorage.remove(key);
  }
  // Clear the API key from both stores (session-only now, but purge any
  // lingering legacy localStorage copy too).
  safeSession.remove(AI_KEY);
  safeStorage.remove(AI_KEY);

  showSettingsToast('All settings reset → reloading', 'info');
  setTimeout(() => location.reload(), 1000);
}

/**
 * Open the settings panel overlay.
 */
function openSettings() {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    loadSettingsPanelData();
  }
}

function closeSettings() {
  const overlay = document.getElementById('settings-overlay');
  if (overlay) overlay.classList.add('hidden');
  // Remove escape handler
  if (_settingsEscHandler) {
    document.removeEventListener('keydown', _settingsEscHandler);
    _settingsEscHandler = null;
  }
}

/**
 * Load dynamic data into the settings panel.
 */
async function loadSettingsPanelData() {
  // Show current localStorage values
  const el = (id) => document.getElementById(id);
  const dispVal = (id, val) => { const e = el(id); if (e) e.textContent = val; };

  // Storage usage
  let totalBytes = 0;
  let itemCount = 0;
  try {
    for (const [, key] of Object.entries(SETTINGS_KEYS)) {
      const val = safeStorage.get(key);
      if (val !== null) {
        totalBytes += val.length * 2; // UTF-16
        itemCount++;
      }
    }
  } catch (e) { console.warn('[Settings] storage calc:', e?.message); }
  dispVal('settings-storage-items', itemCount);
  dispVal('settings-storage-size', totalBytes > 1024 ? (totalBytes / 1024).toFixed(1) + ' KB' : totalBytes + ' B');

  // Theme display
  dispVal('settings-current-theme', Q.state?.theme === 'light' ? '☀ Light' : '🌙 Dark');

  // Language
  dispVal('settings-current-lang', (Q._locale?.current || 'zh') === 'zh' ? '中文' : 'English');

  // Fetch env vars from server
  try {
    const resp = await fetch('/api/settings/env');
    if (resp.ok) {
      const data = await resp.json();
      const list = el('settings-env-list');
      if (list) {
        list.innerHTML = '';
        const entries = Object.entries(data.env || {}).slice(0, 30);
        if (entries.length === 0) {
          list.innerHTML = '<div class="settings-env-empty">No environment variables available</div>';
        } else {
          for (const [key, val] of entries) {
            const row = document.createElement('div');
            row.className = 'settings-env-row';
            const kSpan = document.createElement('span');
            kSpan.className = 'settings-env-key';
            kSpan.textContent = key;
            const vSpan = document.createElement('span');
            vSpan.className = 'settings-env-val';
            vSpan.textContent = val.length > 60 ? val.slice(0, 60) + '...' : val;
            row.appendChild(kSpan);
            row.appendChild(vSpan);
            list.appendChild(row);
          }
        }
        dispVal('settings-env-count', data.count || 0);
      }
    }
  } catch (e) { console.warn('[Settings] fetch env vars:', e?.message); }

  // Font size
  const fontSize = parseInt(safeStorage.get('qcli-font-size', '14'), 10);
  dispVal('settings-font-size', fontSize + 'px');

  // Sidebar width
  const sbWidth = parseInt(safeStorage.get('qcli-sidebar-width', '240'), 10);
  dispVal('settings-sidebar-width', sbWidth + 'px');

  // Default CLI dropdown
  const cliSelect = el('settings-default-cli');
  if (cliSelect) {
    const current = safeStorage.get('qcli-default-cli', '');
    // Populate from loaded CLIs
    const clis = Q.state?.clis || [];
    cliSelect.innerHTML = '<option value="">→ None →</option>';
    for (const cli of clis) {
      const opt = document.createElement('option');
      opt.value = cli.id;
      opt.textContent = cli.name || cli.id;
      if (cli.id === current) opt.selected = true;
      cliSelect.appendChild(opt);
    }
  }
}

/**
 * Handle default CLI selection change.
 */
function onDefaultCLIChange() {
  const sel = document.getElementById('settings-default-cli');
  if (!sel) return;
  const val = sel.value;
  safeStorage.set('qcli-default-cli', val);
  // Notify app.js
  if (window.QCLI.onDefaultCLIChanged) {
    window.QCLI.onDefaultCLIChanged(val);
  }
}

/**
 * Export ONLY CLI-related configuration as a shareable JSON download.
 * Includes: CLI registry, folders, favorites, hidden, default CLI.
 */
async function exportCLIConfig() {
  // Fetch server-side CLI registry + folders
  let serverConfig = { registry: [], folders: [] };
  try {
    const resp = await fetch('/api/settings');
    if (resp.ok) serverConfig = await resp.json();
  } catch (e) { console.warn('[Settings] fetch CLI config:', e?.message); }

  // Local CLI-related settings
  let favorites = [];
  let hidden = [];
  let defaultCLI = '';
  try {
    favorites = safeStorage.getJSON('qcli-favorites', []);
    hidden = safeStorage.getJSON('qcli-hidden', []);
    defaultCLI = safeStorage.get('qcli-default-cli', '');
  } catch (e) { console.warn('[Settings] read local CLI settings:', e?.message); }

  const cliExport = {
    version: 2,
    exportedAt: new Date().toISOString(),
    type: 'qcli-cli-config',
    description: 'Hesi configuration → CLIs, folders, favorites, and settings',
    clis: serverConfig.registry || [],
    folders: serverConfig.folders || [],
    favorites,
    hidden,
    defaultCLI,
  };

  // Trigger download
  const blob = new Blob([JSON.stringify(cliExport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qcli-cli-config-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);

  showSettingsToast('CLI config exported', 'success');
}

/**
 * Import CLI configuration from a JSON file.
 */
function importCLIConfig(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.version || data.type !== 'qcli-cli-config') {
        showSettingsToast('Invalid CLI config file format', 'error');
        return;
      }

      let applied = 0;

      // Import favorites
      if (Array.isArray(data.favorites)) {
        try {
          safeStorage.setJSON('qcli-favorites', data.favorites);
          applied++;
        } catch (e) { console.warn('[Settings] import favorites:', e?.message); }
      }

      // Import hidden
      if (Array.isArray(data.hidden)) {
        try {
          safeStorage.setJSON('qcli-hidden', data.hidden);
          applied++;
        } catch (e) { console.warn('[Settings] import hidden:', e?.message); }
      }

      // Import default CLI
      if (data.defaultCLI) {
        try {
          safeStorage.set('qcli-default-cli', data.defaultCLI);
          applied++;
        } catch (e) { console.warn('[Settings] import default CLI:', e?.message); }
      }

      // Import server-side registry + folders
      if (data.clis || data.folders) {
        try {
          await fetch('/api/settings/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              registry: data.clis || [],
              folders: data.folders || [],
            }),
          });
          applied++;
        } catch (e) { console.warn('[Settings] import server CLI config:', e?.message); }
      }

      showSettingsToast(`Imported CLI config (${applied} items) → reload to apply`, 'success');
      setTimeout(() => location.reload(), 1500);
    } catch (err) {
      showSettingsToast('Failed to parse CLI config: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

/**
 * Show a toast message within the settings panel.
 */
function showSettingsToast(msg, type) {
  const status = document.getElementById('settings-toast');
  if (!status) return;
  status.textContent = msg;
  status.className = 'settings-toast ' + (type || 'info');
  status.style.display = '';
  setTimeout(() => { status.style.display = 'none'; }, 3000);
}

// ── Create settings overlay if it doesn't exist in HTML ──
let _settingsEscHandler = null;

function ensureSettingsOverlay() {
  if (document.getElementById('settings-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'settings-overlay';
  overlay.className = 'modal-overlay hidden';
  overlay.style.zIndex = '750';

  overlay.innerHTML = `
    <div class="modal settings-modal">
      <div class="settings-header">
        <h2>⚙️ Settings</h2>
        <button id="settings-close-btn" class="settings-close-btn">✕</button>
      </div>

      <div class="settings-body">
        <!-- Section: General -->
        <div class="settings-section">
          <div class="settings-section-title">General</div>
          <div class="settings-row">
            <span>Theme</span>
            <span id="settings-current-theme" class="settings-value">—</span>
          </div>
          <div class="settings-row">
            <span>Language</span>
            <span id="settings-current-lang" class="settings-value">—</span>
          </div>
          <div class="settings-row">
            <span>Terminal Font Size</span>
            <span id="settings-font-size" class="settings-value">—</span>
          </div>
          <div class="settings-row">
            <span>Sidebar Width</span>
            <span id="settings-sidebar-width" class="settings-value">—</span>
          </div>
          <div class="settings-row">
            <span>Default CLI (auto-launch on connect)</span>
            <select id="settings-default-cli" class="settings-select"></select>
          </div>
        </div>

        <!-- Section: Storage -->
        <div class="settings-section">
          <div class="settings-section-title">Local Storage</div>
          <div class="settings-row">
            <span>Stored Items</span>
            <span id="settings-storage-items" class="settings-value">—</span>
          </div>
          <div class="settings-row">
            <span>Estimated Size</span>
            <span id="settings-storage-size" class="settings-value">—</span>
          </div>
        </div>

        <!-- Section: Environment -->
        <div class="settings-section">
          <div class="settings-section-title">
            Environment Variables
            <span id="settings-env-count" class="settings-badge">0</span>
          </div>
          <div id="settings-env-list" class="settings-env-list">
            <div class="settings-env-empty">Loading...</div>
          </div>
        </div>

        <!-- Section: Export/Import -->
        <div class="settings-section">
          <div class="settings-section-title">Backup & Restore</div>
          <div class="settings-actions">
            <button id="settings-export-btn" class="secondary-btn" style="flex:1;">📤 Export All</button>
            <button id="settings-import-btn" class="secondary-btn" style="flex:1;">📥 Import All</button>
            <input type="file" id="settings-import-input" accept=".json" style="display:none;" />
          </div>
          <div class="settings-actions" style="margin-top:6px;">
            <button id="settings-export-cli-btn" class="secondary-btn" style="flex:1;">🔌 Export CLI Config</button>
            <button id="settings-import-cli-btn" class="secondary-btn" style="flex:1;">🔌 Import CLI Config</button>
            <input type="file" id="settings-import-cli-input" accept=".json" style="display:none;" />
          </div>
          <div class="settings-row" style="margin-top:8px;">
            <button id="settings-reset-btn" class="settings-reset-btn">🗑 Reset All Settings</button>
          </div>
        </div>
      </div>

      <div id="settings-toast" class="settings-toast" style="display:none;"></div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Wire up events
  document.getElementById('settings-close-btn').addEventListener('click', closeSettings);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeSettings(); });

  document.getElementById('settings-export-btn').addEventListener('click', exportSettings);

  const cliSelect = document.getElementById('settings-default-cli');
  if (cliSelect) cliSelect.addEventListener('change', onDefaultCLIChange);

  document.getElementById('settings-import-btn').addEventListener('click', () => {
    document.getElementById('settings-import-input').click();
  });

  document.getElementById('settings-import-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      importSettings(e.target.files[0]);
      e.target.value = '';
    }
  });

  document.getElementById('settings-export-cli-btn').addEventListener('click', exportCLIConfig);
  document.getElementById('settings-import-cli-btn').addEventListener('click', () => {
    document.getElementById('settings-import-cli-input').click();
  });
  document.getElementById('settings-import-cli-input').addEventListener('change', (e) => {
    if (e.target.files[0]) {
      importCLIConfig(e.target.files[0]);
      e.target.value = '';
    }
  });

  document.getElementById('settings-reset-btn').addEventListener('click', resetSettings);

  // Close on Escape - store handler reference for cleanup
  _settingsEscHandler = function escHandler(e) {
    if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
      closeSettings();
    }
  };
  document.addEventListener('keydown', _settingsEscHandler);
}

// ── Export API ──
export const Settings = {
  open: () => {
    ensureSettingsOverlay();
    openSettings();
  },
  close: closeSettings,
  exportSettings,
  importSettings,
  exportCLIConfig,
  importCLIConfig,
  resetSettings,
};
// Legacy compat
Q.Settings = Settings;
