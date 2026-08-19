/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Preset Loader — loads CLI presets from cli-presets/*.json,
// resolves "extends" chains, merges tools/categories/names,
// and provides the currently active preset.
// ============================================================
const path = require('path');
const fs = require('fs');

const PRESETS_DIR = path.join(__dirname, 'cli-presets');
let activePreset = 'developer'; // default

// ──────────────────────────────────────────────
// Internal cache
// ──────────────────────────────────────────────
let presetCache = null;

/**
 * Load all presets from the cli-presets directory.
 * @returns {object} Map of preset name → parsed JSON
 */
function loadAllPresets() {
  if (presetCache) return presetCache;
  const presets = {};
  let files;
  try {
    files = fs.readdirSync(PRESETS_DIR);
  } catch {
    console.warn('[Presets] No cli-presets directory found');
    return presets;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const raw = fs.readFileSync(path.join(PRESETS_DIR, file), 'utf-8');
      const preset = JSON.parse(raw);
      presets[preset.name] = preset;
    } catch (e) {
      console.warn(`[Presets] Failed to load ${file}: ${e.message}`);
    }
  }
  presetCache = presets;
  return presets;
}

/**
 * Invalidate the preset cache (e.g. after adding a new preset at runtime).
 */
function invalidateCache() {
  presetCache = null;
}

/**
 * Resolve a preset's full definition by walking its "extends" chain.
 * Merges tools, categories, and names from parent presets.
 * Child values override parent values.
 *
 * @param {string} presetName
 * @returns {object|null} Fully resolved preset, or null if not found
 */
function resolvePreset(presetName) {
  const allPresets = loadAllPresets();
  const preset = allPresets[presetName];
  if (!preset) return null;

  // Start with empty base
  const resolved = {
    name: preset.name,
    label: preset.label || preset.name,
    labelEn: preset.labelEn || preset.label || preset.name,
    description: preset.description || '',
    descriptionEn: preset.descriptionEn || preset.description || '',
    icon: preset.icon || '🔧',
    extends: preset.extends || [],
    categories: {},
    tools: {},
    names: [],
  };

  // Walk extends chain (breadth-first)
  if (preset.extends && preset.extends.length > 0) {
    for (const parentName of preset.extends) {
      const parent = resolvePreset(parentName);
      if (parent) {
        // Merge categories (parent first)
        resolved.categories = { ...parent.categories, ...resolved.categories };
        // Merge tools (parent first)
        resolved.tools = { ...parent.tools, ...resolved.tools };
        // Merge names (parent first, deduplicate)
        const nameSet = new Set([...parent.names, ...resolved.names]);
        resolved.names = Array.from(nameSet);
      }
    }
  }

  // Apply own values
  resolved.categories = { ...resolved.categories, ...(preset.categories || {}) };
  resolved.tools = { ...resolved.tools, ...(preset.tools || {}) };
  if (preset.names) {
    const nameSet = new Set([...resolved.names, ...preset.names]);
    resolved.names = Array.from(nameSet);
  }

  // Derive KNOWN_CLI_TYPES from tools
  resolved.types = {};
  for (const [name, def] of Object.entries(resolved.tools)) {
    if (def.type) resolved.types[name] = def.type;
  }

  // Derive KNOWN_CLI_CATEGORIES from tools
  resolved.categoriesMap = {};
  for (const [name, def] of Object.entries(resolved.tools)) {
    if (def.category) resolved.categoriesMap[name] = def.category;
  }

  // Carry over welcome content (preset-specific, not merged across inheritance)
  resolved.welcome = preset.welcome || null;

  // Resolve i18n strings from welcome content
  if (resolved.welcome && resolved.welcome.installTools) {
    for (const tool of resolved.welcome.installTools) {
      if (!tool.iconColor) tool.iconColor = '#6366f1';
    }
  }

  return resolved;
}

/**
 * Get the currently active preset (fully resolved).
 * @returns {object} Full preset definition with categories, tools, names, etc.
 */
function getActivePreset() {
  return resolvePreset(activePreset);
}

/**
 * Activate a different preset by name.
 * @param {string} presetName
 * @returns {boolean} Whether the preset was found and activated
 */
function setActivePreset(presetName) {
  const allPresets = loadAllPresets();
  if (!allPresets[presetName]) return false;
  activePreset = presetName;
  return true;
}

/**
 * List all available presets with basic metadata (not fully resolved).
 * @returns {Array<{name, label, labelEn, description, descriptionEn, icon}>}
 */
function listPresets() {
  const allPresets = loadAllPresets();
  return Object.values(allPresets)
    .filter(p => p.name !== 'shared') // exclude shared from listing
    .map(p => ({
      name: p.name,
      label: p.label || p.name,
      labelEn: p.labelEn || p.label || p.name,
      description: p.description || '',
      descriptionEn: p.descriptionEn || p.description || '',
      icon: p.icon || '🔧',
    }));
}

/**
 * Get the active preset name.
 */
function getActivePresetName() {
  return activePreset;
}

// ──────────────────────────────────────────────
// Export
// ──────────────────────────────────────────────
module.exports = {
  loadAllPresets,
  invalidateCache,
  resolvePreset,
  getActivePreset,
  setActivePreset,
  listPresets,
  getActivePresetName,
};
