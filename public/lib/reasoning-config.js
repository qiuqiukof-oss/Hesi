/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 推理强度控制（L3, v0.7.5）—— 前端配置层
//
// 与后端 routes/chat/reasoning-config.js 同源识别逻辑（手动保持同步）。
// 挂到 window.QCLI.ReasoningConfig，供 chat-panel.js / boot.js 在运行时读取。
// ============================================================

const STORAGE_KEY = 'hesi.reasoningEffort';

/**
 * 判断 provider+model 是否支持深度思考（决定设置面板是否显示强度开关）。
 * 必须与后端 supportsReasoning 保持一致。
 * @param {string} provider
 * @param {string} model
 * @returns {'openai-reasoning'|'local-thinking'|'anthropic'|false}
 */
function supportsReasoning(provider, model) {
  const m = (model || '').toLowerCase();
  const p = (provider || '').toLowerCase();
  if (p === 'anthropic' && /claude[- ]?3[- ]?(5|7|sonnet|opus)/.test(m)) return 'anthropic';
  if (/\bo[1-9]/.test(m)) return 'openai-reasoning';
  if (/deepseek[- ]?r1|deepseek[- ]?reasoner/.test(m)) return 'openai-reasoning';
  if (/qwen3/.test(m)) return 'local-thinking';
  return false;
}

/** 读取持久化的推理强度；默认 'standard'。 */
function getReasoningEffort() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'off' || v === 'standard' || v === 'deep' ? v : 'standard';
  } catch {
    return 'standard';
  }
}

/** 保存推理强度到 localStorage。 */
function setReasoningEffort(v) {
  try {
    if (v === 'off' || v === 'standard' || v === 'deep') localStorage.setItem(STORAGE_KEY, v);
  } catch { /* ignore */ }
}

const ReasoningConfig = { supportsReasoning, getReasoningEffort, setReasoningEffort };
if (typeof window !== 'undefined') {
  window.QCLI = window.QCLI || {};
  window.QCLI.ReasoningConfig = ReasoningConfig;
}

export { supportsReasoning, getReasoningEffort, setReasoningEffort, ReasoningConfig };
