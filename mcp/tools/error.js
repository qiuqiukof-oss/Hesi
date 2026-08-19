/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// Error Utilities — re-exported from shared http-client
// ============================================================
// All HTTP client code has been consolidated into ./http-client
const { tryParseError, apiGet } = require('./http-client');
module.exports = { tryParseError, apiGet };
