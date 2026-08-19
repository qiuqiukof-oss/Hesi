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
  // ── 功能用法 ──
  '💡 多 Agent 圆桌能同时让 AI 助手和 CLI Agent 讨论方案',
  '⌨️ 在终端按 Tab 可快速补全命令',
  '🗂️ 用文件夹把常用 CLI 分组，桌面更清爽',
  '🌙 点击右上角月亮图标切换深色/浅色主题',
  '📎 拖拽文件到终端区域即可上传为附件',
  '🔍 搜索框支持按 CLI 名称、描述、标签过滤',
  '⏱️ 长命令执行时，右下角终端会实时输出进度',
  '🤝 让多个 Agent 先讨论再执行，方案错误率更低',
  '🛡️ 写 /tmp 等敏感路径时会出现审批闸，防误操作',
  '🚀 用「/plan 目标」前缀可让 AI 直接生成可执行计划',
  '✨ 提示环会显示上下文占用和缓存命中情况',
  '📜 历史 Plan 可在右侧记忆面板里回溯',
  '🧠 复杂任务可在设置里选支持深度思考的推理模型',
  '🔁 回复中断时说「继续」可续写，说「重试」可重来',
  '🌐 提示里加「联网搜索」会调用实时搜索工具',
  '📝 开启记忆后，AI 会记住本会话的偏好与上下文',
  '🗜️ 长会话会自动压缩上下文，无需手动清理',
  '🛑 审批闸出现别慌：看清路径/命令，再放行或驳回',
  '✅ 可勾选「本次会话始终允许」跳过重复审批确认',

  // ── 提示词技巧 ──
  '✍️ 好提示 = 角色 + 目标 + 约束 + 输出格式',
  '📌 给 1–2 个示例（few-shot）比纯描述更准',
  '🪜 把大任务拆成带「完成标准」的步骤',
  '🚫 说清「不要做什么」比只说「要什么」更防跑偏',
  '💬 让 AI 先列方案再动手，可减少返工',
  '🎯 明确验收标准，AI 才知道做到什么算完',
  '🧩 复杂需求分多轮推进，每轮只解决一个点',
  '🔧 涉及命令时写明环境（Windows/Linux/WSL）',

  // ── 注意要点 ──
  '📜 写脚本步骤用 bash <path> 调用，比裸路径更稳',
  '⏱️ 本地小模型推理慢、长输出易超时，换更强模型',
  '💰 多 Agent 圆桌随「Agent 数 × 轮数」放大 token 消耗',
  '🧷 推理模型思考越深，首字延迟越长，属正常现象',
  '📉 上下文越长响应越慢，无关历史可开新会话',
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
