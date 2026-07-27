// @ts-check
// /api/memory/sessions — list / create / get / rename / delete sessions.
'use strict';

const express = require('express');
const MemoryStore = require('../../lib/memory');
const schema = require('../../lib/memory/schema');

const router = express.Router();

router.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = Number.parseInt(req.query.limit, 10) || 0;
  res.json({ sessions: MemoryStore.list({ q, limit }) });
});

router.post('/', (req, res) => {
  const { title, model, provider } = req.body || {};
  const id = schema.createSessionId();
  MemoryStore.ensure(id, {
    title: typeof title === 'string' && title.trim() ? title.trim() : '新会话',
    model: model || '',
    provider: provider || '',
  });
  res.status(201).json({ id });
});

// ── Recycle bin (soft-deleted sessions) ──
// These must be declared before '/:id' so '/trash' isn't captured by the
// param route.
router.get('/trash', (req, res) => {
  res.json({ sessions: MemoryStore.listTrash() });
});

router.post('/trash/:id/restore', async (req, res) => {
  try {
    const ok = await MemoryStore.restore(req.params.id);
    if (!ok) return res.status(404).json({ error: 'trashed session not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/trash/:id', (req, res) => {
  MemoryStore.purge(req.params.id);
  res.json({ ok: true });
});

router.get('/:id', (req, res) => {
  const s = MemoryStore.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'session not found' });
  res.json(s);
});

// Append messages to an existing session (used by the chat panel after a turn
// finishes, so the AI reply is persisted). Idempotent merge by message id.
router.put('/:id/messages', (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: '"messages" (non-empty array) is required' });
  }
  try {
    MemoryStore.append(req.params.id, messages);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', (req, res) => {
  const { title } = req.body || {};
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: '"title" (string) is required' });
  }
  const ok = MemoryStore.rename(req.params.id, title.trim());
  if (!ok) return res.status(404).json({ error: 'session not found' });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  MemoryStore.remove(req.params.id);
  res.json({ ok: true });
});

// ── M2b (v0.3.1): 会话检查点 / 回滚 ──
router.post('/:id/checkpoint', (req, res) => {
  try {
    const ok = MemoryStore.checkpoint(req.params.id);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:id/rollback', (req, res) => {
  try {
    const { turn } = req.body || {};
    let result;
    if (Number.isInteger(turn)) {
      result = MemoryStore.rollbackTo(req.params.id, turn);
      if (!result) return res.status(404).json({ error: 'checkpoint not found' });
    } else {
      const messages = MemoryStore.rollback(req.params.id);
      if (!messages) return res.status(404).json({ error: 'no checkpoint available' });
      result = { messages };
    }
    res.json({ ok: true, messages: result.messages || [], savings: result.savings || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 多轮回滚：列出某会话的检查点栈 ──
router.get('/:id/checkpoints', (req, res) => {
  try {
    const list = MemoryStore.listCheckpoints(req.params.id);
    res.json({ checkpoints: list });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Phase 2：回滚前的文件副作用预览（供前端二次确认弹窗列出将还原/删除的文件）
router.get('/:id/rollback-preview', (req, res) => {
  try {
    const seq = parseInt(req.query.seq, 10);
    if (!Number.isFinite(seq)) return res.status(400).json({ error: '"seq" query is required' });
    const files = MemoryStore.getRollbackPreview(req.params.id, seq);
    res.json({ files: files || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── M5 后续增强：追加一轮回合收益到 session.turnMetrics ──
router.post('/:id/turn-metrics', (req, res) => {
  const { metrics } = req.body || {};
  if (!metrics || typeof metrics !== 'object') {
    return res.status(400).json({ error: '"metrics" object is required' });
  }
  try {
    const ok = MemoryStore.appendTurnMetrics(req.params.id, metrics);
    if (!ok) return res.status(404).json({ error: 'session not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
