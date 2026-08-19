/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Execute Tool — one-shot command execution (compatibility + convenience)
//
// Internally creates a temporary session, writes the command,
// waits for output, and kills the session.
// ============================================================
const { sessionManager } = require("../session-manager");
const config = require("../config");

const toolDefinitions = [
  {
    name: "execute_cli",
    description:
      "Execute a single command in a CLI and return its output. " +
      "This is a convenience wrapper — it creates a temporary session, runs your command, " +
      "and cleans up. For multi-step workflows (cd, set env, run server), use session_create " +
      "+ session_write + session_read instead.",
    inputSchema: {
      type: "object",
      properties: {
        cliId: {
          type: "string",
          description:
            "CLI identifier (e.g. 'bash', 'node', 'git'). Use list_clis to discover available CLIs.",
        },
        command: {
          type: "string",
          description:
            "Command to execute.",
        },
        timeout: {
          type: "number",
          description:
            "Max execution time in ms (default: 30000).",
        },
      },
      required: ["cliId", "command"],
    },
  },
];

function createHandlers() {
  return {
    execute_cli: async (args) => {
      const timeout = args.timeout || config.cmdTimeout * 2;

      const session = await sessionManager.create(args.cliId);

      try {
        session.write(args.command);

        const MAX_EXEC_OUTPUT = 100000;
        let output = "";
        const deadline = Date.now() + timeout;

        while (Date.now() < deadline) {
          const chunk = await session.read({ mode: "poll", pollTimeout: 2000 });
          output = (output + chunk).slice(-MAX_EXEC_OUTPUT);

          const lastLine = chunk.split("\n").filter(Boolean).pop() || "";
          const promptPattern = /[#$%>]\s*$/;
          if (promptPattern.test(lastLine) && output.length > 20) {
            await new Promise((r) => setTimeout(r, 500));
            break;
          }
        }

        sessionManager.kill(session.id);

        return {
          content: [{
            type: "text",
            text: output + (output.length >= MAX_EXEC_OUTPUT ? "\n[--output truncated to 100000 chars--]" : ""),
          }],
        };
      } catch (err) {
        sessionManager.kill(session.id);
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  };
}

module.exports = { toolDefinitions, createHandlers };
