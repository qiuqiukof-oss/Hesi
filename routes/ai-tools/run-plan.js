/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Plan 执行器（Phase 0 — 全自动闭环的"手脚"）
//
// 把通过 gate 的 plan 真正跑起来：
//   1. gatePlan 闸门（决策①）                 —— 不可机器验证即拒收
//   2. openPlanBranch 开 auto-<id> 分支         —— 爆震半径容器
//   3. 逐步：
//        a. budget.tickRound()                 —— 经济/轮数预算
//        b. checkInterception()                —— #34 scope/forbidden 真实前置拦截
//        c. snapshotStep() 步前快照            —— 失败可 rollback 到上锚点
//        d. checkpoint 步 → resolveCheckpoint  —— 决策② 圆桌推导验收（roundtableFn 注入）
//        e. workflowManager 单步执行 + 轮询     —— 复用现有 DAG 引擎
//        f. 失败 → rollbackTo(本步快照)         —— 仅撤销本步改动
//   4. 闭环结束 closeBranch（保留 auto 分支供审计）
//   5. runAcceptance() 跑验收命令              —— 机器可验证闭环
//   6. reflectPlan() → done/partial/diverged   —— #36 反思残差
//
// 解耦：roundtableFn 由调用方注入（路由层用 discuss.runRoundtable 包装），
//       便于单测 mock，避免本文件硬依赖 discuss.js。
// ============================================================

const { execFileSync } = require('child_process');
const { gatePlan, resolveCheckpoint } = require('./plan-contract');
const { planToWorkflowTasks, inScope, isForbidden } = require('./plan-to-workflow');
const { PlanBudget } = require('../../lib/plan-budget');
const { openPlanBranch, snapshotStep, rollbackTo, closeBranch, isRepo } = require('../../lib/plan-git');
const { revisePlan: defaultRevisePlan } = require('./plan-from-nl');

// ── 工具 ──

/** 从圆桌 summary 文本里抽取 {kind,command,expect} JSON（容错：宽松匹配首个 JSON 块） */
function parseVerifyFromSummary(text) {
  if (!text) return null;
  const s = String(text);
  // 先尝试整段 JSON
  try {
    const o = JSON.parse(s.trim());
    if (o && o.kind) return normalizeVerify(o);
  } catch { /* not a bare JSON */ }
  // 再尝试抠出 ```json ... ``` 或 { ... }
  const m = s.match(/\{[\s\S]*?"kind"[\s\S]*?\}/);
  if (m) {
    try {
      const o = JSON.parse(m[0]);
      if (o && o.kind) return normalizeVerify(o);
    } catch { /* ignore */ }
  }
  return null;
}

function normalizeVerify(o) {
  return {
    kind: String(o.kind),
    command: typeof o.command === 'string' ? o.command : '',
    expect: typeof o.expect === 'string' ? o.expect : '',
  };
}

