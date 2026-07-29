/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Voice Output — SpeechSynthesis (TTS)
//
// Provides text-to-speech for AI responses, terminal notifications,
// and other UI events. Integrates with the chat panel for
// auto-reading AI replies.
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

import { safeStorage } from './lib/storage.js';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

// ── State ──
const _state = {
  /** @type {SpeechSynthesisUtterance|null} */
  currentUtterance: null,
  speaking: false,
  paused: false,
  /** @type {Array<{text:string,lang:string}>} */
  queue: [],
  enabled: false,         // 是否启用语音输出
  autoRead: true,         // AI 回复后自动朗读
  rate: 1.0,              // 语速 0.1~10
  pitch: 1.0,             // 音高 0~2
  volume: 1.0,            // 音量 0~1
  /** @type {string|null} */ // 选中的语音 URI
  selectedVoice: null,
  /** @type {string} */
  language: 'auto',       // auto | zh | en
  /** @type {string} */
  engine: 'web',          // web | edge | auto（auto=edge 可用时优先，否则 web）
  /** @type {string|null} */
  edgeVoice: null,        // Edge 音色 ShortName
};

// ── Keys ──
const STORAGE_PREFIX = 'qcli-tts-';
const KEYS = ['enabled', 'autoRead', 'rate', 'pitch', 'volume', 'selectedVoice', 'language', 'engine', 'edgeVoice'];

// ── Load/Save state ──
function loadState() {
  for (const key of KEYS) {
    const val = safeStorage.get(STORAGE_PREFIX + key);
    if (val !== null) {
      if (key === 'enabled' || key === 'autoRead') {
        _state[key] = val === 'true';
      } else if (key === 'rate' || key === 'pitch' || key === 'volume') {
        _state[key] = parseFloat(val);
      } else if (key === 'edgeVoice') {
        // 脏数据兜底：saveState 用 String() 把 null 序列化为 'null' 写入 storage，
        // 下次读回变成字面值字符串 'null' → 显示成 "null（加载失败）"
        _state.edgeVoice = (val === 'null' || val === '') ? null : val;
      } else {
        _state[key] = val;
      }
    }
  }
}

function saveState() {
  for (const key of KEYS) {
    safeStorage.set(STORAGE_PREFIX + key, String(_state[key]));
  }
}

// ── Voice management ──

/** 获取浏览器可用的语音列表 */
function getVoices() {
  return window.speechSynthesis?.getVoices() || [];
}

/** 获取当前选中的语音 */
function getSelectedVoice() {
  const voices = getVoices();
  if (_state.selectedVoice) {
    const found = voices.find(v => v.voiceURI === _state.selectedVoice);
    if (found) return found;
  }
  // 自动选择：根据当前语言匹配
  return autoSelectVoice(voices);
}

/** 根据语言自动选择语音 */
function autoSelectVoice(voices, lang) {
  const targetLang = lang || getTargetLang();
  // 优先精确匹配
  const exact = voices.find(v => v.lang.startsWith(targetLang));
  if (exact) return exact;
  // 宽泛匹配
  const broad = voices.find(v => v.lang.startsWith(targetLang.slice(0, 2)));
  if (broad) return broad;
  // 默认用第一个
  return voices[0] || null;
}

/** 确定朗读目标语言 */
function getTargetLang() {
  if (_state.language === 'auto') {
    // 根据页面语言
    const pageLang = document.documentElement.lang || navigator.language || 'zh-CN';
    if (pageLang.startsWith('zh')) return 'zh';
    return 'en';
  }
  return _state.language;
}

/** 检测文本语言 */
function detectTextLang(text) {
  if (!text) return getTargetLang();
  // 统计中文字符比例
  const zhCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const total = text.length;
  if (total === 0) return getTargetLang();
  return (zhCount / total) > 0.15 ? 'zh' : 'en';
}

// ── Core TTS ──

