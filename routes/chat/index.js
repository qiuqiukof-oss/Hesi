// @ts-check
// ============================================================
// Chat Route — Entry Point (extracted from routes/chat.js)
//
// Orchestrates the AI chat functionality:
// - POST /api/chat — SSE streaming chat with OpenAI/Anthropic
// - GET /api/chat/status — Check AI configuration status
// - POST /api/chat/tools — Non-streaming tool execution
//
// Sub-modules:
//   utils.js            — Shared helpers (URL, token, error)
//   tools.js            — Tool registry + execution engine
//   stream-openai.js    — OpenAI SSE streaming
//   stream-anthropic.js — Anthropic SSE streaming
// ============================================================

const express = require('express');
const { trimHistory, safeApiError, buildApiUrl } = require('./utils');
const { QCLI_TOOLS, executeToolCall } = require('./tools');
const { pruneToolContext } = require('./token-budget');
const { streamOpenAIWithTools } = require('./stream-openai');
const { streamAnthropicWithTools, parseAnthropicStream, buildAnthropicConversation } = require('./stream-anthropic');
const { runDiscussion } = require('./discuss');
// Long-term memory subsystem (M4): archive + recall + compaction. Importing the
// facade only — internal modules stay encapsulated.
const MemoryStore = require('../../lib/memory');
const memoryConfig = require('../../lib/memory/config');

// ============================================================
// Non-streaming chat with tool support (for MCP ai_chat)
// ============================================================

// Timeout constants (ms)
const AI_API_FETCH_TIMEOUT = 180_000;  // 单轮 API 调用超时 3 分钟（P3-2，原 120s 偏紧）
const NON_STREAMING_CHAIN_TIMEOUT = 180_000; // 3 min total tool chain

