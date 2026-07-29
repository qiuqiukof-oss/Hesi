/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Stock & Fund Data Route — entry / aggregator
//
// East Money (东方财富) + 天天基金 fetchers with simulated fallback.
// Constants/cache live in ./stocks/constants.js; data sources in
// ./stocks/sources.js; API router in ./stocks/routes.js.
//
// This file only re-exports createRouter to preserve the mount
// contract used by routes/index.js.
// ============================================================
const { createRouter } = require('./stocks/routes');

module.exports = { createRouter };
