/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Finance Module — Budget Management System
// Sub-tabs: Overview, Budgets, Settlements, AI Suggestions
// ============================================================

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

function fmt(n) {
  if (n == null || isNaN(n)) return '0.00';
  return Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
}

const STATUS_META = {
  draft:     { label: '草稿',   cls: 'finance-status-draft' },
  submitted: { label: '待审批', cls: 'finance-status-submitted' },
  approved:  { label: '已通过', cls: 'finance-status-approved' },
  rejected:  { label: '已拒绝', cls: 'finance-status-rejected' },
  closed:    { label: '已关闭', cls: 'finance-status-closed' },
};

const SETTLE_STATUS = {
  pending: { label: '待核销', cls: 'finance-status-pending' },
  partial: { label: '部分核销', cls: 'finance-status-partial' },
  settled: { label: '已核销', cls: 'finance-status-settled' },
};

const CATEGORIES = [
  { id: 'project',   label: '项目经费' },
  { id: 'office',    label: '办公行政' },
  { id: 'travel',    label: '差旅交通' },
  { id: 'equipment', label: '设备采购' },
  { id: 'other',     label: '其他' },
];

const API = '/api/finance';

function stCls(type) {
  const m = STATUS_META[type] || SETTLE_STATUS[type];
  return m ? m.cls : '';
}

function stLabel(type) {
  const m = STATUS_META[type] || SETTLE_STATUS[type];
  return m ? m.label : type;
}

function catLabel(id) {
  for (let i = 0; i < CATEGORIES.length; i++) {
    if (CATEGORIES[i].id === id) return CATEGORIES[i].label;
  }
  return id;
}

// ─── State ───
let _subTab = 'overview';
let _budgetFilter = '';
let _settleFilter = '';
let _editingBudget = null;
let _editingSettlement = null;
let _timers = [];
let _initialized = false;

function addTimer(fn, ms) {
  const id = setTimeout(fn, ms);
  _timers.push(id);
  return id;
}

function clearTimers() {
  _timers.forEach(function (t) { clearTimeout(t); });
  _timers = [];
}

// ════════════════════════════════════════════════════════════
// Init — wire into right-panel tab switch
// ════════════════════════════════════════════════════════════
function init() {
  if (_initialized) return;
  _initialized = true;

  // Inject own CSS dynamically (shared utility via Q.injectCSS)
  if (Q.injectCSS) Q.injectCSS('/css/finance.css');

  // Set up document-level event delegation (handles both panel and standalone modes)
  setupEvents();

  console.log('[Finance] Module initialized');
  console.log('[Finance] Open /budget.html for standalone page');
}

// ════════════════════════════════════════════════════════════
// Render
// ════════════════════════════════════════════════════════════
function render() {
  const panel = document.getElementById('rp-finance');
  if (!panel) return;
  clearTimers();
  panel.innerHTML = buildPanelHTML();
  setupEvents(panel);
  addTimer(function () { renderSubTab(); }, 50);
}

function buildPanelHTML() {
  const tabs = [
    { id: 'overview',    label: '总览',    icon: '📊' },
    { id: 'budgets',     label: '预算申请', icon: '📋' },
    { id: 'settlements', label: '销账记录', icon: '✅' },
    { id: 'ai',          label: 'AI 建议', icon: '💡' },
  ];
  let html = '<div class="finance-sub-tabs">';
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    html += '<button class="finance-sub-tab' + (t.id === _subTab ? ' active' : '') + '" data-sub="' + t.id + '">' + t.icon + ' ' + t.label + '</button>';
  }
  html += '</div><div class="finance-content" id="finance-content"></div>';
  return html;
}

// ════════════════════════════════════════════════════════════
// Event Delegation
// ════════════════════════════════════════════════════════════
let _eventsSetup = false;

