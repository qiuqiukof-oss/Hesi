/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// WorkBuddy 广场 — 把 WorkBuddy 的「专家 / 技能 / 连接器」广场内容
// 链接出来，形态对标 Hesi 插件广场（独立页面 + 只读卡片）。
//
// 数据源优先级：
//   1) 本地连接器缓存  ~/.workbuddy/connectors-marketplace/connectors/
//      （每个目录含 connector-meta.json / icon.svg / mcp.json，结构化、可读）
//   2) 内置精选目录    data/workbuddy-hub-catalog.json
//      （缓存目录缺失 / 升级后结构变化时降级；含专家/技能外链条目）
//
// 专家 / 技能：WorkBuddy 在线广场未开放本地 API（实测 cnb.cool/skills 404），
// 其结构化数据存于 WorkBuddy 数据库，Hesi 仅作「外链卡片」呈现，点击跳转查看。
// ============================================================
const fs = require('fs');
const path = require('path');
const express = require('express');

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const MARKET_DIR = path.join(HOME, '.workbuddy', 'connectors-marketplace', 'connectors');
// Vendored connector definitions inside the Hesi project tree — authoritative
// source so the hub works without WorkBuddy installed. WB_MARKET_DIR is a
// secondary fallback for connectors newer than what was vendored.
const VENDOR_CONNECTORS = path.join(__dirname, '..', 'vendor', 'connectors');
const CATALOG_PATH = path.join(__dirname, '..', 'data', 'workbuddy-hub-catalog.json');

// ── source -> 分类映射（让广场可按类别浏览） ──
const CATEGORY_MAP = {
  agentkey: '数据检索', anydev: '开发云', awesun: '远程控制', 'baidu-netdisk': '云存储',
  bugly: '质量监控', 'bugly-token': '质量监控', canva: '设计创作', cloudbase: '开发云',
  'cnb-api': '代码托管', 'cnb-woa': '代码托管', 'ctrip-wendao': '智能问答', dingtalk: '通讯协作',
  'fbs-connector': '客服', feishu: '通讯协作', 'fyopen-lawsearch': '法律合规', gildata: '金融数据',
  github: '代码托管', 'gongfeng-woa': '代码托管', 'ima-mcp': '知识库', 'iwiki-woa': '知识库',
  kdocs: '文档协作', km: '知识库', lexiang: '知识库', 'mastergo-vibe-mcp': '设计创作',
  'neo-crm': '客户管理', 'netease-mail': '邮件', notion: '笔记知识', 'patsnap-search': '专利检索',
  pkulaw: '法律合规', 'qcc-company': '企业查询', qingflow: '流程协作', 'qixinhuiyan-mcp': '企业查询',
  'qq-mail': '邮件', 'region-insight': '区域洞察', tapd: '研发协作', 'tapd-woa': '研发协作',
  'tc-chengxin': '旅行出行', 'tdx-connector': '金融行情', 'tencent-docs': '文档协作',
  'tencent-docs-oa': '文档协作', 'tencent-health-nges': '医疗健康', 'tencent-map': '地图位置',
  'tencent-qidian-cs': '客服', 'tencent-survey': '问卷调研', 'tencent-weiyun': '云存储',
  tencentads: '营销投放', tmeet: '会议', 'tyc-mcp': '企业查询', wecom: '通讯协作',
  'weisheng-scrm': '客户管理', 'westock-mcp': '金融行情', 'wk-workbuddy': '法律合规',
  'xiaoe-cloud-cli': '电商', 'yuandian-mcp': '法律合规', 'zfs-fssc-ai': '财务',
  'zhiyan-cicd': '研发协作', zsxq: '知识社区',
};

function classify(source, desc) {
  if (CATEGORY_MAP[source]) return CATEGORY_MAP[source];
  const d = (desc || '').toLowerCase();
  if (/股票|行情|股价|金融|投/.test(d)) return '金融行情';
  if (/法律|合规|法条|判例/.test(d)) return '法律合规';
  if (/文档|笔记|知识|wiki|协作文档/.test(d)) return '文档协作';
  if (/邮件|通讯|IM|聊天|会议/.test(d)) return '通讯协作';
  if (/云|部署|容器|serverless/.test(d)) return '开发云';
  if (/搜索|检索|爬|数据/.test(d)) return '数据检索';
  return '其他工具';
}

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch (e) { return fallback; }
}

