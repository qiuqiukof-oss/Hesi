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
//
// ⚠️ 再次变更（2026-08-04 全局纠错，P0）：
// 实测 PortableGit 2.47.1 的 `git stash create` 报 "fatal: <sha> is not a valid object"
// 且**删除 .git/HEAD、毁掉整个仓库**（Temp 与非 Temp 目录均复现）——高度怀疑是此前
// 主仓库 .git 反复"被工具层破坏"（refs/objects 丢失）的真实根因。
// 弃用 stash create，改为**等价的悬空 commit 手动构造**（临时 GIT_INDEX_FILE +
// read-tree + add -A + write-tree + commit-tree），不碰用户 index/HEAD/refs，
// 语义与 stash create 完全一致（含"工作树干净时返回 null"判断）。
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function git(cwd, args, env = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
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

// 步前快照：非破坏性，产出悬空 commit（不建分支、不碰工作树/HEAD/用户 index）。
// 返回该快照 SHA；若工作树相对 HEAD 无 tracked 改动 → 返回 null（与 stash create 语义一致）。
// scopePaths 参数保留签名兼容（临时 index 方案自动捕获全部工作树状态）。
function snapshotStep(cwd, label, _scopePaths) {
  // 临时 index：.git/index.snap.<pid>.<ts>——用完即删，绝不碰用户 index
  const indexFile = path.join(cwd, '.git', `index.snap.${process.pid}.${Date.now()}`);
  try {
    // 1. 以 HEAD 树为基底（无初始提交时 read-tree 失败 → 降级 null）
    git(cwd, ['read-tree', 'HEAD'], { GIT_INDEX_FILE: indexFile });
    // 2. 只把「已跟踪文件的改动」加入临时 index（-u 而非 -A：未跟踪文件
    //    永不入快照，与 stash create 默认语义一致，杜绝 rollback 触碰未跟踪文件）
    git(cwd, ['add', '-u'], { GIT_INDEX_FILE: indexFile });
    // 3. 写树对象；与 HEAD 树相同 = 无 tracked 改动 → 不产快照（返回 null）
    const tree = git(cwd, ['write-tree'], { GIT_INDEX_FILE: indexFile });
    const headTree = git(cwd, ['rev-parse', 'HEAD^{tree}']);
    if (tree === headTree) return null;
    // 4. 悬空 commit（不更新任何 refs；commit-tree 需要 user.name/email，
    //    无则用仓库已有配置；仍失败则降级为 tree-only）
    const parent = git(cwd, ['rev-parse', 'HEAD']);
    try {
      return git(cwd, ['commit-tree', tree, '-p', parent, '-m', label || 'plan step']);
    } catch {
      return tree; // 无 identity 等：tree 也可用于 rollback（checkout <tree> -- .）
    }
  } catch {
    return null; // 无初始提交或 git 失败 → 无快照，降级
  } finally {
    try { fs.unlinkSync(indexFile); } catch { /* 临时 index 清理尽力而为 */ }
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
