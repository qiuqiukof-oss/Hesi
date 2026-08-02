/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

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
const { trimHistory, safeApiError, buildApiUrl, estimateTokenCount } = require('./utils');
const { QCLI_TOOLS, executeToolCall } = require('./tools');
const { pruneToolContext } = require('./token-budget');
const { streamOpenAIWithTools } = require('./stream-openai');
const { streamAnthropicWithTools, parseAnthropicStream, buildAnthropicConversation } = require('./stream-anthropic');
const { injectAttachments } = require('./attachments');
const { runDiscussion } = require('./discuss');
const { runPlanTurn } = require('./plan-turn');
const { recordCompact } = require('./metrics'); // P1.5: 上下文压缩计数累加
// Long-term memory subsystem (M4): archive + recall + compaction. Importing the
// facade only — internal modules stay encapsulated.
const MemoryStore = require('../../lib/memory');
const { recallPlans } = require('../ai-tools/plan-rag-recall');
const memoryConfig = require('../../lib/memory/config');
const { ContextWindowManager } = require('../../lib/context-window');
const cwManager = new ContextWindowManager();
// 个性化注入助手（Persona / Role / Custom Instructions / Language）
const { composePersonalization } = require('./personalization');

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
async function nonStreamingChat(messages, apiKey, model, provider, baseUrl, broadcastFn, sessionId, tools) {
  const deadline = Date.now() + NON_STREAMING_CHAIN_TIMEOUT;
  if (provider === 'anthropic') {
    return nonStreamingAnthropic(messages, apiKey, model, baseUrl, broadcastFn, deadline, sessionId, tools);
  }
  return nonStreamingOpenAI(messages, apiKey, model, baseUrl, broadcastFn, deadline, sessionId, tools);
}

