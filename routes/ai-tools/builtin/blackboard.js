/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Builtin Tools: blackboard_read / blackboard_patch / blackboard_write
// 共享黑板（多 Agent 协作结构化状态中心）的 AI 可调用接口。
// 直接复用 lib/blackboard（零新增传输面），经 registry.execute 通道。
// ============================================================

const path = require('path');
const blackboard = require(path.join(__dirname, '..', '..', '..', 'lib', 'blackboard'));

/**
 * @param {import('../registry').ToolRegistry} registry
 */
function register(registry) {
  registry.register({
    name: 'blackboard_read',
    description:
      '读取共享黑板（多 Agent 协作的结构化状态中心）。返回指定 projectId 的当前状态：' +
      'version、status、files（路径→{hash,status}）、tasks（[{id,assignee,type,status}]）、' +
      'roles（agent→role）、logs。\n协议：在 patch 前先 read 以拿到最新 version 与各文件 hash，用于乐观锁。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '黑板项目 ID，默认 default' },
      },
    },
    execute: async (args) => {
      try {
        const state = blackboard.read(args.projectId || 'default');
        return state ? JSON.stringify(state, null, 2) : '(空黑板：尚未初始化，请先 blackboard_write 或 blackboard_patch)';
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'blackboard_patch',
    description:
      '字段级更新共享黑板（乐观锁）。传入要合并的状态片段，例如：' +
      '{status:"coding", tasks:[{id:"t1",status:"in_progress",assignee:"opencode"}], ' +
      'files:{"a.js":{status:"done",hash:"a1b2"}}, roles:{"opencode":"coder"}, ' +
      'logs:[{actor:"system",msg:"..."}]}。\n只改传入的键，未传的键不丢。' +
      '可选 expectedVersion（= read 拿到的 version）与 expectedChecksums（{文件路径:hash}）防并发覆盖；' +
      '冲突时返回 BlackboardConflict，请重新 read 后合并再 patch。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '黑板项目 ID，默认 default' },
        patch: { type: 'object', description: '要字段级合并的状态片段（status/tasks/files/roles/logs 等）' },
        expectedVersion: { type: 'number', description: '乐观锁：期望当前 version（来自 blackboard_read）；不一致则冲突报错' },
        expectedChecksums: { type: 'object', description: '乐观锁：{ 文件路径: hash }，任一不符则冲突报错（防并发改同一文件）' },
      },
      required: ['patch'],
    },
    execute: async (args) => {
      try {
        const opts = {};
        if (args.expectedVersion !== undefined) opts.expectedVersion = Number(args.expectedVersion);
        if (args.expectedChecksums) opts.expectedChecksums = args.expectedChecksums;
        const state = await blackboard.patch(args.projectId || 'default', args.patch || {}, opts);
        return JSON.stringify(state, null, 2);
      } catch (err) {
        if (err.name === 'BlackboardConflictError') {
          return `BlackboardConflict: ${err.message}（请重新 blackboard_read 拿到最新 version/files hash，合并你的改动后再次 patch）`;
        }
        return `Error: ${err.message}`;
      }
    },
  });

  registry.register({
    name: 'blackboard_write',
    description: '全量初始化或重置共享黑板（仅用于新建项目/彻底重置）。日常增量更新请用 blackboard_patch。',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: '黑板项目 ID，默认 default' },
        state: { type: 'object', description: '完整状态对象（status/files/tasks/roles/logs）' },
      },
      required: ['state'],
    },
    execute: async (args) => {
      try {
        const state = await blackboard.write(args.projectId || 'default', args.state || {});
        return JSON.stringify(state, null, 2);
      } catch (err) {
        return `Error: ${err.message}`;
      }
    },
  });
}

module.exports = { register };
