/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tool: exec_terminal
//
// 执行终端命令并返回输出。
// 安全性检查由 routes/tools.js 的 isSafeCommand 负责。
// ============================================================

const { classifyError } = require('../errors');
const { fetchPost } = require('../internal-api');

/**
 * @param {import('../registry').ToolRegistry} registry
 * @param {object} deps
 * @param {import('../rate-limit').TokenBucket} deps.rateLimiter
 */
function register(registry, deps) {
  const { rateLimiter } = deps;

  registry.register({
    name: 'exec_terminal',
    description: '在服务器上执行一个终端命令并返回输出。适用于查看文件、运行脚本、检查环境等操作。不适用于交互式命令（如 vim、top）。注意：命令默认在工作区目录执行。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要执行的终端命令',
        },
        timeout: {
          type: 'number',
          description: '超时时间（毫秒），默认 30000，最大 60000',
        },
        cwd: {
          type: 'string',
          description: '工作目录（相对于项目根目录），默认根目录',
        },
      },
      required: ['command'],
    },
    execute: async (args, broadcastFn, requestId) => {
      // 限流：exec_terminal 消耗 1 个 token（按 requestId 隔离，避免多会话相互饿死）
      // 注意 TokenBucketMap.tryConsume(key, cost) 的参数顺序：key 在前、cost 在后
      if (!rateLimiter.tryConsume(requestId, 1)) {
        return 'Error: 操作过于频繁，请稍后再试';
      }

      const { isSafeCommand } = require('../../tools');
      const safety = isSafeCommand(args.command);
      if (!safety.allowed) {
        return `[Blocked] ${safety.reason}`;
      }

      try {
        const execResult = await fetchPost('/tools/exec', {
          command: args.command,
          timeout: args.timeout || 30000,
          cwd: args.cwd || undefined,
        });
        let output = '';
        if (execResult.stdout) output += `STDOUT:\n${execResult.stdout}\n`;
        if (execResult.stderr) output += `STDERR:\n${execResult.stderr}\n`;
        output += `\nExit code: ${execResult.exitCode} | Duration: ${execResult.duration}ms`;
        if (execResult.truncated) output += '\n[Output truncated]';
        return output;
      } catch (err) {
        return `Execution error: ${err.message}`;
      }
    },
  });
}

module.exports = { register };
