/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 插件说明页（通用）
//   GET /api/plugins/:name/doc
//
// 渲染插件使用说明：
//   1. 插件目录存在 README.md → 最简 markdown 渲染为 HTML
//   2. 无 README → 自动生成说明页（manifest 信息 + 路由端点 + capabilities）
//
// 用途：插件广场卡片的「🔗 使用说明」homepage 目标；零依赖（无 marked）。
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const { Router } = require('express');

const PLUGINS_DIR = path.join(__dirname, '..', '..', 'plugins');

/** 转义 HTML。 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * 最简 markdown → HTML（覆盖 README 常见语法：标题/代码块/列表/粗体/链接/表格）。
 * 不追求完整规范，够用即可。
 * @param {string} md
 * @returns {string}
 */
function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let inTable = false;
  let tableRows = [];
  const listStack = [];

  const flushCode = () => {
    if (inCode) {
      out.push(`<pre><code>${  esc(codeBuf.join('\n'))  }</code></pre>`);
      codeBuf = [];
      inCode = false;
    }
  };
  const flushTable = () => {
    if (inTable && tableRows.length) {
      const head = tableRows[0];
      const body = tableRows.slice(1);
      let h = `<table><thead><tr>${  head.map((c) => `<th>${  esc(c)  }</th>`).join('')  }</tr></thead><tbody>`;
      for (const row of body) {
        h += `<tr>${  row.map((c) => `<td>${  esc(c)  }</td>`).join('')  }</tr>`;
      }
      out.push(`${h  }</tbody></table>`);
      tableRows = [];
      inTable = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    // 代码块
    if (line.trim().startsWith('```')) {
      if (inCode) { flushCode(); } else { flushTable(); flushList(out, listStack, true); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    // ── 表格 ──
    // 表格分隔行（|---|）→ 若前面暂存了表头候选则确认表格
    if (/^\|?[\s:|-]+\|?$/.test(line) && line.includes('-') && !inTable && tableRows.length === 1) {
      inTable = true;
      tableRows[0] = tableRows[0].map((c) => c.replace(/^\s*\*\*|\*\*\s*$/g, '')).filter(Boolean);
      continue;
    }
    // 表头候选：以 | 开头的行先暂存，下一行是分隔行才确认是表格
    if (line.trim().startsWith('|') && line.includes('|') && !inTable) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      tableRows.push(cells);
      if (tableRows.length > 1) {
        // 第二行不是分隔行 → 不是表格，flush 为段落
        flushTable();
        for (const row of tableRows) out.push(`<p>| ${row.join(' | ')} |</p>`);
        tableRows = [];
      }
      continue;
    }
    if (inTable) {
      if (line.trim().startsWith('|') && line.includes('|')) {
        tableRows.push(line.split('|').slice(1, -1).map((c) => c.trim()));
        continue;
      }
      flushTable();
    }
    // 非表格行时清掉暂存的表头候选
    if (tableRows.length) {
      for (const row of tableRows) out.push(`<p>| ${row.join(' | ')} |</p>`);
      tableRows = [];
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flushList(out, listStack, true); out.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); continue; }
    // 列表
    const li = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (li) { out.push(`<li>${inline(esc(li[2]))}</li>`); continue; }
    // 数字列表
    const oli = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (oli) { out.push(`<li>${inline(esc(oli[1]))}</li>`); continue; }
    // 分隔线
    if (/^-{3,}$/.test(line.trim())) { flushList(out, listStack, true); out.push('<hr>'); continue; }
    // 引用
    if (line.startsWith('> ')) { out.push(`<blockquote>${  inline(esc(line.slice(2)))  }</blockquote>`); continue; }
    // 空行 → 段落分隔
    if (!line.trim()) { flushList(out, listStack, true); out.push(''); continue; }
    // 普通段落
    out.push(`<p>${inline(esc(line))}</p>`);
  }
  flushCode();
  flushTable();
  flushList(out, listStack, true);
  return out.join('\n');
}

/** 列表收尾。 */
function flushList(out, listStack, force) {
  if (force && listStack.length) {
    out.push('</ul>');
    listStack.length = 0;
  }
}

