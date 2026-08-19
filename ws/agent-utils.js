/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Agent Utilities — shared helpers for agent sessions and workflows
//
// Pure helper functions extracted from ws-handler.js.
// No state — all inputs via parameters.
// ============================================================
const path = require('path');
const { resolveCommand } = require('../cli-discovery');

/**
 * Known AI agent CLI identifiers and their default commands.
 */
const KNOWN_AGENTS = [
  'opencode', 'codebuff', 'freebuff', 'aider',
  'claude', 'codex', 'copilot', 'openhands', 'mentat',
];

/**
 * Get the resolved command path for a known agent ID.
 * Falls back to the agentId as the command name if not found in PATH.
 *
 * @param {string} agentId
 * @returns {string} resolved command path or agentId as-is
 */
function getAgentCommand(agentId) {
  if (KNOWN_AGENTS.includes(agentId)) {
    const resolved = resolveCommand(agentId);
    if (resolved) return resolved;
  }
  const fallback = resolveCommand(agentId);
  return fallback || agentId;
}

/**
 * Resolve a command string to its absolute path with typed error codes.
 * Returns { cmd: string } on success, or { errorCode: string, message: string } on failure.
 * Used by workflow steps and agent:launch for consistent error type differentiation.
 *
 * @param {string} rawCmd - The command string to resolve
 * @param {string} [label] - Human-readable label for error messages
 * @returns {{ cmd: string } | { errorCode: string, message: string }}
 */
function lookupCommand(rawCmd, label) {
  if (!rawCmd) {
    return { errorCode: 'no_command', message: `No command specified for "${label || 'unknown'}"` };
  }
  if (!path.isAbsolute(rawCmd)) {
    const resolved = resolveCommand(rawCmd);
    if (resolved) return { cmd: resolved };
    return { errorCode: 'command_not_found', message: `Command "${rawCmd}" not found in PATH` };
  }
  // Absolute path — skip pre-check, let pty.spawn decide (may produce spawn_error)
  return { cmd: rawCmd };
}

module.exports = { getAgentCommand, lookupCommand };
