/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Hesi / qterm-main Global Type Definitions
//
// This file provides JSDoc + TypeScript type annotations for the
// window.QCLI global namespace and all public/components/ modules.
//
// Intended use:
//   - Add `// @ts-check` at the top of any .js file to enable
//     TypeScript-based type checking in VSCode/editors.
//   - Import types via JSDoc `@type {import('./types').QCLI}`
//   - Or reference global types directly via `/** @type {QCLI} */`
// ============================================================

// ──────────────────────────────────────────────
// xterm.js external type stubs
// ──────────────────────────────────────────────

/**
 * Xterm.js Terminal instance (partial type, only what we use)
 */
interface XtermTerminal {
  readonly rows: number;
  readonly cols: number;
  readonly buffer: XtermBuffer;
  write(data: string): void;
  focus(): void;
  reset(): void;
  clear(): void;
  refresh(start: number, end: number): void;
  getSelection(): string;
  clearSelection(): void;
  options: XtermOptions;
  readonly element: HTMLElement;
  readonly _textarea: HTMLTextAreaElement;
  loadAddon(addon: any): void;
  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void;
}

interface XtermOptions {
  theme?: Record<string, string>;
  [key: string]: any;
}

interface XtermBuffer {
  readonly active: XtermBufferActive;
  readonly length: number;
}

interface XtermBufferActive {
  getLine(y: number): XtermBufferLine | undefined;
  readonly length: number;
}

interface XtermBufferLine {
  translateToString(): string;
  readonly length: number;
}

interface XtermFitAddon {
  fit(): { cols: number; rows: number } | void;
  proposeDimensions(): { cols: number; rows: number } | undefined;
}

interface XtermSearchAddon {
  findNext(pattern: string, opts?: { incremental?: boolean; regex?: boolean; caseSensitive?: boolean }): boolean;
  findPrevious(pattern: string, opts?: { incremental?: boolean; regex?: boolean; caseSensitive?: boolean }): boolean;
  clearActiveSearch(): void;
}

// ──────────────────────────────────────────────
// Store types
// ──────────────────────────────────────────────

interface Store<T> {
  getState(): T;
  setState(partial: Partial<T>): void;
  subscribe(listener: (state: T) => void): () => void;
  destroy(): void;
}

