/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Phase 2 皮肤系统 — 纯逻辑单测（SKINS 结构 / 缺省回落 / 图标 / applySkin 切肤）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKINS, getSkin, applySkin } from '../public/components/roundtable-skins.js';

function fakeClassList() {
  const set = new Set();
  return {
    _set: set,
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c, f) => { if (f === undefined) { set.has(c) ? set.delete(c) : set.add(c); } else { f ? set.add(c) : set.delete(c); } },
    has: (c) => set.has(c),
  };
}

test('SKINS 含内置两款皮肤 hearth / mahjong', () => {
  assert.ok(SKINS.hearth, '应有 hearth');
  assert.ok(SKINS.mahjong, '应有 mahjong');
  assert.equal(SKINS.hearth.id, 'hearth');
  assert.equal(SKINS.mahjong.id, 'mahjong');
});

test('getSkin 缺省/未知回落 hearth', () => {
  assert.equal(getSkin('hearth').id, 'hearth');
  assert.equal(getSkin('mahjong').id, 'mahjong');
  assert.equal(getSkin('nope').id, 'hearth');
  assert.equal(getSkin(undefined).id, 'hearth');
});

test('hearth 气泡图标为 🔥；mahjong 按席位返回麻将牌', () => {
  assert.equal(SKINS.hearth.messageIcon('fox'), '🔥');
  assert.equal(SKINS.mahjong.messageIcon('fox'), '🀄');
  assert.equal(SKINS.mahjong.messageIcon('panda'), '🀅');
  assert.equal(SKINS.mahjong.messageIcon('owl'), '🀆');
  assert.equal(SKINS.mahjong.messageIcon('bunny'), '🀇');
  assert.equal(SKINS.mahjong.messageIcon('unknown'), '🀄'); // 兜底
});

test('activeGlow 返回 rgba 阴影', () => {
  assert.match(SKINS.hearth.activeGlow('#BA7517'), /^0 0 18px rgba\(/);
  assert.match(SKINS.mahjong.activeGlow('#3B6D11'), /^0 0 18px rgba\(/);
});

test('applySkin 切肤：移除旧 skin-* 类、加新类', () => {
  const c = { classList: fakeClassList() };
  applySkin(c, 'hearth');
  assert.ok(c.classList.has('skin-hearth'), '应含 skin-hearth');
  assert.ok(!c.classList.has('skin-mahjong'));
  applySkin(c, 'mahjong');
  assert.ok(c.classList.has('skin-mahjong'), '切到 mahjong 应含 skin-mahjong');
  assert.ok(!c.classList.has('skin-hearth'), '切走后不应残留 skin-hearth');
});

test('applySkin 返回生效皮肤对象', () => {
  const c = { classList: fakeClassList() };
  const s = applySkin(c, 'mahjong');
  assert.equal(s.id, 'mahjong');
});
