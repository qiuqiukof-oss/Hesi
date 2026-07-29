/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// search-bar — Terminal search via xterm SearchAddon
//
// Extracted from app.js: DOM lookups, search functions, and
// event wiring for the terminal search bar.
// Auto-patches QCLI namespace + wires events at import time.
// ============================================================
'use strict';

/**
 * @returns {QCLINamespace}
 */
function Q() { return /** @type {QCLINamespace} */(window).QCLI || /** @type {QCLINamespace} */({}); }

// ── DOM lookups ──
/** @type {HTMLElement|null} */
const $searchBar = document.getElementById('terminal-search-bar');
/** @type {HTMLInputElement|null} */
const $searchInput = /** @type {HTMLInputElement|null} */(document.getElementById('terminal-search-input'));
/** @type {HTMLElement|null} */
const $searchResults = document.getElementById('terminal-search-results');
/** @type {HTMLElement|null} */
const $searchPrev = document.getElementById('terminal-search-prev');
/** @type {HTMLElement|null} */
const $searchNext = document.getElementById('terminal-search-next');
/** @type {HTMLElement|null} */
const $searchClose = document.getElementById('terminal-search-close');

// ── Helpers ──
/**
 * @returns {import('./ws-manager').XtermTerminal|null}
 */
function activeTerm() {
  const q = Q();
  const tabs = q.Tabs;
  return tabs ? /** @type {any} */(tabs).term : null;
}

// ============================================================
// API
// ============================================================

/** @returns {boolean} */
export function searchBarVisible() {
  return !!($searchBar && !$searchBar.classList.contains('hidden'));
}

/** @returns {void} */
export function toggleSearchBar() {
  if (searchBarVisible()) {
    hideSearchBar();
  } else {
    showSearchBar();
  }
}

/** @returns {void} */
export function showSearchBar() {
  if (!$searchBar) return;
  $searchBar.classList.remove('hidden');
  if ($searchInput) $searchInput.value = '';
  if ($searchResults) $searchResults.textContent = '0/0';
  if ($searchInput) $searchInput.focus();
}

/** @returns {void} */
export function hideSearchBar() {
  if (!$searchBar) return;
  $searchBar.classList.add('hidden');
  const q = Q();
  if (q.searchAddon) {
    q.searchAddon.clearActiveSearch();
  }
  const term = activeTerm();
  if (term && typeof term.focus === 'function') term.focus();
}

/** @returns {void} */
export function performSearch() {
  if (!$searchInput || !$searchResults) return;
  const query = $searchInput.value.trim();
  const q = Q();
  const addon = q.searchAddon;
  if (!addon || !query) {
    $searchResults.textContent = '';
    return;
  }
  addon.clearActiveSearch();
  const found = addon.findNext(query, { incremental: false });
  $searchResults.textContent = found ? '\uD83D\uDD0D 1+' : '\u2717';
}

/** @returns {void} */
export function findNext() {
  if (!$searchInput) return;
  const query = $searchInput.value.trim();
  const q = Q();
  const addon = q.searchAddon;
  if (!addon || !query) return;
  addon.findNext(query, { incremental: true });
}

/** @returns {void} */
export function findPrevious() {
  if (!$searchInput) return;
  const query = $searchInput.value.trim();
  const q = Q();
  const addon = q.searchAddon;
  if (!addon || !query) return;
  addon.findPrevious(query, { incremental: true });
}

// ============================================================
// Auto-init — patch QCLI + wire events
// ============================================================
Promise.resolve().then(() => {
  const q = Q();

  // Patch QCLI namespace
  q.searchBarVisible = searchBarVisible;
  q.toggleSearchBar = toggleSearchBar;
  q.showSearchBar = showSearchBar;
  q.hideSearchBar = hideSearchBar;
  q.performSearch = performSearch;
  q.findNext = findNext;
  q.findPrevious = findPrevious;

  // Wire event listeners
  if ($searchInput) {
    $searchInput.addEventListener('input', performSearch);
    $searchInput.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
      }
      if (e.key === 'Escape') {
        hideSearchBar();
      }
    });
  }
  $searchNext?.addEventListener('click', findNext);
  $searchPrev?.addEventListener('click', findPrevious);
  $searchClose?.addEventListener('click', hideSearchBar);
});
