/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Agnes AI proxy — forwards browser requests to the Agnes cloud API through
// Hesi, injecting the API key server-side (the key is never exposed to the browser).
// Supports streaming responses (SSE for chat completions) by piping the upstream
// body back to the client.
'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_DATA = path.join(__dirname, '..', '..', '..', 'data', 'plugin-data', 'agnes-ai');
const CONFIG_FILE = path.join(PLUGIN_DATA, 'config.json');

const PROXY_PREFIX = '/api/plugins/agnes-ai/proxy';
const DEFAULT_BASE = 'https://apihub.agnes-ai.com/v1';

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return {};
}

// Resolve the Agnes host (strip the trailing /v1 so we can re-append the proxied path).
function resolveBase(cfg) {
  const raw = (cfg.apiBaseUrl || DEFAULT_BASE).trim();
  return raw.replace(/\/v1\/?$/, '') || 'https://apihub.agnes-ai.com';
}

// Robustly read the request body whether or not a global body parser already
// consumed the stream (req.body may be an object or a raw string).
function collectBody(req) {
  return new Promise((resolve) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') return resolve(req.body);
      try { return resolve(JSON.stringify(req.body)); } catch (e) { return resolve(''); }
    }
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
module.exports = async function proxy(req, res) {
  const cfg = loadConfig();
  const apiKey = cfg.apiKey;
  if (!apiKey) {
    return res.status(400).json({
      error: 'Agnes API Key 未配置。请在 Hesi 的 Agnes 插件设置中填入你的 Agnes API Key。',
    });
  }

  const tail = req.originalUrl.slice(PROXY_PREFIX.length) || '/';
  const target = resolveBase(cfg) + tail;

  const headers = { Authorization: `Bearer ${  apiKey}` };
  const ct = req.headers['content-type'];
  if (ct) headers['Content-Type'] = ct;

  const method = req.method.toUpperCase();
  let body;
  if (method !== 'GET' && method !== 'DELETE') {
    body = await collectBody(req);
  }

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: body ? body : undefined,
    });

    res.status(upstream.status);
    const respCt = upstream.headers.get('content-type');
    if (respCt) res.setHeader('Content-Type', respCt);
    const loc = upstream.headers.get('location');
    if (loc) res.setHeader('Location', loc);

    if (upstream.body && upstream.status !== 204) {
      const reader = upstream.body.getReader();
      const pump = () =>
        reader.read().then(({ done, value }) => {
          if (done) { res.end(); return; }
          res.write(Buffer.from(value));
          return pump();
        });
      pump().catch(() => { try { res.end(); } catch (_) {} });
    } else {
      const text = await upstream.text();
      res.send(text);
    }
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ error: `Agnes 代理转发失败: ${  e && e.message}` });
    } else {
      try { res.end(); } catch (_) {}
    }
  }
};
