/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Bot Config — platform credential storage for 通讯接入 A
//
// 平台凭证存储：env 优先（HESI_BOT_<PLATFORM>_*），设置页写入
// data/bots-config.json 覆盖（被 .gitignore 覆盖，不入库）。
// 读取时脱敏：getConfig() 返回时密钥已打码（只留尾 4 位）。
// ============================================================
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'bots-config.json');

/** 各平台凭证 env key 映射（新增平台在此登记）。 */
const PLATFORM_ENV = {
  qq: [
    { key: 'HESI_BOT_QQ_APPID', field: 'appId', label: 'AppID' },
    { key: 'HESI_BOT_QQ_SECRET', field: 'secret', label: 'AppSecret' },
  ],
  'wechat-bot': [
    { key: 'HESI_BOT_WECHAT_TOKEN', field: 'botToken', label: 'Bot Token' },
    { key: 'HESI_BOT_WECHAT_BASEURL', field: 'baseurl', label: 'Base URL' },
  ],
  // M2+ 平台（按需补充）
  // wecom:  [{ key: 'HESI_BOT_WECOM_TOKEN', field: 'token', label: 'Token' }],
  // feishu: [{ key: 'HESI_BOT_FEISHU_APP_ID', field: 'appId', label: 'App ID' }, { key: 'HESI_BOT_FEISHU_APP_SECRET', field: 'appSecret', label: 'App Secret' }],
  // dingtalk: [{ key: 'HESI_BOT_DINGTALK_TOKEN', field: 'token', label: 'Token' }],
};

/** 从 env 读平台凭证（运行时读，便于测试覆盖）。 */
function readFromEnv(platform) {
  const fields = PLATFORM_ENV[platform] || [];
  const out = {};
  for (const f of fields) {
    const v = process.env[f.key];
    if (v) out[f.field] = v;
  }
  return out;
}

/** 读 data/bots-config.json（不存在返回空对象）。 */
function readFileConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch (e) {
    console.warn('[bot-config] read failed:', e && e.message);
    return {};
  }
}

/** 写 data/bots-config.json（原子写：先 tmp 后 rename）。 */
function writeFileConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, CONFIG_FILE);
    return true;
  } catch (e) {
    console.warn('[bot-config] write failed:', e && e.message);
    return false;
  }
}

/** 打码：只留尾 4 位。 */
function mask(secret) {
  if (!secret) return '';
  const s = String(secret);
  if (s.length <= 8) return '****';
  return `****${s.slice(-4)}`;
}

/**
 * 获取某平台生效配置（env 优先，data 覆盖补缺）。
 * @param {string} platform
 * @returns {{ appId?: string, secret?: string, source: 'env'|'file'|'none', masked: Record<string,string> }}
 */
function getConfig(platform) {
  const env = readFromEnv(platform);
  const file = (readFileConfig()[platform] || {});
  const merged = { ...file, ...env };
  return {
    ...merged,
    source: Object.keys(env).some(k => env[k]) ? 'env' : (Object.keys(file).some(k => file[k]) ? 'file' : 'none'),
    masked: Object.fromEntries(
      (PLATFORM_ENV[platform] || [])
        .map(f => [f.field, mask(merged[f.field])])
    ),
  };
}

/**
 * 保存某平台凭证（写入 data/bots-config.json；env 配置的平台保存会告警但不覆盖 env）。
 * @param {string} platform
 * @param {Record<string,string>} fields — 如 { appId, secret }
 * @returns {{ ok: boolean, error?: string, warning?: string }}
 */
function saveConfig(platform, fields) {
  if (!PLATFORM_ENV[platform]) {
    return { ok: false, error: `unknown platform: ${platform}` };
  }
  const clean = {};
  for (const f of PLATFORM_ENV[platform]) {
    const v = fields && fields[f.field];
    if (typeof v === 'string' && v.trim()) clean[f.field] = v.trim();
  }
  if (Object.keys(clean).length === 0) {
    return { ok: false, error: 'no credentials provided' };
  }
  const cfg = readFileConfig();
  cfg[platform] = { ...(cfg[platform] || {}), ...clean };
  if (!writeFileConfig(cfg)) {
    return { ok: false, error: 'failed to write config file' };
  }
  // 若该平台在 env 有配置，提示 env 优先（改 env 才能生效）
  const env = readFromEnv(platform);
  const warning = Object.keys(env).some(k => env[k])
    ? '该平台凭证当前来自环境变量（优先于设置页），如需用新配置请同时修改 .env'
    : undefined;
  return { ok: true, warning };
}

/** 平台是否已配置（env 或 file 任一有值）。 */
function isConfigured(platform) {
  return getConfig(platform).source !== 'none';
}

module.exports = { getConfig, saveConfig, isConfigured, PLATFORM_ENV, readFromEnv };
