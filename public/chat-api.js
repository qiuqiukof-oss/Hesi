/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// AI Chat API — frontend communication layer
// Handles SSE streaming. C 净化版（v0.8.0）：API Key / provider /
// baseUrl / 模型统一由后端「模型服务」配置（env 优先 + data 文件覆盖），
// 前端不再存储/透传 key——浏览器不碰 key，彻底消除双存储冲突。
// 前端仅保留「规划/核查专用模型」与「推理强度」两个非敏感选择。
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

import { Personalization } from './app/personalization.js';
import { safeStorage, safeSession } from './lib/storage.js';

/** 读取 localStorage 字符串（带异常兜底）。@param {string} k @param {string} d */
function safeStorageGet(k, d) {
  try { return safeStorage.get(k, d); } catch { return d; }
}
/** 删除 localStorage 项（带异常兜底）。@param {string} k */
function safeStorageRemove(k) {
  try { safeStorage.remove(k); } catch { /* ignore */ }
}

export const ChatAPI = {
    // ── 配置状态（C 净化版：全部由后端 /api/chat/status 判定）──

    /** @deprecated v0.8.0 起浏览器不再存 key；返回空串（兼容旧调用方） */
    async getApiKey() {
      return '';
    },

    /** @deprecated v0.8.0 起 key 全走后端；清除遗留存储（若有） */
    async setApiKey(key) {
      if (!key) { safeStorageRemove('qcli-ai-key'); safeSession.remove('qcli-ai-key'); }
    },

    /** @deprecated v0.8.0 起 provider 由后端决定；返回空（后端自动选择） */
    getProvider() {
      return '';
    },

    /** @deprecated v0.8.0 no-op（provider 由后端决定） */
    setProvider() { /* no-op */ },

    /** @deprecated v0.8.0 起默认模型由后端决定；返回空（后端用 provider-config.model） */
    getModel() {
      return '';
    },

    /** @deprecated v0.8.0 no-op（默认模型由后端决定） */
    setModel() { /* no-op */ },

    /** Get stored planning/verify-mode model (optional, stronger reasoning model) */
    getPlanModel() {
      return safeStorageGet('qcli-ai-model-plan', '');
    },

    /** Store planning/verify-mode model */
    setPlanModel(model) {
      if (model) safeStorage.set('qcli-ai-model-plan', String(model));
      else safeStorageRemove('qcli-ai-model-plan');
    },

    /** @deprecated v0.8.0 起 baseUrl 由后端 provider-config 决定；返回空 */
    getBaseUrl() {
      return '';
    },

    /** @deprecated v0.8.0 no-op */
    setBaseUrl() { /* no-op */ },

    /**
     * Check if AI is configured（后端事实源：/api/chat/status 基于 provider-config）。
     */
    async isConfigured() {
      try {
        const resp = await fetch('/api/chat/status');
        if (resp.ok) {
          const data = await resp.json();
          return !!data.configured;
        }
      } catch { /* ignore */ }
      return false;
    },

    // ── Streaming Chat ──

    /**
     * Send a chat message and stream the response.
     *
     * @param {object} options
     * @param {Array<{role:string,content:string}>} options.messages - Chat history
     * @param {function(string)} options.onToken - Called with each token
     * @param {function()} options.onDone - Called when stream completes
     * @param {function(string)} options.onError - Called on error
     * @param {function(string)} options.onStatus - Called on status updates (e.g. tool calls)
     * @param {function(object)} options.onToolCall - Called with {type:'start'|'end', name, durMs, names, truncated}
     * @param {function(object)} options.onToolLive - Called with agent live events ({ev, agent, data, question, ...}) during long tool runs
     * @param {function(object)} options.onUsage - Called with {input_tokens, output_tokens} or {prompt_tokens, completion_tokens, total_tokens}
     * @param {function(object)} [options.onAgentMetrics] - M5 (v0.3.1): Called once at round end with {cacheReadTokens, cacheCreationTokens, toolCacheHits, experienceHits, skillsInjected}
     * @param {function(string)} [options.onReasoning] - L1 (v0.7.4): Called with each reasoning/thinking chunk (inference models like DeepSeek-R1 / Qwen3 / o-series / Claude extended-thinking)
     * @param {string} [options.reasoningEffort] - L3 (v0.7.5): 推理强度 'off' | 'standard' | 'deep'，透传给后端按 provider+model 映射为原生参数
     * @param {string} [options.terminalContext] - Current terminal buffer content for AI context
     * @param {boolean} [options.terminalContextChanged] - Whether terminal content has changed since last message
     * @param {AbortSignal} [options.signal] - Optional abort signal
     */
    async sendMessage({ messages, onToken, onDone, onError, onStatus, onToolCall, onToolLive, onUsage, onAgentMetrics, onReasoning, reasoningEffort, terminalContext, terminalContextChanged, signal, discuss, partner, partners, maxTurns, onDiscuss, sessionId, category, verifyMode, takenOver, planMode, planAgentId, fullAccess, onPlan, keepStreamOnError }) {
      // C 净化版（v0.8.0）：不再读取浏览器 key/provider/model/baseUrl——
      // 全部由后端「模型服务」配置决定。前端仅透传：
      //  - verifyMode 时的「规划/核查专用模型」（模型名，非敏感）
      //  - 推理强度 reasoningEffort（每次请求即时覆盖，无冲突）
      let model;
      if (verifyMode) { const pm = this.getPlanModel(); if (pm) model = pm; }

      try {
        const body = {
          messages,
          sessionId: sessionId || undefined,
          model: model || undefined,
        };
        if (discuss) {
          body.discuss = true;
          const list = Array.isArray(partners) && partners.length ? partners : (partner ? [partner] : []);
          body.partner = list[0] || undefined;
          if (list.length) body.partners = list;
          body.maxTurns = maxTurns || undefined;
          // P2.5 落座接管：把人工提交的席位文本透传给讨论内核（内核跳过该席位自动生成）
          if (takenOver && typeof takenOver === 'object' && Object.keys(takenOver).length) body.takenOver = takenOver;
        }
        // 「⚡ 自动执行」模式（P2）：与讨论并列的第三种回合，后端走 runPlanTurn。
        // 两者互斥由 UI 保证；万一同时为真，后端讨论优先（见 routes/chat/index.js）。
        if (planMode) {
          body.planMode = true;
          if (planAgentId) body.agentId = planAgentId;
          if (fullAccess) body.fullAccess = true;
        }
        if (terminalContext) {
          body.terminalContext = terminalContext;
          body.terminalContextChanged = terminalContextChanged === true;
        }
        if (category) body.category = category;
        if (verifyMode) body.verifyMode = verifyMode;
        // L3 (v0.7.5): 推理强度档位透传；后端按 provider+model 二次过滤，不支持的模型静默忽略
        if (reasoningEffort) body.reasoningEffort = reasoningEffort;

        // 个性化设置（Persona / Role / Custom Instructions / Memory / Permissions / Language）
        // 与 verifyMode 同源：前端 localStorage → 请求体 → 后端拼系统提示词。
        const persona = Personalization.getPersona();
        if (persona && persona !== 'balanced') body.persona = persona;
        const role = Personalization.getRole();
        if (role && role !== 'default') body.role = role;
        const ci = Personalization.getCustomInstructions();
        if (ci) body.customInstructions = ci;
        if (!Personalization.getMemoryEnabled()) body.memoryEnabled = false;
        body.permissions = Personalization.getPermissions();
        const lang = Personalization.getLanguage();
        if (lang && lang !== 'auto') body.language = lang;

        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
          if (err.needsKey) {
            onError?.('NEEDS_KEY');
          } else {
            onError?.(err.error || `Request failed (${resp.status})`);
          }
          return;
        }

        // Read SSE stream
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            if (trimmed === 'data: [DONE]') {
              onDone?.();
              return;
            }

            if (trimmed.startsWith('data: ')) {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                if (parsed.type === 'token') {
                  onToken?.(parsed.content);
                } else if (parsed.type === 'reasoning') {
                  onReasoning?.(parsed.content);
                } else if (parsed.type === 'status') {
                  onStatus?.(parsed.message);
                } else if (parsed.type === 'discuss_start') {
                  onDiscuss?.({ type: 'start', speaker: parsed.speaker, label: parsed.label, round: parsed.round });
                } else if (parsed.type === 'discuss_end') {
                  onDiscuss?.({ type: 'end', speaker: parsed.speaker });
                } else if (parsed.type === 'discuss_stats') {
                  onDiscuss?.({ type: 'stats', stats: parsed.stats });
                } else if (typeof parsed.type === 'string' && parsed.type.startsWith('plan_')) {
                  // 「⚡ 自动执行」事件：统一剥掉 plan_ 前缀后交给渲染层分流
                  onPlan?.({ ...parsed, type: parsed.type.slice(5) });
                } else if (parsed.type === 'tool_call_start') {
                  onToolCall?.({ type: 'start', names: parsed.names });
                  onStatus?.(`🔧 正在调用: ${(parsed.names || []).join(', ')}`);
                } else if (parsed.type === 'tool_call_end') {
                  onToolCall?.({ type: 'end', name: parsed.name, durMs: parsed.durMs, truncated: parsed.truncated, result: parsed.result });
                  onStatus?.(`✅ ${parsed.name} 完成 (${parsed.durMs}ms${parsed.truncated ? ', 结果较长' : ''})`);
                } else if (parsed.type === 'usage') {
                  onUsage?.(parsed.usage);
                } else if (parsed.type === 'tool_live') {
                  // Agent 实时输出/回呼，转发给上层以减少“卡住/断开”错觉
                  onToolLive?.(parsed.payload);
                } else if (parsed.type === 'agent_metrics') {
                  // M5 (v0.3.1): 轮末结算的用量收益指标，转发给上层渲染收益条
                  onAgentMetrics?.(parsed.data);
                } else if (parsed.type === 'error') {
                  // Pass structured error info: detect timeout / rate-limit from message
                  const errMsg = parsed.message || 'Unknown error';
                  const isTimeout = errMsg.toLowerCase().includes('timeout') || errMsg.includes('60s');
                  const isRateLimit = errMsg.startsWith('RATE_LIMIT: ');
                  onError?.({
                    type: isTimeout ? 'timeout' : (isRateLimit ? 'rate_limit' : 'stream_error'),
                    message: isRateLimit ? errMsg.slice('RATE_LIMIT: '.length) : errMsg,
                  });
                  // Fix #3: 协作流（planMode）下 error 是业务级事件（如"未配置 API Key"），
                  // 不应 cancel reader + return —— 后续 plan_error / plan_done 必须继续到达前端，
                  // 否则执行卡片永远卡在"执行中"（球总实测"停不下来"根因）。
                  if (keepStreamOnError) return;
                  // Error is final — stop reading stream to prevent double-fire with onDone
                  reader.cancel().catch(() => {});
                  return;
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        }

        onDone?.();
      } catch (err) {
        if (err.name === 'AbortError') {
          onDone?.();
        } else {
          onError?.(err.message);
        }
      }
    },
  };

  // Expose globally for app.js to use
  window.QCLI = window.QCLI || {};
  window.QCLI.ChatAPI = ChatAPI;
