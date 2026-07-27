// @ts-check
// ============================================================
// App Telemetry — first-paint measurement + global UI error boundary
//
// - Measures first paint / DOM-ready / app-ready and reports locally.
// - Installs a global error boundary that surfaces uncaught errors via
//   toast (instead of failing silently), and reports them locally.
// - Telemetry is LOCAL ONLY: reported to /api/telemetry/client which logs
//   server-side; nothing is transmitted externally (privacy-first, off by default).
// ============================================================
/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});

/**
 * Report a client-side telemetry event. Fails silently — telemetry must
 * never break the app.
 * @param {string} kind
 * @param {Record<string, any>} payload
 */
function report(kind, payload) {
  try {
    const body = JSON.stringify(Object.assign({ kind }, payload));
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/telemetry/client', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/telemetry/client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch (_) { /* telemetry failure is non-fatal */ }
}

/** Measure and report first-paint / DOM-ready / app-ready timings. */
function measureFirstPaint() {
  try {
    const nav = /** @type {PerformanceNavigationTiming} */ (performance.getEntriesByType('navigation')[0]);
    const paintEntries = performance.getEntriesByType('paint');
    const fcp = paintEntries.find((e) => e.name === 'first-contentful-paint');
    const fcpMs = fcp ? Math.round(fcp.startTime) : null;
    const domReadyMs = nav ? Math.round(nav.domContentLoadedEventEnd) : null;
    const loadMs = nav ? Math.round(nav.loadEventEnd) : null;
    // When this module executes, the main bundle has finished booting.
    const appReadyMs = Math.round(performance.now());
    const metrics = { fcp: fcpMs, domReady: domReadyMs, load: loadMs, appReady: appReadyMs };
    // eslint-disable-next-line no-console
    console.info('[telemetry] first-paint', metrics);
    report('first_paint', metrics);
  } catch (_) { /* measurement failure is non-fatal */ }
}

/** Show a visible error toast if the toast API is ready. */
function surfaceError(msg) {
  try { if (Q.showToast) Q.showToast('⚠️ ' + msg, 'error'); } catch (_) {}
}

/** Install global error handlers: surface errors instead of failing silently. */
function installErrorBoundary() {
  window.addEventListener('error', (e) => {
    const evt = /** @type {ErrorEvent} */ (e);
    const msg = (evt && evt.message) || 'Unknown error';
    // eslint-disable-next-line no-console
    console.error('[app-error]', msg, evt && evt.error);
    surfaceError(msg);
    report('client_error', {
      message: msg,
      stack: evt && evt.error && evt.error.stack,
      url: location.href,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const evt = /** @type {PromiseRejectionEvent} */ (e);
    const reason = evt && evt.reason;
    const msg = (reason && (reason.message || reason.toString())) || 'Unhandled promise rejection';
    // eslint-disable-next-line no-console
    console.error('[app-error:rejection]', msg, reason);
    surfaceError(msg);
    report('client_error', {
      message: msg,
      stack: reason && reason.stack,
      url: location.href,
    });
  });
}

// First paint is only meaningful after the document has loaded.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  measureFirstPaint();
} else {
  window.addEventListener('load', measureFirstPaint, { once: true });
}

installErrorBoundary();

export {};
