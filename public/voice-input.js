/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Voice Input — Web Speech API（语音 → 文字，确认后再发）
//
// 设计（2026-07-28 重定）：
// - 麦克风识别出的文字可注入两个目标：
//     1) 终端（CLI 输入，原行为）
//     2) 全局输入框（聊天框 #chat-input）
// - 识别完成后弹「确认条」，用户确认才发出（可编辑/取消/重录）。
// - 高识别率：lang 默认 zh-CN + 确认步骤即纠错闸。
// - 设置：autoSend（跳过确认直接发）、lang（识别语言）。
// ============================================================
'use strict';

import { safeStorage } from './lib/storage.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const voice = {
  recognition: null,
  active: false,
  finalText: '',
  /** @type {string} 待确认/待发送的文字 */
  pendingText: '',
  /** @type {'chat'|'terminal'} 当前目标 */
  target: 'chat',
  /** 用户是否在确认条上手动切换过目标（切换后不再被 determineTarget 覆盖） */
  _targetPinned: false,
};

// ── 设置（持久化）──
const INPUT_PREFIX = 'qcli-voice-input-';
const inputSettings = {
  /** 跳过确认条，识别完成直接发送 */
  autoSend: safeStorage.get(INPUT_PREFIX + 'autoSend') === 'true',
  /** 识别语言 */
  lang: safeStorage.get(INPUT_PREFIX + 'lang') || 'zh-CN',
  /** 默认发送目标：auto(按焦点/终端) | chat(默认聊天) | terminal(默认终端) */
  defaultTarget: safeStorage.get(INPUT_PREFIX + 'defaultTarget') || 'auto',
};

function saveInputSetting(key, val) {
  safeStorage.set(INPUT_PREFIX + key, String(val));
}

// ── DOM 引用 ──
const $voiceBtn = document.getElementById('voice-input-btn');
const $voiceStatus = document.getElementById('voice-status');

// 确认条 DOM（懒创建、自包含样式）
let $confirmBar = null;
let $confirmText = null;
let $confirmTarget = null;

function ensureConfirmBar() {
  if ($confirmBar) return;
  // 样式（仅注入一次）
  if (!document.getElementById('voice-confirm-style')) {
    const style = document.createElement('style');
    style.id = 'voice-confirm-style';
    style.textContent = `
.voice-confirm-bar{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);
  z-index:9000;width:min(620px,92vw);background:var(--bg-elevated);
  border:1px solid var(--border-default);border-radius:12px;
  box-shadow:0 8px 30px rgba(0,0,0,.45);
  padding:12px 14px;display:flex;flex-direction:column;gap:10px;font-size:14px;color:var(--text-primary)}
.voice-confirm-bar.hidden{display:none}
.vc-row{display:flex;align-items:flex-start;gap:8px}
.vc-label{font-size:18px;line-height:1.4}
.vc-text{flex:1;min-height:42px;max-height:140px;resize:vertical;width:100%;
  background:var(--bg-surface);color:var(--text-primary);border:1px solid var(--border-default);
  border-radius:8px;padding:8px 10px;font:inherit;line-height:1.5}
.vc-text:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-glow)}
.vc-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
.vc-actions button{border:1px solid var(--border-default);background:var(--bg-overlay);
  color:var(--text-primary);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
.vc-actions button:hover{border-color:var(--accent);background:var(--bg-hover)}
.vc-send{background:var(--accent);color:#fff;border-color:transparent}
.vc-send:hover{background:var(--accent-hover);border-color:transparent}
.vc-target{margin-right:auto}
`;
    document.head.appendChild(style);
  }

  $confirmBar = document.createElement('div');
  $confirmBar.id = 'voice-confirm-bar';
  $confirmBar.className = 'voice-confirm-bar hidden';
  $confirmBar.innerHTML = `
    <div class="vc-row">
      <span class="vc-label">🎤</span>
      <textarea id="vc-text" class="vc-text" placeholder="识别结果，可编辑后发送"></textarea>
    </div>
    <div class="vc-actions">
      <button id="vc-target" class="vc-target" title="切换发送目标">发到聊天</button>
      <button id="vc-cancel">取消</button>
      <button id="vc-rerecord">重录</button>
      <button id="vc-send" class="vc-send">确认发送</button>
    </div>`;
  document.body.appendChild($confirmBar);

  $confirmText = $confirmBar.querySelector('#vc-text');
  $confirmTarget = $confirmBar.querySelector('#vc-target');

  $confirmBar.querySelector('#vc-send').addEventListener('click', () => confirmAndSend());
  $confirmBar.querySelector('#vc-cancel').addEventListener('click', () => hideConfirmBar(true));
  $confirmBar.querySelector('#vc-rerecord').addEventListener('click', () => rerecord());
  $confirmTarget.addEventListener('click', () => toggleTarget());

  // Ctrl/Cmd+Enter 快捷发送
  $confirmText.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      confirmAndSend();
    }
  });
}

