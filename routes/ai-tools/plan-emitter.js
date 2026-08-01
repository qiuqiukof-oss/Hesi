/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 事件通道抽象
//
// 背景：执行核心（run-plan.js）原先直接调 broadcastFn 全局 WS 广播，
// 把「投递方式」写死在了「执行逻辑」里。于是 Plan 只能活在独立抽屉中，
// 无法作为一个回合接进聊天 SSE 流。
//
// 本模块把两者解耦：执行核心只认 emit(type, data)，不关心怎么送出去。
//   - createWsEmitter  → 全局 WS 广播（旧 /api/plan/execute，向后兼容）
//   - NOOP_EMIT        → 无投递目标时的静默占位（单测 / 内部调用）
//
// 事件名约定：emit 的 type 不带前缀，投递层负责加 `plan:`。
// 例：emit('step', ev) → WS 收到 { type: 'plan:step', execId, ... }
// ============================================================

/** 步骤 output 投递上限（防止单步几千行输出撑爆 WS 帧 / 会话历史） */
const STEP_OUTPUT_LIMIT = 4000;

/** 无投递目标时的静默 emit（保持调用方无需判空） */
const NOOP_EMIT = () => {};

/**
 * 把 runPlan 的步骤事件裁剪成适合投递的 payload。
 *
 * run-plan.js 的 ev 里 output 可能很长（CLI Agent 一步吐几千行），
 * 直接塞进 WS 帧或会话历史会造成膨胀。这里做截断并标记，
 * 全文由调用方决定是否另行落盘。
 *
 * @param {object} ev runPlan onStep 回调的事件对象
 * @param {number} [limit] output 截断长度，默认 STEP_OUTPUT_LIMIT
 * @returns {object} 裁剪后的事件副本
 */
function normalizeStepEvent(ev, limit = STEP_OUTPUT_LIMIT) {
  if (!ev || typeof ev !== 'object') return {};
  const out = Object.assign({}, ev);
  if (typeof out.output === 'string' && out.output.length > limit) {
    out.outputFullLength = out.output.length;
    out.outputTruncated = true;
    out.output = `${out.output.slice(0, limit)}\n…（输出过长，已截断 ${out.output.length - limit} 字符）`;
  }
  return out;
}

/**
 * WS 广播投递器 —— 旧 /api/plan/execute 的行为，保持向后兼容。
 *
 * @param {Function|null} broadcastFn 全局广播函数（wsManager.broadcast）
 * @param {string} [execId] 本次执行 id，随每条事件带出
 * @returns {(type: string, data?: object) => void}
 */
function createWsEmitter(broadcastFn, execId) {
  if (typeof broadcastFn !== 'function') return NOOP_EMIT;
  return function emit(type, data) {
    try {
      broadcastFn({ type: `plan:${type}`, execId, ...(data || {}) });
    } catch { /* 投递失败不应影响执行主流程 */ }
  };
}

/**
 * 把 emit 适配成 run-plan.js 期望的 broadcastFn 形态。
 *
 * run-plan.js 内部（轨道 B / runStepViaChatLLM）会把 broadcastFn 透传给
 * chat 管线，那里发的是完整 { type: 'xxx', ... } 对象而非 (type, data)。
 * 该适配器让这条老通道也能走 emit，从而跟随注入的投递方式。
 *
 * @param {(type: string, data?: object) => void} emit
 * @returns {(data: object) => void}
 */
function emitAsBroadcastFn(emit) {
  if (typeof emit !== 'function' || emit === NOOP_EMIT) return () => {};
  return function broadcastLike(data) {
    if (!data || typeof data !== 'object') return;
    const { type, ...rest } = data;
    if (!type) return;
    // chat 管线发的事件（如 tool_call）已有自己的语义，原样带出不加 plan: 前缀会
    // 与 plan 事件混淆 → 统一收进 plan:chat-* 命名空间，前端可选择性忽略。
    const name = String(type).startsWith('plan:') ? String(type).slice(5) : `chat-${type}`;
    emit(name, rest);
  };
}

module.exports = {
  NOOP_EMIT,
  STEP_OUTPUT_LIMIT,
  createWsEmitter,
  emitAsBroadcastFn,
  normalizeStepEvent,
};
