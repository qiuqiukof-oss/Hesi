/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Browser Tools — CDP browser control MCP tools
//
// Proxies to routes/browser.js HTTP endpoints.
// Tools: browser_ping, browser_connect, browser_navigate,
//        browser_screenshot, browser_click, browser_type,
//        browser_evaluate, browser_console, browser_list_tabs,
//        browser_switch_tab, browser_info, browser_network
// ============================================================
const { apiBrowserPost, apiBrowserGet } = require("./http-client");

const toolDefinitions = [
  {
    name: "browser_ping",
    description:
      "Check browser CDP connection status. Returns { connected: false } with setup hint if not connected. " +
      "中文：检查浏览器 CDP 连接状态。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_connect",
    description:
      "Connect to local Edge/Chrome browser via CDP debug port (default 9222). " +
      "Once connected, AI can navigate, screenshot, click, type, and inspect. " +
      "中文：连接到本地浏览器的 CDP 调试端口。",
    inputSchema: {
      type: "object",
      properties: {
        cdpUrl: { type: "string", description: "CDP endpoint URL, default http://127.0.0.1:9222 中文：CDP 端点 URL" },
      },
    },
  },
  {
    name: "browser_navigate",
    description:
      "Navigate current tab to a URL. Returns page title and screenshot. " +
      "Only http/https protocols allowed. " +
      "中文：导航到指定 URL，返回页面标题和截图。" +
      "\n\n⚠️ Hesi SAFETY: If the active tab is the Hesi management page (127.0.0.1:4264), " +
      "this operation will be BLOCKED by the server to prevent CDP disconnection. " +
      "To browse external sites, first use browser_farm_create to create an isolated session, " +
      "then navigate within that session. " +
      "中文：如果当前在 Hesi 管理页面（127.0.0.1:4264）上，此操作会被服务器拦截。请先用 browser_farm_create 创建新会话。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL (http/https only) 中文：目标 URL" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_screenshot",
    description:
      "Take a screenshot of the current viewport (JPEG base64). " +
      "Use for visual analysis of page layout. " +
      "中文：截取当前浏览器可视区域截图（JPEG base64）。",
    inputSchema: {
      type: "object",
      properties: {
        fullPage: { type: "boolean", description: "Full page screenshot (default: false) 中文：全页截图" },
      },
    },
  },
  {
    name: "browser_click",
    description:
      "Click an element on the page. Supports three locator strategies (priority order): " +
      "1. text (text content match, most stable) 2. selector (CSS selector) 3. coordinate (viewport xy). " +
      "Returns updated page state screenshot. " +
      "中文：点击页面元素。支持文本定位、CSS 选择器、视口坐标三种方式。",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector like '#submit-btn' 中文：CSS 选择器" },
        text: { type: "string", description: "Element text content (recommended) 中文：元素文本内容（推荐）" },
        coordinate: {
          type: "object",
          properties: {
            x: { type: "number", description: "Viewport X coordinate" },
            y: { type: "number", description: "Viewport Y coordinate" },
          },
          description: "Viewport coordinate (from AI visual analysis) 中文：视口坐标",
        },
      },
    },
  },
  {
    name: "browser_type",
    description:
      "Type text into an input field. Provide a CSS selector, or omit for keyboard input to focused element. " +
      "Max 1000 characters per call. " +
      "中文：在输入框中输入文本。可指定 CSS 选择器或直接键盘输入。",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Input CSS selector (optional) 中文：输入框选择器（可选）" },
        text: { type: "string", description: "Text to type 中文：要输入的文本" },
        clear: { type: "boolean", description: "Clear existing content first (default: false) 中文：输入前清空" },
      },
      required: ["text"],
    },
  },
  {
    name: "browser_evaluate",
    description:
      "Execute JavaScript in the browser page context. Returns JSON result. " +
      "Use for reading console logs, extracting data, or triggering custom page actions. " +
      "中文：在浏览器页面中执行 JavaScript 并返回 JSON 结果。",
    inputSchema: {
      type: "object",
      properties: {
        expression: { type: "string", description: "JavaScript expression to evaluate 中文：要执行的 JS 表达式" },
      },
      required: ["expression"],
    },
  },
  {
    name: "browser_console",
    description:
      "Retrieve accumulated browser console log entries (log, warn, error). " +
      "Returns up to the last 100 entries. Useful for debugging page load failures. " +
      "中文：获取浏览器 console 日志（最近 100 条）。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_list_tabs",
    description:
      "List all open browser tabs with URL and title. " +
      "Use this to understand the browser's current state. " +
      "中文：列出所有打开的浏览器标签页。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_switch_tab",
    description:
      "Switch to a specific tab by index. " +
      "中文：切换到指定索引的标签页。",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Tab index (0-based) 中文：标签页索引（从 0 开始）" },
      },
      required: ["index"],
    },
  },
  {
    name: "browser_info",
    description:
      "Get detailed browser environment information: all open tabs, browser version, platform OS, memory usage, and CDP status. " +
      "Use this to understand the full browser state before performing operations. " +
      "中文：获取详细的浏览器环境信息：所有打开的标签页、浏览器版本、操作系统平台、内存使用和 CDP 状态。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_network",
    description:
      "Monitor network requests (fetch/XHR/beacon) in the active browser tab. " +
      "Actions: 'start' to begin capturing, 'get' to retrieve captured entries with stats, 'stop' to end capture. " +
      "Returns detailed request/response info including headers, status, body preview, and duration. " +
      "中文：监控浏览器网络请求。支持 start/get/stop 三种操作。",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "get", "stop"],
          description: "Action: start (start capture), get (retrieve entries), stop (stop capture) 中文：操作类型"
        },
        filter: {
          type: "object",
          properties: {
            urls: { type: "array", items: { type: "string" }, description: "URL filter (partial match) 中文：URL 过滤" },
            methods: { type: "array", items: { type: "string" }, description: "HTTP method filter 中文：HTTP 方法过滤" },
          },
          description: "Optional filter 中文：可选过滤条件"
        },
      },
      required: ["action"],
    },
  },
];

