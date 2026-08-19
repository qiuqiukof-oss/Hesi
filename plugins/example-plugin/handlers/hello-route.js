/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Example Plugin — Hello Route
//
// Express route handler for GET /api/plugins/example-plugin/hello
// Demo: how plugins can register HTTP routes.
// ============================================================

/**
 * GET /api/plugins/example-plugin/hello
 */
module.exports = function helloRoute(req, res) {
  res.json({
    message: 'Hello from example-plugin!',
    plugin: 'example-plugin',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    docs: 'https://github.com/qiuqiukof-oss/Hesi/blob/main/PLUGIN_SPEC.md',
  });
};
