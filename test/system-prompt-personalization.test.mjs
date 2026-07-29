// @ts-check
// 个性化注入助手（routes/chat/personalization.js）单元测试。
// 覆盖：个性模板注入、角色 persona（专家注册表）注入/降级、自定义指令覆盖式、
// 默认硬指标回退、语言指令、注入顺序、导出非空。
//
// 后端模块为 CommonJS，本文件为 ESM，故用 createRequire 取同一份 CJS 实例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { composePersonalization, PERSONA_TEMPLATES, DEFAULT_HARD_METRICS } =
  require('../routes/chat/personalization.js');
const expertRegistry = require('../ws/experts.js');

// 罕见路径保护：若 catalog 缺失内置专家则强制播种（dev 数据，非生产，可接受）。
function ensureBuiltin(id) {
  if (!expertRegistry.getPersona(id)) expertRegistry.reingest();
}
ensureBuiltin('sales');

test('个性模板注入：terse 应出现在交流风格段', () => {
  const out = composePersonalization({ persona: 'terse' });
  assert.ok(out.includes('## 交流风格'));
  assert.ok(out.includes(PERSONA_TEMPLATES.terse.prompt));
});

test('角色 default 不注入角色段', () => {
  const out = composePersonalization({ role: 'default' });
  assert.ok(!out.includes('## 角色设定'));
});

test('角色不存在（未知 id）不注入角色段，且静默降级', () => {
  const out = composePersonalization({ role: 'no-such-expert-xyz' });
  assert.ok(!out.includes('## 角色设定'));
});

test('角色 expertId 注入：sales 的 persona 应出现在角色段', () => {
  ensureBuiltin('sales');
  const out = composePersonalization({ role: 'sales' });
  assert.ok(out.includes('## 角色设定'));
  // sales persona 含「销售运营」关键字（不唯一于其他角色）
  assert.ok(out.includes('销售运营'));
});

test('自定义指令覆盖式：填了就用用户的，且不包含默认硬指标', () => {
  const out = composePersonalization({ customInstructions: 'MY-CUSTOM-DIRECTIVE' });
  assert.ok(out.includes('MY-CUSTOM-DIRECTIVE'));
  assert.ok(!out.includes(DEFAULT_HARD_METRICS));
});

test('空自定义指令回退默认硬指标', () => {
  const out = composePersonalization({});
  assert.ok(out.includes(DEFAULT_HARD_METRICS));
  assert.ok(out.includes('## 工程准则与自定义指令'));
});

test('语言指令注入：en → Always reply in English', () => {
  const out = composePersonalization({ language: 'en' });
  assert.ok(out.includes('## 回复语言'));
  assert.ok(out.includes('Always reply in English'));
});

test('注入顺序：语言 → 交流风格 → 角色设定 → 工程准则', () => {
  ensureBuiltin('sales');
  const out = composePersonalization({
    language: 'en',
    persona: 'terse',
    role: 'sales',
    customInstructions: 'CUSTOM-ORDER',
  });
  const iLang = out.indexOf('## 回复语言');
  const iStyle = out.indexOf('## 交流风格');
  const iRole = out.indexOf('## 角色设定');
  const iEng = out.indexOf('## 工程准则与自定义指令');
  assert.ok(iLang >= 0 && iStyle > iLang);
  assert.ok(iRole > iStyle);
  assert.ok(iEng > iRole);
});

test('导出非空：即使仅传空参数，工程准则段始终存在', () => {
  const out = composePersonalization({});
  assert.ok(typeof out === 'string' && out.length > 0);
  assert.ok(out.includes('## 工程准则与自定义指令'));
});
