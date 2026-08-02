import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommandWatchdog, commandSig } from '../lib/command-watchdog.js';

function makeWatchdog(nowFn) {
  return new CommandWatchdog({ now: nowFn });
}

test('同一命令 10 分钟内失败 3 次 → escalate', () => {
  let t = 1000000;
  const wd = makeWatchdog(() => t);
  assert.equal(wd.record('rm -rf x', false).escalate, false);
  assert.equal(wd.record('rm -rf x', false).escalate, false);
  const r = wd.record('rm -rf x', false);
  assert.equal(r.escalate, true);
  assert.equal(r.failCount, 3);
});

test('成功执行清零失败计数（恢复正常信号）', () => {
  let t = 1000000;
  const wd = makeWatchdog(() => t);
  wd.record('cmd', false);
  wd.record('cmd', false);
  wd.record('cmd', true); // 成功 → 清零
  assert.equal(wd.record('cmd', false).escalate, false); // 从 1 次重新计
  assert.equal(wd.failCount('cmd'), 1);
});

test('窗口滑出：超过 10 分钟的旧失败不计', () => {
  let t = 1000000;
  const wd = makeWatchdog(() => t);
  wd.record('cmd', false); // t=1000000
  t += 10 * 60 * 1000 + 1; // 超出窗口
  const r = wd.record('cmd', false);
  assert.equal(r.escalate, false); // 第一条已滑出，窗口内只有 1 条
  assert.equal(r.failCount, 1);
});

test('不同命令互不影响', () => {
  const wd = makeWatchdog(() => 1000000);
  wd.record('cmdA', false);
  wd.record('cmdA', false);
  wd.record('cmdB', false);
  assert.equal(wd.record('cmdA', false).escalate, true); // A 到 3 次
  assert.equal(wd.record('cmdB', false).escalate, false); // B 只 2 次
});

test('命令签名：规范化（去空白/限长）', () => {
  assert.equal(commandSig('  echo hi  '), 'echo hi');
  assert.equal(commandSig('x'.repeat(500)).length, 200);
  assert.equal(commandSig(''), '');
  assert.equal(commandSig(undefined), '');
});

test('窗口内 2 次不升级，成功后再失败从 1 计', () => {
  let t = 1000000;
  const wd = makeWatchdog(() => t);
  wd.record('cmd', false);
  wd.record('cmd', false);
  t += 1000;
  wd.record('cmd', true); // 清零
  assert.equal(wd.failCount('cmd'), 0);
  assert.equal(wd.record('cmd', false).failCount, 1);
});

test('reset 清空状态', () => {
  const wd = makeWatchdog(() => 1000000);
  wd.record('cmd', false);
  wd.record('cmd', false);
  wd.record('cmd', false);
  wd.reset();
  assert.equal(wd.failCount('cmd'), 0);
});
