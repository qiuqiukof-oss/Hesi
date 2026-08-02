/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// thinking-tips — 生成回复时的滚动小贴士
//
// 在 thinking indicator 底部状态条里循环展示的小提示/趣味句子，
// 让等待过程不那么枯燥。内容保持短句，避免干扰主体信息。
// ============================================================
// @ts-check
'use strict';

/** @type {string[]} */
export const THINKING_TIPS = [
  '💡 多 Agent 圆桌能同时让 AI 助手和 CLI Agent 讨论方案',
  '⌨️ 在终端按 Tab 可快速补全命令',
  '🗂️ 用文件夹把常用 CLI 分组，桌面更清爽',
  '🌙 点击右上角月亮图标切换深色/浅色主题',
  '📎 拖拽文件到终端区域即可上传',
  '🔍 搜索框支持按 CLI 名称、描述、标签过滤',
  '⏱️ 长命令执行时，右下角终端会实时输出进度',
  '🤝 让多个 Agent 先讨论再执行，方案错误率更低',
  '🛡️ 写 /tmp 等敏感路径时会出现审批闸，防止误操作',
  '🚀 用「/plan 目标」前缀可以让 AI 直接生成可执行计划',
  '✨ 提示环会显示上下文占用和缓存命中情况',
  '📜 历史 Plan 可以在右侧记忆面板里回溯',
];

let lastIndex = -1;

/**
 * Pick a random tip, avoiding immediate repeat.
 * @returns {string}
 */
export function nextTip() {
  if (THINKING_TIPS.length <= 1) return THINKING_TIPS[0] || '';
  let idx = Math.floor(Math.random() * THINKING_TIPS.length);
  while (idx === lastIndex) {
    idx = Math.floor(Math.random() * THINKING_TIPS.length);
  }
  lastIndex = idx;
  return THINKING_TIPS[idx];
}
