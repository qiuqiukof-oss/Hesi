// ============================================================
// Agent Pool Manager — 异步 Agent 任务池
//
// 管理多个 headless PTY Agent 会话的生命周期，提供非阻塞的
// 开始/轮询/发送/取消/列表操作，供 AI 工具调用。
//
// 与 executeAgent (agent_delegate) 的关系：
//   executeAgent 是同步等待模式（阻塞直到完成）
//   AgentPoolManager 是异步管理模式（AI 可并行启动多个 Agent）
//   两者共用 createHeadlessPTY 和 registry 查找逻辑。
// ============================================================

const { createHeadlessExec } = require('../../ws/pty');
const { loadRegistry } = require('../../cli-discovery');
const { AgentCallbackManager, CLIQ_ASK_PROMPT } = require('./agent-callbacks');
const { tryAcquireAgent, releaseAgent, getActiveAgentCount, MAX_GLOBAL_AGENTS } = require('./agent-concurrency');
const agentRoles = require('../../lib/agent-roles');

// ── 配置常量 ──
const MAX_POOL_SIZE = 10;         // 最大 session 数（含已完成）
const MAX_OUTPUT_PER_SESSION = 1_000_000;  // 每 session 最大 1MB
const DONE_SESSION_TTL_MS = 5 * 60 * 1000;  // 已完成 session 保留 5 分钟
const CLEANUP_INTERVAL_MS = 60_000;          // 清理周期 1 分钟
const DEFAULT_SESSION_TIMEOUT = 300_000;     // 默认单次 session 超时 5 分钟
// 最大并发活跃 Agent 由 agent-concurrency.js 的全局配额统一管理（同步委派 + 异步池合计 ${MAX_GLOBAL_AGENTS} 个）

// ── Session ID 生成 ──
let _idCounter = 0;
function generateSessionId() {
  _idCounter++;
  return `agent-${Date.now().toString(36)}-${_idCounter}`;
}

// ============================================================
// AgentPoolManager 类
// ============================================================

class AgentPoolManager {
  constructor() {
    /** @type {Map<string, object>} */
    this._sessions = new Map();

    // Agent → AI 回调管理器（委托至 agent-callbacks.js）
    /** @type {AgentCallbackManager} */
    this._callbacksMgr = new AgentCallbackManager();

    // 定时清理已完成/超时的 session
    this._cleanupTimer = setInterval(() => this._cleanup(), CLEANUP_INTERVAL_MS);
    this._cleanupTimer.unref(); // 不阻止进程退出
  }

