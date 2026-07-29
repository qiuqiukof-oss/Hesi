/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Finance — data store helpers
//
// Reads/writes data/finance-data.json and provides a small uid()
// generator. Kept separate from the route module so the persistence
// layer can be reused/tested independently.
// ============================================================
const fs = require('fs');
const path = require('path');

// routes/finance/store.js → project-root data/ (two levels up from __dirname)
const DATA_FILE = path.join(__dirname, '..', '..', 'data', 'finance-data.json');

/**
 * Load finance data from JSON file.
 * @returns {{budgets:Array, settlements:Array, suggestions:Array}}
 */
function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return { budgets: [], settlements: [], suggestions: [] }; }
}

/**
 * Save finance data to JSON file.
 * @param {object} data
 */
function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Generate a unique ID.
 * @returns {string}
 */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = { DATA_FILE, loadData, saveData, uid };
