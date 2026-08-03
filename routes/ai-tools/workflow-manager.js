/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Workflow Manager — 多步流水线编排
//
// AI 工具 workflow_start / workflow_status / workflow_add_task
// 的后端引擎。使用现有的 AgentPoolManager 来执行每个步骤，
// 提供轻量级的 DAG 调度。
//
// 与 ws/orchestrator.js 的关系：
//   orchestrator.js 是 WebSocket 驱动的完整编排引擎，
//   依赖 ws 连接和 contextStore。此模块是 AI 工具层的
//   轻量封装：用 agentPool 执行任务，返回 JSON。
//
// 支持的 DAG 功能：
//   - 串行依赖 (dependsOn)
//   - 并行执行 (无依赖的任务同时运行)
//   - 失败策略: stop / continue / skip-dependents
//   - 重试机制 (maxRetries)
//   - 上下文传递 (上游输出注入下游 prompt)
// ============================================================

const crypto = require('crypto');
const { agentPool } = require('./agent-pool');
const agentRoles = require('../../lib/agent-roles');
const blackboard = require('../../lib/blackboard');

// ── 配置常量（支持 env 覆盖，避免硬编码到具体部署环境） ──
// 最大工作流数：HESI_MAX_WORKFLOWS（缺省 20）
const MAX_WORKFLOWS = (() => {
  const v = parseInt(process.env.HESI_MAX_WORKFLOWS, 10);
  return Number.isFinite(v) && v > 0 ? v : 20;
})();
const MAX_TASKS_PER_WF = 50;        // 每工作流最大任务数
const DONE_WF_TTL_MS = 10 * 60 * 1000;  // 完成后保留 10 分钟
const CLEANUP_INTERVAL_MS = 120_000;     // 清理周期 2 分钟
// 工作流总超时：HESI_WF_TIMEOUT_MS（缺省 30min）
const WF_TIMEOUT_MS = (() => {
  const v = parseInt(process.env.HESI_WF_TIMEOUT_MS, 10);
  return Number.isFinite(v) && v > 0 ? v : 30 * 60 * 1000;
})();

// Agent 启动重试策略：
//   agentPool.start() 可能因资源竞争临时失败（如并发池满），
//   在 _executeTask 内部快速重试几次，避免触发任务级重试机制。
const AGENT_START_RETRIES = 3;           // 最多重试次数
const AGENT_START_RETRY_DELAY_MS = 1000; // 每次重试间隔

// ── Workflow ID 生成 ──
let _idCounter = 0;
function generateId() {
  _idCounter++;
  return `wf-${Date.now().toString(36)}-${_idCounter}`;
}

/** 计算文本的短哈希（黑板 files.hash 用，非安全用途） */
function shortHash(text) {
  try {
    return crypto.createHash('sha1').update(String(text || '')).digest('hex').slice(0, 8);
  } catch {
    return '';
  }
}

/**
 * 轻量级工作流管理器。
 * 管理多个工作流的生命周期，使用 agentPool 执行每个步骤。
 */
class WorkflowManager {
  constructor(opts = {}) {
    /** @type {Map<string, object>} */
    this._workflows = new Map();

    // 可配置参数（测试时可设短值加速）
    this._pollInterval = opts.pollInterval || 2000;
    this._startRetryDelay = opts.startRetryDelay || AGENT_START_RETRY_DELAY_MS;

    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    this._cleanupTimer.unref();
  }