function setupEvents(panel) {
  // Use document-level delegation so modal events (modals are appended to document.body)
  // are captured. Guard by checking target is within a finance-context element.
  if (_eventsSetup) return;
  _eventsSetup = true;

  document.addEventListener('click', function (e) {
    // Only process clicks within finance-related context
    if (!e.target.closest('#rp-finance, #standalone-content, #app.budget-container, .finance-modal-overlay, .finance-modal, .finance-content')) return;

    const subTab = e.target.closest('.finance-sub-tab');
    if (subTab) {
      _subTab = subTab.dataset.sub;
      render();
      return;
    }

    if (e.target.closest('.finance-modal-close') || (e.target.closest('.finance-modal-overlay') && !e.target.closest('.finance-modal'))) {
      closeModal();
      return;
    }

    if (e.target.closest('#finance-create-budget')) { showBudgetModal(null); return; }
    const budgetCard = e.target.closest('.finance-budget-card');
    if (budgetCard && budgetCard.dataset.id) { showBudgetDetail(budgetCard.dataset.id); return; }
    if (e.target.closest('#finance-create-settlement')) { showSettlementModal(null); return; }
    const editBtn = e.target.closest('.finance-budget-edit');
    if (editBtn) { showBudgetModal(editBtn.dataset.id); return; }
    const delBtn = e.target.closest('.finance-budget-delete');
    if (delBtn) { deleteBudget(delBtn.dataset.id); return; }
    const statusBtn = e.target.closest('.finance-budget-status');
    if (statusBtn) { changeBudgetStatus(statusBtn.dataset.id, statusBtn.dataset.status); return; }
    const editS = e.target.closest('.finance-settle-edit');
    if (editS) { showSettlementModal(editS.dataset.id); return; }
    const delS = e.target.closest('.finance-settle-delete');
    if (delS) { deleteSettlement(delS.dataset.id); return; }
    if (e.target.closest('#finance-ai-refresh')) { const c = document.getElementById('finance-content'); if (c) renderAISuggestions(c); return; }
    if (e.target.closest('#finance-submit-budget')) { submitBudgetForm(); return; }
    if (e.target.closest('#finance-add-item')) { addBudgetItemRow(); return; }
    if (e.target.closest('.fi-remove')) { const tr = e.target.closest('tr'); if (tr && tr.parentNode) tr.parentNode.removeChild(tr); updateBudgetTotal(); return; }
    if (e.target.closest('#finance-submit-settlement')) { submitSettlementForm(); return; }
    if (e.target.closest('.finance-cancel-btn')) { closeModal(); return; }
    if (e.target.closest('.finance-detail-edit')) { const editId = e.target.closest('.finance-detail-edit').dataset.id; closeModal(); setTimeout(function () { showBudgetModal(editId); }, 100); return; }
    if (e.target.closest('.finance-detail-delete')) { const delId = e.target.closest('.finance-detail-delete').dataset.id; closeModal(); setTimeout(function () { deleteBudget(delId); }, 100); return; }
  });

  document.addEventListener('input', function (e) {
    if (!e.target.closest('#rp-finance, #standalone-content, #app.budget-container, .finance-modal-overlay')) return;
    if (e.target.closest('#fb-items')) updateBudgetTotal();
  });

  document.addEventListener('change', function (e) {
    if (!e.target.closest('#rp-finance, #standalone-content, #app.budget-container')) return;
    if (e.target.id === 'finance-filter-status') {
      _budgetFilter = e.target.value;
      const c = document.getElementById('finance-content');
      if (c) renderBudgets(c);
    }
    if (e.target.id === 'finance-settle-filter') {
      _settleFilter = e.target.value;
      const c = document.getElementById('finance-content');
      if (c) renderSettlements(c);
    }
  });
}

// ════════════════════════════════════════════════════════════
// Sub-tab Router
// ════════════════════════════════════════════════════════════
function renderSubTab() {
  const el = document.getElementById('finance-content');
  if (!el) return;
  switch (_subTab) {
    case 'overview': renderOverview(el); break;
    case 'budgets': renderBudgets(el); break;
    case 'settlements': renderSettlements(el); break;
    case 'ai': renderAISuggestions(el); break;
  }
}

