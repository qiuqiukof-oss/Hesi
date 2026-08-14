/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Orchestrator — WorkBuddy-style multi-agent orchestration engine
//
// Replaces the old linear workflow engine with a faithful model of
// WorkBuddy's orchestration primitives:
//   - Task DAG (dependencies via dependsOn / blockedBy)
//   - Scheduler with a ready-queue + bounded concurrency
//   - Failure propagation (skip-dependents / stop / continue)
//   - Per-task retries
//   - Dynamic task decomposition (addTask mid-run — the "planner" pattern)
//   - Human-in-the-loop (await_human)
//   - Structured context passing (no blind 2000-char truncation)
//   - Agent message bus (SendMessage emulation: request/response
//     correlation, best-effort over the PTY stdin/stdout channel)
//   - Rich task-board events (task:*) alongside legacy workflow:* stream
//
// "Agents" in Hesi are headless PTY CLIs (opencode/claude/codex/...).
// We cannot make them autonomous LLM loops, but we faithfully replicate
// the *orchestration structure* that governs them.
//
// Backward compatible: a flat `{ steps: [...] }` definition is auto-
// converted into a linear DAG (each step depends on the previous one),
// and the legacy `workflow:*` WS stream is still emitted.
// ============================================================

const { RingBuffer } = require('../ring-buffer');
// 技能库：把 WorkBuddy 连接器缓存里的 SKILL.md 摄入为 Hesi 原生技能。
// 任务可通过 skillId 引用某个技能，运行时把其正文前置进 prompt 作为可执行指引。
const skillRegistry = require('../skills/registry');
// 专家库：把 WorkBuddy 专家摄入为 Hesi 原生可选角色（人设 + 可用技能/连接器边界）。
// 任务可通过 expertId 引用某专家，运行时把其人设前置进 prompt（优先级高于 role）。
const expertRegistry = require('../ws/experts');
// 网页端点执行器：让自定义编排可把一个子任务路由到网页端免费模型，并发后由下游汇聚。
// 同时提供能力声明（getCapabilityBriefing），注入 prompt 让内置助手/终端 agent 知道这条路存在。
const { runWebEndpoint, getCapabilityBriefing } = require('./web-executor');

const STATUS = {
  PENDING: 'pending',
  BLOCKED: 'blocked',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  WAITING_HUMAN: 'waiting_human',
};

