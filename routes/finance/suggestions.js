// @ts-check
// ============================================================
// Finance — AI suggestion builder
//
// Pure function that derives budget/settlement insights from the
// loaded finance data. Extracted from the POST /finance/ai-suggest
// route so the heuristic logic is easy to read and test.
// ============================================================

/**
 * Build AI suggestions from budget/settlement data.
 * @param {{budgets?:Array, settlements?:Array}} data
 * @returns {Array<{type:string, severity:string, title:string, content:string}>}
 */
function buildSuggestions(data) {
  const budgets = data.budgets || [];
  const settlements = data.settlements || [];
  const suggestions = [];

  if (budgets.length === 0) {
    suggestions.push({ type: 'info', severity: 'low', title: '暂无预算数据', content: '创建第一条预算申请开始使用预算管理系统。' });
    return suggestions;
  }

  // 1. Budget usage alerts (>80% used)
  budgets.forEach(b => {
    const related = settlements.filter(s => s.budgetId === b.id);
    const used = related.reduce((sum, s) => sum + (s.amount || 0), 0);
    const rate = b.totalAmount > 0 ? (used / b.totalAmount) * 100 : 0;
    if (rate > 80) {
      suggestions.push({
        type: 'warning',
        severity: 'high',
        title: `预算超支预警: ${  b.title}`,
        content: `${b.title  } 预算已使用 ${  rate.toFixed(1)  }%，剩余 ¥${  (b.totalAmount - used).toFixed(2)  }，建议控制后续支出。`
      });
    }
  });

  // 2. Low utilization (>30 days, <20%)
  budgets.forEach(b => {
    const created = new Date(b.createdAt || Date.now());
    const days = Math.floor((Date.now() - created) / 86400000);
    const related = settlements.filter(s => s.budgetId === b.id);
    const used = related.reduce((sum, s) => sum + (s.amount || 0), 0);
    const rate = b.totalAmount > 0 ? (used / b.totalAmount) * 100 : 0;
    if (days > 30 && rate < 20 && b.status !== 'closed' && b.status !== 'rejected') {
      suggestions.push({
        type: 'optimization',
        severity: 'medium',
        title: `资金利用率低: ${  b.title}`,
        content: `${b.title  } 创建 ${  days  } 天，仅使用 ${  rate.toFixed(1)  }%，建议重审预算或调配资金到更紧急的项目。`
      });
    }
  });

  // 3. Pending settlements
  const pending = settlements.filter(s => s.status === 'pending');
  if (pending.length > 0) {
    suggestions.push({
      type: 'forecast',
      severity: 'medium',
      title: '待核销提醒',
      content: `有 ${  pending.length  } 笔销账待核销，涉及金额 ¥${  pending.reduce((s, x) => s + (x.amount || 0), 0).toFixed(2)  }，请及时处理。`
    });
  }

  // 4. Budget status summary
  const approved = budgets.filter(b => b.status === 'approved');
  const draft = budgets.filter(b => b.status === 'draft');
  const submitted = budgets.filter(b => b.status === 'submitted');
  if (submitted.length > 0) {
    suggestions.push({
      type: 'forecast',
      severity: 'low',
      title: '待审批预算',
      content: `有 ${  submitted.length  } 笔预算申请待审批（¥${  submitted.reduce((s, b) => s + (b.totalAmount || 0), 0).toFixed(2)  }），请尽快处理。`
    });
  }
  if (draft.length > 0) {
    suggestions.push({
      type: 'optimization',
      severity: 'low',
      title: '草稿预算提醒',
      content: `有 ${  draft.length  } 笔预算仍为草稿状态，建议尽快完善并提交审批。`
    });
  }
  if (approved.length > 0) {
    suggestions.push({
      type: 'optimization',
      severity: 'low',
      title: '已通过预算执行',
      content: `有 ${  approved.length  } 笔预算已通过审批（¥${  approved.reduce((s, b) => s + (b.totalAmount || 0), 0).toFixed(2)  }），请及时执行并完成销账。`
    });
  }

  // 5. Category spending pattern
  const catMap = {};
  budgets.forEach(b => {
    const cat = b.category || 'other';
    if (!catMap[cat]) catMap[cat] = { budget: 0, settled: 0 };
    catMap[cat].budget += (b.totalAmount || 0);
  });
  settlements.forEach(s => {
    const b = budgets.find(b2 => b2.id === s.budgetId);
    const cat = b ? (b.category || 'other') : 'other';
    if (!catMap[cat]) catMap[cat] = { budget: 0, settled: 0 };
    catMap[cat].settled += (s.amount || 0);
  });
  Object.keys(catMap).forEach(cat => {
    const c = catMap[cat];
    if (c.budget > 0) {
      const rate = (c.settled / c.budget) * 100;
      if (rate > 90) {
        suggestions.push({
          type: 'warning',
          severity: 'high',
          title: `${cat  } 类别预算即将用尽`,
          content: `${cat  } 类别执行率 ${  rate.toFixed(1)  }%，建议关注后续预算申请。`
        });
      }
    }
  });

  return suggestions;
}

module.exports = { buildSuggestions };
