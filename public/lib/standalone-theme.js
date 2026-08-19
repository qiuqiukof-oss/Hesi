/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// standalone-theme.js — 独立页面主题引导（零依赖）
//
// 主应用的主题存在 localStorage['qcli-theme']（主题 id），
// 由 applyTheme 写在主文档 <html> 上。独立页面（budget / tools /
// workbuddy-hub / plugin-plaza / mermaid-templates / gallery 等）
// 与 Agnes 插件都是**独立 document**，不会自动继承那个属性。
//
// 本脚本在独立页面 <head> 同步执行，把已保存主题应用到本页 <html>，
// 并监听 storage 事件：在主应用切主题时，其它已打开的独立 Tab 实时跟随。
//
// 不读 bundle / 不依赖 QCLI，纯 localStorage + 内嵌明暗映射，
// 即便页面没加载主 bundle 也能工作。
// ============================================================
// @ts-check
'use strict';

(function () {
  // 主题 id → 明暗基调。与主应用 theme-registry 保持一致；
  // qcli-theme 始终落在这 6 个注册 id 之一（自定义预设会回落到对应家族）。
  const SCHEME = {
    light: 'light', dark: 'dark',
    quiet: 'light', xuan: 'light',
    xuanye: 'dark', cyber: 'dark',
  };
  const DEFAULT_THEME = 'xuan';
  const KEY = 'qcli-theme';

  function readSaved() {
    try {
      const v = localStorage.getItem(KEY);
      return v || DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  function apply() {
    const id = readSaved();
    const scheme = SCHEME[id] || 'dark';
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute('data-theme', id);
    root.setAttribute('data-scheme', scheme);
  }

  // 同步执行：<head> 内阻塞脚本，body 渲染前已写好属性，无闪烁。
  apply();

  // 防御：极少数情况下 documentElement 尚不可用，DOMContentLoaded 再补一次。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', apply);
  }

  // 跨 Tab 实时跟随：在主应用改主题 → 本独立页收到 storage 事件即更新。
  window.addEventListener('storage', (e) => {
    if (e && e.key === KEY) apply();
  });
})();