/** 抽出文本里疑似文件路径的 token（含 '/'，用于 scope 校验） */
function _pathTokens(text) {
  if (!text) return [];
  return String(text)
    .split(/[\s"'`|;]+/)
    .filter((t) => t && t.includes('/'));
}

/**
 * #34 真实前置拦截：scope_paths / forbidden。
 * 返回 reason（被拦）或 null（放行）。
 * @param {object} plan
 * @param {object} step 含 action / verify
 */
function checkInterception(plan, step) {
  const candidate = [step.action, step.verify && step.verify.command]
    .filter(Boolean)
    .join(' ');
  if (isForbidden(plan, candidate)) {
    return { reason: `命中 forbidden 黑名单: ${candidate.slice(0, 100)}` };
  }
  const scopes = Array.isArray(plan.scope_paths) ? plan.scope_paths : [];
      if (scopes.length) {
    for (const tok of _pathTokens(candidate)) {
      if (!inScope(plan, tok)) {
        return { reason: `路径越界（不在 scope_paths 内）: ${tok}` };
      }
    }
  }
  return null;
}

/**
 * P2.6 审批闸：判断某步是否需要人工审批。
 * @param {object} plan
 * @param {object} step
 * @returns {boolean}
 */
function stepRequiresApproval(plan, step) {
  if (step && step.requireApproval === true) return true;
  if (plan && plan.approvalPolicy === 'all') return true;
  return false;
}

// ── 单步工作流执行 + 轮询 ──

const POLL_MS = 1000;
const STEP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 直执模式：对「命令型」步骤（action 是可执行 shell 命令）绕过 agentPool，
 * 直接用 child_process.execSync 执行，避免无 Agent 时整步 FAILED。
 *
 * 判定标准复用 isPossibleCommand()（已知命令名 / 含 shell 元字符）。
 * Windows 下优先 sh（Git Bash），降级 cmd /c。
 *
 * @param {object} step  plan.steps[i]（含 action）
 * @param {string} [cwd] 工作目录
 * @returns {{ status: string, output: string }}
 */
function execStepDirectly(step, cwd) {
  const action = String(step.action || '').trim();
  if (!action) return { status: 'error', output: '步骤 action 为空' };
  try {
    const { execSync } = require('child_process');
    // Windows: 优先 sh（Git Bash），捕获退出码；降级 cmd
    const opts = {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: STEP_TIMEOUT_MS,
    };
    let out;
    try {
      out = execSync(`set -e; ${action}`, { ...opts, shell: '/bin/sh' });
    } catch {
      // /bin/sh 不可用（纯 Windows）→ 降级 cmd
      try {
        out = execSync(action, { ...opts, shell: true });
      } catch (cmdErr) {
        return {
          status: 'error',
          output: `命令执行失败（exit code ${cmdErr.status || '?'}）: ${String(cmdErr.stderr || '').slice(0, 500) || cmdErr.message}`,
        };
      }
    }
    return { status: 'done', output: String(out).slice(0, 5000) };
  } catch (e) {
    return { status: 'error', output: `直执异常: ${e.message}` };
  }
}

/**
 * 判断任务是否应走「直执模式」（绕过 agentPool）。
 * 条件：task.task（即 step.action）是可执行命令 OR 步骤显式声明 type:'command'。
 */
function shouldExecDirectly(task, step) {
  if (step && step.type === 'command') return true;
  return isPossibleCommand(task && task.task);
}

async function runSingleTask(wf, task) {
  let startJson;
  try {
    startJson = JSON.parse(await wf.start(`plan-step-${task.id}`, [task], { maxConcurrency: 1 }));
  } catch (e) {
    return { status: 'error', output: `workflow start 异常: ${e.message}` };
  }
  if (!startJson.ok) return { status: 'error', output: startJson.error || 'start failed' };
  const wfId = startJson.workflowId;
  const t0 = Date.now();
  while (Date.now() - t0 < STEP_TIMEOUT_MS) {
    let st;
    try {
      st = JSON.parse(await wf.status(wfId));
    } catch (e) {
      return { status: 'error', output: `workflow status 异常: ${e.message}` };
    }
    if (!st.ok) return { status: 'error', output: st.error || 'status failed' };
    const t = (st.tasks || []).find((x) => x.id === task.id);
    if (t && ['completed', 'failed', 'skipped'].includes(t.status)) {
      return { status: t.status, output: t.output || '', error: t.error || '' };
    }
    await new Promise((r) => { setTimeout(r, POLL_MS); });
  }
  return { status: 'timeout', output: '' };
}

// ── 验收执行（机器可验证闭环） ──

/**
 * 跑 plan.acceptance 里的机器可验证项，返回通过情况。
 * command/script 走 child_process；http 走原生 fetch（node18+）。
 * @param {object} plan
 * @param {{ cwd?: string }} [opts]
 */
function runAcceptance(plan, opts = {}) {
  const acc = Array.isArray(plan && plan.acceptance) ? plan.acceptance : [];
  const cwd = opts.cwd || process.cwd();
  const results = acc.map(async (a) => {
    const base = { id: a.id || '?', kind: a.kind, command: a.command || a.expect || '' };
    if ((a.kind === 'command' || a.kind === 'script') && typeof opts.securityCheck === 'function') {
      if (!opts.securityCheck(a.command)) {
        return { ...base, pass: false, error: '被运行时策略拦截（HESI_PLAN_RUNTIME_INTERCEPT）', blocked: true };
      }
    }
    try {
      if (a.kind === 'command' || a.kind === 'script') {
        const out = execFileSync('sh', ['-c', a.command], {
          cwd,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const pass = !a.expect || out.includes(a.expect);
        return { ...base, pass, output: String(out).slice(0, 500) };
      }
      if (a.kind === 'http') {
        // 简易 GET + expect 命中（AbortController 做超时）
        const url = String(a.command || '').trim();
        if (!/^https?:\/\//.test(url)) return { ...base, pass: false, error: 'http 验收需合法 URL' };
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(url, { signal: controller.signal });
          const body = await res.text();
          clearTimeout(timer);
          const pass = res.ok && (!a.expect || body.includes(a.expect));
          return { ...base, pass, output: body.slice(0, 500) };
        } catch (e) {
          return { ...base, pass: false, error: e.message };
        }
      }
      return { ...base, pass: false, error: `不支持的验收 kind: ${a.kind}` };
    } catch (e) {
      return { ...base, pass: false, error: e.message };
    }
  });
  // 同步/异步归一
  return Promise.all(results).then((rs) => {
    const allPass = rs.length > 0 && rs.every((r) => r.pass);
    return { results: rs, allPass };
  });
}

// ── 反思残差（#36） ──

/**
 * 根据逐步结果与验收，判定闭环状态。
 * @returns {{ status: 'done'|'partial'|'diverged', reason?: string, stepsDone: number, stepsTotal: number, acceptancePassRate: number|null, budget?: object }}
 */
function reflectPlan(plan, stepResults, budget, acceptance) {
  const total = stepResults.length;
  const done = stepResults.filter((s) => s.status === 'done').length;
  const blocked = stepResults.filter((s) => s.status === 'blocked');
  const fatal = stepResults.filter((s) =>
    ['loop', 'budget', 'timeout', 'rejected'].includes(s.status)
  );
  const diverged =
    blocked.some((b) => b.needsAcceptance) || fatal.length > 0;

  let status;
  let reason;
  if (total === 0) {
    status = 'rejected';
    reason = '无步骤被执行（plan 为空或被闸门拒收）';
  } else if (diverged) {
    status = 'diverged';
    reason = fatal.length
      ? `执行异常需人工干预: ${fatal[0].reason || fatal[0].status}`
      : '存在需人工补充 acceptance 的 checkpoint 断点';
  } else if (done === total) {
    status = 'done';
  } else {
    status = 'partial';
    reason = `部分步骤未完成（done=${done}/${total}）`;
  }

  let acceptancePassRate = null;
  if (acceptance) {
    const n = acceptance.results.length;
    acceptancePassRate = n ? acceptance.results.filter((r) => r.pass).length / n : null;
    if (status === 'done' && !acceptance.allPass) {
      status = 'partial';
      reason = '步骤全部完成，但机器验收未全部通过';
    }
  }

  const out = { status, reason, stepsDone: done, stepsTotal: total, acceptancePassRate };
  if (budget) out.budget = { rounds: budget.rounds, tokens: budget.tokens };
  return out;
}

// ── 主入口 ──

/**
 * 执行一个通过合约的 plan。
 * @param {object} plan
 * @param {object} opts
 * @param {string} [opts.cwd]                 git 仓库根（无则降级为无快照执行）
 * @param {Function} [opts.roundtableFn]      async ({question,transcript,rounds}) => ({kind,command,expect}|null)
 * @param {object} [opts.workflowManager]     workflow-manager 实例（start/status）
 * @param {object} [opts.budget]              覆盖 plan.budget（测试注入）
 * @param {boolean} [opts.dryRun]             不真正跑 workflow（仅校验/快照演示）
 * @param {boolean} [opts.runAcceptance]      结束后跑验收（默认 true；dryRun 时强制 false）
 * @param {Function} [opts.onStep]            async (ev) => {} 逐步事件（UI 流式）
 * @param {Function} [opts.shouldAbort]       () => boolean 人工中止
 * @param {string} [opts.execId]              执行实例 ID（审批闸关联用）
 * @param {Function} [opts.requestApproval]   async (req)=>boolean 审批闸：暂停等待人工决议（true=通过 / false=驳回）
 * @param {object} [opts.permissions]         个性化「权限设置」下钻：
 *        { mode?: 'ask'|'auto'|'strict', autoReview?: boolean, fullAuto?: boolean }
 *        - autoReview=false → 跳过 gatePlan 可验证性闸门（危险，默认开启）
 *        - fullAuto=true     → 置 plan.allow_external=true（开启外部副作用，Phase 1 运行时拦截消费）
 *        - mode 当前仅落库，chat Agent HITL 留 Phase 1
 * @returns {Promise<{ ok: boolean, status: string, branch: string|null, steps: object[], reflection: object }>}
 */
async function runPlan(plan, opts = {}) {
  const cwd = opts.cwd;
  const wf = opts.workflowManager;
  const roundtableFn = opts.roundtableFn;
  const onStep = typeof opts.onStep === 'function' ? opts.onStep : () => {};
  const dryRun = !!opts.dryRun;
  const runAcc = opts.runAcceptance !== false && !dryRun;

  // 个性化权限下钻（来自 /api/plan/execute 的 body.permissions）
  const perms = opts.permissions || null;
  if (perms && perms.fullAuto) plan.allow_external = true; // 开启外部副作用（Phase 1 运行时拦截消费）
  const skipGate = !!(perms && perms.autoReview === false);

  // 决策①：可验证性闸门
  const gate = skipGate ? { ok: true } : gatePlan(plan);
  if (!gate.ok) {
    const ev = { status: 'rejected', reason: gate.reason, missing: gate.missing };
    await onStep(ev);
    return {
      ok: false,
      status: 'rejected',
      branch: null,
      missing: gate.missing,
      steps: [ev],
      reflection: reflectPlan(plan, [ev], null, null),
    };
  }

  // ── ② 反思重规划环：熔断/diverged 时自动修订重跑，上限 maxRetries ──
  const maxRetries = Number.isFinite(Number(opts.maxRetries)) && opts.maxRetries >= 0 ? opts.maxRetries : 0;
  const plannerRuntime = opts.plannerRuntime || null;
  const reviseFn = typeof opts.revisePlanFn === 'function' ? opts.revisePlanFn : defaultRevisePlan;

  let currentPlan = plan;
  let lastBody = null;
  const attempts = [];
  for (let attempt = 0; ; attempt++) {
    const body = await runOneAttempt(currentPlan, { cwd, wf, roundtableFn, onStep, dryRun, runAcc, skipGate, opts });
    lastBody = body;
    attempts.push({ planId: currentPlan.id, status: body.reflection.status });
    const st = body.reflection.status;
    if (st === 'done' || st === 'rejected') break;
    if (attempt >= maxRetries) break;
    let revised = null;
    try { revised = await reviseFn(currentPlan, body, plannerRuntime); } catch { revised = null; }
    if (!revised) break;
    currentPlan = revised;
  }

  return {
    ok: lastBody.reflection.status === 'done' || lastBody.reflection.status === 'partial',
    status: lastBody.reflection.status,
    branch: lastBody.branch,
    steps: lastBody.results,
    reflection: lastBody.reflection,
    attempts,
    revised: attempts.length > 1,
  };
}

// ── 单次尝试：开分支 → 逐步执行 → 验收 → 反思 ──
async function runOneAttempt(plan, ctx) {
  const { cwd, wf, roundtableFn, onStep, dryRun, runAcc, opts } = ctx;
  const haveGit = !!cwd && isRepo(cwd);
  let branch = null;
  const interceptEnabled = !!(plan.runtimeIntercept || (opts && opts.runtimeIntercept) || process.env.HESI_PLAN_RUNTIME_INTERCEPT === '1');
  const evalCmd = interceptEnabled ? makeEvalCmd() : null;
  if (haveGit) {
    try {
      branch = openPlanBranch(cwd);
    } catch {
      branch = null; // 降级：无快照
    }
  }

  const budget = new PlanBudget(opts.budget || plan.budget || {});
  const tasks = planToWorkflowTasks(plan, { defaultAgentId: opts && opts.defaultAgentId });
  const results = [];
  const rounds = (plan.budget && plan.budget.maxRounds) || 3;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const step = plan.steps[i] || {};
    const ev = { index: i, id: task.id, goal: task.label, status: 'start' };

    // 人工中止
    if (typeof opts.shouldAbort === 'function' && opts.shouldAbort()) {
      ev.status = 'aborted';
      ev.reason = '人工中止';
      results.push(ev);
      await onStep(ev);
      break;
    }

    // 预算轮数
    const tick = budget.tickRound();
    if (!tick.ok) {
      ev.status = 'budget';
      ev.reason = tick.reason;
      results.push(ev);
      await onStep(ev);
      break;
    }

    // #34 真实前置拦截
    const intercept = checkInterception(plan, step);
    if (intercept) {
      ev.status = 'blocked';
      ev.reason = intercept.reason;
      results.push(ev);
      await onStep(ev);
      if (!step.on_fail || step.on_fail === 'stop') break;
      continue;
    }

    // ④ 运行时逐工具强制拦截（接 mcp/security/policy.evaluateAiExec）
    if (evalCmd) {
      const secReason = evaluateStepSecurity(step, evalCmd);
      if (secReason) {
        ev.status = 'blocked';
        ev.reason = secReason;
        results.push(ev);
        await onStep(ev);
        if (!step.on_fail || step.on_fail === 'stop') break;
        continue;
      }
    }

    // 步前快照（失败可 rollback）
    let snapSha = null;
    if (haveGit) {
      try {
        snapSha = snapshotStep(cwd, `plan: step ${i + 1} ${task.label}`, plan.scope_paths);
      } catch { /* 忽略 */ }
    }
    ev.snapshot = snapSha;

    // 决策②：checkpoint 软断点 → 圆桌推导验收
    let effectiveStep = step;
    if (step.checkpoint) {
      const cp = await resolveCheckpoint(plan, step, { rounds, roundtableFn });
      ev.checkpoint = cp;
      if (!cp.ok) {
        ev.status = 'blocked';
        ev.reason = cp.reason;
        ev.needsAcceptance = cp.needsAcceptance;
        results.push(ev);
        await onStep(ev);
        if (!step.on_fail || step.on_fail === 'stop') break;
        continue;
      }
      if (cp.derivedVerify) effectiveStep = { ...step, verify: cp.derivedVerify };
    }

    // 决策③（P2.6 审批闸）：需人工审批的步 → 暂停等待决议
    if (stepRequiresApproval(plan, step)) {
      ev.status = 'await-approval';
      ev.requiresApproval = true;
      await onStep(ev); // 通知前端出闸门卡片
      let approved = true;
      if (typeof opts.requestApproval === 'function') {
        approved = await opts.requestApproval({
          execId: opts.execId,
          index: i,
          id: task.id,
          goal: task.label,
          action: step.action,
          risk: step.risk || null,
        });
      }
      if (!approved) {
        ev.status = 'rejected';
        ev.reason = '人工驳回（审批闸）';
        ev.requiresApproval = false;
        results.push(ev);
        await onStep(ev);
        break;
      }
      ev.status = 'start'; // 审批通过，继续
      ev.requiresApproval = false;
    }

    // 真正执行（双轨：命令型直执 / Agent 型走 workflow）
    let exec;
    if (dryRun) {
      exec = { status: 'skipped', output: '(dryRun)' };
    } else if (shouldExecDirectly(task, step)) {
      // 轨道 A：直执模式 — action 是 shell 命令，绕过 agentPool
      exec = execStepDirectly(step, cwd);
    } else if (!wf) {
      exec = { status: 'skipped', output: '(no workflowManager)' };
    } else {
      // 轨道 B：Agent 模式 — 自然语言指令，分派给 CLI Agent
      exec = await runSingleTask(wf, { ...task, verify: effectiveStep.verify, checkpoint: !!effectiveStep.checkpoint });
    }
    ev.status = exec.status === 'completed' ? 'done' : exec.status;
    ev.output = exec.output || '';

    // 连续重复熔断
    const loop = budget.checkLoop(`${task.id}:${ev.status}`);
    if (!loop.ok) {
      ev.status = 'loop';
      ev.reason = loop.reason;
    }

    results.push(ev);
    await onStep(ev);

    // 失败 → 回滚到本步快照（仅撤销本步改动）
    if (ev.status === 'failed' || ev.status === 'error') {
      if (haveGit && snapSha) {
        try { rollbackTo(cwd, snapSha); } catch { /* 忽略 */ }
      }
      if (!step.on_fail || step.on_fail === 'stop') break;
    }
    if (['loop', 'budget', 'timeout'].includes(ev.status)) break;
  }

  // 闭环：最终快照 + 切回原分支（保留 auto 分支供审计）
  if (haveGit) {
    try { snapshotStep(cwd, 'plan: final', plan.scope_paths); } catch { /* 忽略 */ }
    try { closeBranch(cwd); } catch { /* 忽略 */ }
  }

  // 验收（机器可验证闭环）
  let acceptance = null;
  if (runAcc) {
    try {
      const accOpts = { cwd: cwd || process.cwd() };
      if (evalCmd) accOpts.securityCheck = (c) => evalCmd(c);
      acceptance = await runAcceptance(plan, accOpts);
    } catch {
      acceptance = null;
    }
  }

  const reflection = reflectPlan(plan, results, budget, acceptance);
  return { branch, results, reflection };
}

// ── ④ 运行时策略评估（懒加载 policy，避免耦合与测试污染） ──
let _policyMod = undefined;
function makeEvalCmd() {
  if (_policyMod === undefined) {
    try { _policyMod = require('../../mcp/security/policy'); } catch { _policyMod = null; }
  }
  if (!_policyMod || typeof _policyMod.evaluateAiExec !== 'function') return () => true; // 降级放行
  return (cmd) => { try { return _policyMod.evaluateAiExec(cmd).allowed !== false; } catch { return true; } };
}

const SHELL_METACHAR = /[;&|`$()<>#\n\r]/;
const KNOWN_BASE = /^(rm|dd|mkfs|shutdown|reboot|halt|poweroff|chmod|chown|kill|pkill|sudo|su|reg|format|diskpart|fdisk|curl|wget|node|node\.exe|python|python3|npm|npx|sh|bash|cmd|powershell|git|docker|kubectl|ls|cat|echo|cp|mv|mkdir|touch|sed|awk|grep|find|tar|zip|unzip|gh|cargo|go|make|cmake|gcc|clang|ruby|perl|php|java|tsc|eslint|prettier)\b/i;

function isPossibleCommand(s) {
  if (!s) return false;
  if (SHELL_METACHAR.test(s)) return true;
  const base = s.trim().split(/\s+/)[0] || '';
  return KNOWN_BASE.test(base);
}

function evaluateStepSecurity(step, evalCmd) {
  const cand = [];
  const action = step && step.action;
  if (isPossibleCommand(action)) cand.push(action);
  const vcmd = step && step.verify && step.verify.command;
  if (vcmd) cand.push(vcmd);
  for (const c of cand) {
    if (!evalCmd(c)) return `运行时策略拦截（policy.evaluateAiExec 拒绝）: ${String(c).slice(0, 100)}`;
  }
  return null;
}

module.exports = {
  runPlan,
  parseVerifyFromSummary,
  checkInterception,
  runAcceptance,
  reflectPlan,
  stepRequiresApproval,
  evaluateStepSecurity,
  execStepDirectly,
  shouldExecDirectly,
};
