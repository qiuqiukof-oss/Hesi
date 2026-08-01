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
// 互斥：两者同时勾选语义不清（讨论是「先谈」、执行是「后做」），
//       故 UI 层直接互斥，勾一个自动松开另一个，避免用户困惑。
// ============================================================
'use strict';

export const planControlsMixin = {
  _setupPlanControls() {
    if (this._planInitStarted) return;
    this._planInitStarted = true;

    const toggle = document.getElementById('plan-toggle');
    const controls = document.getElementById('plan-controls');
    const agentSel = document.getElementById('plan-agent');
    const discussToggle = document.getElementById('discuss-toggle');
    if (!toggle || !controls || !agentSel) return;

    const sync = () => {
      this._planEnabled = !!toggle.checked;
      this._planAgentId = agentSel.value || 'ai';
      controls.style.display = this._planEnabled ? 'flex' : 'none';
    };

    toggle.addEventListener('change', () => {
      // 互斥：开「自动执行」→ 关「AI 讨论」
      if (toggle.checked && discussToggle && discussToggle.checked) {
        discussToggle.checked = false;
        discussToggle.dispatchEvent(new Event('change'));
      }
      sync();
    });
    agentSel.addEventListener('change', sync);

    // 反向互斥：开「AI 讨论」→ 关「自动执行」
    if (discussToggle) {
      discussToggle.addEventListener('change', () => {
        if (discussToggle.checked && toggle.checked) {
          toggle.checked = false;
          sync();
        }
      });
    }

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
