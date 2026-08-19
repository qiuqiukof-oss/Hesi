/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tool: web_fetch
//
// 获取 URL 内容，返回纯文本或 HTML。
// 支持 JSON 自动格式化，自动清洗 HTML 标签。
// 可选 Playwright JS 渲染降级。
// ============================================================

/**
 * 在当前 registry 上注册 web_fetch 工具。
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'web_fetch',
    noTruncate: true, // 内部自己做截断
    description: '获取一个 URL 的内容并返回纯文本/HTML。适用于读取网页、API 响应、文档等。注意：某些网站可能会屏蔽自动化抓取。中文：抓取网页内容',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要抓取的完整 URL（必须以 http:// 或 https:// 开头）',
        },
        maxLength: {
          type: 'number',
          description: '最大返回字符数，默认 10000，最大 50000',
          default: 10000,
        },
        format: {
          type: 'string',
          enum: ['text', 'html'],
          description: '返回格式：text（纯文本，自动去标签）或 html（原始 HTML）',
          default: 'text',
        },
        jsRender: {
          type: 'boolean',
          description: '如果页面是 SPA 或需要 JS 渲染，尝试使用 Playwright 渲染（需要已安装 playwright）',
          default: false,
        },
      },
      required: ['url'],
    },
    execute: async (args, broadcastFn) => {
      const url = (args.url || '').trim();
      const maxLength = Math.min(args.maxLength || 10000, 50000);
      const format = args.format || 'text';
      const useJsRender = args.jsRender === true;

      if (!url) return 'Error: url is required';
      if (!/^https?:\/\//i.test(url)) return 'Error: URL must start with http:// or https://';

      try {
        // 基本 fetch
        let content;
        let contentType;
        let statusCode;

        if (useJsRender) {
          // 尝试 Playwright JS 渲染
          const rendered = await _fetchWithPlaywright(url);
          if (rendered) {
            content = rendered;
            contentType = 'text/html';
            statusCode = 200;
          } else {
            // Playwright 不可用，降级到普通 fetch
            const basic = await _basicFetch(url, format);
            content = basic.content;
            contentType = basic.contentType;
            statusCode = basic.statusCode;
          }
        } else {
          const basic = await _basicFetch(url, format);
          content = basic.content;
          contentType = basic.contentType;
          statusCode = basic.statusCode;
        }

        // 如果普通 fetch 返回空/极少内容，自动尝试 Playwright 渲染
        if (!useJsRender && content.trim().length < 200 && !contentType.includes('json')) {
          const rendered = await _fetchWithPlaywright(url);
          if (rendered && rendered.trim().length > content.trim().length) {
            content = rendered;
          }
        }

        if (content.length > maxLength) {
          content = `${content.slice(0, maxLength) 
            }\n\n[... 内容已截断，共 ${content.length} 字符，显示前 ${maxLength} 字符]`;
        }

        return `URL: ${url}\nStatus: ${statusCode}\nContent-Type: ${contentType}\n\n${content}`;
      } catch (err) {
        const { classifyError } = require('../errors');
        const e = classifyError(err);
        // 对某些错误类型提供额外建议
        const suggestion = e.type === 'NETWORK_ERROR' ? ' 建议：检查网络连接或尝试其他 URL。' :
          e.type === 'TIMEOUT' ? ' 建议：网站可能过慢，可尝试 jsRender=true（如已安装 Playwright）。' :
          e.type === 'FORBIDDEN' ? ' 建议：该网站屏蔽了自动化抓取。' : '';
        return `[${e.type}] ${e.message}${suggestion}`;
      }
    },
  });
}

/**
 * 使用 Node.js fetch 获取 URL 内容并清洗。
 */
async function _basicFetch(url, format) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });

  const contentType = resp.headers.get('content-type') || 'unknown';
  const statusCode = resp.status;

  if (!resp.ok) {
    throw Object.assign(new Error(`HTTP ${resp.status} ${resp.statusText}`), { status: resp.status, response: { status: resp.status } });
  }

  let content;
  if (contentType.includes('application/json')) {
    const json = await resp.json();
    content = JSON.stringify(json, null, 2);
  } else {
    const text = await resp.text();
    if (format === 'text') {
      content = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } else {
      content = text;
    }
  }

  return { content, contentType, statusCode };
}

/**
 * 使用 Playwright 渲染页面并提取文本。
 * 需要已安装 playwright npm 包。
 */
async function _fetchWithPlaywright(url) {
  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      const text = await page.evaluate(() => document.body.innerText);
      return text.replace(/\n{3,}/g, '\n\n').trim();
    } finally {
      await browser.close();
    }
  } catch {
    // Playwright 未安装或启动失败
    return null;
  }
}

module.exports = { register };
