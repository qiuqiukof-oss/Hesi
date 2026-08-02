/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 「自动执行」对话回合（P2：把全自动 Plan 执行器并入 AI 对话）
//
// 定位：与 AI 讨论（discuss.js/runDiscussion）**并列**的第三种聊天回合。
//   普通聊天  → streamOpenAIWithTools / streamAnthropicWithTools
//   AI 讨论   → runDiscussion（圆桌）
//   自动执行  → runPlanTurn（本模块）
//   协作工作流 → runPlanTurn(discussBeforePlan=true) 带 discussPartners（P6）
//
// 复用而非重造：
//   · 计划生成沿用 plan-from-nl.generatePlanFromObjective
//   · 执行内核沿用 run-plan.runPlan（一字未改）
//   · 事件出口沿用 P1 的 plan-emitter 抽象——只是把投递方式从
//     「WS 广播」换成「本回合的 SSE 帧」。一份核心，两种投递。
//
// 三个已拍板的行为决策：
//   ① 断开即取消：res 'close' → shouldAbort() 置真 → runPlan 在步骤边界停机，
//      标记 cancelled。⚠️ 命令型步骤当前仍是 execSync 同步直执，无法中途杀死；
//      真正的「立即杀子进程」依赖 P3（execStepDirectly → spawn 异步化）。
//   ② 心跳：SSE 注释帧保活（sse-util.startHeartbeat）。
//   ③ 流式：步骤级事件经 onStep 实时流出；轨道 B（AI 管线）步骤的 token 经
//      broadcastFn 桥接后同样实时可见。轨道 A 命令型步骤在 P3 前是「执行完
//      一次性回输出」的兜底形态。
//
// 审批闸（P4-2 对话式）：chat SSE 路径现在通过共享登记表挂起等待，
//   前端在 chat 线程渲染内联审批气泡（Approve/Reject 按钮），
//   不再自动驳回。
// ============================================================
'use strict';

const crypto = require('crypto');
const { runPlan } = require('../ai-tools/run-plan');
const { generatePlanFromObjective, revisePlan } = require('../ai-tools/plan-from-nl');
const { normalizeStepEvent, emitAsBroadcastFn } = require('../ai-tools/plan-emitter');
const { registerApproval } = require('../../lib/plan-approval');
const { workflowManager } = require('../ai-tools/workflow-manager');
const { runRoundtable } = require('./discuss');
const { sinkPlanToIndex } = require('../ai-tools/plan-rag-sink');
const { sse, openSseStream, startHeartbeat, watchDisconnect } = require('./sse-util');

/**
 * emit 事件名 → 前端 SSE 事件名。
 * 统一加 `plan_` 前缀并把 kebab/冒号换成下划线，前端一处分支即可分流。
 * 例：'step' → 'plan_step'；'chat-token' → 'plan_chat_token'。
 * @param {string} type
 * @returns {string}
 */
function sseEventName(type) {
  return `plan_${String(type || '').replace(/[-:]/g, '_')}`;
}

/**
 * 造一个把 P1 emit 事件投递成 SSE 帧的 emit。
 * @param {import('express').Response} res
 * @returns {(type: string, data?: object) => void}
 */
function createSseEmitter(res) {
  return function emit(type, data) {
    sse(res, { type: sseEventName(type), ...(data || {}) });
  };
}

/** 计划摘要：只发前端渲染清单所需字段，不把整个 plan 灌进 SSE。 */
function summarizePlan(plan, execId) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return {
    execId,
    planId: plan.id || '',
    title: plan.title || plan.objective || '',
    stepCount: steps.length,
    steps: steps.map((s, i) => ({
      index: i,
      id: s.id || `s${i + 1}`,
      goal: s.goal || '',
      action: typeof s.action === 'string' ? s.action.slice(0, 200) : '',
      requireApproval: s.requireApproval === true,
    })),
  };
}

