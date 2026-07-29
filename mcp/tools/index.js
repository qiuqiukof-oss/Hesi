/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Tool Registry — aggregates all tool definitions and handlers
// ============================================================

const sessionTools = require("./session");
const executeTools = require("./execute");
const registryTools = require("./registry");
const browserTools = require("./browser");
const workbuddyTools = require("./workbuddy");
const connectorsTools = require("./connectors");

// All tool definitions combined (for ListToolsRequestSchema)
const allToolDefinitions = [].concat(
  sessionTools.toolDefinitions,
  executeTools.toolDefinitions,
  registryTools.toolDefinitions,
  browserTools.toolDefinitions,
  workbuddyTools.toolDefinitions
);

// All tool handlers combined (for CallToolRequestSchema dispatch)
const allHandlers = Object.assign(
  {},
  sessionTools.createHandlers(),
  executeTools.createHandlers(),
  registryTools.createHandlers(),
  browserTools.createHandlers(),
  workbuddyTools.createHandlers()
);

module.exports = { allToolDefinitions, allHandlers, connectorsTools };
