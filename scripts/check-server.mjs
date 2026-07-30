#!/usr/bin/env node
/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 *
 * check:server — 替代原先 package.json 里硬编码 40+ 文件的 `node --check` 列表。
 * 递归扫描服务端 .js（自动覆盖新增文件），跳过前端/测试/第三方/数据目录。
 * 任一文件语法错误即非零退出，便于 CI / husky 拦截。
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SKIP = new Set([
  'node_modules', '.git', 'data', 'uploads', 'backups',
  'vendor', 'public', 'test', 'plans', '.workbuddy', 'dist', 'build',
]);

let checked = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(p);
    } else if (name.endsWith('.js')) {
      try {
        execFileSync(process.execPath, ['--check', p], { stdio: 'inherit' });
        checked++;
      } catch {
        console.error(`\n✗ syntax error: ${p}`);
        process.exit(1);
      }
    }
  }
}

walk('.');
console.log(`check:server: ${checked} 个 .js 文件语法校验通过`);
