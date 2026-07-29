/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// 工具名 → 中文友好标签
// 流式状态提示统一用「使用「XX工具」」形式；未知工具 / MCP 动态工具
// 一律回退为「工具」。两个流式内核（OpenAI / Anthropic）共用，避免重复。
// ============================================================
'use strict';

/** 内置工具 → 中文标签（覆盖 routes/ai-tools/builtin 全部注册项） */
const TOOL_LABELS = {
  read_file: '读取工具',
  write_file: '写入工具',
  edit_file: '编辑工具',
  list_directory: '目录列表工具',
  exec_terminal: '终端命令工具',
  rebuild_frontend: '前端重建工具',
  get_self_info: '自身信息工具',
  web_fetch: '联网读取工具',
  web_search: '联网搜索工具',
  generate_image: '图像生成工具',
  generate_video: '视频生成工具',
  get_stock_data: '行情查询工具',
  blackboard_read: '看板读取工具',
  blackboard_write: '看板写入工具',
  blackboard_patch: '看板更新工具',
  analyze_workspace: '工作区分析工具',
  list_clis: '终端列表工具',
  list_workflows: '工作流列表工具',
  list_agents: '智能体列表工具',
  agent_delegate: '智能体委派工具',
  agent_start: '智能体启动工具',
  agent_poll: '智能体轮询工具',
  agent_send: '智能体消息工具',
  agent_cancel: '智能体取消工具',
  agent_list: '智能体列表工具',
  agent_callbacks: '智能体回调工具',
  workflow_start: '工作流启动工具',
  workflow_status: '工作流状态工具',
  workflow_add_task: '工作流任务工具',
  convert_document: '文档转换工具',
  workbuddy: '工作流执行工具',
  workbuddy_describe: '工作流描述工具',
};

/** 单个工具名 → 标签（未知回退「工具」） */
function toolLabel(name) {
  if (!name) return '工具';
  return TOOL_LABELS[name] || '工具';
}

/** 工具名数组 → 「读取工具」「写入工具」 形式（空数组回退「工具」） */
function describeTools(names) {
  const list = (Array.isArray(names) ? names : [names]).filter(Boolean);
  if (list.length === 0) return '工具';
  return list.map((n) => `「${toolLabel(n)}」`).join('');
}

module.exports = { TOOL_LABELS, toolLabel, describeTools };
