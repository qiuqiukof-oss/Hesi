/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// AI 讨论协调器（Discuss Coordinator）
//
// 让「AI 助手（聊天 LLM）」与「某个 CLI Agent（opencode/codex/aider…）」
// 按回合交替发言，把整段来回过程通过 SSE 实时推给前端，供用户「看见讨论过程」。
//
// 设计要点：
// - 前端拨动「🤝 AI 讨论」开关并选定 partner 后，POST /api/chat 带
//   { discuss:true, partner, maxTurns } 进入本协调器（不进入普通工具循环）。
// - 每轮：① AI 助手基于「用户原题 + 至今讨论记录」产出一段发言（流式）；
//         ② 把该发言交给 CLI Agent（每次新开一个 session，task 含完整记录，
//            保证无状态也可连续讨论），轮询其输出作为 CLI 发言（流式）。
// - 通过 discuss_start / token / discuss_end / status 事件让前端按 speaker 渲染气泡。
// - 复用普通流里的 _aborted 中断语义（res.on('close') + writableEnded 守卫）：
//   用户点停止 → res close → _aborted=true → 干净收尾。
// - 兼容 OpenAI / Anthropic 两种 provider 的 SSE 解析。
// ============================================================

const { agentPool } = require('../ai-tools/agent-pool');
const { loadRegistry } = require('../../cli-discovery');
// 流式终端字节清洗：跨 poll delta 边界缓存未完成的转义序列（详见 lib/terminal-clean.js）
const { createStreamCleaner } = require('../../lib/terminal-clean');
// 讨论模式复用主聊的健壮流式解析核心（单源，根除旧自写解析器「AI 助手空白」根因）
const { streamOpenAICore } = require('./stream-openai');
const { streamAnthropicCore } = require('./stream-anthropic');

// CLI Agent 单次轮询总预算（防止某 agent 卡死把讨论拖垮）
const AGENT_TURN_TIMEOUT_MS = 600_000;  // 单轮 CLI 发言最长等待（默认 10 分钟），可被 HESI_AGENT_TURN_TIMEOUT_MS 覆盖
const AGENT_POLL_INTERVAL_MS = 1000;

// ── 角色设定 ──
const AI_SYSTEM_PROMPT = `你正在参与一场与另一个 CLI AI 编程助手（如 opencode）的**协作讨论**。
用户的原始问题是：「{QUESTION}」。

你扮演「AI 助手」一方，对方扮演「CLI Agent」一方。规则：
1. 你只输出**自己这一轮**的发言，不要替对方作答，不要写总结（最后一轮由专门步骤汇总）。
2. 针对上一轮对方的观点，给出你的补充、质疑、修正或新的子问题；若你是首轮，请先给出你的分析框架/初步方案。
3. 语言精炼、有信息量，避免空话。可直接引用对方原话要点。
4. 若你认为讨论已可收敛，可在结尾写一行 [CONVERGE]，表示准备进入汇总。`;

/**
 * 构建 CLI Agent 本轮的任务提示。
 * 纯函数（便于单测）：不传 persona/protocol 时与旧版 CLI_TASK_PROMPT 行为一致。
 * @param {{question:string, transcript?:string, round:number, persona?:{name?:string,role?:string,viewpoint?:string}, protocol?:string}} opts
 * @returns {string}
 */
function buildCliTask({ question, transcript, round, persona, protocol }) {
  let header = '';
  if (persona && (persona.name || persona.role || persona.viewpoint)) {
    const name = persona.name || 'CLI Agent';
    const role = persona.role ? `（角色：${persona.role}）` : '';
    const viewpoint = persona.viewpoint ? `\n你的视角/立场：${persona.viewpoint}` : '';
    header = `你扮演「${name}」${role}参与这场圆桌讨论。${viewpoint}\n\n`;
  }
  let protocolNote = '';
  if (protocol) {
    protocolNote = `\n【协作协议】请遵循圆桌约定的讨论协议发言：\n${protocol}\n`;
  }
  return `${header}你正在与「AI 助手」协作讨论下面这个用户问题（第 ${round} 轮）：

【用户原问题】
${question}

【至今的讨论记录】
${transcript || '（尚无，这是你的第一轮）'}
${protocolNote}
【重要约束】当前是**方案讨论阶段，不是执行阶段**：
- 你**不得执行任何会修改文件系统/系统的命令**（禁止写文件、删除/移动、安装、git 提交、修改配置等）；
- 只需给出你的独立观点、方案、代码思路或反问；命令示例可以写在回复文本里，但不要真正运行；
- 执行将由独立的执行阶段负责，本阶段讨论达成一致即可。
请作为「CLI Agent」一方，针对上面 AI 助手的最后一段发言，给出你的独立观点、方案、代码思路或反问。
只输出你这一轮的内容，不要替对方总结。语言精炼、言之有物。`;
}

