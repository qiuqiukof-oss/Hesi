/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Digital Employee — 数字员工角色系统
//
// 支持角色化数字员工定义、团队管理、人机协作请求。
// 基于腾讯云AI公开课理念：不同角色不同工具集，角色间协作。
// ============================================================

const ROLES = {
  SALES: 'sales',
  NEW_MEDIA: 'new-media',
  PRODUCTION: 'production',
  EXPERT: 'expert',
  ASSISTANT: 'assistant',
  WORKBUDDY: 'workbuddy',
};

const ROLE_CONFIG = {
  [ROLES.SALES]: {
    name: '销售运营数字员工',
    nameEn: 'Sales Operations',
    icon: '📊',
    description: '客户接待、对接、定价策略、客户信息反馈',
    persona: '你是销售运营专家，擅长客户需求洞察、转化策略与定价方案，输出以增长和可执行为导向，用数据与话术支撑结论。',
    color: '#4f46e5',
  },
  [ROLES.NEW_MEDIA]: {
    name: '新媒体数字员工',
    nameEn: 'New Media',
    icon: '📱',
    description: '视频脚本生成、AI视频、社交媒体管理、账号矩阵',
    persona: '你是新媒体运营专家，擅长选题、脚本、矩阵分发与爆款拆解，输出适合短视频/社媒传播、易引发互动的内容。',
    color: '#0891b2',
  },
  [ROLES.PRODUCTION]: {
    name: '生产管理数字员工',
    nameEn: 'Production Management',
    icon: '🏭',
    description: '柔性化生产管理、订单履约工作流',
    persona: '你是生产管理专家，擅长柔性排产、订单履约与供应链协同，关注交付准时率、良率与成本，给出可落地的排程。',
    color: '#059669',
  },
  [ROLES.EXPERT]: {
    name: 'AI专家团',
    nameEn: 'AI Expert Team',
    icon: '🎓',
    description: '行业专家级分析、深度研究报告',
    persona: '你是行业资深专家，擅长深度研究、严谨论证与结构化报告，先界定问题边界与假设，再给出有依据、有洞察、可追溯的结论。',
    color: '#d97706',
  },
  [ROLES.ASSISTANT]: {
    name: '通用AI助手',
    nameEn: 'AI Assistant',
    icon: '🤖',
    description: '通用任务执行、信息查询',
    persona: '你是高效的通用AI助手，擅长信息检索、任务执行与总结，准确、简洁、条理清晰，不臆测。',
    color: '#6b7280',
  },
  [ROLES.WORKBUDDY]: {
    name: 'WorkBuddy 工作助手',
    nameEn: 'WorkBuddy Assistant',
    icon: '🤖',
    description: '通过 WorkBuddy CLI 执行工单管理、客户查询、数据导出等任务',
    persona: '你是 WorkBuddy 工作助手，擅长调用工具完成工单处理、客户查询与数据导出等实际任务，优先把事情办成并给出结果。',
    color: '#8b5cf6',
  },
};

/**
 * 创建一个数字员工实例。
 *
 * @param {object} opts
 * @param {string} opts.role          — 角色 ID（ROLES 常量之一）
 * @param {string} [opts.name]        — 自定义名称，默认使用角色配置名
 * @param {string} opts.agentId       — 关联的 AI Agent ID
 * @param {object} [opts.contextStore] — Context Store 实例（用于人机通信）
 * @param {string[]} [opts.tools]     — 可用工具列表
 * @returns {object} 数字员工实例
 */
function createDigitalEmployee(opts) {
  const { role, name, agentId, contextStore, tools } = opts;
  const roleCfg = ROLE_CONFIG[role] || ROLE_CONFIG[ROLES.ASSISTANT];
  return {
    id: `de-${role}-${Date.now()}`,
    role,
    name: name || roleCfg.name,
    icon: roleCfg.icon,
    color: roleCfg.color,
    persona: roleCfg.persona, // system persona injected into the agent context
    agentId,
    tools: tools || [],
    status: 'idle',  // idle|working|waiting_human|error
    taskQueue: [],
    currentTask: null,
    _draining: false, // guards the queue-drain worker (see digital-employee-worker.js)
    stats: { tasksCompleted: 0, tasksFailed: 0, humanRequests: 0 },

    /**
     * 分配任务给数字员工。
     * @param {object} task — { id, label, task, agentId, ... }
     * @returns {{ status: string, taskId: string }}
     */
    async assignTask(task) {
      this.taskQueue.push(task);
      this.status = 'working';
      this.currentTask = task;
      return { status: 'queued', taskId: task.id };
    },

    /**
     * 请求真人员工输入（人机协作）。
     * 通过 Context Store 发布请求，订阅响应。
     *
     * @param {object} request
     * @param {string} request.taskId    — 任务 ID
     * @param {string} request.question  — 向人类提问的内容
     * @param {string} [request.expectedFormat] — 期望的回复格式
     * @returns {Promise<string>} 人类的回复
     */
    async requestHumanInput(request) {
      this.status = 'waiting_human';
      this.stats.humanRequests++;

      // 防止 contextStore 未定义时崩溃
      if (!contextStore) {
        this.status = 'error';
        return '[NO_CONTEXT_STORE] 无法发送人机协作请求';
      }

      contextStore.set(`human:request:${request.taskId}`, {
        employeeId: this.id,
        employeeName: this.name,
        question: request.question,
        expectedFormat: request.expectedFormat || 'text',
        timestamp: Date.now(),
        status: 'pending',
      }, {
        tags: ['human:request', `employee:${this.id}`],
        type: 'human:request',
        source: this.id,
        ttl: 3600000,
      });

      return new Promise((resolve) => {
        const unsubscribe = contextStore.subscribe(
          `human:response:${request.taskId}`, (entry) => {
            this.status = 'working';
            resolve(entry.value.answer || entry.value || '');
            unsubscribe();
          });
        setTimeout(() => {
          this.status = 'error';
          resolve('[TIMEOUT] 人类未在超时时间内回复');
          unsubscribe();
        }, 1800000); // 30 minutes timeout
      });
    },

    /**
     * 获取当前状态快照。
     * @returns {object}
     */
    getStatus() {
      return {
        id: this.id,
        role: this.role,
        name: this.name,
        icon: this.icon,
        color: this.color,
        agentId: this.agentId,
        status: this.status,
        queueLength: this.taskQueue.length,
        currentTask: this.currentTask
          ? { id: this.currentTask.id, label: this.currentTask.label }
          : null,
        stats: { ...this.stats },
      };
    },
  };
}

