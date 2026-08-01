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

    // 执行方下拉：'ai'（默认，复用 AI 助手工具环）+ 已安装的外部 CLI Agent。
    // PartnerStore 与讨论控件同源，可能尚未就绪 → 同款 30ms 短轮询（最多 5s）。
    const fillAgents = () => {
      const PS = window.PartnerStore;
      if (!PS || typeof PS.loadPartnerSource !== 'function') return false;
      PS.loadPartnerSource().then((res) => {
        const list = (res && res.list) || [];
        const keep = agentSel.value || 'ai';
        for (const a of list) {
          if (agentSel.querySelector(`option[value="${CSS.escape(a.id)}"]`)) continue;
          const opt = document.createElement('option');
          opt.value = a.id;
          opt.textContent = (a.displayName || a.name || a.id) + ' 执行';
          agentSel.appendChild(opt);
        }
        agentSel.value = keep;
        sync();
      }).catch(() => { /* 取不到外部 Agent 不影响默认 'ai' 执行 */ });
      return true;
    };

    if (!fillAgents()) {
      const t = setInterval(() => { if (fillAgents()) clearInterval(t); }, 30);
      setTimeout(() => clearInterval(t), 5000);
    }

    sync();
  },
};
