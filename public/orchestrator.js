/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Orchestrator — WorkBuddy 风格的多 Agent 编排看板 (前端)
//
// 复刻 WorkBuddy 的编排能力，给 Hesi 一个真实可交互的入口：
//   - 任务 DAG 看板（状态列 + 卡片：pending/blocked/running/
//     waiting_human/completed/failed/skipped）
//   - 运行 DAG 工作流（workflow:run）
//   - 自定义编排（在界面里手写 DAG 并运行）
//   - 运行中动态添加任务（workflow:addTask —— planner 模式）
//   - 取消运行（workflow:cancel）
//   - 人机协作：等待人工时卡片内联回复框（human:respond）
//   - Agent 消息传递：向运行中的 Agent 发消息（agent:msg）
//
// 后端引擎见 ws/orchestrator.js，会并发出 task:* 与兼容的
// workflow:* 事件流。本模块以 task:* 为准渲染看板。
//
// 消息发送统一走 Q.wsSend（与全局 WebSocket 一致）。
// ============================================================
'use strict';

import { escapeHtml } from './escape.js';

/** @typedef {import('./types').QCLI} QCLI */
/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const STATUS_ORDER = ['pending', 'blocked', 'running', 'waiting_human', 'completed', 'failed', 'skipped'];
const STATUS_META = {
  pending:       { label: '待运行', color: 'var(--text-tertiary)', icon: '○' },
  blocked:       { label: '阻塞',   color: 'var(--accent-purple)', icon: '⛔' },
  running:       { label: '运行中', color: 'var(--info)',    icon: '⟳' },
  completed:     { label: '完成',   color: 'var(--success)', icon: '✅' },
  failed:        { label: '失败',   color: 'var(--danger)',  icon: '❌' },
  skipped:       { label: '跳过',   color: 'var(--text-tertiary)', icon: '⏭' },
  waiting_human: { label: '待人工', color: 'var(--warning)', icon: '🙋' },
};

const Orchestrator = {
  workflows: [],      // 可用 DAG 工作流定义（来自 /api/workflows，含 tasks）
  activeRun: null,    // { wfId, name, tasks: Map, order: [], ended, outcome }
  panel: null,        // 当前渲染的面板容器
  filter: null,       // 状态过滤（点击状态条）
};

// ── DOM helpers ──
function el(id) { return document.getElementById(id); }
function send(msg) {
  if (Q.wsSend) Q.wsSend(msg);
}

// ── Expert team roles (专家团) ──
// 角色定义来自后端的数字员工系统（ws/digital-employee.js ROLE_CONFIG），
// 通过 /api/digital-employees/roles 暴露。每个任务可选一个角色，
// 运行时后端会把该角色的人设（persona）前置进 prompt，使编排成为一支有身份的专家团。
let _rolesCache = null;
let _rolesMap = null;
async function fetchRoles() {
  if (_rolesCache) return _rolesCache;
  try {
    const resp = await fetch('/api/digital-employees/roles');
    if (resp.ok) {
      const data = await resp.json();
      _rolesCache = Array.isArray(data.roles) ? data.roles : [];
      _rolesMap = new Map(_rolesCache.map((r) => [r.role, r]));
    }
  } catch (e) { /* 离线时角色下拉仅显示「无角色」，不影响编排 */ }
  return _rolesCache || [];
}
function roleMeta(roleId) {
  return (_rolesMap && _rolesMap.get(roleId)) || null;
}
function roleOptionsHtml() {
  const opts = ['<option value="">（无角色）</option>'];
  for (const r of (_rolesCache || [])) {
    opts.push(`<option value="${escapeHtml(r.role)}">${escapeHtml(r.icon || '')} ${escapeHtml(r.name || r.role)}</option>`);
  }
  return opts.join('');
}
function populateRoleSelect(sel, selectedRole) {
  if (!sel) return;
  sel.innerHTML = roleOptionsHtml();
  if (selectedRole) sel.value = selectedRole;
}

// ── Skills (技能库) ──
// 技能来自 Hesi 原生技能库（后端 skills/registry，摄入自 WorkBuddy 连接器缓存
// 与内置技能）。每个任务可选一个技能，运行时后端把该技能正文前置进 prompt，
// 作为该任务的可执行工作流指引（与「专家团角色」互补：角色是「是谁」，技能是「怎么做」）。
let _skillsCache = null;
let _skillsMap = null;
async function fetchSkills() {
  if (_skillsCache) return _skillsCache;
  try {
    const resp = await fetch('/api/skills');
    if (resp.ok) {
      const data = await resp.json();
      _skillsCache = Array.isArray(data.skills) ? data.skills : [];
      _skillsMap = new Map(_skillsCache.map((s) => [s.id, s]));
    }
  } catch (e) { /* 离线时技能下拉仅显示「无技能」，不影响编排 */ }
  return _skillsCache || [];
}
function skillMeta(id) {
  return (_skillsMap && _skillsMap.get(id)) || null;
}
function skillOptionsHtml() {
  const opts = ['<option value="">（无技能）</option>'];
  for (const s of (_skillsCache || [])) {
    opts.push(`<option value="${escapeHtml(s.id)}">🛠 ${escapeHtml(s.name || s.id)}</option>`);
  }
  return opts.join('');
}
function populateSkillSelect(sel, selectedId) {
  if (!sel) return;
  sel.innerHTML = skillOptionsHtml();
  if (selectedId) sel.value = selectedId;
}