  /**
   * 启动一个新的 Agent 会话。
   * @param {string} agentId - CLI registry 中的 Agent ID
   * @param {string} task - 任务描述
   * @param {string} [context] - 附加上下文
   * @param {Function} [broadcastFn] - 实时输出广播
   * @returns {Promise<string>} 会话信息 JSON（含 sessionId）
   */
  async start(agentId, task, context, broadcastFn, role) {
    // 在 try 外声明，确保 catch 中清理逻辑可安全引用（早期错误时为 null）
    let sessionId = null;
    try {
      // ── 容量检查 ──
      if (this._sessions.size >= MAX_POOL_SIZE) {
        return JSON.stringify({
          ok: false,
          error: `Agent 会话池已满（${MAX_POOL_SIZE}），请等待其他任务完成后再试`,
        });
      }

      // ── 查找 Agent ──
      const registry = loadRegistry();
      const agentEntry = registry.clis.find(c =>
        c.id === agentId || c.name === agentId
      );
      if (!agentEntry) {
        const available = registry.clis.filter(c => c.category === 'agent').map(c => c.name);
        return JSON.stringify({
          ok: false,
          error: `未在 CLI registry 中找到 Agent "${agentId}"。可用 Agent：${available.join('、') || '（无）'}`,
        });
      }

      // ── 创建 Session 占位（立即加入 map 防止并发竞态） ──
      sessionId = generateSessionId();
      const outputChunks = [];
      let outputSize = 0;

      const session = {
        sessionId,
        agentId,
        agentName: agentEntry.name,
        task: task.slice(0, 500),
        status: 'starting',  // starting → running → done / error / cancelled / timeout
        outputChunks,
        outputSize,
        startTime: Date.now(),
        lastActivity: Date.now(),
        exitCode: null,
        error: null,
        broadcastFn: broadcastFn || null,
        pty: null,
        timer: null,
        _pollCursor: 0, // 已通过 agent_poll 返回给 AI 的累积输出字符偏移（用于增量返回，防止重复注入上下文）
        _released: false, // 并发配额是否已释放（防止重复 release）
      };

      // 立即加入 map：确保并发检查准确（占位后活跃 Agent 计数立即生效）
      this._sessions.set(sessionId, session);

      // ── 并发检查（全局统一配额：同步委派 + 异步池合计最多 ${MAX_GLOBAL_AGENTS} 个）──
      if (!tryAcquireAgent()) {
        this._sessions.delete(sessionId);
        return JSON.stringify({
          ok: false,
          error: `当前已有 ${getActiveAgentCount()} 个 Agent 在运行，达到最大并发限制 ${MAX_GLOBAL_AGENTS}`,
        });
      }

      // 发送开始事件
      this._broadcast(session, 'agent_start', {
        agent: agentEntry.name,
        sessionId,
        task: task.slice(0, 200),
      });

      // 超时定时器
      session.timer = setTimeout(() => {
        if (session.status === 'done' || session.status === 'error' ||
            session.status === 'cancelled') return;
        session.status = 'timeout';
        session.lastActivity = Date.now();
        this._release(session); // 释放全局并发配额
        try { if (session.pty) session.pty.kill(); } catch { /* ignore */ }
        session.outputChunks.push('\n\n[agent_pool] Agent 执行超时，已自动终止');
        this._broadcast(session, 'agent_timeout', {
          agent: agentEntry.name,
          sessionId,
        });
      }, DEFAULT_SESSION_TIMEOUT);

      // 构建 prompt
      const promptParts = [];
      promptParts.push(...agentRoles.rolePrefix(role));
      promptParts.push(`你现在作为 CLI Agent "${agentEntry.name}" 执行以下任务。请专注于完成目标，输出过程和结果。`);
      if (context) {
        promptParts.push(`\n## 附加上下文\n${context}`);
      }
      promptParts.push(`\n## 任务\n${task}`);
      promptParts.push(`\n请开始执行，完成后输出执行结果。`);
      // 注入「向 AI 求助」协议，让 Agent 能在卡点时反向请求 AI 协助（仅异步路径支持回呼通道）
      promptParts.push(CLIQ_ASK_PROMPT);
      const prompt = promptParts.join('\n');

      // 创建 headless 执行（优先非 TTY 模式，避免 TUI 渲染污染讨论；无 descriptor 时回退 PTY）
      const pty = createHeadlessExec(agentEntry, prompt, {
        cols: 120,
        rows: 40,
        onData: (data) => {
          if (session.status === 'done' || session.status === 'error' ||
              session.status === 'cancelled' || session.status === 'timeout') return;

          // 首次收到数据 → 状态变为 running
          if (session.status === 'starting') {
            session.status = 'running';
          }

          outputChunks.push(data);
          outputSize += data.length;
          session.lastActivity = Date.now();

          // 实时广播输出
          this._broadcast(session, 'agent_output', {
            agent: agentEntry.name,
            sessionId,
            data: data.slice(-2000),
          });

          // 扫描 Agent 回呼标记
          this._callbacksMgr.scan(session, data, session.broadcastFn);

          // 截断：超出限制时丢弃旧数据（同步后移轮询游标，保持增量一致）
          if (outputSize > MAX_OUTPUT_PER_SESSION) {
            let removedTotal = 0;
            while (outputSize > MAX_OUTPUT_PER_SESSION && outputChunks.length > 0) {
              const removed = outputChunks.shift();
              outputSize -= removed.length;
              removedTotal += removed.length;
            }
            outputChunks.push('\n[...输出过长，已截断...]\n');
            if (session._pollCursor > 0) {
              session._pollCursor = Math.max(0, session._pollCursor - removedTotal);
            }
          }
        },
        onExit: ({ exitCode, signal }) => {
          clearTimeout(session.timer);
          if (session.status === 'cancelled' || session.status === 'timeout') return;

          session.status = 'done';
          session.exitCode = exitCode;
          session.lastActivity = Date.now();
          this._release(session); // 释放全局并发配额

          this._broadcast(session, 'agent_done', {
            agent: agentEntry.name,
            sessionId,
            exitCode,
            outputSize,
          });
        },
        onError: (err) => {
          clearTimeout(session.timer);
          if (session.status === 'cancelled') return;

          session.status = 'error';
          session.error = err.message;
          session.lastActivity = Date.now();
          this._release(session); // 释放全局并发配额

          this._broadcast(session, 'agent_error', {
            agent: agentEntry.name,
            sessionId,
            error: err.message,
          });
        },
      });

      if (pty) {
        session.pty = pty;
      } else {
        clearTimeout(session.timer);
        this._sessions.delete(sessionId);
        return JSON.stringify({
          ok: false,
          error: 'Agent PTY 创建失败，请检查 node-pty 是否可用',
        });
      }

      return JSON.stringify({
        ok: true,
        sessionId,
        agent: agentEntry.name,
        status: session.status,
      });

    } catch (err) {
      // 清理可能已加入 map 的 session
      if (sessionId && this._sessions.has(sessionId)) {
        clearTimeout(this._sessions.get(sessionId)?.timer);
        this._sessions.delete(sessionId);
      }
      return JSON.stringify({
        ok: false,
        error: `启动 Agent 失败: ${err.message}`,
      });
    }
  }

