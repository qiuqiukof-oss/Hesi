/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// AI Chat API — frontend communication layer
// Handles SSE streaming, API key management, provider switching
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

import { safeStorage, safeSession } from './lib/storage.js';
import { CryptoStore } from './lib/crypto-store.js';
import { Personalization } from './app/personalization.js';

const AI_KEY = 'qcli-ai-key';

export const ChatAPI = {
    // ── API Key Management ──
    // Hesi runs locally on loopback only. The API key is encrypted with
    // Web Crypto (AES-GCM, non-exportable IndexedDB key) before persisting
    // to localStorage — plaintext only lives in memory for the current tab
    // session. A one-time migration lifts a legacy plaintext key from
    // localStorage/sessionStorage, encrypts it, and removes the plaintext copy.

    /** Get stored API key (decrypt from localStorage; legacy plaintext migration) */
    async getApiKey() {
      const ok = await CryptoStore.ready();
      const fromStorage = safeStorage.get(AI_KEY, '');
      if (fromStorage) {
        // Legacy: plaintext key stored before v0.7.x crypto upgrade
        if (!fromStorage.startsWith('aes:')) {
          if (ok) {
            const ct = await CryptoStore.encrypt(fromStorage);
            safeStorage.set(AI_KEY, 'aes:' + ct);
          }
          return fromStorage;
        }
        // v0.7+: encrypted key
        if (ok) return await CryptoStore.decrypt(fromStorage.slice(4));
        return ''; // crypto unavailable → can't decrypt
      }
      const fromSession = safeSession.get(AI_KEY, '');
      if (fromSession) {
        safeSession.remove(AI_KEY);
        if (ok) {
          const ct = await CryptoStore.encrypt(fromSession);
          safeStorage.set(AI_KEY, 'aes:' + ct);
        } else {
          safeStorage.set(AI_KEY, fromSession); // fallback: plaintext
        }
        return fromSession;
      }
      return '';
    },

    /** Store API key (encrypt via Web Crypto, persist to localStorage) */
    async setApiKey(key) {
      safeSession.remove(AI_KEY);
      if (!key) { safeStorage.remove(AI_KEY); return; }
      const ok = await CryptoStore.ready();
      if (ok) {
        const ct = await CryptoStore.encrypt(key);
        safeStorage.set(AI_KEY, 'aes:' + ct);
      } else {
        // Graceful fallback: plaintext localStorage (browser lacks Web Crypto)
        safeStorage.set(AI_KEY, key);
      }
    },

    /** Get stored provider */
    getProvider() {
      return safeStorage.get('qcli-ai-provider', 'openai');
    },

    /** Store provider */
    setProvider(provider) {
      safeStorage.set('qcli-ai-provider', provider);
    },

    /** Get stored model name */
    getModel() {
      return safeStorage.get('qcli-ai-model', '');
    },

    /** Store model name */
    setModel(model) {
      safeStorage.set('qcli-ai-model', model);
    },

    /** Get stored planning/verify-mode model (optional, stronger reasoning model) */
    getPlanModel() {
      return safeStorage.get('qcli-ai-model-plan', '');
    },

    /** Store planning/verify-mode model */
    setPlanModel(model) {
      safeStorage.set('qcli-ai-model-plan', model);
    },

    /** Get stored API base URL (OpenAI-compatible) */
    getBaseUrl() {
      return safeStorage.get('qcli-ai-base-url', '');
    },

    /** Store API base URL */
    setBaseUrl(url) {
      safeStorage.set('qcli-ai-base-url', url);
    },

    /**
     * Check if AI is configured.
     * Returns true if:
     *  - Server env vars are set, OR
     *  - An API key is stored, OR
     *  - A custom base URL is set (for local/self-hosted models like Ollama)
     */
    async isConfigured() {
      try {
        const resp = await fetch('/api/chat/status');
        if (resp.ok) {
          const data = await resp.json();
          if (data.configured) return true;
        }
      } catch (e) { /* ignore */ }
      // Allow local/self-hosted APIs without a key
      if (!!(await this.getApiKey())) return true;
      if (!!this.getBaseUrl()) return true;
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
     * @param {string} [options.terminalContext] - Current terminal buffer content for AI context
     * @param {boolean} [options.terminalContextChanged] - Whether terminal content has changed since last message
     * @param {AbortSignal} [options.signal] - Optional abort signal
     */
    async sendMessage({ messages, onToken, onDone, onError, onStatus, onToolCall, onToolLive, onUsage, onAgentMetrics, terminalContext, terminalContextChanged, signal, discuss, partner, partners, maxTurns, onDiscuss, sessionId, category, verifyMode, takenOver, planMode, planAgentId, onPlan }) {
      const apiKey = await this.getApiKey();
      const provider = this.getProvider();
      let model = this.getModel();
      if (verifyMode) { const pm = this.getPlanModel(); if (pm) model = pm; }
      const baseUrl = this.getBaseUrl();

      try {
        const body = {
          messages,
          sessionId: sessionId || undefined,
          apiKey: apiKey || undefined,
          provider: provider || undefined,
          model: model || undefined,
          baseUrl: baseUrl || undefined,
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
        }
        if (terminalContext) {
          body.terminalContext = terminalContext;
          body.terminalContextChanged = terminalContextChanged === true;
        }
        if (category) body.category = category;
        if (verifyMode) body.verifyMode = verifyMode;

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
                  // Error is final — stop reading stream to prevent double-fire with onDone
                  reader.cancel().catch(() => {});
                  return;
                }
              } catch (e) {
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
