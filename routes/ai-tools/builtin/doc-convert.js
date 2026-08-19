/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tool: convert_document
//
// 文档格式转换工具。优先使用 pandoc（支持 Markdown↔PDF/DOCX/PPTX/HTML/EPUB），
// 无 pandoc 时自动降级为内置 Markdown→HTML 转换。
// ============================================================
const fs = require('fs');
const path = require('path');
const { execFile, exec } = require('child_process');

// 异步进程探测：fire-and-forget 风格 execFile 封装，避免同步 execSync 冻结事件循环。
// 失败/超时时返回 null（调用方按 best-effort 处理）。
function checkOutput(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: opts.timeout || 5000, encoding: 'utf8' }, (err, stdout) => {
      resolve(err ? null : (stdout || ''));
    });
  });
}

const { GENERATED_UPLOADS_DIR } = require('../../../lib/uploads');

const isWin = process.platform === 'win32';

const SUPPORTED_FORMATS = ['pdf', 'docx', 'pptx', 'html', 'epub', 'markdown', 'rst', 'latex', 'textile'];
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'];

// ── Pandoc 检测缓存（只检测一次，pandoc 不会运行时消失） ──
let _pandocCache = null;
// ── PDF 引擎检测缓存 ──
let _pdfEngineCache = null;
// ── 包管理器检测缓存 ──
let _pkgManagerCache = null;

/**
 * 检测 pandoc 是否已安装（结果缓存）。
 * 优先读取环境变量 PANDOC_PATH 指定的路径，再尝试 PATH 自动检测。
 * @returns {{ available: boolean, version?: string, path?: string }}
 */