// 生成每请求隔离标识（限流桶归属，P2-3）
function _newRequestId() {
  return `chat-${  Date.now().toString(36)  }-${  Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Execute a non-streaming chat with tool support.
 * Dispatches to OpenAI or Anthropic based on provider.
 *
 * @param {object[]} messages - Chat messages
 * @param {string} apiKey - API key
 * @param {string} [model] - Model name
 * @param {string} provider - 'openai' or 'anthropic'
 * @param {string} [baseUrl] - Custom API base URL
 * @param {Function} [broadcastFn] - WebSocket broadcast for metrics
 * @returns {Promise<{content: string, toolCalls: number, usage: object|null, timedout?: boolean}>}
 */
async function nonStreamingChat(messages, apiKey, model, provider, baseUrl, broadcastFn) {
  const deadline = Date.now() + NON_STREAMING_CHAIN_TIMEOUT;
  if (provider === 'anthropic') {
    return nonStreamingAnthropic(messages, apiKey, model, baseUrl, broadcastFn, deadline);
  }
  return nonStreamingOpenAI(messages, apiKey, model, baseUrl, broadcastFn, deadline);
}

async function nonStreamingOpenAI(messages, apiKey, model, baseUrl, broadcastFn, deadline) {
  const modelName = model || 'gpt-4o-mini';
  const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');
  const requestId = _newRequestId();

  let currentMessages = [...messages];
  let toolCallCount = 0;
  const maxToolRounds = 10;

  while (toolCallCount < maxToolRounds) {
    // ── Total chain timeout check ──
    if (Date.now() > deadline) {
      return {
        content: '工具调用总超时（3 分钟），已返回部分结果',
        toolCalls: toolCallCount,
        usage: null,
        timedout: true,
      };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: currentMessages,
        tools: QCLI_TOOLS,
        tool_choice: 'auto',
        max_tokens: 32768,
      }),
      signal: AbortSignal.timeout(AI_API_FETCH_TIMEOUT),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(safeApiError(response, errBody, 'OpenAI API'));
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from OpenAI');

    const msg = choice.message;
    currentMessages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      toolCallCount++;
      for (const toolCall of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch { /* use empty args */ }

        const result = await executeToolCall(toolCall.function.name, args, broadcastFn, requestId);
        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }
      // 跨轮工具结果压缩：合并重复 agent_poll 增量，压低 token（不影响功能）
      currentMessages = pruneToolContext(currentMessages);
    } else {
      return {
        content: msg.content || '',
        toolCalls: toolCallCount,
        usage: data.usage || null,
      };
    }
  }

  return {
    content: 'Maximum tool call rounds reached.',
    toolCalls: toolCallCount,
    usage: null,
  };
}

async function nonStreamingAnthropic(messages, apiKey, model, baseUrl, broadcastFn, deadline) {
  const modelName = model || 'claude-sonnet-4-20250514';
  const requestId = _newRequestId();

  const anthropicTools = QCLI_TOOLS.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters || { type: 'object', properties: {} },
  }));

  let currentMessages = [...messages];
  let toolCallCount = 0;
  const maxToolRounds = 10;

  while (toolCallCount < maxToolRounds) {
    // ── Total chain timeout check ──
    if (Date.now() > deadline) {
      return {
        content: '工具调用总超时（3 分钟），已返回部分结果',
        toolCalls: toolCallCount,
        usage: null,
        timedout: true,
      };
    }

    const systemMsg = currentMessages.find(m => m.role === 'system');
    const conversation = buildAnthropicConversation(currentMessages);

    const url = buildApiUrl(baseUrl, 'https://api.anthropic.com/v1', '/messages');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        messages: conversation,
        system: systemMsg?.content || undefined,
        max_tokens: 32768,
        tools: anthropicTools,
      }),
      signal: AbortSignal.timeout(AI_API_FETCH_TIMEOUT),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(safeApiError(response, errBody, 'Anthropic API'));
    }

    const data = await response.json();
    const contentBlocks = data.content || [];
    const textParts = [];
    const toolCalls = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textParts.push(block.text);
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input || {},
        });
      }
    }

    const text = textParts.join('');
    const assistantBlocks = [];
    if (text) assistantBlocks.push({ type: 'text', text });
    for (const tc of toolCalls) {
      assistantBlocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }

    currentMessages.push({ role: 'assistant', content: assistantBlocks });

    if (toolCalls.length === 0) {
      return { content: text, toolCalls: toolCallCount, usage: data.usage || null };
    }

    toolCallCount++;
    const toolResultBlocks = [];
    for (const tc of toolCalls) {
      let args = {};
      try { args = tc.input || {}; } catch { /* use empty */ }
      const result = await executeToolCall(tc.name, args, broadcastFn, requestId);
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: result,
      });
    }

    currentMessages.push({ role: 'user', content: toolResultBlocks });
    // 跨轮工具结果压缩：合并重复 agent_poll 增量，压低 token（不影响功能）
    currentMessages = pruneToolContext(currentMessages);
  }

  return {
    content: 'Maximum tool call rounds reached.',
    toolCalls: toolCallCount,
  };
}

// ============================================================
// Express Router
// ============================================================

/**
 * Create an Express router for AI chat.
 * @param {{ broadcastFn?: Function }} [opts]
 * @returns {express.Router}
 */
function createRouter(opts = {}) {
  const { broadcastFn } = opts;
  const router = express.Router();

  // ──────────────────────────────────────────────
  // POST /api/chat — Send a message to the AI
  // Body: { messages, model?, apiKey?, provider?, baseUrl?, disableTools? }
  // Response: SSE stream of tokens
  // ──────────────────────────────────────────────
  router.post('/chat', async (req, res) => {
    const { messages, model, apiKey: clientKey, provider: clientProvider, baseUrl: clientBaseUrl, disableTools, terminalContext, terminalContextChanged, discuss, partner, partners, maxTurns, sessionId } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // ── AI 讨论模式：AI 助手 ↔ 一个或多个 CLI Agent 按回合交替（圆桌），过程以 SSE 实时可见 ──
    if (discuss) {
      const userText = (messages[messages.length - 1]?.content || '').toString();
      // 多选兼容单选：partners（数组）优先，回退到单 partner
      const partnerList = Array.isArray(partners) && partners.length
        ? partners.slice()
        : (partner ? [partner] : []);
      if (partnerList.length === 0) {
        return res.status(400).json({ error: '讨论模式需要至少指定一个 CLI Agent（partners）' });
      }
      try {
        await runDiscussion(res, {
          message: userText,
          partner: partnerList[0],   // 兼容旧字段
          partners: partnerList,
          maxTurns: Math.min(Math.max(parseInt(maxTurns, 10) || 6, 1), 12),
          apiKey: clientKey,
          provider: clientProvider,
          baseUrl: clientBaseUrl,
          model,
        });
      } catch (err) {
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        }
      }
      return;
    }

    // Inject terminal context as a system message
    let contextMessages = messages;
    if (terminalContext && terminalContext.trim()) {
      const last100 = terminalContext.split('\n').slice(-100).join('\n');
      const statusLabel = terminalContextChanged
        ? '[当前终端输出 - 已更新]'
        : '[当前终端输出 - 未变化]';
      contextMessages = [
        { role: 'system', content: `${statusLabel} - 仅供上下文参考，请根据此内容回答用户问题\n\`\`\`\n${last100}\n\`\`\`` },
        ...messages,
      ];
    }

    // ── Long-term memory injection (M4) ──
    // Server-side: archive this turn, then recall relevant facts/summaries and
    // inject them as system blocks AHEAD of SELF_AWARE. The frontend thinking /
    // tool-call UI is completely untouched. Gated by MEMORY_ENABLED + a provided
    // sessionId; without either, chat degrades to the exact legacy behavior.
    const memoryBlocks = [];
    if (MemoryStore.enabled && sessionId) {
      try {
        const lastUserText = (messages[messages.length - 1]?.content || '').toString();
        await MemoryStore.ensure(sessionId, { model, provider: clientProvider });
        await MemoryStore.append(sessionId, messages, { model, provider: clientProvider });
        const summaryBlock = MemoryStore.getSummaryBlock(sessionId);
        if (summaryBlock) memoryBlocks.push(summaryBlock);
        const memoryBlock = MemoryStore.recall(lastUserText, { topK: memoryConfig.TOPK_RECALL });
        if (memoryBlock) memoryBlocks.push(memoryBlock);
      } catch (memErr) {
        // Memory is best-effort: a failure must never break the chat.
        console.warn('[memory] injection skipped (non-fatal):', memErr && memErr.message);
      }
    }

    // Self-Awareness System Prompt
    let SELF_AWARE_PROMPT = `You are the AI assistant built into Hesi v${require('../../package.json').version}.

## Self-Awareness
You are running inside a browser-based terminal hub. Your frontend (HTML/JS) is served by a Node.js server (Express) and rendered in the user's browser. You have tools that let you interact with the browser you're running in via CDP (Chrome DevTools Protocol).

## Self-Evolution Capabilities
You can read, modify, and rebuild your own source code:

1. **Read your own code** → use \`read_file\` (paths relative to project root)
2. **Modify your own code** → use \`write_file\` to edit any file
3. **Rebuild the frontend** → use \`rebuild_frontend\` (runs npm run build + refreshes browser)
4. **Execute shell commands** → use \`exec_terminal\` for npm scripts, git, etc.
5. **Inspect/modify your running page** → use \`browser_evaluate\` to run JS in your own page
6. **See your own UI** → use \`browser_screenshot\` to visually check your appearance
7. **Understand your architecture** → use \`get_self_info\` for a detailed project overview

The self-evolution cycle: \`read_file → write_file → rebuild_frontend → browser_screenshot\`

## Browser Control (CDP)
If the browser was started with --remote-debugging-port=9222, use \`browser_connect\` to connect. Then you can navigate, click, type, take screenshots, execute JavaScript, switch tabs, and inspect console logs. You can even see and interact with your own Hesi page.

Before starting browser operations, call \`browser_info\` to get the full browser state — open tabs, platform details, and performance metrics. Use \`browser_list_tabs\` to see all open pages and \`browser_console\` to check for errors.

## Browser Scripts (User Script System)
You can also manage user scripts that auto-run on matching web pages:
- Scripts are stored on the server and injected via CDP when the browser connects
- Each script has a URL pattern (glob) and runs automatically on matched pages
- Use the browser-scripts panel in the right sidebar (📜 tab) to manage scripts

## Key File Locations
- Server: \`server.js\`
- AI Chat: \`routes/chat/index.js\` (this file — you can modify your own tools here)
- Browser Control: \`routes/browser.js\`, \`mcp/tools/browser.js\`
- MCP Bridge: \`mcp/bridge.js\`
- Frontend: \`public/chat-ui.js\`, \`public/components/chat-panel.js\`
- Build: \`npm run build\` (uses esbuild)

## System Self-Check Protocol
When the user asks you to perform a "system self-check" / "全面自检" / "diagnose" / "health check", treat it as a **bounded checklist**, NOT open-ended exploration. Follow strictly:

1. **Fixed checklist** — perform ONLY these, each at most ONCE:
   - Frontend build: run \`npm run build\` (or verify dist/bundle is fresh) via \`exec_terminal\`
   - Server & port: confirm listening on 127.0.0.1:4264 via \`exec_terminal\` / \`get_self_info\`
   - Key config files: verify required config files exist
   - Routes/integrations: confirm key routes mounted via \`get_self_info\` / \`list_clis\`
   - Browser tools: run \`browser_info\` to confirm CDP availability
2. **One tool call per item** — never loop with "Now let me check X" re-statements; never re-call the same tool for the same item.
3. **After the checklist completes, immediately output a structured report** (✅/❌ per item + brief note) and STOP. Do not start a second pass.
4. **On failure**: record the reason, move to the next item, and summarize failures in the report. Do NOT retry in a loop.
5. **Budget**: finish within **6 tool calls (≤6 rounds)**, then immediately output the structured report and STOP. The system enforces a hard 6-round cap for self-check — exceeding it will be truncated, so do NOT drag on. If you hit the cap, report what you have.`;

    // ── 多媒体生成引导（让 AI 主动且高质量地使用内置图片/视频插件）──
    SELF_AWARE_PROMPT += `

## 多媒体生成 (Image / Video Generation)
你内置了由 **Agnes AI** 驱动的图像与视频生成插件，应**优先用于任何图像/视频创作需求**（这就是“我们的插件”，无需外部工具）：

- **生成图片** → 调用 \`generate_image\`（模型 agnes-image-v2）。
  参数：\`prompt\`（描述）、\`size\`（1024x1024 方形 / 1792x1024 横版 / 1024x1792 竖版）、\`quality\`（standard/hd）、\`negativePrompt\`（不希望出现的内容）。
- **生成视频** → 调用 \`generate_video\`（模型 agnes-video-v2.0）。
  参数：\`prompt\`、\`style\`（none/realistic/anime/cinematic/3d-render）、\`numFrames\`、\`frameRate\`。视频为异步生成，通常需 1–5 分钟，期间会回报进度。

**使用准则（决定最终效果，请严格遵守）：**
1. 用户一表达画图/配图/海报/头像/封面，或视频/动画/短片/动图等意图，**立即主动调用对应工具**，不要只描述方案或建议用户自己去做。
2. **提示词质量 = 成片质量**：把用户的中文意图改写成**细节丰富、画面感强**的英文 prompt——主体 + 场景 + 风格 + 光线 + 情绪 + 构图；用 \`negativePrompt\` 排除水印/畸形/多余文字/低质伪影。
3. 按内容选尺寸/风格：风景/横幅用横版，人物/海报用竖版；视频按诉求选 realistic / anime / cinematic / 3d-render。
4. 若工具返回“未配置 AGNES_API_KEY”，**如实告知用户**：需在服务端设置环境变量 AGNES_API_KEY（Agnes AI）后方可使用，**不要假装已生成或编造结果**。
5. 生成结果以 Markdown 图片/视频链接回显给用户即可，无需冗长解释；生成过程中用户可在“深度思考”面板看到调用与进度。`;

    contextMessages = [
      ...memoryBlocks,
      { role: 'system', content: SELF_AWARE_PROMPT },
      ...contextMessages,
    ];

    // ── B 方案：检测「全面自检 / 系统自检」意图 ──
    // 命中则把工具轮上限收紧到 6 轮（默认 50），把 LLM 调用数从 20+ 砍到 ~7，
    // 配合 A 方案的上下文封顶，几乎不可能再撞 apihub 免费档 429 限流。
    const _lastUser = [...messages].reverse().find(m => m.role === 'user');
    const _lastUserText = (_lastUser?.content || '').toString();
    const isSelfCheck = /全面自检|整体自检|系统自检|完整自检|self[- ]?check|health[- ]?check|diagnos(?:e|is|tic)|排查|体检/i.test(_lastUserText);
    const selfCheckMaxRounds = isSelfCheck ? 6 : undefined;

    // Determine provider and API key
    const provider = clientProvider ||
      (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

    const apiKey = clientKey ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      '';

    if (!apiKey) {
      if (clientBaseUrl) {
        const tools = disableTools ? undefined : QCLI_TOOLS;
        try {
          await streamOpenAIWithTools(res, messages, '', model || 'local-model', clientBaseUrl, tools, broadcastFn, req, selfCheckMaxRounds);
          return;
        } catch (_) { /* fall through */ }
      }

      const lmStudioBase = 'http://127.0.0.1:1234';
      try {
        const healthResp = await fetch(`${lmStudioBase}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (healthResp.ok) {
          const tools = disableTools ? undefined : QCLI_TOOLS;
          await streamOpenAIWithTools(res, messages, '', model || 'local-model', lmStudioBase, tools, broadcastFn, req, selfCheckMaxRounds);
          return;
        }
      } catch (_) { /* LM Studio not available */ }
      return res.status(400).json({
        error: 'No API key configured. Set OPENAI_API_KEY or ANTHROPIC_API_KEY in environment, '
          + 'or provide one in the request, or start LM Studio (localhost:1234).',
        needsKey: true,
      });
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // 关闭本响应的 socket 空闲超时：长工具/Agent 委派期间 SSE 可能数分钟无数据，
    // 交由 keepalive 心跳保活，避免被 120s 默认超时误杀（前端表现为“调用工具被断开”）。
    res.setTimeout(0);

    // 将 Agent 实时输出（agent_* 事件）同步转发到本 SSE 流，
    // 让前端在工具执行期间看到进度，减少“卡住/断开”的错觉；同时保留原 WS 广播。
    const sseBroadcast = (payload) => {
      try {
        if (payload && payload.type === 'mcp_metric' &&
            typeof payload.data?.ev === 'string' && payload.data.ev.startsWith('agent_')) {
          res.write(`data: ${JSON.stringify({ type: 'tool_live', payload: payload.data })}\n\n`);
        }
      } catch { /* ignore */ }
      if (typeof broadcastFn === 'function') broadcastFn(payload);
    };

    try {
      const tools = disableTools ? undefined : QCLI_TOOLS;
      if (provider === 'anthropic') {
        await streamAnthropicWithTools(res, contextMessages, apiKey, model, clientBaseUrl, tools, sseBroadcast, req, selfCheckMaxRounds);
      } else {
        await streamOpenAIWithTools(res, contextMessages, apiKey, model, clientBaseUrl, tools, sseBroadcast, req, selfCheckMaxRounds);
      }
    } catch (err) {
      // 诊断日志：把真实报错打进服务端，便于定位是 apihub/网络还是本地逻辑。
      console.error('[chat] stream error:', err && err.message ? err.message : err);
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.status(500).json({ error: err.message });
      }
    }

    // ── Memory post-processing (M4/M5): fire-and-forget, never blocks SSE ──
    // Compaction / fact extraction may call the LLM; run async after the
    // response streams so the user never waits on it.
    if (MemoryStore.enabled && sessionId) {
      MemoryStore.commit(sessionId).catch(() => {});
      MemoryStore.compactIfNeeded(sessionId, { apiKey, provider: clientProvider, model }).catch(() => {});
      MemoryStore.extractFacts(sessionId, { apiKey, provider: clientProvider, model }).catch(() => {});
    }
  });

  // ──────────────────────────────────────────────
  // GET /api/chat/status — Check if AI is configured
  // ──────────────────────────────────────────────
  router.get('/chat/status', (req, res) => {
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
    res.json({
      configured: hasOpenAI || hasAnthropic,
      providers: {
        openai: hasOpenAI,
        anthropic: hasAnthropic,
      },
    });
  });

  // ──────────────────────────────────────────────
  // POST /api/chat/tools — Non-streaming tool execution
  // Used by MCP's ai_chat tool (avoids SSE parsing issues)
  // ──────────────────────────────────────────────
  router.post('/chat/tools', async (req, res) => {
    const { messages, model, apiKey: clientKey, provider: clientProvider, baseUrl: clientBaseUrl } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const provider = clientProvider ||
      (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

    const apiKey = clientKey ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      '';

    if (!apiKey) {
      if (clientBaseUrl) {
        try {
          const result = await nonStreamingChat(messages, '', model || 'local-model', 'openai', clientBaseUrl, broadcastFn);
          return res.json({ success: true, ...result });
        } catch (_) { /* custom base URL failed */ }
      }

      const lmStudioBase = 'http://127.0.0.1:1234';
      try {
        const healthResp = await fetch(`${lmStudioBase}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (healthResp.ok) {
          const result = await nonStreamingChat(messages, '', model || 'local-model', 'openai', lmStudioBase, broadcastFn);
          return res.json({ success: true, ...result });
        }
      } catch (_) { /* LM Studio not available */ }
      return res.status(400).json({
        error: 'No API key configured.',
        needsKey: true,
      });
    }

    try {
      const result = await nonStreamingChat(messages, apiKey, model, provider, clientBaseUrl, broadcastFn);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createRouter,
  // Exported for unit testing
  streamAnthropicWithTools,
  parseAnthropicStream,
  buildAnthropicConversation,
};