// ── Experts (专家库) ──
// 专家来自 Hesi 原生专家库（后端 ws/experts，种子来自数字员工 ROLE_CONFIG）。
// 每个任务可选一个专家，运行时后端把该专家的人设前置进 prompt（优先级高于 role），
// 并附上其声明的可用技能 / 可接入连接器边界。专家是命名、可复用的「角色包」。
let _expertsCache = null;
let _expertsMap = null;
async function fetchExperts() {
  if (_expertsCache) return _expertsCache;
  try {
    const resp = await fetch('/api/experts');
    if (resp.ok) {
      const data = await resp.json();
      _expertsCache = Array.isArray(data.experts) ? data.experts : [];
      _expertsMap = new Map(_expertsCache.map((e) => [e.id, e]));
    }
  } catch (e) { /* 离线时专家下拉仅显示「无专家」，不影响编排 */ }
  return _expertsCache || [];
}
function expertMeta(id) {
  return (_expertsMap && _expertsMap.get(id)) || null;
}
function expertOptionsHtml() {
  const opts = ['<option value="">（无专家）</option>'];
  for (const e of (_expertsCache || [])) {
    opts.push(`<option value="${escapeHtml(e.id)}">${escapeHtml(e.icon || '🧑‍💼')} ${escapeHtml(e.name || e.id)}</option>`);
  }
  return opts.join('');
}
function populateExpertSelect(sel, selectedId) {
  if (!sel) return;
  sel.innerHTML = expertOptionsHtml();
  if (selectedId) sel.value = selectedId;
}

// ── Run state helpers ──
function ensureRun(workflowId, name) {
  if (!Orchestrator.activeRun || Orchestrator.activeRun.wfId !== workflowId) {
    Orchestrator.activeRun = { wfId: workflowId, name: name || '', tasks: new Map(), order: [], ended: false, outcome: null };
  }
  if (name && !Orchestrator.activeRun.name) Orchestrator.activeRun.name = name;
  return Orchestrator.activeRun;
}

// ── Load DAG workflows from API ──
async function loadWorkflows() {
  try {
    const resp = await fetch('/api/workflows');
    if (!resp.ok) return;
    const data = await resp.json();
    const all = data.workflows || [];
    Orchestrator.workflows = all.filter((wf) => wf.tasks && Array.isArray(wf.tasks) && wf.tasks.length > 0);
    renderPicker();
  } catch (err) {
    console.warn('[Orchestrator] Load workflows failed:', err);
  }
}

// ── Variable substitution ({{ key }} / {{key}}) ──
function substituteVars(task, values) {
  let out = task;
  for (const [k, v] of Object.entries(values || {})) {
    out = out.replace(new RegExp('\\{\\{\\s*' + k + '\\s*\\}\\}', 'gi'), v);
  }
  return out;
}

// ── Run a DAG workflow definition ──
function runDAG(wfDef) {
  if (Orchestrator.activeRun && !Orchestrator.activeRun.ended) {
    Q.showToast?.('⚠️ 已有运行中的编排，请先取消', 'error');
    return;
  }
  const vars = wfDef.variables || {};
  const varKeys = Object.keys(vars);
  if (varKeys.length > 0) {
    showVarModal(wfDef);
    return;
  }
  dispatchRun(wfDef, {});
}

