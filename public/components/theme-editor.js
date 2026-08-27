/**
 * theme-editor.js — 主题编辑器
 *
 * 功能：颜色选择器编辑器 + 实时预览 + 导入导出 JSON
 * 数据源：读取当前生效的 CSS 变量，编辑后写入自定义主题
 * ============================================================
 * @ts-check
'use strict';

import {
  getTheme, registerCustomTheme, removeCustomTheme,
  getCustomThemes, exportThemeJSON, importThemeJSON,
} from '../lib/theme-registry.js';
import { applyTheme } from './theme-switcher.js';

/** 可编辑的 CSS 变量分组 */
const VAR_GROUPS = [
  {
    label: '🎨 背景',
    vars: [
      { key: '--bg-ground',    label: '底色',     fallback: '#0a0a0b' },
      { key: '--bg-surface',   label: '面板',     fallback: '#121214' },
      { key: '--bg-elevated',  label: '浮层',     fallback: '#18181b' },
      { key: '--bg-hover',     label: '悬停',     fallback: '#1f1f23' },
    ],
  },
  {
    label: '✏️ 文字',
    vars: [
      { key: '--text-primary',   label: '主文字',  fallback: '#e4e4e7' },
      { key: '--text-secondary', label: '副文字',  fallback: '#a1a1aa' },
      { key: '--text-tertiary',  label: '弱文字',  fallback: '#71717a' },
    ],
  },
  {
    label: '💎 强调色',
    vars: [
      { key: '--accent',       label: '主强调',  fallback: '#6366f1' },
      { key: '--accent-sub',   label: '副强调',  fallback: '#818cf8' },
      { key: '--accent-hover', label: '悬停',    fallback: '#818cf8' },
    ],
  },
  {
    label: '📏 边框',
    vars: [
      { key: '--border-default', label: '默认',  fallback: '#27272a' },
      { key: '--border-strong',  label: '强',    fallback: '#3f3f46' },
    ],
  },
  {
    label: '💻 终端',
    vars: [
      { key: '--term-bg',   label: '背景',  fallback: 'rgba(13,14,16,0.85)' },
      { key: '--term-fg',   label: '文字',  fallback: '#e4e4e7' },
      { key: '--term-cursor', label: '光标', fallback: '#e4e4e7' },
      { key: '--term-blue',   label: '蓝色', fallback: '#6366f1' },
      { key: '--term-green',  label: '绿色', fallback: '#22c55e' },
      { key: '--term-red',    label: '红色', fallback: '#ef4444' },
      { key: '--term-yellow', label: '黄色', fallback: '#eab308' },
      { key: '--term-cyan',   label: '青色', fallback: '#22d3ee' },
    ],
  },
  {
    label: '🚦 语义色',
    vars: [
      { key: '--error',   label: '错误',  fallback: '#ef4444' },
      { key: '--warning', label: '警告',  fallback: '#eab308' },
      { key: '--success', label: '成功',  fallback: '#22c55e' },
    ],
  },
];

/** 判断颜色值是否可用 color picker（排除 rgba/hsl 等） */
function isHexColor(val) {
  return /^#([0-9a-f]{3,8})$/i.test((val || '').trim());
}

