/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// NetForge — AI Tool execution handler
//
// Routes AI tool calls to the browser MCP server.
// This is an inline handler: the function signature matches
// what Hesi's tool registry expects for `execute` handlers.
//
// In a full implementation, this would connect to the running
// MCP server via CDP and proxy the request. For MVP, it returns
// a guidance message telling the AI to use MCP tools directly.

module.exports = async function (params, context) {
  const toolName = context?.toolName || 'unknown';
  console.log(`[NetForge] AI tool called: ${toolName}`, JSON.stringify(params));

  return {
    success: true,
    message: `[NetForge] Tool "${toolName}" executed. For full browser control, use the MCP server "netforge-browser" directly with its native tools: browser_navigate, browser_screenshot, browser_click, browser_type, browser_evaluate.`
  };
};
