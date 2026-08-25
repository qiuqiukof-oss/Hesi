/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Session Tools v2 — persistent terminal session lifecycle
//
// v2: 结构化上下文 + 智能等待 + 重复检测 + 频率限制
// ============================================================
const { sessionManager } = require("../session-manager");
const { sharedCliBridge } = require("../../lib/shared-cli-bridge");
const { isSensitive } = require("../../lib/sensitive-commands");

let _stripAnsi = (s) => s;
try {
  const mod = require("strip-ansi");
  _stripAnsi = mod.default || mod;
} catch { /* fallback */ }

// ============================================================
// Tool Definitions
// ============================================================
const toolDefinitions = [
  // ── 基础会话管理（不变）──
  {
    name: "session_create",
    description:
      "Create a persistent terminal session for a given CLI. " +
      "Returns a sessionId that can be used with session_write / session_read.",
    inputSchema: {
      type: "object",
      properties: {
        cliId: { type: "string", description: "CLI identifier (e.g. 'bash', 'node')." },
        env: { type: "object", description: "Optional extra environment variables.", additionalProperties: { type: "string" } },
      },
      required: ["cliId"],
    },
  },
  {
    name: "session_write",
    description: "Write input/command into an active terminal session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID returned by session_create" },
        input: { type: "string", description: "Command(s) to execute." },
      },
      required: ["sessionId", "input"],
    },
  },
  {
    name: "session_read",
    description: "Read output from an active terminal session. Modes: full, tail=N, poll, delta.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Session ID" },
        mode: { type: "string", enum: ["full", "tail", "poll", "delta"] },
        tailLines: { type: "number", description: "Lines for tail mode (default 50)." },
        pollTimeout: { type: "number", description: "Max wait ms for poll mode (default 5000)." },
        cursor: { type: "number", description: "Cursor for delta mode." },
        stripAnsi: { type: "boolean" },
        maxChars: { type: "number", description: "Max chars in delta mode (default 50000)." },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "session_signal",
    description: "Send a POSIX signal (SIGINT/SIGTERM/SIGKILL/SIGHUP) to a session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        signal: { type: "string", enum: ["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP"] },
      },
      required: ["sessionId", "signal"],
    },
  },
  {
    name: "session_resize",
    description: "Resize terminal dimensions (columns x rows). Default 120x40.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        cols: { type: "number", description: "80-400, default 120." },
        rows: { type: "number", description: "10-200, default 40." },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "session_kill",
    description: "Kill and clean up a terminal session. Always call when done.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string" } },
      required: ["sessionId"],
    },
  },
  {
    name: "session_list",
    description: "List all active terminal sessions with state, age, idle time, exitCode.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },

  // ── v2: 协作工具（核心改动）──
  {
    name: "session_collab",
    description:
      "⚠️ 操作用户「正在使用的 Hesi CLI 终端」（非新建会话）。\n" +
      "**铁律**：\n" +
      "1. 每次调用只执行一条命令，严禁连锁执行多条\n" +
      "2. 调用前检查返回的 recentHistory，避免重复执行相同命令\n" +
      "3. delta 字段是本次命令的增量输出，优先使用 delta 而非 afterContext\n" +
      "4. commandDuplicate=true 时必须跳过并告知用户\n" +
      "5. 用户想执行多条命令时，等用户明确给出下一条再执行\n" +
      "6. 如果返回 terminalAbnormal=true 或 shouldStop=true，**立即停止**重试，建议用户手动修复终端\n" +
      "7. 不要在终端异常时 fallback 到 exec_terminal 或其他工具\n" +
      "userId 可省略（系统自动定位当前唯一的共享终端）。",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "当前用户 id（可省略，系统自动定位共享终端）。",
        },
        action: {
          type: "string",
          enum: ["read", "write"],
          description: "read=读最近窗口+执行历史；write=执行命令并返回结构化上下文。默认 read。",
        },
        command: {
          type: "string",
          description: "action=write 时要执行的命令。",
        },
        tailLines: {
          type: "number",
          description: "读取行数（默认 40，最大 200）。",
        },
      },
      required: [],
    },
  },
  {
    name: "session_collab_confirm",
    description:
      "敏感命令二次确认：当 session_collab 返回 confirmRequired 时，用户确认后调用本工具执行。",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "当前用户 id（可省略）。" },
        token: { type: "string", description: "session_collab 返回的 confirmToken。" },
        tailLines: { type: "number", description: "执行后返回最近 N 行（默认 40）。" },
      },
      required: ["token"],
    },
  },
  {
    name: "session_cli",
    description:
      "⚠️ 唯一正确路径：操作用户「正在使用的 Hesi CLI 终端」。\n" +
      "当用户说「在这个终端…」「帮我跑…」「执行…」且指向当前 CLI 时，**必须**使用本工具。\n" +
      "不要使用 session_collab（需先邀请）、session_write（AI 自己的会话）或 exec_terminal。\n" +
      "自动接管激活终端，无需额外步骤。返回结构化上下文（recentHistory + currentState + delta）。\n" +
      "**铁律**：\n" +
      "1. 每次只执行一条命令，检查 recentHistory 避免重复\n" +
      "2. 如果返回 terminalAbnormal=true 或 shouldStop=true，**立即停止**重试\n" +
      "3. 连续失败 2 次以上 → 停止并诊断原因，不要换工具重试\n" +
      "4. 不要在终端异常时 fallback 到 exec_terminal",
    inputSchema: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "当前用户 id（可省略，系统会自动定位活跃终端的用户）。",
        },
        instruction: {
          type: "string",
          description: "要在激活的 CLI 中执行的单条指令。",
        },
        tailLines: {
          type: "number",
          description: "执行前后返回最近 N 行（默认 40，最大 200）。",
        },
      },
      required: ["instruction"],
    },
  },
];

