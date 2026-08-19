/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';
// Generated at package time. Loads the original hotel-query.js from the adjacent gzip file.
const fs = require('fs');
const zlib = require('zlib');
const source = zlib.gunzipSync(fs.readFileSync(__filename + '.gz')).toString('utf8');
module._compile(source, __filename);
