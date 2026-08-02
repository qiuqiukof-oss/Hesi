/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// 「⚡ 自动执行」控件装配（P2：Plan 执行器并入 AI 对话）
//
// 原型 mixin：planControlsMixin，含 _setupPlanControls。
// 在 chat-panel.js 经 Object.assign(ChatPanel.prototype, planControlsMixin) 挂回。
//
// 与「🤝 AI 讨论」并列的第二个输入框开关，走完全相同的装配范式：
//   checkbox → this._planEnabled → 发送时透传 planMode:true → 后端分流。
//
// P6：不再互斥——同时勾选 AI 讨论+选伙伴+自动执行 → 协作工作流（讨论→方案→实施）。
// ============================================================
'use strict';

export const planControlsMixin = {
  _setupPlanControls() {
    if (this._planInitStarted) return;
    this._planInitStarted = true;

    const toggle = document.getElementById('plan-toggle');
    const controls = document.getElementById('plan-controls');
    const agentSel = document.getElementById('plan-agent');
    if (!toggle || !controls || !agentSel) return;

    const sync = () => {
      this._planEnabled = !!toggle.checked;
      this._planAgentId = agentSel.value || 'ai';
      controls.style.display = this._planEnabled ? 'flex' : 'none';
      // P6：同时勾选 AI 讨论→显示协作提示
      const hint = document.getElementById('plan-collab-hint');
      if (hint) hint.style.display = (this._planEnabled && this._discussEnabled) ? 'block' : 'none';
    };

    toggle.addEventListener('change', () => {
      sync();
    });
    agentSel.addEventListener('change', sync);

    // 执行方锁定为「AI 助手执行」——安全设计（v0.7.0 CLI Agent 隔离）：
    // 外部 CLI Agent 执行时其实际命令不受 Hesi 运行时拦截/审批闸约束（自主执行），
    // 且每步启动 23-35s。执行阶段仅 AI 助手，CLI Agent 只参与讨论。
    // 不再向下拉填充外部 Agent；后端另有 HESI_PLAN_ALLOW_CLI_EXECUTOR=1 兜底开关。
    sync();
  },
};
