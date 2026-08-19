/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Example Plugin — Init Hook
//
// Lifecycle hook called when the plugin is loaded.
// Demonstrates onLoad hook capability.
// ============================================================

/**
 * Called when the plugin is loaded.
 * @param {object} context - { plugin, manifest, pluginLoader }
 */
module.exports = function onLoad(context) {
  console.log(`[Plugin:example] Loaded v${context.plugin.version}`);
  console.log(`[Plugin:example] Registered ${context.manifest.clis.length} CLI(s)`);
  console.log(`[Plugin:example] Registered ${context.manifest.workflows.length} workflow(s)`);
  console.log(`[Plugin:example] Registered ${context.manifest.aiTools.length} AI tool(s)`);
  console.log(`[Plugin:example] Registered ${context.manifest.routes.length} route(s)`);
  console.log(`[Plugin:example] Registered ${context.manifest.presets.length} preset(s)`);
};
