/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// PTY — headless PTY creation shared by terminals, agents, and workflows
//
// Extracted from ws-handler.js to decouple PTY lifecycle from
// WebSocket message handling.
// ============================================================
// node-pty is a native addon that may not be compiled in every environment
// (e.g. a fresh checkout without build tools). Guard the require so the rest
// of the server (browser control, plugins, dashboards, etc.) still starts and
// the terminal/agent features degrade gracefully instead of crashing startup.
let pty = null;
let ptyLoadError = null;
try {
  pty = require('node-pty');
} catch (e) {
  ptyLoadError = e;
}
const NODE_PTY_AVAILABLE = !!pty;

const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { resolveCommand, isWin } = require('../cli-discovery');
const { filterSensitiveEnv } = require('../lib/env-filter');
const { getHeadlessDescriptor } = require('../lib/cli-headless');

// 用户真实桌面路径：Windows 上为 %USERPROFILE%\Desktop，其它平台为 ~/Desktop。
// 编排/Agent 的 CLI 在被告知「保存到桌面」时，可据此落到正确位置（避免写成相对目录「桌面」）。
function resolveDesktopPath() {
  if (process.env.USERPROFILE) return path.join(process.env.USERPROFILE, 'Desktop');
  if (process.env.HOME) return path.join(process.env.HOME, 'Desktop');
  return path.join(os.homedir(), 'Desktop');
}

/**
 * Create a headless PTY (no terminal output to client, output is captured
 * via callbacks). Shared helper for agent sessions and workflow steps,
 * reducing code duplication between createAgentPTY, executeWorkflowStep,
 * and executeParallelWorkflowStep.
 *
 * @param {string} cmd - Command to run
 * @param {string[]} [args=[]] - Command arguments
 * @param {object} [opts]
 * @param {number} [opts.cols=120] - Terminal columns
 * @param {number} [opts.rows=40] - Terminal rows
 * @param {object} [opts.extraEnv={}] - Additional env vars to inject
 * @param {function(string):void} [opts.onData] - Called with ANSI-cleaned data chunks
 * @param {function({exitCode, signal}):void} [opts.onExit] - Called on PTY exit
 * @param {function(Error):void} [opts.onError] - Called on spawn failure
 * @returns {object|null} The spawned PTY process, or null on failure
 */
// 终端渲染协议字节清洗（CSI + OSC 1337/99/8 + C1 短序列 + 残余裸 ESC）。
// 抽成独立模块：纯函数 stripTerminalCodes 与流式 createStreamCleaner 复用同一套规则，
// 详见 lib/terminal-clean.js。
const { stripTerminalCodes, createStreamCleaner } = require('../lib/terminal-clean');
const { getWorkspace } = require('../lib/workspace');

function createHeadlessPTY(cmd, args = [], opts = {}) {
  if (!pty) {
    const err = new Error(
      'node-pty native addon is not available — terminal/agent features disabled. ' +
      'Run `npm rebuild node-pty` (and install build tools) then restart the server.'
    );
    if (opts.onError) opts.onError(err);
    return null;
  }

  const { cols = 120, rows = 40, extraEnv = {}, onData, onExit, onError } = opts;

  let resolvedPath = cmd;
  if (!path.isAbsolute(resolvedPath)) {
    const r = resolveCommand(cmd);
    if (r) {
      resolvedPath = r;
      console.log('[AgentSrv] Resolved command:', cmd, '→', resolvedPath);
    } else {
      console.log('[AgentSrv] Command not resolved:', cmd, '(will try as-is)');
    }
  }

  const safeEnv = filterSensitiveEnv(process.env);

  const shellOpts = {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: getWorkspace(),
    env: {
      ...safeEnv,
      TERM: 'xterm-256color',
      TERMINAL_PROGRAM: 'Universal-CLI-Bridge',
      DESKTOP: resolveDesktopPath(),
      CLIQ_DESKTOP: resolveDesktopPath(),
      ...extraEnv,
    },
  };

  if (isWin) shellOpts.useConpty = true;

  try {
    const p = pty.spawn(resolvedPath, args, shellOpts);
    if (onData) {
      // 流式清洗：跨 onData 回调缓存被 chunk 边界切断的未完整转义序列，
      // 避免 OSC/CSI 残留（如 opencode 的 OSC 1337 能力协商泄漏到聊天气泡）。
      const cleaner = createStreamCleaner();
      p.onData((data) => {
        const cleaned = cleaner(data);
        if (cleaned) onData(cleaned);
      });
    }
    if (onExit) p.onExit(onExit);
    return p;
  } catch (err) {
    if (onError) onError(err);
    return null;
  }
}

