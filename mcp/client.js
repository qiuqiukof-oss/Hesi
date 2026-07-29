/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// MCP Connector Client — thin wrapper around the official
// @modelcontextprotocol/sdk Client, supporting the three
// transports found in WorkBuddy connector mcp.json files:
//   - stdio         (command + args, e.g. npx)
//   - sse           (Server-Sent Events)
//   - streamableHttp
//
// Why absolute-path require:
//   The SDK's package.json "exports" map (./* -> ./dist/cjs/*)
//   re-prefixes any subpath that already contains "dist/cjs",
//   producing a doubled path and MODULE_NOT_FOUND. Resolving
//   via the mapped subpath "./client" gives us the directory,
//   and requiring sibling files by absolute path bypasses the
//   exports map entirely.
// ============================================================
const path = require('path');

function sdkClientDir() {
  // Mapped subpath resolves cleanly; returns .../dist/cjs/client/index.js
  return path.dirname(require.resolve('@modelcontextprotocol/sdk/client'));
}

const _dir = sdkClientDir();
const { Client } = require(path.join(_dir, 'index.js'));
const { StdioClientTransport } = require(path.join(_dir, 'stdio.js'));
const { StreamableHTTPClientTransport } = require(path.join(_dir, 'streamableHttp.js'));
const { SSEClientTransport } = require(path.join(_dir, 'sse.js'));

/**
 * Resolve ${VAR} placeholders in header/env values from the
 * supplied env map, falling back to process.env, leaving the
 * placeholder intact if unresolved (so connection fails loudly
 * rather than silently sending a literal "${TOKEN}").
 */
function resolveTemplates(input, envMap) {
  if (input == null) return input;
  if (typeof input === 'string') {
    return input.replace(/\$\{([^}]+)\}/g, (m, name) => {
      if (envMap && envMap[name] != null) return String(envMap[name]);
      if (process.env[name] != null) return String(process.env[name]);
      return m;
    });
  }
  if (Array.isArray(input)) return input.map((v) => resolveTemplates(v, envMap));
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) out[k] = resolveTemplates(v, envMap);
    return out;
  }
  return input;
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

class McpConnector {
  /**
   * @param {object} opts
   * @param {string} opts.id        stable connector id
   * @param {string} opts.name      display name
   * @param {string} opts.serverName key inside mcpServers
   * @param {object} opts.entry     the chosen mcpServers[serverName] object
   * @param {object} [opts.env]     extra env vars for ${VAR} resolution
   */
  constructor({ id, name, serverName, entry, env = {} }) {
    this.id = id;
    this.name = name;
    this.serverName = serverName;
    this.entry = entry || {};
    this.env = env || {};
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.status = 'disconnected'; // disconnected | connecting | connected | error
    this.error = null;
    this.connectedAt = null;
  }

  _buildTransport() {
    const e = this.entry;
    const type = (e.type || (e.command ? 'stdio' : 'streamableHttp')).toLowerCase();

    if (type === 'stdio' || e.command) {
      return new StdioClientTransport({
        command: e.command,
        args: Array.isArray(e.args) ? e.args : [],
        env: { ...process.env, ...(e.staticEnv || {}), ...(e.env || {}) },
        cwd: e.cwd || process.cwd(),
      });
    }

    if (!e.url) throw new Error('Missing "url" for http/sse transport');
    const headers = resolveTemplates(e.headers, this.env);
    const url = new URL(e.url);

    if (type === 'sse') {
      return new SSEClientTransport(url, { requestInit: { headers } });
    }
    // streamableHttp (default for http)
    return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  }

  async connect() {
    if (this.client) return this;
    this.status = 'connecting';
    this.error = null;
    // Config `timeout` is expressed in seconds (e.g. 600 = 10 min); our helpers
    // expect ms. Normalize: values < 1000 are treated as seconds → ms so a
    // 600s config is not misinterpreted as a 600ms (instant) timeout.
    const rawTimeout = Number(this.entry.timeout);
    const timeout = rawTimeout
      ? (rawTimeout < 1000 ? rawTimeout * 1000 : rawTimeout)
      : 30000;
    try {
      this.transport = this._buildTransport();
      this.client = new Client({ name: 'cli-q-hub', version: '1.0.0' });
      await withTimeout(this.client.connect(this.transport), timeout, 'connect');
      const res = await withTimeout(this.client.listTools(), timeout, 'listTools');
      this.tools = (res.tools || []).map((t) => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {},
      }));
      this.status = 'connected';
      this.connectedAt = Date.now();
      return this;
    } catch (err) {
      this.status = 'error';
      this.error = err && err.message ? err.message : String(err);
      this._cleanup();
      throw err;
    }
  }

  async listTools() {
    if (!this.client) await this.connect();
    return this.tools;
  }

  async callTool(name, args = {}) {
    if (!this.client) await this.connect();
    const timeout = Number(this.entry.timeout) || 30000;
    const res = await withTimeout(
      this.client.callTool({ name, arguments: args }),
      timeout,
      `callTool:${name}`
    );
    // Normalize SDK result to a plain serializable object
    return {
      content: Array.isArray(res.content)
        ? res.content.map((c) => ({ type: c.type, text: c.text }))
        : res.content,
      isError: !!res.isError,
      structuredContent: res.structuredContent || null,
    };
  }

  async ping() {
    if (!this.client) return false;
    try {
      await withTimeout(this.client.ping(), 10000, 'ping');
      return true;
    } catch (e) {
      return false;
    }
  }

  disconnect() {
    this._cleanup();
    this.status = 'disconnected';
    return true;
  }

  _cleanup() {
    try { if (this.client && typeof this.client.close === 'function') this.client.close(); } catch (e) { /* ignore */ }
    this.client = null;
    this.transport = null;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      serverName: this.serverName,
      status: this.status,
      error: this.error,
      connectedAt: this.connectedAt,
      toolCount: this.tools.length,
      tools: this.tools,
    };
  }
}

module.exports = { McpConnector, resolveTemplates };
