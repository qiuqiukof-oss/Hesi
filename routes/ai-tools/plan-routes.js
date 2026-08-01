/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 执行 HTTP 路由（Phase 0 — 全自动闭环的前端入口）
//
// POST /api/plan/execute  { plan, apiKey?, provider?, baseUrl?, model?, partners? }
//   → 调 runPlan(plan, {...}) 跑完整闭环，返回 { ok, status, branch, steps, reflection }。
//
// cwd 固定为 server 根（process.cwd()）；Phase 0 不接收任意路径，避免越权。
// roundtableFn 由本模块用 discuss.runRoundtable 包装（无配置时优雅降级为 diverged）。
// ============================================================

const express = require('express');
const crypto = require('crypto');
const { runPlan, parseVerifyFromSummary, readPlanState } = require('./run-plan');
const { workflowManager } = require('./workflow-manager');
const { runRoundtable } = require('../chat/discuss');
const { generatePlanFromObjective, revisePlan } = require('./plan-from-nl');
const { sinkPlanToIndex, sinkRoundtableToIndex, roundtableStableRef } = require('./plan-rag-sink');
const { recallPlans, recallRoundtables, listPlans, deletePlan, clearPlans } = require('./plan-rag-recall');
const { getPreset } = require('./roundtable-presets');
const { createWsEmitter, emitAsBroadcastFn, normalizeStepEvent } = require('./plan-emitter');
const { registerApproval, resolveApproval, cancelApproval } = require('../../lib/plan-approval');

/**
 * 解析 Plan 执行默认 Agent（可自选 / 圆桌式默认）。
 * - 前端显式选择 body.agentId 时优先用（'ai' 表示内置 AI 助手 LLM 管线，
 *   其余为外部 CLI agent id，走旧 agentPool 回退路径）。
 * - 未指定 → 圆桌式默认：AI 助手为本地推理方（'ai'），复用其已调好的 LLM 工具环。
 * @param {object} body 请求体（含可选 agentId）
 * @returns {string} 'ai' 或外部 agent id
 */
function resolveExecutorAgentId(body) {
  const sel = body && body.agentId;
  if (typeof sel === 'string' && sel.trim()) return sel.trim();
  return 'ai';
}

const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000; // 30min 无操作 → 视为驳回（共享登记表超时由 lib/plan-approval 管理）

// checkpoint 专用汇总指令：要求 LLM 直接产出「机器可自动验证」的验收 JSON
//（而非自然语言结论），使 parseVerifyFromSummary 能从中抽取出 {kind,command,expect}。
// 与 plan-contract._buildCheckpointQuestion 的返回契约对齐（含 "若无法机器验证返回 null"）。
const CHECKPOINT_SUMMARY_PROMPT = `你是这场「AI 助手 ↔ CLI Agent」协作讨论的**收敛裁判**。
请基于完整讨论记录，为【用户原问题】推导一个「机器可自动验证」的验收标准。

【用户原问题】
{QUESTION}

【完整讨论记录】
{TRANSCRIPT}

要求：
1. 只输出一个 JSON 对象，不要任何解释、前言或 markdown 代码块围栏：
   { "kind": "command"|"script"|"http", "command": "可执行的命令", "expect": "期望结果关键字" }
2. kind 必须是 command / script / http 之一（机器可自动执行验证；不要 manual）。
3. 若讨论确实无法推导出机器可验证的标准，只输出 JSON：null`;

/**
 * 用 discuss.runRoundtable 包装出 resolveCheckpoint 需要的 roundtableFn。
 * @param {object} runtime  { apiKey, provider, baseUrl, model, partner, partners }
 * @param {object} [budget] plan.budget（{ maxTokens?, maxMinutes? }）→ 透传进 runRoundtable 循环守卫
 * @param {{ execId?: string, emit?: (type:string, data?:object)=>void }} [ctx] 注入事件通道：
 *   - execId 与本次 /execute 关联，让前端能把 checkpoint 讨论事件渲染到对应舞台
 *   - emit   把 runRoundtable 的讨论事件（status/token/discuss_*）转发为 discuss-*，
 *            错误事件统一为 discussion-error（投递层加 plan: 前缀，
 *            前端 _onDiscussionEvent 已监听该分支）
 */
