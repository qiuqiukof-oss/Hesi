/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Relaxed CSP for a local-only loopback app. We never fully disable CSP
// (defense-in-depth against any injected inline script), but we allow inline
// <script>/<style> because the SPA shell + bundle rely on them, and we allow
// local ws/http + https image/font loading. External navigations stay blocked
// by default-src 'self'.

// 端口从 lib/port 单一事实源读取（默认 4264），保证与 server.js 监听端口同步，
// 避免改 PORT 后 CSP 白名单指向已不存在的端口而 WS 握手被拦截白屏。
const { getPort } = require('./port');

module.exports = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // 允许从 CDN 加载图表库（mermaid）等外部脚本；限定具体可信镜像域名，
      // 而非放开 'https:'，避免任意外域脚本被执行。
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://cdn.jsdelivr.net",
        "https://fastly.jsdelivr.net",
        "https://gcore.jsdelivr.net",
        "https://testingcf.jsdelivr.net",
        "https://cdn.staticfile.org",
        "https://cdn.staticfile.net",
        "https://cdn.bootcdn.net",
      ],
      // HTML 属性形式的 inline handler（如 <button onclick="...">、innerHTML 拼接的
      // onclick）受 script-src-attr 约束。helmet 默认值为 'none'，会拦截全站所有
      // 内联事件处理器。本机 loopback 应用已整体放开 script-src 的 'unsafe-inline'，
      // 此处对等放开 script-src-attr，消除 "inline event handler violates CSP" 报错。
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:'],
      connectSrc: (() => {
        const port = getPort();
        return ["'self'", `ws://127.0.0.1:${port}`, `ws://[::1]:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`, 'https://cdn.jsdelivr.net'];
      })(),
      // iframe 嵌入允许本地回环任意端口（DSH 引擎 3080 等并行引擎面板）；
      // 端口用通配，兼容 HESI_DSH_PORT 自定义与端口冲突时 findFreePort 回退。
      frameSrc: ["'self'", 'https:', 'http://127.0.0.1:*', 'http://[::1]:*'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'sameorigin' },
};
