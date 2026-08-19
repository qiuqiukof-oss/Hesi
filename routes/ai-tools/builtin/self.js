/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tools: get_self_info, rebuild_frontend
//
// AI 自我认知和自我进化工具。
// ============================================================

const { fetchPost } = require('../internal-api');
const { DEFAULT_CDP_URL } = require('../../browser/helpers');

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'get_self_info',
    description: '返回 Hesi 项目自身的架构信息、文件结构、以及 AI 助手的自我进化能力列表。用于 AI 了解自己运行在什么环境中、可以怎样修改自己。中文：获取项目架构和自进化能力信息。',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const fs = require('fs');
      const path = require('path');
      const root = process.cwd();
      let pkg = {};
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      } catch (e) {
        console.warn('[Self] Failed to read package.json:', e.message);
      }

      const srcFiles = [
        'server.js', 'ws-handler.js', 'cli-discovery.js',
        'routes/chat.js', 'routes/browser.js',
        'mcp/bridge.js', 'mcp/tools/browser.js',
        'public/chat-ui.js', 'public/chat-api.js',
        'public/components/chat-panel.js',
      ];
      const fileInfo = {};
      for (const f of srcFiles) {
        try {
          const p = path.join(root, f);
          const stat = fs.statSync(p);
          fileInfo[f] = `${(stat.size / 1024).toFixed(1)} KB`;
        } catch { fileInfo[f] = 'N/A'; }
      }

      return JSON.stringify({
        project: {
          name: pkg.name,
          version: pkg.version,
          description: pkg.description,
          rootDir: root,
        },
        architecture: {
          server: 'Express (server.js) — HTTP + WebSocket',
          terminal: 'node-pty + xterm.js (ws-handler.js)',
          browserControl: 'Playwright CDP (routes/browser.js + mcp/tools/browser.js)',
          aiChat: 'BYOK OpenAI/Anthropic (routes/chat.js)',
          mcpServer: 'Modular MCP (mcp/)',
          frontend: 'Vanilla JS + Web Components (public/)',
        },
        selfEvolution: {
          'read_file': '读取自己的源代码文件',
          'write_file': '修改自己的源代码文件',
          'exec_terminal': '执行 npm run build 重新编译前端',
          'rebuild_frontend': '一键重新编译前端 + 刷新浏览器',
          'browser_evaluate': '在自身页面中执行 JS，实时修改 DOM/样式',
          'browser_screenshot': '截图看到自己的 UI 状态',
          'browser_list_tabs': '查看自己运行在哪个标签页',
          'workflow': '读 → 改 → build → refresh = 完整的自我进化循环',
        },
        keyFiles: fileInfo,
        keyDirectories: {
          routes: 'API 路由',
          'routes/ai-tools': 'AI 工具注册表 + 内置工具',
          mcp: 'MCP 模块化服务器',
          'mcp/tools': 'MCP 工具（browser/session/execute/registry）',
          public: '前端静态资源',
          'public/components': 'Web Components',
        },
        buildCommand: 'npm run build',
        serverPort: process.env.PORT || 4264,
        cdpEndpoint: DEFAULT_CDP_URL,
      }, null, 2);
    },
  });

  registry.register({
    name: 'rebuild_frontend',
    description: '重新编译前端 bundle（npm run build）并可选刷新浏览器页面。在 AI 修改了自己的前端源代码后调用此工具使变更生效。中文：重新编译前端并刷新页面。',
    parameters: {
      type: 'object',
      properties: {
        refreshBrowser: {
          type: 'boolean',
          description: '编译完成后是否刷新浏览器页面（如果已连接 CDP）。默认 true',
          default: true,
        },
      },
    },
    execute: async (args) => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const refreshBrowser = args.refreshBrowser !== false;
      try {
        const { stdout } = await execAsync('npm run build 2>&1', {
          cwd: process.cwd(),
          timeout: 60000,
          encoding: 'utf8',
          maxBuffer: 10 * 1024 * 1024,
        });
        const result = stdout;
        let refreshResult = 'skipped (no refresh requested)';
        if (refreshBrowser) {
          try {
            const data = await fetchPost('/browser/refresh', {});
            refreshResult = data.success ? 'browser refreshed' : `browser refresh: ${data.error || 'unknown'}`;
          } catch (e) {
            refreshResult = `browser refresh failed: ${e.message} (CDP may not be connected)`;
          }
        }
        return `Build successful!\nOutput:\n${result.slice(-2000)}\n${refreshResult}`;
      } catch (e) {
        return `Build failed:\n${e.message}`;
      }
    },
  });
}

module.exports = { register };
