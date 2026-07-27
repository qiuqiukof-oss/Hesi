// @ts-check
// P1 S3 — max_tokens 不得再硬编码 32768，须按模型窗口动态派生。
// 源文件守卫：锁定「写死 32768」不再回归（本地小模型因此被 length 截断）。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const TARGETS = [
  'routes/chat/stream-openai.js',
  'routes/chat/stream-anthropic.js',
  'routes/chat/index.js',
];

for (const rel of TARGETS) {
  test(`no hardcoded max_tokens:32768 in ${rel}`, () => {
    const src = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.ok(!src.includes('max_tokens: 32768'), 'hardcoded max_tokens 32768 removed');
    assert.ok(
      src.includes("require('../../lib/context-window')"),
      'imports ContextWindowManager module',
    );
    assert.ok(
      src.includes('cwManager.maxOutputTokens(modelName)'),
      'uses dynamic maxOutputTokens(modelName)',
    );
  });
}
