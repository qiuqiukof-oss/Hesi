/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Route Aggregator — mount all route modules on the Express app
// ============================================================
const fs = require('fs');
const path = require('path');
const { createRateLimiter } = require('../rate-limiter');
const { createRouter: createCLIRouter } = require('./clis');
const { createRouter: createFolderRouter } = require('./folders');
const { createRouter: createUploadRouter } = require('./upload');
const { createRouter: createChatRouter } = require('./chat/index');
const { createRouter: createAgentRouter } = require('./agents');
const { createRouter: createAgentInstallRouter } = require('./agent-install');
const { createRouter: createWorkflowRouter } = require('./workflows');
const { createRouter: createSettingsRouter } = require('./settings');
const { createRouter: createWSTypesRouter } = require('./ws-types');
const { createRouter: createPresetsRouter } = require('./presets');
const { createRouter: createProjectRouter } = require('./project');
const { createRouter: createToolsRouter } = require('./tools');
const { createMemoryRouter } = require('./memory');
const { createRouter: createFinanceRouter, setupPageRoutes: setupFinancePageRoutes } = require('./finance');
const { createRouter: createBrowserRouter } = require('./browser');
const { createRouter: createBrowserScriptsRouter } = require('./browser-scripts');
const createMcpStatusRouter = require('./mcp-status');
const { createRouter: createPluginMarketRouter } = require('./plugin-market');
const { createRouter: createWorkbuddyHubRouter } = require('./workbuddy-hub');
const { createRouter: createMcpConnectorsRouter } = require('./mcp-connectors');
const { createRouter: createSkillsRouter } = require('./skills');
const { createRouter: createExpertsRouter } = require('./experts');
const { createRouter: createTtsRouter } = require('./tts');
const { createRouter: createRateLimiterRouter } = require('./rate-limiter');
const { createRouter: createBotsRouter } = require('./bots');
const { createRouter: createLlmProvidersRouter } = require('./llm-providers');
const { PluginLoader } = require('./plugin-loader');
const { ToolRegistry } = require('./ai-tools/registry');
// ── Platform routers (auth / telemetry / metrics / blackboard / roundtable) ──
const { createRouter: createAuthRouter } = require('./auth');
const { createRouter: createTelemetryRouter } = require('./telemetry');
const { createRouter: createMetricsRouter } = require('./metrics');
const { createRouter: createBlackboardRouter } = require('./blackboard');
const { createRouter: createRoundtableRouter } = require('./roundtable');
const { createRouter: createWorkspaceRouter } = require('./workspace');
const { createRouter: createFsRouter } = require('./fs');
const { createRouter: createPlanRouter } = require('./ai-tools/plan-routes');
// Optional access-token protection for sensitive HTTP routes.
// No-op unless QCLI_ACCESS_TOKEN is set (loopback clients exempt by default).
const { requireToken } = require('../lib/access-auth');
// Session auth (multi-user / enterprise mode). Local mode passes through.
const { requireAuth } = require('../lib/auth/session');
const { GENERATED_UPLOADS_DIR } = require('../lib/uploads');

// ──────────────────────────────────────────────
// Rate limiter instances (shared across route modules)
// ──────────────────────────────────────────────
// NOTE:
//   - apiLimiter (600/60s) applies to ALL /api/* routes EXCEPT chat.
//   - Chat is intentionally placed BEFORE apiLimiter so it only uses chatLimiter (300/60s).
//   - This prevents double-limiting and avoids /api/chat/status bursts burning global quota.
const apiLimiter = createRateLimiter({ windowMs: 60000, max: 600, message: 'API rate limit exceeded (max 600 req/min)' });
const uploadLimiter = createRateLimiter({ windowMs: 60000, max: 10, message: 'Upload rate limit exceeded' });
const discoverLimiter = createRateLimiter({ windowMs: 60000, max: 10, message: 'Discovery already running, please wait' });
const chatLimiter = createRateLimiter({ windowMs: 60000, max: 300, message: 'Chat rate limit exceeded (max 300 requests/min)' });

// ──────────────────────────────────────────────
// Global plugin system (single instance, shared across modules)
// ──────────────────────────────────────────────
/**
 * @type {PluginLoader|null}
 * Set by setupRoutes() when an Express app is provided.
 */
let _pluginLoader = null;

/**
 * Get the global PluginLoader instance.
 * Returns null if setupRoutes() has not been called yet.
 */
function getPluginLoader() {
  return _pluginLoader;
}

/**
 * Mount all API routes on the given Express application.
 *
 * @param {express.Application} app
 * @param {object}              [opts]
 * @param {Function}            [opts.broadcastFn]  — WS broadcast for tool metrics
 * @param {object}              [opts.toolRegistry]  — ToolRegistry for AI tool registration
 * @param {object}              [opts.presetLoader]  — preset-loader module
 * @returns {{ pluginLoader: PluginLoader }}  — plugin loader instance
 */
