/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// SSE 公共工具（长任务流式回合共用：AI 讨论 / 自动执行 Plan）
//
// 四件事：
//   sse(res, obj)        —— 写一帧 `data: {...}`
//   openSseStream(res)   —— 统一设置 SSE 响应头（含反向代理缓冲关闭 + 取消超时）
//   startHeartbeat(res)  —— 注释帧心跳保活，返回 stop()
//   watchDisconnect(res) —— 客户端断开探针，返回 { isAborted, dispose }
//
// ⚠️ 心跳与同步阻塞：心跳基于 setInterval，事件循环被同步调用（如 execSync）
//    冻结期间不会触发。命令型 Plan 步骤当前仍是同步直执，故「真流式」
//    （P3：execStepDirectly 改 spawn 异步）是心跳在该路径上真正生效的前提。
// ============================================================
'use strict';

const DEFAULT_HEARTBEAT_MS = 15000;

/**
 * 写一帧 SSE 数据。连接已关闭时静默忽略（不应影响业务主流程）。
 * @param {import('express').Response} res
 * @param {object} obj
 */
function sse(res, obj) {
  try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* closed */ }
}

/**
 * 设置 SSE 响应头。与既有讨论流保持逐字一致，避免行为漂移。
 * @param {import('express').Response} res
 */
function openSseStream(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // nginx：关闭响应缓冲
  res.setTimeout(0); // 长任务：取消 socket 空闲超时
}

/**
 * 心跳保活：定期写 SSE 注释帧（`: hb <ts>`）。
 * 注释帧不以 `data: ` 开头，前端解析器天然忽略 → 纯保活、零副作用。
 * @param {import('express').Response} res
 * @param {number} [intervalMs] 覆盖间隔；否则读 HESI_SSE_HEARTBEAT_MS，兜底 15s
 * @returns {() => void} stop()
 */
function startHeartbeat(res, intervalMs) {
  const ms = Number(intervalMs) || Number(process.env.HESI_SSE_HEARTBEAT_MS) || DEFAULT_HEARTBEAT_MS;
  if (!(ms > 0)) return () => {};
  const timer = setInterval(() => {
    if (res.writableEnded) return;
    try { res.write(`: hb ${Date.now()}\n\n`); } catch { /* closed */ }
  }, ms);
  // 不阻止进程退出（测试/优雅关停）
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

/**
 * 客户端断开探针。用于「断开即取消」：长任务在步骤边界检查 isAborted() 后停机。
 * @param {import('express').Response} res
 * @returns {{ isAborted: () => boolean, dispose: () => void }}
 */
function watchDisconnect(res) {
  let aborted = false;
  const onClose = () => { if (!res.writableEnded) aborted = true; };
  res.on('close', onClose);
  return {
    isAborted: () => aborted,
    dispose: () => { try { res.removeListener('close', onClose); } catch { /* ignore */ } },
  };
}

module.exports = { sse, openSseStream, startHeartbeat, watchDisconnect, DEFAULT_HEARTBEAT_MS };