async function detectPandoc() {
  if (_pandocCache) return _pandocCache;

  // ── 优先使用 PANDOC_PATH 环境变量 ──
  const envPath = process.env.PANDOC_PATH;
  if (envPath) {
    const result = await checkOutput(envPath, ['--version'], { timeout: 5000 });
    if (result != null) {
      const firstLine = result.split('\n')[0] || '';
      const versionMatch = firstLine.match(/[\d.]+/);
      _pandocCache = {
        available: true,
        version: versionMatch ? versionMatch[0] : 'unknown',
        path: envPath,
      };
      console.log(`[DocConvert] Using PANDOC_PATH: ${envPath} (v${_pandocCache.version})`);
      return _pandocCache;
    }
    console.warn(`[DocConvert] PANDOC_PATH set but not executable: ${envPath}. Falling back to PATH...`);
  }

  // ── 回退：从 PATH 自动检测 ──
  const result = await checkOutput('pandoc', ['--version'], { timeout: 5000 });
  if (result != null) {
    const firstLine = result.split('\n')[0] || '';
    const versionMatch = firstLine.match(/[\d.]+/);
    // 找到 pandoc 路径（Windows where / Unix which）
    let pandocPath = 'pandoc';
    const whichResult = await checkOutput(isWin ? 'where' : 'which', ['pandoc'], { timeout: 3000 });
    if (whichResult && whichResult.trim()) pandocPath = whichResult.split('\n')[0].trim();

    _pandocCache = {
      available: true,
      version: versionMatch ? versionMatch[0] : 'unknown',
      path: pandocPath,
    };
    return _pandocCache;
  }
  _pandocCache = { available: false };
  return _pandocCache;
}

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'convert_document',
    noTruncate: true,
    description: '文档格式转换。使用 pandoc 在 Markdown ↔ PDF / DOCX / PPTX / HTML / EPUB / LaTeX / RST / Textile 之间互相转换。如果未安装 pandoc，自动降级为内置 Markdown→HTML 转换。返回转换后的文件路径（可下载）。中文：文档格式转换',
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: '输入文件路径（相对于项目根目录的 Markdown 文件，或绝对路径）',
        },
        output: {
          type: 'string',
          description: '输出文件路径（可选，默认自动生成在项目根目录）',
        },
        format: {
          type: 'string',
          enum: SUPPORTED_FORMATS,
          description: '目标格式：pdf, docx, pptx, html, epub, markdown, rst, latex, textile',
        },
        content: {
          type: 'string',
          description: '直接传入 Markdown 内容进行转换（与 input 二选一）。适合 AI 直接生成文档内容后转换。',
        },
        title: {
          type: 'string',
          description: '文档标题（仅用于内嵌 HTML 或 PDF 元数据）',
        },
        css: {
          type: 'string',
          description: '自定义 CSS URL 或文件路径（仅 PDF/HTML 输出有效）',
        },
        toc: {
          type: 'boolean',
          description: '是否生成目录（仅 PDF/DOCX/HTML 输出有效）',
          default: false,
        },
      },
      // 注意：运行时验证 input XOR content，schema 层面不做 oneOf（OpenAI 不支持）
      required: ['format'],
    },
    execute: async (args) => {
      const inputPath = args.input ? path.resolve(process.cwd(), args.input) : null;
      const rawContent = args.content || null;
      const format = String(args.format || 'html').toLowerCase();
      const title = args.title || 'Document';
      const toc = args.toc === true;
      const customCss = args.css || null;

      // ── 校验输入 ──
      if (!inputPath && !rawContent) {
        return '❌ 请提供 input（文件路径）或 content（文档内容）参数。';
      }

      if (inputPath) {
        if (!fs.existsSync(inputPath)) {
          return `❌ 输入文件不存在: ${inputPath}`;
        }
        const stat = fs.statSync(inputPath);
        if (!stat.isFile()) {
          return `❌ 输入路径不是文件: ${inputPath}`;
        }
      }

      if (args.format === '' || !SUPPORTED_FORMATS.includes(format)) {
        const msg = !args.format
          ? `❌ 请指定输出格式（format 参数）。可选: ${  SUPPORTED_FORMATS.join(', ')}`
          : `❌ 不支持的输出格式: ${format}。可选: ${SUPPORTED_FORMATS.join(', ')}`;
        return msg;
      }

      // ── 检测 pandoc ──
      const pandoc = await detectPandoc();

      // ── 如果安装了 pandoc，使用 pandoc 转换 ──
      if (pandoc.available) {
        return await convertWithPandoc(inputPath, rawContent, format, title, toc, customCss, pandoc);
      }

      // ── 没有 pandoc，降级策略 ──
      if (format === 'html') {
        return await convertMarkdownToHtml(inputPath, rawContent, title, customCss);
      }
      if (format === 'markdown') {
        // 从 input 读取内容返回（或直接返回 content）
        if (rawContent) return `✅ 以下为 Markdown 内容：\n\n${rawContent}`;
        const content = fs.readFileSync(inputPath, 'utf8');
        return `✅ 以下为文件内容：\n\n${content}`;
      }

      // ── 需要 pandoc 但未安装 ──
      return getPandocInstallGuide(format, rawContent || (inputPath ? fs.readFileSync(inputPath, 'utf8').slice(0, 500) : ''));
    },
  });
}

// ============================================================
// Pandoc Conversion
// ============================================================