/**
 * 创建数字员工团队管理器。
 *
 * @param {object} deps
 * @param {object} [deps.contextStore]  — Context Store 实例
 * @param {object} [deps.agentManager]  — Agent Manager 实例
 * @param {object} [deps.agentPool]     — 共享 AgentPoolManager（提供真实任务执行）
 * @param {(data:object)=>void} [deps.broadcast] — WS 广播函数（推送圆桌执行事件）
 * @param {object} [deps.runnerOpts]    — 传给 createTaskRunner 的可选项（超时/轮询间隔等）
 * @returns {object} 团队管理器
 */
function createDigitalEmployeeTeam({ contextStore, agentManager, agentPool, broadcast, runnerOpts } = {}) {
  const team = new Map();

  // Execution engine: only wired when an agentPool is provided. Without it the
  // team degrades to queue-only (legacy behavior) rather than crashing — useful
  // for tests / minimal embeds. With it, dispatched tasks actually run.
  let runner = null;
  if (agentPool) {
    const { createTaskRunner } = require('./digital-employee-worker');
    runner = createTaskRunner({ agentPool, broadcast, ...(runnerOpts || {}) });
  }

  return {
    /** Whether real execution is wired (agentPool present). */
    get canExecute() { return runner !== null; },

    /** The underlying task runner (null when queue-only). Exposed for tests. */
    get runner() { return runner; },

    /**
     * 注册一个数字员工到团队。
     * @param {object} employee — 由 createDigitalEmployee 创建的实例
     */
    register(employee) {
      team.set(employee.id, employee);
      if (contextStore) {
        contextStore.set(`team:member:${employee.id}`, employee.getStatus(), {
          tags: ['team:member', `role:${employee.role}`],
          type: 'team:member',
          source: 'team-manager',
          ttl: 0, // no expiry for team members
        });
      }
    },

    /**
     * 从团队移除数字员工。
     * @param {string} id
     */
    unregister(id) {
      team.delete(id);
      if (contextStore) contextStore.delete(`team:member:${id}`);
    },

    /**
     * 按角色查找数字员工。
     * @param {string} role
     * @returns {object|null}
     */
    findByRole(role) {
      for (const e of team.values()) {
        if (e.role === role) return e;
      }
      return null;
    },

    /**
     * 按 ID 查找数字员工。
     * @param {string} id
     * @returns {object|null}
     */
    findById(id) {
      return team.get(id) || null;
    },

    /**
     * 向指定角色的数字员工分配任务。
     * @param {string} role
     * @param {object} task
     * @returns {Promise<object>}
     */
    async dispatchTask(role, task) {
      const e = this.findByRole(role);
      if (!e) throw new Error(`没有找到角色为 "${role}" 的数字员工`);
      const res = await e.assignTask(task);
      // Fire-and-forget the queue drain so dispatch returns promptly. drain() is
      // idempotent (guarded by employee._draining), so concurrent dispatches to
      // the same employee coalesce into one serial worker that picks up every
      // newly-enqueued task. Errors are surfaced via broadcast events, never thrown.
      if (runner) runner.drain(e).catch(() => { /* reported via de:task-error */ });
      return res;
    },

    /**
     * 分配任务并等待真实执行结果（需要 agentPool）。
     * 若未接入执行引擎则退回排队语义。
     * @param {string} role
     * @param {object} task
     * @returns {Promise<object>} runOne 的结果或排队结果
     */
    async dispatchAndRun(role, task) {
      const e = this.findByRole(role);
      if (!e) throw new Error(`没有找到角色为 "${role}" 的数字员工`);
      if (!runner) return e.assignTask(task);
      return runner.runOne(e, task);
    },

    /**
     * 获取整个团队的状态。
     * @returns {object}
     */
    getTeamStatus() {
      const members = [...team.values()].map(e => e.getStatus());
      return {
        totalMembers: team.size,
        idleCount: members.filter(m => m.status === 'idle').length,
        workingCount: members.filter(m => m.status === 'working').length,
        waitingHumanCount: members.filter(m => m.status === 'waiting_human').length,
        errorCount: members.filter(m => m.status === 'error').length,
        members,
      };
    },

    /**
     * 列出所有可用角色及注册状态。
     * @returns {object[]}
     */
    listAvailableRoles() {
      return Object.entries(ROLE_CONFIG).map(([role, cfg]) => ({
        role,
        ...cfg,
        registered: this.findByRole(role) !== null,
      }));
    },

    /**
     * 获取团队中所有数字员工。
     * @returns {object[]}
     */
    getAllMembers() {
      return [...team.values()];
    },

    /**
     * 获取团队大小。
     * @returns {number}
     */
    get size() {
      return team.size;
    },
  };
}

module.exports = { createDigitalEmployee, createDigitalEmployeeTeam, ROLES, ROLE_CONFIG };
