/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Registry Resources — CLI details, preset information
//
// Resource URIs:
//   qcli://clis         -> list all CLIs
//   qcli://clis/{id}    -> single CLI details
//   qcli://presets      -> list all presets
// ============================================================
const { apiGet } = require("../tools/error");
const { markCacheable } = require("./cache");

const resourceDefinitions = [
  {
    uri: "qcli://clis",
    name: "All Discovered CLIs",
    description: "All CLI tools discovered by Hesi with path, version, and category.",
    mimeType: "application/json",
  },
  {
    uri: "qcli://presets",
    name: "CLI Presets",
    description: "All available CLI preset configurations.",
    mimeType: "application/json",
  },
];

const resourceTemplates = [
  {
    uriTemplate: "qcli://clis/{id}",
    name: "Single CLI Details",
    description: "Details for a specific CLI tool by ID.",
    mimeType: "application/json",
  },
];

const routeHandlers = [
  {
    pattern: "qcli://clis",
    handler: async (uri) => {
      const data = await apiGet("/clis", "[Registry]");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    },
  },
  {
    pattern: "qcli://presets",
    handler: async (uri) => {
      const data = await apiGet("/presets", "[Registry]");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    },
  },
  {
    pattern: /^qcli:\/\/clis\/([^/]+)$/,
    handler: async (uri) => {
      const match = uri.match(/^qcli:\/\/clis\/([^/]+)$/);
      const cliId = match[1];
      const all = await apiGet("/clis", "[Registry]");
      const cli = all.clis?.find((c) => c.id === cliId);
      return {
        contents: [{
          uri, mimeType: "application/json",
          text: JSON.stringify(cli || { error: "CLI not found" }, null, 2),
        }],
      };
    },
  },
];

// Register cacheable resources (TTL: 5 minutes for registry data)
markCacheable("qcli://clis", 300_000);
markCacheable("qcli://presets", 300_000);

// clis/{id} is a template — individual items are derived from the same cached API call
// so they naturally benefit from the clis cache; no extra markCacheable needed.

module.exports = { resourceDefinitions, resourceTemplates, routeHandlers };
