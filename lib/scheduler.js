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

const LOCK_FILE = '.lock';
const POLL_INTERVAL_MS = 5000;

let _running = false;
let _timer = null;

/**
 * @param {{ cwd?: string, intervalMs?: number }} [opts]
 * @returns {{ stop: () => void }}
 */
function startScheduler(opts = {}) {
  if (_timer) return { stop: () => {} }; // 已启动，幂等
  const cwd = opts.cwd || process.cwd();
  const intervalMs = opts.intervalMs || POLL_INTERVAL_MS;
  const queueDir = path.join(cwd, 'data', 'pending-plans');
  const lockPath = path.join(queueDir, LOCK_FILE);

  // 确保目录存在
  if (!fs.existsSync(queueDir)) fs.mkdirSync(queueDir, { recursive: true });

  _running = true;

  const tick = async () => {
    if (!_running) return;
    try {
      // 单实例锁：依据 lock 文件中的 pid 是否仍存活来判断，而非依赖 mtime 过期。
      // 这样长任务（runPlan 可能跑数分钟）不会被误判为陈旧，也不会被并发 tick 抢锁。
      if (fs.existsSync(lockPath)) {
        const owner = Number(fs.readFileSync(lockPath, 'utf8').trim());
        let alive = false;
        try { if (owner > 0) process.kill(owner, 0); alive = true; } catch { /* pid 不存在 → 陈旧锁 */ }
        if (alive) return; // 仍有活跃实例持有锁，本 tick 跳过（不抢锁、不删锁）
        fs.unlinkSync(lockPath); // 陈旧锁（持有进程已退出），清除后接管
      }
      fs.writeFileSync(lockPath, String(process.pid), 'utf8');

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

        // 成功 → 删入队文件
        fs.unlinkSync(file.path);
        console.log(`[scheduler] 完成: ${file.name} status=${result && result.status}`);
      } catch (e) {
        console.warn(`[scheduler] 失败: ${file.name} ${e.message}`);
        // 保留入队文件供人工检查
      }
    } catch (e) {
      console.warn('[scheduler] tick 异常:', e.message);
    } finally {
      // 仅当本 tick 真正持有该锁（内容仍是自己的 pid）时才删除，
      // 避免并发 tick 早退时误删正在运行实例的锁，导致同一 plan 被并发执行。
      try {
        if (fs.existsSync(lockPath) && fs.readFileSync(lockPath, 'utf8').trim() === String(process.pid)) {
          fs.unlinkSync(lockPath);
        }
      } catch { /* ignore */ }
    }
  };

  _timer = setInterval(tick, intervalMs);
  tick(); // 立即跑一次

  const stop = () => {
    _running = false;
    if (_timer) { clearInterval(_timer); _timer = null; }
    try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch { /* ignore */ }
  };

  return { stop };
}

module.exports = { startScheduler };
