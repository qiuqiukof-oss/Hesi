/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Session Resources — real-time session output and state
//
// Resource URIs:
//   qcli://session/{id}/output -> current output buffer
//   qcli://session/{id}/state  -> session metadata
// ============================================================
const { sessionManager } = require("../session-manager");
const { markNoCache } = require("./cache");

const resourceTemplates = [
  {
    uriTemplate: "qcli://session/{id}/output",
    name: "Session Output",
    description: "Current terminal output buffer for a session (tail 200 lines). Supports ?mode=delta&cursor=n for incremental reads.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "qcli://session/{id}/state",
    name: "Session State",
    description: "Session metadata including state, age, idle time, and CLI.",
    mimeType: "application/json",
  },
];

const routeHandlers = [
  {
    pattern: /^qcli:\/\/session\/([^/]+)\/output/,
    handler: async (uri) => {
      const match = uri.match(/^qcli:\/\/session\/([^/]+)\/output/);
      const sessionId = match[1];
      const session = sessionManager.get(sessionId);
      if (!session) {
        return {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: "Session not found or expired" }) }],
          isError: true,
        };
      }

      // Parse query parameters from URI
      const qIndex = uri.indexOf("?");
      const params = new URLSearchParams(qIndex >= 0 ? uri.slice(qIndex + 1) : "");
      const mode = params.get("mode") || "tail";

      if (mode === "delta") {
        const cursor = params.has("cursor") ? parseInt(params.get("cursor"), 10) : undefined;
        const stripAnsi = params.get("stripAnsi") === "true";
        const result = await session.read({ mode: "delta", cursor, stripAnsi });
        return {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ sessionId, ...result }) }],
        };
      }

      const tailLines = params.has("tailLines") ? parseInt(params.get("tailLines"), 10) : 200;
      const output = session.read({ mode: "tail", tailLines });
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ sessionId, output }) }],
      };
    },
  },
  {
    pattern: /^qcli:\/\/session\/([^/]+)\/state$/,
    handler: async (uri) => {
      const match = uri.match(/^qcli:\/\/session\/([^/]+)\/state$/);
      const sessionId = match[1];
      const session = sessionManager.get(sessionId);
      if (!session) {
        return {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify({ error: "Session not found or expired" }) }],
          isError: true,
        };
      }
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(session.toJSON(), null, 2) }],
      };
    },
  },
];

// Session resources are dynamic — never cache
markNoCache("qcli://session/{id}/output");
markNoCache("qcli://session/{id}/state");

module.exports = { resourceTemplates, routeHandlers };
