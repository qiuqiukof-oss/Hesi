/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// PluginLoader — resource registrars
//
// Extracted from routes/plugin-loader.js. Each function registers one
// capability type declared in a plugin manifest onto the loader instance
// (CLI / workflow / AI tool / route / preset / MCP server).
//
// They are written as plain functions taking `(loader, ...)` instead of
// class methods so the PluginLoader class stays small. `loader._opts`,
// `loader._workflowList`, `loader._pluginsDir` are accessed directly.
// ============================================================
const fs = require('fs');
const path = require('path');
const { Router } = require('express');

const { resolveHandler } = require('./validation');

/**
 * 注册 CLI 工具并持久化到 cli-registry.json。
 */
function registerCLIs(loader, plugin, clis) {
  if (!clis || clis.length === 0) return;
  const { cliRegistry } = loader._opts;

  // 导入 cli-discovery 用于持久化写入
  let loadRegistry, saveRegistry;
  try {
    const discovery = require('../../cli-discovery');
    loadRegistry = discovery.loadRegistry;
    saveRegistry = discovery.saveRegistry;
  } catch (e) {
    // cli-discovery 不可用时回退到回调模式
  }

  for (const entry of clis) {
    const id = entry.id || entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    plugin.resources.cliIds.push(id);

    const cliEntry = {
      id,
      name: entry.name,
      path: entry.path || entry.name,
      category: entry.category || 'tool',
      type: entry.type || 'batch',
      args: entry.args || [],
      init: entry.init || '',
      discovered: 'plugin',
      version: entry.version || 'plugin',
      addedAt: new Date().toISOString(),
    };

    // 持久化写入 cli-registry.json
    if (loadRegistry && saveRegistry) {
      try {
        const reg = loadRegistry();
        // 避免重复注册
        if (!reg.clis.some(c => c.id === id)) {
          reg.clis.push(cliEntry);
          saveRegistry(reg);
          console.log(`[PluginLoader] CLI persisted: ${id} → ${cliEntry.path}`);
        }
      } catch (err) {
        console.error(`[PluginLoader] Failed to persist CLI "${id}":`, err.message);
      }
    }

    // 回调通知（用于 routes/index.js 中的 addCLI）
    if (cliRegistry && cliRegistry.addCLI) {
      cliRegistry.addCLI(cliEntry);
    }
  }

  // 热卸载：从 cli-registry.json 中移除该插件注册的所有 CLI
  if (loadRegistry && saveRegistry && plugin.resources.cliIds.length > 0) {
    plugin.resources.cleanupFns.push(() => {
      try {
        const reg = loadRegistry();
        const ids = new Set(plugin.resources.cliIds);
        const before = reg.clis.length;
        reg.clis = reg.clis.filter(c => !ids.has(c.id));
        if (reg.clis.length < before) {
          saveRegistry(reg);
          console.log(`[PluginLoader] Removed ${before - reg.clis.length} CLI(s) for "${plugin.name}" from registry`);
        }
      } catch (e) {
        console.error(`[PluginLoader] Failed to cleanup CLIs for "${plugin.name}":`, e.message);
      }
    });
  }
}

/**
 * 注册工作流。
 */
function registerWorkflows(loader, plugin, workflows) {
  if (!workflows || workflows.length === 0) return;

  for (const wf of workflows) {
    plugin.resources.workflowIds.push(wf.id);
    loader._workflowList.push({
      ...wf,
      _plugin: plugin.name,
      _loadedAt: Date.now(),
    });
  }

  // 热卸载：从 _workflowList 中移除该插件注册的所有工作流
  plugin.resources.cleanupFns.push(() => {
    const ids = new Set(plugin.resources.workflowIds);
    for (let i = loader._workflowList.length - 1; i >= 0; i--) {
      if (ids.has(loader._workflowList[i].id)) {
        loader._workflowList.splice(i, 1);
      }
    }
  });
}

/**
 * 注册 AI 工具。
 */
function registerAITools(loader, plugin, aiTools, pluginDir) {
  if (!aiTools || aiTools.length === 0) return;
  const { toolRegistry } = loader._opts;
  if (!toolRegistry || !toolRegistry.register) {
    console.warn(`[PluginLoader] Plugin "${plugin.name}" registers AI tools but no ToolRegistry available`);
    return;
  }

  for (const toolDef of aiTools) {
    const tool = {
      name: toolDef.name,
      description: toolDef.description || '',
      parameters: toolDef.parameters || { type: 'object', properties: {} },
      execute: null,
      noTruncate: toolDef.noTruncate || false,
    };

    // 支持两种执行方式：handler 文件路径 或 内联 execute
    if (toolDef.handler) {
      const handlerPath = resolveHandler(pluginDir, toolDef.handler);
      const handlerMod = require(handlerPath);
      tool.execute = async (args, broadcastFn) => {
        return handlerMod.execute(args, { broadcastFn, plugin, pluginLoader: loader, toolName: toolDef.name });
      };
      // 缓存模块路径以便热重载时清除 require.cache
      plugin.resources.cleanupFns.push(() => {
        delete require.cache[require.resolve(handlerPath)];
      });
    } else if (toolDef.execute) {
      // 内联 execute 函数（由加载器提供）
      tool.execute = toolDef.execute;
    }

    try {
      toolRegistry.register(tool);
      plugin.resources.aiToolNames.push(tool.name);
    } catch (err) {
      console.error(`[PluginLoader] Failed to register AI tool "${tool.name}": ${err.message}`);
    }
  }
}