  /**
   * 启动一个新工作流。
   * @param {string} name - 工作流名称
   * @param {Array<object>} tasks - 任务定义数组
   * @param {object} [opts]
   * @param {number} [opts.maxConcurrency=3] - 最大并行数
   * @returns {Promise<string>} JSON
   */
  async start(name, tasks, opts = {}) {
    try {
      if (!name || !Array.isArray(tasks) || tasks.length === 0) {
        return JSON.stringify({ ok: false, error: 'name 和 tasks 数组为必填' });
      }
      if (tasks.length > MAX_TASKS_PER_WF) {
        return JSON.stringify({ ok: false, error: `最多 ${MAX_TASKS_PER_WF} 个任务` });
      }
      if (this._workflows.size >= MAX_WORKFLOWS) {
        return JSON.stringify({ ok: false, error: `工作流数已达上限 ${MAX_WORKFLOWS}` });
      }

      // 标准化任务定义
      const normalizedTasks = tasks.map((t, i) => ({
        id: t.id || `task-${i + 1}`,
        label: t.label || t.id || `任务 ${i + 1}`,
        agentId: t.agentId,
        task: t.task,
        context: t.context || '',
        dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn : [],
        maxRetries: t.maxRetries || 0,
        onFailure: t.onFailure || 'stop',  // stop / continue / skip-dependents
        role: (typeof t.role === 'string' && t.role) ? t.role : null,          // S3/S5: 可选角色（失败自动转岗）
        files: Array.isArray(t.files) ? t.files.filter(f => typeof f === 'string') : [], // S4: 该任务负责的文件（黑板同步）
        status: 'pending',
        retries: 0,
        result: '',
        error: null,
        startedAt: null,
        endedAt: null,
      }));

      // 验证依赖
      const allIds = new Set(normalizedTasks.map(t => t.id));
      for (const t of normalizedTasks) {
        for (const dep of t.dependsOn) {
          if (!allIds.has(dep)) {
            return JSON.stringify({
              ok: false,
              error: `任务 "${t.id}" 依赖不存在的任务 "${dep}"`,
            });
          }
        }
      }

      // 检测循环依赖 (Kahn's algorithm)
      if (!this._isAcyclic(normalizedTasks)) {
        return JSON.stringify({ ok: false, error: '检测到循环依赖' });
      }

      // 标准化失败策略默认值
      for (const t of normalizedTasks) {
        if (!['stop', 'continue', 'skip-dependents'].includes(t.onFailure)) {
          t.onFailure = 'stop';
        }
      }

      const workflowId = generateId();
      const workflow = {
        workflowId,
        name: name.slice(0, 100),
        tasks: normalizedTasks,
        status: 'running',
        maxConcurrency: opts.maxConcurrency || 3,
        projectId: (typeof opts.projectId === 'string' && opts.projectId) ? opts.projectId : 'default', // S4: 黑板 projectId
        startTime: Date.now(),
        lastActivity: Date.now(),
    runningCount: 0,
        totalCount: normalizedTasks.length,
      };

      this._workflows.set(workflowId, workflow);

      // 异步开始调度（不阻塞返回）
      this._schedule(workflowId).catch(err => {
        console.error(`[Workflow] ${workflowId} 调度错误: ${err.message}`);
      });

      return JSON.stringify({
        ok: true,
        workflowId,
        name: workflow.name,
        taskCount: normalizedTasks.length,
        status: 'running',
      });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `启动工作流失败: ${err.message}` });
    }
  }

  /**
   * 查询工作流状态。
   * @param {string} workflowId
   * @returns {Promise<string>} JSON
   */
  async status(workflowId) {
    try {
      const wf = this._workflows.get(workflowId);
      if (!wf) {
        return JSON.stringify({
          ok: false,
          error: `未找到工作流 "${workflowId}"（可能已过期）`,
        });
      }

      wf.lastActivity = Date.now();

      const tasks = wf.tasks.map(t => ({
        id: t.id,
        label: t.label,
        agentId: t.agentId,
        role: t.role || undefined,
        status: t.status,
        retries: t.retries,
        maxRetries: t.maxRetries,
        error: t.error,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        // 只返回已完成任务的输出（节省 token）
        output: t.status === 'completed' ? (t.result || '').slice(0, 2000) : '',
        dependsOn: t.dependsOn,
      }));

      return JSON.stringify({
        ok: true,
        workflowId,
        name: wf.name,
        status: wf.status,
        runningMs: Date.now() - wf.startTime,
        total: wf.totalCount,
        completed: wf.tasks.filter(t => t.status === 'completed').length,
        failed: wf.tasks.filter(t => t.status === 'failed').length,
        tasks,
      });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `查询失败: ${err.message}` });
    }
  }

  /**
   * 向运行中的工作流添加额外任务。
   * @param {string} workflowId
   * @param {Array<object>|object} newTasks - 新任务或任务数组
   * @returns {Promise<string>} JSON
   */
  async addTask(workflowId, newTasks) {
    try {
      const wf = this._workflows.get(workflowId);
      if (!wf) {
        return JSON.stringify({ ok: false, error: `未找到工作流 "${workflowId}"` });
      }
      if (wf.status !== 'running') {
        return JSON.stringify({
          ok: false,
          error: `工作流已结束（${wf.status}），无法添加任务`,
        });
      }
      if (wf.tasks.length >= MAX_TASKS_PER_WF) {
        return JSON.stringify({ ok: false, error: `任务数已达上限 ${MAX_TASKS_PER_WF}` });
      }

      const arr = Array.isArray(newTasks) ? newTasks : [newTasks];
      const added = [];

      for (const nt of arr) {
        if (wf.tasks.length >= MAX_TASKS_PER_WF) break;

        const taskId = nt.id || `task-dyn-${wf.tasks.length + 1}`;
        const task = {
          id: taskId,
          label: nt.label || taskId,
          agentId: nt.agentId,
          task: nt.task,
          context: nt.context || '',
          dependsOn: Array.isArray(nt.dependsOn) ? nt.dependsOn : [],
          maxRetries: nt.maxRetries || 0,
          onFailure: nt.onFailure || 'stop',
          role: (typeof nt.role === 'string' && nt.role) ? nt.role : null,
          files: Array.isArray(nt.files) ? nt.files.filter(f => typeof f === 'string') : [],
          status: 'pending',
          retries: 0,
          result: '',
          error: null,
          startedAt: null,
          endedAt: null,
        };

        wf.tasks.push(task);
        wf.totalCount++;
        added.push(taskId);
      }

      // 触发调度
      this._schedule(workflowId).catch(() => {});

      return JSON.stringify({ ok: true, workflowId, added });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `添加任务失败: ${err.message}` });
    }
  }

  // ── 黑板同步（S4：仅 start/done/error 三个关键节点，事件驱动） ──

  /**
   * best-effort 黑板 patch：失败只记日志，绝不阻断/中断工作流执行。
   * 各任务只 patch 自己的 task/files 键（字段级合并），并行互不覆盖（隔离性）。
   * @param {object} wf
   * @param {object} partial
   */
  _bbPatch(wf, partial) {
    try {
      blackboard.patch(wf.projectId || 'default', partial).catch(err => {
        console.error(`[Workflow] 黑板同步失败（已忽略，不影响执行）: ${err.message}`);
      });
    } catch (err) {
      console.error(`[Workflow] 黑板同步失败（已忽略，不影响执行）: ${err.message}`);
    }
  }

  /** 步骤开始：task→in_progress，登记角色与负责文件 */
  _bbTaskStart(wf, task) {
    const partial = {
      tasks: [{ id: task.id, status: 'in_progress', assignee: task.agentId, workflowId: wf.workflowId }],
      logs: [{ ts: Date.now(), actor: 'workflow', msg: `任务 ${task.id} 开始（agent=${task.agentId}${task.role ? `, role=${task.role}` : ''}）` }],
    };
    if (task.role) partial.roles = { [task.agentId]: task.role };
    if (task.files.length) {
      partial.files = {};
      for (const p of task.files) partial.files[p] = { status: 'in_progress' };
    }
    this._bbPatch(wf, partial);
  }

  /** 步骤完成：task→done，负责文件→done + 产出短哈希 */
  _bbTaskDone(wf, task) {
    const partial = {
      tasks: [{ id: task.id, status: 'done' }],
      logs: [{ ts: Date.now(), actor: 'workflow', msg: `任务 ${task.id} 完成` }],
    };
    if (task.files.length) {
      partial.files = {};
      const hash = shortHash(task.result);
      for (const p of task.files) partial.files[p] = { status: 'done', hash };
    }
    this._bbPatch(wf, partial);
  }

  /** 步骤失败/重试：retrying 或 failed + lastError */
  _bbTaskError(wf, task, errMsg, retrying) {
    const status = retrying ? 'retrying' : 'failed';
    const partial = {
      tasks: [{ id: task.id, status, lastError: String(errMsg || '').slice(0, 500) }],
      logs: [{ ts: Date.now(), actor: 'workflow', msg: `任务 ${task.id} ${retrying ? `失败，转岗重试（第 ${task.retries} 次${task.role ? `, role=${task.role}` : ''}）` : '彻底失败'}: ${String(errMsg || '').slice(0, 200)}` }],
    };
    if (retrying && task.role) partial.roles = { [task.agentId]: task.role };
    if (!retrying && task.files.length) {
      partial.files = {};
      for (const p of task.files) partial.files[p] = { status: 'failed' };
    }
    this._bbPatch(wf, partial);
  }

  // ── 调度引擎（内部） ──

  /**
   * 调度工作流的就绪任务。
   * @param {string} workflowId
   */
  async _schedule(workflowId) {
    const wf = this._workflows.get(workflowId);
    if (!wf || wf.status !== 'running') return;

    // 如果被调度锁定，标记为待重跑后返回（防止重复调度，但不再静默丢弃请求）
    if (wf._scheduling) { wf._pending = true; return; }
    wf._scheduling = true;

    try {
      await this._doSchedule(wf);
    } finally {
      wf._scheduling = false;
      // 调度窗口内有新完成事件进来 → 重跑一次，避免就绪任务永久停摆
      if (wf._pending) { wf._pending = false; this._schedule(workflowId); }
    }
  }

  async _doSchedule(wf) {
    // 超时检查
    if (Date.now() - wf.startTime > WF_TIMEOUT_MS) {
      wf.status = 'timeout';
      // 标记所有未完成任务为超时
      for (const t of wf.tasks) {
        if (t.status === 'pending' || t.status === 'running') {
          t.status = 'skipped';
          t.error = 'workflow timed out';
        }
      }
      return;
    }

    // 1. 传播 skip
    for (const t of wf.tasks) {
      if (t.status === 'pending' &&
          t.dependsOn.some(d => {
            const dep = wf.tasks.find(x => x.id === d);
            return dep && (dep.status === 'failed' || dep.status === 'skipped');
          })) {
        if (t.onFailure === 'skip-dependents' || t.onFailure === 'continue') {
          t.status = 'skipped';
          t.error = `dependency failed/skipped`;
        } else {
          // stop: propagate skip but mark as skipped
          t.status = 'skipped';
          t.error = 'dependency failed (stop policy)';
        }
      }
    }

    // 2. 找就绪任务
    const ready = wf.tasks.filter(t => {
      if (t.status !== 'pending') return false;
      return t.dependsOn.every(d => {
        const dep = wf.tasks.find(x => x.id === d);
        return dep && dep.status === 'completed';
      });
    });

    // 3. 检查是否完成
    if (ready.length === 0 && wf.runningCount === 0) {
      const allDone = wf.tasks.every(t =>
        ['completed', 'skipped', 'failed'].includes(t.status)
      );
      if (allDone) {
        const anyFailed = wf.tasks.some(t => t.status === 'failed');
        wf.status = anyFailed ? 'completed_with_errors' : 'completed';
      }
      return;
    }

    // 4. 启动就绪任务（受并发限制）
    for (const task of ready) {
      if (wf.runningCount >= wf.maxConcurrency) break;

      wf.runningCount++;
      task.status = 'running';
      task.startedAt = Date.now();

      this._executeTask(wf, task).then(() => {}, () => {});
    }
  }

  async _executeTask(wf, task) {
    try {
      // S4: 黑板同步 — 步骤开始
      this._bbTaskStart(wf, task);

      // 构建包含上下文 prompt
      let prompt = task.task || task.label || '';
      const contextParts = [];

      // 注入上游输出
      for (const depId of task.dependsOn) {
        const dep = wf.tasks.find(x => x.id === depId);
        if (dep && dep.result) {
          contextParts.push(`[来自任务 "${dep.label}" 的输出]\n${dep.result.slice(0, 4000)}`);
        }
      }

      if (task.context) {
        contextParts.push(`[附加上下文]\n${task.context}`);
      }

      if (contextParts.length > 0) {
        prompt = `${contextParts.join('\n\n---\n\n')}\n\n---\n\n${prompt}`;
      }

      // 通过 agentPool 执行任务（内置重试：临时失败自动重试）
      let lastError = null;
      let parsed = null;
      for (let attempt = 1; attempt <= AGENT_START_RETRIES; attempt++) {
        if (attempt > 1) {
          await new Promise(r => setTimeout(r, this._startRetryDelay));
        }
        try {
          const result = await agentPool.start(task.agentId, prompt, '', null, task.role);
          parsed = JSON.parse(result);
          if (parsed.ok) break;
          lastError = parsed.error || 'agent start failed';
        } catch (startErr) {
          lastError = startErr.message;
          // await 中抛出的异常也视为可重试
        }
      }

      if (!parsed || !parsed.ok) {
        throw new Error(lastError || 'agent start failed after retries');
      }

      // 异步等待完成后获取输出
      const sessionId = parsed.sessionId;
      task.result = `[Agent ${task.agentId}] session ${sessionId} started`;
      task.status = 'running';

      // 轮询等待完成
      await this._waitForSession(wf, sessionId, task);

    } catch (err) {
      await this._handleTaskFailure(wf, task, err);
    }
  }

  async _waitForSession(wf, sessionId, task) {
    const maxWait = 5 * 60 * 1000; // 5 min
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, this._pollInterval));

      const pollResult = await agentPool.poll(sessionId);
      const data = JSON.parse(pollResult);

      if (!data.ok) {
        task.result = `${task.result || ''  }\n[poll error] ${data.error}`;
        task.status = 'completed';
        task.endedAt = Date.now();
        wf.runningCount--;
        this._bbTaskDone(wf, task); // S4: 黑板同步 — 步骤完成（poll 异常按完成处理，沿用原语义）
        this._schedule(wf.workflowId).catch(() => {});
        return;
      }

      if (data.status === 'done') {
        task.result = data.output || '(no output)';
        task.status = 'completed';
        task.endedAt = Date.now();
        wf.runningCount--;
        this._bbTaskDone(wf, task); // S4: 黑板同步 — 步骤完成
        this._schedule(wf.workflowId).catch(() => {});
        return;
      }

      if (data.status === 'error' || data.status === 'timeout' || data.status === 'cancelled') {
        throw new Error(`agent session ${data.status}: ${data.error || 'unknown'}`);
      }
    }

    // Timeout
    throw new Error(`session ${sessionId} did not complete within ${maxWait}ms`);
  }

  async _handleTaskFailure(wf, task, err) {
    task.error = err.message;
    task.endedAt = Date.now();
    wf.runningCount--;

    if (task.retries < task.maxRetries) {
      task.retries++;
      // S5: 隔离恢复 — 有角色的任务失败后自动转岗（如 coder→debugger）重试；
      // 无角色任务保持原行为（零行为变化）。
      if (task.role) {
        const next = agentRoles.resolveRecoveryRole(task.role);
        if (next && next !== task.role) task.role = next;
      }
      this._bbTaskError(wf, task, err.message, true); // 黑板: retrying
      task.status = 'pending';
      task.startedAt = null;
      // 重新调度
      this._schedule(wf.workflowId).catch(() => {});
      return;
    }

    task.status = 'failed';
    this._bbTaskError(wf, task, err.message, false); // S4: 黑板同步 — 步骤彻底失败

    if (task.onFailure === 'continue') {
      // 失败任务的下游依赖仍会被 _propagateSkip 在调度时发现并跳过，
      // 这里只让工作流继续推进其它就绪任务。
      this._schedule(wf.workflowId).catch(() => {});
    } else if (task.onFailure === 'skip-dependents') {
      // 与 continue 的区别：主动把依赖本任务的下游（含传递依赖）标 skipped，
      // 不再尝试执行；其余无依赖任务照常推进。
      this._markDependentsSkipped(wf, task.id);
      this._schedule(wf.workflowId).catch(() => {});
    } else {
      // stop（默认）
      wf.status = 'failed';
      for (const t of wf.tasks) {
        if (t.status === 'pending') {
          t.status = 'skipped';
          t.error = 'workflow stopped due to task failure';
        }
      }
    }
  }

  /**
   * 将依赖 failedId 的下游任务（含传递依赖）标记为 skipped。
   * 用于 onFailure='skip-dependents'：失败任务的下游不再尝试执行。
   * @param {object} wf
   * @param {string} failedId
   */
  _markDependentsSkipped(wf, failedId) {
    const dependents = new Set([failedId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const t of wf.tasks) {
        if (t.status !== 'pending') continue;
        if ((t.dependsOn || []).some((d) => dependents.has(d))) {
          dependents.add(t.id);
          t.status = 'skipped';
          t.error = `dependency failed/skipped (${failedId})`;
          changed = true;
        }
      }
    }
  }

  // ── DAG 工具 ──

  _isAcyclic(tasks) {
    const indeg = new Map();
    const adj = new Map();
    tasks.forEach(t => { indeg.set(t.id, 0); adj.set(t.id, []); });
    tasks.forEach(t => {
      (t.dependsOn || []).forEach(d => {
        if (adj.has(d)) {
          adj.get(d).push(t.id);
          indeg.set(t.id, (indeg.get(t.id) || 0) + 1);
        }
      });
    });
    const q = [...indeg.entries()].filter(([, n]) => n === 0).map(([id]) => id);
    let seen = 0;
    while (q.length) {
      const id = q.shift();
      seen++;
      (adj.get(id) || []).forEach(nid => {
        indeg.set(nid, indeg.get(nid) - 1);
        if (indeg.get(nid) === 0) q.push(nid);
      });
    }
    return seen === tasks.length;
  }

  // ── 清理 ──

  _cleanup() {
    const now = Date.now();
    for (const [id, wf] of this._workflows) {
      if (wf.status !== 'running' && (now - wf.lastActivity) > DONE_WF_TTL_MS) {
        this._workflows.delete(id);
      }
      // 僵尸工作流
      if (wf.status === 'running' && (now - wf.startTime) > WF_TIMEOUT_MS + DONE_WF_TTL_MS) {
        wf.status = 'timeout';
        this._workflows.delete(id);
      }
    }
  }

  destroy() {
    clearInterval(this._cleanupTimer);
    this._workflows.clear();
  }
}

// ── 单例 ──
const workflowManager = new WorkflowManager();

module.exports = { WorkflowManager, workflowManager };
