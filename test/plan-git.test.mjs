// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openPlanBranch, snapshotStep, rollbackTo, closeBranch, isRepo } from '../lib/plan-git.js';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-plan-git-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  return { dir, g };
}

function head(dir) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
}

function countCommits(dir) {
  return Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim());
}

test('isRepo 正确识别', () => {
  const { dir } = tmpRepo();
  assert.equal(isRepo(dir), true);
  const notRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-notrepo-'));
  assert.equal(isRepo(notRepo), false);
  fs.rmSync(notRepo, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('开分支 + 逐步快照 + 回滚', () => {
  const { dir, g } = tmpRepo();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v0');
  g(['add', '-A']);
  g(['commit', '-m', 'init']);

  const branch = openPlanBranch(dir);
  assert.match(branch, /^auto-/);
  assert.equal(g(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), branch);

  // step 1
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v1');
  const s1 = snapshotStep(dir, 'step1', ['a.txt']);
  assert.equal(countCommits(dir), 2); // init + step1
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1');

  // step 2
  fs.writeFileSync(path.join(dir, 'a.txt'), 'v2');
  const s2 = snapshotStep(dir, 'step2', ['a.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v2');

  // 回滚到 step1
  rollbackTo(dir, s1);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'v1');
  assert.equal(head(dir), s1);

  assert.notEqual(s1, s2);

  closeBranch(dir);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('无 scopePaths 时 fallback git add -A', () => {
  const { dir } = tmpRepo();
  execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  openPlanBranch(dir);
  fs.writeFileSync(path.join(dir, 'b.txt'), 'hi');
  const s = snapshotStep(dir, 'step-no-scope');
  assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'hi');
  assert.ok(s);
  fs.rmSync(dir, { recursive: true, force: true });
});
