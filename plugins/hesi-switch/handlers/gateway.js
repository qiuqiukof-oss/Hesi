/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Switch — OpenAI 兼容网关（对外）
//
// 让 Claude Code / Cline / 任何 OpenAI SDK 通过 Hesi 的模型体系对话：
//   POST /api/plugins/hesi-switch/v1/chat/completions
//     → model 路由（provider/model 显式 / 默认模型匹配 / 自动选择）
//     → 复用 lib/llm-provider（12 家 provider + ⭐默认/角色 + 自动故障转移）
//     → 标准 OpenAI 格式返回（JSON 非流式 / SSE 流式）
//
// 与 CC-Switch（QwenPaw 版）的差异：
//   - 不再自带 provider 注册表/Key/熔断——全部复用 Hesi 的 llm-provider 层
//     （模型服务页配置一次，网关即生效，天然含健康降级）
//   - 仅保留网关的附加价值：对外端点 + Key 校验 + 用量统计
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_DATA = path.join(__dirname, '..', '..', '..', 'data', 'plugin-data', 'hesi-switch');
const KEYS_FILE = path.join(PLUGIN_DATA, 'keys.json');
const USAGE_FILE = path.join(PLUGIN_DATA, 'usage.json');

/**
 * 读取配置的网关 API Key（数组）。空 = 不启用 Key 校验（仅本机回环场景）。
 * @returns {string[]}
 */
function loadKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
      if (Array.isArray(data)) return data.filter((k) => typeof k === 'string' && k.length >= 8);
    }
  } catch { /* ignore */ }
  return [];
}

/**
 * 记录一次用量（内存聚合 + 落盘）。模型名 → { requests, chars, lastTs }。
 * @param {string} model
 * @param {number} chars
 */
function recordUsage(model, chars) {
  try {
    let usage = {};
    try { if (fs.existsSync(USAGE_FILE)) usage = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); } catch { /* ignore */ }
    const key = String(model || '?').slice(0, 80);
    const cur = usage[key] || { requests: 0, chars: 0, lastTs: 0 };
    cur.requests += 1;
    cur.chars += Number(chars) || 0;
    cur.lastTs = Date.now();
    usage[key] = cur;
    fs.mkdirSync(path.dirname(USAGE_FILE), { recursive: true });
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usage, null, 2), 'utf8');
  } catch { /* 统计失败不影响主流程 */ }
}

/**
 * API Key 校验：本地回环请求跳过（与 CC-Switch 一致，方便 Hesi 内部调用）；
 * 非回环请求必须带有效 Bearer key（配置了 keys 时）。
 * @param {import('express').Request} req
 * @returns {{ ok: boolean, error?: string }}
 */
function checkAuth(req) {
  const keys = loadKeys();
  if (!keys.length) return { ok: true }; // 未配置 key → 不校验（默认本机场景）
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
  if (isLocal) return { ok: true };
  const auth = (req.headers && req.headers.authorization) || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token && keys.includes(token)) return { ok: true };
  return { ok: false, error: 'Invalid API key' };
}

/**
 * model → provider 路由：
 *   1. "provider/model" 或 "provider:model" 显式（provider 必须是注册表 id）
 *   2. 模型名匹配某 provider 的默认/注册模型 → 该 provider
 *   3. 否则 undefined → 自动选择（resolveWithFallback：⭐默认 → 已配置云端 → 本地）
 * @param {string|undefined} model
 * @returns {{ providerId?: string, model?: string }|undefined}
 */
function resolveProviderFromModel(model) {
  if (!model) return undefined;
  const str = String(model);
  // 1. 显式 provider 前缀
  const m = str.match(/^([a-z0-9-]+)[/:](.+)$/);
  if (m) {
    try {
      const { getProviderDef } = require('../../../lib/llm-provider/provider-config');
      if (getProviderDef(m[1])) return { providerId: m[1], model: m[2].trim() };
    } catch { /* ignore */ }
  }
  // 2. 注册表默认模型匹配
  try {
    const { getAllDefs } = require('../../../lib/llm-provider/provider-config');
    const { getConfig } = require('../../../lib/llm-provider/provider-config');
    for (const def of getAllDefs()) {
      const cfg = getConfig(def.id);
      if (cfg.model === str) return { providerId: def.id, model: str };
      if (Array.isArray(def.models) && def.models.includes(str)) return { providerId: def.id, model: str };
    }
  } catch { /* ignore */ }
  return undefined;
}

/**
 * 解析 Hesi SSE（自定义格式 `data: {type, content}`），收集回复正文。
 * 同时把 stream() 需要的假 res 接口补全（write/on/end/writeHead/setHeader）。
 * @param {(c: string) => void} onTokenCb — 每收到一段 token 时回调
 * @returns {{ fakeRes: object, waitEnd: Promise<void> }}
 */
