/**
 * P2-8：HTTP 集成测试 — Plan 审批 + 历史 + 断点 全链路
 * 运行方式：node --test test/integration-plan.test.mjs
 * 前置条件：Hesi 服务运行在 127.0.0.1:4264
 */
import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

const BASE = process.env.HESI_TEST_BASE || 'http://127.0.0.1:4264';

let execId = null;

describe('Plan HTTP 集成测试', { skip: !process.env.HESI_INTEGRATION_TEST }, () => {
  it('POST /api/plan/execute → 基本 Plan 执行', async () => {
    const r = await fetch(`${BASE}/api/plan/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: {
          objective: 'integration-smoke',
          steps: [
            { id: 's1', goal: 'echo', action: 'echo integration-ok', type: 'command', requireApproval: false },
          ],
        },
      }),
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(data.ok === true || data.ok === false, '应返回 ok 字段');
    if (data.execId) execId = data.execId;
  });

  it('GET /api/plan/history → 历史列表', async () => {
    const r = await fetch(`${BASE}/api/plan/history?limit=2`);
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.ok(Array.isArray(data.items), '应返回 items 数组');
  });

  it('GET /api/plan/:execId/state → 断点查询', async () => {
    if (!execId) return;
    const r = await fetch(`${BASE}/api/plan/${execId}/state`);
    assert.equal(r.status, 200);
  });

  it('POST /api/plan/:execId/approve → 审批（404 预期，无待审批项）', async () => {
    const r = await fetch(`${BASE}/api/plan/__nonexistent__/approve`, { method: 'POST' });
    assert.equal(r.status, 404);
  });

  it('POST /api/plan/:execId/reject → 驳回（404 预期）', async () => {
    const r = await fetch(`${BASE}/api/plan/__nonexistent__/reject`, { method: 'POST' });
    assert.equal(r.status, 404);
  });
});
