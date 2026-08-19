/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

'use strict';
// Tray icons are now pre-built from the chosen "Modern SaaS rounded-square"
// (D) candidate and committed to the repo:
//   - tray/icon.png   (64x64, transparent bg)  ← used by tray/tray.js
//   - tray/icon.ico   (32+48+64, transparent bg)
//   - public/app-icon.png (256x256, for desktop/about)
//
// Regeneration is done via `.workbuddy/gen-icons-d.py` (Python + Pillow),
// which chroma-keys the light background off the generated candidate and
// exports the multi-size PNG/ICO. This script intentionally does NOT
// regenerate the old flat teal placeholder, so it can't clobber the real icon.
//
// It only guards: if the committed icons are somehow missing, it warns.

const fs = require('fs');
const path = require('path');

const out = __dirname;
const png = path.join(out, 'icon.png');
const ico = path.join(out, 'icon.ico');

if (fs.existsSync(png) && fs.existsSync(ico)) {
  console.log('[make-icon] tray icons already present (D design). Nothing to do.');
  process.exit(0);
}

console.error('[make-icon] ERROR: tray/icon.png or tray/icon.ico missing.');
console.error('[make-icon] Re-run `.workbuddy/gen-icons-d.py` to regenerate from the D candidate.');
process.exit(1);
