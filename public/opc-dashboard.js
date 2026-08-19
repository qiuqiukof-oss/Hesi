/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// OPC Dashboard — One Person Company 成本效益监控面板
//
// 注册为右侧栏 Tab（通过 UIRegistry）。
// 通过监听 MCP METRIC 事件（mcp_metric WS消息）自动收集
// AI工具调用数据，计算成本、节省工时和ROI。
//
// 核心理念（腾讯云AI公开课）：
//   - 100张图渲染仅需 ¥0.4 算力
//   - 3-5人可替代传统100-150人的工作
//   - 获客成本仅为传统模式的1/10
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/**
 * OPC Dashboard 状态。
 */
const OPCDashboard = {
  stats: {
    totalToolCalls: 0,
    totalTokens: 0,
    estimatedCostUSD: 0,
    humanHoursSaved: 0,
    // WorkBuddy 专属指标
    wbCalls: 0,
    wbDuration: 0,
    wbHumanHoursSaved: 0,
  },
};

/**
 * 从 MCP METRIC 事件中收集数据。
 * @param {object} metric — METRIC 事件对象（来自 mcp_metric WS消息）
 */
function recordMetric(metric) {
  if (!metric) return;

  // 累计 token
  if (metric.tokenIn) OPCDashboard.stats.totalTokens += metric.tokenIn;
  if (metric.tokenOut) OPCDashboard.stats.totalTokens += metric.tokenOut;

  // 工具调用次数（tool_call 或 resource_read 都算一次调用）
  if (metric.ev === 'tool_call' || metric.ev === 'resource_read') {
    OPCDashboard.stats.totalToolCalls++;
  }

  // 估算成本（采用 gpt-4o-mini 价格：$0.15/M input tokens, $0.60/M output tokens）
  // 这是保守估计，实际使用的模型可能更贵或更便宜
  const inputTokens = metric.tokenIn || 0;
  const outputTokens = metric.tokenOut || 0;
  OPCDashboard.stats.estimatedCostUSD +=
    (inputTokens / 1_000_000) * 0.15 +
    (outputTokens / 1_000_000) * 0.60;

  // 估算节省人力：每个 tool_call 约等价于5分钟人工工作量
  // 基于：一个简单的数据分析/代码生成任务，人工需5-10分钟，AI几十秒
  OPCDashboard.stats.humanHoursSaved =
    Math.round((OPCDashboard.stats.totalToolCalls * 5 / 60) * 10) / 10;

  // ── WorkBuddy 专属指标追踪 ──
  if (metric.tool === 'workbuddy' || metric.type === 'wb:usage') {
    OPCDashboard.stats.wbCalls++;
    OPCDashboard.stats.wbDuration += metric.durMs || metric.duration || 0;
    // 每个 WorkBuddy 调用约节省 15 分钟人工（复杂的业务操作）
    OPCDashboard.stats.wbHumanHoursSaved =
      Math.round((OPCDashboard.stats.wbCalls * 15 / 60) * 10) / 10;
  }

  updateDashboard();
}

/**
 * 计算人力节省价值（人民币）。
 *
 * 假设：
 *   - 基础岗位月薪 8000元（参考二三线城市）
 *   - 每月22个工作日，每天8小时
 *   - 每小时成本 ≈ 45.45元
 *   - 美元汇率按 7.3 估算
 */
function calculateSavings() {
  const hourlyRate = 8000 / (22 * 8); // ~45.45元/小时
  const hours = OPCDashboard.stats.humanHoursSaved;
  const laborCost = hours * hourlyRate;
  const aiCostCNY = OPCDashboard.stats.estimatedCostUSD * 7.3;

  return {
    hoursSaved: Math.round(hours * 10) / 10,
    laborCostSaved: Math.round(laborCost * 100) / 100,
    aiCost: Math.round(aiCostCNY * 100) / 100,
    netSavings: Math.round((laborCost - aiCostCNY) * 100) / 100,
    roi: aiCostCNY > 0
      ? Math.round((laborCost / aiCostCNY) * 100) / 100
      : 0,
  };
}

/**
 * 格式化 token 数为可读形式。
 * @param {number} tokens
 * @returns {string}
 */
function formatTokens(tokens) {
  if (tokens >= 1_000_000) return (tokens / 1_000_000).toFixed(1) + 'M';
  if (tokens >= 1_000) return (tokens / 1_000).toFixed(1) + 'K';
  return tokens.toString();
}

/**
 * 渲染 OPC 仪表盘面板。
 */