// ── 目标路由 ──
function determineTarget() {
  // 用户设置的默认目标优先（terminal/chat 直接锁定）
  if (inputSettings.defaultTarget === 'terminal') return 'terminal';
  if (inputSettings.defaultTarget === 'chat') return 'chat';
  // auto：按焦点/终端自动判断
  const chatInput = document.getElementById('chat-input');
  if (chatInput && document.activeElement === chatInput) return 'chat';
  if (window.QCLI?.state?.launched) return 'terminal';
  return 'chat';
}

function targetLabel(t) {
  // 明确显示「当前会发到哪」，点击即切换
  return t === 'terminal' ? '发到终端' : '发到聊天';
}

function toggleTarget() {
  voice.target = voice.target === 'terminal' ? 'chat' : 'terminal';
  voice._targetPinned = true; // 手动切换后 pin 住，避免被下一段识别重设
  if ($confirmTarget) $confirmTarget.textContent = targetLabel(voice.target);
}

// ── 发送 ──
function routeToTarget(text) {
  const t = voice.target;
  if (t === 'chat') {
    if (window.QCLI?.ChatUI?.sendChatMessage) {
      window.QCLI.ChatUI.sendChatMessage(text);
      return;
    }
    // 兜底：直接填聊天框并触发
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
      chatInput.value = text;
      chatInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    return;
  }
  // terminal
  const launched = window.QCLI?.state?.launched;
  const tabId = window.QCLI?.Tabs?.activeTabId;
  if (launched && tabId) {
    // 必须带 tabId，否则后端报 "No tabId specified and no default terminal session"
    window.QCLI?.wsSend?.({ type: 'input', data: text + '\n', tabId });
  } else {
    // 终端未运行 / 无活动标签页 → 回落聊天框
    window.QCLI?.showToast?.(
      launched ? '终端无活动标签页，已改为发送到聊天' : '终端未运行，已改为发送到聊天',
      'info'
    );
    if (window.QCLI?.ChatUI?.sendChatMessage) window.QCLI.ChatUI.sendChatMessage(text);
  }
}

function confirmAndSend() {
  const text = ($confirmText?.value || '').trim();
  if (!text) {
    hideConfirmBar(true);
    return;
  }
  routeToTarget(text);
  // 发送后立即清空确认条内容（避免 continuous 模式下一句追加重复发送）
  hideConfirmBar(true);
  // 同步清理语音累积状态
  voice.finalText = '';
  voice.pendingText = '';
}

function rerecord() {
  // 重录 = 完全丢弃上一次的识别结果，从零开始
  // （之前 bug：textarea DOM value 没被清空，showConfirmBar 累积逻辑又把新结果追加到旧文字后面）
  if ($confirmText) $confirmText.value = '';
  voice.finalText = '';
  voice.pendingText = '';
  // 保持确认条显示（不 hide），让用户看到「正在重录」
  // 若已经在录音中，需要 stop+restart；否则调用 startVoiceInput 走完整启动流程
  if (voice.active) {
    try {
      voice.recognition.stop();
    } catch (e) {
      console.warn('[VoiceInput] rerecord stop failed:', e?.message);
    }
    // onend 会因 voice.active=true 而自动 restart；显式 setTimeout 兜底
    setTimeout(() => {
      try { voice.recognition && voice.recognition.start(); } catch { /* 已起则忽略 */ }
    }, 150);
  } else {
    startVoiceInput();
  }
}

