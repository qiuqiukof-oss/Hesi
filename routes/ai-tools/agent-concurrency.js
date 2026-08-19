/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Agent Concurrency — 全局统一并发配额
//
// 问题背景：
//   agent_delegate（同步阻塞路径，builtin/agent.js）与
//   AgentPoolManager（异步池，agent-pool.js）原本各自维护一套并发计数器，
//   文档都写"最多 3 个"，实际却允许 6 个同时运行，与文档矛盾，且 delegate
//   路径在超时分支会重复递减计数导致计数变负、限流永久失效。
//
// 方案：两条路径共用本模块的单一全局配额，acquire/release 成对、幂等，
// 保证真正「最多同时运行 N 个 Agent」（含同步 + 异步之和）。
// ============================================================

const MAX_GLOBAL_AGENTS = 3; // 全局最大并发 Agent（同步委派 + 异步池合计）
let _globalActive = 0;

/**
 * 尝试获取一个并发名额。
 * @returns {boolean} true=获取成功，false=已达上限
 */
function tryAcquire() {
  if (_globalActive >= MAX_GLOBAL_AGENTS) return false;
  _globalActive++;
  return true;
}

/**
 * 释放一个并发名额（幂等，重复调用安全）。
 */
function release() {
  if (_globalActive > 0) _globalActive--;
}

/** 当前活跃 Agent 数量（含同步委派）。 */
function getActive() {
  return _globalActive;
}

// 导出名与 builtin/agent.js / agent-pool.js / 测试保持一致
module.exports = {
  MAX_GLOBAL_AGENTS,
  tryAcquireAgent: tryAcquire,
  releaseAgent: release,
  getActiveAgentCount: getActive,
};
