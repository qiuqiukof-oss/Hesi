/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// M3 / M4 提示词注入单测：
// - generatePlanFromObjective：opts.discussionContext 注入「多角色讨论结论」块
// - revisePlan：第 4 参 failureContext 注入「上次执行失败详情」块
// 通过打补丁 llm-bridge.complete 捕获 userMsg 验证（不真正调用 LLM）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// 在 require plan-from-nl 之前打补丁：捕获 complete 的 userMsg 并返回最小合法 Plan/修订
const llmBridge = require('../lib/memory/llm-bridge');
let lastUserMsg = null;
let lastSystem = null;
const MIN_PLAN = JSON.stringify({ objective: 'o', steps: [{ id: 's1', goal: 'g', action: 'a' }], acceptance: [] });
llmBridge.complete = async (sys, userMsg, opts) => {
  lastSystem = sys;
  lastUserMsg = userMsg;
  return MIN_PLAN;
};

const { generatePlanFromObjective, revisePlan } = require('../routes/ai-tools/plan-from-nl.js');

test('generatePlanFromObjective：注入 discussionContext 到 userMsg', async () => {
  lastUserMsg = null;
  await generatePlanFromObjective('写个 README', {}, { discussionContext: '角色A：先列大纲。角色B：补示例。' });
  assert.ok(lastUserMsg.includes('多角色讨论结论'), '应注入讨论结论块');
  assert.ok(lastUserMsg.includes('角色A：先列大纲'), '应包含讨论内容');
  assert.ok(lastUserMsg.includes('写个 README'), '应包含原始目标');
});

test('generatePlanFromObjective：无 discussionContext 不注入多余块', async () => {
  lastUserMsg = null;
  await generatePlanFromObjective('写个 README', {});
  assert.ok(!lastUserMsg.includes('多角色讨论结论'));
});

test('revisePlan：注入 failureContext 到 userMsg', async () => {
  lastUserMsg = null;
  const prevPlan = { objective: 'o', steps: [{ id: 's1', goal: 'g', action: 'a' }] };
  const prevResult = { status: 'partial', steps: [{ id: 's1', status: 'error', output: 'boom' }] };
  await revisePlan(prevPlan, prevResult, {}, '步骤 s1 执行失败：boom');
  assert.ok(lastUserMsg.includes('上次执行失败详情'), '应注入失败详情块');
  assert.ok(lastUserMsg.includes('步骤 s1 执行失败：boom'));
});

test('revisePlan：无 failureContext 不注入失败块', async () => {
  lastUserMsg = null;
  const prevPlan = { objective: 'o', steps: [{ id: 's1', goal: 'g', action: 'a' }] };
  await revisePlan(prevPlan, { status: 'partial', steps: [] }, {});
  assert.ok(!lastUserMsg.includes('上次执行失败详情'));
});
