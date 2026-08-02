/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// term-theme.js — CSS 令牌 → xterm ITheme 转换层单测
//
// 覆盖 UI 主题体系 P1 的验收点：
//   1. 令牌齐全时按令牌取值（并 trim）
//   2. 令牌缺失时走兜底值，不抛错、不白屏
//   3. 必须输出 xterm v6 的 selectionBackground（旧代码写 selection 是无效键）
//   4. 自定义 innerBg 优先级最高 —— 切主题不丢用户设定的 alpha
//   5. 多 Tab 场景下**全部**终端被同步（旧实现只同步当前活动的 1 个）
//   6. 单个终端异常（已 dispose）不影响其余终端
//   7. 主题探针：能读「非当前生效主题」的令牌，且探针必被清理（无 DOM 泄漏）
//
// 注：项目测试环境无 DOM shim，故此处自建最小 stub。
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXtermTheme,
  buildXtermThemeFor,
  readThemeTokens,
  withThemeProbe,
  applyTermThemeToAll,
  TERM_TOKENS,
} from '../public/lib/term-theme.js';

/**
 * 安装最小 DOM stub。
 * @param {Record<string,string>} tokens 令牌名 → 值
 * @param {Record<string,string>} storage localStorage 键值
 */
function stubDom(tokens = {}, storage = {}) {
  globalThis.document = { documentElement: /** @type {any} */ ({ nodeName: 'HTML' }) };
  globalThis.getComputedStyle = () => /** @type {any} */ ({
    getPropertyValue: (n) => (Object.prototype.hasOwnProperty.call(tokens, n) ? tokens[n] : ''),
  });
  globalThis.window = /** @type {any} */ ({});
  globalThis.localStorage = /** @type {any} */ ({
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: () => {},
    removeItem: () => {},
  });
}

/**
 * 安装支持「按 data-theme 分流令牌」的 DOM stub，用于测试主题探针。
 * @param {Record<string, Record<string,string>>} byTheme 主题 ID → 令牌表
 * @returns {{children: any[]}} body 引用，可断言探针是否被清理
 */
function stubDomWithProbe(byTheme) {
  const body = {
    children: /** @type {any[]} */ ([]),
    appendChild(el) { this.children.push(el); el._parent = this; return el; },
  };
  globalThis.document = /** @type {any} */ ({
    documentElement: { nodeName: 'HTML', _attrs: {} },
    body,
    createElement: () => ({
      _attrs: /** @type {Record<string,string>} */ ({}),
      style: { cssText: '' },
      setAttribute(k, v) { this._attrs[k] = v; },
      remove() {
        const p = this._parent;
        if (p) p.children = p.children.filter((c) => c !== this);
      },
    }),
  });
  globalThis.getComputedStyle = (el) => {
    const theme = el?._attrs?.['data-theme'];
    const tokens = byTheme[theme] || {};
    return /** @type {any} */ ({
      getPropertyValue: (n) => (Object.prototype.hasOwnProperty.call(tokens, n) ? tokens[n] : ''),
    });
  };
  globalThis.window = /** @type {any} */ ({});
  globalThis.localStorage = /** @type {any} */ ({ getItem: () => null, setItem: () => {}, removeItem: () => {} });
  return body;
}

/** 造一个最小假终端 */
function fakeTerm() {
  return {
    rows: 10,
    options: { theme: null },
    _refreshed: 0,
    refresh() { this._refreshed++; },
  };
}

test('令牌齐全时按令牌取值，并去除首尾空白', () => {
  stubDom({ '--term-bg': '  rgba(1, 2, 3, 0.5)  ', '--term-fg': '#abcdef' });
  const t = buildXtermTheme();
  assert.equal(t.background, 'rgba(1, 2, 3, 0.5)');
  assert.equal(t.foreground, '#abcdef');
});

test('令牌缺失时回退到兜底值，不抛错', () => {
  stubDom({});
  const t = buildXtermTheme();
  for (const key of Object.keys(TERM_TOKENS)) {
    assert.equal(t[key], TERM_TOKENS[key][1], `${key} 应回退到兜底值`);
  }
});

test('输出的 ITheme 覆盖全部 20 个令牌键 + 2 个选区键', () => {
  stubDom({});
  const t = buildXtermTheme();
  assert.equal(Object.keys(TERM_TOKENS).length, 20);
  assert.equal(Object.keys(t).length, 22);
});

