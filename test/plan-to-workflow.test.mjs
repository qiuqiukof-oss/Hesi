/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Plan → workflow 转换器单测
import test from 'node:test';
import assert from 'node:assert';
import { planToWorkflowTasks, inScope, isForbidden } from '../routes/ai-tools/plan-to-workflow.js';

const plan = () => ({
  objective: '加导出按钮',
  acceptance: [{ id: 'a1', kind: 'command', command: 'npm test' }],
  scope_paths: ['public/chat-panel.js', 'public/css'],
  forbidden: ['rm -rf', 'git push --force'],
  steps: [
    { id: 's1', goal: '注入按钮', action: 'edit chat-panel.js', type: 'exec', on_fail: 'stop' },
    {
      id: 's2',
      goal: '实现逻辑',
      action: 'impl',
      type: 'exec',
      dependsOn: ['s1'],
      verify: { kind: 'command', command: 'npm run lint' },
      checkpoint: true,
      retry: 2,
    },
  ],
});

test('step → task 映射保留 id/label/task', () => {
  const tasks = planToWorkflowTasks(plan());
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[0].id, 's1');
  assert.strictEqual(tasks[0].label, '注入按钮');
  assert.strictEqual(tasks[0].task, 'edit chat-panel.js');
});

test('dependsOn 透传', () => {
  const tasks = planToWorkflowTasks(plan());
  assert.deepStrictEqual(tasks[1].dependsOn, ['s1']);
});

test('verify / checkpoint / retry / on_fail 元数据透传', () => {
  const tasks = planToWorkflowTasks(plan());
  assert.deepStrictEqual(tasks[1].verify, { kind: 'command', command: 'npm run lint' });
  assert.strictEqual(tasks[1].checkpoint, true);
  assert.strictEqual(tasks[1].maxRetries, 2);
  assert.strictEqual(tasks[1].onFailure, 'stop');
});

test('scope_paths 空 → 不限（允许任意）', () => {
  const p = plan();
  p.scope_paths = [];
  assert.strictEqual(inScope(p, 'anything/at/all.js'), true);
});

test('inScope 精确与前缀匹配', () => {
  const p = plan();
  assert.strictEqual(inScope(p, 'public/chat-panel.js'), true);
  assert.strictEqual(inScope(p, 'public/css/chat.css'), true);
  assert.strictEqual(inScope(p, 'routes/server.js'), false);
});

test('isForbidden 命中黑名单', () => {
  const p = plan();
  assert.strictEqual(isForbidden(p, 'rm -rf node_modules'), true);
  assert.strictEqual(isForbidden(p, 'git push --force origin main'), true);
  assert.strictEqual(isForbidden(p, 'npm test'), false);
});
