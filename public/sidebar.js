/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Hesi Sidebar Module — CLI list & folder rendering
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

/**
 * @typedef {Object} SidebarAPI
 * @property {null|Function} renderCLIList
 * @property {null|Function} renderFolder
 * @property {null|Function} createCLIElement
 * @property {null|Function} findFolderForCLI
 * @property {null|Function} moveCLIToFolder
 * @property {null|Function} removeCLIFromAllFolders
 * @property {null|Function} finishRename
 * @property {null|Function} updateCLIState
 * @property {null|Function} getCLIIcon
 * @property {null|Function} updateCategoryCounts
 * @property {null|Function} filterCLIs
 * @property {null|Function} createFolder
 * @property {null|Function} updateFolderOnServer
 * @property {null|Function} deleteFolderOnServer
 * @property {null|Function} deleteCLI
 * @property {null|Function} launchCLI
 * @property {null|Function} discoverCLIs
 */

/** @type {SidebarAPI} */
export const Sidebar = {
  // Will be populated from app.js
  renderCLIList: null,
  renderFolder: null,
  createCLIElement: null,
  findFolderForCLI: null,
  moveCLIToFolder: null,
  removeCLIFromAllFolders: null,
  finishRename: null,
  updateCLIState: null,
  getCLIIcon: null,
  updateCategoryCounts: null,
  filterCLIs: null,
  createFolder: null,
  updateFolderOnServer: null,
  deleteFolderOnServer: null,
  deleteCLI: null,
  launchCLI: null,
  discoverCLIs: null,
};

// Legacy compat
Q.Sidebar = Sidebar;
