/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/**
 * NetForge — Opencode Runtime Plugin
 *
 * Dual-layer plugin:
 * 1. Claude Code manifest (plugin.json) — declares MCP servers, skills, agents
 * 2. Opencode runtime (@opencode-ai/plugin) — system prompt injection + tool interception
 *
 * Install: Add to opencode.json's plugin array, or use `omo plugin install`
 */

import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import { createSystemTransformHook } from "./system-transform.js";
import { createToolBeforeHook, createToolAfterHook } from "./tool-interceptor.js";

export const NetForgePlugin: Plugin = async (
  _input: PluginInput
): Promise<Hooks> => {
  return {
    // ── System prompt injection ─────────────────────────────────
    // Agent-aware: orchestrators get full browser capability section,
    // general workers get lightweight tool availability note,
    // specialists get nothing (no pollution).
    "experimental.chat.system.transform": createSystemTransformHook,

    // ── Tool interception ───────────────────────────────────────
    // Before tool use: route webfetch → browser for render-needed sites
    "tool.execute.before": createToolBeforeHook,

    // After tool use: remind to verify frontend changes visually
    "tool.execute.after": createToolAfterHook,
  };
};

// Also export the hooks individually for composability
export { createSystemTransformHook } from "./system-transform.js";
export { createToolBeforeHook, createToolAfterHook } from "./tool-interceptor.js";
