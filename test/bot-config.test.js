/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Unit tests for lib/bot-config (通讯接入 A · 凭证存储)
//   - env 优先 / data 覆盖补缺
//   - 脱敏读取（masked 只留尾 4 位）
//   - saveConfig 写 data/bots-config.json + 环境变量优先告警
//   - isConfigured 判定
'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'bots-config.json');
const savedEnv = { ...process.env };

beforeEach(() => {
  // 清掉测试相关的 env 与配置文件
  delete process.env.HESI_BOT_QQ_APPID;
  delete process.env.HESI_BOT_QQ_SECRET;
  try { if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE); } catch { /* ignore */ }
});

afterEach(() => {
  process.env = savedEnv;
  try { if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE); } catch { /* ignore */ }
  try { if (fs.existsSync(`${CONFIG_FILE}.tmp`)) fs.unlinkSync(`${CONFIG_FILE}.tmp`); } catch { /* ignore */ }
});

const botConfig = () => require('../lib/bot-config');

test('getConfig: 无配置 → source=none, masked 空', () => {
  const cfg = botConfig().getConfig('qq');
  assert.strictEqual(cfg.source, 'none');
  assert.strictEqual(cfg.masked.appId, '');
});

test('getConfig: env 配置 → source=env + 脱敏', () => {
  process.env.HESI_BOT_QQ_APPID = 'APPID12345678';
  process.env.HESI_BOT_QQ_SECRET = 'SECRET-abcdefgh';
  const cfg = botConfig().getConfig('qq');
  assert.strictEqual(cfg.source, 'env');
  assert.strictEqual(cfg.appId, 'APPID12345678');
  assert.strictEqual(cfg.masked.appId, '****5678');
  assert.strictEqual(cfg.masked.secret, '****efgh');
});

test('saveConfig: 写 data 文件 → source=file + 可读回', () => {
  const r = botConfig().saveConfig('qq', { appId: 'file-app', secret: 'file-secret' });
  assert.strictEqual(r.ok, true);
  const cfg = botConfig().getConfig('qq');
  assert.strictEqual(cfg.source, 'file');
  assert.strictEqual(cfg.appId, 'file-app');
  assert.strictEqual(cfg.secret, 'file-secret');
});

test('saveConfig: env 存在时保存 → 告警（env 优先）', () => {
  process.env.HESI_BOT_QQ_APPID = 'env-app';
  process.env.HESI_BOT_QQ_SECRET = 'env-secret';
  const r = botConfig().saveConfig('qq', { appId: 'file-app', secret: 'file-secret' });
  assert.strictEqual(r.ok, true);
  assert.match(r.warning || '', /环境变量/);
  // env 仍优先
  const cfg = botConfig().getConfig('qq');
  assert.strictEqual(cfg.appId, 'env-app');
  assert.strictEqual(cfg.source, 'env');
});

test('saveConfig: 未知平台拒绝', () => {
  const r = botConfig().saveConfig('nope', { appId: 'x' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error || '', /unknown platform/);
});

test('saveConfig: 空凭证拒绝', () => {
  const r = botConfig().saveConfig('qq', { appId: '', secret: '  ' });
  assert.strictEqual(r.ok, false);
  assert.match(r.error || '', /no credentials/);
});

test('isConfigured: env/file 任一有值即 true', () => {
  assert.strictEqual(botConfig().isConfigured('qq'), false);
  process.env.HESI_BOT_QQ_APPID = 'a';
  process.env.HESI_BOT_QQ_SECRET = 'b';
  assert.strictEqual(botConfig().isConfigured('qq'), true);
});
