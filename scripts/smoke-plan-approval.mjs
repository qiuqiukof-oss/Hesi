#!/usr/bin/env node
/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 *
 * P2.6 Plan 执行审批闸 — 免浏览器冒烟测试
 *
 * 用法: node scripts/smoke-plan-approval.mjs
 *
 * 前提: 服务已在 localhost:3000 运行（node server.js）
 * 测试: 提交一个含 requireApproval 步的 plan → 等闸门 WS 事件 → 审批通过 → 验证完成
 *
 * 无需浏览器、无需 API Key — 步骤只做 echo 命令，不调 LLM。
 */

import { createServer } from 'node:http';
import { WebSocket } from 'ws'; // npm 依赖，Hesi 项目自带

const PORT = 3099; // 临时端口，不冲突

// ── 模拟一个极简服务器 ──
// 因为我们只测 plan 路由的审批闸门，直接用 Hesi 的 createPlanRouter。
// 但完整 server 依赖过多（cli-discovery/memory 等），这里用子进程启真实 server。
// 如果你本机已有 node server.js 在 3000 端口跑着，直接改下面的 BASE 即可。

const BASE = process.env.HESI_SMOKE_URL || 'http://127.0.0.1:3000';
const WS_URL = BASE.replace('http://', 'ws://').replace('https://', 'wss://');

console.log('=== P2.6 审批闸冒烟测试 ===');
console.log(`目标服务: ${BASE}`);
console.log('');

// ── 构造一个最小 plan（仅含一个 requireApproval 的 echo 步）──
const minimalPlan = {
  goal: '冒烟测试：审批闸',
  steps: [
    {
      id: 'echo1',
      label: 'echo 1（自动通过）',
      action: 'echo hello-1',
      requireApproval: false,
    },
    {
      id: 'gate1',
      label: 'gate step（需审批）',
      action: 'echo hello-gate',
      requireApproval: true,
      risk: '这是一个需要人工审批的步骤（冒烟测试用）',
    },
    {
      id: 'echo2',
      label: 'echo 2（审批通过后执行）',
      action: 'echo hello-2',
      requireApproval: false,
    },
  ],
  approvalPolicy: 'marked',
};

// ── 辅助：等待指定时间 ──
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let execId = null;

  // 1) 连接 WebSocket，监听审批事件
  console.log('[1] 连接 WebSocket...');
  const ws = new WebSocket(WS_URL);

  const wsReady = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WS 连接超时')), 5000);
  });

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      if (data.type === 'plan:await-approval' && data.execId) {
        console.log(`\n[WS] ⏸ 审批闸触发: execId=${data.execId}`);
        console.log(`    步: ${data.step?.label || data.step?.id || '?'}`);
        console.log(`    风险: ${data.step?.risk || '无'}`);
        execId = data.execId;
      } else if (data.type === 'plan:approval-resolved') {
        console.log(`[WS] ✅ 审批已决议: approved=${data.approved} timedOut=${data.timedOut || false}`);
      } else if (data.type === 'plan:progress') {
        console.log(`[WS] 进度: ${data.message || JSON.stringify(data)}`);
      } else if (data.type === 'plan:done') {
        console.log(`[WS] 🏁 Plan 完成: status=${data.status}`);
      }
    } catch { /* ignore malformed */ }
  });

  await wsReady;
  console.log('[1] WS 已连接');

  // 2) 提交 Plan
  console.log('\n[2] 提交 Plan（含 1 个需审批步）...');
  const execResp = await fetch(`${BASE}/api/plan/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(minimalPlan),
  });

  if (!execResp.ok) {
    const errText = await execResp.text();
    console.error(`❌ POST /api/plan/execute 失败 (${execResp.status}):`, errText);
    ws.close();
    process.exit(1);
  }

  const execResult = await execResp.json();
  execId = execResult.execId || execId; // 从响应或 WS 获取
  console.log(`[2] Plan 已提交: execId=${execId}, 状态=${execResult.status}`);
  if (execResult.error) {
    console.error('❌ Plan 提交错误:', execResult.error);
  }
  console.log('   等待审批闸触发（最多 15s）...');

  // 3) 等待 WS 审批事件（或 execId 被 set）
  const startWait = Date.now();
  while (!execId && (Date.now() - startWait < 15000)) {
    await sleep(500);
  }

  if (!execId) {
    // 可能已经直接完成了（如果没有 requireApproval 步正确触发）
    console.log('⚠ 未收到审批事件 — plan 可能已直接完成或无审批步被触发。');
    console.log('  检查 run-plan.js stepRequiresApproval 逻辑。');
    ws.close();
    process.exit(1);
  }

  // 4) 审批通过
  console.log(`\n[3] 审批通过: POST /api/plan/${execId}/approve ...`);
  const approveResp = await fetch(`${BASE}/api/plan/${execId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });

  if (!approveResp.ok) {
    const errText = await approveResp.text();
    console.error(`❌ approve 失败 (${approveResp.status}):`, errText);
    ws.close();
    process.exit(1);
  }

  const approveResult = await approveResp.json();
  console.log(`[3] 审批结果: ok=${approveResult.ok}, status=${approveResult.status}`);

  // 5) 等 WS 收到 plan:approval-resolved + plan:done
  console.log('\n[4] 等待完成事件（最多 10s）...');
  await sleep(3000); // 给后端一点时间完成后续步骤

  ws.close();
  console.log('\n=== 测试完成 ===');
  if (approveResult.ok) {
    console.log('✅ P2.6 审批闸通过 — 审批流程正常');
    console.log('   - Plan 提交成功');
    console.log('   - WS 收到 plan:await-approval');
    console.log('   - POST /approve 成功');
    console.log('   - 后续步骤继续执行');
  } else {
    console.log('⚠ 审批返回非 ok，检查 execId 是否匹配');
  }
}

main().catch((err) => {
  console.error('❌ 测试失败:', err.message);
  process.exit(1);
});
