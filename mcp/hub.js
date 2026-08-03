/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Hub — singleton connection registry for Hesi.
//
// Responsibilities:
//   - persist imported connectors to data/mcp-clients.json
//   - import connectors from the local WorkBuddy cache
//   - connect / disconnect / list-tools / call-tool
//   - bootstrap(): auto-connect connectors flagged enabled
//
// One in-memory Map<id, McpConnector> is the live source of
// truth; the persisted file only stores configuration + the
// last-known status snapshot.
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');
const { McpConnector } = require('./client');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STORE_PATH = path.join(DATA_DIR, 'mcp-clients.json');
// Vendored connector definitions live INSIDE the Hesi project tree, so they
// are available even without WorkBuddy installed. WB's user-space cache is
// kept only as a secondary fallback (newer connectors, if present).
const VENDOR_CONNECTORS = path.join(__dirname, '..', 'vendor', 'connectors');
const WB_CACHE = path.join(os.homedir(), '.workbuddy', 'connectors-marketplace', 'connectors');

// Resolve a connector's base directory: vendor first, then WB cache.
function _resolveConnectorBase(sourceId) {
  if (fs.existsSync(path.join(VENDOR_CONNECTORS, sourceId, 'mcp.json'))) return VENDOR_CONNECTORS;
  if (fs.existsSync(path.join(WB_CACHE, sourceId, 'mcp.json'))) return WB_CACHE;
  return null;
}

function safeJsonParse(raw, fallback) {
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'conn';
}

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify({ clients: [] }, null, 2), 'utf-8');
  }
}

function loadStore() {
  ensureStore();
  const data = safeJsonParse(fs.readFileSync(STORE_PATH, 'utf-8'), { clients: [] });
  if (!Array.isArray(data.clients)) data.clients = [];
  return data;
}

function saveStore(data) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

class McpHub {
  constructor() {
    /** @type {Map<string, McpConnector>} */
    this.live = new Map();
    this._bootstrapped = false;
  }

  _readEntry(mcpConfig) {
    // mcpConfig may be object or JSON string; normalize to object
    let obj = mcpConfig;
    if (typeof mcpConfig === 'string') obj = safeJsonParse(mcpConfig, null);
    if (!obj || !obj.mcpServers) return null;
    const keys = Object.keys(obj.mcpServers);
    if (!keys.length) return null;
    const serverName = keys[0];
    return { serverName, entry: obj.mcpServers[serverName] };
  }

  list() {
    const data = loadStore();
    return data.clients.map((c) => {
      const live = this.live.get(c.id);
      if (live) return live.toJSON();
      return {
        id: c.id,
        name: c.name,
        serverName: c.serverName,
        status: c.status || 'disconnected',
        error: c.error || null,
        toolCount: c.toolCount || 0,
        enabled: !!c.enabled,
        connectedAt: c.connectedAt || null,
        tools: [],
      };
    });
  }

  get(id) {
    const live = this.live.get(id);
    if (live) return live;
    const data = loadStore();
    const rec = data.clients.find((c) => c.id === id);
    return rec || null;
  }

  /** Scan vendored + WB-cached connectors for importable connectors. */
  availableFromCache() {
    const bases = [VENDOR_CONNECTORS, WB_CACHE].filter((b) => fs.existsSync(b));
    const out = [];
    const seen = new Set();
    for (const base of bases) {
      let dirs = [];
      try { dirs = fs.readdirSync(base); } catch (e) { continue; }
      for (const dir of dirs) {
        if (seen.has(dir)) continue; // vendor wins on id collision
        const mcpPath = path.join(base, dir, 'mcp.json');
        if (!fs.existsSync(mcpPath)) continue;
        const raw = fs.readFileSync(mcpPath, 'utf-8').trim();
        if (!raw) continue;
        const parsed = this._readEntry(raw);
        if (!parsed) continue;
        seen.add(dir);
        let name = dir;
        const metaPath = path.join(base, dir, 'connector-meta.json');
        if (fs.existsSync(metaPath)) {
          const meta = safeJsonParse(fs.readFileSync(metaPath, 'utf-8'), null);
          if (meta) name = meta.name_zh || meta.name || meta.name_en || dir;
        }
        out.push({ id: dir, name, serverName: parsed.serverName, type: parsed.entry.type || (parsed.entry.command ? 'stdio' : 'streamableHttp'), source: base === VENDOR_CONNECTORS ? 'vendored' : 'workbuddy-cache' });
      }
    }
    return out;
  }