/**
 * 长文本切分（修 #2: Chrome Web Speech 对单 utterance >~200 字符不可靠，
 * streaming 时单句可能很长。优先在自然边界切：标点 > 逗号/分号 > 空格 > 强制切）。
 * @param {string} text
 * @param {number} [maxLen=150]
 * @returns {string[]}
 */
function splitForSpeech(text, maxLen = 150) {
  if (!text || text.length <= maxLen) return [text];
  const parts = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    buf += text[i];
    if (buf.length >= maxLen) {
      // 优先在最近的自然边界切
      const cut = buf.match(/^(.+?)([，。！？!?;；\s,])/);
      if (cut && cut[1].length >= 20) {
        parts.push(cut[1] + cut[2]);
        buf = buf.slice(cut[0].length);
      } else {
        // 无自然边界，强制切
        parts.push(buf);
        buf = '';
      }
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

/**
 * 是否正在朗读（含排队中）。
 * 关键：Web Speech 的 onstart 是异步回调，若仅用 _state.speaking 判断，
 * 流式分句快速连续调用 speak() 时会发生竞态——上一句尚未 onstart 即被
 * synth.cancel() 掐断。故必须同步引用 synth.speaking 实时状态。
 */
function isTtsBusy() {
  if (_state.queue.length > 0) return true;
  if (_state.speaking) return true;
  const synth = window.speechSynthesis;
  return !!(synth && synth.speaking);
}

/**
 * 剔除 emoji / 图标符号，保留中文/英文标点与空格（供朗读前净化）。
 * 覆盖：Emoji 与象形文字 (U+1F000–1FAFF)、区域指示符(旗帜)、杂项符号/骰子/棋、
 * 装饰箭头、技术符号、变体选择符等。刻意保留：CJK 标点(、。！？)、全角标点、
 * 破折号/省略号/引号/项目符号（U+2000–206F、U+3000–303F、U+FF00–FFEF）——
 * 这些念出来无害且不破坏分句。
 * @param {string} text
 * @returns {string}
 */
function stripEmoji(text) {
  if (!text) return '';
  // 仅删除明确的 emoji/图标码点区块；其余（含所有标点）原样保留。
  return text.replace(
    /[\u{1F000}-\u{1FAFF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}]/gu,
    ''
  );
}

/**
 * 朗读文本。
 * @param {string} text - 要朗读的文本
 * @param {object} [opts]
 * @param {string} [opts.lang] - 语言（自动检测）
 * @param {boolean} [opts.enqueue] - 如果正在朗读，是否排队
 * @param {Function} [opts.onStart] - 开始回调
 * @param {Function} [opts.onEnd] - 结束回调
 * @returns {boolean} 是否成功开始朗读
 */
function speak(text, opts = {}) {
  if (!_state.enabled) return false;
  if (!text || !text.trim()) return false;

  // 朗读前剔除 emoji / 图标符号（始终不读表情图，无需开关）
  text = stripEmoji(text);
  if (!text || !text.trim()) return false;

  // 简化文本：去除控制字符、缩短标点/换行停顿（统一替换为逗号级停顿）
  const cleanText = text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/[。？！]/g, '，') // 句末标点→逗号：缩短 ~500ms 停顿为 ~150ms
    .replace(/\n+/g, '，')     // 换行→逗号：同样缩短停顿
    .trim();

  if (!cleanText) return false;

  // 长文本切分（修 #2）— 拆成 ≤maxLen 的多段，避免 Chrome 截断
  const segments = splitForSpeech(cleanText, 150);
  if (segments.length > 1) {
    const segLang = opts.lang || detectTextLang(segments[0]);
    if (isTtsBusy()) {
      // 已在朗读/排队：enqueue 才入队（否则丢弃避免打断当前朗读）
      if (opts.enqueue) segments.forEach(seg => _state.queue.push({ text: seg, lang: segLang }));
      return !!opts.enqueue;
    }
    // 空闲：第一段立即朗读，剩余入队
    const [first, ...rest] = segments;
    rest.forEach(seg => _state.queue.push({ text: seg, lang: segLang }));
    return _doSpeak(first, { ...opts, lang: segLang });
  }

  // 短文本
  if (isTtsBusy()) {
    if (opts.enqueue) {
      // 排队等待当前朗读结束后续播
      _state.queue.push({ text: cleanText, lang: opts.lang || detectTextLang(cleanText) });
      return true;
    }
    // 不排队且正在朗读 → 拒绝（保持原行为，不打断）
    return false;
  }

  return _doSpeak(cleanText, opts);
}

function _doSpeak(text, opts) {
  const synth = window.speechSynthesis;
  if (!synth) return false;

  // 取消当前朗读（正常情况下此刻已非忙碌，cancel 为空操作；
  // 仅防御性，避免任何残留 utterance 串音）
  synth.cancel();
  _state.speaking = false;

  const lang = opts.lang || detectTextLang(text);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === 'zh' ? 'zh-CN' : 'en-US';
  utterance.rate = _state.rate;
  utterance.pitch = _state.pitch;
  utterance.volume = _state.volume;

  const voice = getSelectedVoice();
  if (voice) utterance.voice = voice;

  utterance.onstart = () => {
    _state.speaking = true;
    _state.currentUtterance = utterance;
    updateUI();
    opts.onStart?.();
  };

  utterance.onend = () => {
    _state.speaking = false;
    _state.currentUtterance = null;
    updateUI();
    opts.onEnd?.();

    // 播放下一条队列
    if (_state.queue.length > 0) {
      const next = _state.queue.shift();
      _doSpeak(next.text, { lang: next.lang });
    }
  };

  utterance.onerror = (e) => {
    console.warn('[VoiceOutput] Speech error:', e.error);
    _state.speaking = false;
    _state.currentUtterance = null;
    updateUI();
    // 跳过当前队列
    if (_state.queue.length > 0) {
      const next = _state.queue.shift();
      _doSpeak(next.text, { lang: next.lang });
    }
  };

  try {
    synth.speak(utterance);
    // 同步置位：避免流式分句快速连续调用时，上一句 onstart 尚未触发，
    // 下一句误判为「空闲」而 synth.cancel() 掐断上一句（导致只剩最后一句被朗读）。
    _state.speaking = true;
    _state.currentUtterance = utterance;
    return true;
  } catch (e) {
    console.warn('[VoiceOutput] speak() failed:', e.message);
    return false;
  }
}

/**
 * 停止朗读
 */
function stop() {
  const synth = window.speechSynthesis;
  if (synth) {
    synth.cancel();
  }
  _state.speaking = false;
  _state.currentUtterance = null;
  _state.queue = [];
  updateUI();
}

/**
 * 暂停/恢复朗读
 */
function togglePause() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (synth.paused) {
    synth.resume();
    _state.paused = false;
  } else if (_state.speaking) {
    synth.pause();
    _state.paused = true;
  }
  updateUI();
}

