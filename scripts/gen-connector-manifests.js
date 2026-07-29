/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// Generate a manifest.json for every connector under vendor/connectors.
// Skips directories that already have a manifest.json (don't clobber hand-written ones).
// (D2) Connector marketplace metadata: name / category / enterprise / authType.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'vendor', 'connectors');
if (!fs.existsSync(ROOT)) { console.error('vendor/connectors not found'); process.exit(1); }

// Heuristic category map (keyword → category).
const CATEGORY_HINTS = [
  [/mail|gmail|qq-mail|netease|imap/i, 'email'],
  [/docs?|kdocs|tencent-docs|lexiang|wiki|iwiki|km|notion|yuandian|pkulaw|fyopen|patsnap/i, 'documentation'],
  [/tapd|jira|qingflow|workbuddy|trello|asana/i, 'project-management'],
  [/feishu|dingtalk|wecom|slack|wechat|im/i, 'messaging'],
  [/github|gongfeng|cnb|git/i, 'dev-tools'],
  [/cloudbase|anydev|supabase|neo-crm|qcc|tyc/i, 'cloud-crm'],
  [/law|legal|bugly|security/i, 'compliance'],
  [/ad|marketing|tec-do|region-insight|mastergo/i, 'marketing'],
  [/map|travel|ctrip/i, 'utility'],
  [/storage|netdisk|weiyun/i, 'storage'],
  [/finance|stock|fund|trade|tmeet/i, 'finance'],
];

// Connectors that are clearly enterprise-only (heuristic; override per connector).
const ENTERPRISE = new Set([
  'wecom', 'dingtalk', 'feishu', 'gongfeng-woa', 'cnb-woa', 'iwiki-woa', 'km',
  'lexiang', 'tapd', 'tapd-woa', 'qingflow', 'anydev', 'neo-crm', 'qcc-company',
  'tyc-mcp', 'pkulaw', 'fyopen-lawsearch', 'bugly', 'bugly-token', 'iam-mcp',
  'tencent-health-nges', 'zhiyan-cicd', 'westock-mcp', 'yingmi-mcp', 'wk-workbuddy',
  'tencentads', 'tmeet', 'mastergo-vibe-mcp', 'region-insight', 'tec-do',
]);

function inferCategory(name) {
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(name)) return cat;
  return 'integration';
}
function inferAuth(name) {
  if (/wecom|feishu|dingtalk|okta|github|oauth/i.test(name)) return 'oauth';
  if (/mail|smtp|imap/i.test(name)) return 'basic';
  return 'token';
}

let created = 0, skipped = 0;
for (const name of fs.readdirSync(ROOT)) {
  const dir = path.join(ROOT, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const manifestPath = path.join(dir, 'manifest.json');
  if (fs.existsSync(manifestPath)) { skipped++; continue; }
  const manifest = {
    id: name,
    name,
    category: inferCategory(name),
    enterprise: ENTERPRISE.has(name),
    authType: inferAuth(name),
    description: `${name} connector for Hesi`,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  created++;
}
console.log(`Connector manifests: ${created} created, ${skipped} skipped (already present).`);