/**
 * 跑一个「自动执行」对话回合，全程以 SSE 实时回流。
 *
 * @param {import('express').Response} res
 * @param {object} p
 * @param {string} [p.objective]     自然语言目标（用户这轮说的话）
 * @param {object} [p.plan]          直接给定 plan（跳过 NL 拆解，主要供测试/高级用法）
 * @param {string} [p.apiKey]
 * @param {string} [p.provider]
 * @param {string} [p.baseUrl]
 * @param {string} [p.model]
 * @param {string} [p.agentId]       执行方：'ai'（默认，复用 AI 助手工具环）或外部 CLI agent id
 * @param {object} [p.permissions]   个性化权限（fullAuto / autoReview…）
 * @param {boolean} [p.autoReplan]
 * @param {number} [p.maxRetries]
 * @param {string} [p.cwd]
 * @param {object} [p.workflowManager]
 * @param {Function} [p.generatePlanFn] 注入计划生成器（默认 plan-from-nl.generatePlanFromObjective）；
 *   与 run-plan 的 revisePlanFn 同风格，便于测试覆盖「生成阶段断开」等分支。
 * @param {boolean} [p.discussBeforePlan]  执行前先与 discussionPartners 多 Agent 圆桌讨论（P6 协作工作流）
 * @param {string[]} [p.discussionPartners] 讨论伙伴（CLI Agent id 数组），讨论结论注入 Plan 生成器
 * @param {object} [p.budget]              预算约束
 * @returns {Promise<void>}
 */
