/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tools: analyze_workspace, list_clis, list_workflows, list_agents
// ============================================================

const { fetchGet } = require('../internal-api');

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'analyze_workspace',
    description: '扫描分析当前工作区（Hesi 服务器所在目录）— 返回文件统计、项目类型检测、主要编程语言、目录结构和关键文件',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const data = await fetchGet('/project/analyze');
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'list_clis',
    description: '列出 Hesi 中所有已注册的 CLI 工具 — 包含名称、路径、版本、分类（Agent / Env / Tool）',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const data = await fetchGet('/clis');
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'list_workflows',
    description: '列出所有预置的工作流 — Code Review、Test Suite、Build Verify 等，包含描述和执行方式',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const data = await fetchGet('/workflows');
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'list_agents',
    description: '扫描 PATH 并列出所有已安装的 AI 编程 Agent（opencode、codebuff、aider、claude、codex 等）— 包含版本和安装路径',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      try {
        const data = await fetchGet('/agents');
        return JSON.stringify(data, null, 2);
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { register };
