/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  snapshotStep, rollbackTo, isRepo, listPlanBranches, gcPlanBranches,
} from '../lib/plan-git.js';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-plan-git-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  g(['commit', '-q', '--allow-empty', '-m', 'init']); // 保证有 HEAD，stash create 才可用
  return { dir, g };
}

function head(dir) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}

test('isRepo 正确识别', () => {
  const { dir } = tmpRepo();
  assert.equal(isRepo(dir), true);
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-notrepo-'));
  assert.equal(isRepo(notRepo), false);
  fs.rmSync(notRepo, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('快照(stash create)不切分支且回滚复原被跟踪文件', () => {
  const { dir, g } = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v0');
  g(['add', '-A']);
  g(['commit', '-m', 'init-a']);

  const headBefore = head(dir);
  assert.deepEqual(listPlanBranches(dir), []); // 无 auto 分支

  fs.writeFileSync(path.join(dir, 'a.txt'), 'v1');
  const s1 = snapshotStep(dir, 'step1', ['a.txt']);
  assert.ok(s1 && /^[0-9a-f]{7,}$/.test(s1), '应返回 stash SHA');
  assert.equal(head(dir), headBefore, 'HEAD 不变（未切分支）');
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1'); // 工作树未被快照改动

  fs.writeFileSync(path.join(dir, 'a.txt'), 'v2');
  const s2 = snapshotStep(dir, 'step2', ['a.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v2');

  rollbackTo(dir, s1);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1');

  assert.notEqual(s1, s2);
  assert.deepEqual(listPlanBranches(dir), []); // 全程无 auto 分支
  fs.rmSync(dir, { recursive: true, force: true });
});

test('快照不影响未跟踪文件（根治 P0 数据丢失）', () => {
  const { dir } = tmpRepo();
  fs.writeFileSync(path.join(dir, 'u.txt'), 'secret'); // 新建未跟踪
  const s = snapshotStep(dir, 'snap-untracked');
  assert.equal(s, null, '无 tracked 改动 → 不产快照');
  assert.equal(fs.readFileSync(path.join(dir, 'u.txt'), 'utf8'), 'secret'); // 未跟踪永不被删

  // 被跟踪改动 + 未跟踪共存：回滚只复原被跟踪，未跟踪保留
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v0');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v1');
  fs.writeFileSync(path.join(dir, 'u2.txt'), 'keepme');
  const s2 = snapshotStep(dir, 'snap-mix');
  assert.ok(s2);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v2');
  rollbackTo(dir, s2);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1'); // 被跟踪复原
  assert.equal(fs.readFileSync(path.join(dir, 'u2.txt'), 'utf8'), 'keepme'); // 未跟踪保留
  fs.rmSync(dir, { recursive: true, force: true });
});

test('gcPlanBranches 清理历史 auto 分支', () => {
  const { dir } = tmpRepo();
  execFileSync('git', ['branch', 'auto-abc123'], { cwd: dir });
  execFileSync('git', ['branch', 'auto-def456'], { cwd: dir });
  execFileSync('git', ['branch', 'keep'], { cwd: dir });
  assert.ok(listPlanBranches(dir).includes('auto-abc123'));
  const n = gcPlanBranches(dir);
  assert.equal(n, 2);
  assert.deepEqual(listPlanBranches(dir), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
