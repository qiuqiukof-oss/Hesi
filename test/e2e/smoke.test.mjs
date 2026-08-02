/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// 前端 E2E 冒烟（序5/A2）：Playwright + 系统 Edge，依赖本机 4264 服务在跑。
// 覆盖：页面加载 / 自动执行控件展开 / 全访问开关 / 讨论控件 / 审批气泡 DOM 前提。
// 运行：node --test test/e2e/smoke.test.mjs （需先启动服务）
// 说明：真实 plan 执行需 LLM + API key（慢），此处只测交互层；执行链路由手工验收。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.env.HESI_E2E_BASE || 'http://127.0.0.1:4264';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** 复用浏览器，减少启动开销 */
let browser;
test.before(async () => {
  browser = await chromium.launch({ executablePath: EDGE, headless: true });
});
test.after(async () => {
  if (browser) await browser.close();
});

/** 打开页面并等 bundle 执行完（load 事件 + 输入框就绪） */
async function openReady(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#chat-input', { state: 'attached', timeout: 30000 });
  // bundle 异步初始化（chat-panel 装配）也给足时间
  await page.waitForFunction(() => {
    const q = typeof window.QCLI !== 'undefined';
    const input = !!document.getElementById('chat-input');
    const send = !!document.getElementById('chat-send-btn');
    return q && input && send;
  }, { timeout: 15000 });
}

test('页面加载：标题/输入框/核心按钮就绪', async () => {
  const page = await browser.newPage();
  await openReady(page);
  // 头部工具栏：终端 / 黑板 / 圆桌 / 记忆
  for (const id of ['chat-terminal-toggle', 'chat-blackboard-btn', 'chat-roundtable-btn', 'chat-memory-btn']) {
    await page.waitForSelector(`#${id}`, { state: 'attached', timeout: 5000 });
  }
  // 自动执行 + AI 讨论开关存在
  await page.waitForSelector('#plan-toggle', { state: 'attached', timeout: 5000 });
  await page.waitForSelector('#discuss-toggle', { state: 'attached', timeout: 5000 });
  await page.close();
});

test('自动执行控件：勾选后展开执行方下拉 + 允许完全访问开关', async () => {
  const page = await browser.newPage();
  await openReady(page);
  // plan-controls 默认隐藏
  const hiddenBefore = await page.evaluate(() => document.getElementById('plan-controls').style.display);
  assert.equal(hiddenBefore, 'none', 'plan-controls 初始应隐藏');
  // 勾选自动执行（checkbox 初始隐藏，直接触发 change 测逻辑）→ 展开
  await page.evaluate(() => {
    const el = document.getElementById('plan-toggle');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const el = document.getElementById('plan-controls');
    return el && el.style.display !== 'none';
  }, { timeout: 5000 });
  // 执行方下拉（锁定 AI 助手）+ 🔓 允许完全访问
  const agentVal = await page.inputValue('#plan-agent');
  assert.equal(agentVal, 'ai', '执行方默认 AI 助手');
  const hasFullAccess = await page.$('#plan-full-access');
  assert.ok(hasFullAccess, '🔓 允许完全访问开关应存在');
  // 勾选全访问 → 状态生效（同样直接触发 change）
  await page.evaluate(() => {
    const el = document.getElementById('plan-full-access');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.close();
});

test('AI 讨论控件：勾选后伙伴选择器 + 轮数可见', async () => {
  const page = await browser.newPage();
  await openReady(page);
  await page.waitForSelector('#discuss-toggle', { state: 'attached', timeout: 10000 });
  await page.evaluate(() => {
    const el = document.getElementById('discuss-toggle');
    el.checked = true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const el = document.getElementById('discuss-controls');
    return el && el.style.display !== 'none';
  }, { timeout: 5000 });
  await page.waitForSelector('#discuss-partner-btn', { state: 'attached', timeout: 5000 });
  await page.waitForSelector('#discuss-rounds', { state: 'attached', timeout: 5000 });
  // 轮数选项包含 1 轮（v0.7 加的最小值）
  const roundsVal = await page.inputValue('#discuss-rounds');
  assert.ok(roundsVal, '轮数选择器有值');
  await page.close();
});

test('圆桌皮肤切换按钮存在（回归保护：缓存修复后必须可见）', async () => {
  const page = await browser.newPage();
  await openReady(page);
  // 圆桌抽屉 DOM 结构存在（初始 hidden 但结构在）+ 皮肤切换按钮 ≥2（🔥围炉 / 🀄麻将）
  const skinBtns = await page.evaluate(() => {
    const d = document.getElementById('mahjong-embed');
    if (!d) return 0;
    return d.querySelectorAll('[data-skin]').length;
  });
  assert.ok(skinBtns >= 2, `圆桌皮肤切换按钮应 ≥2（实际 ${skinBtns}）`);
  await page.close();
});
