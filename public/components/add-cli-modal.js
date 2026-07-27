// ============================================================
// add-cli-modal — Add CLI form handling
//
// Phase 2: Extracts showAddModal, hideAddModal, parseArgs,
// and the add form event handler from app.js.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

/** @typedef {import('../types').QCLI} QCLI */

let selectedFilePath = null;

/** @returns {QCLI} */
function q() { return /** @type {QCLI} */ (window.QCLI || {}); }
/** @returns {{[key:string]: any}} */
function dom() { return q().dom || {}; }
/** @returns {{[key:string]: any}} */
function state() { return q().state || {}; }

// ============================================================
// Modal open / close
// ============================================================

export function showAddModal() {
  const d = dom();
  if (!d.addOverlay) return;
  selectedFilePath = null;
  d.addOverlay.classList.remove('hidden');
  d.addName.value = '';
  d.addPath.value = '';
  d.addArgs.value = '';
  if (d.addError) d.addError.classList.add('hidden');
  if (d.selectedFile) d.selectedFile.classList.add('hidden');
  if (d.manualPathGroup) d.manualPathGroup.classList.add('hidden');
  d.addName.focus();
}

export function hideAddModal() {
  const d = dom();
  if (d.addOverlay) d.addOverlay.classList.add('hidden');
}

function parseArgs(str) {
  const args = [];
  const re = /[^\s"']+|"([^"]*)"|'([^']*)'/g;
  let match;
  while ((match = re.exec(str)) !== null) {
    args.push(match[1] || match[2] || match[0]);
  }
  return args;
}

// ============================================================
// Wire up DOM events (deferred after app.js populates Q.dom)
// ============================================================
Promise.resolve().then(() => {
  const d = dom();
  if (!d.addOverlay) return;

  // Expose showAddModal / hideAddModal on QCLI
  const Q = q();
  Q.showAddModal = showAddModal;
  Q.hideAddModal = hideAddModal;
  
  // Also register on Q.Sidebar for command palette compatibility
  if (!Q.Sidebar) Q.Sidebar = {};
  Q.Sidebar.showAddModal = showAddModal;

  // Add button
  if (d.addBtn) d.addBtn.addEventListener('click', showAddModal);

  // Cancel button
  if (d.addCancel) d.addCancel.addEventListener('click', hideAddModal);

  // Browse button → file input
  if (d.browseBtn) d.browseBtn.addEventListener('click', () => { if (d.fileInput) d.fileInput.click(); });

  // File input change
  if (d.fileInput) {
    d.fileInput.addEventListener('change', () => {
      const file = d.fileInput.files[0];
      if (!file) return;

      const name = file.name.replace(/\.[^.]+$/, '');
      d.addName.value = name;
      d.selectedFile.textContent = `\u2714 ${file.name}`;
      d.selectedFile.classList.remove('hidden');
      selectedFilePath = file.name;
      d.manualPathGroup.classList.add('hidden');
      d.addPath.value = '';
    });
  }

  // Name input → show manual path if no file selected
  if (d.addName) {
    d.addName.addEventListener('input', () => {
      if (!selectedFilePath && d.addName.value.trim()) {
        d.manualPathGroup.classList.remove('hidden');
      }
    });
  }

  // Form submit
  if (d.addForm) {
    d.addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = d.addName.value.trim();
      if (!name) return;

      const body = { name };
      const customPath = d.addPath.value.trim();
      if (customPath) body.path = customPath;
      const args = d.addArgs.value.trim();
      if (args) body.args = parseArgs(args);
      const init = d.addInit?.value.trim();
      if (init) body.init = init;

      d.addSubmit.disabled = true;
      d.addSubmit.textContent = 'Adding\u2026';

      try {
        const resp = await fetch('/api/clis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (resp.ok) {
          const entry = await resp.json();
          state().clis.push(entry);
          if (Q.renderCLIList) Q.renderCLIList();
          hideAddModal();
          if (Q.showUploadStatus) Q.showUploadStatus(`Added ${entry.name}`);
        } else {
          const err = await resp.json();
          d.addError.textContent = err.error || 'Failed to add CLI';
          d.addError.classList.remove('hidden');
        }
      } catch (err) {
        d.addError.textContent = 'Network error';
        d.addError.classList.remove('hidden');
      }

      d.addSubmit.disabled = false;
      d.addSubmit.textContent = 'Add';
    });
  }

  // Click overlay background to close
  if (d.addOverlay) {
    d.addOverlay.addEventListener('click', (e) => {
      if (e.target === d.addOverlay) hideAddModal();
    });
  }
});
