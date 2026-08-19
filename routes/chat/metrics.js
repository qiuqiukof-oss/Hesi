/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// M5 / P1.5 共享：把「上下文压缩」结果累加进 request-scoped metrics 对象。
// 抽成纯函数便于单测；逻辑与 routes/chat/index.js 内联累加等价。
// 字段命名与 agent_metrics 广播保持一致（cacheReadTokens / compactCount ...）。

const EMPTY = {
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  toolCacheHits: 0,
  experienceHits: 0,
  skillsInjected: 0,
  actualUsed: 0,
};

/**
 * 若本轮发生了上下文压缩，把计数累加到 metrics。
 * @param {object|undefined} metrics request-scoped 共享累加器（可能未初始化）
 * @param {{compacted?:boolean, dropped?:number}} cr compactIfNeeded 的返回值
 * @returns {object} 累加后的 metrics（保证含完整字段）
 */
function recordCompact(metrics, cr) {
  if (!cr || !cr.compacted) return metrics;
  // 非原地修改：返回合并后的新对象，避免意外改动调用方的 metrics。
  const m = metrics ? metrics : { ...EMPTY };
  return {
    ...m,
    compactCount: (m.compactCount || 0) + 1,
    compactedMsgs: (m.compactedMsgs || 0) + (cr.dropped || 0),
  };
}

module.exports = { recordCompact, EMPTY };
