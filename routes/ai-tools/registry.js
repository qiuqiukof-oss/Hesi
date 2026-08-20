/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// ToolRegistry — 声明式 AI 工具注册表
//
// 取代 chat.js 中的 QCLI_TOOLS 硬编码数组 + executeToolCall switch。
// 每个工具注册 name + description + parameters (JSON Schema) + execute handler。
// ============================================================

class ToolRegistry {
  constructor() {
    /** @type {Map<string, {name:string, description:string, parameters:object, execute:Function}>} */
    this._tools = new Map();
    /** @type {Array<Function>} 注册订阅者（插件动态注册的工具需实时并入 LLM 感知数组） */
    this._subscribers = [];
  }

  /**
   * 订阅工具注册事件（Hesi-main 对齐：QCLI_TOOLS 是启动快照，
   * 插件 aiTools 在启动后注册，需经此钩子就地并入感知数组）。
   * @param {(tool: object) => void} fn
   */
  onRegister(fn) {
    if (typeof fn === 'function') this._subscribers.push(fn);
  }

  /**
   * 注册一个工具。
   * @param {object} tool
   * @param {string} tool.name - 工具名称（唯一）
   * @param {string} tool.description - 工具描述
   * @param {object} tool.parameters - JSON Schema 参数定义
   * @param {Function} tool.execute - (args, broadcastFn) => Promise<string>
   * @param {boolean} [tool.noTruncate=false] - 是否跳过 token 截断
   */
  register(tool) {
    if (this._tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this._tools.set(tool.name, { ...tool, noTruncate: tool.noTruncate || false });
    // 通知订阅者（插件工具并入 LLM 感知数组等）
    for (const fn of this._subscribers) {
      try { fn(tool); } catch { /* 订阅者自身问题不影响注册 */ }
    }
  }

  /** 返回 OpenAI function calling 格式的 tools 数组 */
  get definitions() {
    return [...this._tools.values()].map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * 执行一个工具。
   * @param {string} name
   * @param {object} args
   * @param {Function} [broadcastFn]
   * @param {string} [requestId] - 每请求隔离标识，透传给工具 handler（限流归属用）
   * @param {string} [sessionId] - 记忆会话标识，透传给工具 handler（Phase 2 文件写副作用快照）
   * @returns {Promise<string>}
   */
  async execute(name, args, broadcastFn, requestId, sessionId) {
    const tool = this._tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.execute(args, broadcastFn, requestId, sessionId);
  }

  /** 检查工具是否存在 */
  has(name) {
    return this._tools.has(name);
  }

  /** 返回所有工具名称 */
  get names() {
    return [...this._tools.keys()];
  }

  /** 返回注册数量 */
  get size() {
    return this._tools.size;
  }
}

module.exports = { ToolRegistry };
