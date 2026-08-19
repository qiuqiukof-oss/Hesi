/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Example Plugin — Echo AI Tool
//
// Registers as an AI function calling tool that echoes input.
// Demonstrates how plugins can add custom tools to the AI chat.
// ============================================================

/**
 * Execute the echo tool.
 * @param {object} args - Tool arguments { message: string }
 * @param {object} context - { broadcastFn, plugin, pluginLoader }
 * @returns {Promise<string>} The echoed message
 */
async function execute(args, context) {
  const { message } = args;
  const echo = `🔌 [Example Plugin] Echo: "${message}"\n\nPlugin: ${context.plugin.name} v${context.plugin.version}`;
  return echo;
}

module.exports = { execute };
