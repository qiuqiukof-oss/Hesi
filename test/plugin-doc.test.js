/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// 插件说明页（routes/plugin-market/doc.js）核心渲染器测试。
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { mdToHtml, autoDoc } = require('../routes/plugin-market/doc');

test('mdToHtml: 标题/粗体/代码/链接渲染', () => {
  const md = '# 标题一\n\n这是 **粗体** 和 `代码` 与 [链接](https://example.com)\n\n## 二级\n';
  const html = mdToHtml(md);
  assert.ok(html.includes('<h1>标题一</h1>'), 'h1');
  assert.ok(html.includes('<strong>粗体</strong>'), 'bold');
  assert.ok(html.includes('<code>代码</code>'), 'inline code');
  assert.ok(html.includes('href="https://example.com"'), 'link');
  assert.ok(html.includes('<h2>二级</h2>'), 'h2');
});

test('mdToHtml: 代码块与列表', () => {
  const md = '```bash\ncurl http://localhost\n```\n\n- 项目一\n- 项目二\n';
  const html = mdToHtml(md);
  assert.ok(html.includes('<pre><code>curl http://localhost</code></pre>'), 'code block');
  assert.ok(html.includes('<li>项目一</li>'), 'list item');
});

test('mdToHtml: 表格渲染', () => {
  const md = '| 功能 | 说明 |\n|------|------|\n| A | 甲 |\n| B | 乙 |\n';
  const html = mdToHtml(md);
  assert.ok(html.includes('<table>'), 'table open');
  assert.ok(html.includes('<th>功能</th>'), 'table head');
  assert.ok(html.includes('<td>甲</td>'), 'table cell');
});

test('autoDoc: 无 README 时自动生成基本信息/能力/端点', () => {
  const manifest = {
    name: 'test-plugin',
    version: '1.0.0',
    description: '测试描述',
    author: 'tester',
    license: 'MIT',
    routes: [{ method: 'GET', path: '/api/plugins/test-plugin/hello', handler: 'h.js' }],
  };
  const html = autoDoc('test-plugin', manifest, true);
  assert.ok(html.includes('test-plugin'), 'name in title');
  assert.ok(html.includes('测试描述'), 'description');
  assert.ok(html.includes('基本信息'), 'basic info');
  assert.ok(html.includes('API 端点'), 'endpoints');
  assert.ok(html.includes('/api/plugins/test-plugin/hello'), 'route path');
});

test('autoDoc: HTML 转义（防注入）', () => {
  const manifest = { name: 'x', description: '<script>alert(1)</script>' };
  const html = autoDoc('x', manifest, false);
  assert.ok(!html.includes('<script>alert'), 'script escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
});