function dispatchRun(wfDef, values) {
  const tasks = (wfDef.tasks || []).map((t) => {
    const copy = Object.assign({}, t);
    if (copy.task) copy.task = substituteVars(copy.task, values);
    if (copy.agents) copy.agents = copy.agents.map((a) => Object.assign({}, a, { task: a.task ? substituteVars(a.task, values) : a.task }));
    return copy;
  });
  send({
    type: 'workflow:run',
    name: wfDef.name,
    tasks,
    maxConcurrency: wfDef.maxConcurrency || 4,
    variables: values,
  });
  Q.showToast?.('🚀 已启动编排：' + (wfDef.name || 'DAG'), 'info');
  // 切换到看板视图（隐藏 picker 头部的运行态由 renderBoard 体现）
  if (Orchestrator.panel) {
    const runSec = el('orch-run');
    if (runSec) runSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Variable input modal (for DAG workflows with variables) ──
function showVarModal(wfDef) {
  const vars = wfDef.variables || {};
  const keys = Object.keys(vars);
  let formHtml = '';
  for (const key of keys) {
    const v = vars[key];
    const label = v.label || key;
    const val = v.default || '';
    const req = v.required ? 'required' : '';
    if (v.type === 'select' && v.options) {
      formHtml += `<label>${escapeHtml(label)}<select id="orch-var-${key}" class="orch-input" ${req}>`;
      for (const opt of v.options) formHtml += `<option value="${escapeHtml(opt)}"${opt === val ? ' selected' : ''}>${escapeHtml(opt)}</option>`;
      formHtml += '</select></label>';
    } else if (v.type === 'number') {
      formHtml += `<label>${escapeHtml(label)}<input type="number" id="orch-var-${key}" class="orch-input" value="${escapeHtml(val)}" ${req}></label>`;
    } else {
      formHtml += `<label>${escapeHtml(label)}<input type="text" id="orch-var-${key}" class="orch-input" value="${escapeHtml(val)}" placeholder="${escapeHtml(v.placeholder || '')}" ${req}></label>`;
    }
  }
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.id = 'orch-var-modal';
  overlay.innerHTML = `
    <div class="modal orch-modal">
      <h2>🤖 ${escapeHtml(wfDef.name || '编排')}</h2>
      <div class="orch-var-form">${formHtml}</div>
      <div class="modal-actions">
        <button id="orch-var-cancel" class="secondary-btn">取消</button>
        <button id="orch-var-start" class="primary-btn">▶ 启动</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.remove('hidden'));

  function close() { overlay.classList.add('hidden'); setTimeout(() => overlay.remove(), 250); }
  overlay.querySelector('#orch-var-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#orch-var-start').addEventListener('click', () => {
    const values = {};
    let err = false;
    for (const key of keys) {
      const input = el('orch-var-' + key);
      const val = input ? input.value.trim() : '';
      if (vars[key].required && !val) { err = true; input?.focus(); Q.showToast?.('请填写：' + (vars[key].label || key), 'error'); break; }
      values[key] = val || vars[key].default || '';
    }
    if (err) return;
    close();
    dispatchRun(wfDef, values);
  });
}

// ── Custom orchestration composer ──
function showComposer() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.id = 'orch-composer-modal';
  overlay.innerHTML = `
    <div class="modal orch-modal orch-composer">
      <h2>🛠 自定义编排（DAG）</h2>
      <div class="orch-form-row">
        <label>名称<input type="text" id="orch-c-name" class="orch-input" placeholder="我的编排" value="自定义编排"></label>
        <label>并发上限<input type="number" id="orch-c-conc" class="orch-input" value="4" min="1" max="16"></label>
      </div>
      <div class="orch-task-list" id="orch-c-tasks"></div>
      <button id="orch-c-addtask" class="secondary-btn">＋ 添加任务</button>
      <div class="modal-actions">
        <button id="orch-c-preview" class="secondary-btn">🕸 预览图</button>
        <button id="orch-c-export" class="secondary-btn">💾 导出</button>
        <button id="orch-c-cancel" class="secondary-btn">取消</button>
        <button id="orch-c-run" class="primary-btn">🚀 运行</button>
      </div>
      <div id="orch-c-error" class="form-error hidden"></div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.remove('hidden'));

  const listEl = overlay.querySelector('#orch-c-tasks');
  function addTaskRow(data) {
    const row = document.createElement('div');
    row.className = 'orch-task-row';
    row.innerHTML = `
      <div class="orch-task-row-head">
        <input class="orch-input orch-t-id" placeholder="id (如 t1)" value="${escapeHtml(data?.id || '')}">
        <input class="orch-input orch-t-label" placeholder="标签" value="${escapeHtml(data?.label || '')}">
        <input class="orch-input orch-t-agent" placeholder="agentId (opencode)" value="${escapeHtml(data?.agentId || 'opencode')}">
        <input class="orch-input orch-t-deps" placeholder="依赖(逗号分隔 id)" value="${escapeHtml((data?.dependsOn || []).join(','))}">
        <button class="orch-t-del" title="删除">✕</button>
      </div>
      <select class="orch-input orch-t-role" title="专家团角色（可选）">${roleOptionsHtml()}</select>
      <select class="orch-input orch-t-skill" title="技能（可选，摄入自技能库）">${skillOptionsHtml()}</select>
      <select class="orch-input orch-t-expert" title="专家（可选，摄入自专家库）">${expertOptionsHtml()}</select>
      <textarea class="orch-input orch-t-task" rows="2" placeholder="任务指令 (prompt) —— 运行/导出时使用">${escapeHtml(data?.task || '')}</textarea>`;
    row.querySelector('.orch-t-del').addEventListener('click', () => row.remove());
    populateRoleSelect(row.querySelector('.orch-t-role'), data?.role || '');
    populateSkillSelect(row.querySelector('.orch-t-skill'), data?.skillId || '');
    populateExpertSelect(row.querySelector('.orch-t-expert'), data?.expertId || '');
    listEl.appendChild(row);
  }
  addTaskRow({ id: 't1', label: '收集信息', agentId: 'opencode', task: '' });
  addTaskRow({ id: 't2', label: '分析', agentId: 'opencode', dependsOn: ['t1'], task: '' });
  // 若角色/技能/专家尚未加载，加载后回填下拉并保留当前选择
  if (!_rolesCache || !_skillsCache || !_expertsCache) {
    Promise.all([fetchRoles(), fetchSkills(), fetchExperts()]).then(() => {
      listEl.querySelectorAll('.orch-t-role').forEach((s) => populateRoleSelect(s, s.value));
      listEl.querySelectorAll('.orch-t-skill').forEach((s) => populateSkillSelect(s, s.value));
      listEl.querySelectorAll('.orch-t-expert').forEach((s) => populateExpertSelect(s, s.value));
    });
  }

  function collectTasks() {
    const rows = listEl.querySelectorAll('.orch-task-row');
    const tasks = [];
    const ids = new Set();
    let errMsg = '';
    rows.forEach((r) => {
      const id = r.querySelector('.orch-t-id').value.trim();
      const label = r.querySelector('.orch-t-label').value.trim();
      const agentId = r.querySelector('.orch-t-agent').value.trim() || 'opencode';
      const deps = r.querySelector('.orch-t-deps').value.split(',').map((s) => s.trim()).filter(Boolean);
      const task = r.querySelector('.orch-t-task').value;
      const role = r.querySelector('.orch-t-role').value.trim();
      const skill = r.querySelector('.orch-t-skill').value.trim();
      const expert = r.querySelector('.orch-t-expert').value.trim();
      const meta = role ? roleMeta(role) : null;
      if (!id) { errMsg = '每个任务都需要 id'; return; }
      if (ids.has(id)) { errMsg = '任务 id 重复：' + id; return; }
      ids.add(id);
      tasks.push({
        id, label: label || id, agentId, dependsOn: deps, task, mode: 'serial',
        role: role || undefined,
        roleName: meta ? meta.name : undefined,
        persona: meta ? meta.persona : undefined,
        skillId: skill || undefined,
        expertId: expert || undefined,
      });
    });
    return { tasks, errMsg };
  }
  function showErr(msg) {
    const errEl = overlay.querySelector('#orch-c-error');
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }

  overlay.querySelector('#orch-c-addtask').addEventListener('click', () => addTaskRow({}));
  overlay.querySelector('#orch-c-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#orch-c-preview').addEventListener('click', () => {
    const { tasks, errMsg } = collectTasks();
    if (errMsg) { showErr(errMsg); return; }
    if (tasks.length === 0) { showErr('请至少添加一个任务'); return; }
    showDAGModal('依赖图预览 · ' + (overlay.querySelector('#orch-c-name').value.trim() || '自定义编排'), tasks);
  });
  overlay.querySelector('#orch-c-export').addEventListener('click', () => {
    const name = overlay.querySelector('#orch-c-name').value.trim() || '自定义编排';
    const conc = parseInt(overlay.querySelector('#orch-c-conc').value, 10) || 4;
    const { tasks, errMsg } = collectTasks();
    if (errMsg) { showErr(errMsg); return; }
    if (tasks.length === 0) { showErr('请至少添加一个任务'); return; }
    exportWorkflow({ name, maxConcurrency: conc, tasks });
  });
  overlay.querySelector('#orch-c-run').addEventListener('click', () => {
    const name = overlay.querySelector('#orch-c-name').value.trim() || '自定义编排';
    const conc = parseInt(overlay.querySelector('#orch-c-conc').value, 10) || 4;
    const { tasks, errMsg } = collectTasks();
    if (errMsg) { showErr(errMsg); return; }
    if (tasks.length === 0) { showErr('请至少添加一个任务'); return; }
    close();
    dispatchRun({ name, maxConcurrency: conc, tasks }, {});
  });

  function close() { overlay.classList.add('hidden'); setTimeout(() => overlay.remove(), 250); }
}

// ── Dynamic add task (planner pattern) ──
function showAddTaskModal() {
  const run = Orchestrator.activeRun;
  if (!run || run.ended) { Q.showToast?.('请先运行一个编排', 'error'); return; }
  const existingIds = [...run.tasks.keys()];
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.id = 'orch-addtask-modal';
  overlay.innerHTML = `
    <div class="modal orch-modal">
      <h2>➕ 动态添加任务</h2>
      <label>任务 id<input type="text" id="orch-at-id" class="orch-input" placeholder="task-extra"></label>
      <label>标签<input type="text" id="orch-at-label" class="orch-input" placeholder="补充调研"></label>
      <label>Agent ID<input type="text" id="orch-at-agent" class="orch-input" value="opencode"></label>
      <label>专家团角色<select id="orch-at-role" class="orch-input">${roleOptionsHtml()}</select></label>
      <label>技能（可选）<select id="orch-at-skill" class="orch-input">${skillOptionsHtml()}</select></label>
      <label>专家（可选）<select id="orch-at-expert" class="orch-input">${expertOptionsHtml()}</select></label>
      <label>依赖（已有任务 id，逗号分隔）<input type="text" id="orch-at-deps" class="orch-input" placeholder="${existingIds.slice(0, 3).join(', ')}"></label>
      <label>任务指令（prompt）<textarea id="orch-at-task" class="orch-input" rows="4" placeholder="要该 Agent 做的事..."></textarea></label>
      <div class="modal-actions">
        <button id="orch-at-cancel" class="secondary-btn">取消</button>
        <button id="orch-at-send" class="primary-btn">发送</button>
      </div>
      <div id="orch-at-error" class="form-error hidden"></div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.remove('hidden'));

  // 确保专家团角色/技能/专家下拉已填充：render 预热可能尚未返回，或接口曾失败过——
  // 打开弹窗时回填一次，避免下拉只剩「（无角色 / 无技能 / 无专家）」。
  Promise.all([fetchRoles(), fetchSkills(), fetchExperts()]).then(() => {
    const rsel = overlay.querySelector('#orch-at-role');
    if (rsel) populateRoleSelect(rsel, rsel.value);
    const ssel = overlay.querySelector('#orch-at-skill');
    if (ssel) populateSkillSelect(ssel, ssel.value);
    const esel = overlay.querySelector('#orch-at-expert');
    if (esel) populateExpertSelect(esel, esel.value);
  });

  function close() { overlay.classList.add('hidden'); setTimeout(() => overlay.remove(), 250); }
  overlay.querySelector('#orch-at-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#orch-at-send').addEventListener('click', () => {
    const id = overlay.querySelector('#orch-at-id').value.trim();
    const label = overlay.querySelector('#orch-at-label').value.trim();
    const agentId = overlay.querySelector('#orch-at-agent').value.trim() || 'opencode';
    const role = overlay.querySelector('#orch-at-role').value.trim();
    const skill = overlay.querySelector('#orch-at-skill').value.trim();
    const expert = overlay.querySelector('#orch-at-expert').value.trim();
    const meta = role ? roleMeta(role) : null;
    const deps = overlay.querySelector('#orch-at-deps').value.split(',').map((s) => s.trim()).filter(Boolean);
    const task = overlay.querySelector('#orch-at-task').value.trim();
    const errEl = overlay.querySelector('#orch-at-error');
    if (!id || !task) { errEl.textContent = 'id 和任务指令必填'; errEl.classList.remove('hidden'); return; }
    send({
      type: 'workflow:addTask',
      task: {
        id, label: label || id, agentId, task, dependsOn: deps, mode: 'serial',
        role: role || undefined,
        roleName: meta ? meta.name : undefined,
        persona: meta ? meta.persona : undefined,
        skillId: skill || undefined,
        expertId: expert || undefined,
      },
    });
    Q.showToast?.('➕ 已提交动态任务：' + id, 'info');
    close();
  });
}

// ── Human reply (waiting_human) ──
function replyHuman(taskId, answer) {
  send({ type: 'human:respond', taskId, answer });
  Q.showToast?.('🙋 已提交人工回复', 'success');
}

// ── Send a message to a running agent (agent:msg bus) ──
function sendAgentMessage(toTaskId, payload) {
  if (!payload || !payload.trim()) return;
  send({ type: 'agent:msg', kind: 'request', from: 'orchestrator', to: toTaskId, payload: payload.trim() });
  Q.showToast?.('📨 已发送消息给 ' + toTaskId, 'info');
}

// ── Cancel current run ──
function cancelRun() {
  const run = Orchestrator.activeRun;
  if (!run) { Q.showToast?.('当前没有运行中的编排', 'info'); return; }
  if (run.ended) { Q.showToast?.('该编排已结束', 'info'); return; }
  if (run._cancelling) return; // 防重复点击
  run._cancelling = true;
  send({ type: 'workflow:cancel', wfId: run.wfId });
  Q.showToast?.('⏹ 正在取消编排：' + (run.name || ''), 'info');
  syncRunUI(); // 立即把按钮变为「取消中…」并禁用，给出明确反馈
  // 兜底：若 8s 内未收到 workflow:cancelled（WS 抖动/后端异常），强制复位，避免按钮永久卡在「取消中…」
  run._cancelTimer = setTimeout(() => {
    if (run._cancelling && !run.ended) {
      run._cancelling = false;
      run.ended = true;
      run.outcome = 'cancelled';
      renderStatusbar(); renderBoard(); syncRunUI();
      Q.showToast?.('⏹ 已强制取消（未收到后端确认，编排可能仍在后台运行）', 'error');
    }
  }, 8000);
}

// ============================================================
// Rendering
// ============================================================
function renderPicker() {
  const listEl = el('orch-wf-list');
  if (!listEl) return;
  if (Orchestrator.workflows.length === 0) {
    listEl.innerHTML = '<div class="orch-empty">未发现 DAG 工作流。可用「自定义编排」创建。</div>';
    return;
  }
  listEl.innerHTML = '';
  for (const wf of Orchestrator.workflows) {
    const item = document.createElement('div');
    item.className = 'orch-wf-item';
    const taskCount = (wf.tasks || []).length;
    item.innerHTML = `
      <div class="orch-wf-info">
        <div class="orch-wf-name">${escapeHtml(wf.icon || '🤖')} ${escapeHtml(wf.name)}</div>
        <div class="orch-wf-desc">${escapeHtml(wf.description || '')}</div>
        <div class="orch-wf-meta"><span class="orch-badge">DAG</span><span>${taskCount} 任务</span><span>并行 ${wf.maxConcurrency || 4}</span></div>
      </div>
      <button class="primary-btn orch-wf-run" data-id="${escapeHtml(wf.id)}">▶ 运行</button>`;
    item.querySelector('.orch-wf-run').addEventListener('click', () => {
      const def = Orchestrator.workflows.find((w) => w.id === wf.id);
      if (def) runDAG(def);
    });
    listEl.appendChild(item);
  }
}

function renderStatusbar() {
  const bar = el('orch-status-bar');
  if (!bar) return;
  const run = Orchestrator.activeRun;
  if (!run) { bar.innerHTML = ''; return; }
  const counts = {};
  STATUS_ORDER.forEach((s) => (counts[s] = 0));
  for (const t of run.tasks.values()) counts[t.status] = (counts[t.status] || 0) + 1;
  bar.innerHTML = STATUS_ORDER.map((s) => {
    const m = STATUS_META[s];
    const active = Orchestrator.filter === s ? ' active' : '';
    return `<button class="orch-status-chip${active}" data-status="${s}" style="--chip:${m.color}">
      <span class="orch-chip-dot"></span>${m.icon} ${m.label} <b>${counts[s]}</b></button>`;
  }).join('');
  bar.querySelectorAll('.orch-status-chip').forEach((b) => {
    b.addEventListener('click', () => {
      Orchestrator.filter = Orchestrator.filter === b.dataset.status ? null : b.dataset.status;
      renderStatusbar();
      renderBoard();
    });
  });
}

function renderCard(t) {
  const m = STATUS_META[t.status] || STATUS_META.pending;
  const card = document.createElement('div');
  card.className = 'orch-card status-' + t.status;
  card.dataset.taskId = t.id;
  card.style.setProperty('--stripe', m.color);

  const depsHtml = (t.dependsOn && t.dependsOn.length)
    ? '<span class="orch-card-deps">依赖：' + t.dependsOn.map((d) => escapeHtml(d)).join(', ') + '</span>'
    : '';
  const owner = t.mode === 'parallel'
    ? '并行 ' + (t.agents || []).map((a) => escapeHtml(a.agentId)).join('+')
    : (t.agentId ? escapeHtml(t.agentId) : (t.type === 'await_human' ? '🙋 人工' : '—'));
  const retryHtml = (t.retries && t.retries > 0) ? `<span class="orch-card-retry">↻${t.retries}</span>` : '';
  const roleM = (t.role && roleMeta(t.role)) ? roleMeta(t.role) : null;
  const roleBadge = roleM
    ? `<span class="orch-card-role" style="--role-color:${escapeHtml(roleM.color || 'var(--accent)')}">${escapeHtml(roleM.icon || '')} ${escapeHtml(roleM.name || t.role)}</span>`
    : '';

  card.innerHTML = `
    <div class="orch-card-head">
      <span class="orch-card-status" style="color:${m.color}">${m.icon}</span>
      <span class="orch-card-label">${escapeHtml(t.label || t.id)}</span>
      ${retryHtml}
    </div>
    <div class="orch-card-sub">
      <span class="orch-card-owner">${owner}</span>
      ${roleBadge}
      ${depsHtml}
    </div>
    <div class="orch-card-actions"></div>
    <div class="orch-card-output hidden"></div>`;

  // Actions
  const actions = card.querySelector('.orch-card-actions');
  if (t.status === 'waiting_human') {
    const wrap = document.createElement('div');
    wrap.className = 'orch-human-box';
    wrap.innerHTML = `
      <textarea class="orch-input orch-human-input" rows="2" placeholder="输入人工回复..."></textarea>
      <button class="primary-btn orch-human-send">提交回复</button>`;
    wrap.querySelector('.orch-human-send').addEventListener('click', () => {
      const ta = wrap.querySelector('.orch-human-input');
      const ans = ta.value.trim();
      if (!ans) { ta.focus(); return; }
      replyHuman('wf-' + Orchestrator.activeRun.wfId + '-' + t.id, ans);
    });
    actions.appendChild(wrap);
  } else if (t.status === 'running') {
    const btn = document.createElement('button');
    btn.className = 'orch-mini-btn';
    btn.textContent = '📨 发消息';
    btn.addEventListener('click', () => {
      const ans = window.prompt('发送给 ' + t.id + ' 的消息：');
      if (ans) sendAgentMessage(t.id, ans);
    });
    actions.appendChild(btn);
  }

  // Expand output toggle
  const out = card.querySelector('.orch-card-output');
  const toggle = document.createElement('button');
  toggle.className = 'orch-mini-btn orch-toggle-out';
  toggle.textContent = '📄 输出';
  toggle.addEventListener('click', () => {
    out.classList.toggle('hidden');
    if (!out.classList.contains('hidden') && !out.dataset.filled) {
      out.textContent = (t.output && t.output.trim()) ? t.output.slice(-4000) : '（暂无输出）';
      out.dataset.filled = '1';
    }
  });
  actions.appendChild(toggle);

  return card;
}

function renderBoard() {
  const board = el('orch-board');
  if (!board) return;
  const run = Orchestrator.activeRun;
  if (!run || run.tasks.size === 0) {
    board.innerHTML = '<div class="orch-empty">暂无任务。运行上方 DAG 工作流，或点「自定义编排」。</div>';
    return;
  }
  board.innerHTML = '';
  for (const id of run.order) {
    const t = run.tasks.get(id);
    if (!t) continue;
    if (Orchestrator.filter && t.status !== Orchestrator.filter) continue;
    board.appendChild(renderCard(t));
  }
  if (board.children.length === 0) {
    board.innerHTML = '<div class="orch-empty">当前过滤条件下没有任务。</div>';
  }
}

function syncRunUI() {
  const run = Orchestrator.activeRun;
  const nameEl = el('orch-run-name');
  const outcomeEl = el('orch-run-outcome');
  const cancelBtn = el('orch-cancel');
  const addBtn = el('orch-add-task');
  if (nameEl) nameEl.textContent = run ? (run.name || ('编排 #' + run.wfId)) : '';
  if (outcomeEl) {
    outcomeEl.className = 'orch-outcome';
    if (run && run.outcome) {
      outcomeEl.textContent = run.outcome === 'completed' ? '✅ 完成' : (run.outcome === 'failed' ? '❌ 失败' : '⏹ 已取消');
      outcomeEl.classList.add(run.outcome);
    } else if (run) {
      outcomeEl.textContent = '运行中…';
    } else {
      outcomeEl.textContent = '';
    }
  }
  if (cancelBtn) {
    if (run && run._cancelling && !run.ended) {
      cancelBtn.disabled = true;
      cancelBtn.textContent = '⏳ 取消中…';
    } else {
      cancelBtn.disabled = !(run && !run.ended);
      cancelBtn.textContent = '⏹ 取消';
    }
  }
  if (addBtn) addBtn.disabled = !(run && !run.ended);
}

// ============================================================
// WebSocket message handling
// ============================================================
function handleWSMessage(msg) {
  switch (msg.type) {
    case 'task:added': {
      const run = ensureRun(msg.workflowId, '');
      const t = msg.task;
      if (!run.tasks.has(t.id)) run.order.push(t.id);
      run.tasks.set(t.id, Object.assign(run.tasks.get(t.id) || {}, {
        id: t.id, label: t.label, agentId: t.agentId, mode: t.mode, type: t.type,
        dependsOn: t.dependsOn || [], status: t.status || 'pending',
        retries: t.retries || 0, maxRetries: t.maxRetries, onFailure: t.onFailure,
        output: run.tasks.get(t.id)?.output || '', error: null,
      }));
      renderStatusbar(); renderBoard(); syncRunUI();
      break;
    }
    case 'task:status': {
      const run = Orchestrator.activeRun;
      if (!run) break;
      const t = run.tasks.get(msg.taskId);
      if (!t) break;
      t.status = msg.status;
      if (msg.error) t.error = msg.error;
      if (msg.retry) t.retries = msg.retry;
      renderStatusbar(); renderBoard(); syncRunUI();
      break;
    }
    case 'task:output': {
      const run = Orchestrator.activeRun;
      if (!run) break;
      const t = run.tasks.get(msg.taskId);
      if (!t) break;
      t.output = (t.output || '') + (msg.data || '');
      if (t.output.length > 8000) t.output = '…' + t.output.slice(-7900);
      // Update open output panel if visible
      const card = document.querySelector('.orch-card[data-task-id="' + cssEscape(msg.taskId) + '"] .orch-card-output');
      if (card && !card.classList.contains('hidden')) {
        card.textContent = t.output.slice(-4000);
        card.dataset.filled = '1';
      }
      break;
    }
    case 'task:agent:complete': {
      // 并行任务的 Agent 完成事件；状态由 task:status 体现，这里仅记录
      break;
    }
    case 'agent:msg': {
      const run = Orchestrator.activeRun;
      const who = msg.kind === 'request' ? (msg.from + ' → ' + msg.to) : (msg.to + ' → ' + msg.from);
      Q.showToast?.('📨 Agent 消息 [' + msg.kind + '] ' + who + '：' + String(msg.payload || '').slice(0, 60), 'info');
      if (run) {
        // 附加到目标任务的输出尾部，便于追溯
        const t = run.tasks.get(msg.to);
        if (t) {
          const note = '\n[agent:msg ' + msg.kind + ' ' + who + '] ' + (msg.payload || '') + '\n';
          t.output = (t.output || '') + note;
        }
      }
      break;
    }
    case 'human:request': {
      // 由 DigitalEmployees 弹窗处理人工输入；这里仅确保看板有运行上下文
      const run = Orchestrator.activeRun;
      if (run && msg.workflowId) ensureRun(msg.workflowId, run.name);
      break;
    }
    case 'workflow:started': {
      const run = ensureRun(msg.workflowId, msg.name || '');
      run.ended = false; run.outcome = null;
      renderStatusbar(); renderBoard(); syncRunUI();
      break;
    }
    case 'workflow:completed':
    case 'workflow:failed':
    case 'workflow:cancelled': {
      const run = ensureRun(msg.workflowId, Orchestrator.activeRun ? Orchestrator.activeRun.name : '');
      run.ended = true;
      run._cancelling = false;
      if (run._cancelTimer) { clearTimeout(run._cancelTimer); run._cancelTimer = null; }
      run.outcome = msg.type === 'workflow:completed' ? 'completed' : (msg.type === 'workflow:failed' ? 'failed' : 'cancelled');
      if (msg.summary) run.summary = msg.summary;
      renderStatusbar(); renderBoard(); syncRunUI();
      if (run.outcome === 'completed') Q.showToast?.('✅ 编排完成：' + (run.name || ''), 'success');
      else if (run.outcome === 'failed') Q.showToast?.('❌ 编排失败：' + (run.name || ''), 'error');
      else if (run.outcome === 'cancelled') Q.showToast?.('⏹ 已取消编排：' + (run.name || ''), 'info');
      break;
    }
    case 'workflow:error': {
      Q.showToast?.('⚠️ 编排错误：' + (msg.message || '未知'), 'error');
      break;
    }
  }
}

function cssEscape(s) { return String(s).replace(/"/g, '\\"'); }

// ============================================================
// DAG 依赖图（Mermaid）— 复用全局 Q.DiagramRenderer
// ============================================================

// 把任务 id 规范成合法的 Mermaid 节点 id
function sanitizeId(id) {
  let s = String(id == null ? '' : id).replace(/[^A-Za-z0-9_]/g, '_');
  if (!s) s = 'n';
  if (/^[0-9]/.test(s)) s = 'n_' + s;
  return s;
}

// 由 tasks（{id,label,dependsOn,...}）生成 Mermaid flowchart 源码
function buildMermaid(tasks) {
  const safe = {};       // rawId -> safeId
  const labelOf = {};    // rawId -> 显示标签
  const list = Array.isArray(tasks) ? tasks : [];
  for (const t of list) {
    const raw = t.id != null ? String(t.id) : '';
    safe[raw] = sanitizeId(raw);
    labelOf[raw] = (t.label != null && String(t.label).trim()) ? String(t.label) : raw;
  }
  // 把仅出现在 dependsOn 中的悬空节点也纳入
  for (const t of list) {
    for (const d of (t.dependsOn || [])) {
      const dr = String(d);
      if (!safe[dr]) { safe[dr] = sanitizeId(dr); labelOf[dr] = dr; }
    }
  }
  const lines = ['flowchart TD'];
  for (const raw of Object.keys(safe)) {
    let lab = String(labelOf[raw] || raw).replace(/"/g, "'").replace(/\r?\n/g, ' ').slice(0, 60);
    if (!lab) lab = raw;
    // 若这是某个已知任务且带角色，在标签上标注专家团角色
    const t = list.find((x) => String(x.id) === raw);
    if (t && t.role) {
      const m = roleMeta(t.role);
      if (m) lab = (lab + ' · ' + (m.icon || '') + (m.name || t.role)).slice(0, 80);
    }
    lines.push('  ' + safe[raw] + '["' + lab + '"]');
  }
  for (const t of list) {
    const from = safe[t.id != null ? String(t.id) : ''];
    for (const d of (t.dependsOn || [])) {
      const to = safe[String(d)];
      if (from && to) lines.push('  ' + to + ' --> ' + from);
    }
  }
  return lines.join('\n');
}

// 触发浏览器下载纯文本
function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// 打开 DAG 依赖图弹窗（Mermaid 渲染 + 源码查看/复制/下载）
function showDAGModal(title, tasks) {
  const mmd = buildMermaid(tasks);
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.id = 'orch-dag-modal';
  overlay.innerHTML = `
    <div class="modal orch-modal orch-dag-modal">
      <h2>🕸 ${escapeHtml(title || '依赖关系图 (DAG)')}</h2>
      <div id="orch-dag-render" class="orch-dag-render"><div class="orch-dag-loading">⏳ 渲染中…</div></div>
      <details class="orch-dag-src">
        <summary>📄 Mermaid 源码</summary>
        <pre id="orch-dag-mmd"></pre>
      </details>
      <div class="modal-actions">
        <button id="orch-dag-copy" class="secondary-btn">📋 复制源码</button>
        <button id="orch-dag-dl" class="secondary-btn">⬇ 下载 .mmd</button>
        <button id="orch-dag-close" class="primary-btn">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.remove('hidden'));

  overlay.querySelector('#orch-dag-mmd').textContent = mmd;
  const renderEl = overlay.querySelector('#orch-dag-render');

  function tryRender() {
    if (window.mermaid && Q.DiagramRenderer) {
      renderEl.innerHTML = '';
      Q.DiagramRenderer.renderSingle(renderEl, 'mermaid', mmd).catch((e) => {
        renderEl.innerHTML = '<div class="orch-dag-error">⚠️ 流程图渲染失败：' + escapeHtml(e && e.message ? e.message : '') + '</div>';
      });
    } else {
      renderEl.innerHTML = '<div class="orch-dag-loading">⏳ Mermaid 库加载中…（源码已在下方提供）</div>';
      const t = setInterval(() => {
        if (window.mermaid && Q.DiagramRenderer) {
          clearInterval(t);
          renderEl.innerHTML = '';
          Q.DiagramRenderer.renderSingle(renderEl, 'mermaid', mmd);
        }
      }, 400);
      setTimeout(() => clearInterval(t), 10000);
    }
  }
  tryRender();

  overlay.querySelector('#orch-dag-copy').addEventListener('click', () => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(mmd).then(
        () => Q.showToast?.('✅ 已复制 Mermaid 源码', 'success'),
        () => Q.showToast?.('复制失败', 'error')
      );
    } else {
      Q.showToast?.('当前环境不支持剪贴板', 'error');
    }
  });
  overlay.querySelector('#orch-dag-dl').addEventListener('click', () => {
    downloadText(mmd, (title || 'dag') + '.mmd', 'text/plain');
  });
  function close() { overlay.classList.add('hidden'); setTimeout(() => overlay.remove(), 250); }
  overlay.querySelector('#orch-dag-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
}

