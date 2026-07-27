// @ts-check
// S4/S5 集成测试：workflow 步骤边界黑板同步 + 失败转岗重试 + 并行隔离
// mock agentPool（monkey-patch 单例方法），不真启动 CLI Agent。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { agentPool } = require('../routes/ai-tools/agent-pool');
const { WorkflowManager } = require('../routes/ai-tools/workflow-manager');
const blackboard = require('../lib/blackboard');

// 保存原方法，测试后还原
const origStart = agentPool.start;
const origPoll = agentPool.poll;

let dir;
let seq = 0;
function nextId() {
  return `wfbb_${process.pid}_${Date.now()}_${++seq}`;
}

test.beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-bb-test-'));
  process.env.HESI_BLACKBOARD_DIR = dir;
});

test.afterEach(() => {
  agentPool.start = origStart;
  agentPool.poll = origPoll;
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.HESI_BLACKBOARD_DIR;
});

/** 轮询 workflow 状态直到结束 */
async function waitWorkflow(mgr, workflowId, timeoutMs = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const st = JSON.parse(await mgr.status(workflowId));
    if (st.ok && st.status !== 'running') return st;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error('workflow 未在超时内结束');
}

/** 轮询黑板直到条件满足（黑板 patch 是 fire-and-forget，需等落盘） */
async function waitBoard(projectId, predicate, timeoutMs = 3000) {
  const t0 = Date.now();
  let board = null;
  while (Date.now() - t0 < timeoutMs) {
    board = blackboard.read(projectId);
    if (board && predicate(board)) return board;
    await new Promise(r => setTimeout(r, 20));
  }
  throw new Error(`黑板条件未满足: ${JSON.stringify(board)}`);
}

function boardTask(board, id) {
  return (board.tasks || []).find(t => t.id === id);
}

test('① 并行两任务：start/done 节点同步黑板，files 各自 done、互不覆盖', async () => {
  const projectId = nextId();
  let sessionSeq = 0;
  agentPool.start = async () => JSON.stringify({ ok: true, sessionId: `s${++sessionSeq}` });
  agentPool.poll = async () => JSON.stringify({ ok: true, status: 'done', output: 'output-ok' });

  const mgr = new WorkflowManager({ pollInterval: 10, startRetryDelay: 5 });
  try {
    const res = JSON.parse(await mgr.start('圆桌并行', [
      { id: 't1', agentId: 'opencode', task: '改 a.js', files: ['a.js'] },
      { id: 't2', agentId: 'codex', task: '改 b.js', files: ['b.js'] },
    ], { projectId }));
    assert.strictEqual(res.ok, true);

    const st = await waitWorkflow(mgr, res.workflowId);
    assert.strictEqual(st.status, 'completed');

    const board = await waitBoard(projectId, b =>
      boardTask(b, 't1')?.status === 'done' && boardTask(b, 't2')?.status === 'done' &&
      b.files?.['a.js']?.status === 'done' && b.files?.['b.js']?.status === 'done'
    );
    // 隔离性：两任务各自的键都在，没有互相覆盖
    assert.strictEqual(boardTask(board, 't1').assignee, 'opencode');
    assert.strictEqual(boardTask(board, 't2').assignee, 'codex');
    assert.ok(board.files['a.js'].hash, 'a.js 应有产出哈希');
    assert.ok(board.files['b.js'].hash, 'b.js 应有产出哈希');
    assert.ok(board.logs.some(l => /t1 开始/.test(l.msg)));
    assert.ok(board.logs.some(l => /t2 完成/.test(l.msg)));
  } finally {
    mgr.destroy();
  }
});

