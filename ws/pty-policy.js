/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// PTY Policy — bridge between MCP policy engine and WS/PTY layer
//
// Imports the existing checkCommand / checkFilePath from
// mcp/security/policy.js and wraps them with WS-specific error
// reporting. Also manages per-connection session modes
// (readonly / normal) so frontend can toggle protection.
//
// Usage:
//   const { createPTYPolicy } = require('./ws/pty-policy');
//   const ptyPolicy = createPTYPolicy();
//   ptyPolicy.checkCLI('npm install')  → { allowed: true }
//   ptyPolicy.setMode(ws, 'readonly')   → blocks all input
// ============================================================
const { checkCommand: mcpCheckCommand, checkFilePath: mcpCheckFilePath } = require('../mcp/security/policy');
const { resolveCliExecutable } = require('../cli-discovery');

// ── Session modes ──
const MODE_READONLY = 'readonly';
const MODE_NORMAL = 'normal';

/**
 * Create a PTY-layer policy instance.
 *
 * Manages a per-WebSocket session mode map and wraps the MCP
 * policy engine with WS-compatible error reporting.
 *
 * @returns {PTYPolicy}
 */
function createPTYPolicy() {
  /** Map<WebSocket, 'readonly' | 'normal'> */
  const sessionModes = new WeakMap();

  return {

    /**
     * Check whether a CLI command is allowed by policy.
     * Delegates to mcp/security/policy.checkCommand().
     *
     * @param {string} command — full command string (e.g. "npm install")
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkCLI(command) {
      return mcpCheckCommand(command);
    },

    /**
     * Check whether a file path is allowed.
     * Delegates to mcp/security/policy.checkFilePath().
     *
     * @param {string} filePath
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkPath(filePath) {
      return mcpCheckFilePath(filePath);
    },

    /**
     * Check a CLI entry before spawning its PTY.
     * Verifies both the command name and path.
     *
     * @param {object} cliEntry — { id, name, path, args }
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkCLIEntry(cliEntry) {
      // 1. Check the command name/args against policy
      const fullCmd = [cliEntry.name, ...(cliEntry.args || [])].join(' ');
      const cmdCheck = mcpCheckCommand(fullCmd);
      if (!cmdCheck.allowed) return cmdCheck;

      // 2. Verify the executable is reachable. Resolve via resolveCliExecutable,
      //    which self-heals against stale cached paths (e.g. a registry copied
      //    from another machine) by falling back to PATH resolution of the name.
      //    CLI tools are system-wide executables (cmd.exe, node.exe, python.exe
      //    etc.) that naturally live outside the project root, so we only check
      //    reachability — not a project-root sandbox.
      const execPath = resolveCliExecutable(cliEntry);
      if (!execPath) {
        return { allowed: false, reason: `Executable not found: '${cliEntry.name}' (not resolvable in PATH)` };
      }

      return { allowed: true };
    },

    /**
     * Check whether an agent command is allowed.
     *
     * @param {string} cmd — agent executable path or name
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkAgent(cmd) {
      return mcpCheckCommand(cmd);
    },

    // ── Session mode management ──

    /**
     * Set the mode for a WebSocket connection.
     *
     * @param {object} ws   — WebSocket instance
     * @param {string} mode — 'readonly' | 'normal'
     */
    setMode(ws, mode) {
      if (mode !== MODE_READONLY && mode !== MODE_NORMAL) return;
      sessionModes.set(ws, mode);
    },

    /**
     * Get the current mode for a WebSocket connection.
     * Defaults to 'normal' when not set.
     *
     * @param {object} ws
     * @returns {'readonly' | 'normal'}
     */
    getMode(ws) {
      return sessionModes.get(ws) || MODE_NORMAL;
    },

    /**
     * Remove mode tracking for a disconnected WebSocket.
     *
     * @param {object} ws
     */
    cleanup(ws) {
      sessionModes.delete(ws);
    },

    /**
     * Check whether the session can accept input.
     * If readonly, returns { allowed: false, reason }.
     *
     * @param {object} ws
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkInputAllowed(ws) {
      const mode = sessionModes.get(ws);
      if (mode === MODE_READONLY) {
        return { allowed: false, reason: 'Session is in read-only mode. Use set_mode: normal to enable input.' };
      }
      return { allowed: true };
    },

    /**
     * Check an input line against command policy.
     * Used by the 'input' message handler to intercept
     * blocklisted commands even in normal mode.
     *
     * @param {string} data — the raw input string (single line)
     * @returns {{ allowed: boolean, reason?: string }}
     */
    checkInputLine(data) {
      const trimmed = data.trim();
      if (!trimmed) return { allowed: true }; // empty input is fine

      // Only check if it looks like a command (no shell control chars)
      // We check the first token
      return mcpCheckCommand(trimmed);
    },
  };
}

module.exports = { createPTYPolicy, MODE_READONLY, MODE_NORMAL };
