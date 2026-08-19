/**
 * 离线验证 NL→Plan 的「截断感知续写」与既有 repair 路径：
 * 通过 llm-bridge.setLLMCaller 注入假 complete，无需联网/API Key。
 *
 * 覆盖：
 *  1) 首轮被 max_tokens 截断 → 自动续写 → 合并解析成功
 *  2) 首轮返回纯文本（非 JSON、非截断）→ 不走续写，走 repair 修复成功
 *  3) 首轮直接返回合法 JSON → 不触发续写/repair
 *  4) revisePlan 同样具备截断续写能力
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setLLMCaller } from '../lib/memory/llm-bridge.js';
import { generatePlanFromObjective, revisePlan } from '../routes/ai-tools/plan-from-nl.js';

const CONT = '被输出长度限制截断';   // buildContinuePrompt 标记
const REPAIR = '未通过结构校验';      // repairPrompt 标记

/** 截断片段：JSON 未闭合（自带 acceptance，满足 validatePlan，避免误入 repair） */
const TRUNC = '{"objective":"测试截断","approvalPolicy":"marked","acceptance":[{"kind":"command","command":"echo x","expect":"x"}],"steps":[{"id":"s1","goal":"干活"';
/** 续写剩余片段 */
const REM = ',"action":"echo hi"}]}';
/** 合法完整 JSON */
const VALID = '{"objective":"ok","approvalPolicy":"marked","acceptance":[{"kind":"command","command":"echo x","expect":"x"}],"steps":[{"id":"s1","goal":"g","action":"echo"}]}';

function fakeFor(kind) {
  return async (system, user, opts) => {
    if (typeof system === 'string' && system.includes(CONT)) return REM;   // 续写调用
    if (typeof system === 'string' && system.includes(REPAIR)) return VALID; // repair 兜底
    if (kind === 'truncated') return TRUNC;
    if (kind === 'prose') return '这只是纯文本，不是 JSON';
    return VALID; // 'valid'
  };
}

test('截断续写：首轮截断 → 续写合并 → 解析成功', async () => {
  setLLMCaller(fakeFor('truncated'));
  const plan = await generatePlanFromObjective('做点事', {});
  assert.ok(plan, '应返回 plan');
  assert.equal(plan.objective, '测试截断');
  assert.ok(Array.isArray(plan.steps) && plan.steps.length === 1, 'steps 应含 1 项');
  assert.equal(plan.steps[0].action, 'echo hi', '续写合并后 action 应被补全');
});

test('纯文本非截断：走 repair 修复成功（不触发续写）', async () => {
  setLLMCaller(fakeFor('prose'));
  const plan = await generatePlanFromObjective('做点事', {});
  assert.ok(plan, 'repair 后应返回 plan');
  assert.equal(plan.objective, 'ok');
});

test('直接合法 JSON：不触发续写/repair', async () => {
  setLLMCaller(fakeFor('valid'));
  const plan = await generatePlanFromObjective('做点事', {});
  assert.ok(plan);
  assert.equal(plan.objective, 'ok');
});

test('revisePlan 同样具备截断续写能力', async () => {
  setLLMCaller(fakeFor('truncated'));
  const plan = await revisePlan(
    { objective: 'o' },
    { results: [], reflection: '' },
    {}
  );
  assert.ok(plan, 'revisePlan 应返回 plan');
  assert.equal(plan.objective, '测试截断');
  assert.equal(plan.steps[0].action, 'echo hi');
});

// 测试结束后清掉注入，避免影响其它进程（node --test 每文件独立进程，保险起见仍清理）
test('cleanup', async () => {
  setLLMCaller(null);
  assert.ok(true);
});