function setupRoutes(app, opts = {}) {
  const { broadcastFn, toolRegistry, presetLoader, mcpStatusOpts } = opts;

  // ── Chat routes go BEFORE global apiLimiter to avoid double-limiting ──
  // Chat has its own chatLimiter (300/60s). By registering before apiLimiter,
  // /api/chat/* requests only go through chatLimiter, preventing /api/chat/status
  // polling bursts from burning the global API budget.
  app.use('/api', chatLimiter, createChatRouter({ broadcastFn }));

  // ── Rate limiter stats route goes BEFORE apiLimiter to avoid catch-22 ──
  // If the global limiter is overwhelmed, we still need to access the stats
  // endpoint to diagnose the issue. Lightweight endpoint, no per-request limit.
  app.use('/api', createRateLimiterRouter());

  // ── Global rate limiter for all non-chat /api/* routes ──
  app.use('/api', apiLimiter);

  app.use('/api', requireToken, createCLIRouter({ discoverLimiter }));
  app.use('/api', createFolderRouter());
  app.use('/api', requireToken, requireAuth, createUploadRouter({ uploadLimiter }));
  app.use('/api', createAgentRouter());
  app.use('/api', createAgentInstallRouter({ broadcastFn }));
  app.use('/api', createWorkflowRouter());
  app.use('/api', requireToken, createSettingsRouter());
  app.use('/api', createWSTypesRouter());
  app.use('/api', createPresetsRouter());
  app.use('/api', createProjectRouter());
  app.use('/api/tts', createTtsRouter());
  app.use('/api', createLlmProvidersRouter());
  app.use('/api', requireToken, createToolsRouter());
  app.use('/api', requireToken, createWorkspaceRouter());
  app.use('/api', requireToken, createFsRouter());
  app.use('/api/memory', createMemoryRouter());
  app.use('/api', createFinanceRouter());
  app.use('/api', requireToken, createBrowserRouter());
  app.use('/api', createBrowserScriptsRouter());
  // ── Bot 接入（通讯接入 A）──
  // webhook 端点必须绕过 requireToken：平台服务器回调无法携带 HESI 的 token，
  // 鉴权由各平台适配器内的签名校验负责（fail-closed）。内部 /api/bots/dispatch
  // 端点在本机回环使用，由路由内部做回环+token 双重校验（见 bots/index.js）。
  app.use('/api', createBotsRouter());
  if (mcpStatusOpts) {
    app.use('/api', createMcpStatusRouter(mcpStatusOpts));
  }
  setupFinancePageRoutes(app);

  // ── Initialize plugin system ──
  const workflowList = []; // plugins push workflows here
  const cliRegistry = {
    addCLI(entry) {
      // Delegate to cli-discovery for persistence (future)
      console.log('[PluginLoader] CLI registered:', entry.id, '→', entry.path);
    },
  };

  _pluginLoader = new PluginLoader({
    expressApp: app,
    workflowList,
    toolRegistry: toolRegistry || null,
    cliRegistry,
    presetLoader: presetLoader || null,
    onPluginEvent(ev, data) {
      console.log(`[PluginLoader] Event: ${ev}`, data.name);
    },
  });

  // Scan and load all plugins from plugins/
  const loadResult = _pluginLoader.scanAndLoad();
  if (loadResult.loaded.length > 0 || loadResult.errors.length > 0) {
    console.log(`[PluginLoader] ${loadResult.loaded.length} loaded, ${loadResult.errors.length} errors`);
    for (const err of loadResult.errors) {
      console.warn(`[PluginLoader]   ✗ ${err.plugin}: ${err.error}`);
    }
  }

  // ── Gallery route (list generated HTML files in uploads/ for preview) ──
  app.get('/api/gallery', (req, res) => {
    const uploadsDir = GENERATED_UPLOADS_DIR;
    if (!fs.existsSync(uploadsDir)) return res.json({ files: [] });
    try {
      const files = fs.readdirSync(uploadsDir)
        .filter(f => f.endsWith('.html') && f.startsWith('doc_'))
        .map(f => {
          const stat = fs.statSync(path.join(uploadsDir, f));
          return {
            name: f,
            size: stat.size,
            mtime: stat.mtime,
            url: `/uploads/${encodeURIComponent(f)}`,
          };
        })
        .sort((a, b) => b.mtime - a.mtime);
      res.json({ files });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Plugin market route (needs pluginLoader reference + broadcastFn for install progress) ──
  app.use('/api', requireToken, createPluginMarketRouter({ pluginLoader: _pluginLoader, broadcastFn }));

  // ── WorkBuddy 广场（只读展示本地缓存 + 内置精选目录，无需 token） ──
  app.use('/api', createWorkbuddyHubRouter());

  // ── MCP 连接器（把 WorkBuddy 连接器变为 Hesi 可调用客户端，无需 token） ──
  // 挂载在 /api/mcp-connectors 下，路由内部使用相对路径（/、/import、/:id/connect ...）
  app.use('/api/mcp-connectors', createMcpConnectorsRouter());

  // ── 技能库（把 WorkBuddy 连接器缓存里的 SKILL.md 摄入为 Hesi 原生技能，无需 token） ──
  // 挂载在 /api/skills 下，路由内部使用相对路径（/、/ingest、/:id、POST /）。
  app.use('/api/skills', createSkillsRouter());

  // ── 专家库（把 WorkBuddy 专家摄入为 Hesi 原生可选角色，无需 token） ──
  // 挂载在 /api/experts 下，路由内部使用相对路径（/、/ingest、/:id、POST /）。
  app.use('/api/experts', createExpertsRouter());

  // ── 平台：认证 / 遥测 / 指标 / 黑板 / 圆桌（各自内置鉴权） ──
  app.use('/api/auth', createAuthRouter());
  app.use('/api/telemetry', createTelemetryRouter());
  app.use('/api/metrics', createMetricsRouter());
  app.use('/api/blackboard', createBlackboardRouter()); // Phase1 S8: 共享黑板只读观测
  app.use('/api/roundtable', createRoundtableRouter()); // Phase2 S1-S5: 围炉圆桌状态/覆盖层/纪要

  // ── Phase 0 全自动闭环：Plan 执行入口（gate→快照→执行→验收→反思） ──
  app.use('/api/plan', requireToken, createPlanRouter({ broadcastFn }));

  // ── 能力发现端点（无需 token）：让内置助手 / 终端 agent 动态知道「网页端点」这条路 ──
  const { listWebPaths, getCapabilityBriefing } = require('../ws/web-executor');
  app.get('/api/capabilities', (req, res) => {
    res.json({
      ok: true,
      webPaths: listWebPaths(),
      briefing: getCapabilityBriefing(),
      hint: '在 workflow:addTask 的任务上带 executor 字段即可把子任务路由到网页端点。',
    });
  });

  // ── Plugin management routes ──
  const pluginRouter = require('express').Router();

  pluginRouter.get('/plugins', (req, res) => {
    res.json({ plugins: _pluginLoader.listPlugins() });
  });

  // ── GET /api/plugins/all — 列出所有插件（含已禁用的） ──
  // NOTE: must be before /plugins/:name to avoid :name matching "all"
  pluginRouter.get('/plugins/all', (req, res) => {
    const all = _pluginLoader.listAllPlugins();
    res.json({ plugins: all, total: all.length });
  });

  pluginRouter.get('/plugins/:name', (req, res) => {
    const plugin = _pluginLoader.getPlugin(req.params.name);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    res.json(plugin);
  });

  pluginRouter.post('/plugins/:name/reload', (req, res) => {
    const result = _pluginLoader.reloadPlugin(req.params.name);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  });

  // ── POST /api/plugins/:name/toggle — 启用/禁用插件 ──
  pluginRouter.post('/plugins/:name/toggle', (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: '"enabled" (boolean) is required' });
    }
    const result = _pluginLoader.setPluginEnabled(req.params.name, enabled);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json({ success: true, enabled });
  });

  // ── POST /api/plugins/create — 插件脚手架 ──
  pluginRouter.post('/plugins/create', (req, res) => {
    const { name, description, author, version, features } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: '"name" (string) is required' });
    }
    // 验证插件名格式：只允许小写字母、数字、连字符
    if (!/^[a-z0-9-]+$/.test(name)) {
      return res.status(400).json({ error: 'Plugin name must be kebab-case (lowercase letters, numbers, hyphens)' });
    }

    const pluginDir = path.join(_pluginLoader._pluginsDir, name);
    if (fs.existsSync(pluginDir)) {
      return res.status(409).json({ error: `Plugin directory "${name}" already exists` });
    }

    // 构建插件清单
    const manifest = {
      name,
      version: version || '0.1.0',
      description: description || '',
      author: author || '',
      license: 'MIT',
    };

    // 根据选择的特性添加对应的字段
    const selectedFeatures = Array.isArray(features) ? features : [];

    // 创建 handlers 目录
    const handlersDir = path.join(pluginDir, 'handlers');
    fs.mkdirSync(handlersDir, { recursive: true });

    // 创建 ui 目录
    const uiDir = path.join(pluginDir, 'ui');
    fs.mkdirSync(uiDir, { recursive: true });

    if (selectedFeatures.includes('cli') || selectedFeatures.includes('all')) {
      manifest.clis = [{
        id: `${name  }-tool`,
        name: `${name  }-tool`,
        path: `${name  }-tool`,
        category: 'tool',
        type: 'batch',
        args: [],
        init: '',
      }];
    }

    if (selectedFeatures.includes('workflow') || selectedFeatures.includes('all')) {
      manifest.workflows = [{
        id: `${name  }-workflow`,
        name: `${name  } Workflow`,
        description: `A workflow for ${  name}`,
        icon: '🔌',
        steps: [
          { id: 'step1', label: 'Step 1', agentId: 'opencode', task: 'The first step' },
        ],
      }];
    }

    if (selectedFeatures.includes('aiTool') || selectedFeatures.includes('all')) {
      manifest.aiTools = [{
        name: `${name  }_action`,
        description: `Custom action for ${  name}`,
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input value' },
          },
          required: ['input'],
        },
        handler: 'handlers/ai-tool.js',
      }];
      // 创建 AI tool handler 模板
      const aiToolContent = `module.exports = {
  execute: async (args, context) => {
    const { input } = args;
    // TODO: implement your custom logic here
    return \`Processed: \${input}\`;
  }
};\n`;
      fs.writeFileSync(path.join(handlersDir, 'ai-tool.js'), aiToolContent, 'utf-8');
    }

    if (selectedFeatures.includes('route') || selectedFeatures.includes('all')) {
      manifest.routes = [{
        method: 'GET',
        path: `/api/plugins/${  name  }/data`,
        handler: 'handlers/route.js',
      }];
      // 创建 route handler 模板
      const routeContent = `module.exports = function handler(req, res) {
  res.json({ plugin: '${name}', status: 'ok' });
};\n`;
      fs.writeFileSync(path.join(handlersDir, 'route.js'), routeContent, 'utf-8');
    }

    if (selectedFeatures.includes('ui') || selectedFeatures.includes('all')) {
      manifest.ui = {
        scripts: ['ui/panel.js'],
      };
      // 创建 UI panel 模板
      const panelContent = `(function() {
  'use strict';
  const UIR = window.QCLI?.UIRegistry;
  if (!UIR) return;

  UIR.registerTab('${name}:panel', {
    icon: '🔌',
    label: '${name}',
    order: 50,
    render: function(container) {
      container.innerHTML = '<div style="padding:20px;color:var(--text-primary);">'
        + '<h3>${name}</h3>'
        + '<p>Your plugin panel is ready!</p>'
        + '</div>';
    },
  });
})();\n`;
      fs.writeFileSync(path.join(uiDir, 'panel.js'), panelContent, 'utf-8');
    }

    if (selectedFeatures.includes('mcp') || selectedFeatures.includes('all')) {
      manifest.mcpServers = [{
        name: `${name  }-mcp`,
        command: 'node',
        args: ['mcp-server.js'],
        env: {},
      }];
    }

    // 创建 lifecycle 钩子模板（先构建完整的 manifest 再一次性写入）
    if (selectedFeatures.includes('lifecycle') || selectedFeatures.includes('all')) {
      manifest.lifecycle = {
        onLoad: 'handlers/init.js',
        onUnload: 'handlers/cleanup.js',
      };

      const initContent = `module.exports = async function onLoad(context) {
  const { plugin, pluginLoader } = context;
  console.log('[Plugin] ${name} loaded');
  // TODO: initialize your plugin
};\n`;
      fs.writeFileSync(path.join(handlersDir, 'init.js'), initContent, 'utf-8');

      const cleanupContent = `module.exports = async function onUnload(context) {
  const { plugin } = context;
  console.log('[Plugin] ${name} unloaded');
  // TODO: cleanup resources
};\n`;
      fs.writeFileSync(path.join(handlersDir, 'cleanup.js'), cleanupContent, 'utf-8');
    }

    // 一次性写入完整的 plugin.json
    fs.writeFileSync(path.join(pluginDir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    console.log(`[PluginLoader] Created plugin scaffold: ${name} (features: ${selectedFeatures.join(', ') || 'minimal'})`);

    // 尝试加载新创建的插件
    let loadResult = null;
    try {
      const result = _pluginLoader.createPluginFromScaffold(name);
      loadResult = result;
    } catch (err) {
      loadResult = { success: false, error: err.message };
    }

    res.status(201).json({
      success: true,
      plugin: {
        name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author,
        path: name,
        manifest,
      },
      loadResult,
      message: loadResult?.success
        ? `Plugin "${name}" created and loaded successfully`
        : `Plugin "${name}" created but could not be loaded: ${loadResult?.error || 'unknown error'}`,
    });
  });

  app.use('/api', requireToken, pluginRouter);

  // Expose pluginLoader on app for other modules
  app.set('pluginLoader', _pluginLoader);

  return { pluginLoader: _pluginLoader };
}

module.exports = { setupRoutes, getPluginLoader };
