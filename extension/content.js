// content.js — Slopfilter content script (Phase 1, local-only)
//
// Scans the X.com timeline, identifies the account behind each post, and applies
// the chosen treatment (hide / blur-with-reveal) when that account is filtered.
// A single draggable 🚩 button follows the post you hover; drop it anywhere and
// every post uses that same relative position.
//
// IMPORTANT — why inline styles, not CSS classes:
// X sets its own `className` on every <article> via React. Any class WE add gets
// wiped the instant React re-renders that post. So treatments are applied as
// inline `style` with `!important` (which X isn't managing) and re-asserted on
// every mutation + a 1s safety sweep. Same reason the flag button lives on <body>.
//
// Phase 1 sources its block list ONLY from the user's own local flags. Phase 2
// merges in the synced community list (handle -> independent flag count) and
// applies the strictness threshold — see the `community` map in verdict().

(() => {
  'use strict';

  const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;
  const CATEGORIES = ['bot', 'ai-slop', 'ragebait', 'spam'];
  const RESERVED = new Set([
    'home', 'explore', 'notifications', 'messages', 'search', 'settings',
    'i', 'compose', 'hashtag', 'login', 'signup', 'about', 'tos', 'privacy',
    'intent', 'share',
  ]);
  const BTN = 30; // button size in px

  let settings = defaultSettings();
  /** @type {Map<string, {category:string, ts:number}>} my own flags */
  let myFlags = new Map();
  /** @type {Map<string, {count:number, categories:Set<string>}>} community (Phase 2) */
  const community = new Map();
  /** handles the user clicked "reveal" on this session */
  const revealedHandles = new Set();

  function defaultSettings() {
    return {
      strictness: 10,
      treatment: 'blur', // 'hide' | 'blur' (blur-with-reveal)
      categories: { bot: true, 'ai-slop': true, ragebait: true, spam: true },
      anchor: { fx: 0.95, fy: 0.05 }, // flag-button position as a fraction of a post's box
    };
  }

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  async function loadState() {
    const local = await chrome.storage.local.get([
      'slopfilter:settings',
      'slopfilter:flags',
      'slopfilter:community',
    ]);
    settings = Object.assign(defaultSettings(), local['slopfilter:settings'] || {});
    if (!settings.anchor) settings.anchor = defaultSettings().anchor;
    myFlags = new Map();
    for (const f of local['slopfilter:flags'] || []) {
      myFlags.set(f.handle.toLowerCase(), f);
    }
    community.clear();
    for (const [handle, data] of Object.entries(local['slopfilter:community'] || {})) {
      community.set(handle, { count: data.count, categories: new Set(data.categories || []) });
    }
    console.debug(
      `[slopfilter] state loaded: ${myFlags.size} local flag(s), ${community.size} community, treatment=${settings.treatment}`
    );
  }

  async function saveSettings() {
    await chrome.storage.local.set({ 'slopfilter:settings': settings });
  }

  // Returns a verdict object if the account should be filtered, else null.
  function verdict(handle) {
    const key = handle.toLowerCase();

    const mine = myFlags.get(key);
    if (mine && settings.categories[mine.category]) {
      return { handle, category: mine.category, source: 'you' };
    }

    const c = community.get(key);
    if (c && c.count >= settings.strictness) {
      const cat = [...c.categories].find((x) => settings.categories[x]);
      if (cat) return { handle, category: cat, source: 'community', count: c.count };
    }
    return null;
  }

  // Pull the author handle out of a tweet article. Defensive against X's DOM churn.
  function extractHandle(article) {
    const nameBlock = article.querySelector('[data-testid="User-Name"]') || article;
    const anchors = nameBlock.querySelectorAll('a[role="link"][href^="/"]');
    for (const a of anchors) {
      const seg = a.getAttribute('href').slice(1).split('/')[0];
      if (HANDLE_RE.test(seg) && !RESERVED.has(seg.toLowerCase())) return seg;
    }
    return null;
  }

  // ----- Treatment (inline styles so React can't wipe them) -----

  function applyTreatment(article, v) {
    if (settings.treatment === 'hide') {
      article.style.setProperty('display', 'none', 'important');
      delete article.dataset.slopfilterBlur;
      return;
    }
    // 'blur' (default): blur the post's CONTENT children — not the <article> itself —
    // so our reason-label can sit on top un-blurred. Inline filter + !important
    // (X owns/re-renders these nodes, so a CSS class would be wiped) re-asserted every
    // sweep. Children are made click-through so a click anywhere reveals the post.
    article.style.setProperty('position', 'relative', 'important');
    for (const child of article.children) {
      if (child.classList.contains('slopfilter-label')) continue;
      child.style.setProperty('filter', 'blur(7px)', 'important');
      child.style.setProperty('pointer-events', 'none', 'important');
    }
    let label = article.querySelector(':scope > .slopfilter-label');
    if (!label) {
      label = document.createElement('div');
      label.className = 'slopfilter-label';
      // textContent (never innerHTML) so a crafted handle can't inject markup.
      label.textContent = `🚩 @${v.handle} flagged as ${v.category} · click to reveal`;
      article.appendChild(label);
      console.debug(`[slopfilter] blurred @${v.handle} (${v.category})`);
    }
    article.dataset.slopfilterBlur = '1';
  }

  function clearTreatment(article) {
    if (article.dataset.slopfilterBlur === undefined && article.style.display !== 'none') {
      return; // nothing to undo
    }
    article.style.removeProperty('display');
    article.style.removeProperty('filter');
    article.style.removeProperty('position');
    for (const child of article.children) {
      if (child.classList.contains('slopfilter-label')) continue;
      child.style.removeProperty('filter');
      child.style.removeProperty('pointer-events');
    }
    article.querySelector(':scope > .slopfilter-label')?.remove();
    delete article.dataset.slopfilterBlur;
  }

  async function saveFlag(handle, category) {
    const local = await chrome.storage.local.get('slopfilter:flags');
    const flags = local['slopfilter:flags'] || [];
    const key = handle.toLowerCase();
    if (!flags.some((f) => f.handle.toLowerCase() === key)) {
      flags.push({ handle, category, ts: Date.now() });
      await chrome.storage.local.set({ 'slopfilter:flags': flags });
    }
    // Push to Supabase via background (handles offline retry queue).
    chrome.runtime.sendMessage({ type: 'SUBMIT_FLAG', handle, category });
    console.debug(`[slopfilter] flagged @${handle} as ${category}`);
  }

  // Idempotent: (re)assert the correct treatment on every post.
  function refresh() {
    for (const article of document.querySelectorAll('article')) {
      const handle = extractHandle(article);
      if (!handle) continue;
      const v = revealedHandles.has(handle.toLowerCase()) ? null : verdict(handle);
      if (v) applyTreatment(article, v);
      else clearTreatment(article);
    }
  }

  let scheduled = false;
  function scheduleRefresh() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; refresh(); });
  }

  // ----- Floating, draggable flag button -----

  let floatRoot;
  let floatMenu;
  let menuOpen = false;
  let hoverArticle = null;
  let targetArticle = null;
  let dragging = false;
  let moved = false;
  let justDragged = false;
  let dragStart = null;
  let dragArticle = null;

  function buildFloating() {
    floatRoot = document.createElement('div');
    floatRoot.className = 'slopfilter-flagwrap';
    floatRoot.hidden = true;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slopfilter-flagbtn';
    btn.title = 'Flag this account (drag to move)';
    btn.textContent = '\u{1F6A9}'; // 🚩

    const ICONS = { bot: '🤖', 'ai-slop': '✨', ragebait: '😡', spam: '🗑️' };
    const LABELS = { bot: 'bot', 'ai-slop': 'AI-slop', ragebait: 'ragebait', spam: 'spam' };

    floatMenu = document.createElement('div');
    floatMenu.className = 'slopfilter-menu';
    floatMenu.hidden = true;

    const header = document.createElement('div');
    header.className = 'slopfilter-menu-header';
    header.textContent = 'Flag as slop';
    floatMenu.appendChild(header);

    for (const cat of CATEGORIES) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'slopfilter-menu-item';

      const ico = document.createElement('span');
      ico.className = 'slopfilter-ico';
      ico.textContent = ICONS[cat];
      const lbl = document.createElement('span');
      lbl.textContent = LABELS[cat];
      item.append(ico, lbl);

      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        const art = targetArticle || hoverArticle;
        const handle = art && extractHandle(art);
        if (handle) await saveFlag(handle, cat);
        closeMenu();
        hideFloat();
      });
      floatMenu.appendChild(item);
    }

    // Drag start
    btn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      dragging = true;
      moved = false;
      dragArticle = hoverArticle;
      dragStart = { x: e.clientX, y: e.clientY };
      floatRoot.style.transition = 'none';
    });

    // Click = open/close menu (suppressed right after a drag)
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (justDragged) { justDragged = false; return; }
      targetArticle = hoverArticle;
      menuOpen = !menuOpen;
      floatMenu.hidden = !menuOpen;
    });

    floatRoot.append(btn, floatMenu);
    document.body.appendChild(floatRoot);
  }

  function closeMenu() {
    menuOpen = false;
    if (floatMenu) floatMenu.hidden = true;
  }

  function positionFloat(article) {
    const a = settings.anchor || { fx: 0.95, fy: 0.05 };
    const r = article.getBoundingClientRect();
    const cx = r.left + a.fx * r.width;
    const cy = r.top + a.fy * r.height;
    floatRoot.style.left = `${window.scrollX + cx - BTN / 2}px`;
    floatRoot.style.top = `${window.scrollY + cy - BTN / 2}px`;
  }

  function showFloat(article) {
    hoverArticle = article;
    if (!menuOpen) positionFloat(article);
    floatRoot.hidden = false;
  }

  function hideFloat() {
    if (menuOpen || dragging) return;
    floatRoot.hidden = true;
    hoverArticle = null;
  }

  function onMouseOver(e) {
    if (dragging) return;
    const t = e.target;
    if (floatRoot.contains(t)) return;
    const art = t.closest && t.closest('article');
    if (art && extractHandle(art)) showFloat(art);
  }

  function onMouseOut(e) {
    if (dragging) return;
    const to = e.relatedTarget;
    if (!to) return hideFloat();
    if (floatRoot.contains(to)) return;
    if (to.closest && to.closest('article') === hoverArticle) return;
    hideFloat();
  }

  function onMouseMove(e) {
    if (!dragging) return;
    if (Math.abs(e.clientX - dragStart.x) > 4 || Math.abs(e.clientY - dragStart.y) > 4) {
      moved = true;
    }
    floatRoot.style.left = `${window.scrollX + e.clientX - BTN / 2}px`;
    floatRoot.style.top = `${window.scrollY + e.clientY - BTN / 2}px`;
  }

  function onMouseUp(e) {
    if (!dragging) return;
    dragging = false;
    floatRoot.style.transition = '';
    justDragged = moved;
    if (moved) {
      const art = dragArticle || hoverArticle;
      if (art) {
        const r = art.getBoundingClientRect();
        settings.anchor = {
          fx: clamp((e.clientX - r.left) / r.width, 0, 1),
          fy: clamp((e.clientY - r.top) / r.height, 0, 1),
        };
        saveSettings();
        if (hoverArticle) positionFloat(hoverArticle);
      }
    }
  }

  function onDocClick(e) {
    if (floatRoot.contains(e.target)) return;
    closeMenu();
    // Click a blurred post to reveal that account for this session.
    const art = e.target.closest && e.target.closest('article');
    if (art && art.dataset.slopfilterBlur === '1') {
      const h = extractHandle(art);
      if (h) {
        revealedHandles.add(h.toLowerCase());
        e.stopPropagation();
        e.preventDefault();
        scheduleRefresh();
      }
    }
  }

  // ----- Wiring -----

  const observer = new MutationObserver(scheduleRefresh);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (
      changes['slopfilter:settings'] ||
      changes['slopfilter:flags'] ||
      changes['slopfilter:community']
    )) {
      loadState().then(scheduleRefresh);
    }
  });

  (async function init() {
    await loadState();
    buildFloating();
    refresh();
    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mouseout', onMouseOut, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
    document.addEventListener('click', onDocClick, true);
    observer.observe(document.body, { childList: true, subtree: true });
    // Safety net: re-assert treatments in case a React re-render wiped inline styles
    // via an attribute-only mutation the observer's childList watch didn't catch.
    setInterval(scheduleRefresh, 1000);
  })();
})();