// 单 agent 任务回调等待超时：默认 2 分钟，env HESI_AGENT_STEP_TIMEOUT_MS 可调
// （建议 60-300s，给足思考时间但有限度；复杂委派任务可调大）。
const DEFAULT_STEP_TIMEOUT = (() => {
  const v = Number(process.env.HESI_AGENT_STEP_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 120000;
})();
const DEFAULT_CONTEXT_CAP = 8000;      // structured context injected into dependents
// agent:msg request/response 等待超时：默认 60s，env HESI_AGENT_BUS_TIMEOUT_MS 可调
const BUS_TIMEOUT = (() => {
  const v = Number(process.env.HESI_AGENT_BUS_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 60000;
})();

// Envelope used to emulate SendMessage over a PTY's stdin/stdout channel.
const REQ_RE = /<workbuddy-msg[^>]*kind=["']request["'][^>]*msgId=["']([^"']+)["'][^>]*>([\s\S]*?)<\/workbuddy-msg>/g;
const RES_RE = /<workbuddy-msg[^>]*kind=["']response["'][^>]*msgId=["']([^"']+)["'][^>]*>([\s\S]*?)<\/workbuddy-msg>/g;

/**
 * Create an orchestrator instance.
 * @param {object} deps
 * @param {Function} deps.createHeadlessPTY
 * @param {Function} deps.getAgentCommand
 * @param {Function} deps.lookupCommand
 * @param {object}   deps.contextStore
 */
function createOrchestrator({ createHeadlessPTY, getAgentCommand, lookupCommand, contextStore }) {
  // A single client (ws) may now run multiple workflows concurrently, so each
  // ws maps to a Map<wfId, runState> rather than a single run. Previously a
  // second run() on the same ws silently overwrote the first (orphaning it and
  // corrupting activeRuns cleanup) — this structure fixes that latent bug.
  /** @type {Map<object, Map<number, object>>} Map<ws, Map<wfId, runState>> */
  const activeRuns = new Map();
  let idCounter = 0;
  const nextId = () => ++idCounter;

  /** All runs for a ws (insertion-ordered), or undefined. */
  const runsFor = (ws) => activeRuns.get(ws);
  /** Most-recently-started run for a ws (used when no wfId is specified). */
  function latestRun(ws) {
    const runs = activeRuns.get(ws);
    if (!runs || runs.size === 0) return null;
    let last = null;
    for (const rs of runs.values()) last = rs; // Map preserves insertion order
    return last;
  }
  /** Resolve a run by explicit wfId, else fall back to the latest run. */
  function resolveRun(ws, wfId) {
    if (wfId != null) return activeRuns.get(ws)?.get(wfId) || null;
    return latestRun(ws);
  }
  /** Remove a finished/cancelled run and prune the ws entry when empty. */
  function removeRun(ws, wfId) {
    const runs = activeRuns.get(ws);
    if (!runs) return;
    runs.delete(wfId);
    if (runs.size === 0) activeRuns.delete(ws);
  }

  // ──────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────

  function emit(ws, obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket closing — drop */ }
    }
  }

  function serializeTask(t) {
    return {
      id: t.id,
      label: t.label,
      agentId: t.agentId || null,
      role: t.role || null,
      roleName: t.roleName || null,
      skillId: t.skillId || null,
      expertId: t.expertId || null,
      executor: t.executor || null,
      mode: t.mode,
      type: t.type,
      dependsOn: t.dependsOn || [],
      status: t.status,
      retries: t.retries,
      maxRetries: t.maxRetries,
      onFailure: t.onFailure,
      error: t.error || null,
      startedAt: t.startedAt || null,
      endedAt: t.endedAt || null,
    };
  }

  // Convert a legacy flat `step` into a DAG task (dependsOn previous).
  function stepToTask(step, index, prevId) {
    return {
      id: step.id || (`step-${  index + 1}`),
      label: step.label || (step.task ? step.task.slice(0, 48) : (`Task ${  index + 1}`)),
      agentId: step.agentId,
      task: step.task,
      role: step.role || null,
      roleName: step.roleName || null,
      persona: step.persona || null,
      skillId: step.skillId || null,
      expertId: step.expertId || null,
      executor: step.executor || null,
      mode: step.mode || 'serial',
      agents: step.agents,
      type: step.type || 'agent',
      dependsOn: prevId ? [prevId] : (step.dependsOn || []),
      status: STATUS.PENDING,
      retries: 0,
      maxRetries: step.maxRetries != null ? step.maxRetries : 0,
      onFailure: step.onFailure || 'stop',
      result: '',
      error: null,
      startedAt: null,
      endedAt: null,
      _pty: null,
      _buf: '',
    };
  }

  // Normalize a definition into { tasks, maxConcurrency, variables }.
  function normalizeDef(def) {
    if (def.tasks && Array.isArray(def.tasks) && def.tasks.length > 0) {
      const tasks = def.tasks.map((t, i) => ({
        id: t.id || (`task-${  i + 1}`),
        label: t.label || (`Task ${  i + 1}`),
        agentId: t.agentId,
        task: t.task,
        role: t.role || null,
        roleName: t.roleName || null,
        persona: t.persona || null,
        skillId: t.skillId || null,
        expertId: t.expertId || null,
        executor: t.executor || null,
        mode: t.mode || 'serial',
        agents: t.agents,
        type: t.type || 'agent',
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
        status: STATUS.PENDING,
        retries: 0,
        maxRetries: t.maxRetries != null ? t.maxRetries : 0,
        onFailure: t.onFailure || 'stop',
        result: '',
        error: null,
        startedAt: null,
        endedAt: null,
        _pty: null,
        _buf: '',
      }));
      return { tasks, maxConcurrency: def.maxConcurrency || 4, variables: def.variables || {} };
    }
    // Flat steps → linear DAG (sequential dependencies).
    const tasks = [];
    let prev = null;
    (def.steps || []).forEach((s, i) => {
      const t = stepToTask(s, i, prev);
      tasks.push(t);
      prev = t.id;
    });
    return { tasks, maxConcurrency: 1, variables: {} };
  }

  // Detect cycles via Kahn's algorithm. Returns true if acyclic.
  function isAcyclic(tasks) {
    const indeg = new Map();
    const adj = new Map();
    tasks.forEach((t) => { indeg.set(t.id, 0); adj.set(t.id, []); });
    tasks.forEach((t) => {
      (t.dependsOn || []).forEach((d) => {
        if (adj.has(d)) { adj.get(d).push(t.id); indeg.set(t.id, indeg.get(t.id) + 1); }
      });
    });
    const queue = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
    let seen = 0;
    while (queue.length) {
      const id = queue.shift();
      seen++;
      adj.get(id).forEach((nid) => {
        indeg.set(nid, indeg.get(nid) - 1);
        if (indeg.get(nid) === 0) queue.push(nid);
      });
    }
    return seen === tasks.length;
  }

  // ──────────────────────────────────────────────
  // Agent message bus (SendMessage emulation)
  // ──────────────────────────────────────────────

  function writeEnvelope(pty, from, to, kind, msgId, payload) {
    if (!pty || typeof pty.write !== 'function') return;
    try {
      pty.write(`<workbuddy-msg from="${from}" to="${to}" kind="${kind}" msgId="${msgId}">${payload}</workbuddy-msg>\n`);
    } catch (e) { /* PTY closed — envelope best-effort only */ }
  }

  // Send a message from one task to another; resolves on response.
  function sendAgentMessage(rs, from, to, payload, timeout = BUS_TIMEOUT) {
    const msgId = `m${  Date.now()  }-${  Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        rs.bus.pending.delete(msgId);
        reject(new Error(`agent:msg timeout (no response from ${to})`));
      }, timeout);
      rs.bus.pending.set(msgId, { resolve, reject, timer });

      // Best-effort: deliver envelope to the target's PTY (if running).
      const target = rs.tasks.get(to);
      if (target && target._pty) writeEnvelope(target._pty, from, to, 'request', msgId, payload);

      emit(rs.ws, { type: 'agent:msg', kind: 'request', msgId, from, to, payload });
    });
  }

  // Inbound message (from WS or from a PTY response envelope scan).
  function receiveAgentMessage(rs, msg) {
    if (msg.kind === 'response' && rs.bus.pending.has(msg.msgId)) {
      const p = rs.bus.pending.get(msg.msgId);
      clearTimeout(p.timer);
      rs.bus.pending.delete(msg.msgId);
      p.resolve(msg.payload);
      return;
    }
    if (msg.kind === 'request') {
      // Deliver to target: best-effort envelope to its PTY, always emit for UI.
      const target = rs.tasks.get(msg.to);
      if (target && target._pty) writeEnvelope(target._pty, msg.from, msg.to, 'request', msg.msgId, msg.payload);
      emit(rs.ws, { type: 'agent:msg', kind: 'request', msgId: msg.msgId, from: msg.from, to: msg.to, payload: msg.payload });
    }
  }

  // Scan a task's stdout buffer for response envelopes we are awaiting.
  function scanBusResponses(rs, taskId, buf) {
    RES_RE.lastIndex = 0;
    let m;
    while ((m = RES_RE.exec(buf)) !== null) {
      const msgId = m[1];
      if (rs.bus.pending.has(msgId)) {
        receiveAgentMessage(rs, { kind: 'response', msgId, from: taskId, to: '?', payload: m[2] });
      }
    }
  }

  // ──────────────────────────────────────────────
  // Task execution (PTY lifecycle)
  // ──────────────────────────────────────────────

  function runAgentPTY(rs, taskId, agentId, prompt, extraEnv) {
    return new Promise((resolve, reject) => {
      const lookup = lookupCommand(getAgentCommand(agentId), agentId);
      if (lookup.errorCode) {
        reject(new Error(`[${lookup.errorCode}] ${lookup.message}`));
        return;
      }
      const _log = new RingBuffer(50000);
      const task = rs.tasks.get(taskId);

      const p = createHeadlessPTY(lookup.cmd, [], {
        extraEnv: Object.assign({ WORKFLOW_STEP: task ? task.label : '', WORKFLOW_ID: rs.wfId }, extraEnv || {}),
        onData: (cleaned) => {
          _log.append(cleaned);
          if (task) {
            task._buf = (task._buf + cleaned).slice(-4096);
            scanBusResponses(rs, taskId, task._buf);
          }
          emit(rs.ws, { type: 'task:output', taskId, data: cleaned });
          emit(rs.ws, { type: 'workflow:step:output', workflowId: rs.wfId, stepIndex: rs.index.get(taskId), agentId, data: cleaned });
        },
        onExit: ({ exitCode }) => {
          clearTimeout(timeout);
          const code = exitCode == null ? 0 : exitCode;
          // Non-zero exit is a real failure signal for an agent task, so the
          // onFailure policy (retry / skip-dependents / stop) can apply.
          if (code !== 0) reject(Object.assign(new Error(`agent ${agentId} exited with code ${code}`), { output: _log.join() }));
          else resolve({ output: _log.join(), exitCode: code });
        },
        onError: (err) => {
          reject(new Error(`[spawn_error] ${agentId}: ${err.message}`));
        },
      });

      if (!p) {
        reject(new Error(`[spawn_error] Failed to spawn ${agentId}`));
        return;
      }
      if (task) task._pty = p;

      const timeout = setTimeout(() => {
        try { p.kill(); } catch (e) { /* PTY already closed on timeout */ }
        // 超时 = agent 未在时限内结束，应作为失败（而非静默成功）。
        // 复用与 onExit 非零退出一致的 reject 路径，使 onFailure 策略（重试/跳过依赖/停止）能生效。
        reject(Object.assign(new Error(`[timeout] agent ${agentId} exceeded ${DEFAULT_STEP_TIMEOUT}ms without exit`), { output: _log.join() }));
      }, DEFAULT_STEP_TIMEOUT);

      p.write(`${prompt  }\n`);
    });
  }

  async function runParallel(rs, task) {
    const agents = task.agents || [];
    if (agents.length === 0) throw new Error('No agents defined for parallel task');
    const results = await Promise.all(agents.map((agent, i) => {
      const lookup = lookupCommand(getAgentCommand(agent.agentId), agent.agentId);
      if (lookup.errorCode) return { agentId: agent.agentId, output: `[${lookup.errorCode}] ${lookup.message}`, exitCode: -1 };
      return runAgentPTY(rs, task.id, agent.agentId, agent.task, {
        WORKFLOW_AGENT_INDEX: String(i),
      }).then((r) => ({ agentId: agent.agentId, output: r.output, exitCode: r.exitCode }))
        .catch((e) => ({ agentId: agent.agentId, output: (e && e.output) || (`[error] ${  e.message}`), exitCode: -1 }));
    }));

    const agentLabels = { opencode: 'OpenCode', codebuff: 'Codebuff', freebuff: 'Freebuff', aider: 'Aider', claude: 'Claude', codex: 'CODEX' };
    const sections = results.map((r) => {
      const label = agentLabels[r.agentId] || r.agentId;
      const icon = r.exitCode === 0 ? '[OK]' : (r.exitCode === null ? '[TMO]' : '[ERR]');
      const sep = `\n${  '='.repeat(52)  }\n`;
      return `${sep  }  ${  icon  } Agent: ${  label  } (${  r.agentId  })\n${  sep  }\n${  r.output || '(no output)'  }\n`;
    }).join('\n\n');

    const header = `\n${  '#'.repeat(54)  }\n  AI ENSEMBLE - MERGED OUTPUT\n${  '#'.repeat(54)  }\n`;
    const footer = `\n${  '-'.repeat(54)  }\n  Agents: ${  results.length 
      } | Success: ${  results.filter((r) => r.exitCode === 0).length  }\n${  '-'.repeat(54)  }\n`;
    const summary = header + sections + footer;
    const exitCode = results.some((r) => r.exitCode !== 0 && r.exitCode !== null) ? 1 : 0;

    emit(rs.ws, { type: 'task:agent:complete', taskId: task.id, agents: results.map((r) => ({ agentId: r.agentId, exitCode: r.exitCode })) });
    emit(rs.ws, { type: 'workflow:step:complete', workflowId: rs.wfId, stepIndex: rs.index.get(task.id), exitCode, mode: 'parallel', output: summary.slice(-2000) });
    return { output: summary, exitCode };
  }

  function runHuman(rs, task) {
    return new Promise((resolve) => {
      const reqTaskId = `wf-${rs.wfId}-${task.id}`;
      const requestMsg = task.task || task.request || '请输入所需信息';
      task.status = STATUS.WAITING_HUMAN;
      emit(rs.ws, { type: 'task:status', taskId: task.id, status: STATUS.WAITING_HUMAN });
      emit(rs.ws, { type: 'human:request', taskId: reqTaskId, employeeId: task.agentId || 'orchestrator', question: requestMsg, workflowId: rs.wfId, stepIndex: rs.index.get(task.id), stepLabel: task.label });

      const timeoutDuration = task.timeout || 1800000;
      let resolved = false;
      const unsubscribe = contextStore.subscribe(`human:response:${reqTaskId}`, (entry) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        emit(rs.ws, { type: 'workflow:step:complete', workflowId: rs.wfId, stepIndex: rs.index.get(task.id), exitCode: 0, mode: 'human', output: (entry.value.answer || '').slice(-2000) });
        resolve({ output: entry.value.answer || '', exitCode: 0 });
        unsubscribe();
      });
      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        emit(rs.ws, { type: 'workflow:step:complete', workflowId: rs.wfId, stepIndex: rs.index.get(task.id), exitCode: 1, mode: 'human', output: '[TIMEOUT] 未在超时时间内收到人类回复' });
        resolve({ output: '[TIMEOUT] No human response', exitCode: 1 });
        unsubscribe();
      }, timeoutDuration);
    });
  }

  // Build the final prompt for a task, injecting dependency results + shared context.
  function buildPrompt(rs, task) {
    let prompt = task.task || '';
    const cap = task.maxContextChars || DEFAULT_CONTEXT_CAP;
    for (const depId of (task.dependsOn || [])) {
      const dep = rs.tasks.get(depId);
      if (dep && dep.result) {
        const slice = dep.result.length > cap ? `${dep.result.slice(0, cap)  }\n... [truncated]` : dep.result;
        prompt = `[Context from task "${dep.label}"]\n${slice}\n\n---\n\n${prompt}`;
      }
    }
    if (contextStore) {
      const entries = contextStore.query((e) =>
        e.tags.includes('published') && e.source !== (task.agentId || '') && (Date.now() - e.timestamp) < 600000);
      if (entries.length > 0) {
        const block = entries.slice(-3)
          .map((e) => `[${e.source || 'context'}] (${e.type}):\n${JSON.stringify(e.value, null, 2).slice(0, 500)}`)
          .join('\n\n---\n\n');
        prompt = `[Shared context from other agents]\n${block}\n\n---\n\n${prompt}`;
      }
    }
    // Expose variables from the run definition.
    if (rs.variables && Object.keys(rs.variables).length) {
      const vars = Object.entries(rs.variables).map(([k, v]) => `${k} = ${v}`).join('\n');
      prompt = `[Variables]\n${vars}\n\n---\n\n${prompt}`;
    }
    // Persona (专家团角色 / 专家) — applied outermost so it frames the whole prompt.
    // expertId 优先级高于 role：专家是命名、可复用的角色包，解析出的人设复用同一个人设块。
    let personaName = task.roleName || task.role || '专家';
    let personaText = task.persona || null;
    if (task.expertId) {
      const ex = expertRegistry.get(task.expertId);
      if (ex && ex.persona) { personaName = ex.name || task.expertId; personaText = ex.persona; }
    }
    if (personaText) {
      prompt = `[角色设定 / Persona]\n你是「${personaName}」角色。\n${personaText}\n---\n\n${prompt}`;
      // 专家附带的可用技能 / 可接入连接器提示（信息性，不自动注入技能正文）。
      if (task.expertId) {
        const ex = expertRegistry.get(task.expertId);
        if (ex) {
          const hints = [];
          if (Array.isArray(ex.allowedSkills) && ex.allowedSkills.length) hints.push(`可用技能: ${  ex.allowedSkills.join(', ')}`);
          if (Array.isArray(ex.allowedConnectors) && ex.allowedConnectors.length) hints.push(`可接入连接器: ${  ex.allowedConnectors.join(', ')}`);
          if (hints.length) prompt = `[专家能力] ${hints.join('；')}\n---\n\n${prompt}`;
        }
      }
    }
    // Skill (技能) — 把已接入 Hesi 的技能正文前置进 prompt，作为可执行的工作流指引。
    // 与 persona 同级：技能是「怎么做」的指令集，persona 是「是谁」，二者互不冲突。
    if (task.skillId) {
      const body = skillRegistry.getBody(task.skillId);
      if (body) {
        prompt = `[技能指引 / Skill: ${task.skillId}]\n${body}\n---\n\n${prompt}`;
      }
    }
    // 浏览器安全提示：让内置 AI 助手 / 终端类 agent 在推理时知道不能操作 Hesi 自身页面。
    // 始终注入到 prompt 最外层，确保任何任务都知晓此规则。
    const browserSafetyBriefing = [
      '[浏览器安全规则 / Browser Safety]',
      '你在 Hesi（AI 工作站）环境中运行。Hesi 的浏览器自动化能力通过 CDP 连接到一个浏览器实例。',
      '⚠️ 关键约束：默认标签页（index 0/context 0）是 Hesi 管理页面，CDP 连接依赖该页面存活。',
      '   **永远不要**在 index 0 上调用 browser_navigate、browser_click、browser_type 等操作！',
      '   如果操作了，CDP 会断开，所有浏览器能力将不可用。',
      '✅ 正确做法：先调用 browser_farm_create 创建新的隔离浏览器会话，',
      '   然后在新会话（index ≥ 1 的 context）中自由进行任何浏览器操作。',
      '✅ 如果服务端返回 "Hesi 管理页面禁止操作" 的错误，立即用 browser_farm_create 创建新会话。',
      '✅ 在决定使用浏览器能力时，始终以 browser_farm_create 作为第一步。',
    ].join('\n');
    // 能力声明：让内置 AI 助手 / 终端类 agent 在推理时知道"还可把子任务路由到网页端点"。
    // 这是信息性提示，不自动执行；真正要使用需提交带 executor 字段的 workflow:addTask。
    prompt = `${browserSafetyBriefing}\n\n---\n\n${getCapabilityBriefing()}\n---\n\n${prompt}`;
    return prompt;
  }

  async function executeTask(rs, task) {
    if (task.type === 'await_human') return runHuman(rs, task);
    if (task.mode === 'parallel') return runParallel(rs, task);
    // 网页端点执行路径：把子任务路由到网页端免费模型（HTTP 型）。
    if (task.executor && task.executor.type === 'web') {
      return runWebEndpoint(task, buildPrompt(rs, task));
    }
    return runAgentPTY(rs, task.id, task.agentId, buildPrompt(rs, task));
  }

  function publishContext(rs, task) {
    if (!contextStore) return;
    contextStore.publish(task.agentId || task.id, {
      workflowId: rs.wfId,
      taskLabel: task.label,
      output: (task.result || '').slice(0, 2000),
    }, { tags: ['workflow', `wf:${rs.wfId}`], type: 'workflow:step', ttl: 600000 });
  }

  // ──────────────────────────────────────────────
  // Scheduler (the orchestration loop)
  // ──────────────────────────────────────────────

  function markSkipped(rs, task, reason) {
    if (task.status === STATUS.SKIPPED || task.status === STATUS.COMPLETED || task.status === STATUS.FAILED) return;
    task.status = STATUS.SKIPPED;
    task.error = reason;
    emit(rs.ws, { type: 'task:status', taskId: task.id, status: STATUS.SKIPPED, error: reason });
    emit(rs.ws, { type: 'workflow:step:skipped', workflowId: rs.wfId, stepIndex: rs.index.get(task.id), reason });
  }

  function propagateSkip(rs, failedId) {
    for (const t of rs.tasks.values()) {
      if (t.status === STATUS.PENDING && (t.dependsOn || []).includes(failedId)) {
        markSkipped(rs, t, `dependency ${failedId} unavailable`);
        propagateSkip(rs, t.id);
      }
    }
  }

  function finalize(rs, outcome) {
    if (rs._finalized) return;
    rs._finalized = true;
    // Resolve any tasks still pending/running/blocked so the board is consistent.
    for (const t of rs.tasks.values()) {
      if (![STATUS.COMPLETED, STATUS.FAILED, STATUS.SKIPPED].includes(t.status)) {
        t.status = STATUS.SKIPPED;
        t.error = t.error || 'run ended';
        emit(rs.ws, { type: 'task:status', taskId: t.id, status: STATUS.SKIPPED, error: t.error });
      }
    }
    // Kill any lingering PTYs.
    for (const t of rs.tasks.values()) {
      try { if (t._pty) t._pty.kill(); } catch (e) { /* already dead */ }
    }
    // Clear bus timers.
    for (const p of rs.bus.pending.values()) clearTimeout(p.timer);
    rs.bus.pending.clear();

    const summary = [...rs.tasks.values()].map((t) =>
      `Task ${rs.index.get(t.id) + 1} (${t.label}): [${t.status}] ${(t.result || t.error || '').slice(0, 160)}`).join('\n');
    emit(rs.ws, {
      type: outcome === 'cancelled' ? 'workflow:cancelled' : (outcome === 'failed' ? 'workflow:failed' : 'workflow:completed'),
      workflowId: rs.wfId,
      totalSteps: rs.tasks.size,
      completedSteps: [...rs.tasks.values()].filter((t) => t.status === STATUS.COMPLETED).length,
      outcome,
      summary,
    });
    if (typeof rs._resolve === 'function') rs._resolve(outcome);
  }

  function schedule(rs) {
    if (rs.cancelled) { finalize(rs, 'cancelled'); return; }

    // 1. Propagate skip: any pending task whose dependency was skipped → skip it.
    for (const t of rs.tasks.values()) {
      if (t.status === STATUS.PENDING && (t.dependsOn || []).some((d) => rs.tasks.get(d)?.status === STATUS.SKIPPED)) {
        markSkipped(rs, t, 'dependency skipped');
      }
    }

    // 2. Find ready tasks: pending & all deps completed.
    const ready = [];
    for (const t of rs.tasks.values()) {
      if (t.status !== STATUS.PENDING) continue;
      const depsOk = (t.dependsOn || []).every((d) => rs.tasks.get(d)?.status === STATUS.COMPLETED);
      if (depsOk) ready.push(t);
    }

    // 3. No ready and nothing running → either done or stuck (cycle / failed blocker).
    if (ready.length === 0 && rs.running === 0) {
      const stuck = [...rs.tasks.values()].filter((t) => ![STATUS.COMPLETED, STATUS.FAILED, STATUS.SKIPPED].includes(t.status));
      if (stuck.length > 0) {
        for (const t of stuck) markSkipped(rs, t, 'unresolvable dependency (cycle or failed blocker)');
      }
      finalize(rs, 'completed');
      return;
    }

    // 4. Start ready tasks up to concurrency.
    for (const t of ready) {
      if (rs.running >= rs.maxConcurrency) break;
      startTask(rs, t);
    }
  }

  async function startTask(rs, task) {
    task.status = STATUS.RUNNING;
    task.startedAt = Date.now();
    rs.running++;
    emit(rs.ws, { type: 'task:status', taskId: task.id, status: STATUS.RUNNING, label: task.label });
    emit(rs.ws, { type: 'workflow:step:start', workflowId: rs.wfId, stepIndex: rs.index.get(task.id), stepLabel: task.label, stepType: task.type });

    try {
      const res = await executeTask(rs, task);
      task.result = res.output;
      task.exitCode = res.exitCode;
      task.endedAt = Date.now();
      task.status = STATUS.COMPLETED;
      rs.running--;
      emit(rs.ws, { type: 'task:status', taskId: task.id, status: STATUS.COMPLETED });
      emit(rs.ws, { type: 'workflow:step:complete', workflowId: rs.wfId, stepIndex: rs.index.get(task.id), exitCode: res.exitCode, mode: task.mode, output: res.output.slice(-2000) });
      publishContext(rs, task);
      schedule(rs);
    } catch (err) {
      // 保留超时时产出的部分输出，便于诊断与重试
      if (err && err.output) task.result = err.output;
      // Retry?
      if (task.retries < task.maxRetries) {
        task.retries++;
        task.status = STATUS.PENDING;
        rs.running--;
        emit(rs.ws, { type: 'task:status', taskId: task.id, status: STATUS.PENDING, retry: task.retries });
        schedule(rs);
        return;
      }
      task.status = STATUS.FAILED;
      task.error = err.message;
      task.endedAt = Date.now();
      rs.running--;
      emit(rs.ws, { type: 'task:status', taskId: task.id, status: STATUS.FAILED, error: err.message });
      emit(rs.ws, { type: 'workflow:step:error', workflowId: rs.wfId, stepIndex: rs.index.get(task.id), error: err.message });

      if (task.onFailure === 'skip-dependents') {
        propagateSkip(rs, task.id);
        schedule(rs);
      } else if (task.onFailure === 'continue') {
        schedule(rs);
      } else {
        // stop: halt the run.
        rs.cancelled = true;
        finalize(rs, 'failed');
      }
    }
  }

  // ──────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────

  async function run(ws, def) {
    const norm = normalizeDef(def || {});
    if (norm.tasks.length === 0) {
      emit(ws, { type: 'workflow:error', message: 'No tasks/steps defined' });
      return;
    }
    if (!isAcyclic(norm.tasks)) {
      emit(ws, { type: 'workflow:error', message: 'Task DAG contains a dependency cycle' });
      return;
    }
    const wfId = nextId();
    const index = new Map();
    norm.tasks.forEach((t, i) => index.set(t.id, i));
    const rs = {
      ws, wfId, tasks: new Map(norm.tasks.map((t) => [t.id, t])), index,
      maxConcurrency: norm.maxConcurrency || 4, running: 0, cancelled: false,
      variables: norm.variables || {}, bus: { pending: new Map() }, _finalized: false, _resolve: null,
    };
    let runs = activeRuns.get(ws);
    if (!runs) { runs = new Map(); activeRuns.set(ws, runs); }
    runs.set(wfId, rs);

    for (const t of norm.tasks) emit(ws, { type: 'task:added', workflowId: wfId, task: serializeTask(t) });
    emit(ws, { type: 'workflow:started', workflowId: wfId, totalSteps: norm.tasks.length, name: def.name || 'Orchestration' });

    await new Promise((resolve) => { rs._resolve = resolve; schedule(rs); });
    removeRun(ws, wfId);
  }

  function cancel(ws, wfId) {
    const rs = activeRuns.get(ws)?.get(wfId);
    if (!rs) return;
    rs.cancelled = true;
    finalize(rs, 'cancelled');
    removeRun(ws, wfId);
  }

  // Dynamic task decomposition: add a task (or tasks) to a running run.
  // Routes to `wfId` when given, otherwise the client's most-recent run.
  function addTask(ws, taskDef, wfId) {
    const rs = resolveRun(ws, wfId);
    if (!rs) return { error: 'no active run' };
    const arr = Array.isArray(taskDef) ? taskDef : [taskDef];
    const added = [];
    for (const td of arr) {
      const id = td.id || (`task-dyn-${  rs.tasks.size + 1}`);
      const t = {
        id, label: td.label || id, agentId: td.agentId, task: td.task,
        role: td.role || null, roleName: td.roleName || null, persona: td.persona || null,
        skillId: td.skillId || null,
        expertId: td.expertId || null,
        mode: td.mode || 'serial', agents: td.agents, type: td.type || 'agent',
        dependsOn: Array.isArray(td.dependsOn) ? td.dependsOn : [],
        status: STATUS.PENDING, retries: 0, maxRetries: td.maxRetries || 0,
        onFailure: td.onFailure || 'stop', result: '', error: null,
        startedAt: null, endedAt: null, _pty: null, _buf: '',
      };
      rs.tasks.set(id, t);
      rs.index.set(id, rs.tasks.size - 1);
      added.push(id);
      emit(ws, { type: 'task:added', workflowId: rs.wfId, task: serializeTask(t) });
    }
    schedule(rs);
    return { added };
  }

  function sendMessage(ws, msg) {
    const rs = resolveRun(ws, msg && msg.wfId);
    if (!rs) return;
    receiveAgentMessage(rs, msg);
  }

  function cleanupWorkflows(ws) {
    const runs = activeRuns.get(ws);
    if (!runs) return;
    for (const rs of [...runs.values()]) {
      rs.cancelled = true;
      finalize(rs, 'cancelled');
    }
    activeRuns.delete(ws);
  }

  return { run, cancel, addTask, sendMessage, cleanupWorkflows, activeRuns, runsFor, latestRun, STATUS };
}

module.exports = { createOrchestrator, STATUS };
