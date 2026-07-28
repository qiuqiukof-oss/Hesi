// @ts-check
// ============================================================
// Edge TTS 封装（纯 Node，复用 edge-tts-universal，零原生依赖）
//
// 把微软 Edge 在线神经语音合成的结果返回为 Buffer，
// 供 routes/tts.js 以音频流形式下发给浏览器。
// 失败由调用方（route / 前端）回落到浏览器原生 Web Speech。
// ============================================================
'use strict';

const { EdgeTTS, listVoices } = require('edge-tts-universal');

/**
 * 把 Web Speech 风格的倍速（0.1~10，1.0=正常）转换为 Edge SSML 百分比格式。
 * Edge 不接受 "1.0" 这种纯数字，需 "+0.00%" / "-20.00%" 形式。
 * @param {string|number} [r]
 * @returns {string}
 */
function toEdgeRate(r) {
  const num = typeof r === 'number' ? r : parseFloat(r);
  if (!isFinite(num)) return '+0%';
  // Edge 合法区间：倍速 0.1~2.0（对应百分比 -90% ~ +100%），超出报错回落
  const pct = Math.round((num - 1) * 100);
  const clamped = Math.max(-90, Math.min(100, pct));
  const sign = clamped >= 0 ? '+' : '';
  return `${sign}${clamped}%`;
}

/**
 * 合成单段文字为 mp3 Buffer。
 * @param {string} text
 * @param {{voice?:string, rate?:string|number, volume?:string, pitch?:string}} [opts]
 * @returns {Promise<Buffer>}
 */
async function synthesizeToBuffer(text, opts = {}) {
  const voice = opts.voice || 'zh-CN-XiaoxiaoNeural';
  // 完全消除段落后的停顿：Edge TTS 对空行(\n\n)插入较长段落停顿；
  // 直接把连续换行（含空行）替换为空格，段落之间不再有停顿。
  const normText = String(text == null ? '' : text).replace(/\n{2,}/g, ' ');
  // Edge SSML prosody rate 接受百分比（如 "+10.00%"），不接受纯倍速数字
  const rate = toEdgeRate(opts.rate);
  const tts = new EdgeTTS(normText, voice, {
    rate,
    volume: opts.volume || '+0%',
    pitch: opts.pitch || '+0Hz',
  });
  const { audio } = await tts.synthesize();
  const ab = await audio.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * 列出可用 Edge 音色（精简字段）。
 * @returns {Promise<Array<{name:string, locale:string, gender:string}>>}
 */
async function listEdgeVoices() {
  const voices = await listVoices();
  return (voices || []).map((v) => ({
    name: v.ShortName || v.Name,
    locale: v.Locale || v.Language || '',
    gender: v.Gender || '',
  }));
}

module.exports = { synthesizeToBuffer, listEdgeVoices };