const SUMMARY_SYSTEM_PROMPT = `你是一场「AI 助手 ↔ CLI Agent」协作讨论的**主持/汇总者**。
请基于下面的完整讨论记录，产出一份结构化结论：

【用户原问题】
{QUESTION}

【完整讨论记录】
{TRANSCRIPT}

要求：
1. 先一句话给出最终结论；
2. 用要点列出双方达成共识的部分；
3. 用要点列出仍有分歧或待验证的部分；
4. 若适用，给出可立即执行的下一步建议。`;

// ── SSE 辅助（与「自动执行」回合共用同一套工具，避免两条长任务链路行为漂移）──
const { sse, openSseStream, startHeartbeat, watchDisconnect } = require('./sse-util');

// ── provider 解析（与 routes/chat/index.js 保持一致）──
function resolveConfig({ apiKey, provider, baseUrl, model }) {
  // M2（大模型接入统一模块）：provider-config 参与解析（请求级优先 →
  // provider-config env+data → 旧 env 兜底），与 chat 主链路 resolveForChat 对齐。
  let effProvider = provider;
  let effKey = apiKey;
  let effBase = baseUrl;
  // bug 修复（2026-08-04）：provider+key 都给但 baseUrl 缺省时也要解析默认地址，
  // 否则 deepseek/qwen 等非 OpenAI/Anthropic provider 会打到 OpenAI 官方端点。
  if (!effProvider || !effKey || !effBase) {
    try {
      const { resolveForChat } = require('../../lib/llm-provider/provider-client');
      const r = resolveForChat(effProvider, effKey, effBase, 'discuss');
      effProvider = effProvider || r.providerId;
      effKey = effKey || r.apiKey;
      effBase = effBase || r.baseUrl;
    } catch { /* 模块加载失败时回落旧逻辑 */ }
  }
  const p = effProvider || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');
  const key = effKey || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const url = effBase || (p === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1');
  const m = model || (p === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o-mini');
  // bug 修复（2026-08-04）：带出 provider 是否强制需 key——本地（lmstudio/ollama/
  // vllm）与自定义 provider（用户配置端点）不强制，调用方据此区分「云端缺 key
  // 报错」vs「本地/自定义空 key 直接调」，否则配置本地模型或自定义端点的讨论
  // 会误报"未配置 API Key（OPENAI/ANTHROPIC）"。
  let needsKey = true;
  try {
    const { getProviderDef, defNeedsKey } = require('../../lib/llm-provider/provider-config');
    needsKey = defNeedsKey(getProviderDef(p));
  } catch { /* ignore */ }
  return { p, key, url, m, needsKey };
}

// 注：OpenAI / Anthropic 流式解析现已统一复用主聊的共享核心
//（streamOpenAI.streamOpenAICore / streamAnthropic.streamAnthropicCore），
// 见下方 runAiTurn / runSummary。删除讨论模式自写的重复解析器，根除「AI 助手空白」根因。

// 把讨论记录按「轮」切块（【前置上下文】并入首块），供 Anthropic 拆块缓存复用。
// 纯函数（便于单测）。每块对应一轮的完整发言，块与块之间构成稳定增长的前缀。
function splitTranscriptRounds(transcript) {
  if (!transcript) return [];
  return String(transcript).split(/(?=【第\d+轮)/).map((s) => s.trim()).filter(Boolean);
}

/**
 * 构造 Anthropic 讨论轮次的 user content blocks（纯函数，便于单测）。
 * 按轮拆块 + 边界块 cache_control（镜像 stream-anthropic.js system 缓存模式）：
 * Anthropic 前缀缓存对「稳定前缀 + 单块增量」命中率最高——每轮只在最后一条
 * transcript 块打 breakpoint → 上轮的完整前缀在本轮请求中逐 token 命中 cache_read，
 * 新增的当轮发言块才是 cache_creation。首轮/仅前置上下文时前缀过短，跳过缓存。
 * @param {string} question
 * @param {string} transcript
 * @param {boolean} promptCacheOn  HESI_PROMPT_CACHE 门控
 * @returns {Array<{type:'text',text:string,cache_control?:{type:'ephemeral'}}>}
 */
function buildAnthropicDiscussBlocks(question, transcript, promptCacheOn) {
  const blocks = [
    { type: 'text', text: `【用户原问题】${question}\n\n【至今讨论记录】` },
    ...splitTranscriptRounds(transcript).map((text) => ({ type: 'text', text })),
    { type: 'text', text: '\n\n请输出你这一轮的发言：' },
  ];
  if (promptCacheOn && blocks.length > 2) {
    blocks[blocks.length - 2].cache_control = { type: 'ephemeral' };
  }
  return blocks;
}

/**
 * budget 守卫判定（纯函数，便于单测）。
 * @param {{maxTokens?:number, maxMinutes?:number}|null|undefined} budget  0/缺省 = 不限
 * @param {number} usedTokens  已消耗 AI token（input+output）
 * @param {number} usedMs      已耗时（毫秒）
 * @returns {boolean} 是否超限需提前收敛
 */
function budgetExceeded(budget, usedTokens, usedMs) {
  const maxTokens = Number((budget && budget.maxTokens) || 0);
  const maxMinutes = Number((budget && budget.maxMinutes) || 0);
  return (maxTokens > 0 && usedTokens >= maxTokens)
    || (maxMinutes > 0 && usedMs >= maxMinutes * 60 * 1000);
}

// 归一化单次 usage（纯函数，便于单测）：兼容 Anthropic（input_tokens/output_tokens/
// cache_read_input_tokens）与 OpenAI（prompt_tokens/completion_tokens/
// prompt_tokens_details.cached_tokens）两套字段。
function usageFields(u) {
  if (!u) return null;
  return {
    input: u.input_tokens || u.prompt_tokens || 0,
    output: u.output_tokens || u.completion_tokens || 0,
    cacheRead: u.cache_read_input_tokens || (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) || 0,
  };
}

// 跑一轮 AI 助手发言，返回完整文本
async function runAiTurn({ p, key, url, m }, question, transcript, onToken, onUsage, shouldAbort) {
  const sysText = AI_SYSTEM_PROMPT.replace('{QUESTION}', question);
  const collect = (tk) => { onToken(tk); };
  const promptCacheOn = process.env.HESI_PROMPT_CACHE !== '0';
  if (p === 'anthropic') {
    const blocks = buildAnthropicDiscussBlocks(question, transcript, promptCacheOn);
    return (await streamAnthropicCore(url, key, m, sysText,
      [{ role: 'user', content: blocks }], { onToken: collect, onUsage, isAborted: shouldAbort })).trim();
  }
  // OpenAI：保持单条增长的 user 消息（其前缀缓存天然对齐「整条消息拼接」，拆块反而破坏命中）
  const userContent =
    `【用户原问题】${question}\n\n【至今讨论记录】\n${transcript || '（首轮，请先给分析框架/初步方案）'}\n\n请输出你这一轮的发言：`;
  return (await streamOpenAICore(url, key, m,
    [{ role: 'system', content: sysText }, { role: 'user', content: userContent }], { onToken: collect, onUsage, isAborted: shouldAbort })).trim();
}

// CLI Agent 输入压缩（纯函数，便于单测）：镜像 utils.capToolRounds 的 keep-last-N 模式——
// 早期轮次做确定性截断摘要（零 LLM 成本），仅最近 2 轮逐字保留。
// CLI Agent 是「新开会话 + 一次性喂 task」模式，压缩早期轮次不破坏任何 LLM API 前缀缓存
//（CLI 本地运行，不走 Anthropic/OpenAI 缓存）；最近 2 轮必含「AI 助手最后一段发言」，
// 保证 CLI 有足够的回应上下文。env HESI_CLI_DIGEST=0 可关闭压缩。
const CLI_KEEP_RECENT_ROUNDS = 2;
const CLI_EARLY_ROUND_CHARS = 240; // 早期每轮摘要保留字符数
function compactTranscriptForCli(transcript) {
  if (!transcript) return '';
  const segs = splitTranscriptRounds(transcript);
  if (segs.length <= CLI_KEEP_RECENT_ROUNDS) return transcript;
  const early = segs.slice(0, -CLI_KEEP_RECENT_ROUNDS);
  const recent = segs.slice(-CLI_KEEP_RECENT_ROUNDS);
  const earlyDigest = early.map((s) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > CLI_EARLY_ROUND_CHARS ? `${t.slice(0, CLI_EARLY_ROUND_CHARS)}…` : t;
  });
  return `【早期轮次摘要（${early.length} 轮，已压缩）】\n${earlyDigest.join('\n')}\n\n${recent.join('\n')}`;
}

// 跑一轮 CLI Agent 发言：每次新开 session（task 含完整记录），轮询到完成
async function runCliTurn({ partner, persona, protocol }, question, transcript, round, onToken, shouldAbort, cwd) {
  // 单次尝试：启动 CLI Agent 并轮询其输出，返回 { full, terminal, ok }。
  // terminal 记录终止原因（done/error/timeout/cancelled/aborted/silence-timeout/start-failed/callback），
  // 供上层给出明确的失败说明，避免「启动横幅后静默跳过」这类无信息表现。
  const attempt = async () => {
    // 早期轮次压缩摘要 + 最近 2 轮逐字（HESI_CLI_DIGEST=0 关闭压缩，恢复完整记录）
    const forCli = process.env.HESI_CLI_DIGEST === '0' ? transcript : compactTranscriptForCli(transcript);
    const task = buildCliTask({ question, transcript: forCli, round, persona, protocol });
    // cwd 真实传给 agentPool.start → createHeadlessExec 的 opts.cwd（进程真实 chdir 到项目目录）。
    // 不再在 prompt 里写 cd 文字（LLM 不保证执行，实测无效）。
    // P3 #10: agentPool 契约是 JSON 字符串，但崩溃/异常时可能返回非 JSON 文本；
    // 直接 JSON.parse 会把真实错因转成 SyntaxError 再被上层 catch 混淆掩埋。
    // 这里包 try/catch，解析失败降级为 start-failed，消息里带上原始输出便于排障。
    let started;
    try {
      started = JSON.parse(await agentPool.start(partner, task, '', null, undefined, cwd));
    } catch (startErr) {
      return {
        full: `（CLI Agent「${partner}」启动异常：${startErr && startErr.message ? startErr.message : startErr}）`,
        terminal: 'start-failed', ok: false,
      };
    }
    if (!started.ok) {
      return { full: `（无法启动 CLI Agent「${partner}」：${started.error}）`, terminal: 'start-failed', ok: false };
    }
    const sid = started.sessionId;
    const deadline = Date.now() + (Number(process.env.HESI_AGENT_TURN_TIMEOUT_MS) || AGENT_TURN_TIMEOUT_MS);
    // 静默检测阈值（环境变量可覆盖；默认 60s 提示一次）。
    // 注意：仅作「状态提示」，绝不因无 token 输出而 cancel 活着的进程——
    // opencode 调研代码（读/grep/跑命令）期间本就无回答 token，进程仍存活（status=running）。
    // 是否结束的唯一权威信号是 poll() 返回的 status（done/error/timeout/cancelled），见下方四态分支。
    const silenceWarnMs = Number(process.env.HESI_AGENT_SILENCE_WARN_MS) || 60000;
    let full = '';
    let lastDelta = '';
    let lastOutputAt = Date.now();
    // 流式清洗器：跨多次 poll 的增量 delta 缓存被边界切断的转义序列，
    // 确保喂给 AI 与聊天气泡的都是纯净文本（同 PTY 层一致强度，外加 \r）。
    const cleaner = createStreamCleaner();
    let terminal = null;
    try {
      while (Date.now() < deadline) {
        if (shouldAbort && shouldAbort()) { terminal = 'aborted'; break; }
        // P3 #10: 同 start 一样，poll 也可能返回非 JSON（进程崩溃/管道异常）。
        // 解析失败降级为 error terminal，不再向上抛 SyntaxError 掩盖真实错因。
        let r;
        try {
          r = JSON.parse(await agentPool.poll(sid));
        } catch (pollErr) {
          onToken(`（轮询异常：${pollErr && pollErr.message ? pollErr.message : pollErr}）`);
          terminal = 'error'; break;
        }
        if (!r.ok) { onToken(`（轮询失败：${r.error}）`); terminal = 'error'; break; }
        const delta = r.output || '';
        if (delta && delta !== lastDelta) {
          // 仅推送新增增量，避免重复；增量先清洗终端协议字节再上屏/喂给 AI
          const addedRaw = delta.startsWith(lastDelta) ? delta.slice(lastDelta.length) : delta;
          const added = cleaner(addedRaw).replace(/\r/g, '');
          if (added) { full += added; onToken(added); lastOutputAt = Date.now(); }
          // lastDelta 保留「原始」delta 用于去重比对，避免清洗改变长度后误判重复/漏推
          lastDelta = delta;
        }
        // 静默检测：仅「状态提示」，绝不 abort 活着的进程。
        // 进程存活（running/starting）时即使长时间无 token，也只周期性（每 silenceWarnMs）上屏「正在调研」；
        // 进程退出（done/error）由下方四态分支收尾。真 429 静默退出会落 done 且 full 空 → 走「无产出」分支。
        const silentFor = Date.now() - lastOutputAt;
        if (silentFor >= silenceWarnMs && (r.status === 'running' || r.status === 'starting')) {
          // 提示附上优化建议（本地/免费模型调研慢是常态；伙伴×轮数=线性放大等待）
          const tip = silentFor >= 180000 ? '（等待偏久：可减少伙伴或轮数加速）' : '';
          onToken(`\n\n（🔍 CLI Agent「${partner}」正在调研代码/生成中…已等待 ${Math.round(silentFor / 1000)}s，请稍候${tip}）`);
          lastOutputAt = Date.now(); // 重置计时，使提示每 silenceWarnMs 出现一次，避免刷屏
        }
        // 四态终止：done/error 外补齐 timeout/cancelled（原仅 break 在 done|error，会漏判致空轮询到 180s）
        if (r.status === 'done' || r.status === 'error' || r.status === 'timeout' || r.status === 'cancelled') {
          terminal = r.status; break;
        }
        if (r.pendingCallbackCount > 0) {
          // CLI Agent 通过 <cliq:ask> 反向提问：把问题交给 AI（下一轮自然会看到）
          onToken(`\n\n> CLI Agent 反问：${(r.pendingCallbacks || []).map(c => c.question).join('; ')}`);
          terminal = 'callback'; break;
        }
        await new Promise(r => setTimeout(r, AGENT_POLL_INTERVAL_MS));
      }
    } finally {
      try { await agentPool.cancel(sid); } catch { /* ignore */ }
    }
    return { full: full.trim(), terminal, ok: true };
  };

  const res = await attempt();
  // 可选：启动成功但无产出（典型为瞬态限流/不可达，opencode 重试耗尽后静默退出 → 秒跳过）时多重试，
  // 用退避间隔扛过间歇性 429 窗口。HESI_AGENT_RETRY_ON_EMPTY=1 开启（默认关闭以免拉长耗时）；
  // HESI_AGENT_RETRY_MAX 总尝试次数（默认 3）；HESI_AGENT_RETRY_BACKOFF_MS 退避（默认 15000）。
  // 注意：start-failed（配置/注册表错误）不重试；仅对「启动成功却无内容」做退避重试。
  if (res.ok && !res.full && process.env.HESI_AGENT_RETRY_ON_EMPTY === '1') {
    const maxAttempts = Math.max(1, Number(process.env.HESI_AGENT_RETRY_MAX) || 3);
    let last = res;
    let attemptNo = 1;
    while (!last.full && attemptNo < maxAttempts) {
      attemptNo++;
      const backoff = Number(process.env.HESI_AGENT_RETRY_BACKOFF_MS) || 15000;
      onToken(`\n\n（↻ CLI Agent「${partner}」第 ${attemptNo}/${maxAttempts} 次重试，等待 ${Math.round(backoff / 1000)}s 避开限流窗口…）`);
      await new Promise((r) => setTimeout(r, backoff));
      last = await attempt();
      if (last.full) return last.full;
    }
    if (!last.full) res.terminal = last.terminal || res.terminal; // 重试仍空：沿用末次终止原因
  }

  if (!res.full) {
    const t = res.terminal;
    if (t === 'start-failed') return res.full; // 消息内已说明原因
    if (t === 'error') return `（CLI Agent「${partner}」执行出错，未产出内容。可能模型限流或不可达，详见该 Agent 自身日志。）`;
    if (t === 'timeout' || t === 'silence-timeout') return `（CLI Agent「${partner}」超时/静默无响应，未产出内容。）`;
    if (t === 'cancelled' || t === 'aborted') return `（CLI Agent「${partner}」已被取消。）`;
    return `（CLI Agent「${partner}」未产出内容——可能模型限流/不可达，详见该 Agent 自身日志。）`;
  }
  return res.full;
}

// 人工接管席位：把用户提交的文本作为该席位的发言，逐片流式上屏（与 CLI 发言一致的气泡体验）。
// 不调用任何模型，直接复用 transcript 通道，使人工输入成为讨论记录的一部分。
async function runHumanTurn(text, onToken) {
  const safe = String(text == null ? '' : text).trim();
  if (!safe) return '';
  // 按小切片推送，避免一次性大块文本导致气泡闪烁；整体仍很快（短文本）。
  const chunks = safe.match(/[\s\S]{1,30}/g) || [safe];
  for (const c of chunks) {
    onToken(c);
    await new Promise((r) => setTimeout(r, 8));
  }
  return safe;
}

// 汇总失败时的兜底：基于讨论记录生成简单结构化摘要（不依赖 LLM）
function generateFallbackSummary(question, transcript) {
  const lines = [
    `## 📋 讨论结论（自动汇总）`,
    '',
    `> ⚠️ AI 汇总生成失败，以下为基于讨论记录的自动摘要。`,
    '',
    `**议题**：${question}`,
    '',
  ];
  // 提取各轮发言的要点（取每轮前 200 字符作为摘要）
  const rounds = transcript.split(/【第\d+轮/);
  const points = [];
  for (const r of rounds) {
    if (!r.trim()) continue;
    // 取第一段有实质内容的文字
    const m = r.match(/[\s\S]{0,200}/);
    if (m) {
      const snippet = m[0].replace(/\n/g, ' ').trim();
      if (snippet.length > 20) points.push(`- ${snippet}…`);
    }
  }
  if (points.length > 0) {
    lines.push('**各方观点摘要**：', '');
    points.slice(0, 6).forEach(p => lines.push(p));
    lines.push('');
  }
  lines.push('> 💡 如需更完整的结论，可重试或检查 API Key / 网络配置。');
  return lines.join('\n');
}

// 汇总
const MAX_SUMMARY_TRANSCRIPT_CHARS = 24000; // 汇总 prompt 预算上限（留空间给 system + user message）
async function runSummary({ p, key, url, m }, question, transcript, onToken, onUsage, shouldAbort, summaryPrompt) {
  // 截断过长讨论记录，防止撑爆模型上下文导致静默失败
  const sliced = transcript.length > MAX_SUMMARY_TRANSCRIPT_CHARS
    ? `${transcript.slice(0, MAX_SUMMARY_TRANSCRIPT_CHARS)  }\n\n…（记录已截断，仅展示前 ${  Math.round(MAX_SUMMARY_TRANSCRIPT_CHARS / 1000)  }K 字符）`
    : transcript;
  // 允许调用方注入自定义汇总指令（如 checkpoint 场景要求产出 verify JSON）；
  // 缺省用通用 SUMMARY_SYSTEM_PROMPT（自然语言结论）。
  const sysText = (summaryPrompt || SUMMARY_SYSTEM_PROMPT).replace('{QUESTION}', question).replace('{TRANSCRIPT}', sliced);
  const collect = (tk) => { onToken(tk); };
  if (p === 'anthropic') {
    return (await streamAnthropicCore(url, key, m, sysText,
      [{ role: 'user', content: '请汇总上面的讨论。' }], { onToken: collect, onUsage, isAborted: shouldAbort })).trim();
  }
  return (await streamOpenAICore(url, key, m,
    [{ role: 'system', content: sysText }, { role: 'user', content: '请汇总上面的讨论。' }], { onToken: collect, onUsage, isAborted: shouldAbort })).trim();
}

/**
 * 主入口：运行一次完整的 AI ↔ 多个 CLI Agent 圆桌讨论，全程 SSE 推流。
 * 支持 partners（数组，多选）；旧版单 partner 仍兼容。
 * @param {import('express').Response} res
 * @param {object} opts
 */
const MAX_DISCUSS_AGENTS = 4; // 同时参与讨论的 CLI Agent 上限（控成本/防失控）

// 把上游传入的 transcript（string | {role,content}[] | 其它）规整为可注入圆桌的上下文文本。
// checkpoint 圆桌靠它拿到前置讨论/摘要，否则会丢失来龙去脉。
function normalizeTranscript(transcript) {
  if (!transcript) return '';
  if (Array.isArray(transcript)) {
    return transcript
      .map((t) => (typeof t === 'string' ? t : (t && typeof t.content === 'string' ? t.content : '')))
      .join('\n')
      .trim();
  }
  return String(transcript).trim();
}

// P1-5：收敛度分数——程序化指标，不依赖 AI 自判断
// @param {string[]} roundTexts  每轮 AI 发言文本（截取前 1000 字符）
// @param {number} convergeRounds  [CONVERGE] 出现的轮次
// @param {number} totalRounds    实际总轮数
// @returns {number} 收敛度 ∈ [0, 1]（1=完全收敛，0=严重分歧）
function computeConvergenceScore(roundTexts, convergeRounds, totalRounds) {
  if (roundTexts.length < 2) return 0.5; // 单轮无法判断
  // 1. 轮间文本相似度（Jaccard）
  let jaccardSum = 0;
  let pairCount = 0;
  for (let i = 1; i < roundTexts.length; i++) {
    const prev = tokenSet(roundTexts[i - 1]);
    const curr = tokenSet(roundTexts[i]);
    const intersection = new Set([...prev].filter((w) => curr.has(w)));
    const union = new Set([...prev, ...curr]);
    jaccardSum += union.size > 0 ? intersection.size / union.size : 0;
    pairCount++;
  }
  const avgJaccard = pairCount > 0 ? jaccardSum / pairCount : 0;
  // 2. 分歧比例（无 CONVERGE 的轮次占比）
  const divergeRatio = totalRounds > 0 ? (totalRounds - convergeRounds) / totalRounds : 0;
  // 3. 合成：Jaccard 高 + CONVERGE 多 = 收敛好
  const score = (avgJaccard * 0.6) + ((1 - divergeRatio) * 0.4);
  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}
function tokenSet(text) {
  return new Set((text || '').toLowerCase().replace(/[^a-z\u4e00-\u9fff0-9]/g, ' ').split(/\s+/).filter((w) => w.length > 1));
}

// 纯圆桌函数（无 SSE 依赖）：供 runDiscussion（SSE 包装）与 plan 的 resolveCheckpoint 复用。
// 通过 onEvent(type, payload) 发射事件，shouldAbort() 用于中断检测。
// budget: { maxTokens?, maxMinutes? }（0/缺省 = 不限）——接入 plan.budget 的成本守卫（优化方向.md 第 5 步）。
async function runRoundtable({ message, partner, partners, maxTurns = 6, apiKey, provider, baseUrl, model, takenOver = {}, personas, protocol, transcript, budget, summaryPrompt, cwd, onEvent, shouldAbort }) {
  const cfg = resolveConfig({ apiKey, provider, baseUrl, model });
  // 仅云端缺 key 报错；本地 provider（lmstudio/ollama/vllm）空 key 直接调
  if (!cfg.key && cfg.needsKey) {
    onEvent?.('error', { message: '未配置 API Key（OPENAI/ANTHROPIC），无法运行 AI 讨论。' });
    return { summary: '', transcript: '', stats: null, cleanFinish: false };
  }

  const budgetTokens = Number((budget && budget.maxTokens) || 0);
  const budgetMinutes = Number((budget && budget.maxMinutes) || 0);
  const startMs = Date.now();

  let agents = (Array.isArray(partners) && partners.length) ? partners.slice() : (partner ? [partner] : []);
  if (agents.length === 0) {
    onEvent?.('error', { message: '讨论模式需要至少选择一个 CLI Agent（partners）。' });
    return { summary: '', transcript: '', stats: null, cleanFinish: false };
  }
  if (agents.length > MAX_DISCUSS_AGENTS) agents = agents.slice(0, MAX_DISCUSS_AGENTS);
  // 接管席位去重集合：人工文本仅在第 1 轮注入一次，后续轮次该席位保持接管态（不再重复注入）。
  const injectedTakenOver = new Set();
  const hasTakenOver = takenOver && typeof takenOver === 'object' && Object.keys(takenOver).length > 0;

  let labelOf = (id) => id;
  try {
    const reg = loadRegistry();
    const map = new Map();
    for (const c of (reg.clis || [])) { map.set(c.id, c.displayName || c.name); map.set(c.name, c.displayName || c.name); }
    labelOf = (id) => map.get(id) || id;
  } catch { /* ignore */ }

  const aborted = () => !!(shouldAbort && shouldAbort());
  const question = message;
  const transcriptLines = [];
  // 注入上游前置上下文（来自 plan checkpoint 的上游讨论/摘要），让圆桌看到来龙去脉
  const seedContext = normalizeTranscript(transcript);
  if (seedContext) transcriptLines.push(`【前置上下文】\n${seedContext}`);
  let cleanFinish = true;

  // ── token 统计（让圆桌 vs 单模型的成本可被实测）──
  let aiInputTokens = 0;
  let aiOutputTokens = 0;
  let aiCacheReadTokens = 0;
  let cliOutputChars = 0;
  let actualRounds = 0; // 实际执行的轮数（[CONVERGE] 早停 / budget 提前收敛后为真实值，非 maxTurns）
  // P1-5：收敛度指标
  /** @type {string[]} */ const roundTexts = [];
  let convergeRounds = 0; // [CONVERGE] 出现的轮次
  let flipCount = 0; // 意见翻转次数（前后轮 conclusion 矛盾）
  // 兼容 Anthropic / OpenAI 两套 usage 字段（见 usageFields）
  const recordAi = (u) => {
    const f = usageFields(u);
    if (!f) return;
    aiInputTokens += f.input;
    aiOutputTokens += f.output;
    aiCacheReadTokens += f.cacheRead;
  };

  try {
    const agentLabels = agents.map(a => labelOf(a)).join(' / ');
    onEvent?.('status', { message: `🤝 圆桌讨论开始：AI 助手 ↔ ${agentLabels}（最多 ${maxTurns} 轮，已开启 token 统计）` });

    for (let round = 1; round <= maxTurns; round++) {
      if (aborted()) { cleanFinish = false; break; }
      actualRounds = round;
      onEvent?.('status', { message: `讨论进行中… 第 ${round}/${maxTurns} 轮` });

      // ① AI 助手发言（看到全部 Agent 上一轮观点）
      onEvent?.('discuss_start', { speaker: 'ai', label: 'AI 助手', round });
      const aiText = await runAiTurn(cfg, question, transcriptLines.join('\n'), (tk) => onEvent?.('token', { content: tk }), recordAi, () => aborted());
      onEvent?.('discuss_end', { speaker: 'ai' });
      if (aiText) transcriptLines.push(`【第${round}轮 · AI 助手】\n${aiText}`);
      // P1-5：记录本轮文本 + 检测 [CONVERGE]
      if (aiText) {
        roundTexts.push(aiText.slice(0, 1000)); // 截取前 1000 字符做相似度
        if (aiText.includes('[CONVERGE]')) convergeRounds++;
      }
      if (aborted()) { cleanFinish = false; break; }

      // ── budget 守卫（plan.budget.maxTokens / maxMinutes，0 = 不限）──
      // AI 发言后即查累计消耗：超限 → 提前收敛进入汇总，防止成本失控（优化方向.md 第 5 步）。
      const usedTokens = aiInputTokens + aiOutputTokens;
      const usedMs = Date.now() - startMs;
      if (budgetExceeded({ maxTokens: budgetTokens, maxMinutes: budgetMinutes }, usedTokens, usedMs)) {
        onEvent?.('status', { message: `⏱ 已达讨论预算（tokens ${usedTokens} / 时长 ${Math.round(usedMs / 1000)}s），提前收敛进入汇总。` });
        break;
      }

      // ② 每个 CLI Agent 依次发言（圆桌：每位都看到 AI 与前面 Agent 的观点）
      for (const p of agents) {
        if (aborted()) { cleanFinish = false; break; }
        const humanText = hasTakenOver ? (takenOver[p] || '') : '';
        if (humanText) {
          if (!injectedTakenOver.has(p)) {
            injectedTakenOver.add(p);
            onEvent?.('discuss_start', { speaker: 'cli', label: labelOf(p), round });
            const cliText = await runHumanTurn(humanText, (tk) => onEvent?.('token', { content: tk }));
            onEvent?.('discuss_end', { speaker: 'cli' });
            if (cliText) { transcriptLines.push(`【第${round}轮 · ${labelOf(p)}（人工接管）】\n${cliText}`); cliOutputChars += cliText.length; }
          }
          continue;
        }
        onEvent?.('discuss_start', { speaker: 'cli', label: labelOf(p), round });
        const cliText = await runCliTurn(
          { partner: p, persona: Array.isArray(personas) ? personas[agents.indexOf(p)] : undefined, protocol },
          question, transcriptLines.join('\n'), round,
          (tk) => onEvent?.('token', { content: tk }), () => aborted(), cwd);
        onEvent?.('discuss_end', { speaker: 'cli' });
        if (cliText) { transcriptLines.push(`【第${round}轮 · ${labelOf(p)}】\n${cliText}`); cliOutputChars += cliText.length; }
      }
      if (aborted()) { cleanFinish = false; break; }

      // 早停：AI 表示收敛——任何轮次生效（含第 1 轮）。
      // 位置在本轮所有 CLI 发言之后 → 收敛时本轮 Agent 观点已完整，直接进汇总。
      // （原 round>=2 门槛会让第 1 轮收敛失效，多跑一轮，实测反直觉）
      if (/\[CONVERGE\]/i.test(aiText)) break;
    }

    if (!aborted()) {
      // ③ 汇总（带兜底）
      onEvent?.('status', { message: '📋 生成讨论结论…' });
      onEvent?.('discuss_start', { speaker: 'summary', label: '📋 结论汇总', round: maxTurns + 1 });
      let summaryText = '';
      try {
        summaryText = await runSummary(cfg, question, transcriptLines.join('\n'), (tk) => onEvent?.('token', { content: tk }), recordAi, () => aborted(), summaryPrompt);
      } catch (sumErr) {
        console.error('[discuss] 汇总生成失败:', sumErr.message);
        summaryText = generateFallbackSummary(question, transcriptLines.join('\n'));
        onEvent?.('token', { content: summaryText });
      }
      onEvent?.('discuss_end', { speaker: 'summary' });

      const cliEstTokens = Math.ceil(cliOutputChars / 4);
      // 每轮缓存命中率 = cacheRead / 累计输入（Anthropic cache_read_input_tokens；OpenAI cached_tokens）
      const cacheHitRate = aiInputTokens > 0 ? Math.round((aiCacheReadTokens / aiInputTokens) * 1000) / 1000 : 0;
      // rounds 用实际轮数 actualRounds（修复旧版误报 maxTurns 的统计 bug；[CONVERGE] 早停同样正确）
      const stats = { aiInputTokens, aiOutputTokens, aiCacheReadTokens, cacheHitRate, cliOutputChars, cliEstTokens, agents: agents.length, rounds: actualRounds };
      // P1-5：收敛度分数
      if (roundTexts.length >= 2) {
        stats.convergenceScore = computeConvergenceScore(roundTexts, convergeRounds, actualRounds);
      }
      onEvent?.('discuss_stats', { stats });
      return { summary: summaryText, transcript: transcriptLines.join('\n'), stats, cleanFinish: true };
    }
  } catch (err) {
    cleanFinish = false;
    onEvent?.('error', { message: err.message || '讨论执行出错' });
  }
  const stats = { aiInputTokens, aiOutputTokens, aiCacheReadTokens, cliOutputChars, agents: agents.length, rounds: actualRounds };
  return { summary: '', transcript: transcriptLines.join('\n'), stats, cleanFinish };
}

async function runDiscussion(res, { message, partner, partners, maxTurns = 6, apiKey, provider, baseUrl, model, takenOver = {}, personas, protocol, cwd }) {
  const cfg = resolveConfig({ apiKey, provider, baseUrl, model });
  if (!cfg.key && cfg.needsKey) {
    sse(res, { type: 'error', message: '未配置 API Key（OPENAI/ANTHROPIC），无法运行 AI 讨论。' });
    sse(res, { type: '[DONE]' });
    res.end();
    return;
  }

  let agents = (Array.isArray(partners) && partners.length) ? partners.slice() : (partner ? [partner] : []);
  if (agents.length === 0) {
    sse(res, { type: 'error', message: '讨论模式需要至少选择一个 CLI Agent（partners）。' });
    sse(res, { type: '[DONE]' });
    res.end();
    return;
  }
  if (agents.length > MAX_DISCUSS_AGENTS) agents = agents.slice(0, MAX_DISCUSS_AGENTS);

  openSseStream(res);
  // 心跳保活：长讨论（多 Agent × 多轮）中间层易判定空闲断连，注释帧前端天然忽略
  const stopHeartbeat = startHeartbeat(res);
  const watcher = watchDisconnect(res);

  const onEvent = (type, payload) => sse(res, { type, ...payload });

  try {
    const { cleanFinish } = await runRoundtable({ message, partner, partners, maxTurns, apiKey, provider, baseUrl, model, takenOver, cwd, onEvent, shouldAbort: () => watcher.isAborted() });
    sse(res, { type: 'status', message: cleanFinish ? '✅ 讨论完成' : '⏹ 讨论已停止' });
  } catch (err) {
    sse(res, { type: 'error', message: err.message || '讨论执行出错' });
  } finally {
    stopHeartbeat();
    watcher.dispose();
    sse(res, { type: '[DONE]' });
    res.end();
  }
}

module.exports = {
  runDiscussion, runRoundtable, normalizeTranscript,
  splitTranscriptRounds, buildAnthropicDiscussBlocks, compactTranscriptForCli, buildCliTask,
  budgetExceeded, usageFields,
};