// ════════════════════════════════════════════════════════════
// ① Overview
// ════════════════════════════════════════════════════════════
function renderOverview(el) {
  el.innerHTML = '<div class="finance-loading">加载中...</div>';
  fetch(API + '/stats').then(function (r) { return r.json(); }).then(function (json) {
    if (!json.success) throw new Error(json.error || 'Error');
    const s = json.stats;
    const pendingCount = s.budgetStatusCount ? (s.budgetStatusCount.submitted || 0) : 0;
    const execRate = s.totalBudget > 0 ? ((s.totalSettled / s.totalBudget) * 100).toFixed(1) : '0.0';

    let catRows = '';
    if (s.categoryStats) {
      const keys = Object.keys(s.categoryStats);
      for (let i = 0; i < keys.length; i++) {
        const cat = keys[i];
        const c = s.categoryStats[cat];
        const rate = c.total > 0 ? (c.settled / c.total * 100).toFixed(1) : '0.0';
        catRows += '<tr><td>' + catLabel(cat) + '</td><td>' + c.count + '</td><td>¥' + fmt(c.total) + '</td><td>¥' + fmt(c.settled) + '</td><td>' + rate + '%</td></tr>';
      }
    }

    let statusHtml = '';
    const stKeys = Object.keys(STATUS_META);
    for (let i = 0; i < stKeys.length; i++) {
      const st = stKeys[i];
      const count = s.budgetStatusCount ? (s.budgetStatusCount[st] || 0) : 0;
      if (count > 0) statusHtml += '<span class="finance-status ' + STATUS_META[st].cls + '" style="margin:2px 4px 2px 0;">' + STATUS_META[st].label + ': ' + count + '</span>';
    }
    if (!statusHtml) statusHtml = '<span style="color:var(--text-tertiary);font-size:11px;">暂无预算</span>';

    el.innerHTML =
      '<div class="finance-metric-grid">' +
        '<div class="finance-metric"><div class="finance-metric-label">总预算</div><div class="finance-metric-value">¥' + fmt(s.totalBudget) + '</div><div class="finance-metric-sub">' + s.budgetCount + ' 个预算单</div></div>' +
        '<div class="finance-metric"><div class="finance-metric-label">已核销</div><div class="finance-metric-value">¥' + fmt(s.totalSettled) + '</div><div class="finance-metric-sub">执行率 ' + execRate + '%</div></div>' +
        '<div class="finance-metric"><div class="finance-metric-label">待审批</div><div class="finance-metric-value">' + pendingCount + '</div><div class="finance-metric-sub">预算申请</div></div>' +
        '<div class="finance-metric"><div class="finance-metric-label">待核销</div><div class="finance-metric-value">' + s.pendingSettlements + '</div><div class="finance-metric-sub">笔销账</div></div>' +
      '</div>' +
      '<details class="collapsible-block"><summary>📊 分类预算执行</summary>' +
        '<div class="finance-card"><div class="finance-card-title">分类预算执行明细</div>' +
          '<table class="finance-table"><thead><tr><th>分类</th><th>数量</th><th>预算总额</th><th>已核销</th><th>执行率</th></tr></thead>' +
          '<tbody>' + (catRows || '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--text-tertiary)">暂无数据</td></tr>') + '</tbody></table>' +
        '</div>' +
      '</details>' +
      '<div class="finance-card"><div class="finance-card-title">📋 预算状态分布</div><div style="display:flex;gap:4px;flex-wrap:wrap;">' + statusHtml + '</div></div>';
  }).catch(function (err) {
    el.innerHTML = '<div class="finance-empty"><div class="finance-empty-icon">📊</div>无法加载统计数据<br><span style="font-size:10px;color:var(--text-tertiary)">' + esc(err.message) + '</span></div>';
  });
}
// ════════════════════════════════════════════════════════════
// ② Budget List
// ════════════════════════════════════════════════════════════
function renderBudgets(el) {
  el.innerHTML = '<div class="finance-loading">加载中...</div>';
  fetch(API + '/budgets').then(function (r) { return r.json(); }).then(function (json) {
    if (!json.success) throw new Error('Error');
    const budgets = json.budgets || [];

    let statusOpts = '<option value="">全部状态</option>';
    const stKeys = Object.keys(STATUS_META);
    for (let i = 0; i < stKeys.length; i++) {
      const st = stKeys[i];
      statusOpts += '<option value="' + st + '"' + (st === _budgetFilter ? ' selected' : '') + '>' + STATUS_META[st].label + '</option>';
    }

    let filtered = budgets;
    if (_budgetFilter) filtered = budgets.filter(function (b) { return b.status === _budgetFilter; });

    const listHtml = filtered.map(function (b) {
      const m = STATUS_META[b.status] || STATUS_META.draft;
      let settled = 0;
      if (b.settlements) b.settlements.forEach(function (s) { settled += (s.amount || 0); });
      const rate = b.totalAmount > 0 ? (settled / b.totalAmount * 100) : 0;
      const barCls = rate >= 80 ? 'danger' : rate >= 50 ? 'warn' : 'good';
      return '<div class="finance-budget-card" data-id="' + b.id + '">' +
        '<div class="finance-budget-card-header">' +
          '<div><div class="finance-budget-card-title">' + esc(b.title) + '</div><div class="finance-budget-card-category">' + catLabel(b.category) + '</div></div>' +
          '<span class="finance-status ' + m.cls + '">' + m.label + '</span>' +
        '</div>' +
        '<div style="font-size:13px;font-weight:600;">¥' + fmt(b.totalAmount) + '</div>' +
        '<div class="finance-progress"><div class="finance-progress-fill ' + barCls + '" style="width:' + Math.min(rate, 100) + '%"></div></div>' +
        '<div class="finance-budget-card-footer">' +
          '<span>已用 ¥' + fmt(settled) + ' / ¥' + fmt(b.totalAmount) + ' (' + rate.toFixed(1) + '%)</span>' +
          '<span style="font-size:10px;color:var(--text-tertiary)">' + (b.createdAt || '').slice(0, 10) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div class="finance-filter-bar">' +
        '<select id="finance-filter-status">' + statusOpts + '</select>' +
        '<span style="font-size:10px;color:var(--text-tertiary)">' + filtered.length + ' / ' + budgets.length + '</span>' +
        '<div class="spacer"></div>' +
        '<button class="finance-btn" id="finance-create-budget">➕ 新建预算</button>' +
      '</div>' +
      '<div id="finance-budget-list">' + (listHtml || '<div class="finance-empty"><div class="finance-empty-icon">📋</div>暂无预算申请<br><span style="font-size:10px;color:var(--text-tertiary)">点击上方「新建预算」创建第一条</span></div>') + '</div>';
  }).catch(function (err) {
    el.innerHTML = '<div class="finance-empty"><div class="finance-empty-icon">📋</div>无法加载预算数据<br><span style="font-size:10px;color:var(--text-tertiary)">' + esc(err.message) + '</span></div>';
  });
}

// ════════════════════════════════════════════════════════════
// Budget Modal
// ════════════════════════════════════════════════════════════
function showBudgetModal(id) {
  if (id) {
    fetch(API + '/budgets/' + id).then(function (r) { return r.json(); }).then(function (json) {
      if (json.success) openBudgetForm(json.budget);
      else { if (Q.showToast) Q.showToast('加载预算失败', 'error'); }
    });
  } else {
    openBudgetForm({ id: '', title: '', category: 'project', totalAmount: 0, description: '', items: [], status: 'draft' });
  }
}

function openBudgetForm(b) {
  _editingBudget = b;
  const title = b.id ? '编辑预算申请' : '新建预算申请';
  let catOpts = '';
  for (let i = 0; i < CATEGORIES.length; i++) {
    catOpts += '<option value="' + CATEGORIES[i].id + '"' + (CATEGORIES[i].id === b.category ? ' selected' : '') + '>' + CATEGORIES[i].label + '</option>';
  }

  const items = b.items && b.items.length ? b.items : [{ description: '', amount: '', note: '' }];
  let itemsRows = '';
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    itemsRows += '<tr>' +
      '<td><input class="fi-desc" value="' + esc(item.description) + '" placeholder="项目名称" /></td>' +
      '<td><input class="fi-amt" type="number" value="' + (item.amount || '') + '" placeholder="金额" min="0" style="width:100px" /></td>' +
      '<td><input class="fi-note" value="' + esc(item.note || '') + '" placeholder="备注" /></td>' +
      '<td>' + (i > 0 ? '<button class="finance-btn small danger fi-remove" style="padding:2px 6px;font-size:10px">✕</button>' : '') + '</td>' +
    '</tr>';
  }

  const overlay = document.createElement('div');
  overlay.className = 'finance-modal-overlay';
  overlay.id = 'finance-modal';
  overlay.innerHTML =
    '<div class="finance-modal" style="max-width:520px;">' +
      '<div class="finance-modal-header"><h3>' + title + '</h3><button class="finance-modal-close">&times;</button></div>' +
      '<div class="finance-form-group"><label>标题</label><input id="fb-title" value="' + esc(b.title) + '" placeholder="预算标题（例如：2025年Q3 服务器采购）" /></div>' +
      '<div class="finance-form-group"><label>类别</label><select id="fb-category">' + catOpts + '</select></div>' +
      '<div class="finance-form-group"><label style="display:flex;justify-content:space-between;"><span>明细</span><span id="fb-total" style="color:var(--accent);font-weight:600;">¥0.00</span></label>' +
        '<table class="finance-items-table"><thead><tr><th style="width:40%">项目</th><th style="width:80px">金额</th><th>备注</th><th style="width:24px"></th></tr></thead><tbody id="fb-items">' + itemsRows + '</tbody></table>' +
        '<button class="finance-btn secondary small" id="finance-add-item" style="margin-top:4px">+ 添加明细</button>' +
      '</div>' +
      '<div class="finance-form-group"><label>说明</label><textarea id="fb-desc" rows="3" placeholder="补充说明（可选）">' + esc(b.description || '') + '</textarea></div>' +
      '<div class="finance-modal-actions">' +
        '<button class="finance-btn secondary finance-cancel-btn">取消</button>' +
        '<button class="finance-btn" id="finance-submit-budget">' + (b.id ? '保存修改' : '提交申请') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  addTimer(updateBudgetTotal, 50);
}

function updateBudgetTotal() {
  const items = document.querySelectorAll('#fb-items tr');
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += parseFloat(items[i].querySelector('.fi-amt').value) || 0;
  }
  const el = document.getElementById('fb-total');
  if (el) el.textContent = '¥' + fmt(total);
}

