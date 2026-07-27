// @ts-check
// ============================================================
// Phase 2 S3 — 圆桌 Agent 自定义覆盖层读写（零新依赖）
//
// 把用户对 4 个席位的自定义（名字 / 角色标签 / 主题色 / 头像来源）
// 落到项目根 `agent-overrides.json`。该文件随离线包带走，但已加入
// .gitignore，不进入仓库（仅 UI 偏好，非敏感）。
// 内核（discuss.js）用 agent id 路由，展示名仅渲染层，故覆盖纯展示。
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..'); // Hesi 根目录
const FILE = path.join(ROOT, 'agent-overrides.json');

/** 读取覆盖层；文件不存在 / 损坏时返回 {}。 */
function readOverrides() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const obj = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return (obj && obj.overrides && typeof obj.overrides === 'object') ? obj.overrides : {};
  } catch {
    return {};
  }
}

/** 写入覆盖层（整体覆盖）。返回写入后的 overrides。 */
function writeOverrides(overrides) {
  const data = { overrides: overrides || {} };
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf-8');
  return data.overrides;
}

module.exports = { readOverrides, writeOverrides, OVERRIDES_FILE: FILE };
