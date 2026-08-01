/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Phase 0 — 非破坏性 git 快照 + 回滚（全自动闭环的"爆震半径"控制）。
// 纯 child_process 调 git CLI（机器已有，非 node 外新增依赖）。
//
// ⚠️ 设计变更（P4-1，根治 P0 数据丢失）：
// 旧实现开 auto-<id> 分支 + git add -A + checkout -，会把用户未提交改动从工作树抹除。
// 新实现改用 `git stash create` 产出**悬空 commit**（不建分支、不切 HEAD、不动工作树），
// rollback 用 `git checkout <sha> -- .` 仅复原被跟踪文件，新建的未跟踪文件永不删除。
// 详见 .workbuddy/plan-git-脏工作树数据丢失-方案.md（根因）与 P4-执行方案.md。
'use strict';

const { execFileSync } = require('child_process');

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isRepo(cwd) {
  try {
    git(cwd, ['rev-parse', '--is-inside-work-tree']);
    return true;
  } catch {
    return false;
  }
}

// 步前快照：非破坏性，产出悬空 stash commit（不建分支、不碰工作树/HEAD）。
// 返回该快照 SHA；若工作树干净（无 tracked 改动）则 git stash create 返回空 → 返回 null。
// scopePaths 参数保留签名兼容（stash create 自动捕获工作树状态，无需手动 add）。
function snapshotStep(cwd, label, _scopePaths) {
  try {
    const out = git(cwd, ['stash', 'create', '-m', label || 'plan step']).trim();
    return out || null;
  } catch {
    return null; // 无初始提交或失败 → 无快照，降级
  }
}

// 回滚到指定快照 sha：仅复原被跟踪文件到快照状态；新建的未跟踪文件保留（不删，杜绝数据丢失）。
// 优先 `git checkout <sha> -- .`（普遍支持）；失败回退 `git restore --source=<sha>`。
function rollbackTo(cwd, sha) {
  if (!sha) return;
  try {
    git(cwd, ['checkout', sha, '--', '.']);
  } catch {
    try {
      git(cwd, ['restore', '--source', sha, '--worktree', '--staged', '--', '.']);
    } catch {
      /* 忽略：回滚尽力而为 */
    }
  }
}

// 列出历史 auto-* 分支（旧实现堆积的）
function listPlanBranches(cwd) {
  try {
    const out = git(cwd, ['branch', '--list', 'auto-*']);
    return out.split('\n').map((s) => s.replace(/^[\s*]+/, '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// 一次性清理历史 auto-* 分支（返回清理数量）
function gcPlanBranches(cwd) {
  const branches = listPlanBranches(cwd);
  let removed = 0;
  for (const b of branches) {
    try {
      git(cwd, ['branch', '-D', b]);
      removed += 1;
    } catch {
      /* 忽略无法删除的分支 */
    }
  }
  return removed;
}

module.exports = { isRepo, snapshotStep, rollbackTo, listPlanBranches, gcPlanBranches };