function buildRoundtableFn(runtime, budget, ctx) {
  const emit = ctx && typeof ctx.emit === 'function' ? ctx.emit : null;
  // 事件转发：错误统一 discussion-error；其余沿用 discuss-${type} 前缀
  //（前端 _onDiscussionEvent 按 plan:discuss- 前缀 + execId 匹配渲染，见 plan-drawer.js:590-592）。
  const forward = (type, payload) => {
    if (!emit) return;
    if (type === 'error') {
      emit('discussion-error', payload || {});
    } else {
      emit(`discuss-${type}`, payload || {});
    }
  };
  return async function roundtableFn({ question, transcript, rounds }) {
    const maxTurns = rounds || 3;
    // 快速失败①：无 API Key → 立即返回 null，避免 resolveCheckpoint 空转
    if (!runtime.apiKey && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      forward('error', { message: '未配置 API Key（OPENAI/ANTHROPIC），无法运行 checkpoint 圆桌讨论，退回需人补充 acceptance' });
      return null;
    }
    // 快速失败②：本地 LLM 不可达（如 LM Studio 未启动 / 地址错）→ 先验连通性，
    // 避免 runRoundtable 内部多轮空转再 fellBack。仅网络错误 / 超时 / 5xx 视为不可达。
    if (runtime.baseUrl) {
      const ctrl = new AbortController();
      const pt = setTimeout(() => ctrl.abort(), 4000);
      let unreachable = false, reason = '';
      try {
        const probeUrl = `${String(runtime.baseUrl).replace(/\/+$/, '')}/models`;
        const pr = await fetch(probeUrl, { signal: ctrl.signal, method: 'GET' });
        if (pr.status >= 500) { unreachable = true; reason = `HTTP ${pr.status}`; }
      } catch (pe) { unreachable = true; reason = pe.message; }
      finally { clearTimeout(pt); }
      if (unreachable) {
        forward('error', { message: `LLM 服务不可达（${runtime.baseUrl}）：${reason}；无法运行 checkpoint 圆桌讨论，退回需人补充 acceptance` });
        return null;
      }
    }
    // 后端显式打开执行阶段（非 M3 前置）的 checkpoint 圆桌舞台，让前端可见讨论过程
    if (emit) emit('discussion-start', { partners: Array.isArray(runtime.partners) ? runtime.partners : [], maxTurns, mode: 'checkpoint' });
    try {
      const out = await runRoundtable({
        message: question,
        partner: runtime.partner,
        partners: Array.isArray(runtime.partners) ? runtime.partners : [],
        maxTurns,
        apiKey: runtime.apiKey,
        provider: runtime.provider,
        baseUrl: runtime.baseUrl,
        model: runtime.model,
        transcript: transcript || '',
        budget,
        summaryPrompt: CHECKPOINT_SUMMARY_PROMPT,
        onEvent: forward,
        shouldAbort: null,
      });
      // 把推导出的验收结论回显到舞台（checkpoint 场景的 summary 即 verify 推导结论）
      if (emit && out && out.summary) emit('discussion-result', { summary: out.summary, cleanFinish: !!out.cleanFinish });
      return parseVerifyFromSummary(out && out.summary);
    } catch {
      return null; // 圆桌失败 → 交给 resolveCheckpoint 兜底回决策①
    }
  };
}

/**
 * @param {{ cwd?: string, workflowManager?: object, broadcastFn?: (data:object)=>void, approvalTimeoutMs?: number }} [opts]
 * @returns {express.Router}
 */
