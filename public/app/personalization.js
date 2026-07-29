// @ts-check
// ============================================================
// 个性化设置（Personalization Hub）—— 前端 localStorage 持久化层
//
// 与 AI Key / verifyMode 同源：全部存浏览器 localStorage，发消息时由
// chat-api.js 打包进请求体；后端 routes/chat/index.js 拼入系统提示词。
// 角色下拉的专家列表经 GET /api/experts 拉取（复用既有路由，不新建存储）。
//
// 设计见 .workbuddy/personalization-settings-plan.md（球总已拍板：
// 覆盖式 / 独立入口 / chat HITL 留 Phase 1 / 不做预设 / localStorage）。
// ============================================================
'use strict';

import { safeStorage } from '../lib/storage.js';

const KEY_PERSONA = 'qcli-persona';
const KEY_ROLE = 'qcli-role';
const KEY_CI = 'qcli-custom-instructions';
const KEY_MEMORY = 'qcli-memory-enabled';
const KEY_PERMS = 'qcli-permissions';
const KEY_LANG = 'qcli-language';

export const DEFAULT_PERSONA = 'balanced';
export const DEFAULT_ROLE = 'default';
export const DEFAULT_LANGUAGE = 'auto';
export const DEFAULT_PERMISSIONS = { mode: 'auto', autoReview: true, fullAuto: false };

function getJSON(key, fallback) {
  try {
    const raw = safeStorage.get(key, '');
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function setJSON(key, val) {
  try { safeStorage.set(key, JSON.stringify(val)); } catch { /* ignore */ }
}

export const Personalization = {
  // ── 个性（语气模板 key）──
  getPersona() { return safeStorage.get(KEY_PERSONA, DEFAULT_PERSONA) || DEFAULT_PERSONA; },
  setPersona(v) { safeStorage.set(KEY_PERSONA, v || DEFAULT_PERSONA); },

  // ── 角色（expertId；'default' = 内置硬指标工程助手）──
  getRole() { return safeStorage.get(KEY_ROLE, DEFAULT_ROLE) || DEFAULT_ROLE; },
  setRole(v) { safeStorage.set(KEY_ROLE, v || DEFAULT_ROLE); },

  // ── 自定义指令（覆盖式；空 = 回退默认硬指标）──
  getCustomInstructions() { return safeStorage.get(KEY_CI, '') || ''; },
  setCustomInstructions(v) { safeStorage.set(KEY_CI, v || ''); },

  // ── 记忆开关（"从聊天生成记忆并带入新聊天"）──
  getMemoryEnabled() { return safeStorage.get(KEY_MEMORY, 'true') !== 'false'; },
  setMemoryEnabled(on) { safeStorage.set(KEY_MEMORY, on === false ? 'false' : 'true'); },

  // ── 权限设置（mode / autoReview / fullAuto）──
  getPermissions() {
    const p = getJSON(KEY_PERMS, DEFAULT_PERMISSIONS);
    return {
      mode: p.mode || DEFAULT_PERMISSIONS.mode,
      autoReview: p.autoReview !== false,
      fullAuto: p.fullAuto === true,
    };
  },
  setPermissions(p) {
    const cur = this.getPermissions();
    const next = {
      mode: (p && p.mode) || cur.mode,
      autoReview: p && typeof p.autoReview === 'boolean' ? p.autoReview : cur.autoReview,
      fullAuto: p && typeof p.fullAuto === 'boolean' ? p.fullAuto : cur.fullAuto,
    };
    setJSON(KEY_PERMS, next);
  },

  // ── 语言偏好（zh / en / auto）──
  getLanguage() { return safeStorage.get(KEY_LANG, DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE; },
  setLanguage(v) { safeStorage.set(KEY_LANG, v || DEFAULT_LANGUAGE); },

  // ── 拉取项目专家列表（角色下拉用）──
  async loadExperts() {
    try {
      const resp = await fetch('/api/experts');
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data.experts) ? data.experts : [];
    } catch {
      return [];
    }
  },

  // ── 重置为默认 ──
  reset() {
    safeStorage.set(KEY_PERSONA, DEFAULT_PERSONA);
    safeStorage.set(KEY_ROLE, DEFAULT_ROLE);
    safeStorage.set(KEY_CI, '');
    safeStorage.set(KEY_MEMORY, 'true');
    setJSON(KEY_PERMS, DEFAULT_PERMISSIONS);
    safeStorage.set(KEY_LANG, DEFAULT_LANGUAGE);
  },

  // ── 导出 / 导入（跨设备迁移）──
  exportConfig() {
    return {
      persona: this.getPersona(),
      role: this.getRole(),
      customInstructions: this.getCustomInstructions(),
      memoryEnabled: this.getMemoryEnabled(),
      permissions: this.getPermissions(),
      language: this.getLanguage(),
    };
  },
  importConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    if (cfg.persona) this.setPersona(cfg.persona);
    if (cfg.role) this.setRole(cfg.role);
    if (typeof cfg.customInstructions === 'string') this.setCustomInstructions(cfg.customInstructions);
    if (typeof cfg.memoryEnabled === 'boolean') this.setMemoryEnabled(cfg.memoryEnabled);
    if (cfg.permissions) this.setPermissions(cfg.permissions);
    if (cfg.language) this.setLanguage(cfg.language);
  },
};

// 暴露到全局，便于 boot.js / plan-view.js 直接调用
window.QCLI = window.QCLI || {};
window.QCLI.Personalization = Personalization;
