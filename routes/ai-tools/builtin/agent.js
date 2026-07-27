// ============================================================
// Builtin Tool: agent_delegate
//
// 委派任务给 CLI Agent（如 opencode、codex、claude-code）
// 并实时返回 Agent 的工作过程输出。
//
// 使用 headless PTY 执行，支持超时和实时反馈。
// ============================================================

const { createHeadlessExec } = require('../../../ws/pty');
const { loadRegistry } = require('../../../cli-discovery');
const { agentPool } = require('../agent-pool');
const { workflowManager } = require('../workflow-manager');
const { tryAcquireAgent, releaseAgent, getActiveAgentCount, MAX_GLOBAL_AGENTS } = require('../agent-concurrency');

// Agent 输出截断限制
const MAX_AGENT_OUTPUT_CHARS = 100_000;  // 每 session 最大保留字符数
const MAX_AGENT_RETURN_CHARS = 20_000;   // 同步委派返回给 LLM 的最大字符数（防止巨量输出撑爆上下文 / 浪费 token）

// 注：全局并发配额由 agent-concurrency.js 统一管理（同步委派 + 异步池合计最多 3 个），
// 不再使用本模块独立的 _activeAgentCount，避免两条路径叠加成「实际 6 个」且与文档矛盾。

// ── 当前 agent_delegate 持有的游离 PTY 引用 ──
// agent_delegate 是同步阻塞路径，直接 createHeadlessPTY 而不经 agentPool，
// 故其 PTY 未在 agentPool 的 session map 中。这里保存引用，供「停止生成」时
// （SSE 流检测到客户端断开）强制 kill，避免产生孤儿 Agent 进程。
let _currentDelegatePTY = null;
/** 停止当前 agent_delegate 持有的 PTY（若存在）。返回是否执行了 kill。 */
function killDelegatePTY() {
  if (_currentDelegatePTY && typeof _currentDelegatePTY.kill === 'function') {
    try { _currentDelegatePTY.kill(); } catch { /* ignore */ }
    _currentDelegatePTY = null;
    return true;
  }
  _currentDelegatePTY = null;
  return false;
}

// ── 中断标志：当 SSE 流检测到客户端断开（用户点停止）时置位，
// executeAgent 据此立即 kill 当前游离 PTY 并提前 resolve，从而让阻塞中的
// 同步委派也能被「停止」真正打断，而不是一直挂到 Agent 自然退出。──
let _agentAborted = false;
function abortDelegate() { _agentAborted = true; killDelegatePTY(); }

/**
 * 在 headless PTY 中执行 CLI Agent，收集输出并返回。
 * 支持通过 broadcastFn 实时推送 Agent 的输出事件。
 *
 * @param {string} agentId - Agent 标识（如 opencode、codex）
 * @param {string} task - 任务描述
 * @param {string} [context] - 附加上下文
 * @param {number} [timeout=120000] - 超时毫秒
 * @param {Function} [broadcastFn] - 用于实时推送输出的事件广播
 * @returns {Promise<string>} Agent 输出
 */
