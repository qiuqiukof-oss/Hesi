// ============================================================
// Skills Registry — singleton holding ingested WorkBuddy
// skills as a native, queryable part of Hesi.
//
// Skills are ingested from the local WorkBuddy connector cache
// (connectors/*/skills/SKILL.md) plus any built-in skills in
// skills/builtin/. Persisted to data/skills/catalog.json so
// they survive restarts and are independently editable.
// ============================================================
const fs = require('fs');
const path = require('path');
const { parseSkillMd, scanConnectorCacheSkills } = require('./loader');
// v0.3.1 M4: reuse the zero-dependency BM25 scorer from lib/memory for
// on-demand skill retrieval. Vector reranking slots in later (M6/M7) via
// the reserved `vec` field on each doc — same pattern as index-store.
const indexStore = require('../lib/memory/index-store');
const embed = require('../lib/memory/embed');

const DATA_DIR = path.join(__dirname, '..', 'data', 'skills');
const CATALOG_PATH = path.join(DATA_DIR, 'catalog.json');
const BUILTIN_DIR = path.join(__dirname, 'builtin');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadCatalog() {
  ensureDir();
  if (!fs.existsSync(CATALOG_PATH)) {
    return { skills: [], ingestedAt: 0 };
  }
  try {
    const d = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf-8'));
    return Array.isArray(d.skills) ? d : { skills: [], ingestedAt: 0 };
  } catch (e) {
    return { skills: [], ingestedAt: 0 };
  }
}

function saveCatalog(catalog) {
  ensureDir();
  fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2), 'utf-8');
}

function ingestFromCache() {
  const skills = scanConnectorCacheSkills();
  const byId = {};
  skills.forEach((s) => { byId[s.id] = s; });
  // Merge built-in skills (override cache with Hesi-native ones if same id)
  if (fs.existsSync(BUILTIN_DIR)) {
    for (const f of fs.readdirSync(BUILTIN_DIR)) {
      if (!f.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(BUILTIN_DIR, f), 'utf-8');
      const s = parseSkillMd(content, path.basename(f, '.md'), '内置');
      s.source = 'builtin';
      byId[s.id] = s;
    }
  }
  const catalog = { skills: Object.values(byId), ingestedAt: Date.now() };
  saveCatalog(catalog);
  return catalog;
}

class SkillRegistry {
  constructor() {
    this._catalog = null;
  }

  _ensure() {
    if (!this._catalog) {
      this._catalog = loadCatalog();
      // Auto-ingest on first use if empty (best-effort; never crash).
      if (!this._catalog.skills || this._catalog.skills.length === 0) {
        try { this._catalog = ingestFromCache(); } catch (e) { /* ignore */ }
      }
    }
    return this._catalog;
  }

  list() {
    return this._ensure().skills;
  }

  get(id) {
    return this._ensure().skills.find((s) => s.id === id) || null;
  }

  getBody(id) {
    const s = this.get(id);
    return s ? s.body : null;
  }

  categories() {
    const set = new Set();
    this.list().forEach((s) => set.add(s.category || '技能'));
    return [...set];
  }

  reingest() {
    this._catalog = ingestFromCache();
    this._searchIndex = null; // invalidate M4 search index
    return this._catalog;
  }

  // v0.3.1 B1：embed 启用时对 BM25 top-10 做余弦重排。
  // index docs carry optional `vec` (set at buildDoc time when embedding enabled)。
  async rerankHits(hits, query, topK) {
    if (!embed.enabled() || !hits.length) return hits.slice(0, topK);
    const qv = await embed.embed(query);
    if (!qv) return hits.slice(0, topK);
    const candidates = hits.slice(0, 10);
    const scored = candidates.map((d) => ({
      doc: d,
      score: d.vec ? embed.cosine(qv, d.vec) : -1,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.doc);
  }

  async search(query, topK = 3) {
    if (!query || typeof query !== 'string') return [];
    const skills = this.list();
    if (!skills.length) return [];
    if (!this._searchIndex || this._searchIndexSize !== skills.length) {
      this._searchIndex = {
        docs: skills.map((s) => indexStore.buildDoc({
          ref: s.id,
          type: 'skill',
          title: `${s.name || s.id} ${s.category || ''}`,
          text: `${s.description || ''}\n${String(s.body || '').slice(0, 200)}`,
        })),
      };
      this._searchIndexSize = skills.length;
    }
    const hits = indexStore.query(this._searchIndex, query, { topK });
    // v0.3.1 B1：embed 启用时对 BM25 top-10 做余弦重排取 topK
    const reranked = await this.rerankHits(hits, query, topK);
    return reranked
      .map((d) => this.get(d.ref))
      .filter(Boolean);
  }

  addSkill(skill) {
    const cat = this._ensure();
    const idx = cat.skills.findIndex((s) => s.id === skill.id);
    if (idx >= 0) cat.skills[idx] = skill;
    else cat.skills.push(skill);
    saveCatalog(cat);
    this._searchIndex = null; // invalidate M4 search index
    return skill;
  }
}

module.exports = new SkillRegistry();
