// @ts-check
// Phase 0 — git 分支快照 + 回滚（全自动闭环的"爆震半径"控制）。
// 纯 child_process 调 git CLI（机器已有，非 node 外新增依赖）。
// 每个 plan run 开 auto-<id> 分支；每步执行前 snapshot（commit），失败可 rollback 到上快照。
// 注：分支名用连字符而非斜杠（auto-<id>），因部分 git 环境对 auto/<id> 静默失败。
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

function shortId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 开 auto/<id> 分支，返回分支名。cwd 必须已是 git 仓库。
function openPlanBranch(cwd) {
  if (!isRepo(cwd)) throw new Error('cwd 不是 git 仓库，无法开 plan 分支');
  const id = shortId();
  const branch = `auto-${id}`;
  git(cwd, ['checkout', '-b', branch]);
  return branch;
}

// 每步执行前调用：把当前工作树快照为一个 commit（锚点）。
// scopePaths 限定 add 范围（推荐，控制爆震半径）；为空则 fallback `git add -A`。
// 返回该快照的 commit sha。即使无变更也产生锚点（--allow-empty）。
function snapshotStep(cwd, label, scopePaths) {
  const files = Array.isArray(scopePaths) && scopePaths.length ? scopePaths : [];
  try {
    if (files.length) git(cwd, ['add', '--', ...files]);
    else git(cwd, ['add', '-A']);
  } catch {
    /* 无文件可加，忽略 */
  }
  try {
    git(cwd, ['commit', '--allow-empty', '-m', label || 'plan step']);
  } catch {
    /* 提交失败（极少见），忽略 */
  }
  return git(cwd, ['rev-parse', 'HEAD']);
}

// 回滚到指定快照 sha（reset --hard）。
function rollbackTo(cwd, sha) {
  if (!sha) return;
  git(cwd, ['reset', '--hard', sha]);
}

// 闭环结束：切回原分支（保留 auto 分支供审查，不删）。
function closeBranch(cwd) {
  try {
    git(cwd, ['checkout', '-']);
  } catch {
    /* 已在目标分支或无法切回，忽略 */
  }
}

module.exports = { isRepo, openPlanBranch, snapshotStep, rollbackTo, closeBranch };