  importFromCache(sourceId, { env = {}, enabled = false } = {}) {
    const base = _resolveConnectorBase(sourceId);
    if (!base) throw new Error(`Connector cache not found: ${sourceId}`);
    const mcpPath = path.join(base, sourceId, 'mcp.json');
    const raw = fs.readFileSync(mcpPath, 'utf-8').trim();
    if (!raw) throw new Error(`Connector ${sourceId} has empty mcp.json`);
    const parsed = this._readEntry(raw);
    if (!parsed) throw new Error(`Connector ${sourceId} has no mcpServers`);
    let name = sourceId;
    const metaPath = path.join(base, sourceId, 'connector-meta.json');
    if (fs.existsSync(metaPath)) {
      const meta = safeJsonParse(fs.readFileSync(metaPath, 'utf-8'), null);
      if (meta) name = meta.name_zh || meta.name || meta.name_en || sourceId;
    }
    return this._persist({ id: sourceId, name, serverName: parsed.serverName, entry: parsed.entry, env, enabled });
  }

  importRaw({ id, name, serverName, entry, env = {}, enabled = false }) {
    const sid = slugify(id || name || 'raw');
    const parsed = serverName && entry ? { serverName, entry } : this._readEntry(entry || serverName);
    if (!parsed) throw new Error('Invalid mcp config: missing mcpServers');
    return this._persist({ id: sid, name: name || sid, serverName: parsed.serverName, entry: parsed.entry, env, enabled });
  }

  _persist({ id, name, serverName, entry, env, enabled }) {
    const data = loadStore();
    const rec = {
      id,
      name,
      serverName,
      entry,
      env: env || {},
      enabled: !!enabled,
      status: 'disconnected',
      error: null,
      toolCount: 0,
      connectedAt: null,
    };
    const idx = data.clients.findIndex((c) => c.id === id);
    if (idx >= 0) data.clients[idx] = rec;
    else data.clients.push(rec);
    saveStore(data);
    return rec;
  }

  remove(id) {
    const live = this.live.get(id);
    if (live) live.disconnect();
    this.live.delete(id);
    const data = loadStore();
    data.clients = data.clients.filter((c) => c.id !== id);
    saveStore(data);
    return true;
  }

  _makeConnector(rec) {
    return new McpConnector({
      id: rec.id,
      name: rec.name,
      serverName: rec.serverName,
      entry: rec.entry,
      env: rec.env || {},
    });
  }

  async connect(id) {
    const data = loadStore();
    const rec = data.clients.find((c) => c.id === id);
    if (!rec) throw new Error(`Connector not found: ${id}`);
    const connector = this._makeConnector(rec);
    try {
      await connector.connect();
      this.live.set(id, connector);
    } catch (e) {
      // Persist the failure so the UI can show status=error.
      // 重新读取最新 store 再合并本记录，避免并发 connect 的读改写竞态互相覆盖（见 Batch C）。
      const fresh = loadStore();
      const r = fresh.clients.find((c) => c.id === id);
      if (r) {
        r.status = 'error';
        r.error = e.message;
        r.toolCount = 0;
        saveStore(fresh);
      }
      throw e;
    }
    // snapshot status
    const r = data.clients.find((c) => c.id === id);
    if (r) {
      r.status = connector.status;
      r.error = connector.error;
      r.toolCount = connector.tools.length;
      r.connectedAt = connector.connectedAt;
      saveStore(data);
    }
    return connector.toJSON();
  }

  disconnect(id) {
    const live = this.live.get(id);
    if (live) live.disconnect();
    this.live.delete(id);
    const data = loadStore();
    const r = data.clients.find((c) => c.id === id);
    if (r) { r.status = 'disconnected'; r.toolCount = 0; r.connectedAt = null; saveStore(data); }
    return true;
  }

  async listTools(id) {
    let live = this.live.get(id);
    if (!live) {
      await this.connect(id);
      live = this.live.get(id);
    }
    return live ? live.tools : [];
  }

  async callTool(id, name, args) {
    let live = this.live.get(id);
    if (!live) {
      await this.connect(id);
      live = this.live.get(id);
    }
    if (!live) throw new Error(`Connector not connected: ${id}`);
    return live.callTool(name, args || {});
  }

  /** Auto-connect connectors flagged enabled (called once at startup). */
  async bootstrap() {
    if (this._bootstrapped) return;
    this._bootstrapped = true;
    const data = loadStore();
    for (const rec of data.clients) {
      if (rec.enabled && rec.entry) {
        try {
          await this.connect(rec.id);
        } catch (e) {
          // graceful: leave status=error, do not crash startup
          console.warn(`[MCP Hub] auto-connect failed for ${rec.id}: ${e.message}`);
        }
      }
    }
  }
}

module.exports = new McpHub();
