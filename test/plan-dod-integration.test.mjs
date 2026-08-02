/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P2 接线测试：Verifier（DoD）与探索型双轨收敛接入 runPlan 主流程。
// - plan.dod 存在 → runAcceptance 后由 Verifier 补判，缺失 → partial
// - plan.mode='exploration' → 不跑验收命令，走 explorationVerdict「下游可决策」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { runPlan } from '../routes/ai-tools/run-plan.js';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hesi-dod-'));
  const g = (a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  g(['init', '-q']);
  g(['config', 'user.email', 't@t']);
  g(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  g(['add', '-A']);
  g(['commit', '-q', '-m', 'init']);
  return dir;
}

test('Verifier 接线：dod 全过 → done；dod 有缺失 → partial', async () => {
  const dir = tmpRepo();
  // dod semantic 项 evidence 指向一个真实存在的文件（seed.txt）→ 通过
  const plan = {
    objective: 'dod 验证',
    acceptance: [{ id: 'a1', kind: 'command', command: 'echo ok', expect: 'ok' }],
    steps: [{ id: 's1', goal: '写文件', action: 'echo hi > out.txt', type: 'command' }],
    dod: [
      { id: 'd1', type: 'functional', check: 'echo ok', expect: 'ok' },
      { id: 'd2', type: 'semantic', question: 'seed 存在?', yes: true, expected: true, evidence: 'seed.txt' },
    ],
    forbidden: [], scope_paths: [],
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
  };
  const ok = await runPlan(plan, { cwd: dir });
  assert.equal(ok.status, 'done', `dod 全过应 done，实际 ${ok.status}: ${ok.reason || ''}`);

  // dod semantic evidence 指向不存在的文件 → 判缺失 → partial
  const plan2 = JSON.parse(JSON.stringify(plan));
  plan2.dod[1].evidence = 'no-such-file.txt';
  const bad = await runPlan(plan2, { cwd: dir });
  assert.equal(bad.status, 'partial', `dod 缺失应 partial，实际 ${bad.status}`);
  assert.ok((bad.reason || '').includes('DoD') || JSON.stringify(bad.steps || []).includes('__dod__') || JSON.stringify(bad).includes('DoD 缺失'),
    `reason 应提到 DoD 缺失，实际: ${bad.reason}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Verifier 接线：quality dod 阈值判定（coverage >= 100 过 / >= 200 缺）', async () => {
  const dir = tmpRepo();
  const base = {
    objective: 'quality dod',
    acceptance: [],
    steps: [{ id: 's1', goal: 'noop', action: 'echo x', type: 'command' }],
    forbidden: [], scope_paths: [],
    budget: { maxRounds: 0, maxTokens: 0, maxMinutes: 0 },
  };
  const ok = await runPlan({
    ...base,
    dod: [{ id: 'q1', type: 'quality', check: 'echo coverage: 100%', pattern: /coverage[:\s]*(\d+(?:\.\d+)?)%/, thresholdExpr: '>= 100' }],
  }, { cwd: dir });
  assert.equal(ok.status, 'done', `quality 达标应 done，实际 ${ok.status}`);
  const bad = await runPlan({
    ...base,
    dod: [{ id: 'q1', type: 'quality', check: 'echo coverage: 100%', pattern: /coverage[:\s]*(\d+(?:\.\d+)?)%/, thresholdExpr: '>= 200' }],
  }, { cwd: dir });
  assert.equal(bad.status, 'partial', `quality 不达标应 partial，实际 ${bad.status}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('探索型接线：mode=exploration 且必需问题答满带来源 → done', async () => {
  const dir = tmpRepo();
  const plan = {
    objective: '探索：技术选型',
    mode: 'exploration',
    questions: [
      { id: 'q1', text: '方案 A 是否满足需求?', required: true },
      { id: 'q2', text: '迁移成本?', required: true },
    ],
    answers: [
      { questionId: 'q1', answer: '满足', source: 'docs/eval.md' },
      { questionId: 'q2', answer: '3 人周', source: 'docs/cost.md' },
    ],
    steps: [{ id: 's1', goal: '调研', action: 'echo done', type: 'command' }],
    forbidden: [], scope_paths: [],
    budget: { maxRounds: 3, maxTokens: 0, maxMinutes: 0 },
  };
  const res = await runPlan(plan, { cwd: dir });
  assert.equal(res.status, 'done', `探索型答满应 done，实际 ${res.status}: ${res.reason || ''}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('探索型接线：必需问题缺答 → partial（附缺答清单）', async () => {
  const dir = tmpRepo();
  const plan = {
    objective: '探索：技术选型',
    mode: 'exploration',
    questions: [
      { id: 'q1', text: '方案 A 是否满足需求?', required: true },
      { id: 'q2', text: '迁移成本?', required: true },
    ],
    answers: [{ questionId: 'q1', answer: '满足', source: 'docs/eval.md' }], // q2 缺
    steps: [{ id: 's1', goal: '调研', action: 'echo done', type: 'command' }],
    forbidden: [], scope_paths: [],
    budget: { maxRounds: 3, maxTokens: 0, maxMinutes: 0 },
  };
  const res = await runPlan(plan, { cwd: dir });
  assert.equal(res.status, 'partial', `探索型缺答应 partial，实际 ${res.status}`);
  assert.ok((res.reason || '').includes('探索型') || JSON.stringify(res).includes('迁移成本'),
    `reason 应含探索型缺答信息: ${res.reason}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