function addBudgetItemRow() {
  const tbody = document.getElementById('fb-items');
  if (!tbody) return;
  const tr = document.createElement('tr');
  tr.innerHTML = '<td><input class="fi-desc" placeholder="项目名称" /></td><td><input class="fi-amt" type="number" placeholder="金额" min="0" style="width:100px" /></td><td><input class="fi-note" placeholder="备注" /></td><td><button class="finance-btn small danger fi-remove" style="padding:2px 6px;font-size:10px">✕</button></td>';
  tbody.appendChild(tr);
}

function submitBudgetForm() {
  const titleEl = document.getElementById('fb-title');
  const categoryEl = document.getElementById('fb-category');
  const descEl = document.getElementById('fb-desc');
  if (!titleEl || !titleEl.value.trim()) {
    if (Q.showToast) Q.showToast('请输入预算标题', 'warning');
    return;
  }

  const items = [];
  const rows = document.querySelectorAll('#fb-items tr');
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i].querySelector('.fi-desc');
    const a = rows[i].querySelector('.fi-amt');
    const n = rows[i].querySelector('.fi-note');
    if (d && a) {
      const amt = parseFloat(a.value) || 0;
      if (d.value.trim() || amt > 0) items.push({ description: d.value.trim(), amount: amt, note: n ? n.value : '' });
    }
  }

  let total = 0;
  for (let i = 0; i < items.length; i++) total += items[i].amount;

  const b = _editingBudget || {};
  const payload = {
    title: titleEl.value.trim(),
    category: categoryEl.value,
    totalAmount: total,
    description: descEl ? descEl.value.trim() : '',
    items: items,
    status: b.id ? undefined : 'submitted',
  };

  const url = b.id ? API + '/budgets/' + b.id : API + '/budgets';
  const method = b.id ? 'PUT' : 'POST';

  fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (json.success) {
        closeModal();
        if (Q.showToast) Q.showToast(b.id ? '预算已更新 ✅' : '预算已提交 ✅', 'success');
        render();
      } else if (Q.showToast) Q.showToast('提交失败: ' + (json.error || '未知错误'), 'error');
    })
    .catch(function (err) {
      if (Q.showToast) Q.showToast('提交失败: ' + err.message, 'error');
    });
}

