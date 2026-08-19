/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// @ts-check
// ============================================================
// Terminal Search Bar
// ============================================================
'use strict';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const searchBar = document.getElementById('terminal-search-bar');
const searchInput = document.getElementById('terminal-search-input');
const searchResults = document.getElementById('terminal-search-results');
const searchPrev = document.getElementById('terminal-search-prev');
const searchNext = document.getElementById('terminal-search-next');
const searchClose = document.getElementById('terminal-search-close');

function searchBarVisible() {
  return searchBar && !searchBar.classList.contains('hidden');
}

function toggleSearchBar() {
  if (searchBarVisible()) {
    hideSearchBar();
  } else {
    showSearchBar();
  }
}

function showSearchBar() {
  if (!searchBar) return;
  searchBar.classList.remove('hidden');
  searchInput.value = '';
  searchResults.textContent = '0/0';
  searchInput.focus();
}

function hideSearchBar() {
  if (!searchBar) return;
  searchBar.classList.add('hidden');
  if (window.QCLI?.searchAddon) {
    window.QCLI.searchAddon.clearActiveSearch();
  }
  const term = window.QCLI?.Tabs?.term;
  if (term) term.focus();
}

function performSearch() {
  const query = searchInput.value.trim();
  const addon = window.QCLI?.searchAddon;
  if (!addon || !query) {
    searchResults.textContent = '';
    return;
  }
  addon.clearActiveSearch();
  const found = addon.findNext(query, { incremental: false });
  searchResults.textContent = found ? '\ud83d\udd0d 1+' : '\u2717';
}

function findNext() {
  const query = searchInput.value.trim();
  const addon = window.QCLI?.searchAddon;
  if (!addon || !query) return;
  addon.findNext(query, { incremental: true });
}

function findPrevious() {
  const query = searchInput.value.trim();
  const addon = window.QCLI?.searchAddon;
  if (!addon || !query) return;
  addon.findPrevious(query, { incremental: true });
}

if (searchInput) {
  searchInput.addEventListener('input', performSearch);
  searchInput.addEventListener('keydown', function(e) {
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
searchNext?.addEventListener('click', findNext);
searchPrev?.addEventListener('click', findPrevious);
searchClose?.addEventListener('click', hideSearchBar);

// Export for keyboard shortcuts handler in app.js
export const TerminalSearch = {
  visible: searchBarVisible,
  toggle: toggleSearchBar,
  show: showSearchBar,
  hide: hideSearchBar,
};
// Legacy compat
Q.TerminalSearch = TerminalSearch;