interface ChatStoreState {
  open: boolean;
  sending: boolean;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface PaletteStoreState {
  open: boolean;
}

interface UIStoreState {
  theme: string;
  [key: string]: any;
}

interface CLIStoreState {
  clis?: Array<CLIRegistryEntry>;
  [key: string]: any;
}

// ──────────────────────────────────────────────
// Domain types
// ──────────────────────────────────────────────

interface CLIRegistryEntry {
  id: string;
  name: string;
  path?: string;
  args?: string[];
  version?: string;
  type?: string;
  category?: 'agent' | 'directory' | 'tool';
  icon?: string;
}

interface TabState {
  tabId?: string;
  cliId?: string;
  name?: string;
  icon?: string;
  buffer?: string;
  timestamp?: number;
  init?: string;
}

interface AppState {
  connected: boolean;
  launched: boolean;
  theme?: string;
  clis?: CLIRegistryEntry[];
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
  [key: string]: any;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface TerminalBufferLine {
  lineNum: number;
  text: string;
}

interface UploadResult {
  success: boolean;
  files: Array<{
    name: string;
    mime: string;
    path: string;
  }>;
}

interface PinEntry {
  id: string;
  text: string;
  source?: string;
  cliId?: string;
  title?: string;
  timestamp?: number;
}

interface SnippetEntry {
  id: string;
  name: string;
  command: string;
  description?: string;
}

interface WelcomeData {
  quickStart?: Array<{ icon: string; title: string; desc: string }>;
  features?: Array<{ icon: string; title: string; desc: string; iconColor?: string }>;
  shortcuts?: Array<{ key: string; desc: string }>;
  tips?: string[];
  installTools?: Array<{
    icon: string; name: string; desc: string; iconColor?: string;
    methods?: Array<{ label: string; code: string }>;
  }>;
}

interface WorkflowDef {
  id: string;
  name: string;
  description: string;
  icon?: string;
  collaboration?: boolean;
  ensemble?: boolean;
  steps: Array<WorkflowStep | ParallelWorkflowStep>;
}

interface WorkflowStep {
  id: string;
  label: string;
  agentId: string;
  task: string;
}

interface ParallelWorkflowStep {
  id: string;
  label: string;
  mode: 'parallel';
  agents: Array<{ agentId: string; task: string }>;
  mergeLabel: string;
}

interface ToolCallEvent {
  type: 'start' | 'end';
  names?: string[];
  name?: string;
  durMs?: number;
}

// ──────────────────────────────────────────────
// Plugin / UI Registry types
// ──────────────────────────────────────────────

interface UIRegistry {
  registerTab(id: string, def: TabDefinition): boolean;
  getTabs(): Array<TabDefWithId>;
  unregisterTab(id: string): void;
  markTabRendered(id: string): void;
  isTabRendered(id: string): boolean;
  registerMenuItem(id: string, def: MenuItemDefinition): boolean;
  getMenuItems(): Array<MenuDefWithId>;
  getMenuItemsForContext(hasSelection: boolean): Array<MenuDefWithId>;
  unregisterMenuItem(id: string): void;
  registerCommand(id: string, def: CommandDefinition): boolean;
  getCommands(): Array<CommandDefWithId>;
  searchCommands(query: string): Array<CommandDefWithId>;
  unregisterCommand(id: string): void;
  unregisterAll(pluginName: string): void;
  clear(): void;
  readonly stats: { tabs: number; menuItems: number; commands: number };
}

interface TabDefinition {
  icon: string;
  label: string;
  render: (container: HTMLElement) => void;
  order?: number;
}

interface TabDefWithId extends TabDefinition {
  id: string;
  _rendered: boolean;
}

interface MenuItemDefinition {
  label: string;
  action: (selection: string, terminal: XtermTerminal | null) => void;
  requiresSelection?: boolean;
  order?: number;
}

interface MenuDefWithId extends MenuItemDefinition {
  id: string;
}

interface CommandDefinition {
  icon: string;
  name: string;
  desc: string;
  execute: () => void;
  order?: number;
  category?: string;
}

interface CommandDefWithId extends CommandDefinition {
  id: string;
}

// ──────────────────────────────────────────────
// Chat API types
// ──────────────────────────────────────────────

interface ChatAPIOptions {
  messages: ChatMessage[];
  terminalContext?: string;
  terminalContextChanged?: boolean;
  signal?: AbortSignal;
  onToolCall?: (evt: ToolCallEvent) => void;
  onStatus?: (msg: string) => void;
  onToken?: (token: string) => void;
  onDone?: () => void;
  onError?: (err: any) => void;
  onUsage?: (usage: Record<string, number>) => void;
}

interface ChatAPI {
  isConfigured(): Promise<boolean>;
  sendMessage(opts: ChatAPIOptions): void;
}

// ──────────────────────────────────────────────
// Pin Report types
// ──────────────────────────────────────────────

interface PinReportModule {
  renderPinnedList(): Promise<void>;
  openReportPanel(pin: PinEntry): void;
  closeReportPanel(): void;
  exportPinsToMarkdown(): void;
  exportSelectedToMarkdown(): void;
  mergeSelectedPins(): void;
  toggleMergeMode(): void;
  readonly sortBy: string;
  init(): void;
}

// ──────────────────────────────────────────────
// QCLI Global Namespace — main declaration
// ──────────────────────────────────────────────

/** @namespace */
interface QCLINamespace {
  // ── WebSocket ──
  ws: WebSocket | null;
  wsSend: (data: any) => void;
  wsConnect: () => void;
  wsDisconnect: () => void;
  wsManager: import('./components/ws-manager').default;
  setConnectionStatus: (status: string, customText?: string) => void;
  onWSMessage: ((msg: any) => void) | null;

  // ── State ──
  state: AppState;
  dom: Record<string, HTMLElement>;

  // ── Theme ──
  DARK_THEME: Record<string, string>;
  LIGHT_THEME: Record<string, string>;
  getPreferredTheme: () => 'dark' | 'light';
  applyTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  getCustomTheme: () => Record<string, any> | null;
  saveCustomTheme: (settings: Record<string, any>) => void;
  applyCustomInnerBg: (colorWithAlpha: string) => void;
  applyCustomOuterBg: (color: string) => void;
  applyCustomBgFromStorage: () => void;
  resetCustomTheme: () => void;

  // ── Terminal ──
  term: XtermTerminal | null;
  Tabs: Record<string, any> | null;
  fitAddon: XtermFitAddon | null;
  searchAddon: XtermSearchAddon | null;
  changeFontSize: (delta: number) => void;
  toggleSearchBar: () => void;
  showSearchBar: () => void;
  hideSearchBar: () => void;
  searchBarVisible: () => boolean;
  performSearch: () => void;
  findNext: () => void;
  findPrevious: () => void;
  toggleSidebar: () => void;
  getSidebarWidth: () => number;
  applySidebarWidth: (width: number) => void;

  // ── Stores ──
  chatStore?: Store<ChatStoreState>;
  paletteStore?: Store<PaletteStoreState>;
  uiStore?: Store<UIStoreState>;
  cliStore?: Store<CLIStoreState>;
  terminalStore?: Store<any>;

  // ── Chat ──
  ChatUI: Record<string, any>;
  ChatAPI: ChatAPI;
  chatPanel?: import('./components/chat-panel').default;

