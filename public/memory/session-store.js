/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Memory Session Store — frontend singleton
// ============================================================
// Bridges the chat panel to the server-backed memory subsystem
// (/api/memory/*). Replaces the old single localStorage['qcli-chat-history']
// with multi-session, server-persisted conversations.
//
// Degrades gracefully: if /api/memory/health reports disabled (MEMORY_ENABLED
// = false), `enabled` stays false and the chat panel falls back to the legacy
// localStorage path — zero behavior change for users who opt out.
// ============================================================
'use strict';

/** @typedef {import('../types').QCLI} QCLI */
import { safeStorage } from '../lib/storage.js';

const CURRENT_KEY = 'hesi-memory-current-session';

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI || {});

const MemorySession = {
  /** @type {boolean} whether the memory subsystem is enabled server-side */
  enabled: false,
  /** @type {boolean} whether init() has completed at least once */
  ready: false,
  /** @type {string} last health-probe error (empty = ok). Used for diagnostics. */
  healthError: '',
  /** @type {boolean} whether we have probed /api/memory/health at least once */
  _healthChecked: false,
  /** @type {boolean} whether _activate() has run (migration + initial load) */
  _activated: false,
  /** @type {Promise|null} in-flight init() promise (for idempotency) */
  _initPromise: null,
  /** @type {string} currently active session id */
  currentId: safeStorage.get(CURRENT_KEY, '') || '',
  /** @type {Array} cached session list */
  sessions: [],
  _sessionChangeCbs: [],
  _listChangeCbs: [],
  _factsChangeCbs: [],
  _readyCbs: [],

  // ── event subscription ──
  onSessionChange(cb) {
    this._sessionChangeCbs.push(cb);
    // Late-subscriber replay: if init() has already completed (enabled) and we
    // have a current session, fire immediately. This fixes a refresh race where
    // other components (session list, memory panel) call init() and trigger the
    // initial sessionChange BEFORE <chat-panel> mounts/subscribes — without this
    // the chat panel would permanently miss the current conversation and render
    // empty after a reload, even though the data is safely on disk.
    if (this.ready && this.enabled && this.currentId) {
      this.loadMessages(this.currentId)
        .then((msgs) => { try { cb(this.currentId, msgs); } catch (e) { /* ignore */ } })
        .catch(() => {});
    }
    return () => { this._sessionChangeCbs = this._sessionChangeCbs.filter((f) => f !== cb); };
  },
  onListChange(cb) {
    this._listChangeCbs.push(cb);
    return () => { this._listChangeCbs = this._listChangeCbs.filter((f) => f !== cb); };
  },
  onFactsChange(cb) {
    this._factsChangeCbs.push(cb);
    return () => { this._factsChangeCbs = this._factsChangeCbs.filter((f) => f !== cb); };
  },
  _fireSessionChange(id, msgs) {
    for (const cb of this._sessionChangeCbs) {
      try { cb(id, msgs); } catch (e) { console.warn('[MemorySession] sessionChange cb error:', e?.message); }
    }
  },
  _fireListChange() {
    for (const cb of this._listChangeCbs) {
      try { cb(this.sessions, this.currentId); } catch (e) { console.warn('[MemorySession] listChange cb error:', e?.message); }
    }
  },
  _fireFactsChange() {
    for (const cb of this._factsChangeCbs) {
      try { cb(); } catch (e) { /* ignore */ }
    }
  },
  // ── ready: fires once init() settles (enabled or not). Lets late-mounted
  //    UI (e.g. the session list) show itself without depending on event order.
  onReady(cb) {
    this._readyCbs.push(cb);
    if (this.ready) {
      try { cb({ enabled: this.enabled, error: this.healthError }); } catch (e) { /* ignore */ }
    }
    return () => { this._readyCbs = this._readyCbs.filter((f) => f !== cb); };
  },
  _fireReady() {
    const st = { enabled: this.enabled, error: this.healthError };
    for (const cb of this._readyCbs) {
      try { cb(st); } catch (e) { console.warn('[MemorySession] ready cb error:', e && e.message); }
    }
  },

  // ── probe: read the server-side enabled flag via /api/memory/health ──
  async _probeHealth() {
    try {
      const h = await fetch('/api/memory/health');
      if (!h.ok) throw new Error('health HTTP ' + h.status);
      const d = await h.json().catch(() => ({}));
      this.enabled = !!d.enabled;
      this.healthError = '';
    } catch (e) {
      // Network error / 404 (e.g. a stale server without the memory
      // routes) — record the reason but DON'T silently claim "disabled".
      this.enabled = false;
      this.healthError = (e && e.message) || 'unknown';
    }
    this._healthChecked = true;
  },

  // ── activate: migration + restore current session + list (runs once) ──
  async _activate() {
    if (this._activated) return;
    this._activated = true;

    // First-run migration: lift the old single localStorage chat history
    // into the memory subsystem as the first session (idempotent via a marker).
    if (!this.currentId) {
      try {
        const migrated = safeStorage.get('hesi-memory-migrated', '');
        const legacy = safeStorage.getJSON('qcli-chat-history');
        if (!migrated && Array.isArray(legacy) && legacy.length) {
          const r = await fetch('/api/memory/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: legacy }),
          });
          if (r.ok) {
            const d = await r.json();
            this.currentId = d.id;
            safeStorage.set(CURRENT_KEY, d.id);
          }
        }
      } catch (e) {
        console.warn('[MemorySession] legacy migration skipped:', e && e.message);
      } finally {
        safeStorage.set('hesi-memory-migrated', '1');
      }
    }

    // Validate currentId against the server-side list. If it points at a
    // session that no longer exists (deleted, or its file was lost), fall back
    // to the first real session — otherwise the panel renders empty after a
    // refresh and looks like everything vanished.
    await this.refreshList();
    if (this.currentId && !this.sessions.some((s) => s.id === this.currentId)) {
      const first = this.sessions[0];
      this.currentId = first ? first.id : '';
      if (this.currentId) safeStorage.set(CURRENT_KEY, this.currentId);
      else safeStorage.remove(CURRENT_KEY);
    }

    if (this.currentId) {
      try {
        const msgs = await this.loadMessages(this.currentId);
        this._fireSessionChange(this.currentId, msgs);
      } catch (e) {
        // current session vanished server-side — start fresh
        this.currentId = '';
        safeStorage.remove(CURRENT_KEY);
      }
    }
  },

  // ── init: probe health + activate if enabled ──
  // Idempotent & self-healing: safe to call from multiple places (chat panel,
  // session list). If the backend isn't ready at page load (health 404/timeout
  // because it just restarted), it retries a few times so the session list
  // appears on its own — no need to click 🧠.
  init() {
    if (this.ready) { this._fireReady(); return Promise.resolve(); }
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._initCore();
    return this._initPromise;
  },
  async _initCore() {
    await this._probeHealth();
    if (!this.enabled) {
      // Backend may still be booting — retry up to 3× (1.2s apart).
      for (let i = 0; i < 3 && !this.enabled; i++) {
        await new Promise((r) => setTimeout(r, 1200));
        await this._probeHealth();
      }
    }
    if (this.enabled) await this._activate();
    this.ready = true;
    this._fireReady();
  },

  // ── ensureEnabled: re-probe on demand (drawer open) so a restarted
  //    backend self-heals without a page reload. Returns { enabled, error }.
  async ensureEnabled() {
    const wasEnabled = this.enabled;
    await this._probeHealth();
    if (this.enabled && !wasEnabled) await this._activate();
    this._fireReady();
    return { enabled: this.enabled, error: this.healthError };
  },

  // ── list / refresh ──
  async list(q) {
    const url = '/api/memory/sessions' + (q ? '?q=' + encodeURIComponent(q) : '');
    try {
      const r = await fetch(url);
      if (!r.ok) return [];
      const d = await r.json();
      return d.sessions || [];
    } catch (e) { return []; }
  },
  async refreshList() {
    this.sessions = await this.list('');
    this._fireListChange();
    return this.sessions;
  },

  // ── create / ensure ──
  async create(title) {
    const r = await fetch('/api/memory/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title || '新会话' }),
    });
    if (!r.ok) throw new Error('create session failed: ' + r.status);
    const d = await r.json();
    this.currentId = d.id;
    safeStorage.set(CURRENT_KEY, d.id);
    await this.refreshList();
    this._fireSessionChange(d.id, []);
    return d.id;
  },
  // Ensure a current session exists; create one (titled) if not.
  async ensureCurrent(meta) {
    if (this.currentId) return this.currentId;
    return this.create(meta && meta.title ? meta.title : '新会话');
  },

  // ── load / switch ──
  async loadMessages(id) {
    const r = await fetch('/api/memory/sessions/' + encodeURIComponent(id));
    if (!r.ok) return [];
    const d = await r.json();
    return d.messages || [];
  },
  async switch(id) {
    this.currentId = id;
    safeStorage.set(CURRENT_KEY, id);
    const msgs = await this.loadMessages(id).catch(() => []);
    await this.refreshList();
    this._fireSessionChange(id, msgs);
    return msgs;
  },

  // Append messages to an existing session. Called by the chat panel AFTER a
  // turn completes, so the AI reply is persisted too — the chat route only
  // stores the user side (request messages) before streaming begins. Server
  // merges by stable message id, so repeated calls are idempotent.
  async append(id, messages) {
    if (!id || !Array.isArray(messages) || !messages.length) return;
    try {
      await fetch('/api/memory/sessions/' + encodeURIComponent(id) + '/messages', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages.map((m) => ({ id: m.id, role: m.role, content: m.content })),
        }),
      });
    } catch (e) { /* best-effort persistence */ }
  },

  // M5 后续增强：追加一轮回合收益到 session.turnMetrics（持久化收益条/图标，单一数据源）。
  async recordTurnMetrics(id, metrics) {
    if (!id || !metrics || typeof metrics !== 'object') return;
    try {
      await fetch('/api/memory/sessions/' + encodeURIComponent(id) + '/turn-metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ metrics }),
      });
    } catch (e) { /* best-effort persistence */ }
  },

  // ── rename / remove ──
  async rename(id, title) {
    const r = await fetch('/api/memory/sessions/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!r.ok) throw new Error('rename failed: ' + r.status);
    const s = this.sessions.find((x) => x.id === id);
    if (s) s.title = title;
    this._fireListChange();
    return true;
  },
  async remove(id) {
    // Soft-delete: the backend moves the session into the recycle bin, so it
    // stays recoverable. The local list drops it from the active view.
    const r = await fetch('/api/memory/sessions/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) throw new Error('delete failed: ' + r.status);
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.currentId === id) {
      this.currentId = '';
      safeStorage.remove(CURRENT_KEY);
      // start a fresh session so the chat panel has somewhere to write
      await this.create();
    } else {
      this._fireListChange();
    }
    return true;
  },

  // ── recycle bin ──
  async listTrash() {
    const r = await fetch('/api/memory/sessions/trash');
    if (!r.ok) return [];
    const d = await r.json();
    return d.sessions || [];
  },
  async restore(id) {
    const r = await fetch('/api/memory/sessions/trash/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
    if (!r.ok) throw new Error('restore failed: ' + r.status);
    // The restored session becomes a candidate for the active view.
    await this.refreshList();
    return true;
  },
  async purge(id) {
    const r = await fetch('/api/memory/sessions/trash/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) throw new Error('purge failed: ' + r.status);
    return true;
  },

  // ── facts / recall (Layer A) ──
  async getFacts() {
    const r = await fetch('/api/memory/facts');
    if (!r.ok) return { facts: [], profile: '' };
    return r.json();
  },
  async forgetFact(id) {
    const r = await fetch('/api/memory/facts/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) throw new Error('forget failed: ' + r.status);
    this._fireFactsChange();
    return true;
  },
  async recall(query, topK) {
    const r = await fetch('/api/memory/recall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, topK }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.block || null;
  },
};

Q.MemorySession = MemorySession;
export default MemorySession;