function updateDashboard() {
  const panel = document.getElementById('rp-opc-dashboard');
  if (!panel) return;

  const { totalToolCalls, totalTokens, estimatedCostUSD, humanHoursSaved, wbCalls, wbDuration, wbHumanHoursSaved } = OPCDashboard.stats;
  const savings = calculateSavings();

  panel.innerHTML = [
    '<div style="padding:16px;">',
    // ── 标题 ──
    '<div style="font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text-primary);">🏢 OPC 效益监控</div>',

    // ── 核心指标卡片 ──
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">',
    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">',
    '<div style="font-size:22px;font-weight:700;color:#3b82f6;">', String(totalToolCalls), '</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);">AI 工具调用</div></div>',

    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">',
    '<div style="font-size:22px;font-weight:700;color:#8b5cf6;">', formatTokens(totalTokens), '</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);">Token 消耗</div></div>',

    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">',
    '<div style="font-size:22px;font-weight:700;color:#22c55e;">¥', savings.aiCost.toFixed(2), '</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);">AI 总成本</div></div>',

    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;">',
    '<div style="font-size:22px;font-weight:700;color:#f59e0b;">', String(humanHoursSaved), 'h</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);">等效节省工时</div></div>',
    '</div>',

    // ── WorkBuddy 专属指标卡片 ──
    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;text-align:center;border-left:3px solid #8b5cf6;margin-bottom:16px;">',
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">',
    '<div><div style="font-size:20px;font-weight:700;color:#8b5cf6;">', String(wbCalls), '</div>',
    '<div style="font-size:10px;color:var(--text-tertiary);">🤖 WorkBuddy 调用</div></div>',
    '<div><div style="font-size:20px;font-weight:700;color:#8b5cf6;">', String(wbHumanHoursSaved), 'h</div>',
    '<div style="font-size:10px;color:var(--text-tertiary);">等效节省工时</div></div>',
    wbCalls > 0 ? '<div style="grid-column:span 2;"><div style="font-size:11px;color:var(--text-tertiary);">平均耗时: ' + (wbDuration / wbCalls).toFixed(0) + 'ms</div></div>' : '',
    '</div></div>',

    // ── ROI 投入产出分析（默认折叠） ──
    '<details class="collapsible-block"><summary>💰 投入产出分析</summary>',
    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;">',
    '<div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-primary);">💰 投入产出分析</div>',
    '<table style="width:100%;font-size:12px;border-collapse:collapse;">',
    '<tr><td style="padding:4px 0;color:var(--text-tertiary);">节省人力成本：</td>',
    '<td style="padding:4px 0;text-align:right;color:#22c55e;font-weight:500;">¥', savings.laborCostSaved.toFixed(2), '</td></tr>',
    '<tr><td style="padding:4px 0;color:var(--text-tertiary);">AI 使用成本：</td>',
    '<td style="padding:4px 0;text-align:right;color:#ef4444;font-weight:500;">¥', savings.aiCost.toFixed(2), '</td></tr>',
    '<tr style="border-top:1px solid var(--border-color);"><td style="padding:6px 0 4px;color:var(--text-primary);font-weight:500;">净节省：</td>',
    '<td style="padding:6px 0 4px;text-align:right;font-weight:600;color:', savings.netSavings >= 0 ? '#22c55e' : '#ef4444', ';">¥', savings.netSavings.toFixed(2), '</td></tr>',
    '<tr><td style="padding:4px 0;color:var(--text-tertiary);">ROI（投入产出比）：</td>',
    '<td style="padding:4px 0;text-align:right;font-weight:500;color:', savings.roi >= 1 ? '#22c55e' : '#f59e0b', ';">', savings.roi.toFixed(2), 'x</td></tr>',
    '</table></div></details>',

    // ── 行业对标（腾讯云数据，默认折叠） ──
    '<details class="collapsible-block"><summary>📊 行业对标</summary>',
    '<div style="background:var(--bg-card);padding:12px;border-radius:8px;">',
    '<div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-primary);">📊 行业对标（腾讯云公开课数据）</div>',
    '<div style="font-size:11px;color:var(--text-tertiary);line-height:1.8;">',
    '• 100张图渲染 AI算力仅 <strong>¥0.4</strong><br>',
    '• 3D Max设计 从2天 → <strong>15分钟</strong><br>',
    '• 人效比 3-5人替代传统 <strong>100-150人</strong><br>',
    '• 获客成本仅为传统模式 <strong>1/10</strong>',
    '</div></div></details>',

    // ── OPC 快捷启动按钮 ──
    '<div style="margin-bottom:16px;">',
    '<div style="font-size:13px;font-weight:500;margin-bottom:8px;color:var(--text-primary);">🚀 OPC 快捷启动</div>',
    '<div style="display:flex;flex-direction:column;gap:6px;">',
    '<button class="opc-quick-btn" data-wf="opc-new-media" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'var(--bg-card)\'">📱 新媒体获客工作流</button>',
    '<button class="opc-quick-btn" data-wf="opc-sales-report" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'var(--bg-card)\'">📊 销售数据汇总工作流</button>',
    '<button class="opc-quick-btn" data-wf="opc-competitor-monitor" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'var(--bg-card)\'">🔍 竞品自动监控工作流</button>',
    '<button class="opc-quick-btn" data-wf="opc-de-team" style="padding:10px 14px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background=\'var(--bg-hover)\'" onmouseout="this.style.background=\'var(--bg-card)\'">👥 数字员工团队协作</button>',
    // ── WorkBuddy 快捷启动 ──
    '<button class="opc-quick-btn" data-wf="workbuddy-enhanced" style="padding:10px 14px;border-radius:8px;border:1px solid #8b5cf6;background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background=\'rgba(139,92,246,0.1)\'" onmouseout="this.style.background=\'var(--bg-card)\'">🤖 WorkBuddy 增强工作流</button>',
    '<button class="opc-quick-btn" data-wf="workbuddy-batch" style="padding:10px 14px;border-radius:8px;border:1px solid #8b5cf6;background:var(--bg-card);color:var(--text-primary);cursor:pointer;font-size:13px;text-align:left;transition:all 0.15s;" onmouseover="this.style.background=\'rgba(139,92,246,0.1)\'" onmouseout="this.style.background=\'var(--bg-card)\'">📋 WorkBuddy 批量处理</button>',
    '</div></div>',

    // ── 重置按钮 ──
    '<button id="opc-reset-btn" style="padding:8px 14px;border-radius:6px;border:1px solid var(--border-color);background:transparent;color:var(--text-tertiary);cursor:pointer;font-size:11px;transition:all 0.15s;" onmouseover="this.style.color=\'var(--text-primary)\'" onmouseout="this.style.color=\'var(--text-tertiary)\'">🔄 重置统计数据</button>',
    '</div>',
  ].join('');

  // ── 绑定事件 ──

  // 快捷启动按钮：点击启动对应工作流
  panel.querySelectorAll('.opc-quick-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      const wfId = this.dataset.wf;
      // 尝试从已加载的工作流列表中查找
      const wfDef = Q.Workflows && Q.Workflows.workflows && Q.Workflows.workflows.list
        ? Q.Workflows.workflows.list.find(function(w) { return w.id === wfId; })
        : null;
      if (wfDef) {
        if (Q.Workflows.handleWorkflowClick) {
          Q.Workflows.handleWorkflowClick(wfDef);
        }
      } else {
        // 还没加载工作流列表，先 fetch 再启动
        fetch('/api/workflows')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            const def = data.workflows ? data.workflows.find(function(w) { return w.id === wfId; }) : null;
            if (def && Q.Workflows && Q.Workflows.handleWorkflowClick) {
              Q.Workflows.handleWorkflowClick(def);
            }
          })
          .catch(function(err) {
            console.warn('[OPCDashboard] Failed to fetch workflow:', err);
          });
      }
    });
  });

  // 重置按钮
  const resetBtn = panel.querySelector('#opc-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', function() {
      OPCDashboard.stats = {
        totalToolCalls: 0,
        totalTokens: 0,
        estimatedCostUSD: 0,
        humanHoursSaved: 0,
        wbCalls: 0,
        wbDuration: 0,
        wbHumanHoursSaved: 0,
      };
      updateDashboard();
    });
  }
}

/**
 * 初始化 OPC 仪表盘。
 * 注册到 UIRegistry 作为右侧栏 Tab。
 */
function init() {
  const UIR = Q.UIRegistry;
  if (UIR) {
    const registered = UIR.registerTab('opc-dashboard', {
      icon: '🏢',
      label: 'OPC效益',
      order: 4,
      category: 'digital',
      render: function(container) {
        container.innerHTML = '<div id="rp-opc-dashboard"></div>';
        updateDashboard();
      },
    });
    if (registered) {
      console.log('[OPCDashboard] Tab registered in right panel');
    }
  }

  // 暴露到 QCLI 命名空间
  Q.OPCDashboard = OPCDashboard;
  OPCDashboard.recordMetric = recordMetric;
  OPCDashboard.updateDashboard = updateDashboard;
}

// ── 自动初始化 ──
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
