/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

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

// 未知本地模型（model==='local-model'）的保守回退窗口（env HESI_LOCAL_CONTEXT 可微调）。
// 必须定义在 MODEL_CONTEXT_MAP 之前，避免 TDZ。
const LOCAL_MODEL_CONTEXT = Number(process.env.HESI_LOCAL_CONTEXT) > 0 ? Number(process.env.HESI_LOCAL_CONTEXT) : 128000;

// Layer② 模型名 → 有效上下文窗口（token）。
// 数值取保守有效窗口（非厂商标称总窗口，预留系统/历史余量）。
// 分两类：
//   LOCAL  本地小/中模型 —— 窗口偏小，必须显式列出，避免被误判为大云模型而撑爆上下文。
//   CLOUD  云端热门大模型（2026-07 检索的主流；参数为近似值，随厂商更新可能变化，
//           可用 HESI_EFFECTIVE_CONTEXT 随时覆盖）。未列出者走默认大窗口回退（200000）。
// 匹配规则见 effectiveContext：先精确匹配，再按 key 前缀匹配（兼容 -instruct/-q4 等后缀，
// 用前缀而非子串，避免「任意含 claude/gemini 的自定义模型名」被乐观套用大窗口导致高估溢出）。
const MODEL_CONTEXT_MAP = {
  // ── LOCAL 本地常见小模型（保守估计，避免标称值过满导致截断）──
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
  // 保守回退：未知本地模型（用户未设 HESI_EFFECTIVE_CONTEXT/HESI_LOCAL_CONTEXT 且名称不匹配上表）。
  // 现代本地 LLM 普遍 32K–128K，保守取 128K（可用 HESI_LOCAL_CONTEXT 微调；更小模型请用 HESI_EFFECTIVE_CONTEXT 精确覆盖）。
  'local-model': LOCAL_MODEL_CONTEXT,

  // ── LOCAL 新增（球总指定，2026-07）──
  // Qwen3.x 系列均支持 ~128K 上下文（本地部署常见 32K–128K 可调，取保守 128K）。
  'qwen3.6-35b-a3b': 128000,
  'qwen3.6-35ba3b': 128000,   // 无连字符别名（35ba3b = 35b-a3b）
  'qwen3.6-27b': 128000,
  'qwen3.5-27b': 128000,
  'qwen3': 128000,            // Qwen3 家族通配（精确键优先于子串）
  // gamma4 系列：⚠️ 真实窗口未知（非公开规格），按下表按尺寸估参，待球总校准。
  //   如与实际不符，请用 HESI_EFFECTIVE_CONTEXT 覆盖。
  'gamma4-12b': 32768,
  'gamma4-26b': 32768,
  'gamma4-31b': 32768,
  'gamma4-e4b': 16384,
  'gamma4': 32768,            // gamma4 家族通配（保守默认）

  // ── CLOUD 云端热门大模型（2026-07 检索；参数近似，随厂商变化）──
  // OpenAI（gpt-5 同族：5 / 5.1 / 5.2 / 5.3 / 5.4 / 5.5）
  'gpt-5': 400000,
  // OpenAI 主流精确键（避免回退到 200000 高估；gpt-4o-mini 真实 128K）
  'gpt-4o-mini': 128000,
  'gpt-4o': 128000,
  'gpt-4': 128000,
  'gpt-4-turbo': 128000,
  // OpenAI o-series 推理模型（不接受 temperature，但窗口 200K）
  'o1': 200000,
  'o3': 200000,
  // Anthropic（Claude Opus/Sonnet/Haiku 4.x 标准 200K；4.7 有 1M beta，按标准计）
  'claude': 200000,
  // Google（Gemini 2.5 / 3.x 标准 1M；3.1 有 2M 选项，按标准计）
  'gemini': 1000000,
  // DeepSeek
  'deepseek-v3': 128000,
  'deepseek-v4': 1000000,     // 2026-04 开源，1M 上下文
  'deepseek-r1': 128000,
  // Meta
  'llama-4': 1000000,
  // Mistral
  'mistral-large': 128000,
  // Cohere
  'command-r': 128000,
  // xAI
  'grok': 131072,
  // 阿里云 Qwen（API 版，区别于本地 qwen3 系列）
  'qwen-max': 32768,
  'qwen-plus': 128000,
  'qwen-long': 1000000,
  // 字节豆包
  'doubao': 256000,
  // Moonshot Kimi
  'kimi': 256000,
  // 智谱 GLM
  'glm-4': 128000,
  'glm-4-long': 1000000,
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
    // Layer② 模型名映射（精确优先，再前缀匹配以兼容 -instruct/-q4 等后缀；
    // 前缀而非子串，避免「任意含 claude/gemini 的自定义模型名」被乐观套用大窗口）
    const m = normalizeModel(model);
    if (m) {
      if (this._modelMap[m]) return this._modelMap[m];
      for (const key of Object.keys(this._modelMap)) {
        if (m.startsWith(key)) return this._modelMap[key];
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
