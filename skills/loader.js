/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Skill Loader — parse WorkBuddy SKILL.md into a normalized
// skill record. Also scans the local connector cache for
// bundled SKILL.md files so Hesi can ingest them natively.
//
// SKILL.md format (observed in WorkBuddy connector cache):
//   ---
//   name: agentkey
//   description_zh: ...
//   description_en: "..."   (values may be quoted)
//   version: "1.11.0"
//   author: "Chainbase Labs"
//   ---
//   # AgentKey
//   ... body (instructions) ...
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const WB_CACHE = path.join(os.homedir(), '.workbuddy', 'connectors-marketplace', 'connectors');
// Vendored connector-bundled skills live INSIDE the Hesi project tree
// (vendor/connectors/<id>/skills/), so they are available without WorkBuddy.
const VENDOR_CONNECTORS = path.join(__dirname, '..', 'vendor', 'connectors');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'bin', '.git', '__pycache__']);

// Minimal frontmatter parser — handles `key: value` with optional
// double/single quotes and a single leading `- ` list item.
function parseFrontmatter(raw) {
  const meta = {};
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return meta;
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) meta[key] = val;
  }
  return meta;
}

function parseSkillMd(content, fallbackId, fallbackCategory) {
  const meta = parseFrontmatter(content);
  const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
  const id = (meta.name || fallbackId || 'skill').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const description = meta.description_zh || meta.description || meta.description_en || '';
  return {
    id,
    name: meta.name || fallbackId || id,
    description,
    descriptionEn: meta.description_en || meta.description || '',
    version: meta.version || '',
    author: meta.author || '',
    category: fallbackCategory || '技能',
    body,
    source: 'workbuddy-cache',
  };
}

// Scan vendored + WB-cached connectors for bundled SKILL.md files.
// Vendor wins on skill-id collision so the in-project copy is authoritative.
function scanConnectorCacheSkills() {
  const out = [];
  const seen = new Set();
  const bases = [VENDOR_CONNECTORS, WB_CACHE].filter((b) => fs.existsSync(b));
  for (const base of bases) {
    let dirs = [];
    try { dirs = fs.readdirSync(base); } catch (e) { continue; }
    for (const dir of dirs) {
      const skillsDir = path.join(base, dir, 'skills');
      if (!fs.existsSync(skillsDir)) continue;
      // connector category (for grouping)
      let category = dir;
      const metaPath = path.join(base, dir, 'connector-meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          category = meta.category || dir;
        } catch (e) { /* ignore */ }
      }
      // Recursively collect every .md under skills/ (vendored connectors may
      // nest skills in sub-directories, e.g. feishu/lark-*/ or notion/.../reference/).
      const mdFiles = [];
      (function walk(d, depth) {
        if (depth > 6) return;
        let entries;
        try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
        for (const e of entries) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, depth + 1); }
          else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) mdFiles.push(p);
        }
      })(skillsDir, 0);
      for (const fpath of mdFiles) {
        const content = fs.readFileSync(fpath, 'utf-8');
        const rel = path.relative(skillsDir, fpath).replace(/\\/g, '/').replace(/\.md$/i, '');
        const skill = parseSkillMd(content, `${dir}-${rel}`, category);
        if (seen.has(skill.id)) continue; // vendor wins
        seen.add(skill.id);
        skill.connectorId = dir;
        out.push(skill);
      }
    }
  }
  return out;
}

module.exports = { parseFrontmatter, parseSkillMd, scanConnectorCacheSkills };