/**
 * Create a headless agent execution. Prefers a non-TTY (child_process) headless
 * mode for agents that declare one in lib/cli-headless.js (e.g. opencode `run`),
 * which avoids launching the agent's TUI entirely — fixing the "rendering
 * problem" where TUI frames / ASCII-art polluted discussion transcripts.
 *
 * Falls back to the legacy PTY path (createHeadlessPTY + typed prompt) for
 * agents without a descriptor, preserving existing behavior.
 *
 * Returns a pty-like object ({ write, kill }) so callers (agentPool, builtin
 * delegate) need no changes:
 *   - headless path: write() forwards to stdin (the agent runs one-shot, so
 *     further input is ignored); kill() terminates the child process.
 *   - PTY fallback: the real pty object.
 *
 * @param {object} cliEntry - registry CLI entry ({ id, name, path, args })
 * @param {string} prompt - the task/prompt to feed the agent
 * @param {object} [opts] - same shape as createHeadlessPTY opts
 * @returns {object|null}
 */
function createHeadlessExec(cliEntry, prompt, opts = {}) {
  const desc = getHeadlessDescriptor(cliEntry);

  // ── No headless descriptor → legacy PTY path (typed prompt) ──
  if (!desc) {
    const pty = createHeadlessPTY(cliEntry.path || cliEntry.name, cliEntry.args || [], opts);
    if (pty) pty.write(`${prompt || ''  }\n`);
    return pty;
  }

  // ── Headless (non-TTY) path via child_process pipe ──
  const { extraEnv = {}, onData, onExit, onError, cwd } = opts;
  const cmd = cliEntry.path || cliEntry.name;
  const safeEnv = filterSensitiveEnv(process.env);
  const env = { ...safeEnv, TERM: 'dumb', ...extraEnv };
  const spawnOpts = {
    shell: true,            // required to launch .cmd/.ps1 shims on Windows
    windowsHide: true,
    env,
    cwd: cwd || process.env.HOME || process.env.USERPROFILE || __dirname,
  };

  // A descriptor may combine `args` (flags only) with `useStdin` — the prompt is
  // then piped to stdin (multi-line safe) while argv carries only static flags.
  // This matters on Windows where shell:true re-tokenizes argv, mangling any
  // prompt that contains spaces/newlines/quotes. Descriptors that embed the
  // prompt directly in argv should NOT set useStdin.
  const useStdin = !!desc.useStdin;
  const args = desc.args ? desc.args(prompt) : (desc.subcommand ? [desc.subcommand] : []);

  let child;
  try {
    child = spawn(cmd, args, spawnOpts);
  } catch (err) {
    if (onError) onError(err);
    return null;
  }

  // Pipe the prompt to stdin (no shell argv-quoting hazards for multi-line text)
  if (useStdin && child.stdin) {
    try { child.stdin.write(prompt || ''); child.stdin.end(); } catch { /* ignore */ }
  }

  if (onData) {
    const cleaner = createStreamCleaner();
    // Stdout = the agent's actual answer (clean plain text in headless mode).
    child.stdout.on('data', (d) => {
      const cleaned = cleaner(d.toString());
      if (cleaned) onData(cleaned);
    });
    // opencode emits a single-line provider banner on stderr — surface it too
    // (cleaned) so the AI still receives the answer text, not just stdout.
    child.stderr.on('data', (d) => {
      const cleaned = cleaner(d.toString());
      if (cleaned) onData(cleaned);
    });
  }
  if (onExit) child.on('close', (code, signal) => onExit({ exitCode: code, signal }));
  if (onError) child.on('error', (err) => onError(err));

  // pty-like wrapper
  return {
    write(s) {
      try { if (child.stdin && !child.stdin.destroyed) child.stdin.write(s); } catch { /* ignore */ }
    },
    kill() { try { child.kill(); } catch { /* ignore */ } },
    _isHeadless: true,
  };
}

module.exports = { createHeadlessPTY, createHeadlessExec, stripTerminalCodes, createStreamCleaner, NODE_PTY_AVAILABLE, ptyLoadError };
