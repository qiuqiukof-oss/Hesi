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
      scriptSrc: ["'self'", "'unsafe-inline'"],
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
