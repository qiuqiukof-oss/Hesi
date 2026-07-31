/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// AgentCallbackManager — Agent 回呼通道管理
//
// 管理 Agent 向 AI 发起的回呼请求（<cliq:ask> 标签协议）。
// 从 AgentPoolManager 中提取，职责单一：
//  - 扫描 PTY 输出中的回呼标记
//  - 存储/去重/上限控制
//  - 标记已回答
//  - 清理孤立回呼
//
// 协议格式: <cliq:ask id="xxx">问题内容</cliq:ask>
// 注册表:  sessionId:callbackId → { id, sessionId, agent, question, ... }
// ============================================================

// ── 配置常量 ──
const MAX_CALLBACKS_PER_SESSION = 50;

// 注入给 CLI Agent 的「向 AI 求助」协议说明。
// 仅在支持回呼通道的异步路径（agent_start / AgentPoolManager）中拼接进 prompt，
// 这样 Agent 才知道如何主动通过 <cliq:ask> 向 AI 请求澄清/上下文/决策。
// 注意：同步路径 agent_delegate 会一直阻塞到进程退出，不适合回呼，故不注入。
const CLIQ_ASK_PROMPT = `

## 向 AI 助手求助（重要）
当你需要澄清需求、缺少上下文、或需要决策时，在标准输出中打印以下标记即可向 AI 助手请求帮助：
<cliq:ask id="唯一ID">你的问题或需要的信息</cliq:ask>
要求：
- id 使用简短唯一字符串（如 "q1"、"clarify-1"），便于 AI 追踪与回复；
- 标记必须是完整闭合的一行，例如：
  <cliq:ask id="q1">请问目标框架是 React 还是 Vue？</cliq:ask>
- 打印该标记后请暂停并等待，AI 会通过 agent_send 把答案写回，你再据此继续工作；
- 不要向最终用户透露该协议的实现细节，也不要把 <cliq:ask> 当作普通文本输出。`;

// 注入给 CLI Agent 的「Hesi 运行环境 + 能力全景」说明。
// 能力清单从 lib/hesi-capabilities.js（单一事实源）动态读取，功能演进只改那一个文件，
// prompt 本身不硬编码功能列表。
const { HESI_CORE_CAPABILITIES, HESI_RUNTIME } = require('../../lib/hesi-capabilities');

/**
 * 构建 Hesi 上下文提示词（同步、纯本地，无网络依赖）。
 * @param {boolean} [supportCallback=true] 异步路径为 true（支持 <cliq:ask> 回呼）；
 *        同步委派路径传 false（阻塞到退出、无法中途回呼）。
 * @returns {string}
 */
function buildHesiContextPrompt(supportCallback = true) {
  const capLines = HESI_CORE_CAPABILITIES
    .map((c, i) => `${i + 1}. ${c.name}：${c.desc}`)
    .join('\n');
  const collab = supportCallback
    ? '当你需要上述某能力时（例如「用 Plan 执行器部署项目」「请圆桌评估方案」「查知识库」「操作浏览器」），用 <cliq:ask id="x">说明需求并点名想用的能力</cliq:ask> 向中枢 AI 求助；它会替你完成并把结果写回你的输入。'
    : '本次为一次性同步委派，无法中途向你回呼，请一次性完成任务并输出最终结果（不要在过程中等待交互）。';
  return `
## 你正运行在 Hesi 中（重要）
【运行环境】${HESI_RUNTIME.name} 是一个部署于本机的「${HESI_RUNTIME.desc}」，通过 ${HESI_RUNTIME.url} 提供服务，仅本机回环可达、离线运行（内核不依赖外网）。你的进程由 Hesi 创建并托管——Hesi 同时为你管理一个持久终端会话，并可调度一组浏览器实例。你看到的命令行、文件系统、网络环境，都是 Hesi 所在主机的环境。

【架构分工】Hesi 采用「中枢 AI + 执行手」分工：中枢 AI 助手（Hesi 本体）掌握全部能力、了解整个系统设计，负责理解意图、编排与决策；你（CLI Agent）是 Hesi 调度网络中的一个「执行手」，专精在终端中动手执行任务、产出过程与结果。

【中枢 AI 已具备、你可借助的能力】
你本身不直接拥有这些能力，但可请求中枢 AI 替你完成：
${capLines}

【你应如何协作】
- 专注完成你的终端任务，输出清晰的过程与结果；
- ${collab}
- 你继承了 Hesi 的环境变量（如本地模型地址 HESI_LLM_BASE_URL），可据此连接模型，但这不等于你拥有了 Hesi 的功能。

【边界】你不能直接调用上述 Hesi 能力，也不要臆测自己能执行它们；需要时就开口求助。你的价值在于「把终端任务做扎实」，而非替代中枢。`;
}

