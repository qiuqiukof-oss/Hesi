'use strict';

// ============================================================
// 推理强度控制（L3, v0.7.5）—— 模型识别 + 三档抽象映射
//
// 前后端共用同一份识别逻辑：本文件供后端各 stream 模块 require；
// 前端同源逻辑在 public/lib/reasoning-config.js（挂 window.QCLI.ReasoningConfig）。
// 保持两份同步，避免前端显示开关却后端不识别（或反之）导致误传参数 400。
//
// 三档抽象：
//   'off'      关闭推理（对支持开关的模型禁用 reasoning / thinking）
//   'standard' 默认推理强度（不额外注入参数，模型按默认思考）
//   'deep'     更强推理（分配更多思考预算）
// ============================================================

// 运行时应急门控：HESI_REASONING_CONTROL=0 时所有注入逻辑短路，
// 行为完全回退到 v0.7.4（UI 也应隐藏开关，见前端同源判断）。
const CONTROL_ENABLED = process.env.HESI_REASONING_CONTROL !== '0';

/**
 * 判断给定 provider+model 是否支持深度思考（可显示强度开关）。
 * @param {string} provider
 * @param {string} model
 * @returns {'openai-reasoning'|'local-thinking'|'anthropic'|false}
 */
function supportsReasoning(provider, model) {
  if (!CONTROL_ENABLED) return false;
  const m = (model || '').toLowerCase();
  const p = (provider || '').toLowerCase();

  // Anthropic 扩展思考族
  if (p === 'anthropic' && /claude[- ]?3[- ]?(5|7|sonnet|opus)/.test(m)) return 'anthropic';
  // OpenAI o-series / o1 / o3 / o4-mini ...
  if (/\bo[1-9]/.test(m)) return 'openai-reasoning';
  // DeepSeek 官方推理模型
  if (/deepseek[- ]?r1|deepseek[- ]?reasoner/.test(m)) return 'openai-reasoning';
  // Qwen3 / OpenAI 兼容本地推理模型（LM Studio / vLLM 等）
  if (/qwen3/.test(m)) return 'local-thinking';

  return false;
}

/**
 * 按 provider+model+档位 生成要合并进请求体的原生参数；不支持或无需注入则返回 null。
 * @param {string} provider
 * @param {string} model
 * @param {string} effort  'off' | 'standard' | 'deep'
 * @param {number} [maxTokens]  本次请求的 max_tokens（Anthropic budget 必须小于它）
 * @returns {object|null}
 */
function buildReasoningParams(provider, model, effort, maxTokens) {
  if (!CONTROL_ENABLED) return null;
  if (!effort || effort === 'standard') return null; // 标准档：不注入，让模型按默认强度

  const kind = supportsReasoning(provider, model);
  if (!kind) return null; // 不支持的模型：静默忽略，避免 400

  // ── OpenAI o-series / DeepSeek 官方：reasoning_effort 三档枚举 ──
  if (kind === 'openai-reasoning') {
    if (effort === 'off') return null; // 不设置即关闭
    return { reasoning_effort: effort === 'deep' ? 'high' : 'medium' };
  }

  // ── Qwen3 / OpenAI 兼容本地：enable_thinking 布尔 + 尽力 reasoning_effort ──
  if (kind === 'local-thinking') {
    if (effort === 'off') return { enable_thinking: false };
    const params = { enable_thinking: true };
    if (effort === 'deep') params.reasoning_effort = 'high';
    return params;
  }

  // ── Anthropic Claude 扩展思考：thinking.budget_tokens ──
  if (kind === 'anthropic') {
    if (effort === 'off') return null; // 不带 thinking 即关闭
    const cap = Number(maxTokens) || 8192;
    const std = Number(process.env.HESI_REASONING_BUDGET_STD) || 4000;
    const deep = Number(process.env.HESI_REASONING_BUDGET_DEEP) || 16000;
    const raw = effort === 'deep' ? deep : std;
    // budget 必须 < max_tokens，至少保留 1024 给最终输出（R6）
    const budget = Math.max(1024, Math.min(raw, cap - 1024));
    return { thinking: { type: 'enabled', budget_tokens: budget } };
  }

  return null;
}

module.exports = { supportsReasoning, buildReasoningParams, CONTROL_ENABLED };
