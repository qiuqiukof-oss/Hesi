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
