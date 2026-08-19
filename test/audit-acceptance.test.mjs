/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P0.5 验收审计器单测 — 针对 plans/audit-acceptance.js 的解析逻辑
// 注：audit-acceptance.js 导出非标准（直接 process.exit），
// 本测试通过构造隔离目录来验证解析行为。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const AUDIT_SCRIPT = path.resolve(import.meta.dirname, '..', 'plans', 'audit-acceptance.js');

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-audit-test-'));
  return d;
}

test('验收审计器：全部- [x] → 已落实', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'test-plan.md'),
      '# 测试\n## 验收\n- [x] 项目 A 已完成\n- [x] 项目 B 已完成\n');
    const out = execSync(`node "${AUDIT_SCRIPT}"`, {
      cwd: dir,
      env: { ...process.env, PLAN_AUDIT_DIR: dir },
      encoding: 'utf-8',
    });
    assert.match(out, /已落实\s+2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('验收审计器：混合勾选', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'mixed-plan.md'),
      '# 混合\n## 验收\n- [x] 已完成\n- [ ] 未完成\n- 普通文本项不属于勾选\n');
    const out = execSync(`node "${AUDIT_SCRIPT}"`, {
      cwd: dir,
      env: { ...process.env, PLAN_AUDIT_DIR: dir },
      encoding: 'utf-8',
    });
    assert.match(out, /已落实\s+1/);
    assert.match(out, /未落实\s+1/);
    assert.match(out, /待核\s+1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('验收审计器：✅ 标记识别', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'emoji-plan.md'),
      '# emoji\n## 验收\n- ✅ 通过\n- ✅ 也通过\n- [ ] 未完\n');
    const out = execSync(`node "${AUDIT_SCRIPT}"`, {
      cwd: dir,
      env: { ...process.env, PLAN_AUDIT_DIR: dir },
      encoding: 'utf-8',
    });
    assert.match(out, /已落实\s+2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('验收审计器：排除目录（archive/backup/memory）', () => {
  const dir = tmpDir();
  try {
    const archive = path.join(dir, 'archive');
    const memory = path.join(dir, 'memory');
    fs.mkdirSync(archive, { recursive: true });
    fs.mkdirSync(memory, { recursive: true });
    fs.writeFileSync(path.join(archive, 'old-plan.md'),
      '# 旧\n## 验收\n- [x] 旧项目\n');
    fs.writeFileSync(path.join(memory, 'log.md'),
      '# 记忆\n## 验收\n- [x] 不应计入\n');
    fs.writeFileSync(path.join(dir, 'current-plan.md'),
      '# 当前\n## 验收\n- [x] 当前项目\n');
    const out = execSync(`node "${AUDIT_SCRIPT}"`, {
      cwd: dir,
      env: { ...process.env, PLAN_AUDIT_DIR: dir },
      encoding: 'utf-8',
    });
    assert.match(out, /已落实\s+1/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('验收审计器：--strict 模式有未落实项时 exit 1', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'todo-plan.md'),
      '# todo\n## 验收\n- [ ] 待完成\n- [x] 已完成\n');
    try {
      execSync(`node "${AUDIT_SCRIPT}" --strict`, {
        cwd: dir,
        env: { ...process.env, PLAN_AUDIT_DIR: dir },
        encoding: 'utf-8',
        timeout: 5000,
      });
      assert.fail('应 exit 1');
    } catch (e) {
      assert.equal(e.status, 1);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('验收审计器：无验收章节的 plan → 无条目', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'no-acceptance.md'),
      '# 无验收\n## 设计\n随便写点\n');
    const out = execSync(`node "${AUDIT_SCRIPT}"`, {
      cwd: dir,
      env: { ...process.env, PLAN_AUDIT_DIR: dir },
      encoding: 'utf-8',
    });
    assert.match(out, /未发现含标准.*验收.*区块/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
