// @ts-check
// ============================================================
// Voice Input — Web Speech API
// ============================================================
'use strict';

import { escapeHtml } from './escape.js';

/** @typedef {import('./types').QCLI} QCLI */

/** @type {QCLI} */
const Q = /** @type {QCLI} */ (window.QCLI = window.QCLI || {});

const voice = {
  recognition: null,
  active: false,
  finalText: '',
};

const $voiceBtn = document.getElementById('voice-input-btn');
const $voiceStatus = document.getElementById('voice-status');
const $voiceInterim = document.getElementById('voice-interim') || (() => {
  const el = document.createElement('div');
  el.id = 'voice-interim';
  el.className = 'hidden';
  document.body.appendChild(el);
  return el;
})();

/**
 * Initialise speech recognition if the browser supports it.
 * Returns false if unsupported.
 */
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    if ($voiceBtn) {
      $voiceBtn.title = 'Speech recognition not supported in this browser';
      $voiceBtn.style.opacity = '0.3';
      $voiceBtn.style.cursor = 'not-allowed';
    }
    return false;
  }

  voice.recognition = new SpeechRecognition();
  voice.recognition.continuous = true;
  voice.recognition.interimResults = true;
  voice.recognition.lang = navigator.language || 'en-US';

  voice.recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        voice.finalText += transcript;
        // Send final result to the terminal as input
        const launched = window.QCLI?.state?.launched;
        if (launched && transcript.trim()) {
          window.QCLI?.wsSend?.({ type: 'input', data: transcript.trim() + '\n' });
        }
      } else {
        interim += transcript;
      }
    }

    // Show interim result below the terminal
    if (interim) {
      $voiceInterim.innerHTML = `<span class="interim-label">🎤</span>${escapeHtml(interim)}`;
      $voiceInterim.classList.remove('hidden');
    } else if (!voice.active) {
      $voiceInterim.classList.add('hidden');
    }
  };

  voice.recognition.onerror = (event) => {
    console.warn('[Voice] Error:', event.error);
    if (event.error === 'no-speech') {
      // Restart silently
      try { voice.recognition.start(); } catch (e) {
        console.warn('[VoiceInput] Recognition start failed:', e?.message);
      }
      return;
    }
    if (event.error === 'aborted') return;
    stopVoiceInput();
    window.QCLI?.showToast?.(`Voice error: ${event.error}`, 'error');
  };

  voice.recognition.onend = () => {
    // Auto-restart if still recording
    if (voice.active && voice.recognition) {
      try {
        voice.recognition.start();
      } catch (e) {
        stopVoiceInput();
      }
    }
  };

  return true;
}

function toggleVoiceInput() {
  if (!voice.recognition) {
    if (!initSpeechRecognition()) {
      window.QCLI?.showToast?.('Speech recognition not available in this browser. Try Chrome or Edge.', 'error');
      return;
    }
  }

  if (voice.active) {
    stopVoiceInput();
  } else {
    startVoiceInput();
  }
}

function startVoiceInput() {
  if (!voice.recognition) return;

  // Request microphone permission implicitly via start()
  try {
    voice.active = true;
    voice.finalText = '';
    voice.recognition.start();
    if ($voiceBtn) $voiceBtn.classList.add('recording');
    if ($voiceStatus) {
      $voiceStatus.classList.remove('hidden');
      const voiceText = $voiceStatus.querySelector('.voice-text');
      if (voiceText) voiceText.textContent = 'Listening...';
    }
    window.QCLI?.showToast?.('Voice input active → speak your command', 'info');
    const term = window.QCLI?.Tabs?.term;
    if (term) term.focus();
  } catch (e) {
    voice.active = false;
    window.QCLI?.showToast?.('Could not start microphone. Check permissions.', 'error');
    if ($voiceBtn) $voiceBtn.classList.remove('recording');
    if ($voiceStatus) $voiceStatus.classList.add('hidden');
  }
}

function stopVoiceInput() {
  try {
    if (voice.recognition) {
      voice.recognition.stop();
    }    } catch (e) {
      console.warn('[VoiceInput] Error:', e?.message);
    }
  voice.active = false;
  voice.finalText = '';
  if ($voiceBtn) $voiceBtn.classList.remove('recording');
  if ($voiceStatus) $voiceStatus.classList.add('hidden');
  $voiceInterim.classList.add('hidden');
}

// Wire up the voice button
if ($voiceBtn) {
  $voiceBtn.addEventListener('click', toggleVoiceInput);
  // Initialise early to detect support (but don't start listening)
  initSpeechRecognition();
}

// Cleanup microphone on page unload
window.addEventListener('beforeunload', () => {
  if (voice.active) stopVoiceInput();
});

// Legacy compat
Q.escapeHtml = escapeHtml;