/**
 * 注册 HTTP 路由。
 */
function registerRoutes(loader, plugin, routes, pluginDir) {
  if (!routes || routes.length === 0) return;
  const { expressApp } = loader._opts;
  if (!expressApp) {
    console.warn(`[PluginLoader] Plugin "${plugin.name}" registers routes but no Express app available`);
    return;
  }

  const router = Router();

  for (const routeDef of routes) {
    const method = routeDef.method.toLowerCase();
    if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
      console.warn(`[PluginLoader] Unsupported HTTP method: ${routeDef.method}`);
      continue;
    }

    const handlerPath = resolveHandler(pluginDir, routeDef.handler);
    const handlerMod = require(handlerPath);

    router[method](routeDef.path, (req, res) => handlerMod(req, res));
    plugin.resources.routePaths.push(`${routeDef.method} ${routeDef.path}`);
  }

  expressApp.use(router);
  plugin.resources.cleanupFns.push(() => {
    // 清理路由 handler 的 require cache，支持热重载
    for (const routeDef of routes) {
      const handlerPath = resolveHandler(pluginDir, routeDef.handler);
      try {
        const resolved = require.resolve(handlerPath);
        delete require.cache[resolved];
      } catch (e) {
        // handler not in cache — ignore
      }
    }
    // 注意: Express 不支持动态路由卸载，但清理 cache 后重载插件可以重新 require
    console.log(`[PluginLoader] Routes from "${plugin.name}" cleaned from require cache`);
  });
}

/**
 * 注册预设。
 */
function registerPresets(loader, plugin, presets) {
  if (!presets || presets.length === 0) return;
  const { presetLoader } = loader._opts;
  if (!presetLoader) {
    console.warn('[PluginLoader] No presetLoader available, skipping preset registration');
    return;
  }

  // 跟踪写入的预设文件路径，用于热卸载时清理。
  // cli-presets/ 位于项目根目录（与 plugins/ 同级），通过 loader._pluginsDir 推导以避免依赖 __dirname。
  const cliPresetsDir = path.join(loader._pluginsDir, '..', 'cli-presets');
  const writtenPaths = [];

  for (const preset of presets) {
    // 写入 cli-presets/ 目录（持久化）
    const presetPath = path.join(cliPresetsDir, `${preset.name}.json`);
    if (fs.existsSync(presetPath)) {
      console.warn(`[PluginLoader] Preset "${preset.name}" already exists, skipping`);
      continue;
    }
    fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2), 'utf-8');
    writtenPaths.push(presetPath);
    console.log(`[PluginLoader] Plugin registered preset: ${preset.name}`);
  }
  // 使预设缓存失效
  if (presetLoader.invalidateCache) {
    presetLoader.invalidateCache();
  }

  // 热卸载：删除写入的预设文件
  if (writtenPaths.length > 0) {
    plugin.resources.cleanupFns.push(() => {
      for (const p of writtenPaths) {
        try {
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            console.log(`[PluginLoader] Removed preset file: ${path.basename(p)}`);
          }
        } catch (e) {
          console.error(`[PluginLoader] Failed to remove preset file "${p}":`, e.message);
        }
      }
      // 再次使预设缓存失效
      if (presetLoader && presetLoader.invalidateCache) {
        presetLoader.invalidateCache();
      }
    });
  }
}

/**
 * 注册 MCP Server。
 */
function registerMCPServers(loader, plugin, mcpServers) {
  if (!mcpServers || mcpServers.length === 0) return;

  for (const srv of mcpServers) {
    plugin.resources.mcpServerNames.push(srv.name);
    console.log(`[PluginLoader] Plugin "${plugin.name}" registers MCP server: ${srv.name} (spawn: ${srv.command} ${(srv.args || []).join(' ')})`);

    // MCP Server 的启动管理由 server.js 中的 --with-mcp 机制负责。
    // 插件只是声明了需要哪些 MCP Server，实际启动在服务器初始化时处理。
    // 如需运行时启动，可通过 onLoad 钩子实现。
  }
}

module.exports = {
  registerCLIs,
  registerWorkflows,
  registerAITools,
  registerRoutes,
  registerPresets,
  registerMCPServers,
};
