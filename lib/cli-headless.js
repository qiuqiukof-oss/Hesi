/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// CLI Headless Mode — non-TTY invocation descriptors
//
// Some CLI agents (e.g. opencode) are full-screen TUIs. When launched inside a
// PTY (a real TTY) they render ASCII-art / status frames, and that rendered
// chrome pollutes the text we feed back to the AI assistant during discussions
// (the "rendering problem"). We therefore prefer a *headless* invocation for
// these agents: spawn them through child_process (a pipe, NOT a TTY) so the TUI
// is never drawn.
//
// opencode's headless entry is `opencode run`. When invoked with NO positional
// message it reads the prompt from stdin — which cleanly handles multi-line
// prompts without any shell argv-quoting hazards (newlines would otherwise be
// re-tokenized by the shell).
//
// Descriptor shape:
//   { subcommand?: string, useStdin?: boolean, args?: (prompt) => string[] }
//     - subcommand: headless subcommand (e.g. "run"); ignored if `args` given
//     - useStdin:   pipe the prompt to the child's stdin (STRONGLY preferred —
//                   multi-line/space/quote-safe; on Windows shell:true would
//                   otherwise re-tokenize an argv-embedded prompt)
//     - args:       argv builder for STATIC flags. When paired with useStdin the
//                   prompt is NOT embedded in argv (it goes to stdin); the
//                   builder still receives the prompt for the rare argv-embed case.
//
// All entries below feed the prompt via stdin, so multi-line roundtable prompts
// stay intact. Flags verified against each tool's non-interactive docs (2026):
//   - claude:  `claude -p`            reads the prompt from stdin (print mode)
//   - codex:   `codex exec -`         `-` sentinel = read full prompt from stdin
//   - aider:   piped stdin            treated as the one-shot instruction;
//              `--yes-always` (no confirmations), `--no-auto-commits`
//              (don't surprise-commit), `--no-pretty`/`--no-stream` (clean,
//              capturable output — no TUI chrome).
// ============================================================

// Verified headless agents. Extend this map as others are confirmed.
const HEADLESS = {
  opencode: { subcommand: 'run', useStdin: true },
  claude: { useStdin: true, args: () => ['-p'] },
  codex: { useStdin: true, args: () => ['exec', '-'] },
  aider: {
    useStdin: true,
    args: () => ['--yes-always', '--no-auto-commits', '--no-pretty', '--no-stream'],
  },
};

/**
 * Resolve the headless descriptor for a CLI registry entry.
 * @param {{id?:string, name?:string}} cliEntry
 * @returns {object|null}
 */
function getHeadlessDescriptor(cliEntry) {
  if (!cliEntry) return null;
  return HEADLESS[cliEntry.id] || HEADLESS[cliEntry.name] || null;
}

module.exports = { HEADLESS, getHeadlessDescriptor };
