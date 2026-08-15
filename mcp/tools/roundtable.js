/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Roundtable MCP Tool — 圆桌讨论（AI 助手 × CLI Agent 多轮协作）
//
// 把 Hesi 的圆桌讨论内核（routes/chat/discuss.js 的 runRoundtable）
// 暴露为 MCP 工具，供 DSH 引擎（mcp-client 接入）直接调用：
//   roundtable_discuss — 发起一场多 Agent 圆桌讨论并返回纪要/转录
//
// 配置自动复用 Hesi 的 LLM Provider（provider-config：env 优先 +
// data/llm-providers.json），CLI Agent 来自 cli-discovery 注册表
// （opencode / codex / aider …）。
// ============================================================

const { runRoundtable } = require('../../routes/chat/discuss');

const MAX_TURNS = 12;

const toolDefinitions = [
  {
    name: "roundtable_discuss",
    description:
      "发起一场圆桌讨论：AI 助手与一个或多个 CLI Agent（opencode/codex/aider 等）按回合协作讨论一个话题，返回讨论纪要（summary）与完整转录（transcript）。" +
      "适用于需要多视角推敲的方案设计、代码评审、架构决策等场景。\n\n" +
      "用法示例：\n" +
      '  { "topic": "如何给这个项目加缓存层？", "partner": "opencode", "maxTurns": 6 }\n' +
      '  { "topic": "评审这个方案", "partners": ["opencode", "codex"], "maxTurns": 4 }\n\n' +
      "注意：需要至少一个已安装的 CLI Agent 作为讨论伙伴（Hesi「AI 智能体」页安装）。",
    inputSchema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "讨论话题 / 原始问题（中文英文均可）",
        },
        partner: {
          type: "string",
          description: "单个 CLI Agent id（如 opencode / codex / aider）。与 partners 二选一",
        },
        partners: {
          type: "array",
          items: { type: "string" },
          description: "多个 CLI Agent id 列表，最多 5 个。与 partner 二选一",
        },
        maxTurns: {
          type: "number",
          description: "最多讨论回合数（默认 6，最大 12）",
          default: 6,
        },
      },
      required: ["topic"],
    },
  },
];

function createHandlers() {
  return {
    roundtable_discuss: async (args) => {
      const topic = (args.topic || "").trim();
      if (!topic) {
        return {
          content: [{ type: "text", text: "Error: topic is required" }],
          isError: true,
        };
      }
      const partners = Array.isArray(args.partners) && args.partners.length
        ? args.partners.map((p) => String(p)).filter(Boolean)
        : (args.partner ? [String(args.partner)] : []);
      const maxTurns = Math.max(1, Math.min(MAX_TURNS, Number(args.maxTurns) || 6));

      // 聚合圆桌 SSE 事件：token 发言累积为转录流，discuss_stats 取统计，error 透传
      let streamText = '';
      let stats = null;
      let lastError = '';
      const onEvent = (type, payload) => {
        if (type === 'token' && payload && typeof payload === 'object' && typeof payload.token === 'string') {
          streamText += payload.token;
        } else if (type === 'discuss_stats' && payload && payload.stats) {
          stats = payload.stats;
        } else if (type === 'error' && payload) {
          lastError = (payload.message || JSON.stringify(payload)).slice(0, 500);
        }
        // 其余事件（discuss_start/end/status）不落入转录，由返回值兜底
      };

      try {
        const result = await runRoundtable({
          message: topic,
          partner: partners[0],
          partners,
          maxTurns,
          onEvent,
          cwd: process.cwd(),
        });

        const lines = [];
        lines.push(`# 圆桌讨论纪要\n`);
        if (result.summary) lines.push(result.summary);
        if (stats) {
          lines.push(`\n## 统计\n`);
          lines.push(`- 回合数：${stats.rounds ?? '?'} · Agent 数：${stats.agents ?? '?'}`);
          if (stats.aiInputTokens != null) lines.push(`- AI 输入 tokens：${stats.aiInputTokens} · 输出：${stats.aiOutputTokens}`);
          if (stats.cliOutputChars != null) lines.push(`- CLI 输出字符：${stats.cliOutputChars}`);
          if (stats.convergenceScore != null) lines.push(`- 收敛度：${stats.convergenceScore}`);
        }
        if (result.transcript && result.transcript.trim()) {
          lines.push(`\n## 完整转录\n`);
          lines.push(result.transcript);
        }
        if (streamText && streamText.trim()) {
          lines.push(`\n## 流式发言记录\n`);
          lines.push(streamText);
        }
        if (result.cleanFinish === false) {
          lines.push(`\n> ⚠️ 讨论未正常收尾${  lastError ? `：${lastError}` : '（可能被中断或出错）'}`);
        }
        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err && err.message ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  };
}

module.exports = { toolDefinitions, createHandlers };
