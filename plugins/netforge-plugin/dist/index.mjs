/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

/**
 * NetForge — Opencode Runtime Plugin (pre-compiled)
 *
 * Install: add to opencode.json's plugin array:
 *   "plugin": ["oh-my-openagent@latest", "./path/to/netforge-plugin/dist/index.mjs"]
 *
 * Or via npm: `omo plugin install path/to/netforge-plugin`
 */

import { createSystemTransformHook } from "./system-transform.mjs";
import { createToolBeforeHook, createToolAfterHook } from "./tool-interceptor.mjs";

/** @type {import("@opencode-ai/plugin").Plugin} */
export const NetForgePlugin = async (_input) => {
  return {
    "experimental.chat.system.transform": createSystemTransformHook,
    "tool.execute.before": createToolBeforeHook,
    "tool.execute.after": createToolAfterHook,
  };
};

export default NetForgePlugin;
export { createSystemTransformHook } from "./system-transform.mjs";
export { createToolBeforeHook, createToolAfterHook } from "./tool-interceptor.mjs";
