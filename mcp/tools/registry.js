/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Registry Tools — CLI discovery and preset switching
//
// Read-only queries (list_clis, list_presets) are available as
// resources at qcli://clis and qcli://presets.
// Tools: cli_discover, switch_preset
// ============================================================
const { apiGet, apiPost } = require("./http-client");

const toolDefinitions = [
  {
    name: "cli_discover",
    description:
      "Trigger a full CLI auto-discovery scan. " +
      "Scans PATH for installed CLI tools and updates the registry. " +
      "Run this once after installing new CLIs to refresh the available tool list.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "switch_preset",
    description:
      "Switch the active CLI preset configuration. " +
      "Changes which CLIs are available and the welcome page layout.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Preset name (e.g. 'developer', 'sysadmin'). Use list_presets to see available options.",
        },
      },
      required: ["name"],
    },
  },
];

function createHandlers() {
  return {
    cli_discover: async () => {
      const data = await apiPost("/clis/discover", {}, '[Registry Tools]');
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },

    switch_preset: async (args) => {
      const data = await apiPost("/presets/activate", { name: args.name }, '[Registry Tools]');
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    },
  };
}

module.exports = { toolDefinitions, createHandlers };
