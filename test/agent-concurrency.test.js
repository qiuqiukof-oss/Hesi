/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// 全局 Agent 并发配额信号量（routes/ai-tools/agent-concurrency.js）专属测试。
//
// 背景（见模块头注释）：同步委派路径（builtin/agent.js）与异步 AgentPoolManager
// 原本各维护一套并发计数，文档写"最多 3 个"实际却允许 6 个；且 delegate 超时分支
// 会重复递减导致计数变负、限流永久失效。本测试锁定修复后的契约：
//   1. 单一全局计数，最多 MAX_GLOBAL_AGENTS 个并发 Agent；
//   2. release 幂等——超额释放不把计数减到负数；
//   3. 任意获取/释放交错序列下计数始终 ∈ [0, MAX_GLOBAL_AGENTS]。
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  MAX_GLOBAL_AGENTS,
  tryAcquireAgent,
  releaseAgent,
  getActiveAgentCount,
} = require('../routes/ai-tools/agent-concurrency.js');

// 信号量是模块级单例：每个用例结束把计数恢复到基线，避免污染同进程其它测试。
function restoreBaseline(baseline) {
  let n = getActiveAgentCount();
  while (n > baseline) { releaseAgent(); n = getActiveAgentCount(); }
  while (n < baseline) { tryAcquireAgent(); n = getActiveAgentCount(); }
  return getActiveAgentCount();
}

test('配额：达到 MAX_GLOBAL_AGENTS 上限后拒绝，计数封顶不越界', () => {
  const baseline = getActiveAgentCount();
  let acquired = 0;
  try {
    while (tryAcquireAgent()) acquired++;
    assert.strictEqual(getActiveAgentCount(), MAX_GLOBAL_AGENTS, '计数封顶于 MAX_GLOBAL_AGENTS');
    assert.strictEqual(tryAcquireAgent(), false, '超过上限应被拒绝');
    assert.strictEqual(getActiveAgentCount(), MAX_GLOBAL_AGENTS, '拒绝不改变计数');
  } finally {
    while (acquired > 0) { releaseAgent(); acquired--; }
    restoreBaseline(baseline);
  }
});

test('release 幂等：超额释放不把计数减到负数（旧 bug 回归）', () => {
  const baseline = getActiveAgentCount();
  try {
    assert.strictEqual(tryAcquireAgent(), true, '基线可再获取一个名额');
    releaseAgent();
    releaseAgent();
    releaseAgent(); // 多放 2 次 → 幂等，计数不得为负
    assert.strictEqual(getActiveAgentCount(), baseline, '重复释放后回到基线（不为负）');
  } finally {
    restoreBaseline(baseline);
  }
});

test('配额：获取/释放交错序列下计数单调不越界（同步+异步共用单一计数）', () => {
  const baseline = getActiveAgentCount();
  const peaks = [];
  try {
    let n = getActiveAgentCount();
    for (let i = 0; i < 50; i++) {
      if (tryAcquireAgent()) {
        n = getActiveAgentCount();
        peaks.push(n);
        assert.ok(n <= MAX_GLOBAL_AGENTS, `计数 ${n} 不得超过上限`);
      } else {
        assert.ok(getActiveAgentCount() >= MAX_GLOBAL_AGENTS, '拒绝时计数应已封顶');
      }
      if (i % 3 === 0) {
        releaseAgent();
        n = getActiveAgentCount();
        assert.ok(n >= 0, '计数不得为负');
      }
    }
    assert.ok(peaks.every((p) => p >= 1 && p <= MAX_GLOBAL_AGENTS), '全程计数 ∈ [1, MAX]');
  } finally {
    restoreBaseline(baseline);
  }
});

test('配额：释放后立即可重新获取（名额真正回补）', () => {
  const baseline = getActiveAgentCount();
  let acquired = 0;
  try {
    while (tryAcquireAgent()) acquired++;            // 打满
    assert.strictEqual(tryAcquireAgent(), false);
    releaseAgent();                                  // 释放 1 个
    assert.strictEqual(tryAcquireAgent(), true, '释放后名额回补，可再次获取');
    releaseAgent();
  } finally {
    while (getActiveAgentCount() > baseline) releaseAgent();
    restoreBaseline(baseline);
  }
});