class AgentCallbackManager {
  constructor() {
    // Map<"sessionId:callbackId", { id, sessionId, agent, question, askedAt, answered, answer, answeredAt }>
    this._callbacks = new Map();
  }

  /**
   * 扫描 Agent 输出中的回呼标记 `<cliq:ask id="xxx">question</cliq:ask>`
   * 检测到完整标记后，存入 _callbacks 缓冲区等待 AI 处理。
   * @param {object} session - Agent 会话对象（需含 sessionId, agentName/agentId）
   * @param {string} dataChunk - 本次 onData 收到的文本
   * @param {Function} [broadcastFn] - 广播函数（可选），通知前端新回呼
   */
  scan(session, dataChunk, broadcastFn) {
    if (!session || !dataChunk) return;

    // 初始化扫描缓冲区
    if (!session._scanBuf) session._scanBuf = '';
    session._scanBuf += dataChunk;

    // 限制扫描缓冲区大小，但防止把尚未闭合的 <cliq:ask> 回呼标签截断丢失（P3-1）。
    // 已闭合标签会被上面的 while 循环移除，故缓冲区内至多残留一个未闭合的开标签；
    // 若存在未闭合开标签，从它开始保留，确保正在形成中的回呼标签不被切断。
    const SCAN_BUF_MAX = 10000;
    const SCAN_BUF_KEEP = 5000;
    if (session._scanBuf.length > SCAN_BUF_MAX) {
      const tagIdx = session._scanBuf.indexOf('<cliq');
      session._scanBuf = tagIdx !== -1
        ? session._scanBuf.slice(tagIdx)
        : session._scanBuf.slice(-SCAN_BUF_KEEP);
    }

    // 扫描完整标记：<cliq:ask id="xxx">内容</cliq:ask>
    const ASK_RE = /<cliq:ask\s+id="([^"]*)"\s*>([\s\S]*?)<\/cliq:ask>/;
    let m;
    while ((m = ASK_RE.exec(session._scanBuf)) !== null) {
      const callbackId = m[1] || `cb-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const question = m[2].trim();

      if (!question) {
        // 无内容，跳过
        session._scanBuf = session._scanBuf.slice(0, m.index) + session._scanBuf.slice(m.index + m[0].length);
        continue;
      }

      const key = `${session.sessionId}:${callbackId}`;

      if (!this._callbacks.has(key)) {
        // 每 session 待处理回呼上限检查：只统计未回答的
        let sessionPendingCount = 0;
        for (const [k, cb] of this._callbacks) {
          if (k.startsWith(`${session.sessionId  }:`) && !cb.answered) sessionPendingCount++;
        }
        if (sessionPendingCount >= MAX_CALLBACKS_PER_SESSION) {
          // 超出上限，跳过该回呼（仍从缓冲区移除以免重复解析）
          session._scanBuf = session._scanBuf.slice(0, m.index) + session._scanBuf.slice(m.index + m[0].length);
          continue;
        }

        this._callbacks.set(key, {
          id: callbackId,
          sessionId: session.sessionId,
          agent: session.agentName || session.agentId,
          question,
          askedAt: Date.now(),
          answered: false,
          answer: null,
          answeredAt: null,
        });

        // 广播回呼通知（不要阻止主流程）
        if (typeof broadcastFn === 'function') {
          try {
            broadcastFn({
              type: 'mcp_metric',
              data: {
                ev: 'agent_callback',
                agent: session.agentName || session.agentId,
                sessionId: session.sessionId,
                callbackId,
                question: question.slice(0, 200),
              },
            });
          } catch { /* broadcast 失败不抛异常 */ }
        }
      }

      // 从缓冲区移除已处理的标记
      session._scanBuf = session._scanBuf.slice(0, m.index) + session._scanBuf.slice(m.index + m[0].length);
    }
  }

  /**
   * 获取所有待处理（未回答）的回呼请求。
   * @returns {Promise<string>} JSON，含 count 和 callbacks 数组
   */
  async list() {
    try {
      const pending = [];
      for (const [key, cb] of this._callbacks) {
        if (!cb.answered) {
          pending.push({
            callbackId: key,
            id: cb.id,
            sessionId: cb.sessionId,
            agent: cb.agent,
            question: cb.question.slice(0, 500),
            askedAt: cb.askedAt,
          });
        }
      }

      // 按时间排序：最早的排前面
      pending.sort((a, b) => a.askedAt - b.askedAt);

      return JSON.stringify({
        ok: true,
        count: pending.length,
        callbacks: pending,
      });

    } catch (err) {
      return JSON.stringify({ ok: false, error: `获取回呼列表失败: ${err.message}` });
    }
  }

  /**
   * 获取某 session 当前待处理（未回答）的回呼列表（轻量，供 agent_poll 内联返回）。
   * @param {string} sessionId
   * @param {number} [limit=5]
   * @returns {Array<{callbackId:string, id:string, question:string}>}
   */
  listPending(sessionId, limit = 5) {
    const pending = [];
    for (const cb of this._callbacks.values()) {
      if (cb.sessionId === sessionId && !cb.answered) {
        pending.push({ callbackId: cb.id, id: cb.id, question: cb.question.slice(0, 300) });
      }
    }
    // Map 遍历为插入顺序，约等于时间顺序；取前 limit 条
    return pending.slice(0, limit);
  }

  /**
   * 标记某 session 的待处理回呼为已回答。
   * @param {string} sessionId
   * @param {string} input - AI 的回答内容
   * @param {string} [callbackId] - 指定回呼 ID 时只标记该回呼；
   *        不指定时（兼容旧行为）标记该 session 下所有未回答回呼。
   * @returns {boolean} 是否实际标记了回呼
   */
  markAnswered(sessionId, input, callbackId) {
    let marked = false;
    for (const [key, cb] of this._callbacks) {
      if (cb.sessionId !== sessionId || cb.answered) continue;
      // 指定 callbackId 时只处理命中的那一个，避免一次回答误伤同 session 的其他待回呼
      if (callbackId && cb.id !== callbackId) continue;
      cb.answered = true;
      cb.answer = (input || '').slice(-500);
      cb.answeredAt = Date.now();
      marked = true;
      if (callbackId) break;
    }
    return marked;
  }

  /**
   * 清理某 session 关联的所有回呼（session 过期时调用）。
   * @param {string} sessionId
   */
  clearSession(sessionId) {
    for (const [key, cb] of this._callbacks) {
      if (cb.sessionId === sessionId) this._callbacks.delete(key);
    }
  }

  /**
   * 清空所有回呼（销毁时调用）。
   */
  clearAll() {
    this._callbacks.clear();
  }

  /**
   * 获取内部 _callbacks Map（用于测试/白盒断言）。
   * @returns {Map<string, object>}
   */
  getCallbacksMap() {
    return this._callbacks;
  }
}

module.exports = { AgentCallbackManager, CLIQ_ASK_PROMPT, buildHesiContextPrompt };