function hideConfirmBar(clear) {
  if ($confirmBar) $confirmBar.classList.add('hidden');
  if (clear) {
    voice.pendingText = '';
    if ($confirmText) $confirmText.value = '';
  }
}

function showConfirmBar(text) {
  ensureConfirmBar();
  voice.pendingText = text;
  // 仅在用户未手动切换过时按默认/焦点重设目标（修复：手动切换 terminal 后被下一段识别覆盖回 chat）
  if (!voice._targetPinned) voice.target = determineTarget();
  if ($confirmText) {
    // 追加到已确认条（连续识别多句时累积）
    const existing = $confirmText.value.trim();
    $confirmText.value = (existing ? existing + (existing.endsWith('\n') ? '' : '\n') : '') + text;
  }
  if ($confirmTarget) $confirmTarget.textContent = targetLabel(voice.target);
  $confirmBar.classList.remove('hidden');
  if ($confirmText) {
    $confirmText.focus();
    $confirmText.setSelectionRange($confirmText.value.length, $confirmText.value.length);
  }
}

/**
 * 识别完成一段 final 文本后的处理：
 * - autoSend=true → 直接按当前目标发送；
 * - 否则 → 弹确认条等待用户确认。
 */
function handleFinalChunk(text) {
  if (!text || !text.trim()) return;
  const clean = text.trim();
  if (inputSettings.autoSend) {
    routeToTarget(clean);
  } else {
    showConfirmBar(clean);
  }
}

// ── 语音识别初始化 ──
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if ($voiceBtn) {
      $voiceBtn.title = 'Speech recognition not supported in this browser';
      $voiceBtn.style.opacity = '0.3';
      $voiceBtn.style.cursor = 'not-allowed';
    }
    return false;
  }

  voice.recognition = new SpeechRecognition();
  voice.recognition.continuous = true;
  voice.recognition.interimResults = true;
  voice.recognition.lang = inputSettings.lang || 'zh-CN';

  voice.recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        voice.finalText += transcript;
        handleFinalChunk(transcript);
      }
      // interim 实时识别条已移除（确认条覆盖最终结果反馈）。
      // 长句中途不显示滚动文字——依赖确认条 + voice-status「Listening」指示。
    }
  };

  voice.recognition.onerror = (event) => {
    console.warn('[Voice] Error:', event.error);
    if (event.error === 'no-speech') {
      // 守卫：用户主动停止后（active=false）不应再重启监听
      if (voice.active && voice.recognition) {
        try { voice.recognition.start(); } catch (e) {
          console.warn('[VoiceInput] Recognition start failed:', e?.message);
        }
      }
      return;
    }
    if (event.error === 'aborted') return;
    stopVoiceInput();
    window.QCLI?.showToast?.(`Voice error: ${event.error}`, 'error');
  };

  voice.recognition.onend = () => {
    if (voice.active && voice.recognition) {
      try {
        voice.recognition.start();
      } catch {
        stopVoiceInput();
      }
    }
  };

  return true;
}