  /**
   * 轮询 Agent 会话状态和输出。
   * @param {string} sessionId
   * @returns {Promise<string>} 状态信息 JSON
   */
  async poll(sessionId) {
    try {
      const session = this._sessions.get(sessionId);
      if (!session) {
        return JSON.stringify({
          ok: false,
          error: `未找到 Agent 会话 "${sessionId}"（可能已过期或被清理）`,
        });
      }

      session.lastActivity = Date.now();

      // 增量返回：仅返回「上次 poll 之后」新增的输出，避免把同一份输出反复塞进 LLM 上下文造成 token 放大。
      // 通过 _pollCursor（累积字符串中的字符偏移）计算 delta；输出截断时游标已在 onData 中同步后移。
      const full = session.outputChunks.join('');
      let cursor = session._pollCursor || 0;
      if (cursor > full.length) cursor = 0; // 截断等异常导致游标失效，则从头重发剩余内容
      const delta = cursor > 0 ? full.slice(cursor) : full;

      const MAX_POLL_OUTPUT = 10000;
      let returned;
      let hasMore = false;
      if (delta.length > MAX_POLL_OUTPUT) {
        returned = delta.slice(-MAX_POLL_OUTPUT);
        cursor = full.length - returned.length; // 下次从本次未覆盖到的位置继续
        hasMore = true;
      } else {
        returned = delta;
        cursor = full.length;
      }
      session._pollCursor = cursor;

      // 内联返回该 session 的待处理回呼，让 AI 一次轮询即可感知是否有 <cliq:ask> 在等待回答
      const pendingCallbacks = this._callbacksMgr.listPending(session.sessionId, 5);

      return JSON.stringify({
        ok: true,
        sessionId,
        agent: session.agentName,
        status: session.status,
        runningMs: Date.now() - session.startTime,
        outputLength: full.length,
        output: returned,        // 仅本次新增的增量输出（≤10000 字符）
        isDelta: true,           // 标记这是增量而非全量，便于前端/上层区分
        hasMore,                 // 本次是否因超长而截断了输出（仍有未取回内容）
        pendingCallbacks,        // 待处理回呼（<cliq:ask>）列表，非空表示 Agent 正在等待 AI 回答
        pendingCallbackCount: pendingCallbacks.length,
        exitCode: session.exitCode,
        error: session.error,
      });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `轮询失败: ${err.message}` });
    }
  }

  /**
   * 向 Agent 会话发送额外输入。
   * @param {string} sessionId
   * @param {string} input
   * @param {string} [callbackId] - 若本次输入是在回答某条 <cliq:ask> 回呼，传入其 id，
   *        仅标记该回呼为已答，避免误伤同 session 的其他待回呼。
   * @returns {Promise<string>} 结果 JSON
   */
  async send(sessionId, input, callbackId) {
    try {
      const session = this._sessions.get(sessionId);
      if (!session) {
        return JSON.stringify({
          ok: false,
          error: `未找到 Agent 会话 "${sessionId}"`,
        });
      }

      if (session.status === 'done' || session.status === 'error' ||
          session.status === 'cancelled' || session.status === 'timeout') {
        return JSON.stringify({
          ok: false,
          error: `Agent 会话已结束（状态: ${session.status}），无法发送输入`,
        });
      }

      if (!session.pty) {
        return JSON.stringify({ ok: false, error: 'Agent PTY 不可用' });
      }

      session.pty.write(`${input  }\n`);
      session.lastActivity = Date.now();

      // Agent 发送了输入 → 标记回呼为已回答（指定 callbackId 时仅标记该条）
      this._callbacksMgr.markAnswered(sessionId, input, callbackId);

      this._broadcast(session, 'agent_input', {
        agent: session.agentName,
        sessionId,
        input: input.slice(-500),
      });

      return JSON.stringify({ ok: true, sessionId });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `发送失败: ${err.message}` });
    }
  }

  /**
   * 取消/停止 Agent 会话。
   * @param {string} sessionId
   * @returns {Promise<string>} 结果 JSON
   */
  async cancel(sessionId) {
    try {
      const session = this._sessions.get(sessionId);
      if (!session) {
        return JSON.stringify({
          ok: false,
          error: `未找到 Agent 会话 "${sessionId}"`,
        });
      }

      if (session.status === 'done' || session.status === 'error' ||
          session.status === 'cancelled' || session.status === 'timeout') {
        return JSON.stringify({
          ok: false,
          error: `Agent 会话已结束（状态: ${session.status}），无法取消`,
        });
      }

      session.status = 'cancelled';
      clearTimeout(session.timer);
      try { if (session.pty) session.pty.kill(); } catch { /* ignore */ }
      session.lastActivity = Date.now();
      this._release(session); // 释放全局并发配额

      this._broadcast(session, 'agent_cancelled', {
        agent: session.agentName,
        sessionId,
      });

      return JSON.stringify({ ok: true, sessionId });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `取消失败: ${err.message}` });
    }
  }

  /**
   * 列出所有 Agent 会话。
   * @returns {Promise<string>} 会话列表 JSON
   */
  async list() {
    try {
      const sessions = [];
      for (const [id, s] of this._sessions) {
        sessions.push({
          sessionId: id,
          agent: s.agentName,
          status: s.status,
          task: s.task.slice(0, 100),
          runningMs: Date.now() - s.startTime,
          outputLength: s.outputSize,
          lastActivityAgo: Date.now() - s.lastActivity,
        });
      }

      // 排序：运行中的排前面，同一状态下最近活跃的排前面
      const statusOrder = { running: 0, starting: 0, done: 1, error: 1, timeout: 1, cancelled: 1 };
      sessions.sort((a, b) => {
        const sa = statusOrder[a.status] ?? 1;
        const sb = statusOrder[b.status] ?? 1;
        if (sa !== sb) return sa - sb;
        // lastActivityAgo 越小 → 越近活跃，排前面
        return a.lastActivityAgo - b.lastActivityAgo;
      });

      return JSON.stringify({
        ok: true,
        count: sessions.length,
        activeCount: getActiveAgentCount(),
        sessions,
      });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `列表获取失败: ${err.message}` });
    }
  }

  /**
   * 获取 Agent 向 AI 发起的待处理回呼请求。
   * 委托给 AgentCallbackManager。
   * @returns {Promise<string>} JSON
   */
  async callbacks() {
    return this._callbacksMgr.list();
  }

  // ── 内部方法 ──

  /** 当前活跃（running/starting）的 Agent 数量 */
  _activeCount() {
    let count = 0;
    for (const s of this._sessions.values()) {
      if (s.status === 'starting' || s.status === 'running') count++;
    }
    return count;
  }

  /**
   * 释放某 session 占用的全局并发配额（幂等）。
   * 在 done/error/timeout/cancel/僵尸清理等终态各调用一次，避免重复释放。
   * @param {object} session
   */
  _release(session) {
    if (session && !session._released) {
      session._released = true;
      releaseAgent();
    }
  }

  /** 广播事件 */
  _broadcast(session, ev, extra = {}) {
    if (!session.broadcastFn) return;
    try {
      session.broadcastFn({
        type: 'mcp_metric',
        data: { ev, ...extra },
      });
    } catch { /* broadcast 失败不抛异常 */ }
  }

  /** 定时清理已完成/超时的 session */
  _cleanup() {
    const now = Date.now();
    for (const [id, s] of this._sessions) {
      // 清理条件：已完成/错误/超时/取消 + 超过保留时间
      if ((s.status === 'done' || s.status === 'error' ||
           s.status === 'timeout' || s.status === 'cancelled') &&
          (now - s.lastActivity) > DONE_SESSION_TTL_MS) {
        // 确保 PTY 已释放
        try { if (s.pty) s.pty.kill(); } catch { /* ignore */ }
        this._sessions.delete(id);
      }

      // 清理僵尸会话（running 但超过 TTL + 额外缓冲）
      if ((s.status === 'starting' || s.status === 'running') &&
          (now - s.lastActivity) > DEFAULT_SESSION_TIMEOUT + DONE_SESSION_TTL_MS) {
        s.status = 'timeout';
        try { if (s.pty) s.pty.kill(); } catch { /* ignore */ }
        this._release(s); // 僵尸会话释放配额（幂等）
        this._sessions.delete(id);
      }

      // 关联的回呼已无 session → 清理
      if (!this._sessions.has(id)) {
        this._callbacksMgr.clearSession(id);
      }
    }
  }

  /** 销毁管理器（用于测试/清理） */
  destroy() {
    clearInterval(this._cleanupTimer);
    for (const [id, s] of this._sessions) {
      try { if (s.pty) s.pty.kill(); } catch { /* ignore */ }
    }
    this._sessions.clear();
    this._callbacksMgr.clearAll();
  }
}

// ── 单例导出 ──
const agentPool = new AgentPoolManager();

module.exports = {
  AgentPoolManager,
  agentPool,
};
