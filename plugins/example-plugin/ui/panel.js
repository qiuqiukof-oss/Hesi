/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Example Plugin — Frontend Panel
//
// Demonstrates the three UIRegistry registration types:
//   1. Right Panel Tab — renders plugin info
//   2. Context Menu Item — copies plugin info
//   3. Command Palette Command — shows a toast
//
// This module is loaded from the plugin's onLoad lifecycle hook.
// It runs in the browser, so it has access to window.QCLI.* APIs.
// ============================================================

(function registerExampleUI() {
  const Q = window.QCLI || {};
  const UIR = Q.UIRegistry;
  if (!UIR) {
    console.warn('[ExamplePlugin] UIRegistry not available');
    return;
  }

  // ── 1. Register a right panel tab ──
  UIR.registerTab('example-plugin:hello', {
    icon: '🔌',
    label: 'Example Plugin',
    order: 50, // show after built-in tabs
    render: function renderPanel(container) {
      container.innerHTML = `
        <div style="padding: 20px; color: var(--text-primary);">
          <h3 style="margin:0 0 8px; font-size:16px;">🔌 Example Plugin</h3>
          <p style="margin:0 0 16px; font-size:13px; color: var(--text-secondary);">
            This panel is registered by the example plugin via UIRegistry.
          </p>
          <div style="background: var(--bg-tertiary); border-radius:8px; padding:12px; margin-bottom:12px;">
            <div style="font-size:12px; color: var(--text-secondary); margin-bottom:4px;">Plugin Status</div>
            <div style="font-size:14px; font-weight:600;">✅ Loaded</div>
          </div>
          <div style="background: var(--bg-tertiary); border-radius:8px; padding:12px; margin-bottom:12px;">
            <div style="font-size:12px; color: var(--text-secondary); margin-bottom:4px;">UIRegistry Stats</div>
            <div style="font-size:14px; font-weight:600;">
              Tabs: ${UIR.stats.tabs} · Menu Items: ${UIR.stats.menuItems} · Commands: ${UIR.stats.commands}
            </div>
          </div>
          <button id="example-plugin-toast-btn" style="
            background: var(--accent); color: white; border: none;
            padding: 8px 16px; border-radius: 6px; cursor: pointer;
            font-size: 13px;
          ">Show Toast</button>
        </div>
      `;

      // Wire button
      const btn = container.querySelector('#example-plugin-toast-btn');
      if (btn && Q.showToast) {
        btn.addEventListener('click', () => {
          Q.showToast('🔌 Hello from Example Plugin!', 'success');
        });
      }
    },
  });

  // ── 2. Register a context menu item ──
  UIR.registerMenuItem('example-plugin:greet', {
    label: '🔌 Example: Greet',
    requiresSelection: false,
    order: 200,
    action: function greetAction(selection, terminal) {
      if (terminal && typeof terminal.write === 'function') {
        terminal.write('\r\n\x1b[32m🔌 Hello from Example Plugin!\x1b[0m\r\n');
      }
    },
  });

  // ── 3. Register a command palette command ──
  UIR.registerCommand('example-plugin:hello-cmd', {
    icon: '🔌',
    name: 'Example: Hello',
    desc: 'Show a greeting from the example plugin',
    order: 200,
    category: 'plugin',
    execute: function helloCommand() {
      const toast = Q.showToast;
      if (toast) {
        toast('🔌 Hello from Example Plugin command!', 'success');
      }
    },
  });

  console.log('[ExamplePlugin] UI registered: tab + menu item + command');
})();
