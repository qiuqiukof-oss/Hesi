// @ts-check
// ============================================================
// AI Chat API — frontend communication layer
// Handles SSE streaming, API key management, provider switching
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

import { safeStorage, safeSession } from './lib/storage.js';

const AI_KEY = 'qcli-ai-key';

export const ChatAPI = {
    // ── API Key Management ──
    // Hesi runs locally on loopback only, so the API key is persisted in
    // localStorage (survives browser restart) instead of sessionStorage
    // (cleared on close). A one-time migration lifts any key left in
    // sessionStorage into localStorage so an already-entered key isn't lost.

    /** Get stored API key (localStorage, with sessionStorage migration) */
    getApiKey() {
      const fromStorage = safeStorage.get(AI_KEY, '');
      if (fromStorage) return fromStorage;
      const fromSession = safeSession.get(AI_KEY, '');
      if (fromSession) {
        safeStorage.set(AI_KEY, fromSession);
        safeSession.remove(AI_KEY);
        return fromSession;
      }
      return '';
    },

    /** Store API key in localStorage (persisted across browser restarts) */
    setApiKey(key) {
      safeStorage.set(AI_KEY, key);
      safeSession.remove(AI_KEY);
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
      if (!!this.getApiKey()) return true;
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
     * @param {string} [options.terminalContext] - Current terminal buffer content for AI context
     * @param {boolean} [options.terminalContextChanged] - Whether terminal content has changed since last message
     * @param {AbortSignal} [options.signal] - Optional abort signal
     */
    async sendMessage({ messages, onToken, onDone, onError, onStatus, onToolCall, onToolLive, onUsage, terminalContext, terminalContextChanged, signal, discuss, partner, partners, maxTurns, onDiscuss, sessionId }) {
      const apiKey = this.getApiKey();
      const provider = this.getProvider();
      const model = this.getModel();
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
        }
        if (terminalContext) {
          body.terminalContext = terminalContext;
          body.terminalContextChanged = terminalContextChanged === true;
        }

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
