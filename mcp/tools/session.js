/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Session Tools — persistent terminal session lifecycle
//
// Tools: session_create, session_write, session_read,
//        session_kill, session_list, session_signal,
//        session_resize
// ============================================================
const { sessionManager } = require("../session-manager");

const toolDefinitions = [
  {
    name: "session_create",
    description:
      "Create a persistent terminal session for a given CLI. " +
      "Returns a sessionId that can be used with session_write / session_read. " +
      "Unlike execute_cli (one-shot), this keeps the terminal alive so you can " +
      "cd between commands, set env vars, or start long-running processes.",
    inputSchema: {
      type: "object",
      properties: {
        cliId: {
          type: "string",
          description:
            "CLI identifier (e.g. 'bash', 'node', 'git'). Use list_clis to discover available CLIs.",
        },
        env: {
          type: "object",
          description:
            "Optional extra environment variables to inject.",
          additionalProperties: { type: "string" },
        },
      },
      required: ["cliId"],
    },
  },
  {
    name: "session_write",
    description:
      "Write input/command into an active terminal session. " +
      "Use this to execute commands in a persistent context (the session retains cwd, env, state). " +
      "Example: create bash session, write 'cd /project && npm install', then write 'npm run dev'.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID returned by session_create",
        },
        input: {
          type: "string",
          description:
            "Command(s) to execute. Add \\n at end if you want immediate execution.",
        },
      },
      required: ["sessionId", "input"],
    },
  },
  {
    name: "session_read",
    description:
      "Read output from an active terminal session. " +
      "Supports four modes:\n" +
      "- full (default): return all buffered output\n" +
      "- tail=N: return last N lines (like tail -n)\n" +
      "- poll: wait for new output (up to pollTimeout ms), useful after writing a command\n" +
      "- delta: return only new output since a cursor position, with structured metadata",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID returned by session_create",
        },
        mode: {
          type: "string",
          enum: ["full", "tail", "poll", "delta"],
          description:
            "Read mode: full (entire buffer), tail (last N lines), poll (wait for new output), delta (incremental from cursor).",
        },
        tailLines: {
          type: "number",
          description:
            "Number of lines for tail mode (default: 50).",
        },
        pollTimeout: {
          type: "number",
          description:
            "Max wait time in ms for poll mode (default: 5000).",
        },
        cursor: {
          type: "number",
          description:
            "Cursor position for delta mode. Omit to get last 50 lines + current cursor. Pass previously returned cursor to get only new output since then.",
        },
        stripAnsi: {
          type: "boolean",
          description:
            "If true, strip ANSI escape sequences from output (delta mode only).",
        },
        maxChars: {
          type: "number",
          description:
            "Maximum characters to return in delta mode (default: 50000).",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "session_signal",
    description:
      "Send a POSIX signal to a running session. " +
      "Use SIGINT (Ctrl+C) to interrupt a running command, SIGTERM for graceful shutdown, " +
      "SIGKILL to force-kill the terminal process, SIGHUP to hang up. " +
      "Note: On Windows, only SIGINT and SIGKILL are reliably supported.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID returned by session_create",
        },
        signal: {
          type: "string",
          enum: ["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP"],
          description:
            "Signal to send. SIGINT = Ctrl+C (interrupt current process), SIGTERM = graceful shutdown, SIGKILL = force kill, SIGHUP = hang up.",
        },
      },
      required: ["sessionId", "signal"],
    },
  },
  {
    name: "session_resize",
    description:
      "Resize the terminal dimensions (columns x rows). " +
      "Default is 120x40. Use when output is wrapping incorrectly or too narrow/wide. " +
      "Columns are clamped to 80-400, rows to 10-200.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID returned by session_create",
        },
        cols: {
          type: "number",
          description: "Number of columns (80-400, default: 120).",
        },
        rows: {
          type: "number",
          description: "Number of rows (10-200, default: 40).",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "session_kill",
    description:
      "Kill and clean up a terminal session. " +
      "Always call this when you are done with a session to free resources. " +
      "Sessions also auto-expire after 15 minutes of inactivity.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID returned by session_create",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "session_list",
    description:
      "List all active terminal sessions with their state, age, idle time, and exitCode.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
];

/**
 * Create handler map for session tools.
 * Each function receives (args) and returns MCP content result.
 */
function createHandlers() {
  return {
    session_create: async (args) => {
      const session = await sessionManager.create(args.cliId, { env: args.env });
      return {
        content: [{ type: "text", text: JSON.stringify(session.toJSON(), null, 2) }],
      };
    },

    session_write: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: `Session not found or expired: ${args.sessionId}` }],
          isError: true,
        };
      }
      session.write(args.input);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, sessionId: args.sessionId }) }],
      };
    },

    session_read: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: `Session not found or expired: ${args.sessionId}` }],
          isError: true,
        };
      }
      const mode = args.mode || "full";

      if (mode === "delta") {
        const result = await session.read({
          mode: "delta",
          cursor: args.cursor,
          stripAnsi: args.stripAnsi,
          maxChars: args.maxChars || 50000,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      const output = await session.read({
        mode,
        tailLines: args.tailLines || 50,
        pollTimeout: args.pollTimeout || 5000,
      });
      const truncated = output.length > 50000;
      return {
        content: [{
          type: "text",
          text: truncated ? `${output.slice(-50000)  }\n[--output truncated to 50000 chars--]` : output,
        }],
      };
    },

    session_signal: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: `Session not found or expired: ${args.sessionId}` }],
          isError: true,
        };
      }
      try {
        session.signal(args.signal);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, signal: args.signal, sessionId: args.sessionId }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: err.message }],
          isError: true,
        };
      }
    },

    session_resize: async (args) => {
      const session = sessionManager.get(args.sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: `Session not found or expired: ${args.sessionId}` }],
          isError: true,
        };
      }
      try {
        session.resize(args.cols, args.rows);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, cols: args.cols || 120, rows: args.rows || 40, sessionId: args.sessionId }) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: err.message }],
          isError: true,
        };
      }
    },

    session_kill: async (args) => {
      const found = sessionManager.kill(args.sessionId);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ok: found, sessionId: args.sessionId }),
        }],
      };
    },

    session_list: async () => {
      const sessions = sessionManager.list();
      return {
        content: [{ type: "text", text: JSON.stringify({ sessions, count: sessions.length }, null, 2) }],
      };
    },
  };
}

module.exports = { toolDefinitions, createHandlers };