function executeAgent(agentId, task, context, timeout = 120000, broadcastFn) {
  _agentAborted = false; // 每次委派独立，避免上一次中断标志污染本次
  let aborted = false;
  const abortFn = () => { aborted = true; };
  // 并发配额释放（幂等）：executeAgent 的超时/退出/错误/启动失败分支可能同时触发，
  // 用 released 标志保证 releaseAgent 只调用一次，避免计数错乱（修复原 _activeAgentCount 重复递减成负数）。
  let released = false;
  const releaseOnce = () => { if (!released) { released = true; releaseAgent(); } };
  return new Promise((resolve) => {
    const registry = loadRegistry();
    const agentEntry = registry.clis.find(c =>
      c.id === agentId || c.name === agentId
    );
    if (!agentEntry) {
      resolve(`[agent_delegate] 错误：未在 CLI registry 中找到 Agent "${agentId}"。可用 Agent：${registry.clis.map(c => c.name).join('、')}`);
      return;
    }

    // ── 并发控制（全局统一配额：同步委派 + 异步池合计最多 ${MAX_GLOBAL_AGENTS} 个）──
    if (!tryAcquireAgent()) {
      resolve(`[agent_delegate] 错误：当前已有 ${getActiveAgentCount()} 个 Agent 在运行，达到最大并发限制 ${MAX_GLOBAL_AGENTS}。请等待其他任务完成。`);
      return;
    }

    // registry 中存储的已经是解析后的绝对路径
    const commandPath = agentEntry.path;
    // 解析命令：Agent 一般直接启动（无额外参数）
    const args = agentEntry.args || [];

    // 构建 prompt：角色设定 + 任务描述 + 上下文
    const promptParts = [];
    promptParts.push(`你现在作为 CLI Agent "${agentEntry.name}" 执行以下任务。请专注于完成目标，输出过程和结果。`);
    if (context) {
      promptParts.push(`\n## 附加上下文\n${context}`);
    }
    promptParts.push(`\n## 任务\n${task}`);
    promptParts.push(`\n请开始执行，完成后输出执行结果。`);
    const prompt = promptParts.join('\n');

    const outputChunks = [];
    let outputSize = 0;
    let timedOut = false;

    // 超时定时器
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (pty) pty.kill(); } catch { /* ignore */ }
      const output = outputChunks.join('');
      releaseOnce();
      abortFn(); // 视为中断，onData 不再写入
      const capped = output.length > MAX_AGENT_RETURN_CHARS
        ? `${output.slice(0, MAX_AGENT_RETURN_CHARS)  }\n\n[agent_delegate] 输出过长，已截断至前 ${MAX_AGENT_RETURN_CHARS} 字符（完整输出共 ${output.length} 字符）]`
        : output;
      const msg = capped
        ? `${capped  }\n\n[agent_delegate] Agent 执行超时，以上为已捕获的输出`
        : '[agent_delegate] Agent 执行超时，未捕获到输出';
      // 发送超时事件
      if (broadcastFn) {
        broadcastFn({ type: 'mcp_metric', data: { ev: 'agent_timeout', agent: agentId, timeout } });
      }
      resolve(msg);
    }, timeout);

    // 发送开始事件
    if (broadcastFn) {
      broadcastFn({
        type: 'mcp_metric',
        data: {
          ev: 'agent_start',
          agent: agentId,
          task: task.slice(0, 200),
        },
      });
    }

    const pty = createHeadlessExec(agentEntry, prompt, {
      cols: 120,
      rows: 80,
      onData: (data) => {
        if (timedOut || aborted) return;
        outputChunks.push(data);
        outputSize += data.length;

        // 实时推送 Agent 输出（通过 broadcastFn 以 SSE 事件发送）
        if (broadcastFn) {
          broadcastFn({
            type: 'mcp_metric',
            data: {
              ev: 'agent_output',
              agent: agentId,
              data: data.slice(-2000), // 每块最多 2000 字符
            },
          });
        }

        // 超出截断限制后丢弃旧数据
        if (outputSize > MAX_AGENT_OUTPUT_CHARS) {
          while (outputSize > MAX_AGENT_OUTPUT_CHARS && outputChunks.length > 0) {
            const removed = outputChunks.shift();
            outputSize -= removed.length;
          }
          outputChunks.push('\n[...输出过长，已截断...]\n');
        }
      },
      onExit: ({ exitCode, signal }) => {
        clearTimeout(timer);
        releaseOnce();

        const output = outputChunks.join('').trim();
        // 截断返回给 LLM 的内容，避免超长 Agent 输出撑爆上下文窗口
        const capped = output.length > MAX_AGENT_RETURN_CHARS
          ? `${output.slice(0, MAX_AGENT_RETURN_CHARS)  }\n\n[agent_delegate] 输出过长，已截断至前 ${MAX_AGENT_RETURN_CHARS} 字符（完整输出共 ${output.length} 字符）]`
          : output;
        const summary = exitCode === 0
          ? (capped || '(Agent 执行成功，无输出)')
          : (capped
            ? `${capped}\n\n[agent_delegate] Agent 退出码: ${exitCode}${signal ? ` (信号: ${signal})` : ''}`
            : `[agent_delegate] Agent 执行失败 (退出码: ${exitCode})`);

        // 发送完成事件
        if (broadcastFn) {
          broadcastFn({
            type: 'mcp_metric',
            data: {
              ev: 'agent_done',
              agent: agentId,
              exitCode,
              outputSize: output.length,
            },
          });
        }

        resolve(summary);
        abortFn();
        if (_currentDelegatePTY === pty) _currentDelegatePTY = null;
      },
      onError: (err) => {
        clearTimeout(timer);
        releaseOnce();
        abortFn();
        if (_currentDelegatePTY === pty) _currentDelegatePTY = null;
        if (broadcastFn) {
          broadcastFn({
            type: 'mcp_metric',
            data: { ev: 'agent_error', agent: agentId, error: err.message },
          });
        }
        resolve(`[agent_delegate] Agent "${agentId}" 启动失败: ${err.message}`);
      },
    });

    // prompt 已由 createHeadlessExec 注入（headless 走 stdin / PTY 走 typed input）
    if (pty) {
      _currentDelegatePTY = pty;
    } else {
      abortFn(); // PTY 创建失败 = 中断
      clearTimeout(timer);
      releaseOnce();
      resolve(`[agent_delegate] Agent PTY 创建失败，请检查 node-pty 是否可用`);
    }
  });
}