// 解析所有连接器来源目录：vendor 优先，WB 缓存回退（按 source id 去重，vendor 胜）
function resolveConnectorSources() {
  const map = new Map();
  const bases = [VENDOR_CONNECTORS, MARKET_DIR]; // vendor first
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    let dirs = [];
    try { dirs = fs.readdirSync(base); } catch (e) { continue; }
    for (const d of dirs) {
      let st;
      try { st = fs.statSync(path.join(base, d)); } catch (e) { continue; }
      if (!st.isDirectory()) continue;
      if (!map.has(d)) map.set(d, base); // first wins => vendor overrides WB cache
    }
  }
  return map;
}

// 把本地（vendor + WB 缓存）目录下的连接器读成结构化卡片数组
function readConnectorsFromCache() {
  const sources = resolveConnectorSources();
  if (sources.size === 0) return [];
  const entries = [];
  for (const [source, base] of sources) {
    const dir = path.join(base, source);
    const metaPath = path.join(dir, 'connector-meta.json');
    const meta = fs.existsSync(metaPath) ? safeJsonParse(fs.readFileSync(metaPath, 'utf-8'), null) : null;

    // 图标：svg -> base64 data URI（内联，避免额外图标路由）
    let iconDataUri = null;
    const iconPath = path.join(dir, 'icon.svg');
    if (fs.existsSync(iconPath)) {
      try {
        const buf = fs.readFileSync(iconPath);
        iconDataUri = `data:image/svg+xml;base64,${  buf.toString('base64')}`;
      } catch (e) { /* ignore */ }
    }

    // MCP 配置：读取原始 JSON 文本（供「复制配置」）；空文件标记 null
    let mcpConfig = null;
    const mcpPath = path.join(dir, 'mcp.json');
    if (fs.existsSync(mcpPath)) {
      try {
        const raw = fs.readFileSync(mcpPath, 'utf-8').trim();
        if (raw) mcpConfig = raw;
      } catch (e) { /* ignore */ }
    }

    // 名称美化（无 meta 时把 source 转可读名，如 baidu-netdisk -> Baidu Netdisk）
    const prettyName = source.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const nameZh = (meta && (meta.name_zh || meta.name || meta.name_en)) || prettyName;
    const desc = (meta && (meta.description_zh || meta.description || meta.description_en)) || '';
    entries.push({
      source,
      id: source,
      name: nameZh,
      nameEn: (meta && (meta.name_en || meta.name)) || prettyName,
      description: desc,
      category: classify(source, desc),
      type: (meta && meta.type) || 'mcp',
      version: (meta && meta.version) || '',
      minWorkbuddyVersion: (meta && meta.minWorkbuddyVersion) || '',
      icon: iconDataUri,
      mcpConfig,
      hasMcpConfig: !!mcpConfig,
      // Best-effort detection of credentials the connector needs at connect
      // time (${VAR} placeholders in headers/env/args/url). Surfaced to the UI
      // so it can prompt the user to supply them.
      needs: mcpConfig ? [...new Set((mcpConfig.match(/\$\{([^}]+)\}/g) || []).map((s) => s.slice(2, -1)))] : [],
      examples: (meta && (meta.examples_zh || meta.examples)) || [],
    });
  }
  return entries;
}

function loadCatalog() {
  try {
    return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
  } catch (e) {
    return { connectorsFallback: [], experts: [], skills: [] };
  }
}

function createRouter() {
  const router = express.Router();

  router.get('/workbuddy-hub', (req, res) => {
    const catalog = loadCatalog();
    let connectors = readConnectorsFromCache();
    let connectorsFrom = 'cache';

    if (connectors.length === 0 && Array.isArray(catalog.connectorsFallback) && catalog.connectorsFallback.length > 0) {
      connectors = catalog.connectorsFallback.map((c) => Object.assign({}, c, { icon: c.icon || null, fromFallback: true }));
      connectorsFrom = 'fallback';
    }

    // 按分类 + 名称排序，便于浏览
    connectors.sort((a, b) => {
      const ca = a.category || '';
      const cb = b.category || '';
      if (ca !== cb) return ca.localeCompare(cb, 'zh');
      return (a.name || '').localeCompare(b.name || '', 'zh');
    });

    res.json({
      connectors,
      connectorsFrom,
      experts: Array.isArray(catalog.experts) ? catalog.experts : [],
      skills: Array.isArray(catalog.skills) ? catalog.skills : [],
      catalogNote: catalog.note || '',
      generatedAt: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = { createRouter, readConnectorsFromCache, classify };
