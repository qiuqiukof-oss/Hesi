/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// Tests for headless CLI descriptors (Phase 2.2 — aider/claude/codex completion).
//
// The critical invariant: every headless descriptor feeds the prompt via stdin,
// NOT argv. On Windows the headless spawn uses shell:true, which re-tokenizes
// argv — an argv-embedded prompt containing spaces/newlines/quotes would be
// mangled or (worse) shell-injected. So no descriptor may embed the prompt in
// its argv.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { HEADLESS, getHeadlessDescriptor } = require('../lib/cli-headless');

/** Reproduce the argv/stdin resolution logic from ws/pty.js createHeadlessExec. */
function resolve(desc, prompt) {
  const useStdin = !!desc.useStdin;
  const args = desc.args ? desc.args(prompt) : (desc.subcommand ? [desc.subcommand] : []);
  return { useStdin, args };
}

const NASTY_PROMPT = 'summarize repo\nand "quote" $(rm -rf /) `whoami`';

test('getHeadlessDescriptor: resolves by id and by name, null otherwise', () => {
  assert.ok(getHeadlessDescriptor({ id: 'opencode' }));
  assert.ok(getHeadlessDescriptor({ name: 'claude' }));
  assert.strictEqual(getHeadlessDescriptor({ id: 'unknown-cli' }), null);
  assert.strictEqual(getHeadlessDescriptor(null), null);
});

test('every headless descriptor uses stdin and never embeds the prompt in argv', () => {
  for (const [id, desc] of Object.entries(HEADLESS)) {
    const { useStdin, args } = resolve(desc, NASTY_PROMPT);
    assert.strictEqual(useStdin, true, `${id} must feed prompt via stdin`);
    for (const a of args) {
      assert.strictEqual(typeof a, 'string', `${id} argv must be strings`);
      assert.ok(
        !a.includes(NASTY_PROMPT) && !a.includes('rm -rf') && !a.includes('\n'),
        `${id} argv must not embed the prompt (got ${JSON.stringify(a)})`,
      );
    }
  }
});

test('claude uses print mode (-p)', () => {
  const { args } = resolve(getHeadlessDescriptor({ id: 'claude' }), 'hi');
  assert.deepStrictEqual(args, ['-p']);
});

test('codex uses exec with the stdin sentinel (-)', () => {
  const { args } = resolve(getHeadlessDescriptor({ id: 'codex' }), 'hi');
  assert.deepStrictEqual(args, ['exec', '-']);
});

test('aider runs non-interactively without surprise commits or TUI chrome', () => {
  const { args } = resolve(getHeadlessDescriptor({ id: 'aider' }), 'hi');
  assert.ok(args.includes('--yes-always'));
  assert.ok(args.includes('--no-auto-commits'));
  assert.ok(args.includes('--no-pretty'));
});

test('opencode keeps its run subcommand + stdin form', () => {
  const desc = getHeadlessDescriptor({ id: 'opencode' });
  const { useStdin, args } = resolve(desc, 'hi');
  assert.strictEqual(useStdin, true);
  assert.deepStrictEqual(args, ['run']);
});