/** 把 rgba(...) 转为 hex（简化版，仅用于 color input fallback） */
function rgbaToHex(str) {
  const m = (str || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#888888';
  const r = parseInt(m[1]), g = parseInt(m[2]), b = parseInt(m[3]);
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

/** 编辑器面板 HTML */
function createPanel() {
  const el = document.createElement('div');
  el.id = 'theme-editor-overlay';
  el.className = 'te-overlay hidden';
  el.innerHTML = `
    <div class="te-panel">
      <div class="te-header">
        <span class="te-title">🎨 主题编辑器</span>
        <div class="te-actions">
          <button class="te-btn te-btn-import" title="导入主题 JSON">📥 导入</button>
          <button class="te-btn te-btn-export" title="导出当前主题">📤 导出</button>
          <button class="te-btn te-btn-delete" title="删除自定义主题" style="display:none">🗑️</button>
          <span class="te-spacer"></span>
          <button class="te-btn te-btn-close" title="关闭">✕</button>
        </div>
      </div>
      <div class="te-toolbar">
        <label class="te-label">主题名称</label>
        <input class="te-name-input" type="text" placeholder="My Custom Theme" maxlength="30" />
        <label class="te-label" style="margin-left:8px">基调</label>
        <select class="te-scheme-select">
          <option value="dark">暗色</option>
          <option value="light">亮色</option>
        </select>
        <label class="te-label" style="margin-left:8px">风格</label>
        <select class="te-style-select">
          <option value="default">默认</option>
          <option value="glass">🔮 玻璃</option>
        </select>
      </div>
      <div class="te-body">
        <div class="te-vars"></div>
        <div class="te-preview">
          <div class="te-preview-label">实时预览</div>
          <div class="te-preview-card">
            <div class="te-pv-header">预览标题</div>
            <div class="te-pv-body">这是一段预览文字，展示当前配色效果。</div>
            <div class="te-pv-accent">强调色按钮</div>
          </div>
          <div class="te-preview-msg">
            <div class="te-pv-msg-user">用户消息气泡</div>
            <div class="te-pv-msg-ai">AI 回复气泡</div>
          </div>
        </div>
      </div>
      <div class="te-footer">
        <button class="te-btn te-btn-apply">✨ 应用</button>
        <button class="te-btn te-btn-save">💾 保存为主题</button>
      </div>
      <input type="file" class="te-file-input" accept=".json" style="display:none" />
    </div>
  `;
  return el;
}

/** 当前编辑中的变量快照 */
let _draft = {};
/** 当前编辑的主题 ID（null = 新建） */
let _editingId = null;
/** 是否正在预览自定义主题 */
let _previewActive = false;

/** 从当前 CSS 读取所有可编辑变量的值 */
function readCurrentVars() {
  const cs = getComputedStyle(document.documentElement);
  const out = {};
  for (const g of VAR_GROUPS) {
    for (const v of g.vars) {
      out[v.key] = (cs.getPropertyValue(v.key) || '').trim() || v.fallback;
    }
  }
  return out;
}

/** 渲染变量编辑区 */
function renderVars(container, vars) {
  container.innerHTML = '';
  for (const group of VAR_GROUPS) {
    const section = document.createElement('div');
    section.className = 'te-group';
    section.innerHTML = `<div class="te-group-title">${group.label}</div>`;
    for (const v of group.vars) {
      const val = vars[v.key] || v.fallback;
      const row = document.createElement('div');
      row.className = 'te-var-row';
      const isHex = isHexColor(val);
      const colorVal = isHex ? val : rgbaToHex(val);
      row.innerHTML = `
        <label class="te-var-label">${v.label}</label>
        <span class="te-var-key">${v.key}</span>
        <input type="color" class="te-color-pick" value="${colorVal}" data-key="${v.key}" />
        <input type="text" class="te-color-text" value="${val}" data-key="${v.key}" placeholder="${v.fallback}" />
      `;
      section.appendChild(row);
    }
    container.appendChild(section);
  }
}

/** 绑定 color picker ↔ text input 双向同步 + 实时预览 */
function bindVarInputs(panel) {
  const picks = panel.querySelectorAll('.te-color-pick');
  const texts = panel.querySelectorAll('.te-color-text');

  const sync = (key, val) => {
    _draft[key] = val;
    // 实时预览：直接写到 documentElement
    document.documentElement.style.setProperty(key, val);
  };

  picks.forEach((pick) => {
    pick.addEventListener('input', () => {
      const key = pick.dataset.key;
      const text = panel.querySelector(`.te-color-text[data-key="${key}"]`);
      if (text) text.value = pick.value;
      sync(key, pick.value);
    });
  });

  texts.forEach((text) => {
    text.addEventListener('input', () => {
      const key = text.dataset.key;
      if (isHexColor(text.value)) {
        const pick = panel.querySelector(`.te-color-pick[data-key="${key}"]`);
        if (pick) pick.value = text.value;
      }
      sync(key, text.value);
    });
  });
}

/** 预览区更新（根据 draft 变量刷新预览卡片颜色） */
function updatePreview(panel) {
  const card = panel.querySelector('.te-preview-card');
  if (!card) return;
  const a = _draft['--accent'] || '#6366f1';
  const bg = _draft['--bg-ground'] || '#0a0a0b';
  const surf = _draft['--bg-surface'] || '#121214';
  const fg = _draft['--text-primary'] || '#e4e4e7';
  const sub = _draft['--text-secondary'] || '#a1a1aa';
  const bdr = _draft['--border-default'] || '#27272a';

  card.style.background = surf;
  card.style.borderColor = bdr;
  card.style.color = fg;

  const header = card.querySelector('.te-pv-header');
  if (header) header.style.color = fg;
  const body = card.querySelector('.te-pv-body');
  if (body) body.style.color = sub;
  const btn = card.querySelector('.te-pv-accent');
  if (btn) {
    btn.style.background = a;
    btn.style.color = '#fff';
  }

  // 消息气泡预览
  const userMsg = panel.querySelector('.te-pv-msg-user');
  if (userMsg) {
    userMsg.style.background = a + '22';
    userMsg.style.borderColor = a + '44';
    userMsg.style.color = fg;
  }
  const aiMsg = panel.querySelector('.te-pv-msg-ai');
  if (aiMsg) {
    aiMsg.style.background = surf;
    aiMsg.style.borderColor = bdr;
    aiMsg.style.color = fg;
  }
}

/** 打开编辑器 */
export function openEditor() {
  let overlay = document.getElementById('theme-editor-overlay');
  if (!overlay) {
    overlay = createPanel();
    document.body.appendChild(overlay);
    _bindEvents(overlay);
  }
  // 初始化 draft
  _draft = readCurrentVars();
  _editingId = null;
  _previewActive = false;

  const vars = overlay.querySelector('.te-vars');
  renderVars(vars, _draft);
  bindVarInputs(overlay);
  updatePreview(overlay);

  // 填充当前主题信息
  const nameInput = overlay.querySelector('.te-name-input');
  const schemeSelect = overlay.querySelector('.te-scheme-select');
  const styleSelect = overlay.querySelector('.te-style-select');
  const deleteBtn = overlay.querySelector('.te-btn-delete');

  const currentTheme = getTheme(document.documentElement.getAttribute('data-theme'));
  if (currentTheme) {
    nameInput.value = currentTheme.custom ? currentTheme.label : '';
    schemeSelect.value = currentTheme.scheme || 'dark';
    if (currentTheme.custom) {
      _editingId = currentTheme.id;
      styleSelect.value = currentTheme.style || 'default';
      deleteBtn.style.display = '';
    } else {
      deleteBtn.style.display = 'none';
    }
  }

  overlay.classList.remove('hidden');
  // 监听变量变化更新预览
  overlay._previewInterval = setInterval(() => updatePreview(overlay), 500);
}

/** 关闭编辑器 */
function closeEditor() {
  const overlay = document.getElementById('theme-editor-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  if (overlay._previewInterval) clearInterval(overlay._previewInterval);
  // 如果正在预览但没保存，恢复原主题
  if (_previewActive) {
    const saved = document.documentElement.getAttribute('data-theme');
    if (saved) applyTheme(saved);
    _previewActive = false;
  }
}

/** 绑定事件 */
function _bindEvents(overlay) {
  // 关闭
  overlay.querySelector('.te-btn-close').addEventListener('click', closeEditor);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditor();
  });

  // 应用（预览）
  overlay.querySelector('.te-btn-apply').addEventListener('click', () => {
    const name = overlay.querySelector('.te-name-input').value.trim() || 'custom-preview';
    const scheme = overlay.querySelector('.te-scheme-select').value;
    const style = overlay.querySelector('.te-style-select').value;
    // 临时注册并应用
    const entry = registerCustomTheme({
      id: _editingId || ('preview-' + Date.now()),
      label: name,
      scheme,
      variables: { ..._draft },
      style,
    });
    applyTheme(entry.id);
    _previewActive = true;
  });

  // 保存
  overlay.querySelector('.te-btn-save').addEventListener('click', () => {
    const name = overlay.querySelector('.te-name-input').value.trim();
    if (!name) { alert('请输入主题名称'); return; }
    const scheme = overlay.querySelector('.te-scheme-select').value;
    const style = overlay.querySelector('.te-style-select').value;
    const id = _editingId || ('custom-' + name.replace(/\s+/g, '-').toLowerCase() + '-' + Date.now());
    const entry = registerCustomTheme({
      id,
      label: name,
      scheme,
      variables: { ..._draft },
      style,
    });
    applyTheme(entry.id);
    _editingId = id;
    _previewActive = false;
    // 显示删除按钮
    overlay.querySelector('.te-btn-delete').style.display = '';
    // 刷新主题选择器
    if (window.QCLI?.themeSelector?.render) window.QCLI.themeSelector.render();
    _showToast('✅ 主题已保存');
  });

  // 删除
  overlay.querySelector('.te-btn-delete').addEventListener('click', () => {
    if (!_editingId) return;
    if (!confirm('确定删除此自定义主题？')) return;
    removeCustomTheme(_editingId);
    _editingId = null;
    overlay.querySelector('.te-btn-delete').style.display = 'none';
    // 切回默认主题
    applyTheme('dark');
    if (window.QCLI?.themeSelector?.render) window.QCLI.themeSelector.render();
    closeEditor();
    _showToast('🗑️ 主题已删除');
  });

  // 导出
  overlay.querySelector('.te-btn-export').addEventListener('click', () => {
    const name = overlay.querySelector('.te-name-input').value.trim() || 'exported-theme';
    const scheme = overlay.querySelector('.te-scheme-select').value;
    const style = overlay.querySelector('.te-style-select').value;
    const fakeTheme = {
      id: _editingId || 'exported',
      label: name,
      scheme,
      variables: { ..._draft },
      style,
    };
    const json = exportThemeJSON(fakeTheme);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hesi-theme-${name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    _showToast('📤 主题已导出');
  });

  // 导入
  const fileInput = overlay.querySelector('.te-file-input');
  overlay.querySelector('.te-btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = importThemeJSON(reader.result);
      if (result.error) {
        alert('导入失败: ' + result.error);
        return;
      }
      // 加载导入的主题到编辑器
      const theme = result.theme;
      if (theme && theme.variables) {
        _draft = { ...theme.variables };
        _editingId = theme.id;
        overlay.querySelector('.te-name-input').value = theme.label;
        overlay.querySelector('.te-scheme-select').value = theme.scheme;
        overlay.querySelector('.te-style-select').value = theme.style || 'default';
        renderVars(overlay.querySelector('.te-vars'), _draft);
        bindVarInputs(overlay);
        updatePreview(overlay);
        overlay.querySelector('.te-btn-delete').style.display = '';
        _showToast('📥 主题已导入');
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
}

/** Toast 提示 */
function _showToast(msg) {
  const t = document.createElement('div');
  t.className = 'te-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2000);
}

// ── 导出到 QCLI 命名空间 ──
Promise.resolve().then(() => {
  const Q = window.QCLI || {};
  Q.ThemeEditor = { open: openEditor, close: closeEditor };
});

export default { open: openEditor, close: closeEditor };
