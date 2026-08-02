/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// P2.7 上下文效率 ①——L0/L1/L2 分级回收（纯函数，零 IO）
//
// 目标：长对话 Token 固定开销下降（省的是「历史轮次全文重发」）。
// - L0(Hot)   最近 N 轮：完整保留（含工具结果）
// - L1(Warm)  再往前 M 轮：只留摘要（每轮 summary 或截断至 maxChars）
// - L2(Cold)  更早轮次：序列化成「引用清单」+ 按需展开提示（不重发原文）
//
// 纯函数：输入轮次数组 → 输出分级分配；不读写磁盘/不调 LLM。
// 接入点（chat 历史构建）后续单独接线；本模块先沉淀 + 可单测。
// ============================================================

'use strict';

/** 默认阈值：L0 保留最近 3 轮；L1 覆盖其后 5 轮；再早进 L2 */
const DEFAULT_L0_ROUNDS = 3;
const DEFAULT_L1_ROUNDS = 5;
/** L1 每轮摘要的字符上限 */
const DEFAULT_L1_MAX_CHARS = 600;
/** L2 引用清单每轮描述上限 */
const DEFAULT_L2_DESC_CHARS = 80;

/**
 * 把轮次数组分级为 L0/L1/L2。
 * @param {Array<{ role: string, content?: string, summary?: string, toolResults?: unknown, ts?: number }>} rounds 从旧到新的轮次
 * @param {{ l0Rounds?: number, l1Rounds?: number, l1MaxChars?: number, l2DescChars?: number }} [opts]
 * @returns {{
 *   l0: Array,   // 完整保留
 *   l1: Array,   // 摘要化（每轮一条摘要消息）
 *   l2: Array,   // 引用清单（不重发原文）
 *   dropped: number,       // 被回收掉的原始轮次数（省下的量）
 *   keptChars: number,     // L0+L1 实际保留字符数
 *   totalChars: number,    // 全量字符数（用于对比）
 * }}
 */
function tierMessages(rounds, opts = {}) {
  const list = Array.isArray(rounds) ? rounds : [];
  const l0N = opts.l0Rounds || DEFAULT_L0_ROUNDS;
  const l1N = opts.l1Rounds || DEFAULT_L1_ROUNDS;
  const l1Max = opts.l1MaxChars || DEFAULT_L1_MAX_CHARS;
  const l2Desc = opts.l2DescChars || DEFAULT_L2_DESC_CHARS;

  const totalChars = list.reduce((n, r) => n + (typeof r.content === 'string' ? r.content.length : 0), 0);

  const l0Start = Math.max(0, list.length - l0N);
  const l0 = list.slice(l0Start);

  const l1Start = Math.max(0, l0Start - l1N);
  const l1Raw = list.slice(l1Start, l0Start);
  const l1 = l1Raw.map((r, i) => {
    const content = typeof r.content === 'string' ? r.content : '';
    // 有摘要用摘要；否则截断；再标注这是摘要形态
    const text = (r.summary || content).slice(0, l1Max);
    return {
      role: r.role,
      content: text,
      _tier: 'L1',
      _summaryOf: i, // 原始序号（调试/回查用）
      _fullLength: content.length,
      hint: content.length > l1Max ? `（该轮完整内容已摘要化，原 ${content.length} 字符）` : undefined,
    };
  });

  const l2Raw = list.slice(0, l1Start);
  const l2 = l2Raw.map((r, i) => {
    const content = typeof r.content === 'string' ? r.content : '';
    const desc = (r.summary || content).slice(0, l2Desc);
    return {
      role: 'system',
      content: `[L2 历史轮次 ${i}] ${desc}${content.length > l2Desc ? '…' : ''}（按需可用会话记录回查，不再重发全文）`,
      _tier: 'L2',
      _summaryOf: i,
    };
  });

  const l1Kept = l1.reduce((n, m) => n + m.content.length, 0);
  const l0Kept = l0.reduce((n, r) => n + (typeof r.content === 'string' ? r.content.length : 0), 0);

  return {
    l0,
    l1,
    l2,
    dropped: l2Raw.length,          // 进 L2 的原始轮次（被回收）
    keptChars: l0Kept + l1Kept,    // 保留字符
    totalChars,                     // 全量字符
  };
}

/**
 * 估算分级后的 token 节省率（字符 / 4 近似，供前端展示「省了多少」）。
 * @param {ReturnType<typeof tierMessages>} t
 * @returns {{ savedTokens: number, savedPct: number, keptTokens: number }}
 */
function tierSavings(t) {
  const total = t.totalChars;
  const kept = t.keptChars;
  const savedTokens = Math.max(0, Math.round((total - kept) / 4));
  const savedPct = total > 0 ? Math.round(((total - kept) / total) * 100) : 0;
  return { savedTokens, savedPct, keptTokens: Math.round(kept / 4) };
}

module.exports = {
  tierMessages,
  tierSavings,
  DEFAULT_L0_ROUNDS,
  DEFAULT_L1_ROUNDS,
  DEFAULT_L1_MAX_CHARS,
};