/** 行内语法：粗体/代码/链接。 */
function inline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/** 页面骨架。 */
function page(title, bodyHtml) {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)} — Hesi 插件说明</title><style>
:root { color-scheme: dark; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif; background: #0b0f17; color: #e2e8f0; padding: 32px 20px; line-height: 1.7; }
.container { max-width: 860px; margin: 0 auto; }
h1 { font-size: 22px; margin-bottom: 6px; }
h2 { font-size: 17px; margin: 22px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #1e293b; }
h3 { font-size: 15px; margin: 18px 0 8px; }
h4 { font-size: 13px; margin: 14px 0 6px; }
p { margin: 8px 0; }
ul { margin: 8px 0 8px 22px; }
pre { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-size: 12.5px; margin: 10px 0; }
code { background: #0f172a; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; color: #7dd3fc; }
pre code { padding: 0; background: none; color: #e2e8f0; }
table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 10px 0; }
th, td { text-align: left; padding: 7px 10px; border: 1px solid #1e293b; }
th { background: #111827; color: #94a3b8; font-weight: 500; }
blockquote { border-left: 3px solid #2563eb; padding: 6px 14px; margin: 10px 0; color: #94a3b8; background: rgba(37,99,235,.08); border-radius: 0 6px 6px 0; }
a { color: #60a5fa; }
hr { border: none; border-top: 1px solid #1e293b; margin: 18px 0; }
.back { display: inline-block; margin-bottom: 18px; color: #94a3b8; font-size: 13px; text-decoration: none; }
.back:hover { color: #60a5fa; }
.meta { font-size: 12px; color: #64748b; margin-bottom: 24px; }
</style></head><body><div class="container"><a class="back" href="/plugin-plaza.html">← 返回插件广场</a><h1>${esc(title)}</h1><div class="meta">Hesi 插件使用说明</div>${bodyHtml}</div></body></html>`;
}

/** 无 README 时自动生成说明页。 */
function autoDoc(dir, manifest, manifestPath) {
  const parts = [];
  if (manifest) {
    if (manifest.description) parts.push(`<p>${inline(esc(manifest.description))}</p>`);
    parts.push(`<h2>基本信息</h2><ul>` +
      `<li>版本：${esc(manifest.version || '—')}</li>` +
      `<li>作者：${esc(manifest.author || '—')}</li>${ 
      manifest.license ? `<li>协议：${esc(manifest.license)}</li>` : '' 
      }</ul>`);
    const caps = [];
    for (const key of ['clis', 'workflows', 'aiTools', 'routes', 'presets', 'mcpServers']) {
      if (Array.isArray(manifest[key]) && manifest[key].length) caps.push(key);
    }
    if (caps.length) parts.push(`<h2>能力</h2><p>${  caps.map((c) => `<code>${c}</code>`).join(' ')  }</p>`);
    if (Array.isArray(manifest.routes) && manifest.routes.length) {
      parts.push(`<h2>API 端点</h2><ul>${ 
        manifest.routes.map((r) => `<li><code>${esc(r.method)} ${esc(r.path)}</code></li>`).join('') 
        }</ul>`);
    }
  } else {
    parts.push(`<p>插件目录 <code>${esc(dir)}</code> 无 plugin.json 清单。</p>`);
  }
  if (manifestPath) parts.push(`<p class="meta">清单路径：<code>plugins/${esc(dir)}/plugin.json</code></p>`);
  return page(dir, parts.join('\n'));
}

/**
 * 创建插件说明路由。
 * @returns {import('express').Router}
 */
function createDocRouter() {
  const router = Router();

  // GET /plugins/:name/doc — 插件使用说明页（README 渲染或自动生成）
  router.get('/plugins/:name/doc', (req, res) => {
    const name = String(req.params.name || '');
    // 安全：目录名只允许 kebab-case（与插件创建/重载校验一致，防路径穿越）
    if (!/^[a-z0-9-]+$/.test(name)) {
      return res.status(400).send('invalid plugin name');
    }
    const pluginDir = path.join(PLUGINS_DIR, name);
    const manifestPath = path.join(pluginDir, 'plugin.json');
    const readmePath = path.join(pluginDir, 'README.md');

    if (!fs.existsSync(pluginDir) || !fs.statSync(pluginDir).isDirectory()) {
      return res.status(404).send('plugin not found');
    }

    let manifest = null;
    if (fs.existsSync(manifestPath)) {
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { /* ignore */ }
    }
    const title = (manifest && manifest.name) || name;

    if (fs.existsSync(readmePath)) {
      const md = fs.readFileSync(readmePath, 'utf8');
      return res.send(page(title, mdToHtml(md)));
    }
    return res.send(autoDoc(name, manifest, fs.existsSync(manifestPath)));
  });

  return router;
}

module.exports = { createDocRouter, mdToHtml, autoDoc, page };
