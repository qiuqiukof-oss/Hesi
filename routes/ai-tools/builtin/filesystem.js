/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tools: read_file, write_file, list_directory
// ============================================================

const { fetchGet, fetchPost } = require('../internal-api');

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'read_file',
    description: '读取工作区内的一个文件。支持文本文件和常见代码文件。文件最大 1MB。大文件建议用 offset/limit 分段读取（行号 1-based）。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
        encoding: { type: 'string', description: '编码，默认 utf8', default: 'utf8' },
        offset: { type: 'number', description: '起始行号（1-based，可选）。用于大文件分段读取' },
        limit: { type: 'number', description: '读取行数（可选，配合 offset）。建议 ≤ 400' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      try {
        const data = await fetchGet('/tools/read-file', { path: args.path, encoding: args.encoding || 'utf8' });
        // v0.3.1 A1：offset/limit 分段读取（向后兼容：不传 = 全文，原行为）
        const offset = Number.isFinite(Number(args.offset)) && Number(args.offset) > 0 ? Math.floor(Number(args.offset)) : 0;
        const limit = Number.isFinite(Number(args.limit)) && Number(args.limit) > 0 ? Math.floor(Number(args.limit)) : 0;
        if (offset || limit) {
          const lines = String(data.content).split('\n');
          const start = offset ? offset - 1 : 0; // 1-based → 0-based
          const end = limit ? start + limit : lines.length;
          const seg = lines.slice(start, end).join('\n');
          const rangeNote = `Lines: ${start + 1}-${Math.min(end, lines.length)} of ${lines.length}`;
          return `File: ${data.path}\nLanguage: ${data.language}\nSize: ${data.size} bytes\n${rangeNote}\n\n${seg}`;
        }
        return `File: ${data.path}\nLanguage: ${data.language}\nSize: ${data.size} bytes\n\n${data.content}`;
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'write_file',
    noTruncate: true,
    description: '写入或创建工作区内的一个文件。如果父目录不存在会自动创建。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
    execute: async (args, _broadcastFn, _requestId, sessionId) => {
      try {
        const result = await fetchPost('/tools/write-file', { path: args.path, content: args.content, sessionId });
        return `Written ${result.size} bytes to ${result.path}`;
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'list_directory',
    description: '列出工作区内某个目录的内容（包含文件大小和类型）。默认递归深度 1 级，最大 3 级。隐藏文件和 node_modules 被跳过。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '目录路径（相对于项目根目录），默认为根目录', default: '.' },
        depth: { type: 'number', description: '递归深度，默认 1，最大 3', default: 1 },
      },
    },
    execute: async (args) => {
      try {
        const dirData = await fetchGet('/tools/list-dir', { dir: args.dir || '.', depth: args.depth || 1 });
        const lines = dirData.entries.map(e => {
          if (e.type === 'directory') return `📁 ${e.path}/`;
          return `📄 ${e.path} (${e.size || 0} bytes)`;
        });
        return `Directory: ${dirData.path}\nTotal: ${dirData.total} entries\n\n${lines.join('\n')}`;
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { register };
