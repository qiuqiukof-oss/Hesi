// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGENT_ROSTER,
  STATUS_META,
  avatarInnerSVG,
  renderAvatar,
  renderSeat,
  applyOverrides,
} from '../public/components/agent-avatars.js';

test('AGENT_ROSTER 含 4 个基础角色且字段完整', () => {
  assert.equal(AGENT_ROSTER.length, 4);
  for (const a of AGENT_ROSTER) {
    assert.ok(a.id && a.name && a.roleLabel && a.themeColor && a.svg, `缺字段: ${a.id}`);
  }
});

test('STATUS_META 含 6 种状态', () => {
  for (const k of ['thinking', 'speaking', 'working', 'done', 'error', 'idle']) {
    assert.ok(STATUS_META[k], `缺状态 ${k}`);
    assert.ok(STATUS_META[k].label && STATUS_META[k].cls && STATUS_META[k].color);
  }
});

test('avatarInnerSVG 未知 key 回退 fox', () => {
  assert.ok(avatarInnerSVG('fox').includes('<circle'));
  assert.ok(avatarInnerSVG('nope').includes('<circle'));
});

test('renderAvatar 默认输出内联 SVG + 主题色边框', () => {
  const html = renderAvatar(AGENT_ROSTER[0]);
  assert.match(html, /<svg[^>]*viewBox="0 0 56 56"/);
  assert.match(html, /border-color:#BA7517/);
  assert.match(html, /width:56px;height:56px/);
});

test('renderAvatar emoji 分支', () => {
  const html = renderAvatar({ themeColor: '#000', svg: 'fox', avatar: { type: 'emoji', value: '🦊' } });
  assert.match(html, /rt-emoji/);
  assert.match(html, /🦊/);
  assert.ok(!html.includes('<svg'));
});

test('renderAvatar img 分支', () => {
  const html = renderAvatar({ themeColor: '#000', svg: 'fox', avatar: { type: 'img', value: 'data:image/png;base64,AAA' } });
  assert.match(html, /<img src="data:image\/png;base64,AAA"/);
});

test('renderSeat 正常座位含名字/角色/状态徽章', () => {
  const html = renderSeat(AGENT_ROSTER[1], { state: 'working', bubble: '接口补一下' });
  assert.match(html, /胖达 Panda/);
  assert.match(html, /后端 Backend/);
  assert.match(html, /工作中/);
  assert.match(html, /接口补一下/);
  assert.match(html, /data-seat="panda"/);
});

test('renderSeat 空座不渲染头像内部且标注空座', () => {
  const html = renderSeat(AGENT_ROSTER[2], { empty: true });
  assert.match(html, /class="[^"]*empty/);
  assert.match(html, /空座/);
  assert.ok(!html.includes('<svg'));
  assert.ok(!html.includes('座发言'));
});

test('applyOverrides 按 id 合并且不修改原数组', () => {
  const overrides = { fox: { name: '小狐狸', themeColor: '#ff0000' } };
  const out = applyOverrides(AGENT_ROSTER, overrides);
  assert.equal(out[0].name, '小狐狸');
  assert.equal(out[0].themeColor, '#ff0000');
  assert.equal(AGENT_ROSTER[0].name, '小狐 Foxy'); // 原数组不变
  assert.equal(out.length, AGENT_ROSTER.length);
});

test('applyOverrides 空覆盖返回副本', () => {
  const out = applyOverrides(AGENT_ROSTER, null);
  assert.equal(out.length, 4);
  assert.notEqual(out, AGENT_ROSTER);
});
