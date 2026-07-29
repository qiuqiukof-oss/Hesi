/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tools — 注册所有内置工具到 registry
// ============================================================

const webSearch = require('./web-search');
const webFetch = require('./web-fetch');
const terminal = require('./terminal');
const filesystem = require('./filesystem');
const stocks = require('./stocks');
const self = require('./self');
const discovery = require('./discovery');
const imageGen = require('./image-gen');
const videoGen = require('./video-gen');
const docConvert = require('./doc-convert');
const workbuddy = require('./workbuddy');
const agent = require('./agent');
const blackboard = require('./blackboard');

/**
 * 注册所有内置 AI 工具。
 * @param {import('../registry').ToolRegistry} registry
 * @param {object} deps - { cache, rateLimiter }
 */
function registerAll(registry, deps) {
  webSearch.register(registry, deps);
  webFetch.register(registry);
  terminal.register(registry, deps);
  filesystem.register(registry);
  stocks.register(registry);
  self.register(registry);
  discovery.register(registry);
  imageGen.register(registry);
  videoGen.register(registry);
  docConvert.register(registry);
  workbuddy.register(registry);
  agent.register(registry);
  blackboard.register(registry);
}

module.exports = { registerAll };