// 导出自定义 DAG 到 workflows/*.json（服务端保存 + 本地下载兜底）
async function exportWorkflow(wfDef) {
  if (!wfDef || !wfDef.tasks || wfDef.tasks.length === 0) {
    Q.showToast?.('没有可导出的任务', 'error');
    return;
  }
  // 客户端前置拦截：名称含乱码（U+FFFD）通常来自复制粘贴的编码损坏，先提示用户重输
  if (/�/.test(wfDef.name || '')) {
    Q.showToast?.('⚠️ 名称含乱码，请重新输入名称后再导出', 'error');
    return;
  }
  const payload = {
    id: wfDef.id,
    name: wfDef.name,
    description: wfDef.description || '自定义编排导出的 DAG 工作流',
    icon: wfDef.icon || '🤖',
    kind: 'dag',
    maxConcurrency: wfDef.maxConcurrency || 4,
    tasks: wfDef.tasks.map((t) => ({
      id: t.id,
      label: t.label || t.id,
      agentId: t.agentId || 'opencode',
      dependsOn: t.dependsOn || [],
      task: t.task || '',
      mode: t.mode || 'serial',
      ...(t.role ? { role: t.role, roleName: t.roleName, persona: t.persona } : {}),
      ...(t.skillId ? { skillId: t.skillId } : {}),
      ...(t.expertId ? { expertId: t.expertId } : {}),
    })),
  };
  // 本地下载兜底（无论服务端是否成功）
  downloadText(JSON.stringify(payload, null, 2), (payload.id || 'workflow') + '.json', 'application/json');
  try {
    const resp = await fetch('/api/workflows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data.success) {
      Q.showToast?.('💾 已保存到 workflows/' + data.file + '，已加入工作流列表', 'success');
      loadWorkflows();
    } else {
      Q.showToast?.('⚠️ 服务端保存失败：' + (data.error || resp.status) + '（已下载到本地）', 'error');
    }
  } catch (e) {
    Q.showToast?.('⚠️ 服务端保存失败：' + (e.message || '') + '（已下载到本地）', 'error');
  }
}

