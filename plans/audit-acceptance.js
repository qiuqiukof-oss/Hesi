#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
// @ts-check
// ============================================================
// plans/audit-acceptance.js — plan 验收清单对账器
// ------------------------------------------------------------
// 遍历 .workbuddy/**\/*.md（排除 archive/backup/memory/skills/个人 等），
// 解析每个 plan 文档里「验收」区块的勾选清单，输出「已落实 / 未落实」表，
// 实现"定期对照 plan 看修改是否落实"机械化（P0.5）。
//
//   node plans/audit-acceptance.js            # 输出对账表
//   node plans/audit-acceptance.js --strict   # 存在未落实项时 exit 1
//
// 退出码：默认 0（纯信息）；--strict 且有未落实项时 1。
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.PLAN_AUDIT_DIR || path.resolve(__dirname, '..');
const WORKBUDDY = process.env.PLAN_AUDIT_DIR || path.join(path.resolve(__dirname, '..'), '.workbuddy');

// 排除目录（不计入对账）
const EXCLUDE_DIRS = new Set([
  'archive', 'backup', 'memory', 'memory-backup', 'skills', '个人',
  'node_modules', '.git',
]);

// 验收区块标题关键字
const ACCEPTANCE_HEADING = /验收/;

// 清单项正则（仅认勾选标记，避免把含「已落实/未落实」字样的描述句误判）
const CHECK_DONE = /^\s*[-*]\s*\[[xX]\]/;        // - [x] / - [X]
const CHECK_TODO = /^\s*[-*]\s*\[ \]/;           // - [ ]
const DONE_MARK = /[✅✔☑]/;                       // 直接打勾符号

/**
 * 递归收集 .workbuddy 下所有 .md（排除指定目录）
 * @returns {string[]}
 */
function collectPlanDocs() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith('.md')) {
        out.push(path.join(dir, e.name));
      }
    }
  }
  if (fs.existsSync(WORKBUDDY)) walk(WORKBUDDY);
  return out.sort();
}

/**
 * 解析单个文档的验收清单
 * @param {string} file
 * @returns {{ done: string[], todo: string[], unchecked: string[] }}
 */
function parseAcceptance(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const done = [];
  const todo = [];
  const unchecked = [];
  let inAcceptance = false;
  for (const line of lines) {
    // 标题行：# 或 ## 开头
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      inAcceptance = ACCEPTANCE_HEADING.test(heading[1]);
      continue;
    }
    if (!inAcceptance) continue;
    if (line.startsWith('>')) continue; // 跳过 blockquote（非清单项）
    const item = line.replace(/^\s*[-*]\s*/, '').replace(/^\s*\d+\.\s*/, '').trim();
    if (!item) continue;
    if (CHECK_DONE.test(line) || (DONE_MARK.test(line) && !CHECK_TODO.test(line))) {
      done.push(item);
    } else if (CHECK_TODO.test(line)) {
      todo.push(item);
    } else if (DONE_MARK.test(line)) {
      done.push(item);
    } else {
      // 验收区块内、但无明显勾选标记的条目 → 待核
      unchecked.push(item);
    }
  }
  return { done, todo, unchecked };
}

function main() {
  const strict = process.argv.includes('--strict');
  const docs = collectPlanDocs();
  const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

  console.log('========================================');
  console.log(' Hesi Plan 验收清单对账 (P0.5)');
  console.log('========================================');
  console.log('扫描目录: .workbuddy/ (排除 archive/backup/memory/skills/个人)');
  console.log('');

  let totalDone = 0;
  let totalTodo = 0;
  let totalUnchecked = 0;
  let filesWithPlan = 0;
  const noChecklist = [];

  for (const f of docs) {
    const { done, todo, unchecked } = parseAcceptance(f);
    if (done.length === 0 && todo.length === 0 && unchecked.length === 0) continue;
    filesWithPlan++;
    totalDone += done.length;
    totalTodo += todo.length;
    totalUnchecked += unchecked.length;
    const tag = todo.length > 0 ? '[有未落实]' : '[全部落实]';
    console.log(`■ ${rel(f)}  ${tag}  已落实 ${done.length} / 未落实 ${todo.length} / 待核 ${unchecked.length}`);
    for (const t of todo) console.log(`    ✗ 未落实: ${t.slice(0, 80)}`);
    for (const u of unchecked) console.log(`    ? 待核:   ${u.slice(0, 80)}`);
    console.log('');
  }

  if (filesWithPlan === 0) {
    console.log('（未发现含标准「验收」区块的 plan 文档）');
    console.log('提示：在 plan 文档加「## 验收」标题，其下用 - [ ] / - [x] 列出清单即可被对账。');
  } else {
    noChecklist.length = 0;
    console.log('----------------------------------------');
    console.log(`汇总：扫描 ${docs.length} 个文档，含验收清单 ${filesWithPlan} 个`);
    console.log(`      已落实 ${totalDone} / 未落实 ${totalTodo} / 待核 ${totalUnchecked}`);
    if (totalTodo > 0) {
      console.log(`⚠ 存在 ${totalTodo} 项未落实（如需 CI 阻断请加 --strict）`);
    } else {
      console.log('✓ 所有已登记验收项均标记落实');
    }
  }

  if (strict && totalTodo > 0) process.exit(1);
  process.exit(0);
}

main();
