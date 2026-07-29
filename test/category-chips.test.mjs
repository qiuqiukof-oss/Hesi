/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 在导入模块前注入 localStorage 垫片
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { getActiveCategory } = await import('../public/components/category-chips.js');

const KEY = 'qcli-active-category';
const setRaw = (v) => (v === null ? store.delete(KEY) : store.set(KEY, v));

test('未选时返回空串', () => {
  setRaw(null);
  assert.equal(getActiveCategory(), '');
});

test('旧单级 string 自动迁移为 main（仅 main）', () => {
  setRaw('daily'); // v0.4.2 旧格式
  assert.equal(getActiveCategory(), 'daily');
});

test('JSON {main} 返回 "main"', () => {
  setRaw(JSON.stringify({ main: 'dev', sub: null }));
  assert.equal(getActiveCategory(), 'dev');
});

test('JSON {main,sub} 返回 "main::sub"', () => {
  setRaw(JSON.stringify({ main: 'dev', sub: 'Bug修复' }));
  assert.equal(getActiveCategory(), 'dev::Bug修复');
});

test('非法 JSON 安全降级为空串', () => {
  setRaw('{bad json');
  assert.equal(getActiveCategory(), '');
});
