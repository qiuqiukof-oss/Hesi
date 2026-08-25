/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// index.js — Web Grounding 网关统一入口
//
// 设计要点（相对早期版本的关键修正）：
//   - 降噪在「抽取层」默认开启（extract-content.js），与输出格式解耦。
//     text 模式拿到的已是去噪后的正文/结果列表，不再是裸 body.innerText。
//   - 不另造 `_json` 平行工具；改用单个 format 参数（text|json，默认 text）。
//   - JSON 只是「结构化包装」选项：给下游代码/工具用时才需要字段化；
//     给 LLM 自己读，干净 text 往往比 JSON 更省 token（无键名重复/转义开销）。
// ============================================================

const { resolveTargetUrl, isUrl, getTemplate, assertPublicUrl } = require('./engine');
const { getSession } = require('./session');

// ── 结果缓存（短 TTL，避免重复查询重复真跑）───────────────────
// 键 = target|format|maxChars；缓存 promise 实现并发同键去重；
// 成功保留 TTL，失败即删。env HESI_WG_CACHE=0 关闭。
const CACHE_TTL = 60_000;
const _resultCache = new Map();
function cacheKey(target, opts) {
  return `${target}|${opts.format === 'json' ? 'json' : 'text'}|${opts.maxChars || 0}`;
}

/**
 * 统一读取入口。
 * @param {string} target 关键词或 URL
 * @param {object} [opts] { format, maxChars, settleMs, waitUntil, timeout }
 *   - format: 'text'（默认）或 'json'（结构化输出）
 *   - maxChars: 文本模式最大字符数（search 默认 6000，fetch 默认 12000）
 * @returns {Promise<object>}
 */
async function read(target, opts = {}) {
  const t = String(target || '').trim();
  const key = cacheKey(t, opts);
  const now = Date.now();

  // 缓存命中（未过期）
  const hit = _resultCache.get(key);
  if (hit && now - hit.at < CACHE_TTL) {
    return hit.promise;
  }
  if (hit) _resultCache.delete(key); // 过期清理

  const promise = _doRead(t, opts);
  _resultCache.set(key, { at: now, promise });
  promise.catch(() => _resultCache.delete(key)); // 失败不缓存
  return promise;
}

async function _doRead(target, opts = {}) {
  const started = Date.now();
  try {
    const t = String(target || '').trim();
    if (!t) return { ok: false, error: 'target 为空', elapsedMs: Date.now() - started };

    const format = opts.format === 'json' ? 'json' : 'text';
    const url = resolveTargetUrl(t);
    const engine = getTemplate();
    const session = getSession();
    const mode = isUrl(t) ? 'fetch' : 'search';
    // 默认输出量（token 友好）：search 2500 字符 ≈ 前 8 条结果；fetch 5000 字符 ≈ 正文核心段。
    // 需要更多时用 maxChars 显式放大（如 fetch 全文 12000）。
    const maxChars = opts.maxChars || (mode === 'search' ? 2500 : 5000);

    // SSRF 防护：fetch 任意 URL 前校验必须指向公网（拒绝内网/回环/保留段）
    if (mode === 'fetch') {
      try {
        await assertPublicUrl(url);
      } catch (e) {
        return { ok: false, error: e.message, elapsedMs: Date.now() - started };
      }
    }

    const raw = await session.read(url, {
      waitUntil: opts.waitUntil || 'domcontentloaded',
      timeout: opts.timeout || 20000,
      mode,
      settleBudget: opts.settleBudget || 8000,
    });
    const elapsedMs = Date.now() - started;

    // 验证码/风控页：明确报错而非静默空结果（防止 AI 把"被拦截"当"无结果"）
    if (raw.captcha) {
      return {
        ok: false,
        error: '目标页面疑似触发验证码/风控拦截，请稍后重试或检查浏览器指纹（headless 特征）',
        elapsedMs,
      };
    }

    const structured = raw.structured;

    // ── JSON 模式：直接返回结构化对象（不包一层大文本）──
    if (format === 'json') {
      const base = {
        ok: true,
        format: 'json',
        mode,
        engineSource: engine.source,
        url: raw.url,
        rawChars: raw.rawChars,
        elapsedMs,
      };
      if (mode === 'search') {
        return { ...base, count: structured.length, results: structured };
      }
      return {
        ...base,
        title: structured.title,
        description: structured.description,
        content: structured.content.slice(0, maxChars),
        links: structured.links,
        chars: structured.content.slice(0, maxChars).length,
      };
    }

    // ── 文本模式：默认返回去噪后的可读文本 ──
    if (mode === 'search') {
      const list = structured
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? '\n   ' + r.snippet : ''}`)
        .join('\n\n');
      const text = list.slice(0, maxChars);
      return {
        ok: true,
        format: 'text',
        mode,
        engineSource: engine.source,
        url: raw.url,
        title: '',
        text,
        rawChars: raw.rawChars,
        chars: text.length,
        elapsedMs,
      };
    }
    const s = structured;
    const text = (s.content || '').slice(0, maxChars);
    return {
      ok: true,
      format: 'text',
      mode,
      engineSource: engine.source,
      url: raw.url,
      title: s.title,
      text,
      links: s.links,
      rawChars: raw.rawChars,
      chars: text.length,
      elapsedMs,
    };
  } catch (err) {
    return {
      ok: false,
      error: err && err.message ? err.message : String(err),
      elapsedMs: Date.now() - started,
    };
  }
}

/**
 * 状态探测（不强制拉起浏览器，避免副作用）。
 */
function status() {
  try {
    const s = getSession();
    return {
      ok: true,
      ready: s.ready,
      note: s.ready ? 'worker 页就绪（常驻）' : '未初始化（首次 read 时自动拉起浏览器）',
    };
  } catch (err) {
    return { ok: false, ready: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = { read, status, resolveTargetUrl, isUrl, getTemplate };
