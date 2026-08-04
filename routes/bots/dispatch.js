/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Bot Dispatch — forward a bot task into the Hesi chat session
//
// 任务派发：把统一 inbound 组装成 /api/chat 请求体，经内部 HTTP 转发到
// 现有 chat 会话（复用 LLM/Plan 全链路，不新建执行引擎——反臃肿红线）。
//
// 设计取舍：
// - 内部转发走本机 HTTP（127.0.0.1:{getPort()}），与前端同路径，天然复用
//   chatLimiter / 流式 / 审批等全部既有行为；
// - 失败时返回结构化错误，由调用方（平台适配器）回传用户；
// - 长任务（planMode）由 chat 的 SSE 流处理，这里只负责「提交」，
//   完成回传见 adapter 层异步订阅方案（M4）。
// ============================================================
const { getPort } = require('../../lib/port');

const DEFAULT_TIMEOUT_MS = 120000; // 同步短任务 2min；planMode 走 SSE 不在此限

/**
 * 派发一条 bot 消息到 Hesi chat 会话。
 * @param {object} inbound — normalizeInbound 的输出
 * @param {{ model?: string, provider?: string, apiKey?: string, planMode?: boolean, sessionId?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<{ ok: boolean, reply: string, status?: number, error?: string }>}
 */
async function dispatchToChat(inbound, opts = {}) {
  const body = buildRequest(inbound, opts);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${getPort()}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, reply: '', status: res.status, error: text.slice(0, 500) || `HTTP ${res.status}` };
    }
    // /api/chat 返回 SSE 流（正文在 type:'token' 事件）——不能用 res.json() 解析
    // （bug 修复 2026-08-04：修复前恒回"✅ 已受理"，机器人模式拿不到 AI 回复）。
    const reply = await collectSseReply(res);
    return { ok: true, reply, status: 200 };
  } catch (err) {
    return { ok: false, reply: '', error: err && err.name === 'AbortError' ? 'bot: dispatch timeout' : (err && err.message) || String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 读取 /api/chat 的 SSE 流，收集所有 type:'token' 正文片段拼成完整回复。
 * @param {Response} res
 * @returns {Promise<string>}
 */
async function collectSseReply(res) {
  const reader = res.body && res.body.getReader();
  if (!reader) return '✅ 已受理';
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let done = false;
  while (!done) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const payload = trimmed.slice(6).trim();
      if (payload === '[DONE]') { done = true; break; }
      try {
        const evt = JSON.parse(payload);
        if (evt && evt.type === 'token' && typeof evt.content === 'string') {
          reply += evt.content;
        } else if (evt && evt.type === 'error' && evt.message) {
          reply += (reply ? '\n' : '') + `⚠️ ${evt.message}`;
        }
      } catch { /* 非 JSON 帧忽略 */ }
    }
  }
  return reply.trim() || '✅ 已受理';
}

/**
 * 组装 /api/chat 请求体（复用 adapter.buildChatRequest 的逻辑，这里独立成函数
 * 避免循环依赖：adapter 是纯转换，dispatch 负责调用）。
 * @param {object} inbound
 * @param {object} [opts]
 * @returns {object}
 */
function buildRequest(inbound, opts = {}) {
  return {
    messages: [{ role: 'user', content: inbound.text }],
    model: opts.model,
    provider: opts.provider || inbound.provider,
    apiKey: opts.apiKey,
    planMode: opts.planMode === true,
    sessionId: opts.sessionId || `bot:${inbound.platform}:${inbound.chatId}`,
  };
}

module.exports = { dispatchToChat, buildRequest, collectSseReply };
