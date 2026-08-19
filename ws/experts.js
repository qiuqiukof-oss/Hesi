/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Experts Registry — 把 WorkBuddy 的「专家」变为 Hesi 原生、可选用的角色。
//
// 专家 = 一套可复用的人设（persona）+ 可选声明的「可用技能 / 可接入连接器」。
// 编排时任务通过 expertId 引用某专家，运行时后端把其人设前置进 prompt，
// 并附上其声明的技能/连接器提示，使编排成为一支有身份、有工具边界的专家团。
//
// 内置专家种子来自 ws/digital-employee.js 的 ROLE_CONFIG（与数字员工体系同源），
// 用户也可通过 API / 前端自定义专家。持久化到 data/experts/catalog.json，
// 便于在重启间保留自定义专家。
// ============================================================
const fs = require('fs');
const path = require('path');
const { ROLE_CONFIG, ROLES } = require('./digital-employee');

const DATA_DIR = path.join(__dirname, '..', 'data', 'experts');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCatalog() {
  ensureDir();
  if (!fs.existsSync(CATALOG_PATH)) return { experts: [], ingestedAt: 0 };
  try {
    const d = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
    return Array.isArray(d.experts) ? d : { experts: [], ingestedAt: 0 };
  } catch (e) {
    return { experts: [], ingestedAt: 0 };
  }
}

function saveCatalog(catalog) {
  ensureDir();
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
}

// 以 ROLE_CONFIG 为内置专家种子（专家团与数字员工体系同源）。
function builtinExperts() {
  const out = [];
  for (const role of Object.values(ROLES)) {
    const cfg = ROLE_CONFIG[role];
    if (!cfg) continue;
    out.push({
      id: role,
      name: cfg.name || role,
      nameEn: cfg.nameEn || '',
      icon: cfg.icon || '🧑‍💼',
      description: cfg.description || '',
      persona: cfg.persona || '',
      color: cfg.color || '',
      allowedSkills: [],
      allowedConnectors: [],
      source: 'builtin',
    });
  }
  return out;
}

function ingestBuiltin() {
  const byId = {};
  builtinExperts().forEach((e) => { byId[e.id] = e; });
  // 保留已有的自定义专家（source 非 builtin），按 id 合并
  const prev = loadCatalog().experts.filter((e) => e.source && e.source !== 'builtin');
  prev.forEach((e) => { byId[e.id] = e; });
  const catalog = { experts: Object.values(byId), ingestedAt: Date.now() };
  saveCatalog(catalog);
  return catalog;
}

class ExpertRegistry {
  constructor() {
    this._catalog = null;
  }

  _ensure() {
    if (!this._catalog) {
      this._catalog = loadCatalog();
      // 首次使用且为空时自动播种内置专家（best-effort，不抛错）
      if (!this._catalog.experts || this._catalog.experts.length === 0) {
        try { this._catalog = ingestBuiltin(); } catch (e) { /* ignore */ }
      }
    }
    return this._catalog;
  }

  list() {
    return this._ensure().experts;
  }

  get(id) {
    return this._ensure().experts.find((e) => e.id === id) || null;
  }

  getPersona(id) {
    const e = this.get(id);
    return e ? e.persona : null;
  }

  reingest() {
    this._catalog = ingestBuiltin();
    return this._catalog;
  }

  addExpert(expert) {
    if (!expert || !expert.id || !expert.name) throw new Error('id and name required');
    const cat = this._ensure();
    // 规范化允许的技能/连接器为数组
    const norm = {
      id: String(expert.id),
      name: expert.name,
      nameEn: expert.nameEn || '',
      icon: expert.icon || '🧑‍💼',
      description: expert.description || '',
      persona: expert.persona || '',
      color: expert.color || '',
      allowedSkills: Array.isArray(expert.allowedSkills) ? expert.allowedSkills : [],
      allowedConnectors: Array.isArray(expert.allowedConnectors) ? expert.allowedConnectors : [],
      source: 'custom',
    };
    const idx = cat.experts.findIndex((e) => e.id === norm.id);
    if (idx >= 0) cat.experts[idx] = norm;
    else cat.experts.push(norm);
    saveCatalog(cat);
    return norm;
  }
}

module.exports = new ExpertRegistry();