function createSseCollector(onTokenCb) {
  let doneResolve;
  const waitEnd = new Promise((resolve) => { doneResolve = resolve; });
  const collector = {
    ended: false,
    fakeRes: {
      writeHead() { /* ignore */ },
      setHeader() { /* ignore */ },
      write: (/** @type {string} */ chunk) => {
        try {
          const str = String(chunk);
          const lines = str.split('\n');
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            try {
              const obj = JSON.parse(payload);
              if (obj && obj.type === 'token' && typeof obj.content === 'string') {
                try { onTokenCb(obj.content); } catch { /* ignore */ }
              }
            } catch { /* 单帧解析失败忽略 */ }
          }
        } catch { /* ignore */ }
        return true;
      },
      end: () => {
        if (!collector.ended) {
          collector.ended = true;
          doneResolve();
        }
      },
      on: (/** @type {string} */ _ev, /** @type {Function} */ _cb) => {
        // 客户端断开回调由真实 res 负责；这里仅兼容 stream() 的 res.on('close')
        if (_ev === 'close' && typeof _cb === 'function') collector._closeCb = _cb;
        return collector.fakeRes;
      },
      statusCode: 200,
      setTimeout() { /* ignore */ },
      getHeaders: () => ({}),
      flushHeaders() { /* ignore */ },
    },
  };
  return { fakeRes: collector.fakeRes, waitEnd };
}

/**
 * 把收集到的正文按 OpenAI 标准格式写回客户端。
 * @param {import('express').Response} res
 * @param {{ model: string, text: string, stream: boolean, providerId?: string, reasoning?: string }} opts
 */
function writeOpenAiResponse(res, { model, text, stream }) {
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const content = text || '';
  recordUsage(model, content.length);
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    const chunk = (delta) => {
      res.write(`data: ${JSON.stringify({
        id, object: 'chat.completion.chunk', created, model,
        choices: [{ index: 0, delta, finish_reason: null }],
      })}\n\n`);
    };
    // 先发 role 帧再发内容（OpenAI SDK 兼容）
    chunk({ role: 'assistant', content: '' });
    for (let i = 0; i < content.length; i += 64) {
      chunk({ content: content.slice(i, i + 64) });
    }
    chunk({});
    res.write(`data: ${JSON.stringify({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    res.json({
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: content.length, total_tokens: content.length },
    });
  }
}

/** 统一路由分发（gateway.js 一个 handler 服务多个端点）。 */
async function gatewayHandler(req, res) {
  const urlPath = (req.path || '').replace(/\/+$/, '');

  // ── GET /v1/models ─────────────────────────────────────────
  if (req.method === 'GET' && urlPath.endsWith('/v1/models')) {
    try {
      const { getAllDefs } = require('../../../lib/llm-provider/provider-config');
      const { getConfig } = require('../../../lib/llm-provider/provider-config');
      const out = [];
      for (const def of getAllDefs()) {
        const cfg = getConfig(def.id);
        const models = (cfg.model ? [cfg.model] : []).concat(def.models || []);
        // 显式路由别名：provider/model
        out.push(...models.map((m) => ({ id: m, object: 'model', owned_by: def.id })));
        out.push(...models.map((m) => ({ id: `${def.id}/${m}`, object: 'model', owned_by: def.id })));
      }
      // 去重
      const seen = new Set();
      const unique = out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
      return res.json({ object: 'list', data: unique });
    } catch (err) {
      return res.status(500).json({ error: (err && err.message) || String(err) });
    }
  }

  // ── GET /health ────────────────────────────────────────────
  if (req.method === 'GET' && urlPath.endsWith('/health')) {
    try {
      const { healthAll } = require('../../../lib/llm-provider/provider-health');
      const health = await healthAll();
      const configured = health.filter((h) => h.status === 'ok' || h.status === 'degraded').length;
      return res.json({ ok: true, plugin: 'hesi-switch', configuredProviders: configured, health });
    } catch (err) {
      return res.status(500).json({ ok: false, error: (err && err.message) || String(err) });
    }
  }

  // ── POST /v1/chat/completions ──────────────────────────────
  if (req.method === 'POST' && urlPath.endsWith('/v1/chat/completions')) {
    const auth = checkAuth(req);
    if (!auth.ok) return res.status(401).json({ error: auth.error });
    let body;
    try {
      body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.rawBody || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    const model = String(body.model || '');
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) return res.status(400).json({ error: 'messages is required' });
    const stream = !!body.stream;

    const routed = resolveProviderFromModel(model);
    try {
      const { stream: llmStream } = require('../../../lib/llm-provider/provider-client');
      let text = '';
      const { fakeRes, waitEnd } = createSseCollector((c) => { text += c; });

      // stream() 会异步写 fakeRes（Hesi SSE），我们收集 token 后统一按 OpenAI 格式返回。
      const result = await llmStream({
        providerId: routed ? routed.providerId : undefined,
        model: routed ? routed.model : (model || undefined),
        messages,
        // 注意：网关忽略外部 tools——Hesi 工具链与外部 Agent 的 schema 不同，
        // 保持纯文本对话（外部工具由外部 Agent 自己处理）。
        tools: undefined,
        res: fakeRes,
        req,
        reasoningEffort: body.reasoningEffort,
      });
      // 等待 stream 内部写完（end 触发）
      await Promise.race([waitEnd, new Promise((r) => { setTimeout(r, 120000); })]);

      if (!result.ok) {
        const errMsg = result.error || 'LLM request failed';
        if (stream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.write(`data: ${JSON.stringify({ error: { message: errMsg, type: 'provider_error' } })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          return res.status(502).json({ error: { message: errMsg, type: 'provider_error' } });
        }
        return;
      }

      writeOpenAiResponse(res, { model, text, stream });
    } catch (err) {
      const errMsg = (err && err.message) || String(err);
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.write(`data: ${JSON.stringify({ error: { message: errMsg, type: 'internal_error' } })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        return res.status(500).json({ error: { message: errMsg, type: 'internal_error' } });
      }
    }
    return;
  }

  return res.status(404).json({ error: 'hesi-switch: unknown endpoint' });
}

module.exports = gatewayHandler;