// ============================================================
// Handlers
// ============================================================
function createHandlers() {
  return {
    session_create: async (args) => {
      const session = await sessionManager.create(args.cliId, { env: args.env });
      return { content: [{ type: "text", text: JSON.stringify(session.toJSON(), null, 2) }] };
    },

    session_write: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) return { content: [{ type: "text", text: `Session not found: ${args.sessionId}` }], isError: true };
      session.write(args.input);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true, sessionId: args.sessionId }) }] };
    },

    session_read: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) return { content: [{ type: "text", text: `Session not found: ${args.sessionId}` }], isError: true };
      const mode = args.mode || "full";
      if (mode === "delta") {
        const result = await session.read({ mode: "delta", cursor: args.cursor, stripAnsi: args.stripAnsi, maxChars: args.maxChars || 50000 });
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      }
      const output = await session.read({ mode, tailLines: args.tailLines || 50, pollTimeout: args.pollTimeout || 5000 });
      const truncated = output.length > 50000;
      return { content: [{ type: "text", text: truncated ? `${output.slice(-50000)}\n[--truncated--]` : output }] };
    },

    session_signal: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) return { content: [{ type: "text", text: `Session not found: ${args.sessionId}` }], isError: true };
      try { session.signal(args.signal); return { content: [{ type: "text", text: JSON.stringify({ ok: true, signal: args.signal }) }] };
      } catch (err) { return { content: [{ type: "text", text: err.message }], isError: true }; }
    },

    session_resize: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) return { content: [{ type: "text", text: `Session not found: ${args.sessionId}` }], isError: true };
      try { session.resize(args.cols, args.rows); return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
      } catch (err) { return { content: [{ type: "text", text: err.message }], isError: true }; }
    },

    session_kill: async (args) => {
      const found = sessionManager.kill(args.sessionId);
      return { content: [{ type: "text", text: JSON.stringify({ ok: found, sessionId: args.sessionId }) }] };
    },

    session_list: async () => {
      const sessions = sessionManager.list();
      return { content: [{ type: "text", text: JSON.stringify({ sessions, count: sessions.length }, null, 2) }] };
    },

    // ── v2: session_collab（核心）──
    session_collab: async (args) => {
      // userId 解析：显式 → getShared → getAnyShared 回退
      let userId = args.userId;
      let shared = userId ? sharedCliBridge.getShared(userId) : null;
      if (!shared) {
        const any = sharedCliBridge.getAnyShared();
        if (any) { userId = any.userId; shared = any; }
      }
      if (!userId || !shared) {
        const list = sharedCliBridge.listShared();
        const hint = list.length
          ? `当前共享用户：${list.map((s) => s.userId).join(", ")}。`
          : "当前没有任何终端处于「邀请 AI 协作」状态。";
        return { content: [{ type: "text", text: `${hint} 请先用 /cli collab 进入协作模式。不要 fallback 到 exec_terminal（那是 AI 自己的终端，不是用户的）。` }], isError: true };
      }      if (sharedCliBridge.isNonLinear(shared.cliId)) {
        return { content: [{ type: "text", text: `检测到交互式程序「${shared.cliId}」，请先退出再协作。不要 fallback 到 exec_terminal。` }], isError: true };
      }

      // 频率限制（与 session_cli 共用同一计数器）
      if (!sharedCliBridge.checkRateLimit(userId)) {
        return { content: [{ type: "text", text: JSON.stringify({
          error: true,
          shouldStop: true,
          message: "1 分钟内 CLI 操作已达 5 次上限。AI 应停止重试，告知用户等待 1 分钟或手动操作终端。",
        }) }], isError: true };
      }

      const wsManager = sharedCliBridge.getWsManager();
      const action = args.action || "read";
      const tailLines = Math.min(200, Math.max(1, args.tailLines || 40));

      // read 模式：返回执行历史 + 当前态
      if (action === "read") {
        if (!wsManager) return { content: [{ type: "text", text: "wsManager 不可用。" }], isError: true };
        const out = _stripAnsi(wsManager.readTabOutput(shared.tabId, tailLines) || "");
        const recentHistory = sharedCliBridge.getRecentExecutions(shared.tabId, 5);
        const currentState = sharedCliBridge._buildCurrentState(wsManager, shared.tabId, tailLines);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ tabId: shared.tabId, cliId: shared.cliId, mode: "read", recentHistory, currentState, output: out }, null, 2),
          }],
        };
      }

      // write 模式
      const cmd = (args.command || "").trim();
      if (!cmd) return { content: [{ type: "text", text: "write 动作需要提供 command。" }], isError: true };
      if (!wsManager) return { content: [{ type: "text", text: "wsManager 不可用。" }], isError: true };
      if (sharedCliBridge.isUserTyping(shared.tabId)) {
        return { content: [{ type: "text", text: "用户正在该终端输入，AI 暂缓写入。请稍候 1~2 秒再试。" }], isError: true };
      }
      if (!sharedCliBridge.acquireWrite(shared.tabId, 'ai', 10000)) {
        const owner = sharedCliBridge.getWriteLockOwner(shared.tabId);
        return { content: [{ type: "text", text: `写锁被「${owner || 'unknown'}」占用，请稍后再试。` }], isError: true };
      }
      try {
        // 重复检测
        const dup = sharedCliBridge.checkDuplicate(shared.tabId, cmd);
        if (dup.isDuplicate) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                commandDuplicate: true,
                command: cmd,
                message: `命令「${cmd}」在最近 60 秒内已执行过（${dup.lastExecution.at}前）。`,
                recentExecutions: sharedCliBridge.getRecentExecutions(shared.tabId, 3),
              }, null, 2),
            }],
          };
        }
        // 敏感确认
        if (sharedCliBridge.isSensitiveCommand(cmd)) {
          const token = sharedCliBridge.createConfirmToken(userId, cmd);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                confirmRequired: true, confirmToken: token, command: cmd,
                message: "敏感命令，需用户确认后执行。",
              }, null, 2),
            }],
          };
        }
        const ok = sharedCliBridge._wsManager.writeTab(shared.tabId, cmd);
        if (!ok) return { content: [{ type: "text", text: `写入失败（tabId=${shared.tabId}）。` }], isError: true };

        const after = await sharedCliBridge.waitForOutput(wsManager, shared.tabId, tailLines);

        sharedCliBridge.recordExecution(shared.tabId, cmd, after.slice(0, 200));
        const recentHistory = sharedCliBridge.getRecentExecutions(shared.tabId, 5);
        const currentState = sharedCliBridge._buildCurrentState(wsManager, shared.tabId, tailLines);
        const delta = _computeDelta(before, after, cmd);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tabId: shared.tabId, cliId: shared.cliId, executed: cmd,
              recentHistory, currentState, delta,
              note: "本次任务已完成。如需继续，请再次给出明确指令。",
            }, null, 2),
          }],
        };
      } finally {
        sharedCliBridge.releaseWrite(shared.tabId);
      }
    },

    // ── 敏感命令确认 ──
    session_collab_confirm: async (args) => {
      let userId = args.userId;
      let shared = userId ? sharedCliBridge.getShared(userId) : null;
      if (!shared) {
        const any = sharedCliBridge.getAnyShared();
        if (any) { userId = any.userId; shared = any; }
      }
      if (!userId || !shared) {
        return { content: [{ type: "text", text: "没有处于共享状态的终端。" }], isError: true };
      }
      if (sharedCliBridge.isNonLinear(shared.cliId)) {
        return { content: [{ type: "text", text: `检测到交互式程序「${shared.cliId}」。` }], isError: true };
      }
      const cmd = sharedCliBridge.consumeConfirmToken(args.token, userId);
      if (!cmd) return { content: [{ type: "text", text: "确认令牌无效、已过期或不属于当前用户。" }], isError: true };
      const wsManager = sharedCliBridge.getWsManager();
      if (!wsManager) return { content: [{ type: "text", text: "wsManager 不可用。" }], isError: true };
      if (sharedCliBridge.isUserTyping(shared.tabId)) {
        return { content: [{ type: "text", text: "用户正在输入，已取消。" }], isError: true };
      }
      if (!sharedCliBridge.acquireWrite(shared.tabId, 'ai', 10000)) {
        return { content: [{ type: "text", text: "写锁被占用。" }], isError: true };
      }
      try {
        const tailLines = Math.min(200, Math.max(1, args.tailLines || 40));
        const before = _stripAnsi(wsManager.readTabOutput(shared.tabId, tailLines) || "");
        const ok = sharedCliBridge._wsManager.writeTab(shared.tabId, cmd);
        if (!ok) return { content: [{ type: "text", text: `写入失败。` }], isError: true };
        const after = await sharedCliBridge.waitForOutput(wsManager, shared.tabId, tailLines);
        sharedCliBridge.recordExecution(shared.tabId, cmd, after.slice(0, 200));
        const recentHistory = sharedCliBridge.getRecentExecutions(shared.tabId, 5);
        const currentState = sharedCliBridge._buildCurrentState(wsManager, shared.tabId, tailLines);
        const delta = _computeDelta(before, after, cmd);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              tabId: shared.tabId, cliId: shared.cliId, executed: cmd, confirmed: true,
              recentHistory, currentState, delta,
              note: "敏感命令已确认执行，本次任务完成。",
            }, null, 2),
          }],
        };
      } finally {
        sharedCliBridge.releaseWrite(shared.tabId);
      }
    },

    // ── v2: session_cli（自动接管激活终端）──
    session_cli: async (args) => {
      // userId 解析：显式 → getShared → getAnyShared 回退（与 session_collab 一致）
      let userId = args.userId;
      if (!userId) {
        const any = sharedCliBridge.getAnyShared();
        if (any) userId = any.userId;
      }
      // 如果仍无 userId，尝试从 wsManager 找任意活跃连接的 userId
      if (!userId) {
        const wsManager = sharedCliBridge.getWsManager();
        if (wsManager && wsManager.activePTYs) {
          for (const [ws] of wsManager.activePTYs) {
            if (ws && ws._userId) { userId = ws._userId; break; }
          }
        }
      }
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({
          error: true,
          message: "无法定位用户身份。请先在 Hesi 中登录或打开一个终端。",
          hint: "userId 参数可省略，系统会自动定位。如果仍然失败，请检查终端是否已打开。",
          noFallback: true,
        }, null, 2) }], isError: true };
      }
      const r = await sharedCliBridge.executeOnActiveCli(userId, (args.instruction || "").trim(), {
        tailLines: args.tailLines || 40,
      });
      if (r.confirmRequired) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              confirmRequired: true, confirmToken: r.confirmToken, command: r.command, cliId: r.cliId,
              message: "敏感命令，需用户确认。",
            }, null, 2),
          }],
        };
      }
      if (!r.ok) {
        return { content: [{ type: "text", text: r.error || "执行失败" }], isError: true };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            tabId: r.tabId, cliId: r.cliId, executed: r.executed,
            recentHistory: r.recentHistory, currentState: r.currentState, delta: r.delta,
            note: "本次 /cli 任务已完成。如需继续，请再次使用 /cli 指令。",
          }, null, 2),
        }],
      };
    },
  };
}

function _computeDelta(before, after, cmd) {
  if (!before) return after || '';
  if (!after) return '';
  const bLines = before.split('\n');
  const aLines = after.split('\n');
  let i = 0;
  while (i < bLines.length && i < aLines.length && bLines[i] === aLines[i]) i++;
  let delta = aLines.slice(i).join('\n');
  // 去掉 PTY 回显的命令行
  if (cmd && delta) {
    const cmdTrimmed = cmd.trim();
    const deltaLines = delta.split('\n');
    let skip = 0;
    for (const line of deltaLines) {
      const l = line.trim();
      if (l === cmdTrimmed || l.endsWith(cmdTrimmed) || l.includes(cmdTrimmed)) {
        skip++;
      } else {
        break;
      }
    }
    if (skip > 0) delta = deltaLines.slice(skip).join('\n');
  }
  return delta;
}

module.exports = { toolDefinitions, createHandlers };
