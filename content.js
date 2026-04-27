(() => {
  'use strict';

  const CARD_W = 420;
  const CARD_H = 780;

  let cards = [];
  let idx = 0;
  let hostEl = null;
  let shadow = null;
  let iframe = null;
  let isActive = false;
  let swiping = false;
  let cardTilt = 0;

  // ─── Listen ──────────────────────────────────────────────
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'toggle') {
        if (isActive) teardown(); else activate();
      }
    });
  }

  // ─── Helpers ─────────────────────────────────────────────
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function randTilt() { return (Math.random() - 0.5) * 5; } // ±2.5°

  function el(tag, cls, styles) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (styles) e.style.cssText = styles;
    return e;
  }

  function txt(tag, cls, text, styles) {
    const e = el(tag, cls, styles);
    e.textContent = text;
    return e;
  }

  // ─── Activate ────────────────────────────────────────────
  async function activate() {
    if (isActive) return;
    isActive = true;
    cardTilt = randTilt();
    buildOverlay();
    showLoading();

    iframe.src = buildTeamsUrl();

    iframe.addEventListener('load', async () => {
      await sleep(4000);

      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) {
          showError('Could not access Teams in the card. Teams may be blocking iframe embedding.');
          return;
        }

        const chatBtn = iframeDoc.querySelector('button[aria-label*="Chat"]');
        if (chatBtn) {
          chatBtn.click();
          await sleep(2000);
        }

        cards = scrapeUnreadFrom(iframeDoc);

        if (cards.length === 0) {
          showError('No unread chats found.');
          return;
        }

        idx = 0;
        showControls();
        injectIframeKeyListener(iframeDoc);
        cards[0].element.click();
      } catch (e) {
        console.error('Nullify:', e);
        showError('Could not access Teams iframe: ' + e.message);
      }
    }, { once: true });
  }

  function buildTeamsUrl() {
    return 'https://teams.cloud.microsoft/';
  }

  // ─── Scrape from iframe doc ──────────────────────────────
  function scrapeUnreadFrom(doc) {
    const items = doc.querySelectorAll('.fui-TreeItem[role="treeitem"]');
    const result = [];

    items.forEach(item => {
      if (result.length >= 30) return;
      const text = item.textContent.trim();
      if (!text.startsWith('Unread')) return;
      if (item.querySelector('[role="group"]')) return;
      const clean = text.replace(/^Unread\s*(message\s*)?/, '');
      if (clean.length < 3) return;
      result.push({ element: item, name: clean.split(/[\d]/)[0].trim() });
    });

    return result;
  }

  // ─── Build Overlay ───────────────────────────────────────
  function buildOverlay() {
    if (hostEl) hostEl.remove();

    hostEl = document.createElement('div');
    hostEl.id = 'nullify-host';
    hostEl.style.cssText = 'position:fixed;inset:0;z-index:999999;';
    document.body.appendChild(hostEl);

    shadow = hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const root = el('div', 'root');

    // Blurred backdrop
    const backdrop = el('div', 'backdrop');
    backdrop.addEventListener('click', teardown);
    root.appendChild(backdrop);

    // Swipe hint labels (behind the card)
    const hintLeft = txt('div', 'swipe-label swipe-label-left', '✓ Read');
    const hintRight = txt('div', 'swipe-label swipe-label-right', '→ Keep');
    root.appendChild(hintLeft);
    root.appendChild(hintRight);

    // Card container
    const card = el('div', 'card');
    card.style.setProperty('--tilt', cardTilt + 'deg');

    // Top bar (inside card)
    const topBar = el('div', 'top-bar');
    topBar.appendChild(txt('div', 'logo', '✦ nullify'));
    const cnt = el('div', 'cnt');
    cnt.appendChild(txt('b', '', '1'));
    cnt.appendChild(document.createTextNode(' / …'));
    topBar.appendChild(cnt);
    const closeBtn = txt('button', 'close-btn', '✕');
    closeBtn.addEventListener('click', teardown);
    topBar.appendChild(closeBtn);
    card.appendChild(topBar);

    // Iframe
    iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;flex:1;border:none;background:#f5f5f5;';
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox');
    card.appendChild(iframe);

    // Bottom bar (floating below card)
    const isMac = navigator.platform?.includes('Mac') || navigator.userAgent?.includes('Mac');
    const mod = isMac ? '⌘' : 'Ctrl';
    const bottomBar = el('div', 'bottom-bar');

    const readBtn = el('button', 'btn btn-read');
    readBtn.appendChild(txt('span', 'btn-label', '← Mark Read'));
    readBtn.appendChild(txt('kbd', 'keycap', mod));
    readBtn.appendChild(txt('kbd', 'keycap', '←'));
    readBtn.addEventListener('click', () => doSwipe('left'));
    bottomBar.appendChild(readBtn);

    const keepBtn = el('button', 'btn btn-keep');
    keepBtn.appendChild(txt('span', 'btn-label', 'Keep →'));
    keepBtn.appendChild(txt('kbd', 'keycap', mod));
    keepBtn.appendChild(txt('kbd', 'keycap', '→'));
    keepBtn.addEventListener('click', () => doSwipe('right'));
    bottomBar.appendChild(keepBtn);

    const escBtn = el('button', 'btn btn-esc');
    escBtn.appendChild(txt('kbd', 'keycap', 'Esc'));
    escBtn.addEventListener('click', teardown);
    bottomBar.appendChild(escBtn);

    root.appendChild(card);
    root.appendChild(bottomBar);

    // Loading indicator
    const loadingEl = el('div', 'loading-overlay');
    loadingEl.appendChild(el('div', 'spinner'));
    loadingEl.appendChild(txt('div', '', 'Loading Teams...'));
    root.appendChild(loadingEl);

    // Error display
    const errorEl = el('div', 'error-overlay');
    errorEl.style.display = 'none';
    root.appendChild(errorEl);

    // Done display
    const doneEl = el('div', 'done-overlay');
    doneEl.style.display = 'none';
    doneEl.appendChild(txt('div', 'done-emoji', '🎉'));
    doneEl.appendChild(txt('div', 'done-title', 'All caught up!'));
    doneEl.appendChild(txt('div', 'done-sub', ''));
    const doneBtn = txt('button', 'done-btn', 'Close');
    doneBtn.addEventListener('click', teardown);
    doneEl.appendChild(doneBtn);
    root.appendChild(doneEl);

    shadow.appendChild(root);
    document.addEventListener('keydown', onKey);
  }

  function showLoading() {
    const lo = shadow?.querySelector('.loading-overlay');
    if (lo) lo.style.display = 'flex';
    const bb = shadow?.querySelector('.bottom-bar');
    if (bb) bb.style.display = 'none';
  }

  function showControls() {
    const lo = shadow?.querySelector('.loading-overlay');
    if (lo) lo.style.display = 'none';
    const bb = shadow?.querySelector('.bottom-bar');
    if (bb) bb.style.display = 'flex';

    const cnt = shadow?.querySelector('.cnt');
    if (cnt) {
      cnt.textContent = '';
      cnt.appendChild(txt('b', '', '1'));
      cnt.appendChild(document.createTextNode(' / ' + cards.length));
    }

    // Entrance animation for first card
    const card = shadow?.querySelector('.card');
    if (card) {
      card.classList.add('card-enter');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => card.classList.add('card-enter-active'));
      });
    }
  }

  function showError(msg) {
    const lo = shadow?.querySelector('.loading-overlay');
    if (lo) lo.style.display = 'none';
    const er = shadow?.querySelector('.error-overlay');
    if (er) {
      er.style.display = 'flex';
      er.textContent = '';
      er.appendChild(txt('div', '', '⚠️', 'font-size:32px'));
      er.appendChild(txt('div', '', msg, 'font-size:14px;color:#fff;text-align:center;max-width:300px;line-height:1.5'));
      const btn = txt('button', 'done-btn', 'Close');
      btn.addEventListener('click', teardown);
      er.appendChild(btn);
    }
  }

  function showDone() {
    const bb = shadow?.querySelector('.bottom-bar');
    if (bb) bb.style.display = 'none';
    // Animate card away before showing done
    const card = shadow?.querySelector('.card');
    if (card) {
      card.style.transition = 'transform 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease';
      card.style.transform = 'translate(-50%, -50%) scale(0.8) rotate(0deg)';
      card.style.opacity = '0';
    }
    setTimeout(() => {
      if (card) card.style.display = 'none';
      const d = shadow?.querySelector('.done-overlay');
      if (d) {
        d.style.display = 'flex';
        const sub = d.querySelector('.done-sub');
        if (sub) sub.textContent = `Triaged ${cards.length} conversations`;
      }
    }, 450);
  }

  // ─── Swipe ───────────────────────────────────────────────
  async function doSwipe(dir) {
    if (swiping) return;
    swiping = true;

    const card = shadow?.querySelector('.card');
    const hintL = shadow?.querySelector('.swipe-label-left');
    const hintR = shadow?.querySelector('.swipe-label-right');

    if (card) {
      // Animate card flying off
      const flyX = dir === 'left' ? -140 : 140; // % of card width
      const flyRot = dir === 'left' ? -18 : 18;
      card.style.transition = 'transform 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease';
      card.style.transform = `translate(calc(-50% + ${flyX}vw), -50%) rotate(${flyRot}deg)`;
      card.style.opacity = '0';

      // Flash the appropriate hint label
      const hint = dir === 'left' ? hintL : hintR;
      if (hint) {
        hint.style.opacity = '1';
        hint.style.transform = 'translate(-50%, -50%) scale(1)';
      }
    }

    await sleep(420);

    // Hide hint
    if (hintL) { hintL.style.opacity = '0'; hintL.style.transform = 'translate(-50%, -50%) scale(0.8)'; }
    if (hintR) { hintR.style.opacity = '0'; hintR.style.transform = 'translate(-50%, -50%) scale(0.8)'; }

    idx++;
    if (idx >= cards.length) {
      swiping = false;
      showDone();
      return;
    }

    // Update counter
    const b = shadow?.querySelector('.cnt b');
    if (b) b.textContent = idx + 1;

    // Click next unread inside the iframe
    cards[idx].element.click();

    // New tilt for next card
    cardTilt = randTilt();

    // Animate card back in from opposite side
    if (card) {
      card.style.transition = 'none';
      const enterX = dir === 'left' ? 100 : -100;
      card.style.transform = `translate(calc(-50% + ${enterX}vw), -50%) rotate(${cardTilt + (dir === 'left' ? 12 : -12)}deg)`;
      card.style.opacity = '0';
      card.style.setProperty('--tilt', cardTilt + 'deg');

      // Force reflow then animate to resting position
      void card.offsetWidth;
      card.style.transition = 'transform 0.5s cubic-bezier(0.2,0.8,0.3,1), opacity 0.4s ease';
      card.style.transform = `translate(-50%, -50%) rotate(${cardTilt}deg)`;
      card.style.opacity = '1';
    }

    await sleep(500);
    swiping = false;
  }

  // ─── Keyboard ────────────────────────────────────────────
  function isHotkey(e) {
    const mod = e.ctrlKey || e.metaKey; // Ctrl on Win/Linux, Cmd on Mac
    if (mod && e.key === 'ArrowLeft')  return 'left';
    if (mod && e.key === 'ArrowRight') return 'right';
    if (e.key === 'Escape')            return 'escape';
    // Also allow plain arrows + h/l when NOT in a text field
    const inInput = e.target?.closest?.('input, textarea, [contenteditable], [role="textbox"]');
    if (!inInput) {
      if (e.key === 'ArrowLeft' || e.key === 'h') return 'left';
      if (e.key === 'ArrowRight' || e.key === 'l') return 'right';
    }
    return null;
  }

  function onKey(e) {
    if (!isActive || swiping) return;
    const action = isHotkey(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action === 'left' || action === 'right') doSwipe(action);
    else if (action === 'escape') teardown();
  }

  // Inject keyboard listener into the iframe so hotkeys work even when
  // focus is inside the Teams chat (e.g. typing a reply)
  function injectIframeKeyListener(iframeDoc) {
    try {
      iframeDoc.addEventListener('keydown', (e) => {
        const action = isHotkey(e);
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        if (action === 'left' || action === 'right') doSwipe(action);
        else if (action === 'escape') teardown();
      }, true); // capture phase to beat Teams' own handlers
    } catch (_) {
      // Cross-origin safety — if we can't inject, hotkeys only work outside iframe
    }
  }

  // ─── Teardown ────────────────────────────────────────────
  function teardown() {
    document.removeEventListener('keydown', onKey);
    if (hostEl) { hostEl.remove(); hostEl = null; shadow = null; iframe = null; }
    isActive = false;
    swiping = false;
    cards = [];
    idx = 0;
  }

  // ─── CSS ─────────────────────────────────────────────────
  const CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :host {
      /* Light theme (default) */
      --btn-bg: #fff;
      --btn-hover-read: #f0fdf4;
      --btn-hover-keep: #eff6ff;
      --btn-shadow: 0 4px 24px rgba(0,0,0,0.18);
      --btn-shadow-hover: 0 6px 28px rgba(0,0,0,0.24);
      --kc-border: rgba(0,0,0,0.15);
      --kc-bg: linear-gradient(to bottom, rgba(0,0,0,0.02), rgba(0,0,0,0.06));
      --kc-shadow: 0 1px 0 rgba(0,0,0,0.12), 0 0 0 0.5px rgba(0,0,0,0.08);
      --bar-bg: #1a1a1a;
      --bar-text: rgba(255,255,255,0.85);
      --bar-text-dim: rgba(255,255,255,0.4);
    }

    @media (prefers-color-scheme: dark) {
      :host {
        --btn-bg: #2a2a2e;
        --btn-hover-read: #1a2e22;
        --btn-hover-keep: #1a2240;
        --btn-shadow: 0 4px 24px rgba(0,0,0,0.5);
        --btn-shadow-hover: 0 6px 28px rgba(0,0,0,0.6);
        --kc-border: rgba(255,255,255,0.12);
        --kc-bg: linear-gradient(to bottom, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
        --kc-shadow: 0 1px 0 rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.06);
        --bar-bg: #1a1a1a;
        --bar-text: rgba(255,255,255,0.85);
        --bar-text-dim: rgba(255,255,255,0.4);
      }
    }

    .root {
      position: fixed; inset: 0; z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* ── Backdrop ── */
    .backdrop {
      position: absolute; inset: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(16px) saturate(1.2);
      animation: backdropIn 0.3s ease;
    }
    @keyframes backdropIn {
      from { opacity: 0; backdrop-filter: blur(0); }
      to   { opacity: 1; }
    }

    /* ── Swipe hint labels ── */
    .swipe-label {
      position: absolute;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%) scale(0.8);
      font-size: 42px;
      font-weight: 900;
      letter-spacing: 3px;
      opacity: 0;
      transition: opacity 0.25s ease, transform 0.25s ease;
      pointer-events: none;
      z-index: 10;
      text-shadow: 0 4px 24px rgba(0,0,0,0.4);
    }
    .swipe-label-left  { color: #4ade80; }
    .swipe-label-right { color: #60a5fa; }

    /* ── Card ── */
    .card {
      --tilt: 0deg;
      position: absolute;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%) rotate(var(--tilt));
      width: ${CARD_W}px; height: ${CARD_H}px;
      max-width: 95vw; max-height: 92vh;
      border-radius: 24px;
      box-shadow:
        0 30px 90px rgba(0,0,0,0.45),
        0 0 0 1px rgba(255,255,255,0.08) inset;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: #fff;
      will-change: transform, opacity;
    }

    /* Entrance animation */
    .card-enter {
      opacity: 0;
      transform: translate(-50%, -40%) rotate(var(--tilt)) scale(0.92);
    }
    .card-enter-active {
      opacity: 1;
      transform: translate(-50%, -50%) rotate(var(--tilt)) scale(1);
      transition: transform 0.55s cubic-bezier(0.2,0.8,0.3,1),
                  opacity 0.4s ease;
    }

    /* ── Top bar ── */
    .top-bar {
      height: 38px;
      background: #1a1a1a;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      flex-shrink: 0;
      z-index: 2;
      border-radius: 24px 24px 0 0;
    }
    .logo {
      color: rgba(255,255,255,0.85);
      font-size: 13px; font-weight: 700;
      letter-spacing: -0.3px;
    }
    .cnt { color: rgba(255,255,255,0.4); font-size: 12px; }
    .cnt b { color: rgba(255,255,255,0.9); font-weight: 600; }
    .close-btn {
      background: rgba(255,255,255,0.08); border: none; color: rgba(255,255,255,0.6);
      width: 26px; height: 26px; border-radius: 50%;
      font-size: 12px; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background 0.2s;
    }
    .close-btn:hover { background: rgba(255,255,255,0.18); color: #fff; }

    /* ── Bottom bar ── */
    .bottom-bar {
      position: absolute;
      bottom: max(calc(50% - ${CARD_H / 2}px - 60px), 16px);
      left: 50%; transform: translateX(-50%);
      display: none;
      gap: 10px; z-index: 2;
      align-items: center;
      animation: fadeUp 0.4s ease 0.2s both;
    }
    @keyframes fadeUp {
      from { opacity: 0; transform: translateX(-50%) translateY(12px); }
      to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }

    .btn {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 18px; border: none; border-radius: 14px;
      font-size: 14px; font-weight: 600; cursor: pointer;
      box-shadow: var(--btn-shadow);
      transition: transform 0.15s, box-shadow 0.15s;
      background: var(--btn-bg);
    }
    .btn:hover { transform: translateY(-1px); box-shadow: var(--btn-shadow-hover); }
    .btn:active { transform: scale(0.96) translateY(0); }

    .btn-label { pointer-events: none; }
    .btn-read { color: #059669; }
    .btn-read:hover { background: var(--btn-hover-read); }
    .btn-keep { color: #2563eb; }
    .btn-keep:hover { background: var(--btn-hover-keep); }
    .btn-esc {
      color: rgba(255,255,255,0.6);
      background: rgba(255,255,255,0.08);
      padding: 10px 12px;
      box-shadow: none;
    }
    .btn-esc:hover { background: rgba(255,255,255,0.15); color: #fff; box-shadow: none; }

    .keycap {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 24px; height: 24px;
      padding: 0 6px;
      font-family: inherit; font-size: 11px; font-weight: 700;
      line-height: 1;
      border-radius: 6px;
      border: 1px solid var(--kc-border);
      background: var(--kc-bg);
      box-shadow: var(--kc-shadow);
      color: inherit;
      opacity: 0.85;
    }
    .btn-esc .keycap {
      border-color: rgba(255,255,255,0.15);
      background: linear-gradient(to bottom, rgba(255,255,255,0.08), rgba(255,255,255,0.03));
      box-shadow: 0 1px 0 rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.6);
      opacity: 1;
    }

    @media (prefers-color-scheme: dark) {
      .btn-read { color: #4ade80; }
      .btn-keep { color: #60a5fa; }
    }

    /* ── Loading / Error / Done ── */
    .loading-overlay, .error-overlay, .done-overlay {
      position: absolute;
      left: 50%; top: 50%;
      transform: translate(-50%, -50%);
      width: ${CARD_W}px; height: ${CARD_H}px;
      max-width: 95vw; max-height: 92vh;
      border-radius: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 16px;
      color: #9ca3af;
      font-size: 14px;
      background: rgba(22,22,22,0.96);
      z-index: 3;
    }

    .spinner {
      width: 32px; height: 32px;
      border: 3px solid rgba(255,255,255,0.08);
      border-top-color: #6366f1;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .done-overlay {
      background: rgba(0,0,0,0.88);
      z-index: 4;
      animation: doneIn 0.5s cubic-bezier(0.2,0.8,0.3,1);
    }
    @keyframes doneIn {
      from { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
      to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
    }
    .done-emoji { font-size: 56px; }
    .done-title { font-size: 24px; font-weight: 800; color: #fff; }
    .done-sub { font-size: 14px; color: rgba(255,255,255,0.45); }
    .done-btn {
      margin-top: 12px; padding: 10px 28px;
      border: 1.5px solid rgba(255,255,255,0.2);
      background: transparent; color: rgba(255,255,255,0.8);
      border-radius: 12px; font-size: 14px; cursor: pointer;
      transition: background 0.2s, color 0.2s;
    }
    .done-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
  `;

  // ─── Expose ──────────────────────────────────────────────
  window.__nullifyActivate = activate;
})();
