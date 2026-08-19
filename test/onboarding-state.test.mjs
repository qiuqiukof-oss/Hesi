/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ONBOARDING_KEY,
  getSeen,
  setSeen,
  resetSeen,
  resolveSteps,
} from '../public/onboarding-state.js';

// 内存版 Storage mock（node 无 localStorage）
function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

test('ONBOARDING_KEY 常量正确', () => {
  assert.equal(ONBOARDING_KEY, 'hesi_onboarding_v2');
});

test('getSeen 默认未看', () => {
  const s = makeStorage();
  assert.equal(getSeen(s), false);
});

test('setSeen(true) 后 getSeen 返回 true', () => {
  const s = makeStorage();
  assert.equal(setSeen(true, s), true);
  assert.equal(getSeen(s), true);
  assert.equal(s.getItem(ONBOARDING_KEY), '1');
});

test('setSeen(false) / resetSeen 清除标记', () => {
  const s = makeStorage();
  setSeen(true, s);
  assert.equal(getSeen(s), true);
  resetSeen(s);
  assert.equal(getSeen(s), false);
  setSeen(false, s);
  assert.equal(getSeen(s), false);
});

test('隐私模式（无 storage）下不崩', () => {
  assert.equal(getSeen(null), false);
  assert.equal(setSeen(true, null), false);
  assert.doesNotThrow(() => resetSeen(null));
});

test('storage 抛错时不崩，降级为未看', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(getSeen(broken), false);
  assert.equal(setSeen(true, broken), false);
});

test('resolveSteps 补 index/isFirst/isLast', () => {
  const steps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const out = resolveSteps(steps);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { id: 'a', index: 0, isFirst: true, isLast: false });
  assert.deepEqual(out[2], { id: 'c', index: 2, isFirst: false, isLast: true });
});

test('resolveSteps 空/非数组安全', () => {
  assert.deepEqual(resolveSteps([]), []);
  assert.deepEqual(resolveSteps(null), []);
  assert.deepEqual(resolveSteps(undefined), []);
});
