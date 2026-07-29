/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unit tests for lib/terminal-clean.js — the TTY escape-sequence scrubber that
// keeps opencode / codex / aider TUI protocol noise out of the AI context and
// chat bubbles. The trickiest guarantee is cross-chunk correctness, so that is
// covered explicitly here.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  stripTerminalCodes,
  isCompleteEscapePrefix,
  createStreamCleaner,
} = require('../lib/terminal-clean');

const ESC = '\x1b';
const BEL = '\x07';

test('stripTerminalCodes: plain text is untouched', () => {
  assert.strictEqual(stripTerminalCodes('hello world'), 'hello world');
  assert.strictEqual(stripTerminalCodes(''), '');
  assert.strictEqual(stripTerminalCodes(null), null);
});

test('stripTerminalCodes: removes CSI color/cursor sequences', () => {
  const input = `${ESC}[31mred${ESC}[0m ${ESC}[2J${ESC}[H done`;
  assert.strictEqual(stripTerminalCodes(input), 'red  done');
});

test('stripTerminalCodes: removes OSC hyperlink (BEL terminated)', () => {
  const input = `${ESC}]8;;https://example.com${BEL}link${ESC}]8;;${BEL}`;
  assert.strictEqual(stripTerminalCodes(input), 'link');
});

test('stripTerminalCodes: removes OSC 1337 capability (ST terminated)', () => {
  const input = `before${ESC}]1337;ShellIntegrationVersion=12${ESC}\\after`;
  assert.strictEqual(stripTerminalCodes(input), 'beforeafter');
});

test('stripTerminalCodes: strips bare/leftover ESC', () => {
  assert.strictEqual(stripTerminalCodes(`a${ESC}b`), 'ab');
});

test('isCompleteEscapePrefix: distinguishes complete vs partial', () => {
  assert.strictEqual(isCompleteEscapePrefix(`${ESC}[31m`), true);       // complete CSI
  assert.strictEqual(isCompleteEscapePrefix(`${ESC}]8;;x${BEL}`), true); // complete OSC
  assert.strictEqual(isCompleteEscapePrefix(`${ESC}[31`), false);       // partial CSI (no final byte)
  assert.strictEqual(isCompleteEscapePrefix(`${ESC}]1337;abc`), false); // partial OSC (no terminator)
  assert.strictEqual(isCompleteEscapePrefix('plain'), false);
});

test('createStreamCleaner: single complete chunk behaves like strip', () => {
  const feed = createStreamCleaner();
  assert.strictEqual(feed(`${ESC}[32mok${ESC}[0m`), 'ok');
});

test('createStreamCleaner: sequence split across chunk boundary is not leaked', () => {
  const feed = createStreamCleaner();
  // A CSI sequence cut in half: "\x1b[3" then "1mred\x1b[0m"
  const out1 = feed(`text${ESC}[3`);
  const out2 = feed(`1mred${ESC}[0m`);
  // The half-sequence must be carried, never emitted as raw "\x1b[3".
  assert.ok(!out1.includes(ESC), `partial escape leaked: ${JSON.stringify(out1)}`);
  assert.strictEqual(out1 + out2, 'textred');
});

test('createStreamCleaner: OSC split across three chunks stays clean', () => {
  const feed = createStreamCleaner();
  const a = feed(`start${ESC}]13`);
  const b = feed('37;Cap=1');
  const c = feed(`${ESC}\\end`);
  const joined = a + b + c;
  assert.strictEqual(joined, 'startend');
  assert.ok(!joined.includes(ESC));
});

test('createStreamCleaner: OSC split exactly at its 2-byte ST terminator does not leak (regression)', () => {
  // Regression for the lastIndexOf blind spot: OSC 99 terminated by ST (\x1b\\).
  // Boundary lands between the ST's ESC and its backslash. A naive cleaner would
  // flush the unterminated OSC opener and leak "]99;i=1:d=done".
  const feed = createStreamCleaner();
  const a = feed(`log ${ESC}]99;i=1:d=done${ESC}`); // ST's ESC arrives, backslash pending
  const b = feed(`\\ next`);                          // ST completes
  const joined = a + b;
  assert.ok(!joined.includes(']99'), `OSC body leaked: ${JSON.stringify(joined)}`);
  assert.ok(!joined.includes(ESC));
  assert.strictEqual(joined, 'log  next');
});

test('createStreamCleaner: byte-by-byte feed of mixed sequences never leaks', () => {
  const raw = `${ESC}[31mA${ESC}[0m${ESC}]8;;u${BEL}B${ESC}]8;;${BEL}${ESC}]1337;X=1${ESC}\\C`;
  const expected = stripTerminalCodes(raw);
  const feed = createStreamCleaner();
  let out = '';
  for (const ch of raw) out += feed(ch);
  assert.strictEqual(out, expected);
  assert.ok(!out.includes(ESC));
});

test('createStreamCleaner: maxCarry safety valve flushes prefix and drops a runaway lone ESC', () => {
  const feed = createStreamCleaner({ maxCarry: 8 });
  // A lone ESC followed by a long run of bytes that never terminates. Once the
  // buffered carry exceeds maxCarry, the cleaner must flush the confirmed prefix
  // and discard the corrupt tail rather than hang forever.
  const out = feed(`keep${ESC}` + 'x'.repeat(50));
  assert.strictEqual(out, 'keep');
  assert.ok(!out.includes(ESC));
});
