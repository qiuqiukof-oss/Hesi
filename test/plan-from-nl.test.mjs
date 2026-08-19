/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setLLMCaller } from '../lib/memory/llm-bridge.js';
import { generatePlanFromObjective, extractJson, applyDefaults, revisePlan } from '../routes/ai-tools/plan-from-nl.js';

const VALID = JSON.stringify({
  objective: '测试目标',
  acceptance: [{ kind: 'command', command: 'true' }],
  steps: [{ id: 's1', goal: '目标', action: '动作' }],
});

test('extractJson: 剥离 ```json 围栏与前后文字', () => {
  const t = '好的，这是 plan：\n```json\n' + VALID + '\n```\n谢谢';
  const o = extractJson(t);
  assert.equal(o.objective, '测试目标');
  assert.equal(o.steps[0].id, 's1');
});

test('extractJson: 非 JSON 返回 null', () => {
  assert.equal(extractJson('没有 json 这里'), null);
  assert.equal(extractJson(''), null);
});

test('applyDefaults: 补全 budget / step.id / objective', () => {
  const o = applyDefaults({
    objective: '',
    acceptance: [{ kind: 'manual' }],
    steps: [{ goal: 'g', action: 'a' }, { goal: 'g2', action: 'a2' }],
  }, '我的目标');
  assert.equal(o.objective, '我的目标');
  assert.equal(o.steps[0].id, 's1');
  assert.equal(o.steps[1].id, 's2');
  assert.ok(o.budget.maxRounds > 0);
  assert.equal(o.acceptance[0].kind, 'manual');
});

test('generatePlanFromObjective: 自然语言 → 通过校验的 plan', async () => {
  setLLMCaller(async () => '```json\n' + VALID + '\n```');
  try {
    const plan = await generatePlanFromObjective('把 README 加上徽章', { apiKey: 'x' });
    assert.equal(plan.objective, '测试目标');
    assert.equal(plan.steps[0].id, 's1');
    assert.ok(plan.budget.maxRounds > 0);
  } finally {
    setLLMCaller(null);
  }
});

test('generatePlanFromObjective: 模型不可用（返回 null）→ 抛 GEN_FAILED', async () => {
  setLLMCaller(async () => null);
  try {
    await assert.rejects(
      () => generatePlanFromObjective('目标', { apiKey: 'x' }),
      /无法从自然语言生成/,
    );
  } finally {
    setLLMCaller(null);
  }
});

test('generatePlanFromObjective: 首次校验失败 → 修复重试成功', async () => {
  let calls = 0;
  setLLMCaller(async () => {
    calls += 1;
    if (calls === 1) return JSON.stringify({ objective: '', acceptance: [], steps: [] }); // 无效
    return VALID;
  });
  try {
    const plan = await generatePlanFromObjective('目标', { apiKey: 'x' });
    assert.equal(calls, 2);
    assert.equal(plan.steps.length, 1);
  } finally {
    setLLMCaller(null);
  }
});

test('generatePlanFromObjective: 修复后仍无效 → 抛 GEN_INVALID 带 errors', async () => {
  setLLMCaller(async () => JSON.stringify({ objective: '', acceptance: [], steps: [] }));
  try {
    await assert.rejects(
      () => generatePlanFromObjective('目标', { apiKey: 'x' }),
      /未通过校验/,
    );
  } finally {
    setLLMCaller(null);
  }
});

// ── revisePlan（② 反思重规划环复用） ──

test('revisePlan: 模型返回有效修订 → 产出通过校验的 plan', async () => {
  setLLMCaller(async () => '```json\n' + VALID + '\n```');
  try {
    const prevPlan = {
      objective: '原目标',
      acceptance: [{ id: 'a1', kind: 'command', command: 'true' }],
      steps: [{ id: 's1', goal: 'g', action: 'a' }],
    };
    const prevResult = { status: 'diverged', steps: [{ id: 's1', status: 'failed', reason: 'x' }], reflection: { status: 'diverged' } };
    const plan = await revisePlan(prevPlan, prevResult, { apiKey: 'x' });
    assert.equal(plan.objective, '测试目标');
    assert.equal(plan.steps[0].id, 's1');
    assert.ok(plan.budget.maxRounds > 0);
  } finally {
    setLLMCaller(null);
  }
});

test('revisePlan: 模型不可用（返回 null）→ 返回 null（交给调用方终止重规划）', async () => {
  setLLMCaller(async () => null);
  try {
    const plan = await revisePlan({ objective: 'o', steps: [] }, { steps: [] }, { apiKey: 'x' });
    assert.equal(plan, null);
  } finally {
    setLLMCaller(null);
  }
});