test('必须输出 xterm v6 的 selectionBackground（旧 selection 键无效）', () => {
  stubDom({ '--term-selection': 'rgba(7,7,7,0.4)' });
  const t = buildXtermTheme();
  assert.equal(t.selectionBackground, 'rgba(7,7,7,0.4)');
  assert.equal(t.selection, t.selectionBackground, '旧键保留以兼容外部读取');
});

test('自定义 innerBg 优先级高于主题令牌（切主题不丢用户 alpha）', () => {
  stubDom(
    { '--term-bg': '#111111' },
    { 'cli-q-custom-theme': JSON.stringify({ innerBg: 'rgba(9,9,9,0.6)' }) },
  );
  assert.equal(buildXtermTheme().background, 'rgba(9,9,9,0.6)');
});

test('无自定义 innerBg 时仍用主题令牌', () => {
  stubDom({ '--term-bg': '#111111' }, { 'cli-q-custom-theme': JSON.stringify({ outerBg: '#222' }) });
  assert.equal(buildXtermTheme().background, '#111111');
});

test('多 Tab 场景：全部终端都被同步（旧实现只同步 1 个）', () => {
  stubDom({ '--term-bg': '#123456' });
  const a = fakeTerm(), b = fakeTerm(), c = fakeTerm();
  globalThis.window.QCLI = { Tabs: { tabs: [{ term: a }, { term: b }, { term: c }], term: a }, term: a };

  const n = applyTermThemeToAll();
  assert.equal(n, 3, '3 个 Tab 应全部同步（去重后仍为 3）');
  for (const t of [a, b, c]) {
    assert.equal(t.options.theme.background, '#123456');
    assert.equal(t._refreshed, 1, '每个终端应重绘一次');
  }
});

test('单个终端已 dispose 时不影响其余终端', () => {
  stubDom({ '--term-bg': '#654321' });
  const good1 = fakeTerm(), good2 = fakeTerm();
  const broken = { get options() { throw new Error('terminal disposed'); } };
  globalThis.window.QCLI = { Tabs: { tabs: [{ term: good1 }, { term: broken }, { term: good2 }] } };

  const n = applyTermThemeToAll();
  assert.equal(n, 2, '异常终端被跳过，其余仍同步');
  assert.equal(good1.options.theme.background, '#654321');
  assert.equal(good2.options.theme.background, '#654321');
});

test('无任何终端时返回 0，不抛错', () => {
  stubDom({});
  globalThis.window.QCLI = {};
  assert.equal(applyTermThemeToAll(), 0);
});

// ── 主题探针（T4 新增：兼容 getter 与色卡预览的基础设施）──

test('探针可读取「非当前生效主题」的令牌', () => {
  stubDomWithProbe({
    dark: { '--term-bg': '#0d0e10', '--term-fg': '#e4e4e7' },
    light: { '--term-bg': '#fafafa', '--term-fg': '#18181b' },
  });
  assert.equal(buildXtermThemeFor('dark').background, '#0d0e10');
  assert.equal(buildXtermThemeFor('light').background, '#fafafa');
  assert.equal(buildXtermThemeFor('light').foreground, '#18181b');
});

test('探针元素用完即销毁，不残留在 DOM 中', () => {
  const body = stubDomWithProbe({ dark: { '--term-bg': '#000' } });
  buildXtermThemeFor('dark');
  assert.equal(body.children.length, 0, '探针必须被移除');
});

test('回调抛错时探针仍被清理（finally 保证）', () => {
  const body = stubDomWithProbe({ dark: {} });
  assert.throws(() => withThemeProbe('dark', () => { throw new Error('boom'); }), /boom/);
  assert.equal(body.children.length, 0, '异常路径也不能泄漏探针');
});

test('readThemeTokens 按主题读取任意令牌，缺失返回空串', () => {
  stubDomWithProbe({ xuan: { '--accent': '#9e3d32', '--bg-ground': '#e3d9c6' } });
  const got = readThemeTokens('xuan', ['--accent', '--bg-ground', '--not-exist']);
  assert.deepEqual(got, { '--accent': '#9e3d32', '--bg-ground': '#e3d9c6', '--not-exist': '' });
});

test('未知主题不抛错，全部回退到兜底值', () => {
  stubDomWithProbe({ dark: { '--term-bg': '#000' } });
  const t = buildXtermThemeFor('does-not-exist');
  assert.equal(t.background, TERM_TOKENS.background[1]);
});
