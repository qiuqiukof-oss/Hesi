/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';

// ============================================================
// extract-content.js — 浏览器内（活 DOM）内容抽取
//
// 关键认知：
//   - 噪音的根因是「抽取粒度太粗」(body.innerText 把导航/页脚/广告全卷进来)，
//     不是「输出格式是文本」。所以降噪在这里默认开启，与 JSON 无关。
//   - 必须在活 DOM 里跑（page.evaluate），因为 Bing/Google 等结果是
//     JS 异步注入的，server-side 解析拿不到正文——这正是本机 CDP 方案
//     相对 web_search API 的天然优势。
//
// 两种模式：
//   - 'search'：把 SERP 解析成干净的 [{title, url, snippet}] 列表
//               （搜索引擎结果是 <a>/<div> 列表，没有语义 article 标签，
//                故不能套用 fetch 的 article/main 选择器，必须单独处理）
//   - 'fetch' ：抽取正文节点、剥离 nav/footer/aside/广告，
//               返回 {title, description, content, links}
//
// 返回同时带 rawChars（原始 body 文本长度），供上层测算降噪比例。
// ============================================================

// 本函数会被序列化进浏览器执行（Playwright 只带走函数体，不带外部闭包），
// 因此所有常量必须定义在函数内部，禁止引用模块级变量。
function pageExtractFn(mode) {
  // 搜索引擎自身域名（SERP 解析时跳过其站内链接，只保留真实结果）
  const SERP_HOST_RE = /(bing|google|baidu|duckduckgo|search\.|yahoo|sogou|so\.com|ask\.|yandex|ecosia)/i;
  // 正文候选容器（按优先级，取文本最密者）
  const CONTENT_CANDIDATES = [
    'article', 'main', '[role="main"]', '#content', '.content', '#main',
    '.post-body', '.article-body', '.post-content', '.entry-content',
    '.story-body', '.markdown-body', '.prose', '.post', '.article',
  ];
  // 噪音块（fetch 兜底时从克隆 DOM 中剔除）
  const NOISE_SELECTORS = [
    'nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'iframe',
    '.sidebar', '.side-panel', '.ad', '.ads', '.advertisement', '.promo',
    '.banner', '.cookie', '.cookie-banner', '.popup', '.modal',
    '.related', '.recommend', '.nav', '.navbar', '.menu', '.skip-link',
    '.sr-only', '.visually-hidden', '#sidebar', '#footer', '#header', '#nav',
  ];

  const clean = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());
  // 用 textContent 而非 innerText：Chrome content-visibility 懒渲染会让
  // innerText 只计可见区（SERP 屏外结果不计入），textContent 是全量文本，
  // 作「整页内容量」的稳定参照，降噪比例才可比。
  const rawChars = document.body ? document.body.textContent.length : 0;

  function extractSearch() {
    // 优先锁定结果区根节点，缩小扫描范围
    const root =
      document.querySelector('#b_results') ||
      document.querySelector('#search') ||
      document.body;
    const anchors = Array.from(root.querySelectorAll('a[href]'));
    const out = [];
    const seen = new Set();
    for (const a of anchors) {
      let href = a.href;
      // Bing 结果 href 是 https://www.bing.com/ck/a?... 包装：
      //   旧版带 u=<base64url 真实URL>（可解码）；新版带加密 p=（不可解码），
      //   但 anchor 文本里自带可见真实 URL（如 "nodejs.orghttps://nodejs.org"）。
      // 统一处理：是 ck 重定向 → 优先解码 u=，失败则从 anchor 文本提取真实 URL。
      try {
        const u0 = new URL(a.href);
        if (/(bing|msn|microsoft)/i.test(u0.hostname) && u0.pathname.startsWith('/ck/')) {
          const real = decodeRedirectUrl(a.href) || urlFromAnchorText(a.textContent);
          if (real) href = real;
        }
      } catch { /* 非法 URL 走下方过滤 */ }
      let u;
      try {
        u = new URL(href);
      } catch {
        continue;
      }
      if (!/^https?:/i.test(u.protocol)) continue;
      // 引擎自身链接跳过——已还原出真实 URL 的结果链接已不再是引擎域名
      if (SERP_HOST_RE.test(u.hostname)) continue;
      let title = clean(a.textContent);
      if (title.length < 3) continue;
      // 去掉标题里 Bing 注入的站点 URL 噪音（如 "runoob.comhttps://... › nodejs"）
      title = title.replace(/\s*https?:\/\/[^\s]*/g, ' ').replace(/\s*›\s*/g, ' ').replace(/\s+/g, ' ').trim();
      if (title.length < 3) continue;
      if (seen.has(href)) continue;
      // 片段：先按结果块语义定位（.b_algo / li / .g / article），找不到再爬父链找文本更长的容器
      let block = a.closest('.b_algo, li, .g, article');
      if (!block) {
        let el = a.parentElement;
        while (el && el !== document.body) {
          if (clean(el.innerText).length > title.length + 40) { block = el; break; }
          el = el.parentElement;
        }
      }
      let snippet = '';
      if (block) {
        const p = block.querySelector(
          'p, .b_caption, .b_paractl, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, .VwiC3b, .snippet, [class*="snippet"], [class*="lineclamp"]'
        );
        // snippet 截断 150 字符：够 AI 判断相关性，大幅省 token（Tavily 单条 ~200 字符）
        snippet = clean(p ? p.textContent : '').slice(0, 150);
      }
      seen.add(href);
      out.push({ title, url: href, snippet });
      if (out.length >= 8) break; // 前 8 条足够，省 token
    }
    return out;
  }

  // Bing/Google 结果重定向解码：/ck/a?...&u=<base64url> 还原真实 URL；非重定向返回 null
  function decodeRedirectUrl(href) {
    try {
      const u = new URL(href);
      if (!/(bing|msn|microsoft)/i.test(u.hostname)) return null;
      if (u.pathname !== '/ck/a' && !u.pathname.startsWith('/ck/')) return null;
      const raw = u.searchParams.get('u');
      if (!raw) return null;
      const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
      const dec = atob(b64);
      const m = dec.match(/https?:\/\/[^\s"'<>]+/);
      return m ? m[0] : null;
    } catch {
      return null;
    }
  }

  // 从 anchor 文本里提取 Bing 注入的可见真实 URL（新版 ck/a 无 u= 参数时用）
  // 例："nodejs.orghttps://nodejs.org › en › download" → https://nodejs.org/en/download
  function urlFromAnchorText(text) {
    const s = String(text || '');
    const m = s.match(/https?:\/\/[^\s"'<>]+/);
    if (!m) return null;
    let url = m[0].replace(/[.,;:)\]}>]+$/, '');
    const rest = s.slice(m.index + m[0].length);
    const pm = rest.match(/^\s*›\s*([^›"'<>]+)/);
    if (pm) {
      const seg = pm[1].trim().replace(/\s+/g, '-').replace(/[.,;:)\]}>]+$/, '');
      if (seg) url += '/' + seg;
    }
    return url;
  }

  function extractContent() {
    let bestEl = null;
    let bestLen = 0;
    for (const sel of CONTENT_CANDIDATES) {
      const el = document.querySelector(sel);
      const len = clean(el ? el.innerText : '').length;
      if (len > bestLen) {
        bestLen = len;
        bestEl = el;
      }
    }
    let contentEl = bestEl;
    let content = clean(bestEl ? bestEl.innerText : '');
    // 兜底：候选都太短 → 剥噪音块后取 body
    if (content.length < 200) {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll(NOISE_SELECTORS.join(', ')).forEach((e) => e.remove());
      content = clean(clone.innerText);
      contentEl = document.body;
    }
    const h1 = document.querySelector('h1');
    const title =
      clean(document.title) || (h1 ? clean(h1.innerText) : '');
    const metaEl = document.querySelector('meta[name="description"]');
    const description = clean(metaEl ? metaEl.getAttribute('content') : '');
    const linkEls = (contentEl || document.body).querySelectorAll('a[href]');
    const seen = new Set();
    const links = [];
    for (const a of linkEls) {
      const href = a.href; // a.href 对相对路径也会解析出绝对地址
      const text = clean(a.textContent).slice(0, 80);
      if (!/^https?:/i.test(href) || seen.has(href) || !text) continue;
      seen.add(href);
      links.push({ text, href });
      if (links.length >= 30) break;
    }
    return { title, description, content, links };
  }

  // 验证码/风控页特征（命中则上层明确报错，避免静默空结果误导 AI）
  const CAPTCHA_RE = /captcha|verify.*(?:human|robot|you'?re not a robot)|unusual traffic|denied.*automated|access.*denied|enable javascript and cookies|请输入验证码|安全验证|验证码|请完成.*验证|检测到异常流量/i;

  const structured = mode === 'search' ? extractSearch() : extractContent();
  return {
    url: location.href,
    title: document.title,
    mode,
    rawChars,
    structured,
    captcha: CAPTCHA_RE.test(document.body ? document.body.innerText : ''),
  };
}

/**
 * 在活 DOM 中抽取结构化内容。
 * @param {import('playwright').Page} page
 * @param {'search'|'fetch'} mode
 * @returns {Promise<{url:string,title:string,mode:string,rawChars:number,structured:any}>}
 */
async function extractPage(page, mode) {
  return await page.evaluate(pageExtractFn, mode);
}

module.exports = { extractPage, pageExtractFn };
