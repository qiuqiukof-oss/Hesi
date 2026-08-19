/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// 常驻调度器（P1-3）— 轻量轮询 data/pending-plans/ 自动执行
//
// 逻辑：
//   1. 扫描 data/pending-plans/ 目录中的 *.json 文件
//   2. 按文件 mtime 排序（FIFO），串行逐个执行
//   3. 每个 plan 执行完写 result 到 data/plan-outputs/
//   4. 单实例锁（pending-plans/.lock），防多进程并发
//   5. 全局并发上限 1（简单顺序，后续可升至 agent-concurrency 同款 3）
//
// 启用：server.js 中 startScheduler({ cwd, intervalMs: 5000 })
// 关闭：环境变量 HESI_SCHEDULER_ENABLED=0 或未调用 startScheduler
// ============================================================

const fs = require('fs');
const path = require('path');

const POLL_INTERVAL_MS = 5000;

let _running = false;
let _timer = null;
// bug 修复（2026-08-04 全局纠错）：原单实例锁用 data/pending-plans/.lock 文件
// 存 pid——但环境层 safe-delete 会拦截 fs.unlinkSync 并可能抛异常（fail-closed
// 进回收站失败时），导致：① tick 抛异常 ② 锁文件残留 → 后续 tick 判"活锁"
// 死循环 → plan 永远无法调度。Hesi 单进程（4264 端口占用天然防多实例），
// 文件锁无必要——改用进程内重入锁，彻底绕开文件删除。
let _lockHeld = false;

/**
 * @param {{ cwd?: string, intervalMs?: number }} [opts]
 * @returns {{ stop: () => void }}
 */
function startScheduler(opts = {}) {
  if (_timer) return { stop: () => {} }; // 已启动，幂等
  const cwd = opts.cwd || process.cwd();
  const intervalMs = opts.intervalMs || POLL_INTERVAL_MS;
  const queueDir = path.join(cwd, 'data', 'pending-plans');

  // 确保目录存在
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });

  _running = true;

  const tick = async () => {
    if (!_running) return;
    // 进程内重入锁：上一次 tick 未结束（长任务 await 中）→ 跳过，防并发执行
    if (_lockHeld) return;
    _lockHeld = true;
    try {
      const files = fs.readdirSync(queueDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ name: f, path: path.join(queueDir, f), mtime: fs.statSync(path.join(queueDir, f)).mtimeMs }))
        .sort((a, b) => a.mtime - b.mtime); // FIFO

      if (files.length === 0) return;

      // 取第一个待执行
      const file = files[0];
      let plan = null;
      try { plan = JSON.parse(fs.readFileSync(file.path, 'utf8')); } catch { plan = null; }

      if (!plan || !Array.isArray(plan.steps)) {
        // 非法 plan → 移到 failed 目录
        const failedDir = path.join(queueDir, 'failed');
        if (!fs.existsSync(failedDir)) fs.mkdirSync(failedDir, { recursive: true });
        fs.renameSync(file.path, path.join(failedDir, file.name));
        return;
      }

      // 执行
      const execId = `sched-${Date.now().toString(36)}`;
      const { runPlan } = require('../routes/ai-tools/run-plan');
      console.log(`[scheduler] 开始执行: ${file.name} (execId=${execId})`);

      try {
        const result = await runPlan(plan, { cwd, execId });
        // 写结果
        const outDir = path.join(cwd, 'data', 'plan-outputs');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${execId}-result.json`), JSON.stringify(result, null, 2), 'utf8');

        // 成功 → 删入队文件（safe-delete 拦截失败时保留文件，tick 下次重试，
        // 避免重复执行——result 幂等可重复写）
        try { fs.unlinkSync(file.path); } catch { /* 删除失败则保留，下次 tick 重试 */ }
        console.log(`[scheduler] 完成: ${file.name} status=${result && result.status}`);
      } catch (e) {
        console.warn(`[scheduler] 失败: ${file.name} ${e.message}`);
        // 保留入队文件供人工检查
      }
    } catch (e) {
      console.warn('[scheduler] tick 异常:', e.message);
    } finally {
      _lockHeld = false; // 释放进程内重入锁
    }
  };

  _timer = setInterval(tick, intervalMs);
  tick(); // 立即跑一次

  const stop = () => {
    _running = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
  };

  return { stop };
}

module.exports = { startScheduler };
