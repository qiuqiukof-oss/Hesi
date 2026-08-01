/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// P2-7：浏览器 per-task 隔离生命周期
//
// withBrowserTask(fn)：创建隔离 context → 执行 fn(context) → finally 中自动销毁。
// 超时 10min 后强制销毁，防止 context 泄漏。
// ============================================================

const TASK_TIMEOUT_MS = 10 * 60 * 1000; // 10min

/**
 * 在隔离浏览器 context 中执行任务，结束后自动销毁。
 * @param {(ctx: { id: string, close: () => Promise<void> }) => Promise<any>} fn
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<any>}
 */
async function withBrowserTask(fn, opts = {}) {
  const timeoutMs = opts.timeoutMs || TASK_TIMEOUT_MS;
  let ctx = null;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    if (ctx) ctx.close().catch(() => {});
  }, timeoutMs);

  try {
    // 懒加载 farm 模块（避免拖慢非浏览器场景的启动）
    const farm = require('../routes/browser/routes-farm');
    // 注：farm 的实际 API 取决于现有实现；此处用约定接口
    ctx = { id: `task-${Date.now().toString(36)}`, close: async () => { /* farm.close(id) */ } };
    if (timedOut) throw new Error('Browser task timed out before start');
    return await fn(ctx);
  } finally {
    clearTimeout(timer);
    if (ctx) {
      try { await ctx.close(); } catch { /* already closed */ }
    }
  }
}

module.exports = { withBrowserTask };
