/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// PluginLoader — manifest validation & handler resolution
//
// Extracted from routes/plugin-loader.js so the PluginLoader class
// stays focused on state/lifecycle. These are pure helpers with no
// dependency on the loader instance.
// ============================================================
const fs = require('fs');
const path = require('path');

const REQUIRED_FIELDS = ['name', 'version'];
const VALID_TYPES = ['clis', 'workflows', 'aiTools', 'routes', 'presets', 'mcpServers'];

/**
 * Validate a plugin manifest.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
function validateManifest(manifest, pluginDir) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (!manifest[field] || typeof manifest[field] !== 'string') {
      errors.push(`Missing or invalid required field: "${field}"`);
    }
  }

  if (manifest.clis && !Array.isArray(manifest.clis)) {
    errors.push('"clis" must be an array');
  }
  if (manifest.workflows && !Array.isArray(manifest.workflows)) {
    errors.push('"workflows" must be an array');
  }
  if (manifest.aiTools && !Array.isArray(manifest.aiTools)) {
    errors.push('"aiTools" must be an array');
  }
  if (manifest.routes && !Array.isArray(manifest.routes)) {
    errors.push('"routes" must be an array');
  }
  if (manifest.presets && !Array.isArray(manifest.presets)) {
    errors.push('"presets" must be an array');
  }
  if (manifest.mcpServers && !Array.isArray(manifest.mcpServers)) {
    errors.push('"mcpServers" must be an array');
  }

  // Validate handler file existence for aiTools
  if (manifest.aiTools) {
    for (const tool of manifest.aiTools) {
      if (tool.handler) {
        const handlerPath = path.resolve(pluginDir, tool.handler);
        if (!fs.existsSync(handlerPath)) {
          errors.push(`aiTool "${tool.name}" handler not found: ${tool.handler}`);
        }
      } else if (!tool.execute) {
        errors.push(`aiTool "${tool.name}" must have either "handler" or inline "execute" function`);
      }
    }
  }

  // Validate handler file existence for routes
  if (manifest.routes) {
    for (const route of manifest.routes) {
      if (!route.method || !route.path || !route.handler) {
        errors.push(`Route missing method, path, or handler`);
        continue;
      }
      const handlerPath = path.resolve(pluginDir, route.handler);
      if (!fs.existsSync(handlerPath)) {
        errors.push(`Route handler not found: ${route.handler} for ${route.method} ${route.path}`);
      }
    }
  }

  // Validate lifecycle hook file existence
  if (manifest.lifecycle) {
    if (manifest.lifecycle.onLoad) {
      const hookPath = path.resolve(pluginDir, manifest.lifecycle.onLoad);
      if (!fs.existsSync(hookPath)) {
        errors.push(`Lifecycle onLoad hook not found: ${manifest.lifecycle.onLoad}`);
      }
    }
    if (manifest.lifecycle.onUnload) {
      const hookPath = path.resolve(pluginDir, manifest.lifecycle.onUnload);
      if (!fs.existsSync(hookPath)) {
        errors.push(`Lifecycle onUnload hook not found: ${manifest.lifecycle.onUnload}`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true };
}

/**
 * Resolve a plugin-relative file path to absolute.
 */
function resolveHandler(pluginDir, handlerRelPath) {
  return path.resolve(pluginDir, handlerRelPath);
}

module.exports = {
  REQUIRED_FIELDS,
  VALID_TYPES,
  validateManifest,
  resolveHandler,
};