test('② 失败转岗重试：coder 首败 → debugger 重试成功，黑板 retrying→done', async () => {
  const projectId = nextId();
  let attempt = 0;
  const rolesSeen = [];
  agentPool.start = async (agentId, prompt, context, broadcastFn, role) => {
    attempt++;
    rolesSeen.push(role);
    return JSON.stringify({ ok: true, sessionId: `s${attempt}` });
  };
  agentPool.poll = async (sessionId) => {
    if (sessionId === 's1') return JSON.stringify({ ok: true, status: 'error', error: '测试失败' });
    return JSON.stringify({ ok: true, status: 'done', output: 'fixed' });
  };

  const mgr = new WorkflowManager({ pollInterval: 10, startRetryDelay: 5 });
  try {
    const res = JSON.parse(await mgr.start('转岗重试', [
      { id: 't1', agentId: 'opencode', task: '实现功能', role: 'coder', maxRetries: 1, files: ['a.js'] },
    ], { projectId }));
    assert.strictEqual(res.ok, true);

    const st = await waitWorkflow(mgr, res.workflowId);
    assert.strictEqual(st.status, 'completed');
    assert.strictEqual(st.tasks[0].role, 'debugger', '重试后角色应转岗为 debugger');
    assert.deepStrictEqual(rolesSeen, ['coder', 'debugger'], '两次启动角色应为 coder→debugger');

    const board = await waitBoard(projectId, b => boardTask(b, 't1')?.status === 'done');
    assert.ok(board.logs.some(l => /转岗重试/.test(l.msg)), '日志应含转岗重试');
    assert.strictEqual(board.roles.opencode, 'debugger');
    assert.strictEqual(board.files['a.js'].status, 'done');
  } finally {
    mgr.destroy();
  }
});

test('③ 隔离恢复：一任务彻底失败（continue），另一并行任务不受影响', async () => {
  const projectId = nextId();
  let sessionSeq = 0;
  const sessionAgent = new Map();
  agentPool.start = async (agentId) => {
    const sid = `s${++sessionSeq}`;
    sessionAgent.set(sid, agentId);
    return JSON.stringify({ ok: true, sessionId: sid });
  };
  agentPool.poll = async (sessionId) => {
    if (sessionAgent.get(sessionId) === 'bad-agent') {
      return JSON.stringify({ ok: true, status: 'error', error: '一直失败' });
    }
    return JSON.stringify({ ok: true, status: 'done', output: 'ok' });
  };

  const mgr = new WorkflowManager({ pollInterval: 10, startRetryDelay: 5 });
  try {
    const res = JSON.parse(await mgr.start('隔离恢复', [
      { id: 'bad', agentId: 'bad-agent', task: '注定失败', onFailure: 'continue', files: ['x.js'] },
      { id: 'good', agentId: 'codex', task: '正常完成', files: ['y.js'] },
    ], { projectId }));
    assert.strictEqual(res.ok, true);

    const st = await waitWorkflow(mgr, res.workflowId);
    assert.strictEqual(st.status, 'completed_with_errors');

    const board = await waitBoard(projectId, b =>
      boardTask(b, 'bad')?.status === 'failed' && boardTask(b, 'good')?.status === 'done'
    );
    assert.strictEqual(board.files['x.js'].status, 'failed');
    assert.strictEqual(board.files['y.js'].status, 'done', 'good 任务不受 bad 失败影响');
    assert.ok(boardTask(board, 'bad').lastError, '失败任务应记录 lastError');
  } finally {
    mgr.destroy();
  }
});

test('④ 无角色任务失败重试：不转岗（零行为变化）', async () => {
  const projectId = nextId();
  let attempt = 0;
  const rolesSeen = [];
  agentPool.start = async (agentId, prompt, context, broadcastFn, role) => {
    attempt++;
    rolesSeen.push(role);
    return JSON.stringify({ ok: true, sessionId: `s${attempt}` });
  };
  agentPool.poll = async (sessionId) => {
    if (sessionId === 's1') return JSON.stringify({ ok: true, status: 'error', error: '临时失败' });
    return JSON.stringify({ ok: true, status: 'done', output: 'ok' });
  };

  const mgr = new WorkflowManager({ pollInterval: 10, startRetryDelay: 5 });
  try {
    const res = JSON.parse(await mgr.start('无角色重试', [
      { id: 't1', agentId: 'opencode', task: '普通任务', maxRetries: 1 },
    ], { projectId }));
    const st = await waitWorkflow(mgr, res.workflowId);
    assert.strictEqual(st.status, 'completed');
    assert.deepStrictEqual(rolesSeen, [null, null], '无角色任务不应被注入角色');
  } finally {
    mgr.destroy();
  }
});
