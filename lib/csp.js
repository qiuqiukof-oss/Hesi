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
      connectSrc: ["'self'", 'ws://127.0.0.1:4264', 'http://127.0.0.1:4264'],
      frameSrc: ["'self'", 'https:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  frameguard: { action: 'sameorigin' },
};