function toggleVoiceInput() {
  if (!voice.recognition) {
    if (!initSpeechRecognition()) {
      window.QCLI?.showToast?.('Speech recognition not available in this browser. Try Chrome or Edge.', 'error');
      return;
    }
  }
  // 应用最新设置（lang 可能改过）
  if (voice.recognition) voice.recognition.lang = inputSettings.lang || 'zh-CN';

  if (voice.active) {
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
}

function startVoiceInput() {
  if (!voice.recognition) return;
  try {
    voice.active = true;
    voice.finalText = '';
    voice.recognition.start();
    if ($voiceBtn) $voiceBtn.classList.add('recording');
    if ($voiceStatus) {
      $voiceStatus.classList.remove('hidden');
      const voiceText = $voiceStatus.querySelector('.voice-text');
      if (voiceText) voiceText.textContent = 'Listening...';
    }
    window.QCLI?.showToast?.('Voice input active → speak, then confirm to send', 'info');
  } catch {
    voice.active = false;
    window.QCLI?.showToast?.('Could not start microphone. Check permissions.', 'error');
    if ($voiceBtn) $voiceBtn.classList.remove('recording');
    if ($voiceStatus) $voiceStatus.classList.add('hidden');
  }
}

function stopVoiceInput() {
  try {
    if (voice.recognition) voice.recognition.stop();
  } catch (e) {
    console.warn('[VoiceInput] Error:', e?.message);
  }
  voice.active = false;
  voice.finalText = '';
  if ($voiceBtn) $voiceBtn.classList.remove('recording');
  if ($voiceStatus) $voiceStatus.classList.add('hidden');
}

// ── 设置接口（供设置面板调用）──
function setAutoSend(val) {
  inputSettings.autoSend = !!val;
  saveInputSetting('autoSend', inputSettings.autoSend);
}
function setLang(val) {
  if (!val) return;
  inputSettings.lang = val;
  saveInputSetting('lang', val);
  if (voice.recognition) voice.recognition.lang = val;
}
function setDefaultTarget(val) {
  if (!['auto', 'chat', 'terminal'].includes(val)) return;
  if (val === inputSettings.defaultTarget) return; // 无变化时静默，避免反复 toast
  inputSettings.defaultTarget = val;
  saveInputSetting('defaultTarget', val);
  // 取消当前 session 的手动 pin，让下次识别按新默认目标
  voice._targetPinned = false;
  voice.target = determineTarget();
  if ($confirmTarget) $confirmTarget.textContent = targetLabel(voice.target);
  // 实时更新面板内「当前生效」状态行（如果面板已打开）
  renderEffectiveTarget();
  // toast 视觉反馈（避免「调节没反应」的错觉）
  const labelMap = { auto: '自动（按焦点/终端）', chat: '聊天（AI 助手）', terminal: '终端' };
  window.QCLI?.showToast?.(`默认发送目标 → ${labelMap[val]}（识别后${targetLabel(voice.target)}）`, 'info', 2000);
}
function getInputSettings() {
  return { ...inputSettings };
}

// ── 语音输入设置面板 ──
function ensureInputPanelStyle() {
  if (document.getElementById('voice-input-panel-style')) return;
  const s = document.createElement('style');
  s.id = 'voice-input-panel-style';
  s.textContent = `
.vi-settings-panel{position:fixed;top:64px;right:24px;z-index:8500;width:340px;max-width:92vw;
  /* 默认位置（兜底）；实际位置由 JS 根据触发按钮动态计算 */
  background:var(--bg-elevated);color:var(--text-primary);
  border:1px solid var(--border-default);border-radius:12px;
  box-shadow:0 8px 30px rgba(0,0,0,.45);
  font-size:14px;overflow:hidden}
.vi-settings-panel.hidden{display:none}
.vi-settings-header{display:flex;align-items:center;gap:8px;padding:10px 12px;
  border-bottom:1px solid var(--border-default)}
.vi-settings-icon{font-size:16px}
.vi-settings-title{flex:1;font-weight:600}
.vi-settings-close{background:transparent;border:0;color:var(--text-secondary);
  font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px}
.vi-settings-close:hover{background:var(--bg-hover);color:var(--text-primary)}
.vi-settings-body{padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.vi-setting-row{display:flex;align-items:center;gap:8px}
.vi-setting-label{flex:1;color:var(--text-primary)}
.vi-select{flex:1;background:var(--bg-overlay);color:var(--text-primary);
  border:1px solid var(--border-default);border-radius:8px;padding:6px 10px;font:inherit}
.vi-toggle{display:inline-block;position:relative;width:36px;height:20px;flex-shrink:0}
.vi-toggle input{opacity:0;width:0;height:0}
.vi-toggle-slider{position:absolute;inset:0;background:var(--bg-active);
  border-radius:20px;transition:.2s;cursor:pointer}
.vi-toggle-slider::before{content:"";position:absolute;left:2px;top:2px;width:16px;height:16px;
  background:var(--text-primary);border-radius:50%;transition:.2s}
.vi-toggle input:checked + .vi-toggle-slider{background:var(--accent)}
.vi-toggle input:checked + .vi-toggle-slider::before{transform:translateX(16px)}
.vi-test-btn{margin-top:4px;padding:8px 12px;background:var(--accent);color:#fff;
  border:0;border-radius:8px;cursor:pointer;font:inherit}
.vi-test-btn:hover{background:var(--accent-hover)}
.vi-effective-target{font-size:12px;color:var(--text-secondary);
  padding:6px 10px;background:var(--bg-overlay);border-radius:6px;
  border-left:3px solid var(--accent);flex-direction:column;align-items:flex-start;gap:2px}
.vi-effective-target strong{color:var(--accent);font-weight:600}
`;
  document.head.appendChild(s);
}

function toggleInputSettingsPanel() {
  ensureInputPanelStyle();
  let panel = document.getElementById('vi-settings-panel');
  if (!panel) panel = createInputSettingsPanel();
  const wasHidden = panel.classList.contains('hidden');
  if (wasHidden) {
    // 动态定位：锚定到触发按钮附近（默认下方，超边缘反向）
    positionInputSettingsPanel(panel);
    panel.classList.remove('hidden');
    renderInputSettingsPanel(panel);
  } else {
    panel.classList.add('hidden');
  }
}

/**
 * 锚定面板到触发按钮（#voice-input-settings-btn）附近：
 * - 优先在按钮下方
 * - 右对齐到按钮右边
 * - 超出下边缘 → 翻到按钮上方
 * - 超出左/右边缘 → 居中保护
 */
function positionInputSettingsPanel(panel) {
  const btn = document.getElementById('voice-input-settings-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const PANEL_W = 340;
  const PANEL_MAX_H = 360; // 预估最大高度
  const GAP = 8;
  const MARGIN = 16;

  // 水平：右对齐到按钮右边（按钮在状态栏右侧时面板向左展开）
  let left = rect.right - PANEL_W;
  if (left < MARGIN) left = MARGIN;
  if (left + PANEL_W + MARGIN > window.innerWidth) {
    left = Math.max(MARGIN, window.innerWidth - PANEL_W - MARGIN);
  }
  // 重置 right，让 left 生效
  panel.style.right = 'auto';

  // 垂直：默认在按钮下方，超出下边缘则翻到上方
  let top = rect.bottom + GAP;
  if (top + PANEL_MAX_H + MARGIN > window.innerHeight) {
    top = rect.top - PANEL_MAX_H - GAP;
    if (top < MARGIN) top = MARGIN;
  }
  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  // 清除 CSS 兜底的 right
  panel.style.removeProperty('right');
}

function createInputSettingsPanel() {
  const langOptions = [
    ['zh-CN', '中文'],
    ['en-US', 'English'],
    ['ja-JP', '日本語'],
    ['ko-KR', '한국어'],
  ].map(([v, label]) => `<option value="${v}">${label}</option>`).join('');

  const panel = document.createElement('div');
  panel.id = 'vi-settings-panel';
  panel.className = 'vi-settings-panel hidden';
  panel.innerHTML = `
    <div class="vi-settings-header">
      <span class="vi-settings-icon">🎤</span>
      <span class="vi-settings-title" data-i18n="voice.inputSettings">语音输入设置</span>
      <button class="vi-settings-close" id="vi-settings-close" title="关闭">✕</button>
    </div>
    <div class="vi-settings-body">
      <div class="vi-setting-row">
        <span class="vi-setting-label">识别后自动发送（跳过确认）</span>
        <label class="vi-toggle">
          <input type="checkbox" id="vi-autosend">
          <span class="vi-toggle-slider"></span>
        </label>
      </div>
      <div class="vi-setting-row">
        <span class="vi-setting-label">识别语言</span>
        <select id="vi-lang" class="vi-select">${langOptions}</select>
      </div>
      <div class="vi-setting-row">
        <span class="vi-setting-label" data-i18n="voice.defaultTargetLabel">默认发送目标</span>
        <select id="vi-default-target" class="vi-select">
          <option value="auto" ${inputSettings.defaultTarget === 'auto' ? 'selected' : ''}>自动（按焦点/终端）</option>
          <option value="chat" ${inputSettings.defaultTarget === 'chat' ? 'selected' : ''}>聊天（AI 助手）</option>
          <option value="terminal" ${inputSettings.defaultTarget === 'terminal' ? 'selected' : ''}>终端</option>
        </select>
      </div>
      <div class="vi-setting-row vi-effective-target" id="vi-effective-target">
        <!-- 实时显示「当前生效目标」（基于 defaultTarget + 当前焦点/终端状态） -->
      </div>
      <div class="vi-setting-row" style="font-size:12px;color:var(--text-secondary);flex-direction:column;align-items:flex-start;gap:4px">
        <span>💡 识别时麦克风会按当前焦点自动路由：</span>
        <span>· 聊天输入框聚焦 → 发送到聊天</span>
        <span>· 终端运行中 → 发送到终端</span>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  panel.querySelector('#vi-settings-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });
  // 点 panel 自身不关闭（点 backdrop 外部才关，下面单独挂）
  return panel;
}

function renderInputSettingsPanel(panel) {
  const autosend = panel.querySelector('#vi-autosend');
  const langSel = panel.querySelector('#vi-lang');
  const targetSel = panel.querySelector('#vi-default-target');
  if (autosend) autosend.checked = !!inputSettings.autoSend;
  if (langSel) langSel.value = inputSettings.lang || 'zh-CN';
  if (targetSel) targetSel.value = inputSettings.defaultTarget || 'auto';
  renderEffectiveTarget();
}

/** 实时显示「当前生效目标」（基于 defaultTarget + 当前焦点/终端状态） */
function renderEffectiveTarget() {
  const el = document.getElementById('vi-effective-target');
  if (!el) return;
  const def = inputSettings.defaultTarget || 'auto';
  const effective = determineTarget();
  // 检测「默认与生效不一致」场景（典型：默认 auto 但当前焦点在聊天 → 生效 chat）
  const defLabel = { auto: '自动（按焦点/终端）', chat: '聊天（AI 助手）', terminal: '终端' }[def];
  const effLabel = targetLabel(effective);
  const divergence = (def === 'auto') ? '' :
    (def !== effective ? ` <span style="color:var(--text-tertiary);font-size:11px">（被手动覆盖）</span>` : '');
  el.innerHTML = `
    <span>当前默认：<strong>${defLabel}</strong></span>
    <span>当前生效：<strong>${effLabel}</strong>${divergence}</span>
  `;
}

// 全局事件：监听输入面板 + 关闭面板的 backdrop 点击
function wireInputSettingsEvents() {
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.id === 'vi-autosend') setAutoSend(el.checked);
    else if (el.id === 'vi-lang') setLang(el.value);
    else if (el.id === 'vi-default-target') setDefaultTarget(el.value);
  });
  // 点击输入设置按钮 → 打开面板
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#voice-input-settings-btn');
    if (btn) {
      e.preventDefault();
      toggleInputSettingsPanel();
      return;
    }
    // backdrop：点 panel 外（且不是 panel 本身、不是触发按钮）则关闭
    const panel = document.getElementById('vi-settings-panel');
    if (panel && !panel.classList.contains('hidden')) {
      const withinPanel = e.target === panel || panel.contains(e.target);
      const isTrigger = e.target.closest('#voice-input-settings-btn');
      if (!withinPanel && !isTrigger) panel.classList.add('hidden');
    }
  });
}

// Wire up the voice button
if ($voiceBtn) {
  $voiceBtn.addEventListener('click', toggleVoiceInput);
  initSpeechRecognition();
}

wireInputSettingsEvents();

window.addEventListener('beforeunload', () => {
  if (voice.active) stopVoiceInput();
});

// ── 导出 ──
const VoiceInput = {
  toggle: toggleVoiceInput,
  start: startVoiceInput,
  stop: stopVoiceInput,
  setAutoSend,
  setLang,
  setDefaultTarget,
  getInputSettings,
  toggleSettingsPanel: toggleInputSettingsPanel,
};
Q.VoiceInput = VoiceInput;
