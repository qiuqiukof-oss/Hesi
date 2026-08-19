/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P0-a — 工具轮硬上限提示消息不得硬编码「50轮」，须引用动态变量 MAX_TOOL_ROUNDS。
// 源文件守卫：防止未来再把轮次写死（本地模型用户常调小 HESI_LLM_MAX_TOOL_ROUNDS）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TARGETS = [
  'routes/chat/stream-openai.js',
  'routes/chat/stream-anthropic.js',
];

for (const rel of TARGETS) {
  test(`no hardcoded (50轮) in ${rel}`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    // 仅检查非注释代码行：注释里的历史说明（如「修复前的误报」）允许保留 (50轮)。
    const code = src
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*');
      })
      .join('\n');
    assert.ok(!code.includes('(50轮)'), 'hardcoded 50-round message must be removed from code');
    assert.ok(
      code.includes('${MAX_TOOL_ROUNDS}'),
      'message must reference the dynamic MAX_TOOL_ROUNDS variable',
    );
  });
}