// ════════════════════════════════════════════════════════════
// Budget Status / Delete / Detail
// ════════════════════════════════════════════════════════════
function changeBudgetStatus(id, newStatus) {
  fetch(API + '/budgets/' + id + '/status', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus })
  }).then(function (r) { return r.json(); }).then(function (json) {
    if (json.success) {
      if (Q.showToast) Q.showToast('状态已更新 ✅', 'success');
      render();
    } else if (Q.showToast) {
      Q.showToast('操作失败: ' + (json.error || '未知错误'), 'error');
    }
  }).catch(function (err) {
    if (Q.showToast) Q.showToast('请求失败: ' + err.message, 'error');
  });
}

function deleteBudget(id) {
  if (!confirm('确定删除此预算申请？此操作不可撤销。')) return;
  fetch(API + '/budgets/' + id, { method: 'DELETE' }).then(function (r) { return r.json(); }).then(function (json) {
    if (json.success) {
      if (Q.showToast) Q.showToast('已删除 ✅', 'success');
      render();
    } else if (Q.showToast) {
      Q.showToast('删除失败: ' + (json.error || '未知错误'), 'error');
    }
  }).catch(function (err) {
    if (Q.showToast) Q.showToast('请求失败: ' + err.message, 'error');
  });
}

function showBudgetDetail(id) {
  fetch(API + '/budgets/' + id).then(function (r) { return r.json(); }).then(function (json) {
    if (!json.success) return;
    const b = json.budget;
    const m = STATUS_META[b.status] || STATUS_META.draft;

    let itemsRows = '';
    const items = b.items || [];
    for (let i = 0; i < items.length; i++) {
      itemsRows += '<tr><td>' + esc(items[i].description) + '</td><td style="text-align:right">¥' + fmt(items[i].amount) + '</td><td>' + esc(items[i].note || '-') + '</td></tr>';
    }
    if (!itemsRows) itemsRows = '<tr><td colspan="3" style="text-align:center;color:var(--text-tertiary)">无明细</td></tr>';

    fetch(API + '/settlements?budgetId=' + id).then(function (r2) { return r2.json(); }).then(function (sjson) {
      const settles = sjson.success ? (sjson.settlements || []) : [];
      let settleRows = '';
      for (let i = 0; i < settles.length; i++) {
        const s = settles[i];
        settleRows += '<tr><td>' + (s.settlementDate || s.createdAt || '').slice(0, 10) + '</td><td style="text-align:right">¥' + fmt(s.amount) + '</td><td>' + esc(s.payee || '-') + '</td><td><span class="finance-status ' + stCls(s.status) + '">' + stLabel(s.status) + '</span></td></tr>';
      }
      if (!settleRows) settleRows = '<tr><td colspan="4" style="text-align:center;color:var(--text-tertiary)">暂无销账记录</td></tr>';

      const overlay = document.createElement('div');
      overlay.className = 'finance-modal-overlay';
      overlay.id = 'finance-modal';
      overlay.innerHTML =
        '<div class="finance-modal" style="max-width:600px;">' +
          '<div class="finance-modal-header"><h3>' + esc(b.title) + '</h3><button class="finance-modal-close">&times;</button></div>' +
          '<div class="finance-detail-row"><span class="finance-detail-label">类别</span><span class="finance-detail-value">' + catLabel(b.category) + '</span></div>' +
          '<div class="finance-detail-row"><span class="finance-detail-label">状态</span><span class="finance-detail-value"><span class="finance-status ' + m.cls + '">' + m.label + '</span></span></div>' +
          '<div class="finance-detail-row"><span class="finance-detail-label">总金额</span><span class="finance-detail-value" style="font-size:14px;font-weight:700;">¥' + fmt(b.totalAmount) + '</span></div>' +
          '<div style="margin:12px 0 4px;font-size:12px;font-weight:600;color:var(--text-secondary)">📋 预算明细</div>' +
          '<table class="finance-table"><thead><tr><th>项目</th><th style="text-align:right">金额</th><th>备注</th></tr></thead><tbody>' + itemsRows + '</tbody></table>' +
          (b.description ? '<div style="margin:6px 0;font-size:11px;color:var(--text-tertiary);padding:6px;background:var(--bg-elevated);border-radius:4px;">' + esc(b.description) + '</div>' : '') +
          '<div style="margin:12px 0 4px;font-size:12px;font-weight:600;color:var(--text-secondary)">✅ 销账记录</div>' +
          '<table class="finance-table"><thead><tr><th>日期</th><th style="text-align:right">金额</th><th>收款方</th><th>状态</th></tr></thead><tbody>' + settleRows + '</tbody></table>' +
          '<div class="finance-modal-actions">' +
            (b.status === 'submitted' ? '<button class="finance-btn secondary small finance-budget-status" data-id="' + b.id + '" data-status="approved">通过 ✅</button><button class="finance-btn danger small finance-budget-status" data-id="' + b.id + '" data-status="rejected">拒绝 ❌</button>' : '') +
            (b.status === 'approved' ? '<button class="finance-btn danger small finance-budget-status" data-id="' + b.id + '" data-status="closed">关闭 🔒</button>' : '') +
            '<button class="finance-btn secondary small finance-detail-edit" data-id="' + b.id + '">编辑 ✏️</button>' +
            (b.status === 'draft' || b.status === 'submitted' ? '<button class="finance-btn danger small finance-detail-delete" data-id="' + b.id + '">删除 🗑</button>' : '') +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
    }).catch(function (err) {
      console.error('[Finance] budget detail error:', err);
    });
  }).catch(function (err) {
    console.error('[Finance] budget detail error:', err);
  });
}