  // ── Palette ──
  Palette: {
    openPalette?: () => void;
    closePalette?: (focusTerminal?: boolean) => void;
    _patched?: boolean;
  };
  openPalette?: () => void;
  closePalette?: (focusTerminal?: boolean) => void;

  // ── Sidebar ──
  Sidebar?: {
    launchCLI?: (cliId: string) => void;
    showAddModal?: () => void;
    discoverCLIs?: () => void;
  };

  // ── Settings ──
  Settings?: {
    open?: () => void;
    close?: () => void;
  };

  // ── Context Menu ──
  showContextMenu: (x: number, y: number, selection: string) => void;
  hideContextMenu: () => void;
  requestNotificationPermission: () => void;
  copySelection: () => void;
  pinSelectedOutput: () => Promise<void>;
  searchSelection: () => void;
  pasteClipboard: () => void;
  renderPinnedList: () => Promise<void>;

  // ── Pins ──
  PinStore?: {
    getAll: () => Promise<PinEntry[]>;
    add: (text: string, cliId?: string, source?: string, title?: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
  };
  PinReport?: PinReportModule;

  // ── Snippets ──
  SnippetStore?: {
    getAll: () => Promise<SnippetEntry[]>;
    add: (name: string, command: string, desc?: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
  };
  openSnippetPanel: () => Promise<void>;
  closeSnippetPanel: () => void;
  renderSnippetList: () => Promise<void>;

  // ── History ──
  openHistoryPanel?: () => void;
  closeHistoryPanel?: () => void;

  // ── Workspace ──
  openWorkspacePanel?: () => void;

  // ── Session ──
  SessionStore?: {
    loadAllSessions: () => Promise<TabState[]>;
    clearAllSessions: () => Promise<void>;
    saveSession: (tab: TabState) => Promise<void>;
  };
  checkSavedSessions: () => Promise<void>;
  launchDefaultCLI?: () => void;
  _pendingInit?: Map<string, any>;

  // ── Global Search ──
  openGlobalSearch: () => void;
  closeGlobalSearch: () => void;
  toggleGlobalSearch: () => void;
  renderGlobalSearchResults: (query: string) => void;

  // ── Welcome ──
  Welcome?: {
    renderWelcome: (data: WelcomeData) => void;
  };
  initWelcomeCarousel: () => void;

  // ── Diagrams ──
  DiagramRenderer: typeof import('./components/diagram-renderer').default;
  MermaidRenderer: typeof import('./components/diagram-renderer').default;

  // ── Workflows ──
  Workflows?: Record<string, any>;

  // ── Agents ──
  Agents?: Record<string, any>;

  // ── Presets ──
  Presets?: Record<string, any>;

  // ── Upload ──
  Upload?: {
    openMediaPreview?: (files: any[], index: number) => void;
  };
  showUploadStatus: (msg: string | { _onClick: () => void; toString: () => string }, type?: string) => void;

  // ── Toast ──
  showToast: (msg: string, type?: 'success' | 'info' | 'error' | 'warning') => void;

  // ── UI Registry ──
  UIRegistry: UIRegistry;
  injectCSS: (href: string) => void;

  // ── Custom CSS ──
  CustomCSS?: {
    open?: () => void;
  };

  // ── Progress Bar ──
  showProgressBar: () => void;
  hideProgressBar: () => void;

  // ── Shortcuts ──
  Shortcuts?: {
    toggle?: () => void;
  };

  // ── Voice ──
  VoiceOutput?: {
    speakAIResponse?: (text: string) => void;
  };

  // ── i18n ──
  __?: (key: string) => string;

  // ── Utility ──
  loadCLIs?: () => Promise<void>;
  connectWS?: () => void;
  getCategoryIcon?: (cat: string) => string;

  // ── Internal flags ──
  _themePatched?: boolean;
  _fileUploadPatched?: boolean;
  _snippetPatched?: boolean;
  _globalSearchPatched?: boolean;
  _sidebarPatched?: boolean;

  // ── Mermaid ──
  _theme?: string;
}

// ── Export QCLI type for JSDoc @typedef imports ──
// This allows component files to use: /** @typedef {import('./types').QCLI} QCLI */
export type QCLI = QCLINamespace;

// ── Augment the global Window interface ──
interface Window {
  QCLI: QCLINamespace;
  mermaid?: {
    initialize: (config: Record<string, any>) => void;
    render: (id: string, source: string) => Promise<{ svg: string }>;
    parse: (source: string) => Promise<any>;
    parseError?: (err: any) => string;
  };
  hpccWasm?: {
    graphviz: {
      load: () => Promise<{
        dot: (source: string, format: string) => string;
      }>;
    };
  };
  __mcpConsoleLogs?: Array<{ method: string; text: string; time: number }>;
  __mcpConsoleCaptureInjected?: boolean;
  __lastUploadedFiles?: any[];
}
