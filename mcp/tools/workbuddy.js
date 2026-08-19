/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// WorkBuddy MCP Tool — call WorkBuddy CLI through MCP protocol
//
// Reuses the executeWorkbuddy function from the AI Tool layer
// to avoid duplicating PTY spawn logic.
// ============================================================

const { executeWorkbuddy } = require('../../routes/ai-tools/builtin/workbuddy');

const toolDefinitions = [
  {
    name: "workbuddy_execute",
    description:
      "Execute a WorkBuddy CLI command and return its output. " +
      "WorkBuddy is a structured CLI for business operations: " +
      "jobs (work orders), customers, employees, items, stages, " +
      "agents, mcp, settings, exports, webhooks, attachments.\n\n" +
      "Examples:\n" +
      '  "jobs search --limit 10" — search recent work orders\n' +
      '  "customers list" — list all customers\n' +
      '  "employees list" — list employees\n' +
      '  "agents list" — list AI agents\n' +
      '  "settings job-types" — get job type configuration\n' +
      '  "--describe" — get all available operations as JSON',
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "WorkBuddy command to execute, e.g. 'jobs search --limit 5' or '--describe'",
        },
        timeout: {
          type: "number",
          description:
            "Max execution time in ms (default: 30000, max: 120000)",
          default: 30000,
        },
      },
      required: ["command"],
    },
  },
];

function createHandlers() {
  return {
    workbuddy_execute: async (args) => {
      const command = (args.command || "").trim();
      if (!command) {
        return {
          content: [{ type: "text", text: "Error: command is required" }],
          isError: true,
        };
      }

      const timeout = Math.min(args.timeout || 30000, 120000);

      try {
        const output = await executeWorkbuddy(command, timeout);
        return {
          content: [{ type: "text", text: output }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    },
  };
}

module.exports = { toolDefinitions, createHandlers };