/**
 * 朗读 AI 回复（专供 chat-panel 调用）。
 * 自动检测是否启用、是否 autoRead、是否过长。
 */
function speakAIResponse(text) {
  if (!_state.enabled || !_state.autoRead) return;
  if (!text || text.length > 3000) {
    // 过长文本不朗读，只提示
    if (text && text.length > 3000 && _state.enabled) {
      speak('AI 回复内容较长，请在聊天面板中阅读', { enqueue: true });
    }
    return;
  }
  // 移除 Markdown 标记只保留纯文本
  const plainText = stripMarkdown(text);
  speak(plainText, { enqueue: true });
}

/**
 * 去除 Markdown 标记，提取纯文本供朗读
 */
function stripMarkdown(md) {
  if (!md) return '';
  return md
    // 代码块
    .replace(/```[\s\S]*?```/g, '代码块')
    // 行内代码
    .replace(/`([^`]+)`/g, '$1')
    // 图片
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => alt || '图片')
    // 链接
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 加粗/斜体
    .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, '$2')
    // 标题标记
    .replace(/^#{1,6}\s+/gm, '')
    // 列表标记
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    // 引用
    .replace(/^>\s+/gm, '')
    // 水平线
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // 表格
    .replace(/\|/g, ' ')
    .replace(/[-:]+\s*[-:|]+\s*/g, '')
    // HTML 标签
    .replace(/<[^>]+>/g, '')
    // 完全消除段落后的停顿（连续换行→空格）
    .replace(/\n{2,}/g, ' ')
    .trim();
}

// ── UI 更新 ──
function updateUI() {
  const btn = document.getElementById('tts-toggle-btn');
  const indicator = document.getElementById('tts-indicator');
  if (btn) {
    btn.classList.toggle('speaking', _state.speaking);
    btn.classList.toggle('tts-enabled', _state.enabled);
    btn.title = _state.enabled
      ? (_state.speaking ? '🔊 正在朗读...' : '🔊 语音输出已开启')
      : '🔇 语音输出已关闭';
  }
  if (indicator) {
    indicator.classList.toggle('hidden', !_state.speaking);
  }
}

// ── Settings ──

function getSettings() {
  return { ..._state };
}

function updateSettings(changes) {
  let changed = false;
  for (const [key, value] of Object.entries(changes)) {
    if (key in _state && _state[key] !== value) {
      _state[key] = value;
      changed = true;
    }
  }
  if (changed) {
    saveState();
    updateUI();
    // 如果关闭语音，停止当前朗读
    if (changes.enabled === false) stop();
  }
}

function setEnabled(val) {
  updateSettings({ enabled: !!val });
}

function setAutoRead(val) {
  updateSettings({ autoRead: !!val });
}

function setRate(val) {
  updateSettings({ rate: Math.max(0.1, Math.min(10, parseFloat(val) || 1.0)) });
}

function setPitch(val) {
  updateSettings({ pitch: Math.max(0, Math.min(2, parseFloat(val) || 1.0)) });
}

function setVolume(val) {
  updateSettings({ volume: Math.max(0, Math.min(1, parseFloat(val) || 1.0)) });
}

function setLanguage(val) {
  if (['auto', 'zh', 'en'].includes(val)) {
    updateSettings({ language: val });
  }
}

function setEngine(val) {
  if (['web', 'edge', 'auto'].includes(val)) {
    updateSettings({ engine: val });
  }
}

function setEdgeVoice(val) {
  updateSettings({ edgeVoice: val || null });
}

/**
 * 朗读单句（供流式增量调用）。
 * - engine=edge 且可用时走 speakStreaming（Edge TTS 高质量）；
 * - 否则走浏览器原生 Web Speech（零依赖）。
 * 自动检测 enabled / autoRead / 过长截断。
 */
function speakSentence(text) {
  if (!_state.enabled || !_state.autoRead) return false;
  const plain = stripMarkdown(text || '');
  if (!plain || plain.length > 3000) {
    if (plain && plain.length > 3000 && _state.enabled) {
      speak('AI 回复内容较长，请在聊天面板中阅读', { enqueue: true });
    }
    return false;
  }
  if (_state.engine === 'edge' && typeof speakStreaming === 'function') {
    return speakStreaming(plain, { enqueue: true });
  }
  return speak(plain, { enqueue: true });
}

// Edge 可用性探测缓存（auto 模式用）
let _edgeAvailable = null; // null=未探测 | true | false

/**
 * 通过后端 /api/tts/synthesize 合成并播放（Edge TTS 高质量）。
 * 失败自动回落浏览器原生 Web Speech。
 * @param {string} text
 * @param {object} [opts]
 * @returns {Promise<boolean>}
 */
// Edge 流式播放队列：promise 链串行化，避免多句重叠
let _edgeQueue = Promise.resolve();

async function speakStreaming(text, opts = {}) {
  if (!_state.enabled) return false;
  if (!text || !text.trim()) return false;

  // 朗读前剔除 emoji / 图标符号（始终不读表情图，无需开关）
  text = stripEmoji(text);
  // 缩短标点/换行停顿：客户端侧统一替换为逗号级停顿（同时服务端 synthesizeToBuffer 也有相同逻辑，双重保险）
  text = text.replace(/[。？！]/g, '，').replace(/\n+/g, '，');
  if (!text || !text.trim()) return false;

  const wantEdge = _state.engine === 'edge' || (_state.engine === 'auto' && _edgeAvailable !== false);
  if (!wantEdge) {
    _edgeAvailable = false;
    return speak(text, opts);
  }

  const voice = _state.edgeVoice || 'zh-CN-XiaoxiaoNeural';
  const rate = String(_state.rate || '1.0');

  // 预取：不等上一段播完就发起请求，让网络+合成与当前播放并行
  const fetchPromise = fetch('/api/tts/synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice, rate }),
  }).then(async (res) => {
    if (!res.ok) throw new Error('status ' + res.status);
    return res.arrayBuffer();
  });

  // 串行化：等上一段播完，但此时本段音频很可能已预取完成
  const prev = _edgeQueue;
  let resolveNext;
  _edgeQueue = new Promise((r) => { resolveNext = r; });
  await prev;

  try {
    const ab = await fetchPromise; // 大概率已就绪，无需等待
    const ok = await playAudioBuffer(ab);
    if (!ok) throw new Error('decode failed');
    _edgeAvailable = true;
    return true;
  } catch (e) {
    console.warn('[VoiceOutput] Edge TTS failed, fallback to Web Speech:', e && e.message);
    _edgeAvailable = false;
    // 防御：等 Web Speech 真正播完再放行下一段，避免与下一段（即便未来 _edgeAvailable
    // 复位重新走 Edge）叠音。finally 中的 resolveNext() 在 await 结束后才触发，队列严格串行。
    await speakUntilDone(text, opts);
    return true;
  } finally {
    resolveNext();
  }
}

/**
 * 等待 Web Speech 真正播放完毕（Edge 回落路径专用）。
 * speak() 是 fire-and-forget——同步返回布尔、靠 utterance.onend 异步排空队列，
 * 并不返回「播放完成」的 Promise。这里包一层，确保串行队列在音频结束而非调用瞬间放行。
 * @param {string} text
 * @param {object} [opts]
 * @returns {Promise<boolean>}
 */
function speakUntilDone(text, opts = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(true); } };
    const started = speak(text, { ...opts, onEnd: done });
    if (!started) done();        // speak 拒绝（未排队且忙碌）→ 不阻塞队列
    setTimeout(done, 8000);       // 兜底：onend 因故未触发时强制放行，防队列永久卡死
  });
}

/** 用 Web Audio 解码并播放 mp3 ArrayBuffer（边下边播由逐句调用近似实现）。 */
function playAudioBuffer(ab) {
  return new Promise((resolve) => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { resolve(false); return; }
    const ctx = new Ctx();
    ctx.decodeAudioData(ab.slice(0), (buf) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => { ctx.close(); resolve(true); };
      src.start(0);
    }, (err) => {
      console.warn('[VoiceOutput] decodeAudioData failed:', err);
      ctx.close();
      resolve(false);
    });
  });
}

function setVoice(voiceURI) {
  updateSettings({ selectedVoice: voiceURI || null });
}

// ── 弹出语音设置面板 ──
function toggleSettingsPanel() {
  let panel = document.getElementById('tts-settings-panel');
  if (!panel) {
    panel = createSettingsPanel();
  }
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    renderSettingsPanel(panel);
  }
}

function createSettingsPanel() {
  if (!document.getElementById('tts-input-style')) {
    const s = document.createElement('style');
    s.id = 'tts-input-style';
    s.textContent = '.tts-setting-section-title{padding:6px 0 2px;font-size:12px;font-weight:600;color:var(--text-secondary,#aaa);letter-spacing:.04em}' +
      '.tts-voice-group[hidden]{display:none}';
    document.head.appendChild(s);
  }

  const panel = document.createElement('div');
  panel.id = 'tts-settings-panel';
  panel.className = 'tts-settings-panel hidden';
  panel.innerHTML = `
    <div class="tts-settings-header">
      <span class="tts-settings-icon">🔊</span>
      <span class="tts-settings-title">语音输出设置</span>
      <button class="tts-settings-close" id="tts-settings-close">✕</button>
    </div>
    <div class="tts-settings-body" id="tts-settings-body">
      <div class="tts-setting-row">
        <span class="tts-setting-label">启用语音输出</span>
        <label class="tts-toggle">
          <input type="checkbox" id="tts-enabled" ${_state.enabled ? 'checked' : ''}>
          <span class="tts-toggle-slider"></span>
        </label>
      </div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">AI 回复自动朗读</span>
        <label class="tts-toggle">
          <input type="checkbox" id="tts-auto-read" ${_state.autoRead ? 'checked' : ''}>
          <span class="tts-toggle-slider"></span>
        </label>
      </div>
      <div class="tts-setting-divider"></div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">语速</span>
        <div class="tts-slider-group">
          <input type="range" id="tts-rate" min="0.1" max="3" step="0.1" value="${_state.rate}">
          <span class="tts-value" id="tts-rate-val">${_state.rate.toFixed(1)}x</span>
        </div>
      </div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">音高</span>
        <div class="tts-slider-group">
          <input type="range" id="tts-pitch" min="0" max="2" step="0.1" value="${_state.pitch}">
          <span class="tts-value" id="tts-pitch-val">${_state.pitch.toFixed(1)}</span>
        </div>
      </div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">音量</span>
        <div class="tts-slider-group">
          <input type="range" id="tts-volume" min="0" max="1" step="0.1" value="${_state.volume}">
          <span class="tts-value" id="tts-volume-val">${Math.round(_state.volume * 100)}%</span>
        </div>
      </div>
      <div class="tts-setting-divider"></div>
      <div class="tts-setting-section-title">TTS 引擎（高质量）</div>
      <div class="tts-setting-row">
        <span class="tts-setting-label">引擎</span>
        <select id="tts-engine" class="tts-select">
          <option value="web" ${_state.engine === 'web' ? 'selected' : ''}>浏览器原生（零依赖）</option>
          <option value="edge" ${_state.engine === 'edge' ? 'selected' : ''}>Edge TTS（需联网）</option>
          <option value="auto" ${_state.engine === 'auto' ? 'selected' : ''}>自动（Edge 优先）</option>
        </select>
      </div>
      <div class="tts-voice-group" data-engine="web">
        <div class="tts-setting-row">
          <span class="tts-setting-label">朗读语言</span>
          <select id="tts-language" class="tts-select">
            <option value="auto" ${_state.language === 'auto' ? 'selected' : ''}>自动检测</option>
            <option value="zh" ${_state.language === 'zh' ? 'selected' : ''}>中文</option>
            <option value="en" ${_state.language === 'en' ? 'selected' : ''}>English</option>
          </select>
        </div>
        <div class="tts-setting-row">
          <span class="tts-setting-label">发音人</span>
          <select id="tts-voice" class="tts-select"></select>
        </div>
      </div>
      <div class="tts-voice-group" data-engine="edge">
        <div class="tts-setting-row">
          <span class="tts-setting-label">Edge 发音人</span>
          <select id="tts-edge-voice" class="tts-select"></select>
        </div>
      </div>
      <div class="tts-setting-divider"></div>
      <button class="tts-test-btn" id="tts-test-btn">🔊 测试语音（当前引擎）</button>
    </div>
  `;
  document.body.appendChild(panel);

  // Close button
  panel.querySelector('#tts-settings-close').addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  // Backdrop click
  panel.addEventListener('click', (e) => {
    if (e.target === panel) panel.classList.add('hidden');
  });

  return panel;
}

function renderSettingsPanel(panel) {
  // 引擎切换 → 互斥显示对应 voice 组（#3 修复）
  applyEngineVisibility();

  // 填充 Web Speech 语音列表
  const voiceSelect = panel.querySelector('#tts-voice');
  if (voiceSelect) {
    const voices = getVoices();
    const currentVal = _state.selectedVoice;
    voiceSelect.innerHTML = voices.map(v =>
      `<option value="${v.voiceURI}" ${v.voiceURI === currentVal ? 'selected' : ''}>
        ${v.name} (${v.lang})
      </option>`
    ).join('');
    // 如果没有选中的语音，选择第一个匹配语言的
    if (!currentVal && voiceSelect.options.length > 0) {
      const autoVoice = autoSelectVoice(voices);
      if (autoVoice) voiceSelect.value = autoVoice.voiceURI;
    }
  }
  // Edge 发音人：只要 Edge 组可见（edge 或 auto），就拉取列表
  const edgeSelect = panel.querySelector('#tts-edge-voice');
  const edgeGroup = panel.querySelector('.tts-voice-group[data-engine="edge"]');
  if (edgeSelect && edgeGroup && !edgeGroup.hidden) {
    loadEdgeVoices(edgeSelect);
  }
}

/** 拉取 Edge 音色并填充到 select（失败时保留已保存的 edgeVoice，不强行覆写） */
async function loadEdgeVoices(selectEl) {
  try {
    const res = await fetch('/api/tts/voices');
    if (!res.ok) throw new Error('status ' + res.status);
    const data = await res.json();
    const voices = (data.voices || []).filter(v => v.locale && v.locale.startsWith('zh'));
    const list = voices.length ? voices : (data.voices || []);
    selectEl.innerHTML = list.map(v =>
      `<option value="${v.name}" ${v.name === _state.edgeVoice ? 'selected' : ''}>${v.name} (${v.locale})</option>`
    ).join('');
    if (!_state.edgeVoice && selectEl.options.length > 0) {
      // 首次使用：选第一项并写入 state
      selectEl.value = selectEl.options[0].value;
      setEdgeVoice(selectEl.options[0].value);
    } else if (_state.edgeVoice && !list.some(v => v.name === _state.edgeVoice)) {
      // 保存的 voice 不在新列表里：state 保留，警告一次
      console.warn('[VoiceOutput] saved Edge voice not in list:', _state.edgeVoice);
    }
  } catch (e) {
    console.warn('[VoiceOutput] load Edge voices failed:', e && e.message);
    // 失败：保留 state.edgeVoice，只显示提示项
    // 兜底：脏数据 'null'/'' → 默认音色
    const saved = (_state.edgeVoice && _state.edgeVoice !== 'null')
      ? _state.edgeVoice
      : 'zh-CN-XiaoxiaoNeural';
    selectEl.innerHTML = `<option value="${saved}">${saved}（加载失败，稍后重试）</option>`;
    selectEl.value = saved;
  }
}

function wireSettingsEvents() {
  document.addEventListener('change', (e) => {
    const el = e.target;
    switch (el.id) {
      case 'tts-enabled': setEnabled(el.checked); break;
      case 'tts-auto-read': setAutoRead(el.checked); break;
      case 'tts-rate': {
        setRate(el.value);
        const valEl = document.getElementById('tts-rate-val');
        if (valEl) valEl.textContent = parseFloat(el.value).toFixed(1) + 'x';
        break;
      }
      case 'tts-pitch': {
        setPitch(el.value);
        const valEl = document.getElementById('tts-pitch-val');
        if (valEl) valEl.textContent = parseFloat(el.value).toFixed(1);
        break;
      }
      case 'tts-volume': {
        setVolume(el.value);
        const valEl = document.getElementById('tts-volume-val');
        if (valEl) valEl.textContent = Math.round(parseFloat(el.value) * 100) + '%';
        break;
      }
      case 'tts-language': setLanguage(el.value); break;
      case 'tts-voice': setVoice(el.value); break;
      case 'tts-engine': {
        setEngine(el.value);
        // 引擎切换：立刻刷新互斥显示 + 加载新组 voice 列表（#5 修复）
        const panel = document.getElementById('tts-settings-panel');
        if (panel) renderSettingsPanel(panel);
        break;
      }
      case 'tts-edge-voice': setEdgeVoice(el.value); break;
      // vc-autosend / vc-lang 已迁出到 voice-input.js 独立面板
    }
  });

  document.addEventListener('input', (e) => {
    const el = e.target;
    switch (el.id) {
      case 'tts-rate': {
        // 实时滑块反馈
        break;
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.id === 'tts-test-btn') {
      const testText = '你好，欢迎使用语音输出功能。这是一条测试语音。';
      testCurrentEngine(testText);
    }
  });
}

/** 用当前引擎播放测试文本（绕过 autoRead 检查） */
function testCurrentEngine(text) {
  if (!_state.enabled) return false;
  const plain = stripMarkdown(text || '');
  if (!plain) return false;
  const engine = _state.engine || 'web';
  if (engine === 'edge') {
    return speakStreaming(plain);
  }
  if (engine === 'auto') {
    return speakStreaming(plain); // speakStreaming 内部 auto→edge 优先、失败回落 web
  }
  return speak(plain);
}

/** 根据当前引擎切换 Web Speech / Edge TTS 列表的可见性（#3 修复：互斥显示） */
function applyEngineVisibility() {
  const engine = _state.engine || 'web';
  const showWeb = engine === 'web' || engine === 'auto';
  const showEdge = engine === 'edge' || engine === 'auto';
  document.querySelectorAll('.tts-voice-group').forEach((g) => {
    const which = g.dataset.engine;
    g.hidden = which === 'web' ? !showWeb : !showEdge;
  });
}

// ── 导出 ──
const VoiceOutput = {
  get state() { return { ..._state }; },
  get enabled() { return _state.enabled; },
  get speaking() { return _state.speaking; },
  speak,
  speakAIResponse,
  speakSentence,
  speakStreaming,
  stop,
  togglePause,
  getVoices,
  getSelectedVoice,
  getSettings,
  updateSettings,
  setEnabled,
  setAutoRead,
  setEngine,
  setEdgeVoice,
  toggleSettingsPanel,
  stripMarkdown,
};

Q.VoiceOutput = VoiceOutput;

// ── 初始化 ──
loadState();
wireSettingsEvents();

// 语音列表异步加载（Chrome 等浏览器异步加载语音列表）
// 当语音列表加载完毕后，刷新已打开面板中的发音人列表
if (window.speechSynthesis) {
  // 立即尝试获取语音列表
  if (window.speechSynthesis.getVoices().length === 0) {
    // Chrome 异步加载，等待 onvoiceschanged
    window.speechSynthesis.onvoiceschanged = () => {
      // 如果设置面板已打开，刷新发音人列表
      const panel = document.getElementById('tts-settings-panel');
      if (panel && !panel.classList.contains('hidden')) {
        renderSettingsPanel(panel);
      }
    };
  }
}

// 状态栏按钮事件绑定（全局，因为 voice-output 可能在 DOM 后就绪）
document.addEventListener('click', (e) => {
  if (e.target.id === 'tts-toggle-btn' || e.target.closest('#tts-toggle-btn')) {
    e.preventDefault();
    if (_state.enabled) {
      if (_state.speaking) {
        stop();
      } else {
        toggleSettingsPanel();
      }
    } else {
      toggleSettingsPanel();
    }
  }
});

console.log('[VoiceOutput] Initialized (enabled:', _state.enabled, ')');