function createHandlers() {
  return {
    browser_ping: async () => {
      const data = await apiBrowserGet("/browser/ping");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_connect: async (args) => {
      // Validate CDP URL — only allow localhost/127.0.0.1 connections
      const cdpUrl = args.cdpUrl || "http://127.0.0.1:9222";
      try {
        const parsed = new URL(cdpUrl);
        if (!["http:", "https:"].includes(parsed.protocol)) {
          throw new Error("CDP URL must use http or https protocol");
        }
        if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
          throw new Error(`CDP URL hostname '${parsed.hostname}' is not allowed — only 127.0.0.1 or localhost`);
        }
      } catch (err) {
        if (err.message.includes("CDP URL")) {
          return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify({ error: `Invalid CDP URL: ${cdpUrl}` }) }], isError: true };
      }
      const data = await apiBrowserPost("/browser/connect", { cdpUrl });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_navigate: async (args) => {
      const data = await apiBrowserPost("/browser/navigate", { url: args.url });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_screenshot: async (args) => {
      const data = await apiBrowserPost("/browser/screenshot", { fullPage: args.fullPage || false });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_click: async (args) => {
      const body = {};
      if (args.selector) body.selector = args.selector;
      if (args.text) body.text = args.text;
      if (args.coordinate) body.coordinate = args.coordinate;
      const data = await apiBrowserPost("/browser/click", body);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_type: async (args) => {
      const data = await apiBrowserPost("/browser/type", {
        selector: args.selector,
        text: args.text,
        clear: args.clear,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_evaluate: async (args) => {
      const data = await apiBrowserPost("/browser/evaluate", { expression: args.expression });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_console: async () => {
      const data = await apiBrowserPost("/browser/console", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_list_tabs: async () => {
      const data = await apiBrowserGet("/browser/tabs");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_switch_tab: async (args) => {
      const data = await apiBrowserPost("/browser/switch-tab", { index: args.index });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_info: async () => {
      const data = await apiBrowserGet("/browser/info");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_network: async (args) => {
      const data = await apiBrowserPost("/browser/network", {
        action: args.action,
        filter: args.filter,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  };
}

// ══════════════════════════════════════════════════════════════
// P3 工具定义
// ══════════════════════════════════════════════════════════════

const p3ToolDefinitions = [
  // ── P3-1: 浏览器农场 ──
  {
    name: "browser_farm_list",
    description:
      "List all browser sessions (contexts) in the browser farm. Each session has isolated cookies/storage. " +
      "Returns session list with page URLs and active status. " +
      "中文：列出浏览器农场中的所有会话（隔离上下文）。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_farm_create",
    description:
      "Create a new isolated browser session (context) in the browser farm. " +
      "New sessions have their own cookies, localStorage, and cache — perfect for multi-user, multi-account testing. " +
      "Returns the new session index. " +
      "中文：创建新的隔离浏览器会话，适合多账号/多用户测试。" +
      "\n\n🚨 IMPORTANT: ALWAYS call this first when you need to browse the web! " +
      "The default session (context index 0) is the Hesi management page. " +
      "Using browser_navigate, browser_click, browser_type, etc. on context 0 will " +
      "disconnect the CDP debug session and break all browser automation. " +
      "Always create a new session (context index >= 1) and operate there. " +
      "中文：任何需要浏览器操作时，务必先调用此工具！" +
      "默认会话（context 0）是 Hesi 管理页面，对其进行操作会导致 CDP 断开。",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", description: "Session label 中文：会话标签" },
        locale: { type: "string", description: "Locale (e.g. en-US, zh-CN) 中文：区域设置" },
        userAgent: { type: "string", description: "Custom User-Agent 中文：自定义 User-Agent" },
        colorScheme: { type: "string", enum: ["light", "dark"], description: "Color scheme 中文：颜色方案" },
      },
    },
  },
  {
    name: "browser_farm_switch",
    description:
      "Switch to a different browser session by index. All subsequent browser operations will use this session. " +
      "中文：切换到指定索引的浏览器会话。" +
      "\n\n⚠️ Never switch to context index 0 for browsing — it is the Hesi management page. " +
      "Only use context index >= 1 (created via browser_farm_create). " +
      "中文：切勿切换到 context 0 进行浏览操作，那是 Hesi 管理页面。",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Session index (0-based) 中文：会话索引（从 0 开始）" },
      },
      required: ["index"],
    },
  },
  {
    name: "browser_farm_close",
    description:
      "Close a browser session by index. Cannot close the default session (index 0). " +
      "中文：关闭指定索引的浏览器会话（不能关闭默认会话）。",
    inputSchema: {
      type: "object",
      properties: {
        index: { type: "number", description: "Session index to close 中文：要关闭的会话索引" },
      },
      required: ["index"],
    },
  },

  // ── P3-2: DOM 差异对比 ──
  {
    name: "browser_dom_snapshot",
    description:
      "Capture a structured DOM snapshot of the current page. Returns a simplified DOM tree with tags, IDs, classes, and text. " +
      "Use this before and after an action to compare changes with browser_dom_diff. " +
      "中文：捕获当前页面的 DOM 结构快照。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_dom_diff",
    description:
      "Compare two DOM snapshots and return the differences (additions, removals, modifications). " +
      "Pass snapshotA and snapshotB as the full snapshot objects (obtained from browser_dom_snapshot). " +
      "中文：比较两个 DOM 快照并返回差异。",
    inputSchema: {
      type: "object",
      properties: {
        snapshotA: { type: "object", description: "First DOM snapshot (required) 中文：第一个 DOM 快照" },
        snapshotB: { type: "object", description: "Second DOM snapshot (required) 中文：第二个 DOM 快照" },
      },
      required: ["snapshotA", "snapshotB"],
    },
  },

  // ── P3-3: 表单自动填表 ──
  {
    name: "browser_detect_forms",
    description:
      "Detect all form fields on the current page. Returns form structure with input names, types, placeholder, labels, options (for selects), etc. " +
      "Use this before browser_fill_forms to understand what fields are available. " +
      "中文：检测当前页面上所有的表单字段。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "browser_fill_forms",
    description:
      "Auto-fill form fields on the current page. Pass an array of { name, value } or { selector, value } pairs. " +
      "Supports input, select, textarea, checkbox, radio, and file upload fields. " +
      "中文：自动填充页面上的表单字段。",
    inputSchema: {
      type: "object",
      properties: {
        fields: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Field name attribute 中文：字段 name" },
              selector: { type: "string", description: "CSS selector (overrides name) 中文：CSS 选择器" },
              value: { type: "string", description: "Value to fill 中文：要填充的值" },
              type: { type: "string", description: "Field type (checkbox, radio, file, etc.) 中文：字段类型" },
            },
          },
          description: "Array of fields to fill 中文：要填充的字段数组",
        },
      },
      required: ["fields"],
    },
  },

  // ── P3-4: Accessibility ──
  {
    name: "browser_accessibility",
    description:
      "Run an accessibility audit on the current page. Checks: page title, lang attribute, image alt text, " +
      "form label associations, heading hierarchy, keyboard navigation, ARIA roles, and color contrast. " +
      "Returns a list of issues with severity levels and a score (0-100). " +
      "中文：在当前页面上运行可访问性审核。",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
];

const allToolDefinitions = [...toolDefinitions, ...p3ToolDefinitions];

function createAllHandlers() {
  const baseHandlers = createHandlers();

  // P3 handlers
  const p3Handlers = {
    browser_farm_list: async () => {
      const data = await apiBrowserGet("/browser/farm/contexts");
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_farm_create: async (args) => {
      const data = await apiBrowserPost("/browser/farm/create", {
        label: args.label,
        locale: args.locale,
        userAgent: args.userAgent,
        colorScheme: args.colorScheme,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_farm_switch: async (args) => {
      const data = await apiBrowserPost("/browser/farm/switch", { index: args.index });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_farm_close: async (args) => {
      const data = await apiBrowserPost("/browser/farm/close", { index: args.index });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_dom_snapshot: async () => {
      const data = await apiBrowserPost("/browser/dom-snapshot", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_dom_diff: async (args) => {
      const data = await apiBrowserPost("/browser/dom-diff", {
        snapshotA: args.snapshotA,
        snapshotB: args.snapshotB,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_detect_forms: async () => {
      const data = await apiBrowserPost("/browser/detect-forms", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_fill_forms: async (args) => {
      const data = await apiBrowserPost("/browser/fill-forms", { fields: args.fields });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
    browser_accessibility: async () => {
      const data = await apiBrowserPost("/browser/accessibility", {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  };

  return { ...baseHandlers, ...p3Handlers };
}

// ══════════════════════════════════════════════════════════════
// 错误处理装饰器
//
// browser 工具底层使用 apiBrowserPost / apiBrowserGet，它们在接口
// 非 2xx 时会 throw 纯文本错误（如「CDP endpoint 无响应」）。若直接
// 冒泡，MCP 层会把纯文本当作错误返回，AI 端再 JSON.parse 就会失败。
// 这里统一捕获，返回结构化 JSON 错误，保证工具结果永远是合法 JSON。
// ══════════════════════════════════════════════════════════════
function wrapSafe(handler, name) {
  return async (args, request) => {
    try {
      return await handler(args, request);
    } catch (err) {
      const message = (err && err.message) ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: message, tool: name, connected: false }, null, 2),
          },
        ],
        isError: true,
      };
    }
  };
}

function wrapAll(handlers) {
  const out = {};
  for (const [name, h] of Object.entries(handlers)) {
    out[name] = wrapSafe(h, name);
  }
  return out;
}

module.exports = { toolDefinitions: allToolDefinitions, createHandlers: () => wrapAll(createAllHandlers()) };