async function convertWithPandoc(inputPath, rawContent, format, title, toc, customCss, pandoc) {
  const outputFileName = generateOutputName(inputPath || `document`, format);
  const outputDir = GENERATED_UPLOADS_DIR;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, outputFileName);

  // ── 临时文件管理 ──
  let tmpFile = null;
  const cleanup = () => {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      tmpFile = null;
    }
  };

  try {
    // 构建 pandoc 命令
    let cmd = `"${pandoc.path}"`;

    if (inputPath) {
      cmd += ` "${inputPath}"`;
    } else {
      // 写入临时文件供 pandoc 读取
      tmpFile = path.join(process.cwd(), `.tmp_convert_${Date.now()}.md`);
      fs.writeFileSync(tmpFile, rawContent, 'utf8');
      cmd += ` "${tmpFile}"`;
    }

    cmd += ` -o "${outputPath}"`;

    if (format === 'html' || format === 'pdf') {
      if (title) cmd += ` --metadata title="${escapeShellArg(title)}"`;
      if (customCss) cmd += ` --css="${escapeShellArg(customCss)}"`;
    }
    if (toc) cmd += ' --toc';

    // 特定格式额外参数
    if (format === 'pdf') {
      const engineFound = await detectPdfEngine();
      if (engineFound) {
        cmd += ` --pdf-engine=${engineFound}`;
      } else {
        // 无 PDF 引擎 — 先转 HTML
        const htmlPath = outputPath.replace(/\.pdf$/i, '.html');
        const htmlCmd = `${cmd.replace(`"${outputPath}"`, `"${htmlPath}"`).replace(' --pdf-engine=', ' ').split(' --pdf-engine')[0]  } -o "${htmlPath}"`;
        try {
          await new Promise((resolve, reject) => {
            // eslint-disable-next-line no-restricted-syntax -- audited: pandoc command built internally from validated file paths (quoted), not from arbitrary agent shell input; needs shell for redirection.
            exec(htmlCmd, { timeout: 60000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error) => {
              if (error) reject(error); else resolve();
            });
          });
          if (fs.existsSync(htmlPath)) {
            return buildResult(format, htmlPath, `⚠️ 未找到 PDF 引擎（如 wkhtmltopdf），已转为 HTML 格式。\n\n要生成 PDF，请安装 wkhtmltopdf：\n- 访问 https://wkhtmltopdf.org/downloads.html\n- 或使用: \`${await getPkgManager()} install -g wkhtmltopdf\``);
          }
        } catch (e) {
          return `❌ PDF 生成失败：${e.message}\n\n提示：安装 wkhtmltopdf 即可生成 PDF：https://wkhtmltopdf.org/downloads.html`;
        }
      }
    }

    console.log(`[DocConvert] Running (async): ${cmd.slice(0, 200)}...`);

    try {
      // 使用异步 exec 避免阻塞事件循环
      const stdout = await new Promise((resolve, reject) => {
        // eslint-disable-next-line no-restricted-syntax -- audited: pandoc command built internally from validated file paths (quoted), not from arbitrary agent shell input; needs shell for redirection.
        exec(cmd, {
          timeout: 120000,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        }, (error, stdout, stderr) => {
          if (error) {
            // 超时或执行失败
            reject(error);
          } else {
            resolve(stdout || '');
          }
        });
      });

      if (!fs.existsSync(outputPath)) {
        return `❌ 转换完成但未找到输出文件。Pandoc 输出:\n${stdout.slice(0, 500)}`;
      }

      const stat = fs.statSync(outputPath);
      const fileSize = (stat.size / 1024).toFixed(1);

      return buildResult(format, outputPath, null, fileSize);
    } finally {
      cleanup();
    }

  } catch (err) {
    console.error('[DocConvert] Pandoc error:', err.message);
    return `❌ 转换失败: ${err.message}\n\n请检查:\n1. 输入文件格式是否正确（应为 Markdown）\n2. 目标格式是否被 pandoc 支持\n3. 对于 PDF 格式，需要安装 PDF 引擎（wkhtmltopdf 等）\n4. 文件是否被其他程序占用`;
  }
}

// ============================================================
// Built-in Markdown → HTML (no pandoc needed)
// ============================================================

