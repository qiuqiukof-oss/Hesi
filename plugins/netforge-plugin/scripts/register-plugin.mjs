#!/usr/bin/env node

/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */
/**
 * NetForge — Post-installation registration
 *
 * Registers the plugin in ~/.claude/plugins/installed_plugins.json
 * so Hesi can discover it on next start.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, "..");
const PLUGINS_HOME = join(homedir(), ".claude", "plugins");
const DB_PATH = join(PLUGINS_HOME, "installed_plugins.json");

const PLUGIN_NAME = "netforge";
const MARKETPLACE = "local";

/**
 * Register this plugin in the installed plugins database.
 * Uses the v3 format (flat array), matching Claude Code's current format.
 */
function register() {
  // Ensure plugins directory exists
  if (!existsSync(PLUGINS_HOME)) {
    mkdirSync(PLUGINS_HOME, { recursive: true });
  }

  // Read or create database
  let db = [];
  if (existsSync(DB_PATH)) {
    try {
      const raw = readFileSync(DB_PATH, "utf-8");
      db = JSON.parse(raw);
      // Normalize: v3 is flat array, v1/v2 are objects
      if (!Array.isArray(db)) {
        db = [];
      }
    } catch {
      db = [];
    }
  }

  // Remove existing entry for this plugin (re-register)
  const filtered = (db || []).filter(
    (entry) => !(entry.name === PLUGIN_NAME && entry.marketplace === MARKETPLACE)
  );

  // Add new entry
  filtered.push({
    name: PLUGIN_NAME,
    marketplace: MARKETPLACE,
    scope: "user",
    version: "0.1.0",
    installPath: PLUGIN_ROOT,
    lastUpdated: new Date().toISOString(),
  });

  writeFileSync(DB_PATH, JSON.stringify(filtered, null, 2), "utf-8");
  console.log(`[NetForge] ✅ Registered plugin "${PLUGIN_NAME}@${MARKETPLACE}" in ${DB_PATH}`);
  console.log(`[NetForge]    Install path: ${PLUGIN_ROOT}`);
}

register();
