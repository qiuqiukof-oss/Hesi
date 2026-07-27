// @ts-check
// Agnes config endpoint — stores/reads the API key + base URL on the Hesi
// backend (NOT in the browser). The proxy reads this to inject the key.
'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_DATA = path.join(__dirname, '..', '..', '..', 'data', 'plugin-data', 'agnes-ai');
const CONFIG_FILE = path.join(PLUGIN_DATA, 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return {};
}

function saveConfig(cfg) {
  try {
    if (!fs.existsSync(PLUGIN_DATA)) fs.mkdirSync(PLUGIN_DATA, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (e) { /* ignore */ }
}

function maskKey(key) {
  if (!key || key.length < 8) return key || '';
  return `${key.slice(0, 4)  }…${  key.slice(-4)}`;
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
module.exports = function config(req, res) {
  if (req.method === 'GET') {
    const cfg = loadConfig();
    return res.json({
      configured: !!cfg.apiKey,
      apiKeyMasked: maskKey(cfg.apiKey),
      apiBaseUrl: cfg.apiBaseUrl || 'https://apihub.agnes-ai.com/v1',
    });
  }

  if (req.method === 'POST') {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const cfg = loadConfig();
    // Only overwrite the key when a non-empty value is supplied; an empty field
    // means "keep the existing key" (so users can change base URL without re-entering).
    if (typeof body.apiKey === 'string' && body.apiKey.trim() !== '') {
      cfg.apiKey = body.apiKey.trim();
    }
    if (typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim() !== '') {
      cfg.apiBaseUrl = body.apiBaseUrl.trim();
    }
    saveConfig(cfg);
    return res.json({ ok: true, configured: !!cfg.apiKey });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
