/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// Layer A — automatic user profile (facts + profile.md).
// After each compaction / session close, the session text is sent to the LLM to
// extract durable facts. Facts are de-duplicated (confidence accumulates),
// aged out when forgotten, and distilled into a human-readable profile.md.
// Degrades gracefully: no LLM → no facts (chat is unaffected).
'use strict';

const crypto = require('crypto');
const config = require('./config');
const session = require('./session');
const storage = require('./storage');
const schema = require('./schema');
const llm = require('./llm-bridge');

const AGEOUT_MS = 30 * 24 * 3600 * 1000; // 30 days

function readFacts() {
  return storage.readJSON(config.FACTS_FILE, []);
}

function writeFacts(facts) {
  storage.writeJSON(config.FACTS_FILE, facts);
}

function normalizeFact(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

// Merge new facts into facts.json: de-dup by normalized text, accumulate
// confidence, refresh lastSeen; age out low-confidence stale facts.
function upsertFacts(items) {
  const facts = readFacts();
  const byNorm = new Map();
  for (const f of facts) byNorm.set(normalizeFact(f.fact).toLowerCase(), f);
  let added = 0;
  for (const it of items) {
    const norm = normalizeFact(it.fact).toLowerCase();
    if (!norm) continue;
    const existing = byNorm.get(norm);
    if (existing) {
      // Confidence accumulates across mentions (acts as a strength weight used
      // for sorting/recall); it is intentionally unbounded above 1 so frequently
      // repeated facts float to the top of the profile.
      existing.confidence = (existing.confidence || 0.5) + 0.1;
      existing.lastSeen = Date.now();
      if (it.source) existing.source = it.source;
    } else {
      const fact = {
        id: `f_${  Date.now().toString(36)  }_${  crypto.randomBytes(4).toString('hex')}`,
        fact: normalizeFact(it.fact),
        source: it.source || '',
        confidence: 1,
        createdAt: Date.now(),
        lastSeen: Date.now(),
      };
      facts.push(fact);
      byNorm.set(norm, fact);
      added++;
    }
  }
  const now = Date.now();
  const pruned = facts.filter((f) => (f.confidence || 0) >= 0.3 || now - (f.lastSeen || 0) < AGEOUT_MS);
  writeFacts(pruned);
  return added;
}

// Regenerate profile.md from facts when we have enough signal.
function maybeRegenerateProfile() {
  const facts = readFacts();
  if (facts.length < config.PROFILE_MIN_FACTS) return false;
  const lines = facts
    .slice()
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .map((f) => `- ${f.fact}`)
    .join('\n');
  const md = `# 用户画像（自动生成，请勿手改）\n${lines}\n`;
  storage.writeFileAtomic(config.PROFILE_FILE, md);
  return true;
}

// Extract facts from a session and persist them. Called async after a chat
// turn (fire-and-forget). Returns a summary; never throws.
async function extractFacts(sessionId, opts = {}) {
  if (!config.MEMORY_ENABLED) return { skipped: true };
  try {
    const s = session.load(sessionId);
    if (!s) return { skipped: true };
    const text = [
      s.summary || '',
      ...(s.messages || []).filter((m) => m.role !== 'tool').map((m) => `[${m.role}] ${m.content || ''}`),
    ].join('\n');
    if (!text.trim()) return { skipped: true, reason: 'empty' };
    const facts = await llm.extractFacts(text, opts);
    if (!facts.length) return { skipped: true, reason: 'no-facts' };
    const added = upsertFacts(facts.map((f) => ({ fact: f, source: sessionId })));
    const regenerated = maybeRegenerateProfile();
    return { extracted: facts.length, added, regenerated };
  } catch (e) {
    return { skipped: true, reason: 'error', error: e.message };
  }
}

function getFacts() {
  return readFacts();
}

function removeFact(id) {
  const facts = readFacts();
  const next = facts.filter((f) => f.id !== id);
  writeFacts(next);
  return facts.length - next.length;
}

function getProfile() {
  return storage.readFile(config.PROFILE_FILE, '');
}

module.exports = { extractFacts, getFacts, removeFact, getProfile, upsertFacts, maybeRegenerateProfile };