/**
 * 注册所有 Agent 相关工具（agent_delegate + 异步池 5 工具）。
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  // ── 1. agent_delegate（阶段 1：同步委派） ──
  registry.register({
    name: 'agent_delegate',
    description: '【同步/阻塞模式】向指定的 CLI Agent（如 opencode、codex、claude-code 等）委派一项复杂任务，' +
      '调用后会一直等待，直到 Agent 执行完成或超时才返回完整结果，期间 AI 无法做其他事、也无法中途干预。' +
      'Agent 专注于编码、分析、调试等专业领域，比通用 exec_terminal 更适合需要多步骤推理的复杂任务。\n\n' +
      '使用步骤：\n' +
      '1. 先用 cli_discover 查看可用的 Agent 及其 ID\n' +
      '2. 选择合适的 Agent 并描述清晰的任务\n' +
      '3. Agent 会实时输出工作过程\n' +
      '4. 等待完成后审查结果\n\n' +
      '何时用它：单个、目标明确、预计能在超时时间内跑完的一次性任务，且你愿意同步等待完整结果。\n' +
      '何时改用 agent_start：任务耗时较长、需要并行启动多个 Agent、或需要中途查看进度 / 追加指令 / 取消 —— ' +
      '这些场景请用 agent_start（异步模式），它会立即返回 sessionId 而不阻塞。\n\n' +
      '注意：Agent 有并发限制（同步委派 + 异步池合计最多 3 个同时运行），超时保护默认 2 分钟、最大 5 分钟。' +
      'agent_delegate 为同步阻塞模式，不支持 <cliq:ask> 回呼交互（Agent 无法在途中向你提问/求助）；' +
      '若任务可能需要中途澄清或决策，请改用 agent_start（异步模式，支持回呼）。',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: '要调用的 Agent ID（如 opencode、codex、claude），使用 cli_discover 工具或查看 CLI registry 可获取完整列表',
        },
        task: {
          type: 'string',
          description: '要委派给 Agent 的任务描述。应包含：1) 明确的目标 2) 约束条件 3) 期望的输出格式。例如："在 src/components/ 下创建一个文件上传组件，使用 Express 的 multer 中间件，支持拖拽上传，包含前端页面和后端路由"',
        },
        context: {
          type: 'string',
          description: '附加上下文信息，如：相关文件内容、代码片段、需求文档、架构说明等（可选，但强烈建议提供以提升 Agent 工作质量）',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 120000（2 分钟），最大 300000（5 分钟）',
          default: 120000,
        },
      },
      required: ['agentId', 'task'],
    },
    execute: async (args, broadcastFn) => {
      const agentId = (args.agentId || '').trim();
      const task = (args.task || '').trim();
      const context = (args.context || '').trim();
      const timeout = Math.min(args.timeout || 120000, 300000);

      if (!agentId) return '[agent_delegate] 错误：agentId 参数不能为空';
      if (!task) return '[agent_delegate] 错误：task 参数不能为空';

      return executeAgent(agentId, task, context, timeout, broadcastFn);
    },
  });

  // ── 2. agent_start（阶段 2：异步启动） ──
  registry.register({
    name: 'agent_start',
    description: '【异步/非阻塞模式】在后台启动一个 CLI Agent 会话，立即返回 sessionId 而不等待任务完成。' +
      'AI 可以同时启动多个 Agent 并行工作，稍后使用 agent_poll 检查进度（增量输出）、agent_send 发送更多输入、' +
      'agent_cancel 取消任务，最后使用 agent_list 查看所有活跃会话。\n\n' +
      '适合场景：\n' +
      '- 需要多个 Agent 并行工作（如：分析代码 + 编写测试 + 部署）\n' +
      '- Agent 需要长时间运行，AI 不想一直阻塞等待\n' +
      '- AI 需要中途介入 Agent 的工作方向\n\n' +
      '与 agent_delegate 的区别：agent_delegate 是同步阻塞、一次性拿到完整结果，适合简单的一次性任务、代码更简单；' +
      'agent_start 是异步非阻塞、立即返回 sessionId，适合长任务、并行、或需要中途 poll / send / cancel 干预的场景。' +
      '两者不要混用同一个任务。\n\n' +
      '注意：最多同时运行 3 个活跃 Agent，已完成会话保留 5 分钟后自动清理。',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: '要调用的 Agent ID（如 opencode、codex、claude）',
        },
        task: {
          type: 'string',
          description: '任务描述。例如："分析 src/ 目录下的代码结构，输出主要模块和依赖关系"',
        },
        context: {
          type: 'string',
          description: '附加上下文（可选）',
        },
      },
      required: ['agentId', 'task'],
    },
    execute: async (args, broadcastFn) => {
      const agentId = (args.agentId || '').trim();
      const task = (args.task || '').trim();
      const context = (args.context || '').trim();

      if (!agentId) return JSON.stringify({ ok: false, error: 'agentId 参数不能为空' });
      if (!task) return JSON.stringify({ ok: false, error: 'task 参数不能为空' });

      return agentPool.start(agentId, task, context, broadcastFn);
    },
  });

  // ── 3. agent_poll（阶段 2：轮询状态） ──
  registry.register({
    name: 'agent_poll',
    description: '检查异步 Agent 会话的状态和输出。返回当前状态（starting/running/done/error/timeout/cancelled）' +
      '、运行时长、最近增量输出和退出码。\n\n' +
      '输出为「增量」：每次调用只返回上次 poll 之后新增的内容，多次轮询不会重复累积，从而避免把同一份输出反复塞进上下文、放大 token 消耗。' +
      '返回字段 isDelta=true（始终为增量）、hasMore 表示输出超长被截断仍有未取回内容。\n\n' +
      '返回还包含 pendingCallbacks / pendingCallbackCount：若非空，说明 Agent 正通过 <cliq:ask> 向你提问/求助，' +
      '你应当调用 agent_callbacks 取回完整问题、用 agent_send（带 callbackId）回答，再继续轮询。\n\n' +
      '通常与 agent_start 配合使用：\n' +
      '1. agent_start → 获取 sessionId\n' +
      '2. agent_poll → 检查进度（可多次调用，每次拿增量）；若 pendingCallbacks 非空则先回答回呼\n' +
      '3. 状态变为 done 后代表任务结束（最后一次 poll 会返回全部剩余输出）',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'agent_start 返回的会话 ID',
        },
      },
      required: ['sessionId'],
    },
    execute: async (args) => {
      const sessionId = (args.sessionId || '').trim();
      if (!sessionId) return JSON.stringify({ ok: false, error: 'sessionId 参数不能为空' });
      return agentPool.poll(sessionId);
    },
  });

  // ── 4. agent_send（阶段 2：发送输入） ──
  registry.register({
    name: 'agent_send',
    description: '向正在运行的 Agent 会话发送额外输入/指令。' +
      '可用于：指导 Agent 调整方向、提供更多上下文、回答 Agent 的问题（<cliq:ask> 回呼）、纠正 Agent 的错误理解。\n\n' +
      '如果本次输入是在回答某条 <cliq:ask> 回呼，请通过 callbackId 指定其 id（来自 agent_callbacks 返回的回调列表），' +
      '这样系统只会把那一条回呼标记为已答，避免误伤同会话里其他还在等待的回呼。\n\n' +
      '注意：只能在 Agent 处于 running 或 starting 状态时使用。已完成的 Agent 无法接收输入。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'agent_start 返回的会话 ID',
        },
        input: {
          type: 'string',
          description: '要发送给 Agent 的输入内容。例如："把方案改为使用 WebSocket 而不是轮询"、"第 3 行有 bug，修复一下"、"忽略上一个要求，继续"',
        },
        callbackId: {
          type: 'string',
          description: '（可选）本次输入所回答的 <cliq:ask> 回呼 ID。由 agent_callbacks 返回，指定后仅标记该回呼为已答',
        },
      },
      required: ['sessionId', 'input'],
    },
    execute: async (args) => {
      const sessionId = (args.sessionId || '').trim();
      const input = (args.input || '').trim();
      const callbackId = (args.callbackId || '').trim();
      if (!sessionId) return JSON.stringify({ ok: false, error: 'sessionId 参数不能为空' });
      if (!input) return JSON.stringify({ ok: false, error: 'input 参数不能为空' });
      return agentPool.send(sessionId, input, callbackId || undefined);
    },
  });

  // ── 5. agent_cancel（阶段 2：取消任务） ──
  registry.register({
    name: 'agent_cancel',
    description: '取消/终止一个正在运行的 Agent 会话。Agent 的 PTY 进程会被立即 kill，' +
      '当前已捕获的输出可在 agent_poll 中获取。\n\n' +
      '使用场景：\n' +
      '- Agent 方向错误，需要重新开始\n' +
      '- 任务已不再需要\n' +
      '- 需要释放并发名额给其他 Agent',
    parameters: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'agent_start 返回的会话 ID',
        },
      },
      required: ['sessionId'],
    },
    execute: async (args) => {
      const sessionId = (args.sessionId || '').trim();
      if (!sessionId) return JSON.stringify({ ok: false, error: 'sessionId 参数不能为空' });
      return agentPool.cancel(sessionId);
    },
  });

  // ── 6. agent_list（阶段 2：列出会话） ──
  registry.register({
    name: 'agent_list',
    description: '列出所有 Agent 会话（包括运行中和已完成的）。返回每个会话的 sessionId、' +
      'Agent 名称、状态、运行时长、输出大小和最后活跃时间。\n\n' +
      '运行中的会话排在最前面。可用于：\n' +
      '- 查看有哪些 Agent 还在工作\n' +
      '- 获取 sessionId 用于 agent_poll/agent_send/agent_cancel\n' +
      '- 确认所有 Agent 是否已完成',
    parameters: {
      type: 'object',
      properties: {
        // 无参数
      },
    },
    execute: async () => {
      return agentPool.list();
    },
  });

  // ── 7. agent_callbacks（阶段 3：Agent 回呼通道） ──
  registry.register({
    name: 'agent_callbacks',
    description: '获取 Agent 向 AI 发起的待处理回呼请求。Agent 在 PTY 中通过 ' +
      '<cliq:ask id="xxx">问题内容</cliq:ask> 格式向 AI 发起提问/求助。\n\n' +
      '使用步骤：\n' +
      '1. AI 启动一个 Agent（agent_start）开始任务\n' +
      '2. Agent 运行中可随时通过 <cliq:ask> 标签向 AI 提问\n' +
      '3. AI 调用 agent_callbacks 获取所有待处理的回呼请求\n' +
      '4. AI 分析问题后，通过 agent_send 将答案输入给 Agent\n' +
      '5. Agent 接收到答案后继续执行\n\n' +
      '注意：\n' +
      '- 只返回未回答的回呼（pending），已回答的会自动移除\n' +
      '- 回呼按时间排序，最早的排前面\n' +
      '- Agent 必须先输出完整闭合的 <cliq:ask> 标签才算一个有效回呼',
    parameters: {
      type: 'object',
      properties: {},
    },
    execute: async () => {
      return agentPool.callbacks();
    },
  });

  // ── 8. workflow_start（阶段 3：启动工作流） ──
  registry.register({
    name: 'workflow_start',
    description: '启动一个多步工作流（流水线），按依赖关系依次或并行执行多个 Agent 任务。' +
      '适用于复杂场景：代码审查流水线、多语言翻译、自动化测试套件等。\n\n' +
      '每个任务定义包含：\n' +
      '- id: 任务标识（可选，用于 dependsOn 引用）\n' +
      '- agentId: 执行任务的 Agent ID（如 opencode、codex）\n' +
      '- task: 任务描述\n' +
      '- dependsOn: 依赖的上游任务 ID 数组（可选）\n' +
      '- maxRetries: 失败重试次数（默认 0）\n' +
      '- onFailure: 失败策略 — stop（停止全部）/ continue（继续）/ skip-dependents（跳过依赖）\n\n' +
      '示例：代码审查流水线\n' +
      'tasks: [\n' +
      '  { id: "step1", agentId: "opencode", task: "实现文件上传功能" },\n' +
      '  { id: "step2", agentId: "codex", task: "审查上一步代码", dependsOn: ["step1"] },\n' +
      '  { id: "step3", agentId: "freebuff", task: "运行测试", dependsOn: ["step1"] }\n' +
      ']\n\n' +
      '注意：工作流异步执行，启动后使用 workflow_status 检查进度。最大 50 个任务，30 分钟超时。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '工作流名称，如 "代码审查流水线"、"多语言翻译"',
        },
        tasks: {
          type: 'array',
          description: '任务定义数组，每个任务包含 agentId、task、可选的 dependsOn/maxRetries/onFailure',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '任务 ID（可选，用于 dependsOn 引用）' },
              agentId: { type: 'string', description: '执行 Agent（如 opencode）' },
              task: { type: 'string', description: '任务描述' },
              dependsOn: { type: 'array', items: { type: 'string' }, description: '依赖的上游任务 ID' },
              maxRetries: { type: 'number', description: '失败重试次数（默认 0）' },
              onFailure: { type: 'string', enum: ['stop', 'continue', 'skip-dependents'], description: '失败策略' },
            },
            required: ['agentId', 'task'],
          },
        },
        maxConcurrency: {
          type: 'number',
          description: '最大并行任务数（默认 3）',
          default: 3,
        },
      },
      required: ['tasks'],
    },
    execute: async (args) => {
      const name = (args.name || '').trim() || 'unnamed workflow';
      const tasks = args.tasks || [];
      const maxConcurrency = args.maxConcurrency || 3;

      if (!Array.isArray(tasks) || tasks.length === 0) {
        return JSON.stringify({ ok: false, error: 'tasks 数组不能为空' });
      }

      return workflowManager.start(name, tasks, { maxConcurrency });
    },
  });

  // ── 9. workflow_status（阶段 3：查询进度） ──
  registry.register({
    name: 'workflow_status',
    description: '查询一个运行中或已完成工作流的状态和每个任务的执行结果。' +
      '返回工作流总体状态（running/completed/failed/timeout）、每个任务的状态（pending/running/completed/failed/skipped）、' +
      '已完成任务的输出等详细信息。\n\n' +
      '通常在 workflow_start 之后调用，用于：\n' +
      '- 检查工作流是否完成\n' +
      '- 获取每个步骤的详细输出\n' +
      '- 发现失败任务的具体错误信息',
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'workflow_start 返回的工作流 ID',
        },
      },
      required: ['workflowId'],
    },
    execute: async (args) => {
      const workflowId = (args.workflowId || '').trim();
      if (!workflowId) {
        return JSON.stringify({ ok: false, error: 'workflowId 不能为空' });
      }
      return workflowManager.status(workflowId);
    },
  });

  // ── 10. workflow_add_task（阶段 3：动态添加任务） ──
  registry.register({
    name: 'workflow_add_task',
    description: '向一个运行中的工作流动态添加额外任务。新任务会自动集成到 DAG 中，' +
      '如果其依赖已就绪则会立即被调度执行。\n\n' +
      '使用场景：\n' +
      '- AI 审查前一步结果后，决定追加额外步骤\n' +
      '- 根据已完成任务的输出，动态调整工作流方向\n' +
      '- 逐步构建复杂流水线\n\n' +
      '注意：只能向状态为 running 的工作流添加任务。已结束的工作流无法接收新任务。',
    parameters: {
      type: 'object',
      properties: {
        workflowId: {
          type: 'string',
          description: 'workflow_start 返回的工作流 ID',
        },
        tasks: {
          type: 'array',
          description: '要添加的任务定义数组，格式与 workflow_start 的 tasks 相同',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '任务 ID（可选）' },
              agentId: { type: 'string', description: '执行 Agent' },
              task: { type: 'string', description: '任务描述' },
              dependsOn: { type: 'array', items: { type: 'string' }, description: '依赖' },
              maxRetries: { type: 'number' },
              onFailure: { type: 'string', enum: ['stop', 'continue', 'skip-dependents'] },
            },
            required: ['agentId', 'task'],
          },
        },
      },
      required: ['workflowId', 'tasks'],
    },
    execute: async (args) => {
      const workflowId = (args.workflowId || '').trim();
      const tasks = args.tasks || [];

      if (!workflowId) {
        return JSON.stringify({ ok: false, error: 'workflowId 不能为空' });
      }
      if (!Array.isArray(tasks) || tasks.length === 0) {
        return JSON.stringify({ ok: false, error: 'tasks 数组不能为空' });
      }

      return workflowManager.addTask(workflowId, tasks);
    },
  });
}

module.exports = { register, executeAgent, agentPool, killDelegatePTY, abortDelegate };
