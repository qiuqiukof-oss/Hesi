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

// ── Media preview overlay (Q.Upload extensions, all Q reads lazy) ──
import './media-preview.js'; // MediaPreview → overlay for image/video preview

// ── Terminal search bar (reads Q.searchAddon lazily) ──
import './terminal-search.js'; // TerminalSearch → search in xterm

// ── Right panel controller (reads Q.Tabs/Q.state/Q.wsSend lazily) ──
import './right-panel.js';   // RightPanel → dashboard/charts/media sidebar

// ── Stock analysis panel (uses ChartCore, reads Q.RightPanel lazily) ──
// NOTE: This module registers itself as a plugin tab via Q.UIRegistry.registerTab('stocks', ...)
import './stock-analysis.js'; // Stocks → stock/fund charts in right panel

// ── Multi-Media panel — image gallery, video player, file preview ──
// NOTE: This module registers itself as a plugin tab via Q.UIRegistry.registerTab('media', ...)
import './multi-media.js';   // Media → media gallery in right panel

// ── Phase 2: 围炉圆桌（多 Agent 可视化协作，作为 AI讨论 的一种视图，进 lazy 防主包膨胀）──
import './components/roundtable-skins.js'; // RoundtableSkins → 皮肤注册表(SKINS/applySkin)，被 roundtable-view.js 依赖
import './components/roundtable-view.js';   // RoundTableView → 圆桌视图渲染器（引擎复用 Q.ChatAPI，容器 #mahjong-embed）

// ── Dashboard panel — system status, CLI stats, runtime overview ──
import './dashboard.js';     // Dashboard → system dashboard tab

// ── System Resources tab — detailed historical data tables & full-size charts ──
import './system-resources.js'; // SysResources → detailed resource monitoring tab

// ── Quant Trading panel — simulated AI quant strategy backtester ──
// NOTE: This module registers itself as a plugin tab via Q.UIRegistry.registerTab('quant', ...)
import './quant-trading.js'; // QuantTrading → quant trading tab

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

console.log('[Hesi] Lazy bundle loaded (P3 panels included)');
