/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Hesi Lazy-Loaded Bundle — Non-critical modules
//
// These modules are loaded after the main bundle to reduce
// initial load time. They register themselves with QCLI
// namespace and UIRegistry as they would from the main bundle.
//
// This file is built separately via:
//   npx esbuild public/lazy.js --bundle --outfile=public/lazy-bundle.js --format=iife --minify
// ============================================================

// ── Terminal search bar (reads Q.searchAddon lazily) ──
import './terminal-search.js'; // TerminalSearch → search in xterm

// ── Right panel controller (reads Q.Tabs/Q.state/Q.wsSend lazily) ──
import './right-panel.js';   // RightPanel → dashboard/charts sidebar

// ── 围炉圆桌：动态按需加载（P2-9 chunk 分割，首次打开时加载 ~80KB 独立 chunk）──
import './components/roundtable-skins.js'; // RoundtableSkins → 始终同步（~3KB，皮肤注册表）
// roundtable-view.js → 改为动态 import，esbuild ESM 自动生成独立 chunk
// 懒加载入口被 side-panels.js toggleMahjongPanel 调用
window.__hesiLoadRoundtable = () => import('./components/roundtable-view.js');

// ── Dashboard panel — system status, CLI stats, runtime overview ──
import './dashboard.js';     // Dashboard → system dashboard tab

// ── System Resources tab — detailed historical data tables & full-size charts ──
import './system-resources.js'; // SysResources → detailed resource monitoring tab

// ── Finance panel — budget management (right panel + standalone page) ──
// NOTE: This module registers itself as a plugin tab via Q.UIRegistry.registerTab('finance', ...)
import './finance-store.js';  // FinanceStore → IndexedDB for budget data
import './finance.js';         // Finance → budget management module

// ── Browser Scripts — user script management panel (moved from main.js for bundle size) ──
import './components/browser-scripts-panel.js'; // BrowserScripts → user script management

// ── Network Monitor — browser network request capture panel ──
import './components/network-monitor-panel.js'; // NetworkMonitor → network capture tab

// ── P3: Browser Farm — cross-session browser contexts ──
import './components/browser-farm-panel.js'; // BrowserFarm → isolated session management

// ── P3: DOM Diff — capture and compare DOM snapshots ──
import './components/dom-diff-panel.js'; // DOMDiff → snapshot comparison

// ── P3: Form Auto-fill — detect and fill form fields ──
import './components/form-autofill-panel.js'; // FormAutofill → field detection & filling

// ── P3: A11y Analysis — run accessibility audits ──
import './components/a11y-panel.js'; // A11y → accessibility audit

// ── CLI Management enhancements — health check, batch import/export, preset install ──
import './components/cli-health-panel.js';      // CLIHealth → verify CLI paths exist
import './components/cli-importer-panel.js';    // CLIImporter → batch import/export
import './components/cli-preset-install-panel.js'; // CLIPresetInstall → install preset CLIs

// ── P3: Inject P3 panel styles ──
(function injectP3CSS() {
  const Q = window.QCLI || {};
  if (Q.injectCSS) {
    Q.injectCSS('/css/p3-panels.css');
  } else {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/css/p3-panels.css';
    document.head.appendChild(link);
  }
})();

// ── 周期A-C.2: 主包瘦身 — 以下重模块从 main.js 迁入懒加载包（非首屏关键路径）──
import './components/global-search-panel.js'; // GlobalSearch → cross-tab search
import './components/plugin-manager-panel.js'; // PluginManager → plugin management in right panel
import './components/rate-limit-panel.js';      // RateLimitPanel → rate limiter stats in right panel
import './components/diagram-renderer.js';     // DiagramRenderer → unified mermaid/graphviz/plantuml renderer
import './opc-dashboard.js'; // OPCDashboard → OPC cost/ROI monitoring panel
import './chart-core.js';    // ChartCore → canvas chart engine
import './voice-input.js';   // VoiceInput → speech-to-text for terminal
import './voice-output.js';  // VoiceOutput → text-to-speech for AI responses
import './workflows.js';     // Workflows → multi-step agent orchestration
import './orchestrator.js';   // Orchestrator → WorkBuddy-style task board (DAG orchestration)
import './digital-employees.js'; // DigitalEmployees → role-based employee management
import './agents.js';        // Agents → AI agent sidebar panel
import './settings.js';      // Settings → settings UI, env vars

console.log('[Hesi] Lazy bundle loaded (P3 panels included)');
