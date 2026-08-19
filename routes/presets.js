/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Presets API — list and activate CLI presets
// ============================================================
const { Router } = require('express');
const {
  listPresets,
  getActivePreset,
  getActivePresetName,
  setActivePreset,
  resolvePreset,
} = require('../preset-loader');

/**
 * Create the presets router.
 * @returns {import('express').Router}
 */
function createRouter() {
  const router = Router();

  /**
   * GET /api/presets
   * List all available presets and the currently active one.
   */
  router.get('/presets', (_req, res) => {
    const presets = listPresets();
    const activePreset = getActivePresetName();
    const activePresetData = resolvePreset(activePreset);
    res.json({
      presets,
      active: activePreset,
      categories: activePresetData ? activePresetData.categories : {},
      welcome: activePresetData ? activePresetData.welcome : null,
    });
  });

  /**
   * POST /api/presets/activate
   * Switch to a different preset.
   * Body: { name: "developer" | "media-engineer" }
   */
  router.post('/presets/activate', (req, res) => {
    const { name } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Preset name is required' });
    }
    const success = setActivePreset(name);
    if (!success) {
      return res.status(404).json({ error: `Preset "${name}" not found` });
    }
    const presetData = resolvePreset(name);
    res.json({
      active: name,
      categories: presetData ? presetData.categories : {},
      welcome: presetData ? presetData.welcome : null,
    });
  });

  // ──────────────────────────────────────────────
  // GET /api/presets/available
  // 返回当前预设中已定义但尚未注册的 CLI 列表
  // ──────────────────────────────────────────────
  router.get('/presets/available', (req, res) => {
    try {
      const { loadRegistry, resolveCommand } = require('../cli-discovery');
      const registry = loadRegistry();
      const existingIds = new Set(registry.clis.map(c => c.id));
      const presetData = resolvePreset(getActivePresetName());

      if (!presetData || !presetData.names) {
        return res.json({ success: true, available: [], totalInPreset: 0 });
      }

      const presetNames = presetData.names;
      const presetCategories = presetData.categoriesMap || {};
      const presetTypes = presetData.types || {};

      const available = presetNames
        .filter(name => !existingIds.has(name))
        .map(name => ({
          name,
          category: presetCategories[name] || 'tool',
          type: presetTypes[name] || 'batch',
          canResolve: !!resolveCommand(name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({
        success: true,
        available,
        totalInPreset: presetNames.length,
        registered: registry.clis.length,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter };
