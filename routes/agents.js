/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Agent Manager — detect & control AI CLI tools
// ============================================================
const { Router } = require('express');
const { resolveCommand, getVersion } = require('../cli-discovery');
const { findLocalAgentBin, readLocalVersion } = require('./agent-install');

// ── Known AI Agents to scan for ──
const KNOWN_AGENTS = [
  { id: 'opencode',     name: 'opencode',     displayName: 'OpenCode',     icon: '⚡',  category: 'agent', defaultArgs: [] },
  { id: 'ohmyopenagent', name: 'oma',         displayName: 'OhMyOpenAgent', icon: '🤖', category: 'agent', defaultArgs: [] },
  { id: 'codebuff',     name: 'codebuff',     displayName: 'Codebuff',     icon: '🧊',  category: 'agent', defaultArgs: [] },
  { id: 'freebuff',     name: 'freebuff',     displayName: 'Freebuff',     icon: '🧊',  category: 'agent', defaultArgs: [] },
  { id: 'aider',        name: 'aider',        displayName: 'Aider',        icon: '🤖',  category: 'agent', defaultArgs: ['--model', 'sonnet'] },
  { id: 'claude',       name: 'claude',       displayName: 'Claude',       icon: '🟣',  category: 'agent', defaultArgs: [] },
  { id: 'codex',        name: 'codex',        displayName: 'CODEX',        icon: '🔮',  category: 'agent', defaultArgs: [] },
  { id: 'copilot',      name: 'copilot',      displayName: 'Copilot',      icon: '✨',  category: 'agent', defaultArgs: [] },
  { id: 'openhands',    name: 'openhands',    displayName: 'OpenHands',    icon: '🤝',  category: 'agent', defaultArgs: [] },
  { id: 'mentat',       name: 'mentat',       displayName: 'Mentat',       icon: '🧠',  category: 'agent', defaultArgs: [] },
];

/**
 * Scan PATH for installed AI CLI agents.
 * @returns {Promise<Array<{id:string, name:string, displayName:string, icon:string, category:string, defaultArgs:string[], path:string|null, version:string|null, installed:boolean}>>}
 */
async function scanAgents() {
  const results = [];
  for (const agent of KNOWN_AGENTS) {
    const fullPath = resolveCommand(agent.name);
    if (fullPath) {
      let version = 'unknown';
      try { version = await getVersion(fullPath); } catch (e) { console.debug('[Agents] version detection:', e?.message); }
      results.push({ ...agent, path: fullPath, version, installed: true });
    } else {
      // 回退到本地安装目录（U 盘预装 / 一键安装产物，如 ./agents/<id>/bin/<bin>）。
      const localPath = findLocalAgentBin(agent.id);
      if (localPath) {
        const version = readLocalVersion(agent.id) || 'local';
        results.push({ ...agent, path: localPath, version, installed: true });
      } else {
        results.push({ ...agent, path: null, version: null, installed: false });
      }
    }
  }
  return results;
}

/**
 * Create the agents router.
 * @returns {Router}
 */
function createRouter() {
  const router = Router();

  // GET /api/agents — list all known agents
  router.get('/agents', async (req, res) => {
    try {
      const agents = await scanAgents();
      res.json({ agents });
    } catch (err) {
      console.error('[Agents] Scan error:', err.message);
      res.status(500).json({ error: 'Failed to scan agents' });
    }
  });

  return router;
}

module.exports = { createRouter, scanAgents, KNOWN_AGENTS };