// ============================================================
// Panel render (called by RightPanel when tab activated)
// ============================================================
function render(container) {
  Orchestrator.panel = container;
  container.innerHTML = `
    <div class="orch-wrap">
      <div class="orch-toolbar">
        <button id="orch-composer-btn" class="primary-btn">🛠 自定义编排</button>
        <button id="orch-add-task" class="secondary-btn" disabled>➕ 添加任务</button>
        <button id="orch-dag-btn" class="secondary-btn">🕸 依赖图</button>
        <button id="orch-cancel" class="secondary-btn" disabled>⏹ 取消</button>
      </div>

      <div class="orch-section-title">📋 DAG 工作流</div>
      <div id="orch-wf-list" class="orch-wf-list"><div class="orch-empty">加载中…</div></div>

      <div class="orch-run" id="orch-run">
        <div class="orch-run-header">
          <span id="orch-run-name" class="orch-run-name"></span>
          <span id="orch-run-outcome" class="orch-outcome"></span>
        </div>
        <div id="orch-status-bar" class="orch-status-bar"></div>
        <div id="orch-board" class="orch-board"></div>
      </div>
    </div>`;

  container.querySelector('#orch-composer-btn').addEventListener('click', showComposer);
  container.querySelector('#orch-add-task').addEventListener('click', showAddTaskModal);
  container.querySelector('#orch-dag-btn').addEventListener('click', () => {
    const run = Orchestrator.activeRun;
    if (!run || run.tasks.size === 0) {
      Q.showToast?.('请先运行一个编排再看依赖图', 'info');
      return;
    }
    const tasks = [...run.tasks.values()].map((t) => ({
      id: t.id, label: t.label, agentId: t.agentId, dependsOn: t.dependsOn || [], mode: t.mode,
      role: t.role || undefined, roleName: t.roleName || undefined,
    }));
    showDAGModal('依赖关系图 · ' + (run.name || run.wfId), tasks);
  });
  container.querySelector('#orch-cancel').addEventListener('click', cancelRun);

  loadWorkflows();
  fetchRoles(); // 预热专家团角色缓存，供看板徽章与 composer 角色下拉使用
  fetchSkills(); // 预热技能库缓存，供 composer 技能下拉使用
  fetchExperts(); // 预热专家库缓存，供 composer 专家下拉使用
  renderStatusbar();
  renderBoard();
  syncRunUI();
}

// ============================================================
// Init — register right-panel tab (编排)
// ============================================================
function init() {
  if (Q.UIRegistry) {
    const ok = Q.UIRegistry.registerTab('orchestrator', {
      icon: '🎛',
      label: '编排',
      order: 3,
      category: 'digital',
      render: function (container) { render(container); },
    });
    if (ok) console.log('[Orchestrator] Tab 编排 registered');
  }

  // 暴露 API（供侧栏等工作流入口调用）
  Orchestrator.loadWorkflows = loadWorkflows;
  Orchestrator.runDAG = runDAG;
  Orchestrator.handleWSMessage = handleWSMessage;
  Orchestrator.cancelRun = cancelRun;
  Orchestrator.replyHuman = replyHuman;
  Q.Orchestrator = Orchestrator;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
