/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi — esbuild entry point (Critical Path)
//
// Only essential modules for the core experience are imported here.
// Non-critical modules (dashboards, panels, media, etc.) are loaded
// separately from public/lazy-bundle.js to reduce initial load time.
//
// Each module sets window.QCLI.* for cross-module dependency resolution.
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

// ── Import converted modules in original script order ──
import './i18n.js';      // i18n → sets Q.__, Q._locale, Q.setLanguage, etc.
import './state.js';     // State → sets Q.state, Q.dom, Q.$ , etc.
import './chat-api.js';  // ChatAPI → sets Q.ChatAPI
import './toast.js';     // Toast  → sets Q.showToast, Q.showUploadStatus
import './app-telemetry.js'; // Telemetry → first-paint measure + global UI error boundary

// ── Storage layer (IndexedDB / localStorage) ──
import './session-store.js'; // SessionStore  → terminal tab persistence
import './stores.js';        // HistoryStore, PinStore, SnippetStore
import './workspace-store.js'; // WorkspaceStore → profile save/restore

// ── Utilities (no deps on other QCLI modules) ──
import './upload.js';        // Upload → file upload & media preview
import './custom-css.js';    // CustomCSS → user CSS injection
import './shortcuts.js';     // Shortcuts → keyboard shortcut panel
import './pin-report.js';    // PinReport → pin management UI

// ── UI panels (loaded after utilities) ──
import './palette.js';       // Palette → command palette
import './chat-ui.js';       // ChatUI  → chat panel rendering

// ── Memory subsystem (M3): server-backed chat sessions + 🧠 drawer ──
import './memory/session-store.js';  // MemorySession → Q.MemorySession singleton
import './memory/session-list.js';  // Session list → left column in chat drawer
import './memory/memory-panel.js';  // Memory drawer → 🧠 profile/facts UI
import './components/memory-timeline.js'; // P2.1 记忆时间轴 → Q.MemoryTimeline

// ── Web Components (Phase 2 extraction) ──
import './components/theme-switcher.js';    // Theme switching
import './components/theme-customizer.js';  // Theme customization
import './components/keyboard-shortcuts.js'; // Global keyboard shortcuts
import './components/add-cli-modal.js';     // Add CLI modal form
import './components/file-upload.js';       // Drag & drop file upload
import './components/history-panel.js';     // Global command history
import './components/snippet-panel.js';     // Snippet library
import './components/workspace-panel.js';   // Workspace profiles
import './components/global-search-panel.js'; // Cross-tab search
import './components/sidebar-manager.js';    // Sidebar toggle + resize
import './components/welcome-renderer.js';  // Welcome carousel slides
import './components/context-menu.js';      // Terminal right-click menu
import './components/search-bar.js';        // Terminal search bar
import './components/session-restore.js';    // Session restore overlay
import './components/ws-manager.js';         // WebSocket connection manager
import './components/ui-registry.js';        // UIRegistry → plugin UI component registration
import './components/plugin-manager-panel.js'; // PluginManager → plugin management in right panel
import './components/rate-limit-panel.js';      // RateLimitPanel → rate limiter stats in right panel
import './components/diagram-renderer.js';     // DiagramRenderer → unified mermaid/graphviz/plantuml renderer
import './components/terminal-mermaid.js';    // TerminalMermaid → detect diagrams in terminal output
import './components/progress-bar.js';        // ProgressBar → global progress indicator (used by boot.js)
import './workflows.js';     // Workflows → multi-step agent orchestration
import './orchestrator.js';   // Orchestrator → WorkBuddy-style task board (DAG orchestration)

// ── Digital Employees — 数字员工管理面板 ──
import './digital-employees.js'; // DigitalEmployees → role-based employee management

// ── AI Agent 管理面板 ──
import './agents.js';        // Agents → AI agent sidebar panel (loadAgents called by boot.js)
import './onboarding.js';     // Onboarding → 新手指南气泡 + 教程页入口
import './workspace-dir.js';   // Workspace directory selector → 侧栏「📂 全局工作空间」按钮（工具下方）

// ── OPC Dashboard — One Person Company 效益监控 ──
import './opc-dashboard.js'; // OPCDashboard → OPC cost/ROI monitoring panel
// NOTE: browser-scripts-panel.js is lazy-loaded from lazy-bundle.js to reduce critical bundle size

// ── Dynamic Plugin UI Loader ──
// Loads frontend panel scripts from plugins that declare a "ui" field in their plugin.json.
(function loadPluginUIs() {
  /** @type {QCLI} */
  const Q = /** @type {QCLI} */ (window.QCLI || {});

  fetch('/api/plugins')
    .then(r => r.json())
    .then(data => {
      if (!data.plugins || data.plugins.length === 0) return;
      data.plugins.forEach(p => {
        fetch('/api/plugins/' + encodeURIComponent(p.name))
          .then(r2 => r2.json())
          .then(detail => {
            const manifest = detail.manifest;
            if (!manifest || !manifest.ui || !manifest.ui.scripts) return;
            manifest.ui.scripts.forEach(scriptPath => {
              const src = '/plugin-assets/' + encodeURIComponent(p.name) + '/' + scriptPath;
              const script = document.createElement('script');
              script.src = src;
              script.defer = true;
              script.onload = () => console.log('[PluginUI] Loaded:', p.name + '/' + scriptPath);
              script.onerror = () => console.warn('[PluginUI] Failed to load:', src);
              document.body.appendChild(script);
            });
          })
          .catch(err => console.warn('[PluginUI] Failed to fetch plugin detail:', p.name, err.message));
      });
    })
    .catch(err => console.warn('[PluginUI] Failed to load plugin list:', err.message));
})();

// ── Chart engine (no QCLI deps) ──
import './chart-core.js';    // ChartCore → canvas chart engine

// ── Tab manager (reads Q.wsSend/Q.resetInputBuffer lazily) ──
import './tabs.js';          // Tabs → multi-session terminal tabs

// ── Voice input (Web Speech API, all Q reads lazy) ──
import './voice-input.js';   // VoiceInput → speech-to-text for terminal

// ── Voice output (SpeechSynthesis TTS, no deps) ──
import './voice-output.js';  // VoiceOutput → text-to-speech for AI responses

// ── Preset selector — loaded before settings/dashboard ──
import './presets.js';       // Presets → CLI presets, welcome carousel

// ── Settings — export/import, env vars, config management ──
import './settings.js';      // Settings → settings UI, env vars

// ── App — main CLI bridge frontend (init & wire everything) ──
import './app.js';           // App → init(), all UI wiring, event handlers

// ── Boot message ──
console.log('[Hesi] Core bundle loaded — critical path ready');
console.log('[Hesi] Lazy modules will load from /lazy-bundle.js');
