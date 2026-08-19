/**
 * Copyright (c) 2026 qiuqiukof-oss
 * Licensed under the MIT License. See LICENSE for details.
 */

// ============================================================
// welcome-renderer — Welcome carousel + slide data rendering
//
// Phase 2: Extract renderWelcome() + initWelcomeCarousel()
// from app.js. Pure DOM rendering — no closure deps.
// Auto-patches QCLI namespace at import time.
// ============================================================
// @ts-check
'use strict';

import { escapeHtml } from '../escape.js';

/** @typedef {import('../types').QCLI} QCLI */

// ── Pick localized text from a value that may be a string or {zh,en} ──
/** @param {any} v @returns {string} */
function pick(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  const lang = (window.QCLI && window.QCLI.getCurrentLang && window.QCLI.getCurrentLang()) || 'zh';
  if (v[lang] != null) return v[lang];
  if (v.zh != null) return v.zh;
  if (v.en != null) return v.en;
  return '';
}

// Last rendered welcome data, so we can re-render on language switch.
let lastWelcome = null;

// ── Render welcome data into carousel slides ──
export function renderWelcome(welcome) {
  if (!welcome) return;
  lastWelcome = welcome;

  // Slide 0: Quick Start cards
  const grid = document.getElementById('welcome-grid');
  if (grid && welcome.quickStart) {
    grid.innerHTML = '';
    for (const step of welcome.quickStart) {
      const card = document.createElement('div');
      card.className = 'welcome-card';
      const iconDiv = document.createElement('div');
      iconDiv.className = 'card-icon';
      iconDiv.textContent = step.icon;
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'card-body';
      const strong = document.createElement('strong');
      strong.textContent = pick(step.title);
      const span = document.createElement('span');
      span.textContent = pick(step.desc);
      bodyDiv.appendChild(strong);
      bodyDiv.appendChild(span);
      card.appendChild(iconDiv);
      card.appendChild(bodyDiv);
      grid.appendChild(card);
    }
  }

  // Slide 0: Features
  const features = document.getElementById('welcome-features');
  if (features && welcome.features) {
    features.innerHTML = '';
    for (const feat of welcome.features) {
      const card = document.createElement('div');
      card.className = 'feature-card';
      const iconDiv = document.createElement('div');
      iconDiv.className = 'feature-icon';
      iconDiv.style.color = feat.iconColor || '#6366f1';
      iconDiv.textContent = feat.icon;
      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'feature-body';
      const strong = document.createElement('strong');
      strong.textContent = pick(feat.title);
      const span = document.createElement('span');
      span.textContent = pick(feat.desc);
      bodyDiv.appendChild(strong);
      bodyDiv.appendChild(span);
      card.appendChild(iconDiv);
      card.appendChild(bodyDiv);
      features.appendChild(card);
    }
  }

  // Slide 1: Shortcuts
  const shortcuts = document.getElementById('welcome-shortcuts');
  if (shortcuts && welcome.shortcuts) {
    shortcuts.innerHTML = '';
    for (const sc of welcome.shortcuts) {
      const row = document.createElement('div');
      row.className = 'shortcut-row';
      const keySpan = document.createElement('span');
      keySpan.className = 'shortcut-key';
      keySpan.textContent = sc.key;
      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'shortcut-arrow';
      arrowSpan.textContent = '→';
      const descSpan = document.createElement('span');
      descSpan.className = 'shortcut-desc';
      descSpan.textContent = pick(sc.desc);
      row.appendChild(keySpan);
      row.appendChild(arrowSpan);
      row.appendChild(descSpan);
      shortcuts.appendChild(row);
    }
  }

  // Slide 1: Tips
  const tips = document.getElementById('welcome-tips');
  if (tips && welcome.tips) {
    tips.innerHTML = '';
    for (const tip of welcome.tips) {
      const li = document.createElement('li');
      // Tips may contain markup (<strong>/<kbd>); render as HTML.
      li.innerHTML = pick(tip);
      tips.appendChild(li);
    }
  }

  // Slide 2: Install tools
  const install = document.getElementById('welcome-install');
  if (install && welcome.installTools) {
    install.innerHTML = '';
    for (const tool of welcome.installTools) {
      const card = document.createElement('div');
      card.className = 'install-card';
      const header = document.createElement('div');
      header.className = 'install-header';
      const iconSpan = document.createElement('span');
      iconSpan.className = 'install-icon';
      iconSpan.style.color = tool.iconColor || '#6366f1';
      iconSpan.textContent = tool.icon;
      const nameDiv = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = tool.name;
      const descSpan = document.createElement('span');
      descSpan.className = 'install-desc';
      descSpan.textContent = tool.desc;
      nameDiv.appendChild(strong);
      nameDiv.appendChild(descSpan);
      header.appendChild(iconSpan);
      header.appendChild(nameDiv);
      card.appendChild(header);
      const body = document.createElement('div');
      body.className = 'install-body';
      if (tool.methods) {
        for (const method of tool.methods) {
          const m = document.createElement('div');
          m.className = 'install-method';
          const labelSpan = document.createElement('span');
          labelSpan.className = 'method-label';
          labelSpan.textContent = method.label;
          const code = document.createElement('code');
          code.className = 'install-code';
          code.textContent = method.code;
          m.appendChild(labelSpan);
          m.appendChild(code);
          body.appendChild(m);
        }
      }
      card.appendChild(body);
      install.appendChild(card);
    }
  }
  // NOTE: do NOT reset the carousel here — renderWelcome is also called on
  // language switch, and resetting would yank the user back to slide 0.
}

