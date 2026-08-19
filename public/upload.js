/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Upload Module — file upload & media preview
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/** @type {{mediaState: {files:Array,currentIndex:number,open:boolean},openMediaPreview:null|Function,closeMediaPreview:null|Function,navigateMedia:null|Function,handleMediaClick:null|Function,formatFileSize:null|Function}} */
export const Upload = {
  mediaState: { files: [], currentIndex: 0, open: false },
  openMediaPreview: null,
  closeMediaPreview: null,
  navigateMedia: null,
  handleMediaClick: null,
  formatFileSize: null,
};

// Legacy compat
Q.Upload = Upload;