async function convertMarkdownToHtml(inputPath, rawContent, title, customCss) {
  try {
    let md = '';
    let sourceName = 'inline';

    if (inputPath) {
      md = fs.readFileSync(inputPath, 'utf8');
      sourceName = path.basename(inputPath);
    } else if (rawContent) {
      md = rawContent;
    }

    if (!md.trim()) return '❌ 没有可转换的内容';

    // 简单的 Markdown → HTML 转换（支持基础语法）
    const html = simpleMarkdownToHtml(md, title);

    // 生成内嵌样式的完整 HTML 页面
    const cssContent = customCss
      ? tryReadCss(customCss)
      : getDefaultHtmlStyles();

    const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
${cssContent}
</style>
</head>
<body class="document-body">
<button class="theme-toggle" id="themeToggle" title="切换暗色/明亮主题" aria-label="Toggle dark mode">\u{1F319}</button>
<article class="document-content">
${html}
</article>
<script>
(function(){
  var btn = document.getElementById('themeToggle');
  var html = document.documentElement;
  function getPreferred() {
    var saved = localStorage.getItem('qcli-theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function setTheme(theme) {
    html.setAttribute('data-theme', theme);
    btn.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\u{1F319}';
    btn.title = theme === 'dark' ? '\u5207\u6362\u4E3A\u660E\u4EAE\u6A21\u5F0F' : '\u5207\u6362\u4E3A\u6697\u8272\u6A21\u5F0F';
  }
  function toggleTheme() {
    var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem('qcli-theme', next);
    setTheme(next);
  }
  setTheme(getPreferred());
  btn.addEventListener('click', toggleTheme);
  var mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', function(e) {
    if (!localStorage.getItem('qcli-theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });
})();
</script>
</body>
</html>`;

    // 保存到 uploads 目录（可下载）
    const uploadsDir = GENERATED_UPLOADS_DIR;
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const filename = `doc_${Date.now()}_${sourceName.replace(/\.[^.]+$/, '')}.html`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, fullHtml, 'utf8');

    const fileSize = (fullHtml.length / 1024).toFixed(1);

    return buildResult('html', filepath, null, fileSize);

  } catch (err) {
    console.error('[DocConvert] HTML conversion error:', err.message);
    return `❌ HTML 转换失败: ${err.message}`;
  }
}

// ============================================================
// Simple Markdown → HTML Renderer
// ============================================================

function simpleMarkdownToHtml(md, title) {
  let html = '';
  const lines = md.split('\n');
  let inCodeBlock = false;
  let codeBlockContent = '';
  let codeBlockLang = '';
  let inList = false;
  let listOrdered = false;

  // 添加标题
  if (title) {
    html += `<h1 class="doc-title">${escapeHtml(title)}</h1>\n`;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Code block ──
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html += `<pre><code class="language-${escapeHtml(codeBlockLang)}">${escapeHtml(codeBlockContent)}</code></pre>\n`;
        codeBlockContent = '';
        codeBlockLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? '\n' : '') + line;
      continue;
    }

    // ── Empty line ──
    if (line.trim() === '') {
      if (inList) { inList = false; listOrdered = false; }
      html += '\n';
      continue;
    }

    // ── Horizontal rule ──
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      html += '<hr>\n';
      continue;
    }

    // ── Headings ──
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      html += `<h${level}>${renderInline(escapeHtml(text))}</h${level}>\n`;
      continue;
    }

    // ── Unordered list ──
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listOrdered) {
        if (inList) html += '</ol>\n';
        html += '<ul>\n';
        inList = true;
        listOrdered = false;
      }
      html += `<li>${renderInline(escapeHtml(ulMatch[2]))}</li>\n`;
      continue;
    }

    // ── Ordered list ──
    const olMatch = line.match(/^(\s*)\d+[.)]\s+(.+)$/);
    if (olMatch) {
      if (!inList || !listOrdered) {
        if (inList) html += '</ul>\n';
        html += '<ol>\n';
        inList = true;
        listOrdered = true;
      }
      html += `<li>${renderInline(escapeHtml(olMatch[2]))}</li>\n`;
      continue;
    }

    // ── Blockquote ──
    const bqMatch = line.match(/^>\s*(.*)$/);
    if (bqMatch) {
      html += `<blockquote>${renderInline(escapeHtml(bqMatch[1]))}</blockquote>\n`;
      continue;
    }

    // ── Table ──
    if (line.includes('|')) {
      const cells = line.split('|').filter(c => c.trim() !== '');
      const nextLine = lines[i + 1];
      const isHeader = nextLine && /^[\s|:.-]+$/.test(nextLine);
      if (isHeader) {
        html += '<table>\n<thead>\n<tr>';
        for (const cell of cells) {
          html += `<th>${renderInline(escapeHtml(cell.trim()))}</th>`;
        }
        html += '</tr>\n</thead>\n<tbody>\n';
        i++; // skip separator line
        continue;
      }
      // Data row (if inside a table)
      if (html.includes('<tbody>')) {
        html += '<tr>';
        for (const cell of cells) {
          html += `<td>${renderInline(escapeHtml(cell.trim()))}</td>`;
        }
        html += '</tr>\n';
        continue;
      }
    }

    // ── Paragraph (default) ──
    html += `<p>${renderInline(escapeHtml(line))}</p>\n`;
  }

  // Close any open tags
  if (inCodeBlock) {
    html += `<pre><code>${escapeHtml(codeBlockContent)}</code></pre>\n`;
  }
  if (inList) {
    html += listOrdered ? '</ol>\n' : '</ul>\n';
  }
  if (html.includes('<tbody>')) {
    html += '</tbody>\n</table>\n';
  }

  return html;
}

/**
 * 行内样式渲染（链接、加粗、斜体、行内代码）
 */
function renderInline(text) {
  // 图片: ![alt](url) — 必须在链接之前处理，否则 ![...] 会被链接正则错误匹配
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">');
  // 链接: [text](url) — 排除以 ! 开头的（已在上方作为图片处理）
  text = text.replace(/(?<!!)\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 加粗: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // 斜体: *text* or _text_
  text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
  text = text.replace(/_(.+?)_/g, '<em>$1</em>');
  // 行内代码: `code`
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 删除线: ~~text~~
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');
  return text;
}

// ============================================================
// HTML Template & CSS
// ============================================================

function getDefaultHtmlStyles() {
  return `
:root {
  --bg: #fafafa;
  --text: #1a1a2e;
  --text-secondary: #555;
  --accent: #6366f1;
  --border: #e2e8f0;
  --code-bg: #f1f5f9;
  --blockquote-bg: #f8fafc;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0e10;
    --text: #e4e4e7;
    --text-secondary: #a1a1aa;
    --accent: #818cf8;
    --border: #27272a;
    --code-bg: #18181b;
    --blockquote-bg: #18181b;
  }
}
/* Manual theme-toggle overrides (set via JS data-theme attribute) */
[data-theme="dark"] {
  --bg: #0d0e10;
  --text: #e4e4e7;
  --text-secondary: #a1a1aa;
  --accent: #818cf8;
  --border: #27272a;
  --code-bg: #18181b;
  --blockquote-bg: #18181b;
}
[data-theme="light"] {
  --bg: #fafafa;
  --text: #1a1a2e;
  --text-secondary: #555;
  --accent: #6366f1;
  --border: #e2e8f0;
  --code-bg: #f1f5f9;
  --blockquote-bg: #f8fafc;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans SC", sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.7;
  padding: 40px 20px;
}
.document-content {
  max-width: 800px;
  margin: 0 auto;
}
h1 { font-size: 2em; margin: 0.67em 0; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 0.3em; }
h2 { font-size: 1.5em; margin: 0.83em 0 0.5em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
h3 { font-size: 1.17em; margin: 1em 0 0.5em; }
h4 { font-size: 1em; margin: 1.33em 0 0.5em; }
p { margin: 0.5em 0; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
code {
  background: var(--code-bg);
  padding: 0.15em 0.35em;
  border-radius: 3px;
  font-family: "Cascadia Code", "Fira Code", Consolas, monospace;
  font-size: 0.9em;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  margin: 1em 0;
}
pre code { background: none; padding: 0; font-size: 13px; line-height: 1.5; }
blockquote {
  border-left: 3px solid var(--accent);
  background: var(--blockquote-bg);
  padding: 0.5em 1em;
  margin: 1em 0;
  color: var(--text-secondary);
}
table { width: 100%; border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid var(--border); padding: 8px 12px; text-align: left; }
th { background: var(--code-bg); font-weight: 600; }
tr:nth-child(even) { background: var(--blockquote-bg); }
ul, ol { margin: 0.5em 0; padding-left: 2em; }
li { margin: 0.25em 0; }
hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
img { max-width: 100%; border-radius: 4px; }
.doc-title { text-align: center; font-size: 2.2em; margin-bottom: 1.5em; }
/* Dark mode toggle button */
.theme-toggle {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 1000;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  opacity: 0.6;
}
.theme-toggle:hover {
  opacity: 1;
  transform: scale(1.1);
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
.theme-toggle:active {
  transform: scale(0.95);
}
  `;
}

function tryReadCss(cssSource) {
  try {
    // Try file path
    if (fs.existsSync(cssSource)) {
      return fs.readFileSync(cssSource, 'utf8');
    }
    // Return as inline CSS
    return cssSource;
  } catch {
    return getDefaultHtmlStyles();
  }
}

// ============================================================
// Helpers
// ============================================================

function generateOutputName(inputPath, format) {
  const base = inputPath
    ? path.basename(inputPath).replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')
    : 'document';
  const ext = format === 'markdown' ? 'md' : format;
  return `${base}_converted.${ext}`;
}

function buildResult(format, outputPath, warning, fileSize) {
  const relativePath = path.relative(process.cwd(), outputPath).replace(/\\/g, '/');
  const sizeStr = fileSize ? `${fileSize} KB` : formatFileSize(fs.statSync(outputPath).size);

  let result = `## 📄 转换成功\n\n`;
  result += `| 属性 | 值 |\n|------|-----|\n`;
  result += `| 格式 | ${format.toUpperCase()} |\n`;
  result += `| 大小 | ${sizeStr} |\n`;
  result += `| 路径 | \`${relativePath}\` |\n`;
  result += `| 下载 | [点击下载](/uploads/${encodeURIComponent(path.basename(outputPath))}) |\n`;

  if (format === 'html') {
    result += `| 预览 | [打开 HTML](/uploads/${encodeURIComponent(path.basename(outputPath))}) |\n`;
  }

  if (warning) {
    result += `\n> ${warning}\n`;
  }

  return result;
}

const _NO_ENGINE = Symbol('no_engine');

/**
 * 检测可用的 PDF 引擎（结果缓存）
 * @returns {string|null}
 */
async function detectPdfEngine() {
  if (_pdfEngineCache !== undefined) return _pdfEngineCache === _NO_ENGINE ? null : _pdfEngineCache;
  const engines = ['wkhtmltopdf', 'weasyprint', 'prince', 'pdfroff'];
  for (const engine of engines) {
    const r = await checkOutput(isWin ? 'where' : 'which', [engine], { timeout: 3000 });
    if (r != null) {
      _pdfEngineCache = engine;
      return engine;
    }
  }
  _pdfEngineCache = _NO_ENGINE;
  return null;
}

function escapeShellArg(arg) {
  if (isWin) {
    return arg.replace(/"/g, '\\"');
  }
  return arg.replace(/'/g, "'\\''");
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes  } B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)  } KB`;
  return `${(bytes / 1048576).toFixed(1)  } MB`;
}

/**
 * 获取 pandoc 安装指南
 */
function getPandocInstallGuide(format, contentPreview) {
  const isMac = process.platform === 'darwin';

  let guide = `## ⚠️ 需要安装 pandoc\n\n`;
  guide += `格式 **${format.toUpperCase()}** 需要安装 **pandoc** 命令行工具。\n\n`;

  guide += `### 📥 安装 pandoc\n\n`;
  if (isWin) {
    guide += `- **Windows**: 下载安装包 https://pandoc.org/installing.html\n`;
    guide += `  \`winget install pandoc\`\n\n`;
  } else if (isMac) {
    guide += `- **macOS**: \`brew install pandoc\`\n\n`;
  } else {
    guide += `- **Linux**: \`sudo apt install pandoc\` 或 \`sudo dnf install pandoc\`\n\n`;
  }

  guide += `- **验证安装**: \`pandoc --version\`\n\n`;

  // 如果没有 pandoc 但格式是 HTML，提示可以降级
  if (format !== 'html') {
    guide += `### 💡 当前可用的替代方案\n\n`;
    guide += `- **HTML 格式**（无需 pandoc）：将 format 设为 "html"\n`;
    guide += `- 或先转 HTML，再用浏览器"另存为 PDF"\n\n`;
  }

  // 显示内容预览
  if (contentPreview) {
    guide += `### 📝 内容预览（前 500 字符）\n\n`;
    guide += `\`\`\`\n${contentPreview.slice(0, 500)}\n\`\`\`\n`;
  }

  return guide;
}

/**
 * 检测包管理器
 */
async function getPkgManager() {
  if (_pkgManagerCache) return _pkgManagerCache;
  if (await checkOutput('pnpm', ['--version'], { timeout: 2000 })) _pkgManagerCache = 'pnpm';
  else if (await checkOutput('yarn', ['--version'], { timeout: 2000 })) _pkgManagerCache = 'yarn';
  else _pkgManagerCache = 'npm';
  return _pkgManagerCache;
}

module.exports = {
  register,
  // Exported for testing
  simpleMarkdownToHtml,
  renderInline,
  escapeHtml,
  formatFileSize,
  escapeShellArg,
  generateOutputName,
  getPandocInstallGuide,
  getDefaultHtmlStyles,
  buildResult,
  detectPandoc,
  detectPdfEngine,
  convertWithPandoc,
  getPkgManager,
  tryReadCss,
};