async function runPlanTurn(res, p = {}) {
  const objective = typeof p.objective === 'string' ? p.objective.trim() : '';
  const presetPlan = p.plan && typeof p.plan === 'object' ? p.plan : null;
  console.log('[runPlanTurn] 入口 objective=%s discussBeforePlan=%s partners=%d',
    objective.slice(0, 60), !!p.discussBeforePlan, (Array.isArray(p.discussionPartners) ? p.discussionPartners.length : 0));
  if (!objective && !presetPlan) {
    return res.status(400).json({ error: '自动执行模式需要一段目标描述' });
  }

  const cwd = p.cwd || process.cwd();
  const wf = p.workflowManager || workflowManager;
  const runtime = { apiKey: p.apiKey, provider: p.provider, baseUrl: p.baseUrl, model: p.model };
  const executorAgentId = (typeof p.agentId === 'string' && p.agentId.trim()) ? p.agentId.trim() : 'ai';
  const perms = (p.permissions && typeof p.permissions === 'object') ? p.permissions : null;
  // 🔓 允许完全访问（WorkBuddy 式显式开关）：开启后所有步骤直接执行，不再弹审批气泡。
  // 用户在「⚡ 自动执行」控件区手动勾选，默认关；关闭时恢复逐个审批。
  const fullAccess = p.fullAccess === true;
  const execId = crypto.randomUUID();

  openSseStream(res);
  const emit = createSseEmitter(res);
  const stopHeartbeat = startHeartbeat(res);
  const watcher = watchDisconnect(res);

  emit('start', { execId, objective });
  console.log('[runPlanTurn] SSE opened, execId=%s', execId);

  let plan = presetPlan;
  let result = null;
  const startedAt = Date.now();

  // ── P6 协作工作流：讨论伙伴 ──
  const discussPartners = (Array.isArray(p.discussionPartners) && p.discussionPartners.length)
    ? p.discussionPartners.slice() : [];
  const discussBeforePlan = !!(p.discussBeforePlan) && discussPartners.length > 0 && !presetPlan;
  console.log('[runPlanTurn] discussBeforePlan=%s partners=%s', discussBeforePlan, discussPartners);
  let discussionSummary = null;

  // checkpoint 讨论 factory：执行阶段遇到 checkpoint 步时由 runPlan 回调，
  // 复用同一组伙伴进行局部讨论，产出结论注入后续步骤。
  const makeCheckpointDiscuss = () => {
    if (!discussPartners.length) return null;
    return async (question) => {
      emit('phase', { phase: 'discuss', label: '💬 检查点讨论…' });
      try {
        const out = await runRoundtable({
          message: question,
          partners: discussPartners,
          maxTurns: 2,
          apiKey: runtime.apiKey,
          provider: runtime.provider,
          baseUrl: runtime.baseUrl,
          model: runtime.model,
          budget: p.budget,
          onEvent: (type, payload) => {
            // 讨论事件直写 SSE（不加 plan_ 前缀），与独立讨论模式行为一致，
            // 让 chat-api.js 的 token/discuss_start/discuss_stats 路由正常工作
            // → TTS 语音播报、token 消耗、缓存命中统计全部生效。
            sse(res, { type, ...(payload || {}) });
          },
          shouldAbort: () => watcher.isAborted(),
        });
        return (out && out.summary) || '';
      } catch { return ''; }
    };
  };

  try {
    // ── 讨论 helper（带超时保护，讨论失败不阻塞 Plan 生成）──
    const DISCUSS_TIMEOUT_MS = Number(process.env.HESI_COLLAB_DISCUSS_TIMEOUT) || 120000; // 2min 兜底
    const doDiscuss = async (message, label, maxT) => {
      if (!discussBeforePlan || !discussPartners.length) return '';
      emit('phase', { phase: 'discuss', label });
      console.log('[runPlanTurn] 开始讨论 phase, partners=%d, label=%s', discussPartners.length, label);
      try {
        const out = await Promise.race([
          runRoundtable({
            message,
            partners: discussPartners,
            maxTurns: maxT || 2,
            apiKey: runtime.apiKey, provider: runtime.provider,
            baseUrl: runtime.baseUrl, model: runtime.model,
            budget: p.budget,
            cwd: p.cwd || process.cwd(),
            // P6 fix: 讨论事件直写 SSE（不加 plan_ 前缀），与 runDiscussion 同构
            onEvent: (type, payload) => {
              // Fix #1: runRoundtable 业务级 error 事件（如"未配置 API Key"）若以裸 `error` 写出，
              // 会触发 chat-api.js 的 reader.cancel + return 早退 → 后续 plan_* 事件永远到不了前端
              // → 执行卡片卡在"执行中"（球总实测"停不下来"根因）。改写为 plan_discuss_error 走 plan_ 主通道。
              if (type === 'error') {
                sse(res, { type: 'plan_discuss_error', ...(payload || {}) });
              } else {
                sse(res, { type, ...(payload || {}) });
              }
            },
            shouldAbort: () => watcher.isAborted(),
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`讨论超时（${Math.round(DISCUSS_TIMEOUT_MS / 1000)}s）`)), DISCUSS_TIMEOUT_MS)),
        ]);
        console.log('[runPlanTurn] 讨论完成, summary length=%d', (out && out.summary) ? out.summary.length : 0);
        return (out && out.summary) || '';
      } catch (e) {
        console.warn('[runPlanTurn] 讨论跳过: %s', e.message);
        emit('discussion-error', { message: `讨论跳过，直接生成方案：${e.message}` });
        return '';
      }
    };

    // ── 0. 协作工作流：前置多 Agent 讨论 ──
    if (discussBeforePlan) {
      discussionSummary = await doDiscuss(
        `我们需要完成以下目标：${objective}`,
        '💬 AI 讨论中（第1轮：目标分析）…',
        p.maxTurns || 4
      );
      if (discussionSummary) emit('collab_summary', { phase: 1, title: '📋 目标分析结论', text: discussionSummary.slice(0, 800) });
      emit('phase', { phase: 'plan', label: discussionSummary ? '✅ 讨论完成，方案制定中…' : '⚠️ 讨论未产出结论，直接制定方案…' });
      if (watcher.isAborted()) {
        emit('cancelled', { execId, phase: 'discuss', reason: '客户端断开' });
        return;
      }
    }

    // ── 1. 自然语言 → Plan ──
    if (!plan) {
      emit('status', { message: '正在把目标拆解成可执行步骤…' });
      const genFn = typeof p.generatePlanFn === 'function' ? p.generatePlanFn : generatePlanFromObjective;
      try {
        plan = await genFn(objective, runtime, { discussionContext: discussionSummary || undefined });
      } catch (e) {
        emit('error', { message: e.message || '计划生成失败', code: e.code || 'GEN_FAILED', phase: 'generate' });
        return;
      }
    }

    // 生成过程中用户已关页面 → 不浪费一次真实执行
    if (watcher.isAborted()) {
      emit('cancelled', { execId, phase: 'generate', reason: '客户端断开' });
      return;
    }

    emit('generated', summarizePlan(plan, execId));

    // ── 1.5（移除）协作工作流：方案审查讨论 ──
    // 《终止机制》DISCUSS→EXECUTE→REPORT 单向链路：目标分析讨论产出方案即冻结，
    // 执行前不再启动第 2 段审查讨论（让 AI 自审自己的方案 = 自证循环温床；
    // 且每次再启动一轮 opencode 23-35s，视觉上就是「又弹新一轮」）。
    // 执行后的终止结论（第 3 段）保留，未完成项不搁置：stopKind/stopReason + 断点续跑兜底。

    // ── 2. 执行参数（与 /api/plan/execute 同源语义，避免两条链路行为漂移）──
    const fullAuto = !!(perms && perms.fullAuto);
    const hasPlaceholderSteps = Array.isArray(plan.steps)
      && plan.steps.some((s) => s && (s._isPlaceholder || s.type === 'skip'));
    const autoReplan = !!(p.autoReplan || plan.autoReplan || fullAuto || hasPlaceholderSteps);
    const _mr = Number.isFinite(Number(p.maxRetries)) && Number(p.maxRetries) > 0 ? Number(p.maxRetries)
      : (Number.isFinite(Number(plan.maxRetries)) && Number(plan.maxRetries) > 0 ? Number(plan.maxRetries)
        : (Number(process.env.HESI_PLAN_MAX_RETRIES) || (autoReplan ? 2 : 0)));
    const maxRetries = Math.min(_mr, 5);

    const approvalTimeoutMs = Number(process.env.HESI_PLAN_APPROVAL_TIMEOUT) || 30 * 60 * 1000;

    // ── 3. 执行（事件实时流出）──
    result = await runPlan(plan, {
      cwd,
      workflowManager: wf,
      execId,
      onStep: (ev) => { emit('step', normalizeStepEvent(ev)); },
      // 决策①：断开即取消——步骤边界检查
      shouldAbort: () => watcher.isAborted(),
      // P4-2：审批闸对话式——通过共享登记表挂起等待，不再自动驳回
      // 🔓 允许完全访问：fullAccess=true 时直接通过，不挂起、不弹气泡
      // Plan B：但「宿主敏感写入强制审批」(info.mandatory) 不可被 fullAccess 跳过——
      // 否则 🔓 完全访问 + 误写 .env 会直接覆盖宿主配置（P0-A 事故复现）
      requestApproval: (info) => (fullAccess && !info.mandatory) ? Promise.resolve(true) : registerApproval(execId, info, approvalTimeoutMs, emit),
      permissions: perms,
      plannerRuntime: runtime,
      revisePlanFn: revisePlan,
      maxRetries,
      executorAgentId,
      runtimeIntercept: !!(plan.runtimeIntercept || fullAuto || process.env.HESI_PLAN_RUNTIME_INTERCEPT === '1'),
      // 轨道 B（AI 管线）步骤的 token/status/tool_call 实时事件桥接到同一 SSE 通道
      broadcastFn: emitAsBroadcastFn(emit),
      // P6：checkpoint 步自动触发讨论（复用同一组伙伴）
      roundtableFn: makeCheckpointDiscuss(),
    });

    // ── 4. RAG 回流（失败不影响主流程）──
    try {
      sinkPlanToIndex(plan, result, { startedAt, endedAt: Date.now(), agentId: executorAgentId });
    } catch { /* 回流失败不影响主流程 */ }

    if (watcher.isAborted()) {
      emit('cancelled', { execId, phase: 'execute', reason: '客户端断开', status: result && result.status });
      return;
    }

    // ── 4. 协作工作流：审核 + 生成报告（阶段分离）──
    // 方案《终止机制》：DISCUSS→EXECUTE→REPORT 单向不可逆，EXECUTE 失败禁止回讨论。
    // 终止原因由 runPlan 的确定性收敛信号（stopKind/stopReason，零 LLM）给出，
    // 比「再开一轮讨论」更可靠、更快、不产生新循环。
    if (discussBeforePlan && result) {
      const status = (result && result.status) || 'unknown';
      // 执行完全成功（done）→ 跳过审核，直接报告（避免对已完成任务展开新讨论）
      if (status === 'done') {
        emit('phase', { phase: 'done', label: '✅ 执行通过，协作完成' });
      } else {
        const stopKind = (result && result.stopKind) || null;
        const stopReason = (result && result.stopReason) || '';
        const stopNote = stopKind
          ? `收敛判定终止（${stopKind}）：${stopReason || '已停止以避免无限循环'}`
          : `执行未完成（${status}）${stopReason ? `：${stopReason}` : ''}`;
        emit('collab_summary', { phase: 3, title: '📋 终止结论', text: stopNote.slice(0, 800) });
        emit('phase', { phase: 'done', label: `⏹ ${stopNote}` });
      }
    }

    emit('done', {
      execId,
      ok: !!(result && result.ok),
      status: (result && result.status) || 'unknown',
      branch: (result && result.branch) || null,
      stepCount: Array.isArray(result && result.steps) ? result.steps.length : 0,
      acceptance: (result && result.acceptance) || null,
      reflection: (result && result.reflection) || null,
      attempts: (result && result.attempts) || null,
      durationMs: Date.now() - startedAt,
      discussed: !!discussionSummary,
      discussionSummary: discussionSummary || '',
    });
  } catch (err) {
    // 异常不吞：保留 message，stack 落服务端日志便于归因
    console.error('[runPlanTurn] 执行异常:', err && err.stack ? err.stack : err);
    emit('error', { message: (err && err.message) || '自动执行出错', stack: (err && err.stack) || null, phase: 'execute' });
  } finally {
    stopHeartbeat();
    watcher.dispose();
    sse(res, { type: '[DONE]' });
    try { res.end(); } catch { /* closed */ }
  }
}

module.exports = { runPlanTurn, sseEventName, summarizePlan };
