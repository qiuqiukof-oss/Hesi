// ============================================================
// Builtin Tool: workbuddy
//
// 调用 WorkBuddy CLI 执行任务并返回输出。
// WorkBuddy 是一个结构化 CLI 工具，支持子命令：
//   jobs, items, stages, auth, settings, customers,
//   employees, agents, mcp, exports, webhooks 等。
//
// 使用 headless PTY 执行，兼容交互式 CLI 环境。
// ============================================================

const { createHeadlessPTY } = require('../../../ws/pty');
const { loadRegistry } = require('../../../cli-discovery');

/**
 * 在 headless PTY 中执行 WorkBuddy 命令，收集输出并返回。
 *
 * @param {string} cmd - workbuddy 命令（如 'jobs search'）
 * @param {number} [timeout=30000] - 超时毫秒
 * @returns {Promise<string>} 命令输出
 */
function executeWorkbuddy(cmd, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const registry = loadRegistry();
    const wbEntry = registry.clis.find(c =>
      c.id === 'workbuddy' || c.name === 'workbuddy'
    );
    if (!wbEntry) {
      resolve('[WorkBuddy] 错误：未在 CLI registry 中找到 workbuddy');
      return;
    }

    // registry 中存储的已经是解析后的绝对路径
    const commandPath = wbEntry.path;
    // 解析命令参数（如 'jobs search --limit 5' → ['jobs', 'search', '--limit', '5']）
    const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const args = parts;

    const outputChunks = [];
    const timer = setTimeout(() => {
      try { pty.kill(); } catch { /* ignore */ }
      const output = outputChunks.join('').trim();
      resolve(output
        ? `${output  }\n\n[WorkBuddy] 命令执行超时，以上为已捕获的输出`
        : '[WorkBuddy] 命令执行超时，未捕获到输出'
      );
    }, timeout);

    const pty = createHeadlessPTY(commandPath, args, {
      cols: 120,
      rows: 80,
      onData: (data) => {
        outputChunks.push(data);
      },
      onExit: ({ exitCode, signal }) => {
        clearTimeout(timer);
        const output = outputChunks.join('').trim();
        if (exitCode === 0) {
          resolve(output || '(命令执行成功，无输出)');
        } else {
          resolve(output
            ? `${output  }\n\n[WorkBuddy] 命令退出码: ${exitCode}${signal ? ` (signal: ${signal})` : ''}`
            : `[WorkBuddy] 命令执行失败 (退出码: ${exitCode})`
          );
        }
      },
      onError: (err) => {
        clearTimeout(timer);
        resolve(`[WorkBuddy] 启动失败: ${err.message}`);
      },
    });
  });
}

/**
 * 注册 workbuddy 工具。
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'workbuddy',
    description: '调用 WorkBuddy CLI 执行管理任务。WorkBuddy 支持以下子命令：\n' +
      '  jobs       — 工单管理（搜索、创建、更新、删除）\n' +
      '  items      — 物料/项目条目管理\n' +
      '  stages     — 阶段管理\n' +
      '  customers  — 客户管理\n' +
      '  employees  — 员工管理\n' +
      '  agents     — AI Agent 生命周期管理\n' +
      '  mcp        — MCP 工具管理\n' +
      '  settings   — 租户配置（工单类型、优先级、区域等）\n' +
      '  auth       — 认证与凭据管理\n' +
      '  exports    — 数据导出\n' +
      '  webhooks   — Webhook 订阅管理\n' +
      '  attachments — 文件上传管理\n' +
      '使用 workbuddy --describe 可查看所有可用操作的 JSON 描述。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的 WorkBuddy 命令（子命令 + 参数），如 "jobs search --limit 5"、"auth login"、"agents list"',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 30000，最大 120000',
          default: 30000,
        },
      },
      required: ['command'],
    },
    execute: async (args, broadcastFn) => {
      const cmd = (args.command || '').trim();
      if (!cmd) return '[WorkBuddy] 错误：command 参数不能为空';

      const timeout = Math.min(args.timeout || 30000, 120000);
      return executeWorkbuddy(cmd, timeout);
    },
  });

  // 注册 describe 工具（无参数，用于探测 WorkBuddy 能力）
  registry.register({
    name: 'workbuddy_describe',
    noTruncate: true,
    description: '获取 WorkBuddy CLI 的所有可用操作描述（JSON 格式）。' +
      '适合在不确定 WorkBuddy 支持哪些功能时先调用此工具了解全貌。',
    parameters: {
      type: 'object',
      properties: {
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 15000',
          default: 15000,
        },
      },
    },
    execute: async (args, broadcastFn) => {
      const timeout = Math.min(args.timeout || 15000, 30000);
      const output = await executeWorkbuddy('--describe', timeout);
      // 尝试解析 JSON 美化输出
      try {
        const parsed = JSON.parse(output);
        return JSON.stringify(parsed, null, 2);
      } catch {
        return output;
      }
    },
  });
}

module.exports = { register, executeWorkbuddy };
