/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Resource Registry — aggregates all resource definitions
// and creates a URI routing dispatcher with versioned caching
// ============================================================

const registryResources = require("./registry");
const sessionResources = require("./session");
const workspaceResources = require("./workspace");

// All static resource definitions (for ListResourcesRequestSchema)
const allResourceDefinitions = [].concat(
  registryResources.resourceDefinitions || [],
  sessionResources.resourceDefinitions || [],
  workspaceResources.resourceDefinitions || []
);

// All resource template definitions (for ListResourceTemplatesRequestSchema)
const allResourceTemplates = [].concat(
  registryResources.resourceTemplates || [],
  sessionResources.resourceTemplates || [],
  workspaceResources.resourceTemplates || []
);

// URI route handlers: [{ pattern: string|RegExp, handler: (uri) => result }]
const uriRoutes = [].concat(
  registryResources.routeHandlers || [],
  sessionResources.routeHandlers || [],
  workspaceResources.routeHandlers || []
);

// ── Versioned Resource Cache (imported from cache.js to avoid circular deps) ──
const { markCacheable, markNoCache, withCache, splitQuery } = require("./cache");

/**
 * Find handler for a URI. Pattern matching:
 *  - Exact string match
 *  - String with * → glob-style (each * matches one path segment)
 *  - RegExp → regex match
 * Returns a function that invokes the handler with optional caching.
 */
function matchHandler(uri) {
  const [baseUri] = splitQuery(uri);

  for (const { pattern, handler } of uriRoutes) {
    const matches = typeof pattern === "string" && !pattern.includes("*")
      ? baseUri === pattern
      : typeof pattern === "string" && pattern.includes("*")
        ? new RegExp(`^${  pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]+")  }$`).test(baseUri)
        : pattern instanceof RegExp
          ? pattern.test(uri)
          : false;

    if (matches) {
      return () => withCache(uri, (u) => handler(u));
    }
  }
  return null;
}

module.exports = {
  allResourceDefinitions,
  allResourceTemplates,
  matchHandler,
  markCacheable,
  markNoCache,
};