// ── Carousel navigation (no auto-scroll) ──
export function initWelcomeCarousel() {
  const track = document.getElementById('carousel-track');
  const slides = track ? track.querySelectorAll('.carousel-slide') : [];
  const dots = document.querySelectorAll('.carousel-dot');
  const prevBtn = document.getElementById('carousel-prev');
  const nextBtn = document.getElementById('carousel-next');
  const carouselEl = document.getElementById('welcome-carousel');

  if (!track || slides.length === 0) return;

  let current = 0;

  function goToSlide(index) {
    if (index < 0) index = slides.length - 1;
    if (index >= slides.length) index = 0;
    current = index;
    track.style.transform = 'translateX(-' + (current * 100) + '%)';
    dots.forEach(function(d) { d.classList.toggle('active', parseInt(d.dataset.slide) === current); });
  }

  function nextSlide() { goToSlide(current + 1); }
  function prevSlide() { goToSlide(current - 1); }

  if (prevBtn) prevBtn.addEventListener('click', prevSlide);
  if (nextBtn) nextBtn.addEventListener('click', nextSlide);

  dots.forEach(function(dot) {
    dot.addEventListener('click', function() {
      const idx = parseInt(dot.dataset.slide);
      if (!isNaN(idx)) goToSlide(idx);
    });
  });

  // Keyboard navigation within carousel
  if (carouselEl) {
    carouselEl.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowLeft') { prevSlide(); e.preventDefault(); }
      if (e.key === 'ArrowRight') { nextSlide(); e.preventDefault(); }
    });
    if (!carouselEl.getAttribute('tabindex')) {
      carouselEl.setAttribute('tabindex', '-1');
    }
  }

  // Start at slide 0
  goToSlide(0);
}

// ============================================================
// Auto-init — patch onto QCLI for backward compat
// ============================================================
Promise.resolve().then(function() {
  const Q = window.QCLI || {};
  Q.Welcome = Q.Welcome || {};
  Q.Welcome.renderWelcome = renderWelcome;
  Q.initWelcomeCarousel = initWelcomeCarousel;

  // Re-render welcome content when the language changes.
  window.addEventListener('qcli:langchange', function() {
    if (lastWelcome) renderWelcome(lastWelcome);
  });
});
