/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// 确定性测试运行器（替代 `node --test` 默认发现）。
// - pass1：默认发现（`node --test` 无文件参数），可靠覆盖全部 .js（CommonJS）测试。
// - pass2：显式补跑 .mjs（ESM）测试——已验证 node 默认发现会跳过 .mjs，
//   且「混合 .js+.mjs 大列表」会被 node 静默丢弃 .mjs，故单独调用。
// 两-pass 拆分，跨平台、可复现、不依赖 shell glob、不降覆盖。
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = 'test';
const mjsFiles = readdirSync(dir, { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.test.mjs'))
  .map((f) => join(dir, f));

function run(extraArgs) {
  const res = spawnSync(process.execPath, [
    '--test',
    '--test-timeout=30000',
    ...process.argv.slice(2),
    ...extraArgs,
  ], { stdio: 'inherit' });
  return res.status ?? 1;
}

// pass1: 默认发现（.js 全覆盖）。
const codeJs = run([]);
// pass2: 仅 .mjs（显式）。
const codeMjs = run(mjsFiles);
process.exit(codeJs === 0 && codeMjs === 0 ? 0 : 1);