async function nonStreamingOpenAI(messages, apiKey, model, baseUrl, broadcastFn, deadline, sessionId, tools) {
  const modelName = model || 'gpt-4o-mini';
  const url = buildApiUrl(baseUrl, 'https://api.openai.com/v1', '/chat/completions');
  const requestId = _newRequestId();
  const toolDefs = tools || QCLI_TOOLS;

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
        tools: toolDefs,
        tool_choice: 'auto',
        max_tokens: cwManager.maxOutputTokens(modelName),
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

        const result = await executeToolCall(toolCall.function.name, args, broadcastFn, requestId, null, sessionId);
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

async function nonStreamingAnthropic(messages, apiKey, model, baseUrl, broadcastFn, deadline, sessionId, tools) {
  const modelName = model || 'claude-sonnet-4-20250514';
  const requestId = _newRequestId();
  const toolDefs = tools || QCLI_TOOLS;

  const anthropicTools = toolDefs.map(t => ({
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
        max_tokens: cwManager.maxOutputTokens(modelName),
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
      const result = await executeToolCall(tc.name, args, broadcastFn, requestId, null, sessionId);
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
    const { messages, model, apiKey: clientKey, provider: clientProvider, baseUrl: clientBaseUrl, disableTools, terminalContext, terminalContextChanged, discuss, partner, partners, discussBeforePlan, maxTurns, sessionId, category, verifyMode, takenOver, persona, role, customInstructions, language, memoryEnabled, permissions, personas, protocol, planMode, plan: presetPlan, agentId: planAgentId, autoReplan, maxRetries } = req.body;
    // Phase 2：把 sessionId 挂到请求上，供流式路径里的 executeToolCall 透传到 /tools/write-file 做副作用快照。
    req._hesiSessionId = sessionId || '';
    // 分类 Chips（两级小功能）：当前对话模式 → 注入 [当前模式] 系统提示段 + Skill 检索加权
    // 主分类 id 与前端 MAIN_CATEGORIES 保持一致（dev/web/agent/ops）。
    const CHAT_CATEGORIES = { dev: '日常开发', web: '网站开发', agent: 'Agent 应用', ops: '工程效能' };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // ── 自动执行模式（P2/P6）──
    // P6 协作工作流：有 CLI Agent 伙伴时 → 自动先多 Agent 讨论再执行（讨论结论注入 Plan 生成器）
    // 否则 → 独立自动执行（无讨论）
    // 注：planMode 优先级高于纯 discuss——勾选「AI 讨论」+「自动执行」时走协作流，
    // 不再排斥；纯讨论走下方 else if
    if (planMode) {
      console.log('[chat] planMode branch, discuss=%s partners=%d doDiscuss=%s', discuss, (Array.isArray(partners) ? partners.length : 0), !!(discussBeforePlan) || (Array.isArray(partners) && partners.length > 0));
      const userText = (messages[messages.length - 1]?.content || '').toString();
      const partnerList = Array.isArray(partners) && partners.length ? partners.slice() : [];
      const doDiscussFirst = !!(discussBeforePlan) || partnerList.length > 0; // 有伙伴则默认启用协作
      try {
        await runPlanTurn(res, {
          objective: userText,
          plan: (presetPlan && typeof presetPlan === 'object') ? presetPlan : undefined,
          apiKey: clientKey,
          provider: clientProvider,
          baseUrl: clientBaseUrl,
          model,
          agentId: planAgentId,
          permissions,
          autoReplan,
          maxRetries,
          discussBeforePlan: doDiscussFirst,
          discussionPartners: partnerList,
          maxTurns: maxTurns || 4,
        });
      } catch (err) {
        if (!res.headersSent) res.status(500).json({ error: err.message });
      }
      return;
    }

    // ── AI 讨论模式（纯讨论，不执行） ──
    else if (discuss) {
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
          partner: partnerList[0],   // 兼容旧字��
          partners: partnerList,
          maxTurns: Math.min(Math.max(parseInt(maxTurns, 10) || 6, 1), 12),
          takenOver: (takenOver && typeof takenOver === 'object') ? takenOver : undefined,
          apiKey: clientKey,
          provider: clientProvider,
          baseUrl: clientBaseUrl,
          model,
          personas: Array.isArray(personas) ? personas : undefined,
          protocol: protocol || undefined,
          cwd: process.cwd(),
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
        // M2b (v0.3.1): 本轮开始前打检查点（单槽覆盖），供回滚到上一轮安全态。
        try { await MemoryStore.checkpoint(sessionId); } catch (ckErr) {
          console.warn('[memory] checkpoint skipped (non-fatal):', ckErr && ckErr.message);
        }
        await MemoryStore.append(sessionId, messages, { model, provider: clientProvider });
        // M1④ (v0.3.1): 上下文压缩接入对话流（方向①闭环）。compactIfNeeded 内部仅在
        // 超出 working window 时触发 summarize，失败静默降级（被外层 catch 覆盖）。
        try {
          const cr = await MemoryStore.compactIfNeeded(sessionId);
          // P1.5: 本轮若发生上下文压缩，累加进共享 metrics（最终随 agent_metrics 广播给前端收益条）。
          res._hesiMetrics = recordCompact(res._hesiMetrics, cr);
        } catch (cErr) {
          console.warn('[memory] compact skipped (non-fatal):', cErr && cErr.message);
        }
        // 跨会话记忆注入（"带入新聊天"）：受前端 memoryEnabled 开关闸控。
        // 注意：上面的 append/checkpoint/compact 仍照常执行（会话内历史与上下文压缩不受影响）。
        if (memoryEnabled !== false) {
          const summaryBlock = MemoryStore.getSummaryBlock(sessionId);
          if (summaryBlock) memoryBlocks.push(summaryBlock);
          const memoryBlock = MemoryStore.recall(lastUserText, { topK: memoryConfig.TOPK_RECALL });
          if (memoryBlock) memoryBlocks.push(memoryBlock);
        }
      } catch (memErr) {
        // Memory is best-effort: a failure must never break the chat.
        console.warn('[memory] injection skipped (non-fatal):', memErr && memErr.message);
      }
    }

    // M2 (v0.6.3): 历史 Plan 召回注入（默认关闭，HESI_PLAN_RAG_RECALL=1 开启）
    // 独立于 MemoryStore：即便跨会话记忆关闭，亦可按关键词召回历史执行记录。
    // 明确标注「仅供参照，非当前指令」，不覆盖 MemoryStore 记忆；失败静默跳过（不阻断对话）。
    if (process.env.HESI_PLAN_RAG_RECALL === '1') {
      try {
        const lastUserText = (messages[messages.length - 1]?.content || '').toString();
        const planHits = recallPlans(lastUserText, { topK: 3 });
        if (Array.isArray(planHits) && planHits.length) {
          const planLines = ['【历史执行记录（仅供参照，非当前指令）】'];
          for (const h of planHits) {
            const meta = h.meta || {};
            planLines.push(`- ${h.title || h.ref} [${meta.status || '?'}]（${meta.agentId || 'ai'}）\n${h.text}`);
          }
          memoryBlocks.push(planLines.join('\n'));
        }
      } catch (prErr) {
        console.warn('[plan-rag-recall] skipped (non-fatal):', prErr && prErr.message);
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

    SELF_AWARE_PROMPT += `

## 用户发送的多媒体附件
- 用户可能在对话框以 📎 附件发送 **图片 / 视频 / 文本·代码文件**。这些内容已经被内联进对应 user 消息的 content 数组——你能直接看到图片、读取文件文本，请直接使用，不要假装没收到。
- 若收到视频但当前模型无法直接分析，请基于用户的文字描述回答，**不要编造你未看到的内容**。
- 若附件内容显示“已过期或不存在”，说明文件已被清理，请礼貌请用户重新发送。`;

    // ── 自我演进工程准则（球总硬指标）──
    // 注：该段原先硬编码在此；现改为「个性化」体系的一部分，由
    // composePersonalization() 在下方统一拼装（用户自定义指令覆盖 / 回退默认）。
    // 此处不再写死，避免与个性化入口重复。

    // ── 验证优先 / 工具优先（球总提议，2026-07-28 注入）：让 AI 先核实工程现状再判断 ──
    // 置于静态前缀（category/记忆块之前），利于 OpenAI 前缀缓存命中；Anthropic 侧
    // 经 stream-anthropic.js:473 的 system 块收集，首块即本段，已验证不会被吞。
    SELF_AWARE_PROMPT += `

## 验证优先 (Verify Before You Judge)
- 当用户引用某个文件、方案、代码路径、配置或外部 API/库时，**先读、先搜索、再下结论**，不要凭文件名或印象推理。
- 方案的「设定前提」（架构 / 依赖 / API / 文件路径 / 版本）若与项目实际不符，**用具体证据指出**（文件路径:行号、grep 结果、文档版本），不要空说"可能不对"。
- 优先考虑合理性而非顺从；判断要真实，不是表演。
- 不确定就明说"我需要查 X"并真的去查（\`read_file\` / \`grep\` / \`web_fetch\` / \`exec_terminal\`），不要装懂。

## 工具优先 (Tools First)
- 任何依赖代码现状的可行性 / 兼容性 / 影响面判断，必须先调用 ≥1 个工具取证（\`read_file\`、\`grep\`、\`web_fetch\`）再回答。
- 引用外部 API/库时，先 \`web_fetch\` 官方文档确认存在与现行用法。
- 基于工具**返回的证据**作答，不得抛开证据凭记忆下结论。`;

    // ── 分类 Chips（两级小功能）：当前对话模式 → [当前模式] 系统提示段 ──
    // 未选（category 空或非法）时零注入，行为完全不变。
    // category 支持 "main"（单级）与 "main::sub"（两级）两种格式。
    if (category) {
      const catMain = String(category).split('::')[0];
      if (CHAT_CATEGORIES[catMain]) {
        const mainLabel = CHAT_CATEGORIES[catMain];
        const subLabel = String(category).includes('::') ? String(category).split('::')[1] : '';
        const modeText = subLabel ? `${mainLabel} > ${subLabel}` : mainLabel;
        SELF_AWARE_PROMPT += `\n\n## 当前对话模式\n用户将本会话标记为「${modeText}」模式。回答时优先贴合该领域（相关术语、工具链、内置 Skill 与文档），但你仍是通用 AI 助手，不局限于此模式。`;
      }
    }

    // ── 核查模式（verify-first）：开启时强制本次先取证再作答 ──
    if (verifyMode) {
      SELF_AWARE_PROMPT += `\n\n## 核查模式已开启 (Verify Mode ON)
- 本次回答前，必须至少调用一次 read_file / grep / web_fetch / exec_terminal 取证，再下结论。
- 当用户引用任何文件 / 方案 / 代码 / 外部 API 时，先核对真实内容，指出与现状的矛盾（给出文件路径:行号等证据）。
- 不要仅凭印象或文件名回答；基于工具返回的证据作答。`;
    }

    // ── 个性化注入（Persona / Role / Custom Instructions / Language）──
    // 复用既有「前端 localStorage → 请求体 → 服务端注入」链路（与 verifyMode 同款）。
    // 顺序：语言 → 交流风格(个性) → 角色设定(身份) → 工程准则与自定义指令(约束)。
    {
      const persBlock = composePersonalization({ persona, role, customInstructions, language });
      if (persBlock) SELF_AWARE_PROMPT += `\n\n${persBlock}`;
    }

    // ── M4 (v0.3.1): Skill 按需注入（铺结构版，词法 BM25）──
    // 与全量塞入相反：只按当前用户输入检索 top-2 相关技能，注入摘要（名称+描述+
    // 正文首 300 字），放在动态段（memoryBlocks 之后）以不破坏 M1 的稳定缓存前缀。
    // 升级空间：registry.search 内部预留 vec 字段，M6/M7 接 embed() 向量重排。
    const skillBlocks = [];
    if (process.env.HESI_SKILL_INJECT !== '0') {
      try {
        const skillRegistry = require('../../skills/registry');
        const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
        const skillQuery = (lastUserMsg?.content || '').toString().slice(0, 500);
        const hits = skillQuery ? await skillRegistry.search(skillQuery, 2, (category && CHAT_CATEGORIES[String(category).split('::')[0]]) ? { category } : undefined) : [];
        if (hits.length) {
          const lines = hits.map((s) =>
            `### ${s.name || s.id}${s.category ? `（${s.category}）` : ''}\n${s.description || ''}\n${String(s.body || '').slice(0, 300)}`);
          skillBlocks.push({
            role: 'system',
            content: `[相关技能参考 - 按当前问题自动检索注入，仅供参考]\n${lines.join('\n\n')}`,
          });
          res._hesiMetrics = res._hesiMetrics || { cacheReadTokens: 0, cacheCreationTokens: 0, toolCacheHits: 0, experienceHits: 0, skillsInjected: 0 };
          res._hesiMetrics.skillsInjected += hits.length;
          console.log(`[skills] injected ${hits.length}: ${hits.map(s => s.id).join(', ')}`);
        }
      } catch (skErr) {
        // Skill injection is best-effort: never break chat.
        console.warn('[skills] injection skipped (non-fatal):', skErr && skErr.message);
      }
    }

    // M1 (v0.3.1): 静态段(SELF_AWARE)在前、动态段(memoryBlocks)在后。
    // ① 让 OpenAI 自动前缀缓存命中（稳定前缀）；
    // ② 修复 anthropic 分支此前只取第一个 system(=动态记忆块)导致
    //    SELF_AWARE_PROMPT 被 buildAnthropicConversation 过滤吞掉的 bug。
    contextMessages = [
      { role: 'system', content: SELF_AWARE_PROMPT },
      ...memoryBlocks,
      ...skillBlocks,
      ...contextMessages,
    ];

    // v0.5.3: 严格 Jinja 模板兼容——把前导连续 system 合并为一条。
    // 某些模型（qwen/llama 通过 vLLM/SGLang 部署）的 chat template 强制要求
    // system 仅在消息数组的第一位且只能有一条，多 system 直接 400。
    // 标准 OpenAI/Anthropic 端点对此宽容，合并后行为不变。
    {
      const firstNonSystem = contextMessages.findIndex(m => m.role !== 'system');
      if (firstNonSystem > 1) {
        const merged = contextMessages.slice(0, firstNonSystem)
          .map(m => (m && m.content != null ? String(m.content) : ''))
          .join('\n\n---\n\n');
        contextMessages = [
          { role: 'system', content: merged },
          ...contextMessages.slice(firstNonSystem),
        ];
      }
    }

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
      // 把用户附件（图片/视频/文本/代码）转成模型可理解的 content 块：
      // 后端与 uploads 同机，本地读文件转 base64 喂模型（模型无需联网抓 localhost）。
      try { await injectAttachments(contextMessages, provider); } catch (attErr) {
        console.warn('[chat] injectAttachments failed:', attErr && attErr.message);
      }
      // P1 S4：写回真实上下文 token 量（含 system + 记忆 + 技能 + 历史 + 附件文本），
      // 供压缩阈值判断——根治 tokenEstimate 只算历史导致压缩永不触发的「幽灵截断」。
      if (MemoryStore.enabled && sessionId) {
        try {
          const fullTokens = estimateTokenCount(contextMessages);
          await MemoryStore.setContextEstimate(sessionId, fullTokens);
        } catch { /* best-effort：写回失败不阻断聊天 */ }
      }
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
      // 上下文压缩始终执行（属窗口管理，非"生成记忆"）；事实抽取受 memoryEnabled 闸控。
      // 显式传 baseUrl：否则 llm-bridge 兜底 env，本地 LLM 用户走 HESI_LLM_BASE_URL。
      MemoryStore.compactIfNeeded(sessionId, { apiKey, provider: clientProvider, model, baseUrl: clientBaseUrl }).catch(() => {});
      if (memoryEnabled !== false) {
        MemoryStore.extractFacts(sessionId, { apiKey, provider: clientProvider, model, baseUrl: clientBaseUrl }).catch(() => {});
      }
    }

    // ── M5 后续增强：服务端汇总日志（切模型/跨会话对比用，零存储耦合）──
    if (sessionId && res._hesiMetrics) {
      const m = res._hesiMetrics;
      const estSaved = (m.cacheReadTokens || 0) + (m.toolCacheHits || 0) * 800 + (m.experienceHits || 0) * 1500;
      try {
        console.log('[chat-benefits] session=%s cacheRead=%d cacheWrite=%d toolReuse=%d exp=%d skills=%d compact=%d compactedMsgs=%d estSaved=%d actualUsed=%d',
          sessionId, m.cacheReadTokens || 0, m.cacheCreationTokens || 0, m.toolCacheHits || 0,
          m.experienceHits || 0, m.skillsInjected || 0, m.compactCount || 0, m.compactedMsgs || 0, estSaved, m.actualUsed || 0);
      } catch {}
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
  // GET /api/chat/context-usage — P0.6 单会话上下文窗口占用率（只读）
  //   ?sessionId=xxx [&model=yyy]
  // 复用 v0.3.1 P1 已落地的数据：session.contextEstimate（index 每轮回写）
  // + ContextWindowManager 三层窗口策略。零新存储、零写入。
  // ──────────────────────────────────────────────
  router.get('/chat/context-usage', (req, res) => {
    try {
      const sessionId = String(req.query.sessionId || '').trim();
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

      const info = MemoryStore.getContextInfo(sessionId);
      if (!info) return res.status(404).json({ error: 'session not found' });

      // model 优先级：前端显式传参（当前选中模型） > session 记录 > 空（走 fallback 窗口）
      const model = String(req.query.model || info.model || '').trim();
      const windowTokens = cwManager.effectiveContext(model);
      const contextEstimate = info.contextEstimate;
      const pct = windowTokens > 0
        ? Math.round((contextEstimate / windowTokens) * 1000) / 10
        : 0;

      // 窗口来源（与 ContextWindowManager 三层策略对应，仅用于 tooltip 展示）
      const { DEFAULT_FALLBACK_CONTEXT } = require('../../lib/context-window');
      let source = 'fallback';
      const envCtx = Number(process.env.HESI_EFFECTIVE_CONTEXT);
      if (Number.isFinite(envCtx) && envCtx > 0) source = 'effective-context';
      else if (windowTokens !== DEFAULT_FALLBACK_CONTEXT) source = 'model-map';

      return res.json({
        model: model || null,
        contextEstimate,
        windowTokens,
        pct,
        compactThreshold: cwManager.compactThreshold(model),
        maxOutputTokens: cwManager.maxOutputTokens(model),
        source,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });

  // ──────────────────────────────────────────────
  // POST /api/chat/tools — Non-streaming tool execution
  // Used by MCP's ai_chat tool (avoids SSE parsing issues)
  // ──────────────────────────────────────────────
  router.post('/chat/tools', async (req, res) => {
    const { messages, model, apiKey: clientKey, provider: clientProvider, baseUrl: clientBaseUrl, sessionId } = req.body;

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
          const result = await nonStreamingChat(messages, '', model || 'local-model', 'openai', clientBaseUrl, broadcastFn, sessionId);
          return res.json({ success: true, ...result });
        } catch (_) { /* custom base URL failed */ }
      }

      const lmStudioBase = 'http://127.0.0.1:1234';
      try {
        const healthResp = await fetch(`${lmStudioBase}/v1/models`, { signal: AbortSignal.timeout(2000) });
        if (healthResp.ok) {
          const result = await nonStreamingChat(messages, '', model || 'local-model', 'openai', lmStudioBase, broadcastFn, sessionId);
          return res.json({ success: true, ...result });
        }
      } catch (_) { /* LM Studio not available */ }
      return res.status(400).json({
        error: 'No API key configured.',
        needsKey: true,
      });
    }

    try {
      const result = await nonStreamingChat(messages, apiKey, model, provider, clientBaseUrl, broadcastFn, sessionId);
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
  // 导出「非流式工具调用环」——供 Plan 全自动执行器复用（与 AI 助手同一套
  // QCLI_TOOLS + executeToolCall + 3min 熔断 + pruneToolContext，不重新实现）。
  nonStreamingChat,
};
