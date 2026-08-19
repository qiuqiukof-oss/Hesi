/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Preset Selector — Frontend Module
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

let activePreset = 'developer';
let presets = [];
let welcomeData = null;

// ============================================================
// Load presets from API
// ============================================================
async function loadPresets() {
  try {
    const resp = await fetch('/api/presets');
    if (!resp.ok) return [];
    const data = await resp.json();
    presets = data.presets || [];
    activePreset = data.active || 'developer';
    welcomeData = data.welcome || null;
    renderPresetSelector();
    // If welcome carousel is initialized, refresh it with new preset data
    if (window.QCLI?.Welcome?.renderWelcome && data.welcome) {
      window.QCLI.Welcome.renderWelcome(data.welcome);
    }
    return presets;
  } catch (err) {
    console.warn('[Presets] Failed to load:', err.message);
    return [];
  }
}

// ============================================================
// Switch preset via API
// ============================================================
async function activatePreset(name) {
  if (name === activePreset) return;
  try {
    const resp = await fetch('/api/presets/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      console.warn('[Presets] Activate failed:', err.error || resp.statusText);
      return;
    }
    activePreset = name;
    renderPresetSelector();
    closeDropdown();

    // Reload CLIs from the server → the backend now uses the new preset
    if (window.QCLI?.Sidebar?.discoverCLIs) {
      window.QCLI.Sidebar.discoverCLIs();
    }

    // Refresh welcome content with data from activation response
    const actData = await resp.json();
    if (actData.welcome) {
      welcomeData = actData.welcome;
      if (window.QCLI?.Welcome?.renderWelcome) {
        window.QCLI.Welcome.renderWelcome(actData.welcome);
      }
    }

    // Show toast
    const preset = presets.find(p => p.name === name);
    const label = preset?.label || name;
    if (window.QCLI?.showToast) {
      window.QCLI.showToast(`Switched to: ${label}`, 'info');
    }
  } catch (err) {
    console.warn('[Presets] Activate error:', err.message);
  }
}

// ============================================================
// Render dropdown options
// ============================================================
function renderPresetSelector() {
  const list = document.getElementById('preset-list');
  if (!list) return;

  // Update toggle button icon
  const toggle = document.getElementById('preset-toggle');
  if (toggle) {
    const current = presets.find(p => p.name === activePreset);
    toggle.querySelector('.preset-toggle-icon').textContent = current?.icon || '💻';
    const label = toggle.querySelector('.preset-toggle-label');
    if (label) label.textContent = current?.label || activePreset;
    toggle.title = current?.label || activePreset;
  }

  list.innerHTML = '';
  for (const preset of presets) {
    const option = document.createElement('div');
    option.className = 'preset-option' + (preset.name === activePreset ? ' active' : '');
    option.dataset.preset = preset.name;

    // Icon
    const icon = document.createElement('span');
    icon.className = 'preset-option-icon';
    icon.textContent = preset.icon || '🔧';
    option.appendChild(icon);

    // Info
    const info = document.createElement('div');
    info.className = 'preset-option-info';

    const name = document.createElement('div');
    name.className = 'preset-option-name';
    name.textContent = preset.label || preset.name;
    info.appendChild(name);

    if (preset.description) {
      const desc = document.createElement('div');
      desc.className = 'preset-option-desc';
      desc.textContent = preset.description;
      info.appendChild(desc);
    }

    option.appendChild(info);

    // Checkmark
    const check = document.createElement('span');
    check.className = 'preset-check';
    check.textContent = '\u2713';
    option.appendChild(check);

    // Click handler
    option.addEventListener('click', (e) => {
      e.stopPropagation();
      activatePreset(preset.name);
    });

    list.appendChild(option);
  }
}

// ============================================================
// Dropdown toggle
// ============================================================
let dropdownOpen = false;

function toggleDropdown() {
  const dropdown = document.getElementById('preset-dropdown');
  if (!dropdown) return;
  dropdownOpen = !dropdownOpen;
  dropdown.classList.toggle('hidden', !dropdownOpen);
  if (dropdownOpen) {
    renderPresetSelector();
    // Position dropdown relative to toggle button (fixed positioning breaks out of sidebar overflow)
    const toggle = document.getElementById('preset-toggle');
    if (toggle) {
      const rect = toggle.getBoundingClientRect();
      dropdown.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 240)) + 'px';
      dropdown.style.top = (rect.bottom + 4) + 'px';
    }
  }
}

function closeDropdown() {
  const dropdown = document.getElementById('preset-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  dropdownOpen = false;
}

// ============================================================
// Wire up events (no API calls → app.js triggers loadPresets on WS connect)
// ============================================================
function init() {
  const toggle = document.getElementById('preset-toggle');
  if (!toggle) return;

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (dropdownOpen && !e.target.closest('.preset-selector')) {
      closeDropdown();
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dropdownOpen) {
      closeDropdown();
    }
  });
}

// ============================================================
// Exports
// ============================================================
export const Presets = {
  get presets() { return presets; },
  get activePreset() { return activePreset; },
  get welcomeData() { return welcomeData; },
  loadPresets,
  activatePreset,
  init,
};
// Legacy compat
Q.Presets = Presets;

// Auto-init on DOM ready — wires events only (no API call; ws.onopen triggers load)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

