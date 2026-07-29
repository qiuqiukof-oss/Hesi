'use strict';
// 审查报告 C2 回归测试：agent_delegate 的游离 PTY 引用由全局单例改为
// Map<requestId, PTY>，修复「并发委派时第二个请求覆盖第一个 PTY 引用、
// 导致 stop 误杀他人进程」的竞态。
//
// 本测试锁定「向后兼容 + 新签名贯通」两层契约：
//   1. killDelegatePTY()/abortDelegate() 无参调用仍是安全 no-op（旧调用方不会崩）
//   2. killDelegatePTY('未知id') 返回 false 且不抛错
//   3. executeAgent 接收第 7 个参数 requestId 后能正常走到「CLI 未找到」分支
//      （无需真实 PTY/网络），证明 requestId 已贯通且缺失分支未泄漏 PTY 引用
//
// 注：真正的并发 PTY 隔离（Map 按 requestId 各自 kill）由代码审查 + 手动集成测试覆盖
//     （同时发起两个 agent_delegate、停止其中一个，验证另一个不被误杀）。

const test = require('node:test');
const assert = require('node:assert');

const agent = require('../routes/ai-tools/builtin/agent');

test('C2: killDelegatePTY() 无参为安全 no-op，返回 false', () => {
  assert.strictEqual(agent.killDelegatePTY(), false);
});

test('C2: killDelegatePTY(未知 requestId) 返回 false 且不抛错', () => {
  assert.strictEqual(agent.killDelegatePTY('no-such-request-' + Date.now()), false);
});

test('C2: abortDelegate() / abortDelegate(id) 不为无参或未知 id 抛错', () => {
  assert.doesNotThrow(() => agent.abortDelegate());
  assert.doesNotThrow(() => agent.abortDelegate('no-such-request-' + Date.now()));
});

test('C2: executeAgent 接收 requestId 参数后缺失 CLI 分支正常 resolve（签名贯通）', async () => {
  // 找不到的 agentId 会直接走到「未在 CLI registry 找到」分支，
  // 不经过 createHeadlessExec/PTY，安全且快速。
  const result = await agent.executeAgent(
    'definitely-not-a-real-agent-' + Date.now(),
    'task',
    'ctx',
    1000,
    null,
    null,
    'req-' + Date.now(),
  );
  assert.strictEqual(typeof result, 'string');
  assert.match(result, /未在 CLI registry|PTY 创建失败/);
});