// ════════════════════════════════════════════════════════════
// ③ Settlements
// ════════════════════════════════════════════════════════════
function renderSettlements(el) {
  el.innerHTML = '<div class="finance-loading">加载中...</div>';
  Promise.all([
    fetch(API + '/settlements').then(function (r) { return r.json(); }),
    fetch(API + '/budgets').then(function (r) { return r.json(); })
  ]).then(function (results) {
    const sjson = results[0], bjson = results[1];
    if (!sjson.success) throw new Error('Error');
    const settlements = sjson.settlements || [];
    const budgetsMap = {};
    const bArr = bjson.budgets || [];
    for (let i = 0; i < bArr.length; i++) budgetsMap[bArr[i].id] = bArr[i];

    let statusOpts = '<option value="">全部状态</option>';
    const stKeys = Object.keys(SETTLE_STATUS);
    for (let i = 0; i < stKeys.length; i++) {
      statusOpts += '<option value="' + stKeys[i] + '"' + (stKeys[i] === _settleFilter ? ' selected' : '') + '>' + SETTLE_STATUS[stKeys[i]].label + '</option>';
    }

    const filtered = _settleFilter ? settlements.filter(function (s) { return s.status === _settleFilter; }) : settlements;

    const listHtml = filtered.map(function (s) {
      const b = budgetsMap[s.budgetId];
      return '<div class="finance-settle-card" style="margin-bottom:6px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
          '<div><span style="font-size:13px;font-weight:600;">¥' + fmt(s.amount) + '</span><span style="font-size:10px;color:var(--text-tertiary);margin-left:8px;">' + (s.settlementDate || s.createdAt || '').slice(0, 10) + '</span></div>' +
          '<span class="finance-status ' + stCls(s.status) + '">' + stLabel(s.status) + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">📎 ' + (b ? esc(b.title) : '(已删除的预算)') + (s.payee ? ' · 收款: ' + esc(s.payee) : '') + (s.receipt ? ' · 收据: ' + esc(s.receipt) : '') + '</div>' +
        '<div style="margin-top:6px;display:flex;gap:6px;">' +
          '<button class="finance-btn small secondary finance-settle-edit" data-id="' + s.id + '">编辑</button>' +
          '<button class="finance-btn small danger finance-settle-delete" data-id="' + s.id + '">删除</button>' +
        '</div>' +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div class="finance-filter-bar">' +
        '<select id="finance-settle-filter">' + statusOpts + '</select>' +
        '<span style="font-size:10px;color:var(--text-tertiary)">' + filtered.length + ' / ' + settlements.length + '</span>' +
        '<div class="spacer"></div>' +
        '<button class="finance-btn" id="finance-create-settlement">➕ 新增销账</button>' +
      '</div>' +
      '<div id="finance-settle-list">' + (listHtml || '<div class="finance-empty"><div class="finance-empty-icon">✅</div>暂无销账记录</div>') + '</div>';
  }).catch(function (err) {
    el.innerHTML = '<div class="finance-empty"><div class="finance-empty-icon">✅</div>无法加载销账数据<br><span style="font-size:10px;color:var(--text-tertiary)">' + esc(err.message) + '</span></div>';
  });
}

// ════════════════════════════════════════════════════════════
// Settlement Modal
// ════════════════════════════════════════════════════════════
function showSettlementModal(id) {
  fetch(API + '/budgets').then(function (r) { return r.json(); }).then(function (bjson) {
    const budgets = (bjson.budgets || []).filter(function (b) {
      return b.status === 'approved' || b.status === 'draft';
    });
    if (id) {
      fetch(API + '/settlements').then(function (r) { return r.json(); }).then(function (sjson) {
        let found = null;
        const all = sjson.settlements || [];
        for (let i = 0; i < all.length; i++) { if (all[i].id === id) { found = all[i]; break; } }
        if (found) openSettleForm(found, budgets);
        else { if (Q.showToast) Q.showToast('销账记录不存在', 'error'); }
      }).catch(function (err) {
        console.error('[Finance] settlement fetch error:', err);
      });
    } else {
      openSettleForm({
        id: '', budgetId: '', amount: 0,
        settlementDate: new Date().toISOString().slice(0, 10),
        payee: '', receipt: '', note: '', status: 'pending'
      }, budgets);
    }
  }).catch(function (err) {
    console.error('[Finance] budget fetch error:', err);
  });
}

function openSettleForm(s, budgets) {
  _editingSettlement = s;
  let bOpts = '<option value="">-- 选择关联预算 --</option>';
  for (let i = 0; i < budgets.length; i++) {
    bOpts += '<option value="' + budgets[i].id + '"' + (budgets[i].id === s.budgetId ? ' selected' : '') + '>' + esc(budgets[i].title) + ' (¥' + fmt(budgets[i].totalAmount) + ')' + '</option>';
  }

  let statusOpts = '';
  const stKeys = Object.keys(SETTLE_STATUS);
  for (let i = 0; i < stKeys.length; i++) {
    statusOpts += '<option value="' + stKeys[i] + '"' + (stKeys[i] === s.status ? ' selected' : '') + '>' + SETTLE_STATUS[stKeys[i]].label + '</option>';
  }

  const overlay = document.createElement('div');
  overlay.className = 'finance-modal-overlay';
  overlay.id = 'finance-modal';
  overlay.innerHTML =
    '<div class="finance-modal">' +
      '<div class="finance-modal-header"><h3>' + (s.id ? '编辑销账' : '新增销账') + '</h3><button class="finance-modal-close">&times;</button></div>' +
      '<div class="finance-form-group"><label>关联预算</label><select id="fs-budget">' + bOpts + '</select></div>' +
      '<div class="finance-form-row">' +
        '<div class="finance-form-group"><label>金额 (¥)</label><input id="fs-amount" type="number" value="' + (s.amount || '') + '" min="0" step="0.01" placeholder="0.00" /></div>' +
        '<div class="finance-form-group"><label>销账日期</label><input id="fs-date" type="date" value="' + (s.settlementDate || new Date().toISOString().slice(0, 10)) + '" /></div>' +
      '</div>' +
      '<div class="finance-form-row">' +
        '<div class="finance-form-group"><label>收款方</label><input id="fs-payee" value="' + esc(s.payee || '') + '" placeholder="例如：阿里云" /></div>' +
        '<div class="finance-form-group"><label>收据编号</label><input id="fs-receipt" value="' + esc(s.receipt || '') + '" placeholder="INV-xxxx" /></div>' +
      '</div>' +
      '<div class="finance-form-group"><label>状态</label><select id="fs-status">' + statusOpts + '</select></div>' +
      '<div class="finance-form-group"><label>备注</label><textarea id="fs-note" rows="2" placeholder="可选备注信息">' + esc(s.note || '') + '</textarea></div>' +
      '<div class="finance-modal-actions">' +
        '<button class="finance-btn secondary finance-cancel-btn">取消</button>' +
        '<button class="finance-btn" id="finance-submit-settlement">' + (s.id ? '保存' : '添加') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
}

function submitSettlementForm() {
  const budgetEl = document.getElementById('fs-budget');
  const amountEl = document.getElementById('fs-amount');
  const dateEl = document.getElementById('fs-date');
  const payeeEl = document.getElementById('fs-payee');
  const receiptEl = document.getElementById('fs-receipt');
  const statusEl = document.getElementById('fs-status');
  const noteEl = document.getElementById('fs-note');

  if (!budgetEl || !budgetEl.value) { if (Q.showToast) Q.showToast('请选择关联预算', 'warning'); return; }
  if (!amountEl || !amountEl.value || parseFloat(amountEl.value) <= 0) { if (Q.showToast) Q.showToast('请输入有效金额', 'warning'); return; }

  const s = _editingSettlement || {};
  const payload = {
    budgetId: budgetEl.value,
    amount: parseFloat(amountEl.value),
    settlementDate: dateEl ? dateEl.value : new Date().toISOString().slice(0, 10),
    payee: payeeEl ? payeeEl.value : '',
    receipt: receiptEl ? receiptEl.value : '',
    status: statusEl ? statusEl.value : 'pending',
    note: noteEl ? noteEl.value : '',
  };

  const url = s.id ? API + '/settlements/' + s.id : API + '/settlements';
  const method = s.id ? 'PUT' : 'POST';

  fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function (r) { return r.json(); })
    .then(function (json) {
      if (json.success) {
        closeModal();
        if (Q.showToast) Q.showToast('销账记录已保存 ✅', 'success');
        render();
      } else if (Q.showToast) Q.showToast('保存失败', 'error');
    })
    .catch(function (err) {
      if (Q.showToast) Q.showToast('保存失败: ' + err.message, 'error');
    });
}

function deleteSettlement(id) {
  if (!confirm('确定删除此销账记录？')) return;
  fetch(API + '/settlements/' + id, { method: 'DELETE' }).then(function (r) { return r.json(); }).then(function (json) {
    if (json.success) {
      if (Q.showToast) Q.showToast('已删除 ✅', 'success');
      render();
    } else if (Q.showToast) {
      Q.showToast('删除失败: ' + (json.error || '未知错误'), 'error');
    }
  }).catch(function (err) {
    if (Q.showToast) Q.showToast('请求失败: ' + err.message, 'error');
  });
}

// ════════════════════════════════════════════════════════════
// ④ AI Suggestions
// ════════════════════════════════════════════════════════════
function renderAISuggestions(el) {
  el.innerHTML = '<div class="finance-loading">AI 分析中...</div>';
  fetch(API + '/ai-suggest', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (json) {
    if (!json.success) throw new Error('AI failed');
    const suggestions = json.suggestions || [];

    let cards = '';
    for (let i = 0; i < suggestions.length; i++) {
      const sg = suggestions[i];
      const icon = sg.type === 'warning' ? '⚠️' : sg.type === 'optimization' ? '💡' : sg.type === 'forecast' ? '📊' : '🤖';
      const severityCls = sg.severity === 'high' ? 'rejected' : sg.severity === 'medium' ? 'submitted' : 'draft';
      cards += '<div class="finance-suggestion-card ' + (sg.severity || 'low') + '" style="margin-bottom:6px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
          '<div style="font-size:12px;font-weight:600;">' + icon + ' ' + esc(sg.title) + '</div>' +
          '<span class="finance-status finance-status-' + severityCls + '" style="font-size:9px;">' + (sg.severity || 'info') + '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">' + esc(sg.content) + '</div>' +
      '</div>';
    }
    if (!cards) cards = '<div class="finance-empty"><div class="finance-empty-icon">💡</div>暂无建议</div>';

    el.innerHTML =
      '<div class="finance-filter-bar"><span style="font-size:11px;color:var(--text-tertiary);">基于预算和销账数据的规则分析</span><div class="spacer"></div><button class="finance-btn secondary small" id="finance-ai-refresh">🔄 刷新</button></div>' +
      cards +
      '<div style="margin-top:10px;padding:10px;background:var(--bg-elevated);border:1px solid var(--border-color);border-radius:8px;font-size:10px;color:var(--text-tertiary);line-height:1.6;">' +
        '🤖 AI 建议基于本地规则引擎运行：<br>' +
        '• 预算使用率 ≥80% → ⚠️ 超支预警<br>' +
        '• 创建超30天且使用率 <20% → 💡 资金调配建议<br>' +
        '• 有待核销记录 → 🔮 提醒核销<br>' +
        '• 待审批预算 → 📊 审批提醒<br>' +
        '所有数据在本地处理，无需联网。' +
      '</div>';
  }).catch(function () {
    el.innerHTML = '<div class="finance-empty"><div class="finance-empty-icon">💡</div>AI 分析暂时不可用</div>';
  });
}

// ════════════════════════════════════════════════════════════
// Modal Helper
// ════════════════════════════════════════════════════════════
function closeModal() {
  const overlay = document.getElementById('finance-modal');
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  _editingBudget = null;
  _editingSettlement = null;
}

// ════════════════════════════════════════════════════════════
// Public API
// ════════════════════════════════════════════════════════════
Q.Finance = {
  init: init,
  cleanup: function () { clearTimers(); },
  render: render,
  renderOverview: renderOverview,
  renderBudgets: renderBudgets,
  renderSettlements: renderSettlements,
  renderAISuggestions: renderAISuggestions,
  _initialized: false,
};

// ════════════════════════════════════════════════════════════
// Auto-init removed — standalone page (/budget.html) calls init()+render() explicitly
// ════════════════════════════════════════════════════════════
console.log('[Finance] Module loaded (waiting for standalone page to call init())');
