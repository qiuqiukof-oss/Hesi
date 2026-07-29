/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// System Resources — health monitoring
//
// Resource URIs:
//   qcli://health               -> system health
// ============================================================
const { apiGet } = require("../tools/error");
const { markNoCache } = require("./cache");

const resourceDefinitions = [
  {
    uri: "qcli://health",
    name: "System Health",
    description: "Hesi runtime health: version, uptime, memory, WebSocket status.",
    mimeType: "application/json",
  },
];

const routeHandlers = [
  {
    pattern: "qcli://health",
    handler: async (uri) => {
      const data = await apiGet("/health", "[Workspace]");
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
      };
    },
  },
];

// Health is dynamic — never cache
markNoCache("qcli://health");

module.exports = { resourceDefinitions, routeHandlers };
