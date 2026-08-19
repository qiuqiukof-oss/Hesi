/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Optional Telemetry (C1)
//
// Off by default. When enabled (TELEMETRY_OPT_IN=1 or POST /api/telemetry),
// it aggregates anonymous usage signals LOCALLY — nothing is transmitted
// unless a future reporter is explicitly switched on. Feeds /api/metrics.
// ============================================================
const fs = require('fs');
const { TELEMETRY_OPT_IN, TELEMETRY_FILE, DATA_DIR } = require('./config');

let _enabled = TELEMETRY_OPT_IN;
let _cache = null;
let _mutex = Promise.resolve();

function isEnabled() { return _enabled; }
function setEnabled(v) { _enabled = !!v; return _enabled; }

function load() {
  if (_cache) return _cache;
  try {
    if (fs.existsSync(TELEMETRY_FILE)) _cache = JSON.parse(fs.readFileSync(TELEMETRY_FILE, 'utf-8'));
    else _cache = { daily: {}, features: {}, connectors: {} };
  } catch { _cache = { daily: {}, features: {}, connectors: {} }; }
  return _cache;
}

function persist() {
  _mutex = _mutex.then(() => new Promise((resolve) => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFile(TELEMETRY_FILE, JSON.stringify(_cache, null, 2), 'utf-8', () => resolve());
    } catch { resolve(); }
  }));
  return _mutex;
}

// Record a usage event. user should be an opaque id (not a real username).
function track(event, meta = {}) {
  if (!_enabled) return;
  const d = load();
  const day = new Date().toISOString().slice(0, 10);
  if (!d.daily[day]) d.daily[day] = { events: 0, users: [] };
  d.daily[day].events++;
  if (meta.user && !d.daily[day].users.includes(meta.user)) d.daily[day].users.push(meta.user);
  const f = meta.feature || event;
  d.features[f] = (d.features[f] || 0) + 1;
  if (meta.connector) d.connectors[meta.connector] = (d.connectors[meta.connector] || 0) + 1;
  persist();
}

function snapshot() {
  const d = load();
  const days = Object.keys(d.daily).sort();
  const last = days[days.length - 1];
  const dau = last ? d.daily[last].users.length : 0;
  const recent = days.filter((k) => (Date.now() - new Date(k).getTime()) < 30 * 864e5);
  const mauSet = new Set();
  for (const k of recent) for (const u of d.daily[k].users) mauSet.add(u);
  const topConnectors = Object.entries(d.connectors).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topFeatures = Object.entries(d.features).sort((a, b) => b[1] - a[1]).slice(0, 10);
  return {
    enabled: _enabled,
    dailyActiveUsers: dau,
    monthlyActiveDays: recent.length,
    monthlyActiveUsers: mauSet.size,
    totalEvents: Object.values(d.daily).reduce((s, x) => s + x.events, 0),
    topConnectors: Object.fromEntries(topConnectors),
    topFeatures: Object.fromEntries(topFeatures),
    days,
  };
}

module.exports = { isEnabled, setEnabled, track, snapshot };