function createRouter(opts = {}) {
  const router = express.Router();
  const cwd = opts.cwd || process.cwd();
  const wf = opts.workflowManager || workflowManager;
  // 控制端点专用广播（approve / reject / discuss-confirm / cancel / 确认超时）：
  // 这些是独立 HTTP 端点，execId 来自 URL 参数而非某次执行上下文，故不走 emit 通道。
  // 执行核心（/execute 内）一律用 createWsEmitter 产出的 emit，见下方。
  const broadcast = (data) => { try { if (opts.broadcastFn) opts.broadcastFn(data); } catch { /* ignore */ } };
  // 前置讨论确认闸（M3）：discussMode==='confirm' 时，讨论结束后挂起 HTTP 等待用户确认，
  // 复用与审批闸相同的「挂起 HTTP + WS 广播 + 超时兜底」范式（超时默认自动继续，方案 P-B6）。
  const pendingDiscussions = new Map();
  // 防并发注册表：question stableRef -> Promise（方案 D-3）——同一目标的多请求共享一次讨论结果。
  const inFlightRoundtables = new Map();
  const waitDiscussionConfirm = (id) => new Promise((resolve) => {
    const timeoutMs = Number(process.env.HESI_PLAN_DISCUSS_CONFIRM_TIMEOUT) || 10 * 60 * 1000;
    const timer = setTimeout(() => {
      pendingDiscussions.delete(id);
      broadcast({ type: 'plan:discussion-timeout', execId: id });
      resolve(true); // 超时自动继续生成（方案 P-B6）
    }, timeoutMs);
    pendingDiscussions.set(id, { resolve, timer });
  });
  // 审批超时回退值（默认 30min）；测试可注入极小值以覆盖超时路径。
  // 真实请求可经 body.approvalTimeoutMs / plan.approvalTimeoutMs 按 plan 覆盖（见 /execute 处理器）。
  const factoryApprovalTimeoutMs = Number.isFinite(opts.approvalTimeoutMs) && opts.approvalTimeoutMs > 0
    ? opts.approvalTimeoutMs
    : APPROVAL_TIMEOUT_MS;

  router.post('/execute', async (req, res) => {
    const body = req.body || {};
    const objective = typeof body.objective === 'string' ? body.objective.trim() : '';
    const runtime = {
      apiKey: body.apiKey,
      provider: body.provider,
      baseUrl: body.baseUrl,
      model: body.model,
      partner: body.partner,
      partners: body.partners,
    };
    let plan = body.plan && typeof body.plan === 'object' ? body.plan : null;
    // ── M3：前置多角色讨论（先讨论方案再动手）──
    // execId 必须在讨论分支之前声明：讨论分支（broadcast/waitDiscussionConfirm）
    // 与后续执行流程都引用它，声明放后会造成 TDZ ReferenceError（catch 内二次
    // 抛出会逃逸出 try/catch，Express 4 不捕获 async 异常 → 请求挂起）。
    // 前端可传入 execId 以便 WS 事件与本次请求关联（必须是合法 UUID）。
    const providedExecId = typeof body.execId === 'string' ? body.execId.trim() : '';
    const execId = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(providedExecId)
      ? providedExecId
      : crypto.randomUUID();
    // 事件通道：执行核心只调 emit(type, data)，本路由注入 WS 广播投递（向后兼容旧抽屉）。
    // 必须与 execId 同段声明——下方讨论分支即引用（同一 handler 作用域内 const TDZ，
    // 见上方 execId 注释记录过的同类陷阱）。
    const emit = createWsEmitter(opts.broadcastFn, execId);
    // P3：客户端断开（响应连接关闭）即取消执行——驱动 execStepDirectly 的 shouldAbort/signal
    // 真杀子进程（决策①「断开即取消」在命令路径生效）。必须用 res 'close' + writableEnded 守卫：
    // req 'close' 在请求体接收完毕即触发（Node 语义=请求完成），会导致每次执行被提前 abort。
    const execAbort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) { try { execAbort.abort(); } catch { /* ignore */ } } });
    let discussionSummary = null;
    let discussionTranscript = '';
    const discussBeforePlan = !!body.discussBeforePlan;
    const discussTemplateId = typeof body.discussTemplateId === 'string' ? body.discussTemplateId : '';
    const discussMode = body.discussMode === 'auto' ? 'auto' : 'confirm'; // 默认 confirm（用户把关）
    const discussMaxTurns = Number.isFinite(Number(body.discussMaxTurns)) && body.discussMaxTurns > 0
      ? Math.min(Number(body.discussMaxTurns), 8) : 4;
    let discussPartners = Array.isArray(body.partners) ? body.partners.slice()
      : (typeof body.partners === 'string' && body.partners.trim() ? body.partners.split(',').map((s) => s.trim()).filter(Boolean) : []);
    let discussProtocol = null;
    let discussPersonas = null;
    if (discussTemplateId) {
      const tpl = getPreset(discussTemplateId);
      if (tpl) {
        discussProtocol = tpl.protocol || null;
        discussPersonas = Array.isArray(tpl.personas) ? tpl.personas : null;
        if (!discussPartners.length && Array.isArray(tpl.personas) && tpl.personas.length) {
          discussPartners = tpl.personas.map((p) => p.id); // best-effort：用 persona id 作 agent
        }
      }
    }
    if (discussBeforePlan && !plan && objective && discussPartners.length) {
      // 讨论结果回流（讨论库：跨工作线复用，方案 D）——同目标讨论执行完后沉淀，
      // 后续可通过 /history/search 召回「人工确认复用建议」（原问题 + 结论 + verify）。
      const sinkRoundtable = (summary, transcript) => {
        try {
          sinkRoundtableToIndex({
            question: objective,
            summary: summary || undefined,
            transcript: transcript || undefined,
            products: [],
            verify: '',
          });
        } catch { /* 讨论回流失败不影响主流程 */ }
      };
      // 防并发：同一目标（stableRef 键控）的讨论进行中 → 复用其结果，避免双跑烧钱（方案 D-3）
      const rtRef = roundtableStableRef(objective);
      let shared = inFlightRoundtables.get(rtRef);
      if (!shared) {
        shared = (async () => {
          try {
            emit('discussion-start', { objective });
            const out = await runRoundtable({
              message: objective,
              partners: discussPartners,
              personas: discussPersonas,
              protocol: discussProtocol,
              maxTurns: discussMaxTurns,
              apiKey: runtime.apiKey,
              provider: runtime.provider,
              baseUrl: runtime.baseUrl,
              model: runtime.model,
              budget: body.budget,
              onEvent: (type, payload) => {
                // 错误事件统一为 discussion-error（前端 _onDiscussionEvent 监听 plan:discussion-error）；
                // 其余事件沿用 discuss-${type} 前缀（status/token/discuss_start 等）。
                if (type === 'error') emit('discussion-error', payload || {});
                else emit(`discuss-${type}`, payload || {});
              },
              shouldAbort: () => false,
            });
            discussionSummary = (out && out.summary) ? out.summary : '';
            discussionTranscript = (out && out.transcript) ? out.transcript : '';
            sinkRoundtable(discussionSummary, discussionTranscript);
            emit('discussion-result', { summary: discussionSummary, cleanFinish: !!(out && out.cleanFinish) });
            return { summary: discussionSummary, transcript: discussionTranscript };
          } catch (de) {
            // 讨论失败/无 Key/无 Partner → 降级直接生成（方案 B6）
            emit('discussion-error', { message: de.message });
            discussionSummary = null;
            discussionTranscript = '';
            return { summary: '', transcript: '' };
          }
        })();
        inFlightRoundtables.set(rtRef, shared);
        shared.finally(() => { if (inFlightRoundtables.get(rtRef) === shared) inFlightRoundtables.delete(rtRef); }).catch(() => {});
      } else {
        // 复用进行中讨论：同目标并发请求共享结果（不重复广播 start，避免前端重复气泡）
        emit('discussion-shared', { objective });
        const reused = await shared;
        discussionSummary = reused && reused.summary ? reused.summary : '';
        discussionTranscript = reused && reused.transcript ? reused.transcript : '';
      }
      // 仅当讨论真正产出结论才挂起等确认；空结论（无 Key / 无产出）降级为直接生成（B6）
      if (discussMode === 'confirm' && discussionSummary) {
        const confirmed = await waitDiscussionConfirm(execId);
        if (!confirmed) {
          emit('discussion-cancelled', {});
          return res.json({ ok: false, execId, status: 'discussion-cancelled', error: '已取消：讨论后未确认执行' });
        }
      }
    }
    // 自然语言入口：给了 objective 且没手写 plan → 先让 AI 拆解成 plan
    if (!plan && objective) {
      try {
        plan = await generatePlanFromObjective(objective, runtime, { discussionContext: discussionSummary || undefined });
      } catch (e) {
        return res.status(400).json({ ok: false, error: e.message, code: e.code || 'GEN_FAILED' });
      }
    }
    if (!plan) {
      return res.status(400).json({ ok: false, error: '缺少 plan 对象（body.plan）或目标（body.objective）' });
    }
    // 审批超时：支持 per-plan 配置（body.approvalTimeoutMs / plan.approvalTimeoutMs），
    // 回退到路由工厂注入值，最终回退 30min 默认。大型多步重构可调长。
    const reqApprovalTimeoutMs = Number(body.approvalTimeoutMs);
    const planApprovalTimeoutMs = Number(plan && plan.approvalTimeoutMs);
    const approvalTimeoutMs =
      (Number.isFinite(reqApprovalTimeoutMs) && reqApprovalTimeoutMs > 0 && reqApprovalTimeoutMs) ||
      (Number.isFinite(planApprovalTimeoutMs) && planApprovalTimeoutMs > 0 && planApprovalTimeoutMs) ||
      factoryApprovalTimeoutMs;
    const executorAgentId = resolveExecutorAgentId(body);
    // 审批闸：登记到共享表，等待人工决议（超时兜底→驳回）
    const requestApproval = (reqInfo) => registerApproval(execId, reqInfo, approvalTimeoutMs, emit);
    try {
      // ② 反思重规划环 / ④ 运行时拦截开关（仅当显式开启或 fullAuto 时激活，默认关闭避免回归）
      const perms = (body.permissions && typeof body.permissions === 'object') ? body.permissions : null;
      const fullAuto = !!(perms && perms.fullAuto);
      // 占位符步骤（LLM 输出为空壳）自动启用 autoReplan：让反思重规划环重新生成 Plan
      // 一次，符合用户期望的"发现问题自动修复一次"能力（而非静默 done 或直接失败）。
      const hasPlaceholderSteps = Array.isArray(plan.steps)
        && plan.steps.some((s) => s && (s._isPlaceholder || s.type === 'skip'));
      const autoReplan = !!(body.autoReplan || plan.autoReplan || fullAuto || hasPlaceholderSteps);
      // C3：maxRetries 解析顺序 body > plan > HESI_PLAN_MAX_RETRIES(默认2) > 旧默认1；封顶5 防失控
      const _mr = Number.isFinite(Number(body.maxRetries)) && body.maxRetries > 0 ? body.maxRetries
        : (Number.isFinite(Number(plan.maxRetries)) && plan.maxRetries > 0 ? plan.maxRetries
          : (Number(process.env.HESI_PLAN_MAX_RETRIES) || (autoReplan ? 2 : 0)));
      const maxRetries = Math.min(_mr, 5);
      const startedAt = Date.now();
      const result = await runPlan(plan, {
        cwd,
        workflowManager: wf,
        roundtableFn: buildRoundtableFn(runtime, plan && plan.budget, { execId, emit }),
        execId,
        requestApproval,
        // ── 步骤级实时事件（P1 接通）──
        // runPlan 一直支持 opts.onStep(ev)，但此处从未传入 → 每个步骤的
        // start/done/error/blocked 全被丢弃，用户只能等 res.json 一次性返回，
        // 这正是「Plan 是个黑盒」的根源。现接到 emit 通道上。
        onStep: (ev) => { emit('step', normalizeStepEvent(ev)); },
        // 个性化「权限设置」下钻（来自前端 localStorage）
        permissions: perms,
        // 全自动 Phase 1 接线
        runtimeIntercept: !!(body.runtimeIntercept || plan.runtimeIntercept || fullAuto || process.env.HESI_PLAN_RUNTIME_INTERCEPT === '1'),
        plannerRuntime: runtime,
        revisePlanFn: revisePlan,
        maxRetries,
        // 执行默认 Agent：前端可自选（body.agentId）；未选则圆桌式默认 'ai'
        // （AI 助手 LLM 工具环，不重新实现）。
        executorAgentId,
        // 步骤执行（轨道 B / runStepViaChatLLM）实时事件：透传同一 emit 通道，
        // 否则 run-plan.js 读到的 opts.broadcastFn 永远为 undefined（原硬编码 undefined 导致过程黑盒）。
        // chat 管线发的是 { type, ... } 对象形态，用适配器桥接到 emit(type, data)。
        broadcastFn: emitAsBroadcastFn(emit),
        // P3：断连即取消——把响应断开信号透传给执行核心（execStepDirectly 据此 SIGKILL 子进程）
        shouldAbort: () => execAbort.signal.aborted,
        signal: execAbort.signal,
      });
      // ③ RAG 快照回流（成功/失败均沉淀，失败不影响主流程；M1 增强：传计时+执行Agent）
      const endedAt = Date.now();
      try {
        sinkPlanToIndex(plan, result, {
          startedAt, endedAt, agentId: executorAgentId,
          discussionSummary: discussionSummary || null,
          discussionTranscript: process.env.HESI_PLAN_RAG_SINK_DISCUSSION !== '0' ? discussionTranscript : '',
        });
      } catch { /* RAG 回流失败不影响主流程 */ }
      cancelApproval(execId);
      if (!res.writableEnded) return res.json({ ok: result.ok, execId, ...result });
      return; // 客户端已断开（执行中被取消），不再回写
    } catch (e) {
      cancelApproval(execId);
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 审批闸：人工通过（P4-2 共享登记表，WS emit 由 resolveApproval 内置）
  router.post('/:execId/approve', (req, res) => {
    if (!resolveApproval(req.params.execId, true)) {
      return res.status(404).json({ ok: false, error: '无待审批项（已结束或超时）' });
    }
    res.json({ ok: true });
  });

  // P0-2：断点续跑——状态查询 + 轻量引导
  router.get('/:execId/state', (req, res) => {
    const state = readPlanState(req.params.execId);
    if (!state) return res.json({ ok: false, error: '无可恢复的执行状态' });
    res.json({ ok: true, state });
  });

  // 审批闸：人工驳回
  router.post('/:execId/reject', (req, res) => {
    if (!resolveApproval(req.params.execId, false)) {
      return res.status(404).json({ ok: false, error: '无待审批项（已结束或超时）' });
    }
    res.json({ ok: true });
  });

  // ---------- 历史 Plan 检索 / 清理（v0.6.3 M1） ----------
  // 全部受 HESI_PLAN_RAG_SINK !== '0' 总开关 gate；失败静默降级。
  const ragEnabled = () => process.env.HESI_PLAN_RAG_SINK !== '0';

  // 列表（分页 + 按状态过滤）
  router.get('/history', (req, res) => {
    if (!ragEnabled()) return res.status(503).json({ ok: false, error: 'RAG 回流已关闭（HESI_PLAN_RAG_SINK=0）' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    try {
      res.json({ ok: true, ...listPlans({ limit, offset, status }) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 关键词召回（供 Plan 页搜索框 + M2 聊天召回；M3：同时召回历史讨论「人工确认复用建议」）
  router.get('/history/search', (req, res) => {
    if (!ragEnabled()) return res.status(503).json({ ok: false, error: 'RAG 回流已关闭（HESI_PLAN_RAG_SINK=0）' });
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!q) return res.json({ ok: true, items: [] });
    const topK = Math.min(Number(req.query.topK) || 5, 20);
    try {
      const plans = recallPlans(q, { topK });
      const roundtables = recallRoundtables(q, { topK });
      res.json({ ok: true, items: [...roundtables, ...plans], plans, roundtables });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 精确删除一条历史
  router.delete('/history/:ref', (req, res) => {
    if (!ragEnabled()) return res.status(503).json({ ok: false, error: 'RAG 回流已关闭（HESI_PLAN_RAG_SINK=0）' });
    try {
      const ok = deletePlan(req.params.ref);
      res.json({ ok });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 清空全部历史（前端须二次确认）
  router.delete('/history', (req, res) => {
    if (!ragEnabled()) return res.status(503).json({ ok: false, error: 'RAG 回流已关闭（HESI_PLAN_RAG_SINK=0）' });
    try {
      clearPlans();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // 前置讨论确认（M3）：confirm 模式在讨论结束后挂起 HTTP 等待用户确认才继续生成+执行
  router.post('/:execId/discuss-confirm', (req, res) => {
    const p = pendingDiscussions.get(req.params.execId);
    if (!p) return res.status(404).json({ ok: false, error: '无待确认讨论（已结束或超时）' });
    clearTimeout(p.timer);
    pendingDiscussions.delete(req.params.execId);
    broadcast({ type: 'plan:discussion-confirmed', execId: req.params.execId });
    p.resolve(true);
    res.json({ ok: true });
  });
  router.post('/:execId/discuss-cancel', (req, res) => {
    const p = pendingDiscussions.get(req.params.execId);
    if (!p) return res.status(404).json({ ok: false, error: '无待确认讨论（已结束或超时）' });
    clearTimeout(p.timer);
    pendingDiscussions.delete(req.params.execId);
    broadcast({ type: 'plan:discussion-cancelled', execId: req.params.execId });
    p.resolve(false);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createRouter, buildRoundtableFn, resolveExecutorAgentId };
