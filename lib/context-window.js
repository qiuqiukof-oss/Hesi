// @ts-check
// ============================================================
// P1 S1 — 上下文窗口治理：ContextWindowManager
//
// 根治「幽灵截断」的两类表现：
//   ① 本地小模型 max_tokens 写死 32768 → length 截断（写百字就断）
//   ② tokenEstimate 漏算 system+记忆+技能+工具+附件 → 压缩永不触发
//
// 三层策略：
//   Layer①  HESI_EFFECTIVE_CONTEXT（手动，最高优先级，最可靠兜底）
//   Layer②  模型名 → 有效窗口映射表（含 local-model 保守回退）
//   Layer③  （暂缓）被动探测 usage.prompt_tokens，初始仍可能卡，本期不做
//
// 派生：
//   compactThreshold = min(HESI_COMPACT_THRESHOLD || 60000, 窗口 × 0.5)
//   maxOutputTokens  = min(32768, 窗口 × 0.8)
//
// 回退保证：不设任何 env、且模型名未命中映射表时，
//   窗口取 200000 → compactThreshold=60000、maxOutputTokens=32768，
//   与 v0.3.1 现状**完全一致**，零行为变化。
// ============================================================
'use strict';

// Layer② 模型名 → 有效上下文窗口（token）。
// 仅收录已知「小窗口」模型；数值取保守有效窗口（非厂商标称总窗口，预留系统/历史余量）。
// 未列出者走 Layer① 或默认大窗口回退（视为云端大模型）。
const MODEL_CONTEXT_MAP = {
  // 本地常见小模型（保守估计，避免标称值过满导致截断）
  'qwen2.5-0.5b': 16000,
  'qwen2.5-1.5b': 24000,
  'qwen2.5-3b': 32000,
  'qwen2.5-7b': 48000,
  'qwen2.5-14b': 64000,
  'qwen2-0.5b': 16000,
  'qwen2-1.5b': 24000,
  'qwen2-7b': 48000,
  'llama-3.1-8b': 48000,
  'llama3.1-8b': 48000,
  'llama-3.2-1b': 16000,
  'llama-3.2-3b': 24000,
  'mistral-7b': 48000,
  'phi-3-mini': 24000,
  'phi-3.5-mini': 24000,
  'deepseek-r1-distill-qwen-1.5b': 24000,
  'deepseek-r1-distill-llama-8b': 48000,
  'gemma-2-2b': 24000,
  'gemma-2-9b': 48000,
  // 保守回退：未知本地模型（用户未设 HESI_EFFECTIVE_CONTEXT 且名称不匹配上表）
  'local-model': 32000,
};

// 未匹配模型名且未设 env 时的回退窗口（接近「大云模型」标称，行为等同 v0.3.1）
const DEFAULT_FALLBACK_CONTEXT = 200000;

// 与 v0.3.1 现状一致的默认值（env 未设时回落）
const LEGACY_COMPACT_THRESHOLD = 60000;
const LEGACY_MAX_OUTPUT = 32768;

function normalizeModel(model) {
  if (!model || typeof model !== 'string') return '';
  return model.toLowerCase().trim();
}

class ContextWindowManager {
  /**
   * @param {{ effectiveContextEnv?: string, compactThresholdEnv?: string, modelMap?: Record<string, number> }} [opts]
   *   env 可注入便于测试；默认读 process.env。
   */
  constructor(opts = {}) {
    this._effectiveContextEnv =
      opts.effectiveContextEnv !== undefined ? opts.effectiveContextEnv : process.env.HESI_EFFECTIVE_CONTEXT;
    this._compactThresholdEnv =
      opts.compactThresholdEnv !== undefined ? opts.compactThresholdEnv : process.env.HESI_COMPACT_THRESHOLD;
    this._modelMap = opts.modelMap || MODEL_CONTEXT_MAP;
  }

  /** 解析有效上下文窗口（token） */
  effectiveContext(model) {
    // Layer① 手动最高优先级
    if (this._effectiveContextEnv) {
      const n = Number(this._effectiveContextEnv);
      if (Number.isFinite(n) && n > 0) return n;
    }
    // Layer② 模型名映射（精确优先，再子串匹配以兼容 -instruct/-q4 等后缀）
    const m = normalizeModel(model);
    if (m) {
      if (this._modelMap[m]) return this._modelMap[m];
      for (const key of Object.keys(this._modelMap)) {
        if (m.includes(key)) return this._modelMap[key];
      }
    }
    return DEFAULT_FALLBACK_CONTEXT;
  }

  /** 压缩触发阈值 = min(显式 COMPACT_THRESHOLD, 窗口 × 0.5) */
  compactThreshold(model) {
    const ctx = this.effectiveContext(model);
    const derived = Math.floor(ctx * 0.5);
    if (this._compactThresholdEnv) {
      const n = Number(this._compactThresholdEnv);
      if (Number.isFinite(n) && n > 0) return Math.min(n, derived);
    }
    return Math.min(LEGACY_COMPACT_THRESHOLD, derived);
  }

  /** 单次输出上限 = min(32768, 窗口 × 0.8) */
  maxOutputTokens(model) {
    const ctx = this.effectiveContext(model);
    const derived = Math.floor(ctx * 0.8);
    return Math.min(LEGACY_MAX_OUTPUT, derived);
  }
}

module.exports = {
  ContextWindowManager,
  MODEL_CONTEXT_MAP,
  DEFAULT_FALLBACK_CONTEXT,
  LEGACY_COMPACT_THRESHOLD,
  LEGACY_MAX_OUTPUT,
};
