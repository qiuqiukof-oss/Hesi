/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// 确定性测试运行器（替代 `node --test` 默认发现）。
// - pass1：默认发现（`node --test` 无文件参数）——Node 22 会递归 test/ 找
//   .js 与 .mjs（含 e2e），一处全覆盖。
// - pass2：显式补跑 .mjs——兼容「默认发现跳过 .mjs」的旧 Node 行为；
//   排除 e2e 目录（已由 pass1 覆盖，避免重复执行导致超时）。
// - 两 pass 均 `--test-concurrency=1`（bug 修复 2026-08-04 全局纠错）：
//   默认并发会多文件同时操作共享状态（cli-registry.json / HESI_* 环境变量 /
//   临时 git 仓库 / 4264 服务）→ 单跑全过、全量却随机失败。
// - 注意：不能改成「显式传全部文件列表」——实测一次性传大量 .mjs 会触发
//   Windows STATUS_DLL_INIT_FAILED（0xC0000142）进程崩溃。
import { readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = 'test';
const mjsFiles = readdirSync(dir, { recursive: true })
  .filter((f) => typeof f === 'string' && f.endsWith('.test.mjs') && !f.split(sep).includes('e2e'))
  .map((f) => join(dir, f));

function run(extraArgs) {
  const res = spawnSync(process.execPath, [
    '--test',
    '--test-concurrency=1',
    '--test-timeout=30000',
    ...process.argv.slice(2),
    ...extraArgs,
  ], { stdio: 'inherit' });
  return res.status ?? 1;
}

// pass1: 默认发现（.js + .mjs 全覆盖，含 e2e）。
const codeDefault = run([]);
// pass2: 仅 .mjs（排除 e2e）——兼容旧 Node 的默认发现跳过行为。
const codeMjs = run(mjsFiles);
process.exit(codeDefault === 0 && codeMjs === 0 ? 0 : 1);
