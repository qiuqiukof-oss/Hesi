#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// plans/verify-terminal-clean.js
// ------------------------------------------------------------
// Regression: feed a realistic headless-agent TTY capture (OSC 1337 capability
// negotiation, OSC 8 hyperlinks, OSC 99 notifications, ANSI colors, cursor
// moves, screen clears) through createStreamCleaner while splitting the stream
// at EVERY possible byte boundary. The cleaned output must:
//   1. equal the expected plain text, and
//   2. contain no residual ESC byte,
// regardless of where the chunk boundary falls. This is the guarantee that
// prevents TUI protocol noise from leaking into the AI context / chat bubbles.
// ============================================================
'use strict';

const assert = require('node:assert');
const { createStreamCleaner, stripTerminalCodes } = require('../lib/terminal-clean');

const ESC = '\x1b';
const BEL = '\x07';

// A composite that mixes every escape family the cleaner must handle.
const RAW = [
  `${ESC}]1337;ShellIntegrationVersion=12;shell=bash${BEL}`, // OSC 1337 (BEL term)
  `${ESC}[1;32m$ ${ESC}[0m`,                                  // colored prompt
  'opencode run "summarize repo"\n',
  `${ESC}[2J${ESC}[H`,                                        // clear screen + home
  `Result: see ${ESC}]8;;https://example.com/report${BEL}the report${ESC}]8;;${BEL}\n`, // OSC 8 hyperlink
  `${ESC}]99;i=1:d=done${ESC}\\`,                             // OSC 99 notification (ST term)
  `${ESC}[38;5;244mDONE${ESC}[0m\n`,                          // 256-color
].join('');

const EXPECTED = stripTerminalCodes(RAW);

function cleanInChunksOfSize(raw, size) {
  const feed = createStreamCleaner();
  let out = '';
  for (let i = 0; i < raw.length; i += size) {
    out += feed(raw.slice(i, i + size));
  }
  return out;
}

let checks = 0;
// Split at every chunk size from 1 byte up to the whole string. Byte-by-byte
// (size 1) is the harshest case: every escape sequence is fragmented.
for (let size = 1; size <= RAW.length; size++) {
  const out = cleanInChunksOfSize(RAW, size);
  assert.strictEqual(out, EXPECTED, `mismatch at chunk size ${size}: ${JSON.stringify(out)}`);
  assert.ok(!out.includes(ESC), `residual ESC leaked at chunk size ${size}`);
  checks++;
}

// Sanity: the expected text itself is clean and human-readable.
assert.ok(!EXPECTED.includes(ESC));
assert.ok(EXPECTED.includes('opencode run'));
assert.ok(EXPECTED.includes('the report'));

console.log(`terminal-clean: ${checks} chunk-boundary permutations all produced clean output`);
console.log(`  expected plain text (${EXPECTED.length} chars): ${JSON.stringify(EXPECTED.slice(0, 60))}...`);
