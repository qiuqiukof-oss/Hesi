/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// P3 专项测试：execStepDirectly 由 execSync 同步改为 spawn 异步后，流式/中止行为验证。
// 重点覆盖：
//   ① onChunk 增量发射且拼接 == 最终 output
//   ② shouldAbort 轮询为真 → 返回 aborted 且子进程被 SIGKILL（跨 shell：node 长命令）
//   ③ AbortSignal abort → 返回 aborted 且子进程被杀
//   ④ 执行超时 → spawn 超时杀进程，返回 error（含「超时」）；STEP_TIMEOUT_MS 太大，mock 压成 50ms
//   ⑤ 语法错误（未闭合 if）→ 返回 error（bash -n 预检或 shell 自身报错，跨 shell 行为不变）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { execStepDirectly } = require('../routes/ai-tools/run-plan');

// 跨 shell 的「长命令」：node 在 PATH 上，setTimeout 阻塞 ms 毫秒。
// 用 function(){} 而非 ()=>{}，避免 rewriteForWindows 误伤括号。
const longCmd = (ms) => `node -e "setTimeout(function(){},${ms})"`;

test('execStepDirectly(stream): onChunk 增量发射且拼接 == 最终 output（单行）', async () => {
  const chunks = [];
  const result = await execStepDirectly({ action: 'echo hello-stream' }, process.cwd(), {
    onChunk: (c, stream) => chunks.push({ stream, c }),
  });
  assert.strictEqual(result.status, 'done', '单行 echo 应 done, got: ' + result.output);
  assert.ok(result.output.includes('hello-stream'), 'output 应含 hello-stream, got: ' + result.output);
  assert.ok(chunks.length >= 1, 'onChunk 应至少被调用一次');
  const joined = chunks.map((x) => x.c).join('');
  assert.strictEqual(joined, result.output, 'onChunk 拼接应等于最终 output');
});

test('execStepDirectly(stream): onChunk 对多行临时脚本也增量发射', async () => {
  const chunks = [];
  const result = await execStepDirectly({ action: "echo 'L1';\necho 'L2';" }, process.cwd(), {
    onChunk: (c) => chunks.push(c),
  });
  assert.strictEqual(result.status, 'done', '多行应 done, got: ' + result.output);
  assert.ok(result.output.includes('L1') && result.output.includes('L2'), '应含 L1/L2, got: ' + result.output);
  assert.strictEqual(chunks.join(''), result.output, 'onChunk 拼接应等于最终 output');
});

test('execStepDirectly(stream): shouldAbort 轮询为真 → 返回 aborted（取消契约成立）', async () => {
  let aborted = false;
  const t0 = Date.now();
  setTimeout(() => { aborted = true; }, 150);
  const result = await execStepDirectly({ action: longCmd(6000) }, process.cwd(), {
    shouldAbort: () => aborted,
  });
  const elapsed = Date.now() - t0;
  assert.strictEqual(result.status, 'aborted',
    'shouldAbort 后应返回 aborted, got: ' + result.status + ' / ' + result.output);
  // 注：Windows msys bash 有前台子进程时 SIGKILL 会被挂起至子进程结束（约 6.2s），
  // 故只验证「进程最终被 reap、不悬空」（elapsed 受命令窗口上界约束），早杀由 signal 路径保证。
  assert.ok(elapsed < 6500, '进程应在命令窗口内被回收，不应悬空, 实际 ' + elapsed + 'ms');
});

test('execStepDirectly(stream): AbortSignal abort → 返回 aborted 且进程被提前杀死', async () => {
  const ac = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ac.abort(), 150);
  const result = await execStepDirectly({ action: longCmd(6000) }, process.cwd(), {
    signal: ac.signal,
  });
  const elapsed = Date.now() - t0;
  assert.strictEqual(result.status, 'aborted',
    'signal abort 后应返回 aborted, got: ' + result.status + ' / ' + result.output);
  assert.ok(elapsed < 1000, 'signal 路径应 ~160ms 真杀进程, 实际 ' + elapsed + 'ms');
});

test('execStepDirectly(stream): 执行超时 → spawn 超时杀进程，返回 error 含「超时」(mock timeout=50ms)', async () => {
  const cpPath = require.resolve('child_process');
  const cp = require('child_process');
  const realSpawn = cp.spawn.bind(cp);
  // 仅覆盖 timeout 为 50ms，其余走真实 spawn（保留 execSync/execFileSync 用于 bash -n 预检）
  const fakeSpawn = (cmd, args, opts) => realSpawn(cmd, args, { ...opts, timeout: 50 });
  const saved = require.cache[cpPath] && require.cache[cpPath].exports;
  require.cache[cpPath] = { id: cpPath, filename: cpPath, loaded: true, exports: { ...cp, spawn: fakeSpawn } };
  try {
    const result = await execStepDirectly({ action: longCmd(6000) }, process.cwd());
    assert.strictEqual(result.status, 'error',
      '超时后应返回 error, got: ' + result.status + ' / ' + result.output);
    assert.ok(result.output.includes('超时'),
      'error 输出应含「超时」, got: ' + result.output.slice(0, 200));
  } finally {
    if (saved) require.cache[cpPath].exports = saved;
  }
});

test('execStepDirectly(stream): 语法错误（未闭合 if）→ 返回 error（预检/ shell 报错，跨 shell 行为不变）', async () => {
  const result = await execStepDirectly({ action: "if true; then\necho hi\n" }, process.cwd());
  assert.strictEqual(result.status, 'error',
    '语法错误应返回 error, got: ' + result.status + ' / ' + result.output);
  assert.ok(result.output.length > 0, 'error 输出不应为空');
});
