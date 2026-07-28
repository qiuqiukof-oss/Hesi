// @ts-check
// ============================================================
// TTS 路由：Edge TTS 合成 + 音色列表
// 同源（127.0.0.1:4264），无需 token；失败返回 502 由前端回落 Web Speech。
// ============================================================
'use strict';

const express = require('express');
const router = express.Router();
const { synthesizeToBuffer, listEdgeVoices } = require('../lib/tts/edge-tts');

const MAX_TEXT = 2000; // 单句合成上限，防止超大请求

router.post('/synthesize', async (req, res) => {
  const { text, voice, rate, volume, pitch } = req.body || {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text (string) is required' });
  }
  if (text.length > MAX_TEXT) {
    return res.status(413).json({ error: `text too long (max ${MAX_TEXT} chars)` });
  }
  try {
    const buf = await synthesizeToBuffer(text, { voice, rate, volume, pitch });
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-store');
    res.send(buf);
  } catch (e) {
    console.warn('[TTS] Edge synthesize failed:', e && e.message);
    res.status(502).json({ error: 'edge_tts_unavailable', detail: e && e.message });
  }
});

router.get('/voices', async (req, res) => {
  try {
    const voices = await listEdgeVoices();
    res.json({ voices });
  } catch (e) {
    console.warn('[TTS] list voices failed:', e && e.message);
    res.status(502).json({ error: 'edge_tts_unavailable', detail: e && e.message });
  }
});

module.exports = { createRouter: () => router };
