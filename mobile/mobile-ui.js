// iOS layout behaviour on top of app.js: mini player <-> now-playing sheet, swipe to dismiss,
// and the progress line on the mini player.

// Background playback: iOS suspends Web Audio when the app is backgrounded or the screen locks,
// but keeps a plain <audio> element playing (and on the lock screen). So on iPhone the engine never
// routes the element through an AudioContext. Speed/pitch still work (they're element properties);
// EQ, reverb, distortion and the visualizer need the graph and are off. app.js builds the engine on
// DOMContentLoaded, which hasn't fired yet when this script runs.
(() => {
  // desktop's default text scale (1.25x) is sized for a monitor; phones start at 1.0x unless the user picked one
  if (!localStorage.getItem('muriel_font_scale')) localStorage.setItem('muriel_font_scale', '80');
  const Engine = window.MurielAudioEngine;
  if (!Engine) return;
  Engine.prototype.init = function (audioElement) { this.__element = audioElement || this.__element; };
  // iOS ignores element.volume (hardware buttons own it); mute still works
  Engine.prototype._applyMasterVolume = function () {
    if (this.__element) this.__element.muted = !!this.isMuted || this.volume === 0;
  };
})();

/* Noctra: shared XP ranks. The same thresholds and storage key as PC Noctra, so a
   profile/backup imported from the desktop build keeps the same level. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const RANKS = [
    { tier: 1, minXp: 0 }, { tier: 2, minXp: 500 }, { tier: 3, minXp: 1200 },
    { tier: 4, minXp: 2000 }, { tier: 5, minXp: 2850 }, { tier: 6, minXp: 3900 },
    { tier: 7, minXp: 5000 }, { tier: 8, minXp: 7000 }
  ];
  const rankFor = (xp) => {
    let rank = RANKS[0];
    const value = Math.max(0, Number(xp) || 0);
    for (const item of RANKS) { if (value >= item.minXp) rank = item; else break; }
    const next = RANKS.find((item) => item.minXp > value) || null;
    const into = value - rank.minXp;
    const span = next ? next.minXp - rank.minXp : 0;
    return {
      xp: value,
      rank,
      next,
      into,
      span,
      percent: next ? Math.max(0, Math.min(100, Math.round((into / span) * 100))) : 100,
      toNext: next ? Math.max(0, next.minXp - value) : 0
    };
  };
  const totalXP = () => {
    try {
      const store = JSON.parse(localStorage.getItem('riff_profile_v1') || 'null');
      return Math.max(0, Math.floor(Number(store && store.progression && store.progression.totalXP) || 0));
    } catch (_) { return 0; }
  };
  window.NoctraXP = { ranks: RANKS, rankFor, total: totalXP };
})();

(() => {
  const panel = document.getElementById('right-panel');
  const playbar = document.getElementById('playbar');
  const lyricsBtn = document.getElementById('btn-toggle-lyrics-panel');
  const audio = document.querySelector('audio');
  if (!panel || !playbar || !lyricsBtn) return;

  // app.js owns the drawer state; mirror it onto <body> so the player bar can restyle itself
  const sync = () => document.body.classList.toggle('np-open', !panel.classList.contains('hidden'));
  new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
  sync();

  const openSheet = () => { if (panel.classList.contains('hidden')) lyricsBtn.click(); };
  const closeSheet = () => { if (!panel.classList.contains('hidden')) document.getElementById('btn-close-right-panel').click(); };

  // tapping the mini player (but not its buttons) opens the sheet
  playbar.addEventListener('click', (e) => {
    if (document.body.classList.contains('np-open')) return;
    if (e.target.closest('button, input, .scrubber-track-container')) return;
    openSheet();
  });

  // swipe down on the sheet's top area to close it
  let startY = null;
  panel.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const lyrics = document.getElementById('lyrics-container');
    // a finger on a seek bar or slider is seeking, not closing the sheet (#21)
    if (e.target.closest('input[type="range"], .scrubber-track-container, [role="slider"]')) { startY = null; return; }
    startY = (lyrics && lyrics.contains(e.target) && lyrics.scrollTop > 0) ? null : t.clientY;
  }, { passive: true });
  // one transform write per frame, and no CSS transition while the finger drags (it lagged behind)
  let dragY = 0, dragRaf = 0;
  panel.addEventListener('touchmove', (e) => {
    if (startY === null) return;
    dragY = Math.max(0, e.touches[0].clientY - startY);
    if (dragY > 0 && !panel.classList.contains('is-dragging')) panel.classList.add('is-dragging');
    if (!dragRaf) dragRaf = requestAnimationFrame(() => { dragRaf = 0; if (startY !== null) panel.style.transform = dragY > 0 ? `translateY(${dragY}px)` : ''; });
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (startY === null) return;
    const dy = e.changedTouches[0].clientY - startY;
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
    panel.classList.remove('is-dragging');
    panel.style.transform = '';
    startY = null;
    if (dy > 110) closeSheet();
  });

  // Picked images and videos (background, banner, song covers) are saved as file URLs, and those change when
  // iOS moves the app container (every update or reinstall). Rebuild each saved one from its file name, then
  // delete picks nothing uses any more (every pick is a new copy). Only the background was repaired before,
  // and picking a song cover made even that repair forget the background.
  const fixPickedMedia = async () => {
    const api = window.electronAPI;
    if (!api.fileUrl) return;
    const nameOf = (u) => { const m = typeof u === 'string' && !u.startsWith('blob:') && u.match(/\/backgrounds\/(bg_[\w.-]+)$/); return m ? m[1] : null; };
    const keep = new Set();
    const fresh = async (u) => {
      const name = nameOf(u);
      if (!name) return u;
      const url = await api.fileUrl(`/data/backgrounds/${name}`);
      if (url) keep.add(name);
      return url || u;
    };
    let bgChanged = false;
    for (const key of ['muriel_bg_url', 'muriel_banner_media', 'muriel_app_icon']) {
      const cur = localStorage.getItem(key);
      if (!cur) continue;
      const next = await fresh(cur);
      if (next !== cur) { localStorage.setItem(key, next); if (key === 'muriel_bg_url') bgChanged = true; }
    }
    let artOk = true;
    try {
      const art = JSON.parse(localStorage.getItem('muriel_track_art') || '{}');
      let dirty = false;
      for (const v of Object.values(art)) {
        for (const f of ['cover', 'banner']) {
          if (!v || !v[f]) continue;
          const next = await fresh(v[f]);
          if (next !== v[f]) { v[f] = next; dirty = true; }
        }
      }
      if (dirty) localStorage.setItem('muriel_track_art', JSON.stringify(art));
    } catch (e) { artOk = false; }
    localStorage.removeItem('muriel_bg_vpath');
    if (bgChanged) window.MurielCore.refreshBackground();
    if (artOk && api.pruneMedia) api.pruneMedia(keep);
  };
  if (window.MurielCore) fixPickedMedia(); else window.addEventListener('muriel:ready', fixPickedMedia, { once: true });

  // phones default to word-by-word karaoke (the Line/Word button still switches)
  const preferWordLyrics = () => {
    const st = window.MurielCore && window.MurielCore.state;
    const btn = document.getElementById('btn-lyrics-mode');
    if (st && btn && st.lyricsMode === 'line' && localStorage.getItem('muriel_adv_karaoke_words') !== 'false') btn.click();
  };
  if (window.MurielCore) preferWordLyrics(); else window.addEventListener('muriel:ready', preferWordLyrics, { once: true });

  // lyrics tools (edit / sync / translate / fullscreen) move up next to the Line/Word button,
  // so the lyrics get that row back; same buttons, so their handlers keep working
  const tools = panel.querySelector('.lyrics-header-actions');
  const topRow = panel.querySelector('.right-panel-header-actions');
  if (tools && topRow) { topRow.prepend(tools); tools.classList.add('np-tools-moved'); }

  // like button next to the title in Now Playing (the player bar's heart is hidden on phones);
  // it presses the real one and mirrors its state
  const realFav = document.getElementById('btn-toggle-fav');
  const favIcon = document.getElementById('fav-icon');
  const titleRow = panel.querySelector('.right-panel-title-row');
  if (realFav && favIcon && titleRow) {
    const like = document.createElement('button');
    like.id = 'np-like';
    like.type = 'button';
    like.setAttribute('data-i18n-attr', 'aria-label');
    like.setAttribute('aria-label', 'Like');
    like.innerHTML = favIcon.outerHTML.replace('id="fav-icon"', '');
    const mirror = () => { const on = favIcon.getAttribute('fill') === 'currentColor'; like.classList.toggle('on', on); like.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none'); };
    like.addEventListener('click', () => {
      realFav.click();
      like.classList.remove('pop'); void like.offsetWidth; like.classList.add('pop');
      if (navigator.vibrate) navigator.vibrate(12);
    });
    new MutationObserver(mirror).observe(favIcon, { attributes: true, attributeFilter: ['fill'] });
    titleRow.appendChild(like);
    mirror();
  }

  // slowly drifting colour glow behind Now Playing (cover colours, plain gradients: cheap to draw)
  const ambient = document.createElement('div');
  ambient.className = 'np-ambient';
  ambient.innerHTML = '<i></i><i></i><i></i>';
  panel.prepend(ambient);

  // swipe the cover left/right to skip, with the cover following your finger
  const cover = document.getElementById('cover-container');
  if (cover) {
    let x0 = null, y0 = null, dx = 0, horizontal = null;
    cover.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; horizontal = null; cover.style.transition = 'none'; }, { passive: true });
    cover.addEventListener('touchmove', (e) => {
      if (x0 === null) return;
      dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (horizontal === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) horizontal = Math.abs(dx) > Math.abs(dy);
      if (horizontal) cover.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
    }, { passive: true });
    cover.addEventListener('touchend', () => {
      if (x0 === null) return;
      x0 = null;
      cover.style.transition = 'transform .32s cubic-bezier(.2,.8,.2,1), opacity .32s';
      if (horizontal && Math.abs(dx) > 70) {
        const dir = dx < 0 ? -1 : 1;
        cover.style.transform = `translateX(${dir * window.innerWidth}px) rotate(${dir * 12}deg)`;
        cover.style.opacity = '0';
        if (navigator.vibrate) navigator.vibrate(10);
        setTimeout(() => {
          if (dir < 0) document.getElementById('btn-next').click(); else document.getElementById('btn-prev').click();
          cover.style.transition = 'none';
          cover.style.transform = `translateX(${-dir * 60}px)`;
          requestAnimationFrame(() => { cover.style.transition = 'transform .38s cubic-bezier(.2,.8,.2,1), opacity .38s'; cover.style.transform = ''; cover.style.opacity = ''; });
        }, 220);
      } else {
        cover.style.transform = '';
      }
    });
  }

  // mini player progress line
  if (audio) {
    const tick = () => {
      if (document.hidden) return;
      const p = audio.duration ? audio.currentTime / audio.duration : 0;
      playbar.style.setProperty('--mini-progress', String(Math.max(0, Math.min(1, p))));
    };
    audio.addEventListener('timeupdate', tick);
    audio.addEventListener('emptied', tick);
    document.addEventListener('visibilitychange', tick);
  }

  // phone-only settings: the song storage limit (Storage → Offline songs) and sharing the error log (About)
  const storageGroup = document.querySelector('.settings-section[data-cat="storage"] .m3-group[data-group="offline"]') || document.querySelector('.settings-section[data-cat="storage"] .m3-group');
  const aboutGroup = document.querySelector('.settings-section[data-cat="about"] .m3-group');
  if (storageGroup) {
    const limits = [['1024', '1 GB'], ['2048', '2 GB'], ['5120', '5 GB'], ['10240', '10 GB']];
    const current = localStorage.getItem('muriel_cache_limit_mb') || '2048';
    const limitRow = document.createElement('div');
    limitRow.className = 'setting-item';
    limitRow.innerHTML = `
      <div class="setting-item-top" style="align-items: center;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span class="setting-name" data-i18n>Song storage limit</span>
          <span style="font-size: calc(12px * var(--font-scale, 1)); color: var(--md-sys-color-outline);" data-i18n>Songs you play are kept for offline use. Over this limit, the ones played longest ago are removed.</span>
        </div>
      </div>
      <div class="theme-mode-toggle" style="margin-top: 10px;">
        ${limits.map(([v, l]) => `<button class="fps-cap-btn${v === current ? ' active' : ''}" data-limit="${v}">${l}</button>`).join('')}
      </div>`;
    limitRow.querySelectorAll('[data-limit]').forEach((b) => b.addEventListener('click', () => {
      localStorage.setItem('muriel_cache_limit_mb', b.dataset.limit);
      limitRow.querySelectorAll('[data-limit]').forEach((x) => x.classList.toggle('active', x === b));
      // a lower limit applies now, not only after the next download
      if (window.MurielCache) window.MurielCache.enforceLimit();
    }));
    const logRow = document.createElement('div');
    logRow.className = 'setting-item';
    logRow.innerHTML = `
      <div class="setting-item-top" style="align-items: center;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span class="setting-name" data-i18n>Share error log</span>
          <span style="font-size: calc(12px * var(--font-scale, 1)); color: var(--md-sys-color-outline);" data-i18n>If something breaks, send this so it can be fixed.</span>
        </div>
        <button class="btn-pill-primary" type="button" data-i18n>Share</button>
      </div>`;
    logRow.querySelector('button').addEventListener('click', async () => {
      const res = await window.electronAPI.shareText('Noctra error log', window.MurielLog ? window.MurielLog.text() : 'no log');
      if (res === 'copied' && window.MurielCore) window.MurielCore.toast((window.MurielI18n || { T: (x) => x, Tm: (x) => x }).Tm('Log copied to clipboard'), 'info');
    });
    storageGroup.append(limitRow);
    if (aboutGroup) aboutGroup.insertBefore(logRow, aboutGroup.lastElementChild); else storageGroup.append(logRow);
  }

  // the desktop placeholder doesn't fit beside the source buttons on a phone
  const searchInput = document.getElementById('search-input');
  if (searchInput) { searchInput.setAttribute('data-i18n-attr', 'placeholder'); searchInput.placeholder = 'Search songs, artists…'; }

  // iPhone: lyrics on the lock screen and in the Dynamic Island (mobile/live-activity.js)
  const trRow = document.getElementById('btn-tr-enabled') && document.getElementById('btn-tr-enabled').closest('.setting-item');
  // the phone's own playback rows go to Tracks → Playback
  const playbackGroup = document.querySelector('.m3-group[data-group="playback"]');
  const addPlaybackRow = (row) => { if (playbackGroup) playbackGroup.append(row); else trRow.parentElement.insertBefore(row, trRow); };
  if (window.MurielLiveActivity && trRow) {
    const la = window.MurielLiveActivity;
    const row = document.createElement('div');
    row.className = 'setting-item';
    row.innerHTML = `
      <div class="setting-item-top" style="align-items: center;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span class="setting-name" data-i18n>Lock screen &amp; Dynamic Island</span>
          <span class="la-hint" style="font-size: calc(12px * var(--font-scale, 1)); color: var(--md-sys-color-outline);" data-i18n>The song, its progress and the line being sung. Long-press the Dynamic Island for play, skip and shuffle (iOS 17).</span>
        </div>
        <button class="effect-switch-btn${la.enabled() ? ' active' : ''}" type="button" aria-label="Lock screen and Dynamic Island" data-i18n-attr="aria-label"><span class="thumb"></span></button>
      </div>`;
    const sw = row.querySelector('button');
    sw.addEventListener('click', () => {
      const on = !sw.classList.contains('active');
      sw.classList.toggle('active', on);
      la.setEnabled(on);
    });
    la.available().then((ok) => {
      if (!ok) row.querySelector('.la-hint').textContent = 'Turn on Live Activities for Noctra in the iPhone Settings app first (needs iOS 16.2 or newer).';
    });
    addPlaybackRow(row);
  }

  // Android: let Noctra off battery optimization so the phone doesn't stop it in the background (media-controls.js)
  if (window.MurielBackground && trRow) {
    const bg = window.MurielBackground;
    const row = document.createElement('div');
    row.className = 'setting-item';
    row.innerHTML = `
      <div class="setting-item-top" style="align-items: center;">
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <span class="setting-name" data-i18n>Play in the background</span>
          <span style="font-size: calc(12px * var(--font-scale, 1)); color: var(--md-sys-color-outline);" data-i18n>Some phones stop apps to save battery, even while music plays. Allow Noctra to keep running.</span>
        </div>
        <button class="btn-pill-primary" type="button" data-i18n>Allow</button>
      </div>`;
    const btn = row.querySelector('button');
    const refresh = () => bg.allowed().then((ok) => { btn.textContent = ok ? 'Allowed' : 'Allow'; btn.disabled = ok; });
    btn.addEventListener('click', () => bg.allow().then(refresh));
    // some phones send you to the battery list in Settings instead of asking
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    refresh();
    addPlaybackRow(row);
  }

  // Android: the song in the island at the top of the screen, as an Android 16 live update (media-controls.js).
  // vivo's Origin Island and OPPO's Fluid Cloud only take music apps on their maker's list; a live update they take
  // from any app. Xiaomi's Super Island and Samsung's Now Bar show the playback notification already: no row there.
  if (window.MurielIsland && trRow) {
    const isl = window.MurielIsland;
    isl.status().then((s) => {
      if (!s.vendor || s.vendor === 'xiaomi' || s.vendor === 'samsung' || (!s.supported && s.vendor !== 'vivo')) return;
      const name = { vivo: 'Origin Island', oplus: 'Fluid Cloud' }[s.vendor] || 'Song in the status bar';
      const about = {
        vivo: 'The song in the Origin Island at the top of the screen. vivo’s music capsule only takes apps on vivo’s list, so Noctra shows there as a live update.',
        oplus: 'The song in Fluid Cloud at the top of the screen, as a live update.',
      }[s.vendor] || 'The song as a live update in the status bar.';
      const row = document.createElement('div');
      row.className = 'setting-item';
      row.innerHTML = `
        <div class="setting-item-top" style="align-items: center;">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <span class="setting-name">${name}</span>
            <span class="island-hint" style="font-size: calc(12px * var(--font-scale, 1)); color: var(--md-sys-color-outline);"></span>
            <button class="btn-pill-primary island-fix" type="button" style="align-self: flex-start; margin-top: 6px; display: none;"></button>
          </div>
          <button class="effect-switch-btn" type="button" aria-label="${name}"><span class="thumb"></span></button>
        </div>`;
      const hint = row.querySelector('.island-hint');
      const fix = row.querySelector('.island-fix');
      const sw = row.querySelector('.effect-switch-btn');
      const show = (st) => {
        if (!st.supported) {
          // OriginOS 5 and older: no live updates yet
          hint.textContent = 'Needs OriginOS 6 (Android 16). vivo’s own music capsule only takes apps on vivo’s list.';
          sw.style.display = 'none';
          return;
        }
        const on = isl.enabled(st);
        sw.classList.toggle('active', on);
        let need = '';
        if (on && !st.notifications) { need = ' Allow Noctra’s notifications for it.'; fix.textContent = 'Allow'; }
        else if (on && !st.promoted) {
          need = st.vendor === 'oplus' ? ' Turn on “Show Live Updates on Live Alerts” for Noctra in the phone’s settings.'
            : ' Live updates are turned off for Noctra in the phone’s settings.';
          fix.textContent = 'Settings';
        }
        hint.textContent = about + need;
        fix.style.display = need ? '' : 'none';
      };
      const refresh = () => isl.status().then(show);
      sw.addEventListener('click', () => {
        const on = !sw.classList.contains('active');
        isl.setEnabled(on);
        // turning it on asks for what's missing right away
        (on ? isl.allow() : isl.status()).then(show);
      });
      fix.addEventListener('click', () => isl.allow().then(show));
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); isl.refresh(); } });
      show(s);
      addPlaybackRow(row);
    });
  }

  // settings that only make sense on desktop
  ['btn-hw-accel', 'btn-tray-on-close', 'btn-media-keys'].forEach((id) => {
    const row = document.getElementById(id) && document.getElementById(id).closest('.setting-item');
    if (row) row.style.display = 'none';
  });
})();

// a write to the phone's storage failed (usually: storage full); say so instead of losing it silently
(() => {
  let last = 0;
  window.addEventListener('muriel:storage-error', () => {
    if (Date.now() - last < 30000 || !window.MurielCore || !window.MurielCore.toast) return;
    last = Date.now();
    window.MurielCore.toast((window.MurielI18n || { T: (x) => x, Tm: (x) => x }).Tm('Could not save to storage. Is your phone full?'), 'error');
  });
})();

/* Noctra: the profile avatar moves from the titlebar into the bottom tab bar.
   profiles.js mounts it in the titlebar; this is a small adapter so the same button/menu keeps working. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const moveProfileSwitch = () => {
    const btn = document.getElementById('profile-switch');
    const sidebar = document.getElementById('sidebar');
    if (!btn || !sidebar) return false;
    if (btn.parentElement !== sidebar) sidebar.appendChild(btn);
    return true;
  };
  if (!moveProfileSwitch()) {
    const t = setInterval(() => { if (moveProfileSwitch()) clearInterval(t); }, 120);
    setTimeout(() => clearInterval(t), 5000);
    window.addEventListener('muriel:ready', moveProfileSwitch, { once: true });
  }
})();


/* Noctra: Settings -> Interface -> Hidden menu.
   Off: the normal bottom tab bar. On: the same navigation slides in from the left edge
   as the desktop-style rail, with a small pull tab in the middle of the edge. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;

  const KEY = 'noctra_hidden_nav';
  const root = document.documentElement;
  let pull = null;

  function isOn() { return root.classList.contains('mobile-side-nav'); }
  function isOpen() { return root.classList.contains('mobile-side-nav-open'); }
  function openRail() {
    if (!isOn()) return;
    root.classList.add('mobile-side-nav-open');
    if (pull) pull.setAttribute('aria-expanded', 'true');
  }
  function closeRail() {
    root.classList.remove('mobile-side-nav-open');
    if (pull) pull.setAttribute('aria-expanded', 'false');
  }
  function setHiddenNav(on, persist = true) {
    root.classList.toggle('mobile-side-nav', !!on);
    if (!on) closeRail();
    if (persist) {
      try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    }
    const toggle = document.getElementById('btn-mobile-hidden-nav');
    if (toggle) toggle.classList.toggle('active', !!on);
  }

  function buildChrome() {
    if (!document.getElementById('mobile-rail-backdrop')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'mobile-rail-backdrop';
      backdrop.setAttribute('aria-hidden', 'true');
      backdrop.addEventListener('click', closeRail);
      document.body.appendChild(backdrop);
    }
    const sidebar = document.getElementById('sidebar');
    if (sidebar && sidebar.parentElement !== document.body) document.body.appendChild(sidebar);
    const existingBackdrop = document.getElementById('mobile-rail-backdrop');
    if (existingBackdrop && existingBackdrop.parentElement !== document.body) document.body.appendChild(existingBackdrop);
    if (!document.getElementById('mobile-rail-pull')) {
      pull = document.createElement('button');
      pull.id = 'mobile-rail-pull';
      pull.type = 'button';
      pull.setAttribute('aria-label', 'Open navigation');
      pull.setAttribute('aria-expanded', 'false');
      pull.innerHTML = '<span></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
      pull.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isOpen()) closeRail(); else openRail();
      });
      document.body.appendChild(pull);
    }
    // A transformed sidebar would turn the fixed playlists sheet into its child.
    // Keep the sheet on <body>; the drawer open/close code does not depend on the parent.
    const drawer = document.getElementById('rail-drawer');
    if (drawer && drawer.parentElement && drawer.parentElement.id === 'sidebar') {
      document.body.appendChild(drawer);
    }
  }

  function showToastSafe(text) {
    try {
      if (window.MurielCore && typeof window.MurielCore.toast === 'function') window.MurielCore.toast(text, 'info');
      else if (window.MurielUI && typeof window.MurielUI.toast === 'function') window.MurielUI.toast(text, 'info');
    } catch (e) {}
  }

  function addSetting() {
    const section = document.querySelector('.settings-section[data-cat="interface"]');
    if (!section || document.getElementById('setting-mobile-hidden-nav')) return;
    const group = section.querySelector('.m3-group[data-group="layout"]') || section.querySelector('.m3-group');
    if (!group) return;
    const item = document.createElement('div');
    item.className = 'setting-item';
    item.id = 'setting-mobile-hidden-nav';
    item.innerHTML = `
      <div class="setting-item-top" style="align-items:center;">
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="setting-name" data-no-i18n>${localStorage.getItem('muriel_ui_lang')==='ru'?'Боковое меню':'Side menu'}</span>
            <span class="noctra-beta-badge">NEW</span>
          </div>
          <span class="setting-hint" data-no-i18n>${localStorage.getItem('muriel_ui_lang')==='ru'?'Боковая панель вместо нижней строки' :'Use a side rail that slides in from the left edge instead of the bottom bar'}</span>
        </div>
        <button type="button" class="effect-switch-btn" id="btn-mobile-hidden-nav"><span class="thumb"></span></button>
      </div>`;
    group.insertBefore(item, group.querySelector('.setting-item') || null);
    const toggle = item.querySelector('#btn-mobile-hidden-nav');
    toggle.addEventListener('click', () => {
      const next = !isOn();
      setHiddenNav(next);
      if (next) showToastSafe('Swipe from the left edge or tap the tab to open the menu');
    });
    if (window.MurielI18n && typeof window.MurielI18n.refresh === 'function') {
      try { window.MurielI18n.refresh(); } catch (e) {}
    }
  }

  function wireGestures() {
    let sx = 0, sy = 0, tracking = false;
    document.addEventListener('touchstart', (e) => {
      if (!isOn()) { tracking = false; return; }
      const t = e.touches[0];
      if (!t) return;
      if (!isOpen() && t.clientX <= 22) { tracking = true; sx = t.clientX; sy = t.clientY; }
      else if (isOpen() && t.clientX <= 96) { tracking = true; sx = t.clientX; sy = t.clientY; }
      else tracking = false;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientY - sy) > 46) tracking = false;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx;
      if (!isOpen() && dx > 48) openRail();
      else if (isOpen() && dx < -48) closeRail();
    }, { passive: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRail(); });
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      sidebar.addEventListener('click', (e) => {
        if (e.target.closest('.nav-item') && isOn()) setTimeout(closeRail, 140);
      });
    }
  }

  const start = () => {
    buildChrome();
    addSetting();
    wireGestures();
    let stored = localStorage.getItem(KEY);
    if (stored === null) {
      stored = '1';
      try { localStorage.setItem(KEY, '1'); } catch (e) {}
    } else if (stored === '0' && !localStorage.getItem('noctra_side_nav_migrated')) {
      stored = '1';
      try { localStorage.setItem(KEY, '1'); localStorage.setItem('noctra_side_nav_migrated', '1'); } catch (e) {}
    }
    setHiddenNav(stored === '1', false);
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', addSetting, { once: true });
})();

/* Noctra: the bottom-bar playlist button opens a full Playlists page instead of the old drawer. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  let page = null;
  let listEl = null;

  const cores = () => window.MurielCore || null;
  const icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 12H3M16 6H3M12 18H3"/></svg>';
  const closeIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  function coverFor(pl) {
    if (pl && pl.cover) return pl.cover;
    const track = pl && Array.isArray(pl.tracks) ? pl.tracks.find(Boolean) : null;
    const core = cores();
    if (track && core && typeof core.thumb === 'function') {
      try { return core.thumb(track) || ''; } catch (e) {}
    }
    return track && (track.thumbnail || track.cover || track.image || '') || '';
  }

  function render() {
    if (!listEl) return;
    const core = cores();
    const playlists = core && core.state && Array.isArray(core.state.playlists) ? core.state.playlists : [];
    listEl.innerHTML = '';
    if (!playlists.length) {
      const empty = document.createElement('div');
      empty.className = 'mobile-playlists-empty';
      empty.textContent = 'No playlists yet. Create your first one.';
      listEl.appendChild(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'mobile-playlists-grid';
    for (const pl of playlists) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'mobile-playlist-card';
      const cover = document.createElement('div');
      cover.className = 'mobile-playlist-cover';
      const src = coverFor(pl);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => { img.remove(); cover.innerHTML = icon; }, { once: true });
        cover.appendChild(img);
      } else {
        cover.innerHTML = icon;
      }
      const name = document.createElement('span');
      name.className = 'mobile-playlist-name';
      name.textContent = pl.name || 'Untitled playlist';
      const count = document.createElement('span');
      count.className = 'mobile-playlist-count';
      const n = Array.isArray(pl.tracks) ? pl.tracks.length : 0;
      count.textContent = `${n} song${n === 1 ? '' : 's'}`;
      card.appendChild(cover);
      card.appendChild(name);
      card.appendChild(count);
      card.addEventListener('click', () => {
        close();
        if (core && typeof core.openPlaylist === 'function') core.openPlaylist(pl.id);
      });
      grid.appendChild(card);
    }
    listEl.appendChild(grid);
  }

  function open() {
    if (!page) return;
    render();
    page.classList.add('open');
    document.documentElement.classList.add('mobile-playlists-open');
    const drawer = document.getElementById('rail-drawer');
    if (drawer) drawer.classList.add('hidden');
  }

  function close() {
    if (!page) return;
    page.classList.remove('open');
    document.documentElement.classList.remove('mobile-playlists-open');
  }

  function build() {
    if (page) return;
    page = document.createElement('section');
    page.id = 'mobile-playlists-page';
    page.setAttribute('aria-label', 'Playlists');
    page.innerHTML = `
      <div class="mobile-playlists-head">
        <h2>Playlists</h2>
        <div class="mobile-playlists-head-actions">
          <button type="button" class="btn-outline-pill" id="btn-mobile-playlists-new">New</button>
          <button type="button" class="btn-icon-pill" id="btn-mobile-playlists-close" aria-label="Close">${closeIcon}</button>
        </div>
      </div>
      <div class="mobile-playlists-body"></div>`;
    listEl = page.querySelector('.mobile-playlists-body');
    page.querySelector('#btn-mobile-playlists-close').addEventListener('click', close);
    page.querySelector('#btn-mobile-playlists-new').addEventListener('click', () => {
      close();
      const btn = document.getElementById('btn-new-playlist');
      if (btn) btn.click();
    });
    document.body.appendChild(page);
    let sx = null, sy = null;
    page.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (!t) return;
      sx = t.clientX; sy = t.clientY;
    }, { passive: true });
    page.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - sx, dy = t.clientY - sy;
      sx = null;
      if (dy > 90 && Math.abs(dx) < 70) close();
    }, { passive: true });
    window.addEventListener('muriel:library', () => { if (page.classList.contains('open')) render(); });
  }

  function interceptDrawerButton() {
    const btn = document.getElementById('btn-toggle-playlists-drawer');
    if (!btn || btn.dataset.noctraPage === '1') return;
    btn.dataset.noctraPage = '1';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      open();
    }, true);
  }

  const start = () => { build(); interceptDrawerButton(); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', interceptDrawerButton, { once: true });
})();

/* Noctra: short first-run tour. Skippable, never shown again after it finishes. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const KEY = 'noctra_tour_done';
  let root = null, spot = null, card = null, titleEl = null, bodyEl = null, nextBtn = null;
  let step = 0;
  const steps = [
    { sel: '.search-box', title: 'Search', body: 'Find songs, artists and albums here.' },
    { sel: '#mobile-rail-pull', title: 'Side menu', body: 'Swipe from the left edge or tap this tab to open Home, Favorites, History and Settings.' },
    { sel: '#playbar', title: 'Player', body: 'Tap the mini player to open Now Playing, lyrics and the queue.' },
    { sel: '#profile-switch', title: 'Your profile', body: 'Your profile and account live at the top of the side menu.' }
  ];

  function finish() {
    try { localStorage.setItem(KEY, '1'); } catch (e) {}
    if (root) root.classList.remove('open');
    document.documentElement.classList.remove('mobile-side-nav-open');
  }

  function position() {
    if (!root || !root.classList.contains('open')) return;
    const item = steps[step];
    const sideMode = document.documentElement.classList.contains('mobile-side-nav');
    if (item && item.sel === '#profile-switch' && sideMode && !document.documentElement.classList.contains('mobile-side-nav-open')) {
      const pull = document.getElementById('mobile-rail-pull');
      if (pull) pull.click();
      setTimeout(position, 420);
      return;
    }
    const selector = item && item.sel === '#mobile-rail-pull' && !sideMode ? '.sidebar' : (item && item.sel);
    const target = selector && document.querySelector(selector);
    if (!target) { next(); return; }
    const r = target.getBoundingClientRect();
    const pad = 8;
    const top = Math.max(6, r.top - pad);
    const left = Math.max(6, r.left - pad);
    const width = Math.min(window.innerWidth - 12, r.width + pad * 2);
    const height = Math.min(window.innerHeight - 12, r.height + pad * 2);
    spot.style.top = `${top}px`;
    spot.style.left = `${left}px`;
    spot.style.width = `${width}px`;
    spot.style.height = `${height}px`;
    const cardH = card.offsetHeight || 150;
    const below = top + height + 14;
    const above = top - cardH - 14;
    card.style.top = `${Math.max(12, below + cardH < window.innerHeight - 8 ? below : above)}px`;
    titleEl.textContent = item.title;
    bodyEl.textContent = item.body;
    nextBtn.textContent = step === steps.length - 1 ? 'Done' : 'Next';
  }

  function next() {
    if (step >= steps.length - 1) { finish(); return; }
    step++;
    position();
  }

  function start() {
    if (localStorage.getItem(KEY) === '1') return;
    root = document.createElement('div');
    root.id = 'noctra-tour';
    root.innerHTML = `<div id="noctra-tour-spot"></div><div id="noctra-tour-card"><h3></h3><p></p><div id="noctra-tour-actions"><button type="button" id="noctra-tour-skip">Skip tour</button><button type="button" id="noctra-tour-next">Next</button></div></div>`;
    document.body.appendChild(root);
    spot = root.querySelector('#noctra-tour-spot');
    card = root.querySelector('#noctra-tour-card');
    titleEl = card.querySelector('h3');
    bodyEl = card.querySelector('p');
    nextBtn = root.querySelector('#noctra-tour-next');
    root.querySelector('#noctra-tour-skip').addEventListener('click', finish);
    nextBtn.addEventListener('click', next);
    root.classList.add('open');
    requestAnimationFrame(position);
    window.addEventListener('resize', position);
    window.addEventListener('orientationchange', () => setTimeout(position, 250));
  }

  const launch = () => setTimeout(start, 1400);
  if (document.readyState === 'complete' || document.readyState === 'interactive') launch();
  else document.addEventListener('DOMContentLoaded', launch, { once: true });
})();

/* Noctra: account card at the top of Settings, like the desktop sidebar. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  function addAccount() {
    const nav = document.querySelector('#view-settings .settings-nav');
    if (!nav || document.getElementById('settings-mobile-account')) return;
    const P = window.MurielProfiles;
    const me = P && typeof P.current === 'function' ? P.current() : { name: 'Profile', color: '#6750A4' };
    const name = (me && me.name) || 'Profile';
    const initial = Array.from(String(name).trim())[0] ? Array.from(String(name).trim())[0].toUpperCase() : '?';
    const color = (me && me.color) || '#6750A4';
    const btn = document.createElement('button');
    btn.id = 'settings-mobile-account';
    btn.type = 'button';
    btn.innerHTML = `<span class="profile-avatar" style="background:${color};color:#fff">${initial}</span><span class="acc-meta"><span class="acc-name"></span><span class="acc-sub">Account</span></span><svg class="acc-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;
    btn.querySelector('.acc-name').textContent = name;
    btn.addEventListener('click', () => {
      const target = nav.querySelector('.settings-nav-btn[data-cat="profiles"]');
      if (target) target.click();
    });
    nav.parentElement.insertBefore(btn, nav);
  }
  const go = () => { addAccount(); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') go();
  else document.addEventListener('DOMContentLoaded', go, { once: true });
  window.addEventListener('muriel:ready', go, { once: true });
})();

/* Noctra: compact player waveform timeline. It doubles as the seek bar. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const canvas = document.getElementById('noctra-mini-wave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, dpr = 1, raf = 0, lastKey = '', seed = 7, dragging = false;
  let cachedPrimary = '#d0bcff', cachedOn = '#ffffff';
  const core = () => window.MurielCore;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function refreshColors() {
    const cs = getComputedStyle(document.documentElement);
    cachedPrimary = cs.getPropertyValue('--md-sys-color-primary').trim() || cachedPrimary;
    cachedOn = cs.getPropertyValue('--md-sys-color-on-surface').trim() || cachedOn;
  }
  function trackState() {
    const c = core();
    const audio = c && c.audio;
    const track = c && c.state && c.state.currentTrack;
    const duration = audio && Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration : Number(track && track.duration) || 0;
    const current = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const key = track ? String(track.id || '') + '|' + String(track.title || '') : 'none';
    return { core: c, audio, track, duration, current, playing: !!(c && c.state && c.state.isPlaying), key };
  }
  function draw(ts) {
    if (!cw || !ch) return;
    const st = trackState();
    if (st.key !== lastKey) { lastKey = st.key; seed = hash(st.key) || 7; }
    const ratio = st.duration > 0 ? clamp(st.current / st.duration, 0, 1) : 0;
    if (window.NoctraWaveRenderer) {
      window.NoctraWaveRenderer.draw(ctx, { w: cw, h: ch, ratio, playing: st.playing, ts, seed, primary: cachedPrimary, on: cachedOn });
      raf = st.playing ? requestAnimationFrame(draw) : 0;
      return;
    }
    const n = Math.max(28, Math.min(64, Math.floor(cw / 5)));
    const gap = 1.3;
    const bw = Math.max(1.4, (cw - gap * (n - 1)) / n);
    const phase = st.playing ? ts * 0.0045 : 0;
    ctx.clearRect(0, 0, cw, ch);
    for (let i = 0; i < n; i++) {
      const p = i / Math.max(1, n - 1);
      const base = 0.32 + 0.68 * Math.abs(Math.sin((i + (seed % 19)) * 0.71 + seed * 0.013));
      const wobble = st.playing ? 0.30 * Math.sin(ts * 0.006 + i * 0.57) : 0.08 * Math.sin(i * 0.8 + seed);
      const envelope = Math.pow(Math.sin(p * Math.PI), 0.55);
      const amp = clamp(base + wobble, 0.12, 1) * envelope;
      const bh = 2 + amp * (ch - 5);
      const x = i * (bw + gap);
      const played = p <= ratio;
      ctx.globalAlpha = played ? 0.96 : 0.25;
      ctx.fillStyle = played ? cachedPrimary : cachedOn;
      ctx.fillRect(x, (ch - bh) / 2, bw, bh);
    }
    const px = clamp(ratio, 0, 1) * cw;
    ctx.globalAlpha = 1;
    ctx.fillStyle = cachedPrimary;
    ctx.shadowColor = cachedPrimary;
    ctx.shadowBlur = 8;
    ctx.fillRect(Math.max(0, px - 0.75), 1, 1.5, ch - 2);
    ctx.shadowBlur = 0;
    if (st.playing) raf = requestAnimationFrame(draw);
    else raf = 0;
  }
  function kick() {
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function resize() {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = window.devicePixelRatio || 1;
    cw = r.width; ch = r.height;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    kick();
  }
  function seekAt(clientX) {
    const st = trackState();
    if (!st.duration || !st.core || typeof st.core.seek !== 'function') return;
    const r = canvas.getBoundingClientRect();
    const ratio = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
    st.core.seek(ratio * st.duration);
    kick();
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    seekAt(e.clientX);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    seekAt(e.clientX);
  });
  const endDrag = (e) => { dragging = false; try { e.stopPropagation(); } catch (_) {} };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('click', (e) => e.stopPropagation());
  canvas.addEventListener('keydown', (e) => {
    const st = trackState();
    if (!st.audio || !st.duration) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 5 : -5;
      st.core.seek(clamp((st.audio.currentTime || 0) + step, 0, st.duration));
      kick();
    }
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  window.addEventListener('muriel:track', () => { refreshColors(); kick(); });
  const audio = (core() && core().audio) || document.querySelector('audio');
  if (audio) ['play','pause','seeked','timeupdate','loadedmetadata','durationchange'].forEach((ev) => audio.addEventListener(ev, kick));
  setInterval(() => { refreshColors(); if (core() && core().state && core().state.isPlaying) kick(); }, 900);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas);
  setTimeout(() => { refreshColors(); resize(); }, 800);
})();

/* Noctra: ambient waveform behind the full Now Playing controls. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const canvas = document.getElementById('noctra-full-wave');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let cw = 0, ch = 0, raf = 0, seed = 11, lastKey = '';
  let primary = '#d0bcff', on = '#ffffff';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const core = () => window.MurielCore;
  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function palette() {
    const cs = getComputedStyle(document.documentElement);
    primary = cs.getPropertyValue('--md-sys-color-primary').trim() || primary;
    on = cs.getPropertyValue('--md-sys-color-on-surface').trim() || on;
  }
  function state() {
    const c = core(); const a = c && c.audio; const t = c && c.state && c.state.currentTrack;
    const duration = a && Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Number(t && t.duration) || 0;
    const current = a && Number.isFinite(a.currentTime) ? a.currentTime : 0;
    const key = t ? String(t.id || '') + '|' + String(t.title || '') : 'none';
    return { c, a, t, duration, ratio: duration ? clamp(current / duration, 0, 1) : 0, playing: !!(c && c.state && c.state.isPlaying), key };
  }
  function draw(ts) {
    if (!cw || !ch) { raf = 0; return; }
    const st = state();
    if (st.key !== lastKey) { lastKey = st.key; seed = hash(st.key) || 11; }
    if (window.NoctraWaveRenderer) {
      window.NoctraWaveRenderer.draw(ctx, { w: cw, h: ch, ratio: st.ratio, playing: st.playing, ts, seed, primary, on });
      raf = st.playing ? requestAnimationFrame(draw) : 0;
      return;
    }
    const n = Math.max(40, Math.min(88, Math.floor(cw / 5)));
    const gap = 1.8;
    const bw = Math.max(1.2, (cw - gap * (n - 1)) / n);
    const phase = st.playing ? ts * 0.0038 : 0;
    ctx.clearRect(0, 0, cw, ch);
    for (let i = 0; i < n; i++) {
      const p = i / Math.max(1, n - 1);
      const base = 0.25 + 0.75 * Math.abs(Math.sin((i + (seed % 23)) * 0.57 + seed * 0.009));
      const wobble = st.playing ? 0.26 * Math.sin(ts * 0.005 + i * 0.43) : 0.07 * Math.sin(i * 0.6 + seed);
      const env = Math.pow(Math.sin(p * Math.PI), 0.5);
      const amp = clamp(base + wobble, 0.1, 1) * env;
      const bh = 2 + amp * (ch - 8);
      ctx.globalAlpha = p <= st.ratio ? 0.9 : 0.20;
      ctx.fillStyle = p <= st.ratio ? primary : on;
      ctx.fillRect(i * (bw + gap), ch - bh, bw, bh);
    }
    const px = clamp(st.ratio, 0, 1) * cw;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = primary;
    ctx.shadowColor = primary;
    ctx.shadowBlur = 10;
    ctx.fillRect(Math.max(0, px - 0.9), 0, 1.8, ch);
    ctx.shadowBlur = 0;
    raf = st.playing ? requestAnimationFrame(draw) : 0;
  }
  function kick() { if (!raf) raf = requestAnimationFrame(draw); }
  function resize() {
    if (!document.body.classList.contains('np-open') || canvas.offsetParent === null) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    cw = r.width; ch = r.height;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    palette();
    kick();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  new MutationObserver(() => { if (document.body.classList.contains('np-open')) setTimeout(resize, 60); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('muriel:track', () => { palette(); kick(); });
  const audio = (core() && core().audio) || document.querySelector('audio');
  if (audio) ['play','pause','seeked','timeupdate','loadedmetadata'].forEach((ev) => audio.addEventListener(ev, () => { if (document.body.classList.contains('np-open')) kick(); }));
  setInterval(() => { if (document.body.classList.contains('np-open')) { palette(); if (core() && core().state && core().state.isPlaying) kick(); } }, 900);
  setTimeout(resize, 900);
})();

/* Noctra: + in the mini player opens the normal Add to playlist sheet. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const btn = document.getElementById('btn-noctra-add-playlist');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const core = window.MurielCore;
    const track = core && core.state && core.state.currentTrack;
    if (!track) { try { core.toast('Play a song first', 'info'); } catch (_) {} return; }
    if (core && typeof core.openAddToPlaylist === 'function') core.openAddToPlaylist(track);
  });
})();

/* Noctra: shared waveform renderer for the mini and full player.
   Styles: bars, wave, ribbon, aurora. Chosen in Settings -> Interface -> Visualizer. */
(() => {
  const KEY = 'noctra_wave_style';
  const styles = ['bars', 'wave', 'ribbon', 'aurora'];
  function getStyle() {
    const v = localStorage.getItem(KEY);
    return styles.includes(v) ? v : 'wave';
  }
  function heights(n, seed, playing, ts) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = i / Math.max(1, n - 1);
      const base = 0.28 + 0.72 * Math.abs(Math.sin((i + (seed % 23)) * 0.61 + seed * 0.011));
      const wobble = playing ? 0.25 * Math.sin(ts * 0.0055 + i * 0.49) : 0.06 * Math.sin(i * 0.7 + seed);
      out[i] = Math.max(0.12, Math.min(1, (base + wobble) * Math.pow(Math.sin(p * Math.PI), 0.55)));
    }
    return out;
  }
  function trace(ctx, hs, w, h, amp, offset) {
    const n = hs.length;
    const pts = [];
    for (let i = 0; i < n; i++) {
      pts.push({ x: (i / Math.max(1, n - 1)) * w, y: h - (2 + hs[i] * Math.max(2, h - 4) * amp) - offset });
    }
    const p0 = { x: -1, y: pts[0].y };
    const pn = { x: w + 1, y: pts[pts.length - 1].y };
    const all = [p0, ...pts, pn];
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(all[0].x, all[0].y);
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[Math.max(0, i - 1)];
      const b = all[i];
      const c = all[i + 1];
      const d = all[Math.min(all.length - 1, i + 2)];
      const t = 0.18;
      ctx.bezierCurveTo(b.x + (c.x - a.x) * t, b.y + (c.y - a.y) * t, c.x - (d.x - b.x) * t, c.y - (d.y - b.y) * t, c.x, c.y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
  }
  function draw(ctx, o) {
    const { w, h, ratio, playing, ts, seed, primary, on } = o;
    const style = o.style || getStyle();
    const n = Math.max(24, Math.min(84, Math.floor(w / (h > 60 ? 7 : 5))));
    const hs = heights(n, seed, playing, ts);
    ctx.clearRect(0, 0, w, h);
    if (style === 'bars') {
      const gap = h > 60 ? 1.8 : 1.2;
      const bw = Math.max(1.2, (w - gap * (n - 1)) / n);
      for (let i = 0; i < n; i++) {
        const bh = 2 + hs[i] * (h - 5);
        const p = i / Math.max(1, n - 1);
        ctx.fillStyle = primary;
        ctx.globalAlpha = p <= ratio ? 0.95 : 0.16;
        ctx.fillRect(i * (bw + gap), h - bh, bw, bh);
      }
    } else if (style === 'ribbon') {
      const layers = [
        { amp: 0.92, off: 0, width: h > 60 ? 2.6 : 1.7, alpha: 0.9 },
        { amp: 0.66, off: h > 60 ? 14 : 3, width: 1.4, alpha: 0.42 },
        { amp: 0.42, off: h > 60 ? 26 : 6, width: 1, alpha: 0.24 }
      ];
      for (const l of layers) {
        ctx.save();
        ctx.globalAlpha = l.alpha;
        ctx.strokeStyle = primary;
        ctx.lineWidth = l.width;
        ctx.lineCap = 'round';
        ctx.shadowColor = primary;
        ctx.shadowBlur = h > 60 ? 12 : 5;
        trace(ctx, hs, w, h, l.amp, l.off);
        ctx.stroke();
        ctx.restore();
      }
    } else {
      // filled smooth wave / aurora
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = primary;
      trace(ctx, hs, w, h, 1, 0);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w * ratio, h);
      ctx.clip();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, primary);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = style === 'aurora' ? 0.8 : 0.9;
      ctx.fillStyle = grad;
      trace(ctx, hs, w, h, 1, 0);
      ctx.fill();
      if (style === 'aurora') {
        ctx.globalAlpha = 0.30;
        trace(ctx, hs, w, h, 0.66, h > 60 ? 18 : 4);
        ctx.fill();
      }
      ctx.restore();
    }
    const px = Math.max(0, Math.min(1, ratio)) * w;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = primary;
    ctx.shadowColor = primary;
    ctx.shadowBlur = h > 60 ? 12 : 6;
    ctx.fillRect(Math.max(0, px - (h > 60 ? 1 : 0.7)), 0, h > 60 ? 2 : 1.4, h);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
  window.NoctraWaveRenderer = { draw, getStyle, styles };
})();

/* Noctra: wave style dropdown in Settings -> Interface -> Visualizer. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const KEY = 'noctra_wave_style';
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  const styles = [
    ['bars', 'Bars', 'Полосы'], ['wave', 'Wave', 'Волна'],
    ['ribbon', 'Ribbon', 'Лента'], ['aurora', 'Aurora', 'Аврора']
  ];
  const current = () => {
    const v = localStorage.getItem(KEY);
    return styles.some(([id]) => id === v) ? v : 'wave';
  };
  const nameOf = (id) => {
    const row = styles.find(([x]) => x === id) || styles[1];
    return ru() ? row[2] : row[1];
  };
  function add() {
    const section = document.querySelector('.settings-section[data-cat="interface"]');
    if (!section || document.getElementById('setting-wave-style')) return;
    const group = section.querySelector('.m3-group[data-group="visualizer"]') || section.querySelector('.m3-group');
    if (!group) return;
    const item = document.createElement('div');
    item.className = 'setting-item';
    item.id = 'setting-wave-style';
    item.innerHTML = `
      <div class="setting-item-top" style="align-items:flex-start;flex-direction:column;gap:8px;">
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span class="setting-name" data-no-i18n>${ru() ? 'Стиль волны' : 'Player wave style'}</span>
            <span class="noctra-beta-badge">NEW</span>
          </div>
          <span class="setting-hint" data-no-i18n>${ru() ? 'Выберите волну для мини- и полноэкранного плеера' : 'Choose the wave used by the mini and full player'}</span>
        </div>
        <div class="m3-dropdown" id="wave-style-dropdown" style="width:100%;">
          <button class="m3-dropdown-trigger" id="wave-style-trigger" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span class="m3-dropdown-label" id="wave-style-label" data-no-i18n>${nameOf(current())}</span>
            <svg class="m3-dropdown-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <div class="m3-dropdown-menu" id="wave-style-menu" role="listbox">
            ${styles.map(([id, en, ruName]) => `<button type="button" class="m3-dropdown-option${current() === id ? ' selected' : ''}" data-value="${id}" data-no-i18n>${ru() ? ruName : en}</button>`).join('')}
          </div>
        </div>
      </div>`;
    group.insertBefore(item, group.querySelector('.setting-item') || null);
    const wrap = item.querySelector('#wave-style-dropdown');
    const trigger = item.querySelector('#wave-style-trigger');
    const label = item.querySelector('#wave-style-label');
    const menu = item.querySelector('#wave-style-menu');
    const opts = item.querySelectorAll('.m3-dropdown-option');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = wrap.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    opts.forEach((btn) => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      localStorage.setItem(KEY, btn.dataset.value);
      label.textContent = nameOf(btn.dataset.value);
      opts.forEach((b) => b.classList.toggle('selected', b === btn));
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      window.dispatchEvent(new Event('muriel:track'));
    }));
    document.addEventListener('click', () => {
      wrap.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    });
  }
  const go = () => add();
  if (document.readyState === 'complete' || document.readyState === 'interactive') go();
  else document.addEventListener('DOMContentLoaded', go, { once: true });
  window.addEventListener('muriel:ready', go, { once: true });
})();

/* Noctra: Now Playing cover badge, glow and the compact tempo panel from the concept. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const panel = document.getElementById('right-panel');
  const cover = document.getElementById('cover-container');
  const center = document.querySelector('.playbar-center');
  if (!panel || !cover || !center) return;

  let badge = null;
  function profileBadge() {
    if (badge) return;
    const P = window.MurielProfiles;
    const me = P && typeof P.current === 'function' ? P.current() : { name: 'Noctra' };
    badge = document.createElement('div');
    badge.id = 'np-profile-badge';
    badge.innerHTML = '<span class="np-badge-name"></span><span class="np-badge-star">✦</span><span class="np-badge-level"></span>';
    badge.querySelector('.np-badge-name').textContent = (me && me.name) || 'Noctra';
    const syncLevel = () => {
      const xp = window.NoctraXP ? window.NoctraXP.total() : 0;
      const tier = window.NoctraXP ? window.NoctraXP.rankFor(xp).rank.tier : 1;
      const level = badge.querySelector('.np-badge-level');
      if (level) level.textContent = 'LVL ' + tier;
    };
    syncLevel();
    window.addEventListener('noctra:xp', syncLevel);
    setInterval(syncLevel, 5000);
    cover.appendChild(badge);
  }
  profileBadge();

  let tempo = null;
  function buildTempo() {
    if (tempo) return;
    tempo = document.createElement('div');
    tempo.id = 'np-tempo-panel';
    const ticks = Array.from({ length: 27 }, () => '<i></i>').join('');
    tempo.innerHTML = `
      <div class="np-tempo-head"><span>Speed &amp; pitch</span><span id="np-pitch-label">Pitch: 0 st</span></div>
      <div class="np-tempo-presets">
        ${[0.8,0.9,1.0,1.15,1.25,1.35].map((v) => `<button type="button" data-tempo-speed="${v}">x${v.toFixed(2).replace(/0$/, '')}</button>`).join('')}
      </div>
      <div class="np-tempo-ruler-row">
        <button type="button" class="np-tempo-step" data-tempo-dir="-1" aria-label="Slower">−</button>
        <div class="np-tempo-scale" id="np-tempo-scale">
          <div class="np-tempo-ticks">${ticks}</div>
          <input type="range" id="np-tempo-range" min="0.8" max="1.35" step="0.05" value="1.0" aria-label="Speed">
          <span class="np-tempo-pointer"></span>
        </div>
        <button type="button" class="np-tempo-step" data-tempo-dir="1" aria-label="Faster">+</button>
      </div>
      <div class="np-tempo-foot"><span id="np-speed-label">Speed: 1.00x</span><span>Pitch changes in Audio</span></div>`;
    center.appendChild(tempo);
    const range = tempo.querySelector('#np-tempo-range');
    const scale = tempo.querySelector('#np-tempo-scale');
    const speedLabel = tempo.querySelector('#np-speed-label');
    const pitchLabel = tempo.querySelector('#np-pitch-label');
    const buttons = [...tempo.querySelectorAll('[data-tempo-speed]')];
    const currentSpeed = () => {
      const c = window.MurielCore;
      const t = c && typeof c.audioTempo === 'function' ? c.audioTempo() : { speed: 1, speedPitch: 1, pitch: 0 };
      return t.speedPitch !== 1 && t.speed === 1 ? t.speedPitch : t.speed;
    };
    const sync = () => {
      const c = window.MurielCore;
      const t = c && typeof c.audioTempo === 'function' ? c.audioTempo() : { speed: 1, speedPitch: 1, pitch: 0 };
      const val = t.speedPitch !== 1 && t.speed === 1 ? t.speedPitch : t.speed;
      range.value = String(Math.max(0.8, Math.min(1.35, val)));
      scale.style.setProperty('--v', String((val - 0.8) / 0.55));
      speedLabel.textContent = `Speed: ${val.toFixed(2)}x`;
      pitchLabel.textContent = `Pitch: ${t.pitch > 0 ? '+' : ''}${t.pitch} st`;
      buttons.forEach((b) => b.classList.toggle('active', Math.abs(Number(b.dataset.tempoSpeed) - val) < 0.011));
    };
    const setSpeed = (val) => {
      const c = window.MurielCore;
      if (c && typeof c.setTempoSpeed === 'function') c.setTempoSpeed(val);
      sync();
    };
    range.addEventListener('input', () => setSpeed(range.value));
    buttons.forEach((b) => b.addEventListener('click', () => setSpeed(b.dataset.tempoSpeed)));
    tempo.querySelectorAll('[data-tempo-dir]').forEach((b) => b.addEventListener('click', () => {
      setSpeed(currentSpeed() + Number(b.dataset.tempoDir) * 0.05);
    }));
    window.addEventListener('muriel:track', sync);
    if (window.MurielCore && window.MurielCore.audio) ['play','pause','seeked','loadedmetadata'].forEach((ev) => window.MurielCore.audio.addEventListener(ev, sync));
    setTimeout(sync, 600);
  }
  buildTempo();
})();

/* Noctra: live background + a PC-style home heading. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const KEY = 'noctra_live_bg';
  function buildLive() {
    let bg = document.getElementById('noctra-live-bg');
    if (!bg) {
      bg = document.createElement('div');
      bg.id = 'noctra-live-bg';
      bg.setAttribute('aria-hidden', 'true');
      bg.innerHTML = '<i class="noctra-orb"></i><i class="noctra-orb"></i><i class="noctra-orb"></i>' + Array.from({ length: 16 }, () => '<i class="noctra-dot"></i>').join('');
      const dots = bg.querySelectorAll('.noctra-dot');
      dots.forEach((d, i) => {
        d.style.left = `${(i * 37 + 11) % 96}%`;
        d.style.top = `${(i * 53 + 9) % 92}%`;
        d.style.animationDelay = `${-(i * 0.73).toFixed(2)}s`;
        d.style.animationDuration = `${(7 + (i % 6) * 1.4).toFixed(1)}s`;
      });
      document.body.appendChild(bg);
    }
    const on = localStorage.getItem(KEY) !== '0';
    document.documentElement.classList.toggle('noctra-live-off', !on);
    return on;
  }
  function homeHeader() {
    const view = document.getElementById('view-discover');
    if (!view || document.getElementById('noctra-home-header')) return;
    const header = document.createElement('div');
    header.id = 'noctra-home-header';
    header.className = 'noctra-home-header';
    const hour = new Date().getHours();
    const ru = localStorage.getItem('muriel_ui_lang') === 'ru';
    const greeting = ru
      ? (hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер')
      : (hour < 6 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
    header.innerHTML = '<div><span class="nkh-kicker">Noctra</span><h1></h1></div><span class="nkh-date"></span>';
    header.querySelector('h1').textContent = greeting;
    try { header.querySelector('.nkh-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); } catch (e) {}
    view.insertBefore(header, view.firstChild);
  }
  function setting() {
    const section = document.querySelector('.settings-section[data-cat="interface"]');
    if (!section || document.getElementById('setting-live-bg')) return;
    const group = section.querySelector('.m3-group[data-group="layout"]') || section.querySelector('.m3-group');
    if (!group) return;
    const item = document.createElement('div');
    item.className = 'setting-item';
    item.id = 'setting-live-bg';
    item.innerHTML = `<div class="setting-item-top" style="align-items:center;"><div style="display:flex;flex-direction:column;gap:2px;"><div style="display:flex;align-items:center;gap:8px;"><span class="setting-name" data-no-i18n>${localStorage.getItem('muriel_ui_lang')==='ru'?'Живой фон':'Live background'}</span><span class="noctra-beta-badge">NEW</span></div><span class="setting-hint" data-no-i18n>${localStorage.getItem('muriel_ui_lang')==='ru'?'Мягкое свечение, следующее за цветом обложки':'Slow ambient light that follows the current cover colour'}</span></div><button type="button" class="effect-switch-btn" id="btn-live-bg"><span class="thumb"></span></button></div>`;
    group.insertBefore(item, group.querySelector('.setting-item') || null);
    const btn = item.querySelector('#btn-live-bg');
    const on = buildLive();
    btn.classList.toggle('active', on);
    btn.addEventListener('click', () => {
      const next = !document.documentElement.classList.contains('noctra-live-off');
      localStorage.setItem(KEY, next ? '0' : '1');
      document.documentElement.classList.toggle('noctra-live-off', next);
      btn.classList.toggle('active', !next);
    });
  }
  const start = () => { buildLive(); homeHeader(); setting(); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', start, { once: true });
})();

/* Noctra: local listener profile with XP, stats and achievements. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  let page = null;
  const pct = (v) => `${Math.max(0, Math.min(100, v))}%`;

  function progressionStore() {
    try {
      const store = JSON.parse(localStorage.getItem('riff_profile_v1') || 'null');
      return (store && store.progression) || {};
    } catch (e) { return {}; }
  }
  function profileExtra() {
    try {
      const p = window.MurielProfiles && typeof window.MurielProfiles.current === 'function' ? window.MurielProfiles.current() : null;
      const key = (p && (p.id || p.name)) || 'default';
      const all = JSON.parse(localStorage.getItem('noctra_profile_extra_v1') || '{}') || {};
      return all[key] || {};
    } catch (e) { return {}; }
  }
  function mxPlaylistTracks() {
    try {
      const list = (window.MurielCore && window.MurielCore.state && window.MurielCore.state.playlists) || [];
      return list.reduce((max, pl) => Math.max(max, Array.isArray(pl.tracks) ? pl.tracks.length : 0), 0);
    } catch (e) { return 0; }
  }
  function data() {
    const P = window.MurielProfiles;
    const me = (P && typeof P.current === 'function' ? P.current() : null) || { name: 'Noctra', color: '#6750A4' };
    let st = {};
    try { st = (window.MurielEncore && window.MurielEncore.stats('all')) || {}; } catch (e) {}
    const core = window.MurielCore && window.MurielCore.state;
    const minutes = Number(st.minutes) || 0;
    const plays = Number(st.plays) || 0;
    const artists = Array.isArray(st.artists) ? st.artists.length : 0;
    const songs = Array.isArray(st.songs) ? st.songs.length : 0;
    const streak = Number(st.streak) || 0;
    const favorites = Array.isArray(core && core.favorites) ? core.favorites.length : 0;
    const playlists = Array.isArray(core && core.playlists) ? core.playlists.length : 0;
    const playlistTracks = mxPlaylistTracks();
    const p = progressionStore();
    const counters = p.counters || {};
    const ex = profileExtra();
    const xp = Math.max(0, window.NoctraXP ? window.NoctraXP.total() : Math.floor(Number(p.totalXP) || 0));
    const rank = window.NoctraXP ? window.NoctraXP.rankFor(xp) : { xp, tier: 1, into: 0, span: 500, percent: 0 };
    return {
      me, minutes, plays, artists, songs, streak, favorites, playlists, playlistTracks,
      xp, rank, p, counters, ex,
      nightPlays: Number(counters.nightPlays) || 0,
      sessionSeconds: Number(counters.maxSessionSeconds) || 0,
      repeatLoops: Number(counters.repeatLoops) || 0,
      shuffleStreak: Number(counters.shuffleStreak) || 0,
      sourceKinds: Array.isArray(counters.sources) ? new Set(counters.sources.map((x) => String(x || '').toLowerCase()).filter(Boolean)).size : 0,
      questsClaimed: Number(counters.questsClaimedTotal) || 0,
      profileComplete: Boolean(String(me.name || '').trim() && String(ex.bio || '').trim() && String(ex.banner || '').trim())
    };
  }
  function avatarData(me) {
    const name = String(me && me.name || 'Noctra').trim();
    const initial = Array.from(name)[0] ? Array.from(name)[0].toUpperCase() : '?';
    return { initial, color: (me && me.color) || '#6750A4' };
  }
  const RARITY_XP = { common: 50, rare: 75, epic: 100, legendary: 150 };
  const ACH_DEFS = [
    { id: 'first_echo', icon: 'The First Echo.png', rarity: 'common', metric: 'tracks_total', target: 1,
      ru: 'Первый отзвук', en: 'The First Echo', rdesc: 'Прослушайте первый трек', edesc: 'Play your first track' },
    { id: 'initiated_darkness', icon: 'Initiated into Darkness.png', rarity: 'common', metric: 'tracks_total', target: 100,
      ru: 'Посвящённый во тьму', en: 'Initiated into Darkness', rdesc: '100 прослушанных треков', edesc: 'Play 100 tracks' },
    { id: 'ether_keeper', icon: 'Guardian of the Ether.png', rarity: 'rare', metric: 'tracks_total', target: 500,
      ru: 'Хранитель эфира', en: 'Guardian of the Ether', rdesc: '500 прослушанных треков', edesc: 'Play 500 tracks' },
    { id: 'abyss_architect', icon: 'Architect of the Abyss.png', rarity: 'epic', metric: 'tracks_total', target: 1000,
      ru: 'Архитектор бездны', en: 'Architect of the Abyss', rdesc: '1000 прослушанных треков', edesc: 'Play 1,000 tracks' },
    { id: 'resonance_lord', icon: 'Master of Resonance.png', rarity: 'legendary', metric: 'tracks_total', target: 5000,
      ru: 'Владыка резонанса', en: 'Master of Resonance', rdesc: '5000 прослушанных треков', edesc: 'Play 5,000 tracks' },
    { id: 'midnight_pilgrim', icon: 'Midnight Pilgrim.png', rarity: 'rare', metric: 'night_plays', target: 1,
      ru: 'Полуночный пилигрим', en: 'Midnight Pilgrim', rdesc: 'Послушайте трек с 00:00 до 06:00', edesc: 'Listen between midnight and 6 AM' },
    { id: 'deep_dive', icon: 'Deep Dive.png', rarity: 'rare', metric: 'session_seconds', target: 10800,
      ru: 'Глубокое погружение', en: 'Deep Dive', rdesc: '3 часа в одном сеансе', edesc: 'Listen for 3 hours in one session' },
    { id: 'void_whisper', icon: 'Whisper of the Void.png', rarity: 'epic', metric: 'album_complete', target: null,
      ru: 'Шёпот пустоты', en: 'Whisper of the Void', rdesc: 'Завершите альбом за один сеанс', edesc: 'Finish an album in one session' },
    { id: 'obsession', icon: 'Obsession.png', rarity: 'rare', metric: 'repeat_loops', target: 10,
      ru: 'Одержимость', en: 'Obsession', rdesc: 'Повторите один трек 10 раз', edesc: 'Repeat one track 10 times' },
    { id: 'blind_fate', icon: 'Blind Fate.png', rarity: 'epic', metric: 'shuffle_streak', target: 50,
      ru: 'Слепая судьба', en: 'Blind Fate', rdesc: '50 треков подряд в случайном порядке', edesc: '50 tracks in a row on shuffle' },
    { id: 'black_pearl', icon: 'Black Pearl.png', rarity: 'common', metric: 'favorites_total', target: 1,
      ru: 'Чёрная жемчужина', en: 'Black Pearl', rdesc: 'Добавьте трек в избранное', edesc: 'Favorite your first track' },
    { id: 'secret_archive', icon: 'Secret Archive.png', rarity: 'rare', metric: 'favorites_total', target: 100,
      ru: 'Тайный архив', en: 'Secret Archive', rdesc: '100 треков в избранном', edesc: '100 favorite tracks' },
    { id: 'shadow_curator', icon: 'Curator of Shadows.png', rarity: 'common', metric: 'playlists_total', target: 1,
      ru: 'Куратор теней', en: 'Curator of Shadows', rdesc: 'Создайте первый плейлист', edesc: 'Create your first playlist' },
    { id: 'grand_grimoire', icon: 'The Grand Grimoire.png', rarity: 'epic', metric: 'playlist_tracks', target: 50,
      ru: 'Великий гримуар', en: 'The Grand Grimoire', rdesc: '50 треков в одном плейлисте', edesc: '50 tracks in one playlist' },
    { id: 'double_resonance', icon: 'Double resonance.png', rarity: 'rare', metric: 'dual_source', target: 2,
      ru: 'Двойной резонанс', en: 'Double Resonance', rdesc: 'Слушайте из двух источников', edesc: 'Listen from two sources' },
    { id: 'continuous_trance', icon: 'Continuous trance.png', rarity: 'rare', metric: 'streak_days', target: 7,
      ru: 'Непрерывный транс', en: 'Continuous Trance', rdesc: '7 дней подряд', edesc: '7-day listening streak' },
    { id: 'eternal_wanderer', icon: 'Eternal Wanderer.png', rarity: 'legendary', metric: 'streak_days', target: 30,
      ru: 'Вечный скиталец', en: 'Eternal Wanderer', rdesc: '30 дней подряд', edesc: '30-day listening streak' },
    { id: 'self_awareness', icon: 'Self-awareness.png', rarity: 'epic', metric: 'profile_complete', target: null,
      ru: 'Осознание личности', en: 'Self-awareness', rdesc: 'Заполните имя, био и баннер', edesc: 'Fill in your name, bio and banner' },
    { id: 'sound_alchemist', icon: 'Alchemist of Sound.png', rarity: 'epic', metric: 'quests_claimed', target: 10,
      ru: 'Алхимик звука', en: 'Alchemist of Sound', rdesc: 'Соберите 10 наград за задания', edesc: 'Claim 10 daily quests' },
    { id: 'ruler_of_noctra', icon: 'Ruler of Noctra.png', rarity: 'legendary', metric: 'max_rank', target: 8,
      ru: 'Повелитель Ноктры', en: 'Ruler of Noctra', rdesc: 'Достигните 8 ранга', edesc: 'Reach rank 8' }
  ];
  function achValue(a, d) {
    switch (a.metric) {
      case 'tracks_total': return Math.max(d.plays, Number(d.p.totalTracksPlayed) || 0);
      case 'favorites_total': return d.favorites;
      case 'playlists_total': return d.playlists;
      case 'playlist_tracks': return d.playlistTracks;
      case 'streak_days': return d.streak;
      case 'quests_claimed': return d.questsClaimed;
      case 'max_rank': return d.rank.rank.tier;
      case 'night_plays': return d.nightPlays;
      case 'session_seconds': return d.sessionSeconds;
      case 'repeat_loops': return d.repeatLoops;
      case 'shuffle_streak': return d.shuffleStreak;
      case 'dual_source': return d.sourceKinds;
      case 'profile_complete': return d.profileComplete ? 1 : 0;
      case 'album_complete': return d.sessionSeconds >= 600 ? 1 : 0;
      default: return 0;
    }
  }
  function achievements(d) {
    const ru = localStorage.getItem('muriel_ui_lang') === 'ru';
    return ACH_DEFS.map((a) => {
      const value = achValue(a, d);
      const storedUnlocked = d.p && d.p.unlocked ? d.p.unlocked : {};
      let done;
      if (storedUnlocked[a.id]) done = true;
      else if (a.metric === 'album_complete') done = d.sessionSeconds >= 600;
      else if (a.metric === 'profile_complete') done = d.profileComplete;
      else if (a.metric === 'dual_source') done = d.sourceKinds >= 2;
      else if (a.metric === 'night_plays') done = d.nightPlays >= 1;
      else done = a.target !== null && value >= a.target;
      const progress = a.target ? Math.max(0, Math.min(100, Math.round((value / a.target) * 100))) : (done ? 100 : 0);
      return {
        ...a,
        title: ru ? a.ru : a.en,
        desc: ru ? a.rdesc : a.edesc,
        done,
        progress,
        value,
        xp: RARITY_XP[a.rarity] || 50
      };
    });
  }
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="8 5 19 12 8 19"/></svg>';
  const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>';
  const ICON_ARTISTS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
  const ICON_FIRE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>';

  function todayStats() {
    try {
      const db = JSON.parse(localStorage.getItem('muriel_listens_v1') || '{}');
      const now = new Date();
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const day = db && db.days && db.days[key];
      let plays = 0, secs = 0;
      if (day && day.k) Object.values(day.k).forEach((v) => { plays += Number(v[0]) || 0; secs += Number(v[1]) || 0; });
      return { plays, minutes: Math.round(secs / 60) };
    } catch (e) { return { plays: 0, minutes: 0 }; }
  }
  function dailyQuests() {
    const ru = localStorage.getItem('muriel_ui_lang') === 'ru';
    const stats = todayStats();
    const prog = progressionStore();
    const favoritesToday = Number(prog.daily && prog.daily.favoritesAdded) || 0;
    const claimed = (id) => {
      try { return !!(window.NoctraXP && typeof window.NoctraXP.questClaimed === 'function' && window.NoctraXP.questClaimed(id)); } catch (e) { return false; }
    };
    const defs = [
      { id: 'immersion', title: ru ? 'Погружение' : 'Deep dive', goal: 30, val: Math.min(30, stats.minutes), unit: ru ? 'мин' : 'min', xp: 10 },
      { id: 'collector', title: ru ? 'Коллекционер' : 'Collector', goal: 3, val: Math.min(3, favoritesToday), unit: ru ? 'в избранном' : 'favorites', xp: 5 },
      { id: 'nightMarathon', title: ru ? 'Ночной марафон' : 'Night marathon', goal: 10, val: Math.min(10, stats.plays), unit: ru ? 'треков' : 'tracks', xp: 8 }
    ];
    return defs.map((q) => ({ ...q, claimed: claimed(q.id) }));
  }
  function achCard(x, ru, compact) {
    const art = 'assets/profile/achievements/' + encodeURIComponent(x.icon);
    return `<div class="np-ach np-rar-${x.rarity}${x.done ? ' unlocked' : ''}">
      <div class="np-ach-icon"><img src="${art}" alt="" loading="lazy"></div>
      <div class="np-ach-copy"><b>${escapeHtml(x.title)}</b><span>${escapeHtml(x.desc)}</span>${compact ? '' : `<div class="npa-track"><i style="width:${x.progress}%"></i></div>`}</div>
    </div>`;
  }
  function showAllAchievements(list) {
    const ru = localStorage.getItem('muriel_ui_lang') === 'ru';
    let modal = document.getElementById('np-ach-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'np-ach-modal';
      modal.innerHTML = '<div class="npa-card"><div class="npa-head"><div><span class="npa-kicker">NOCTRA</span><h3></h3><p class="npa-sub"></p></div><button type="button" class="npa-close" aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="npa-grid"></div></div>';
      modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('.npa-close')) modal.classList.remove('open'); });
      document.body.appendChild(modal);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('open'); });
    }
    modal.querySelector('h3').textContent = ru ? 'Все достижения' : 'All achievements';
    modal.querySelector('.npa-sub').textContent = `${list.filter((x) => x.done).length} / ${list.length}`;
    modal.querySelector('.npa-grid').innerHTML = list.map((x) => achCard(x, ru, false)).join('');
    modal.classList.add('open');
  }
  function render() {
    if (!page) return;
    const ru = localStorage.getItem('muriel_ui_lang') === 'ru';
    const d = data();
    const av = avatarData(d.me);
    const tier = d.rank.rank ? d.rank.rank.tier : 1;
    const xpPct = d.rank.percent || 0;
    const xpText = d.rank.next ? `${d.rank.into} / ${d.rank.span} XP` : `${d.xp} XP`;
    const all = achievements(d);
    const unlocked = all.filter((x) => x.done);
    const preview = [...unlocked, ...all.filter((x) => !x.done)].slice(0, 6);
    const quests = dailyQuests();
    const body = page.querySelector('.np-scroll');
    body.innerHTML = `
      <div class="np-banner">
        <div class="np-identity">
          <div class="np-avatar-wrap"><div class="np-avatar" style="background:${av.color}">${av.initial}</div><span class="np-level">LVL ${tier}</span><img class="np-rank" src="assets/profile/ranks/transparent/${Math.max(1, Math.min(8, tier))}.png" alt=""></div>
          <div><h1>${escapeHtml(d.me.name || 'Noctra')}</h1><p>${d.plays} ${ru ? plural(d.plays, 'прослушивание', 'прослушивания', 'прослушиваний') : plural(d.plays, 'play', 'plays', 'plays')} · ${d.artists} ${ru ? plural(d.artists, 'артист', 'артиста', 'артистов') : plural(d.artists, 'artist', 'artists', 'artists')} · ${d.streak} ${ru ? plural(d.streak, 'день', 'дня', 'дней') : plural(d.streak, 'day', 'days', 'days')}</p></div>
        </div>
        <div class="np-xp"><div class="np-xp-row"><span>${ru ? 'Уровень' : 'Level'} ${tier}</span><span>${xpText}</span></div><div class="np-xp-track"><div class="np-xp-fill" style="width:${pct(xpPct)}"></div></div></div>
      </div>
      <div class="np-stats">
        <div class="np-stat"><span class="np-stat-ico">${ICON_PLAY}</span><b>${d.plays}</b></div>
        <div class="np-stat"><span class="np-stat-ico">${ICON_CLOCK}</span><b>${Math.round(d.minutes / 60)}</b></div>
        <div class="np-stat"><span class="np-stat-ico">${ICON_ARTISTS}</span><b>${d.artists}</b></div>
        <div class="np-stat"><span class="np-stat-ico">${ICON_FIRE}</span><b>${d.streak}</b></div>
      </div>
      <h2 class="np-section-title">${ru ? 'Ежедневные задания' : 'Daily quests'}</h2>
      <div class="np-quests">${quests.map((q) => {
        const done = q.val >= q.goal;
        return `<div class="np-quest ${done ? 'done' : ''}">
          <div class="np-quest-top"><span>${q.title}</span><span>${q.claimed ? '✓' : q.val + '/' + q.goal}</span></div>
          <div class="np-quest-bar"><i style="width:${Math.min(100, (q.val / q.goal) * 100)}%"></i></div>
          <div class="np-quest-sub"><span>${q.val}/${q.goal} ${q.unit}</span>${done && !q.claimed ? `<button type="button" class="np-quest-claim" data-quest="${q.id}" data-xp="${q.xp}">${ru ? 'Забрать' : 'Claim'} +${q.xp} XP</button>` : (q.claimed ? `<span class="np-quest-done">${ru ? 'Получено' : 'Claimed'} +${q.xp} XP</span>` : '')}</div>
        </div>`;
      }).join('')}</div>
      <div class="np-ach-head"><h2 class="np-section-title">${ru ? 'Достижения' : 'Achievements'}</h2><span class="np-ach-count">${unlocked.length}/${all.length}</span></div>
      <div class="np-achievements">${preview.map((x) => achCard(x, ru, true)).join('')}</div>
      <button type="button" class="np-showall" id="np-show-all-ach">${ru ? 'Показать все' : 'Show all'} · ${all.length}</button>
      <div class="np-actions-row"><button type="button" class="np-switch" id="np-edit-profile">${ru ? 'Редактировать профиль' : 'Edit profile'}</button><button type="button" class="np-switch" id="np-switch-profile">${ru ? 'Сменить профиль' : 'Switch profile'}</button></div>`;
    const openProfiles = () => {
      close();
      const nav = document.getElementById('nav-settings');
      if (nav) nav.click();
      setTimeout(() => {
        const b = [...document.querySelectorAll('.settings-nav-btn')].find((x) => x.dataset.cat === 'profiles');
        if (b) b.click();
      }, 220);
    };
    body.querySelector('#np-switch-profile').addEventListener('click', openProfiles);
    body.querySelector('#np-show-all-ach').addEventListener('click', () => showAllAchievements(all));
    body.querySelectorAll('.np-quest-claim').forEach((btn) => btn.addEventListener('click', () => {
      try {
        if (window.NoctraXP && typeof window.NoctraXP.claimQuest === 'function' && window.NoctraXP.claimQuest(btn.dataset.quest, Number(btn.dataset.xp) || 0)) {
          try { window.MurielCore && window.MurielCore.toast('+' + btn.dataset.xp + ' XP', 'success'); } catch (e) {}
          render();
        }
      } catch (e) {}
    }));
    try {
      const t = window.MurielCore && window.MurielCore.state && window.MurielCore.state.currentTrack;
      const cover = t && (t.thumbnail || t.cover || t.image);
      const banner = body.querySelector('.np-banner');
      if (banner && cover) banner.style.backgroundImage = 'linear-gradient(135deg, rgba(10,8,14,.84), rgba(10,8,14,.52)), url("' + String(cover).replace(/"/g, '\\"') + '")';
    } catch (e) {}
    window.dispatchEvent(new Event('noctra:profile-rendered'));
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function plural(n, one, few, many) {
    const v = Math.abs(Number(n) || 0) % 100;
    const d = v % 10;
    if (v > 10 && v < 20) return many;
    if (d === 1) return one;
    if (d >= 2 && d <= 4) return few;
    return many;
  }
  function open() {
    if (!page) return;
    try { if (window.NoctraXP && typeof window.NoctraXP.flush === 'function') window.NoctraXP.flush(); } catch (e) {}
    const closeBtn = page.querySelector('#np-profile-close');
    if (closeBtn) closeBtn.textContent = localStorage.getItem('muriel_ui_lang') === 'ru' ? 'Закрыть' : 'Close';
    render();
    page.classList.add('open');
    document.body.classList.add('np-profile-open');
    document.documentElement.classList.remove('mobile-side-nav-open');
    window.dispatchEvent(new Event('noctra:profile-open'));
  }
  function close() {
    if (!page) return;
    page.classList.remove('open');
    document.body.classList.remove('np-profile-open');
  }
  function build() {
    if (page) return;
    page = document.createElement('section');
    page.id = 'noctra-profile-page';
    page.innerHTML = `<div class="np-head"><span class="nkh-kicker" style="letter-spacing:.12em;color:var(--md-sys-color-primary);font-size:10px;font-weight:750;">NOCTRA</span><div class="np-head-actions"><button type="button" class="btn-outline-pill" id="np-profile-close">Close</button></div></div><div class="np-scroll"></div>`;
    page.querySelector('#np-profile-close').addEventListener('click', close);
    document.body.appendChild(page);
    window.addEventListener('muriel:library', () => { if (page.classList.contains('open')) render(); });
    window.addEventListener('muriel:track', () => { if (page.classList.contains('open')) render(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('#profile-switch');
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    open();
  }, true);
  const start = () => build();
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', start, { once: true });

  window.NoctraAchievements = { list: () => achievements(data()) };
  window.NoctraProfileRefresh = () => { if (page && page.classList.contains('open')) render(); };
  window.addEventListener('noctra:xp', () => {
    const modal = document.getElementById('np-ach-modal');
    if (page && page.classList.contains('open') && !(modal && modal.classList.contains('open'))) render();
  });
})();

/* Noctra: XP progression with the same storage key, thresholds and rewards as PC Noctra.
   1 XP per 5 minutes listened, +2 per new favorite, +15 per first 10-track playlist,
   quest rewards and one-time achievement rewards. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const KEY = 'riff_profile_v1';
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const core = () => window.MurielCore;
  const state = () => { const c = core(); return (c && c.state) || {}; };
  const toast = (text) => { try { if (core() && typeof core().toast === 'function') core().toast(text, 'success'); } catch (e) {} };

  const newDaily = () => ({
    date: todayKey(),
    listenedSeconds: 0,
    favoritesAdded: 0,
    completedTracks: 0,
    playlistXpClaimed: false,
    quests: {}
  });
  const defaults = () => ({
    totalXP: 0,
    totalSecondsListened: 0,
    totalTracksPlayed: 0,
    counters: { nightPlays: 0, maxSessionSeconds: 0, repeatLoops: 0, shuffleStreak: 0, sources: [], questsClaimedTotal: 0 },
    currentSessionSeconds: 0,
    lastTickAt: 0,
    lastTrackId: null,
    lastTrackAt: 0,
    favoriteXpTrackIds: {},
    lastFavoriteIds: null,
    lastMaxPlaylistTracks: null,
    daily: newDaily(),
    unlocked: {},
    achievementXpGranted: []
  });

  let store = null;
  let p = null;
  let saveTimer = 0;
  let lastMedia = null;
  let achBusy = false;

  function load() {
    let parsed = null;
    try { parsed = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    const raw = parsed && parsed.progression ? parsed.progression : {};
    const prog = Object.assign(defaults(), raw || {});
    prog.counters = Object.assign(defaults().counters, (raw && raw.counters) || {});
    prog.daily = Object.assign(newDaily(), (raw && raw.daily) || {});
    prog.daily.quests = Object.assign({}, raw && raw.daily && raw.daily.quests || {});
    prog.unlocked = (raw && raw.unlocked) || {};
    prog.achievementXpGranted = Array.isArray(prog.achievementXpGranted) ? prog.achievementXpGranted : [];
    prog.favoriteXpTrackIds = prog.favoriteXpTrackIds && typeof prog.favoriteXpTrackIds === 'object' ? prog.favoriteXpTrackIds : {};
    prog.lastFavoriteIds = Array.isArray(prog.lastFavoriteIds) ? prog.lastFavoriteIds : null;
    if (prog.daily.date !== todayKey()) prog.daily = newDaily();
    store = { version: 1, progression: prog };
    p = prog;
    return prog;
  }
  function persist(instant) {
    if (!store) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; }
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {}
    if (!instant) return;
    window.dispatchEvent(new Event('noctra:xp'));
  }
  function later() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = 0; persist(false); }, 1200);
  }
  function ensureDaily() {
    if (!p) load();
    if (p.daily.date !== todayKey()) {
      p.daily = newDaily();
      persist(false);
    }
  }
  function favIds() {
    const list = state().favorites;
    return (Array.isArray(list) ? list : []).map((t) => String(t && (t.id || t.url || (t.title + '|' + t.artist)) || '')).filter(Boolean);
  }
  function maxPlaylistTracks() {
    const list = state().playlists;
    return (Array.isArray(list) ? list : []).reduce((max, pl) => Math.max(max, Array.isArray(pl.tracks) ? pl.tracks.length : Number(pl.trackCount) || 0), 0);
  }
  function bootstrap() {
    if (!p || p.bootstrappedV2) return;
    p.bootstrappedV2 = true;
    let st = {};
    try { st = (window.MurielEncore && window.MurielEncore.stats('all')) || {}; } catch (e) {}
    if (!(Number(p.totalXP) > 0) && Number(st.minutes) > 0) p.totalXP = Math.floor((Number(st.minutes) * 60) / 300);
    if (!(Number(p.totalTracksPlayed) > 0) && Number(st.plays) > 0) p.totalTracksPlayed = Number(st.plays) || 0;
    if (p.lastFavoriteIds === null) p.lastFavoriteIds = favIds();
    if (p.lastMaxPlaylistTracks === null) p.lastMaxPlaylistTracks = maxPlaylistTracks();
    persist(false);
  }
  function checkUnlocks(silent) {
    if (achBusy || !window.NoctraAchievements) return;
    achBusy = true;
    try {
      persist(false);
      const list = window.NoctraAchievements.list() || [];
      const fresh = [];
      let gained = 0;
      list.forEach((item) => {
        if (!item.done || p.unlocked[item.id]) return;
        p.unlocked[item.id] = Date.now();
        if (!p.achievementXpGranted.includes(item.id)) {
          p.achievementXpGranted.push(item.id);
          p.totalXP += Number(item.xp) || 50;
          gained += Number(item.xp) || 50;
          fresh.push(item.title);
        }
      });
      if (fresh.length) {
        persist(true);
        if (!silent) toast(fresh.length === 1 ? 'Достижение: ' + fresh[0] : 'Новых достижений: ' + fresh.length);
      } else if (gained > 0) {
        persist(true);
      }
    } catch (e) {}
    achBusy = false;
  }
  function addSeconds(seconds) {
    if (!(seconds > 0)) return;
    ensureDaily();
    const prev = Number(p.daily.listenedSeconds) || 0;
    const next = prev + seconds;
    p.daily.listenedSeconds = next;
    p.totalSecondsListened = (Number(p.totalSecondsListened) || 0) + seconds;
    const gained = Math.floor(next / 300) - Math.floor(prev / 300);
    if (gained > 0) p.totalXP += gained;
    const now = Date.now();
    const gap = p.lastTickAt ? (now - p.lastTickAt) / 1000 : 0;
    p.currentSessionSeconds = gap > 300 ? seconds : (Number(p.currentSessionSeconds) || 0) + seconds;
    p.counters.maxSessionSeconds = Math.max(Number(p.counters.maxSessionSeconds) || 0, Math.round(p.currentSessionSeconds));
    p.lastTickAt = now;
    later();
    if (gained > 0) {
      persist(true);
    }
  }
  function checkFavorites() {
    ensureDaily();
    const ids = favIds();
    if (p.lastFavoriteIds === null) { p.lastFavoriteIds = ids; later(); return; }
    const known = new Set(p.lastFavoriteIds);
    let gained = 0;
    ids.forEach((id) => {
      if (!known.has(id) && !p.favoriteXpTrackIds[id]) {
        p.favoriteXpTrackIds[id] = todayKey();
        p.daily.favoritesAdded = (Number(p.daily.favoritesAdded) || 0) + 1;
        gained += 2;
      }
    });
    p.lastFavoriteIds = ids;
    if (gained > 0) {
      p.totalXP += gained;
      persist(true);
      checkUnlocks(false);
    } else {
      later();
    }
  }
  function checkPlaylist() {
    ensureDaily();
    const max = maxPlaylistTracks();
    const prev = p.lastMaxPlaylistTracks;
    if (prev !== null && max >= 10 && prev < 10 && !p.daily.playlistXpClaimed) {
      p.daily.playlistXpClaimed = true;
      p.totalXP += 15;
      persist(true);
      toast('+15 XP');
      checkUnlocks(false);
    }
    p.lastMaxPlaylistTracks = max;
  }
  window.addEventListener('muriel:track', () => {
    ensureDaily();
    const s = state();
    const t = s.currentTrack;
    if (!t) return;
    const id = String(t.id || t.url || (t.title + '|' + t.artist) || '');
    const now = Date.now();
    if (id && id !== p.lastTrackId) {
      p.totalTracksPlayed = (Number(p.totalTracksPlayed) || 0) + 1;
      if (new Date().getHours() < 6) p.counters.nightPlays = (Number(p.counters.nightPlays) || 0) + 1;
      if (s.isShuffle) p.counters.shuffleStreak = (Number(p.counters.shuffleStreak) || 0) + 1;
      else p.counters.shuffleStreak = 0;
      p.lastTrackId = id;
    } else if (id && id === p.lastTrackId && now - (Number(p.lastTrackAt) || 0) > 1000) {
      p.counters.repeatLoops = (Number(p.counters.repeatLoops) || 0) + 1;
    }
    p.lastTrackAt = now;
    const source = String(t.platform || t.source || '').trim();
    if (source && Array.isArray(p.counters.sources) && !p.counters.sources.some((x) => String(x).toLowerCase() === source.toLowerCase())) {
      p.counters.sources.push(source);
    }
    later();
    setTimeout(() => checkUnlocks(true), 800);
  });
  window.addEventListener('muriel:library', () => {
    checkFavorites();
    checkPlaylist();
    setTimeout(() => checkUnlocks(true), 800);
  });
  window.addEventListener('noctra:profile-open', () => {
    persist(false);
    checkFavorites();
    checkUnlocks(true);
  });
  setInterval(() => {
    const a = core() && core().audio;
    if (!a || a.paused) { lastMedia = null; return; }
    const t = Number(a.currentTime) || 0;
    if (lastMedia !== null) {
      const delta = t - lastMedia;
      if (delta > 0 && delta < 3) addSeconds(delta);
    }
    lastMedia = t;
  }, 1000);
  setInterval(() => checkUnlocks(true), 30000);

  load();
  const boot = () => {
    bootstrap();
    checkFavorites();
    checkPlaylist();
    setTimeout(() => checkUnlocks(true), 1500);
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
  window.addEventListener('muriel:ready', boot, { once: true });

  window.NoctraXP = window.NoctraXP || {};
  window.NoctraXP.add = (amount) => {
    const value = Math.floor(Number(amount) || 0);
    if (value <= 0) return;
    p.totalXP += value;
    persist(true);
    checkUnlocks(false);
  };
  window.NoctraXP.flush = () => persist(false);
  window.NoctraXP.claimQuest = (id, xp) => {
    ensureDaily();
    if (!id || (p.daily.quests[id] && p.daily.quests[id].claimed)) return false;
    p.daily.quests[id] = { claimed: true };
    p.counters.questsClaimedTotal = (Number(p.counters.questsClaimedTotal) || 0) + 1;
    p.totalXP += Math.max(0, Number(xp) || 0);
    persist(true);
    setTimeout(() => checkUnlocks(false), 300);
    return true;
  };
  window.NoctraXP.questClaimed = (id) => {
    ensureDaily();
    return !!(p.daily.quests[id] && p.daily.quests[id].claimed);
  };
})();

/* Noctra: PC-style ruler sliders for every range in Settings. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  function labelOf(input, item) {
    const id = input.id ? 'val-' + input.id.replace(/^slider-/, '') : '';
    const el = (id && document.getElementById(id)) || item.querySelector('.setting-value, .setting-val');
    if (el && el.textContent.trim()) return el.textContent.trim();
    const v = parseFloat(input.value);
    if (/opacity|alpha|gain|sens|smooth|blur|reverb|distortion|echo|vocal|air|bass|tightness|scale/i.test(input.id)) return Math.round(v || 0) + '%';
    if (/speed/i.test(input.id)) return (v || 0).toFixed(2) + 'x';
    return String(v || 0);
  }
  function setValue(input, value) {
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max) || 100;
    const step = parseFloat(input.step) || 1;
    let v = Math.min(max, Math.max(min, value));
    v = min + Math.round((v - min) / step) * step;
    v = parseFloat(v.toFixed(6));
    if (String(input.value) === String(v)) return;
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function enhance(root) {
    (root || document).querySelectorAll('input[type="range"]:not(.nu-ruler-done)').forEach((input) => {
      if (!input.closest('#view-settings, #audio-settings-modal, .audio-menu-card, .audio-panel')) return;
      if (input.id === 'slider-theme-hue' || input.id === 'volume-slider' || input.classList.contains('eq-band-range')) return;
      if (input.closest('.eq-slider-box, .eq-slider-wrap, .hue-seg, .tvk-progress-row, .scrubber-bar-wrapper')) return;
      const item = input.closest('.setting-item');
      if (!item) return;
      let wrap = input.closest('.sl');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.className = 'sl';
        wrap.innerHTML = '<div class="sl-active"></div><div class="sl-inactive"></div>';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
      }
      input.classList.add('nu-ruler-done');
      wrap.classList.add('nu-ruler');
      item.classList.add('nu-ruler-item');
      item.querySelectorAll('.slider-ticks').forEach((x) => x.remove());
      if (!wrap.querySelector('.nu-ruler-ticks')) {
        const pointer = document.createElement('div');
        pointer.className = 'nu-ruler-pointer';
        const ticks = document.createElement('div');
        ticks.className = 'nu-ruler-ticks';
        for (let i = 0; i < 27; i++) ticks.appendChild(document.createElement('i'));
        wrap.appendChild(pointer);
        wrap.appendChild(ticks);
      }
      let stepper = item.querySelector('.nu-stepper');
      if (!stepper) {
        stepper = document.createElement('div');
        stepper.className = 'nu-stepper';
        stepper.innerHTML = '<button type="button" data-dir="-1" aria-label="Decrease">−</button><span></span><button type="button" data-dir="1" aria-label="Increase">+</button>';
        item.appendChild(stepper);
        const step = parseFloat(input.step) || 1;
        stepper.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setValue(input, (parseFloat(input.value) || 0) + Number(b.dataset.dir) * step)));
      }
      const ticks = wrap.querySelectorAll('.nu-ruler-ticks i');
      const sync = () => {
        const min = parseFloat(input.min) || 0;
        const max = parseFloat(input.max) || 100;
        const ratio = max > min ? Math.max(0, Math.min(1, (parseFloat(input.value) - min) / (max - min))) : 0;
        wrap.style.setProperty('--v', ratio);
        ticks.forEach((t, i) => {
          const p = ticks.length > 1 ? i / (ticks.length - 1) : 0;
          const proximity = Math.max(0, 1 - Math.abs(p - ratio) / 0.24);
          t.style.setProperty('--th', (7 + 6 * proximity).toFixed(1) + 'px');
          t.style.setProperty('--to', (0.18 + 0.75 * proximity).toFixed(2));
          t.classList.toggle('past', p <= ratio + 0.001);
        });
        const out = stepper && stepper.querySelector('span');
        if (out) out.textContent = labelOf(input, item);
      };
      input.addEventListener('input', sync);
      input.addEventListener('change', sync);
      sync();
    });
  }
  enhance();
  let raf = 0;
  new MutationObserver((muts) => {
    if (raf || !muts.some((m) => Array.prototype.some.call(m.addedNodes, (n) => n.nodeType === 1))) return;
    raf = requestAnimationFrame(() => { raf = 0; enhance(); });
  }).observe(document.body, { childList: true, subtree: true });
})();

/* Noctra: cover-first Now Playing, then a lyrics mode without the level/tempo blocks. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const panel = document.getElementById('right-panel');
  const box = document.getElementById('right-panel-artwork-box');
  if (!panel || !box) return;
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  let btn = null;
  function label() {
    const open = document.body.classList.contains('np-lyrics-mode');
    if (btn) btn.textContent = open ? (ru() ? 'Скрыть текст' : 'Hide lyrics') : (ru() ? 'Показать текст' : 'Show lyrics');
  }
  function build() {
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'noctra-show-lyrics';
    btn.type = 'button';
    btn.setAttribute('data-no-i18n', '');
    btn.addEventListener('click', () => {
      document.body.classList.toggle('np-lyrics-mode');
      label();
    });
    box.appendChild(btn);
    label();
  }
  function resetMode() {
    if (!document.body.classList.contains('np-open')) return;
    document.body.classList.remove('np-lyrics-mode');
    label();
  }
  new MutationObserver(() => {
    if (!document.body.classList.contains('np-open')) return;
    // a new opening always starts on the cover; a later lyrics toggle is kept while open
    if (!panel.classList.contains('hidden') && !panel._noctraOpened) {
      panel._noctraOpened = true;
      resetMode();
    }
    if (panel.classList.contains('hidden')) panel._noctraOpened = false;
  }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  const buildStart = () => { build(); resetMode(); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') buildStart();
  else document.addEventListener('DOMContentLoaded', buildStart, { once: true });
  window.addEventListener('muriel:ready', buildStart, { once: true });

  // progress dot on the bottom outline
  const playbar = document.getElementById('playbar');
  function progress() {
    if (!playbar) return;
    const c = window.MurielCore;
    const a = c && c.audio;
    const d = a && Number.isFinite(a.duration) ? a.duration : 0;
    const v = d > 0 ? Math.max(0, Math.min(1, a.currentTime / d)) : 0;
    playbar.style.setProperty('--np-progress', String(v));
  }
  const audio = (window.MurielCore && window.MurielCore.audio) || document.querySelector('audio');
  if (audio) ['timeupdate','seeked','loadedmetadata','play'].forEach((ev) => audio.addEventListener(ev, progress));
  setInterval(progress, 700);
})();

/* Keep the short settings category label readable: About -> О приложении (not just О). */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  function fixAbout() {
    const btn = document.querySelector('.settings-nav-btn[data-cat="about"] span');
    if (!btn) return;
    btn.textContent = localStorage.getItem('muriel_ui_lang') === 'ru' ? 'О приложении' : 'About';
  }
  const go = () => { fixAbout(); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') go();
  else document.addEventListener('DOMContentLoaded', go, { once: true });
  window.addEventListener('muriel:ready', go, { once: true });
})();

/* Noctra: clamp very long helper texts and open the full text in a small sheet. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'nu-readmore-modal';
    modal.innerHTML = '<div class="nrm-card"><h3></h3><p></p><button type="button">' + (ru() ? 'Закрыть' : 'Close') + '</button></div>';
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('button')) modal.classList.remove('open'); });
    document.body.appendChild(modal);
    return modal;
  }
  function show(title, text) {
    const m = ensureModal();
    m.querySelector('h3').textContent = title;
    m.querySelector('p').textContent = text;
    m.querySelector('button').textContent = ru() ? 'Закрыть' : 'Close';
    m.classList.add('open');
  }
  function apply(root) {
    (root || document).querySelectorAll('.setting-hint, .ct-head .setting-hint, .setting-item-top span[style*="font-size"]').forEach((el) => {
      if (el.dataset.nuClamped === '1') return;
      const text = el.textContent.trim();
      if (text.length < 55) return;
      el.dataset.nuClamped = '1';
      const inlineDesc = !el.classList.contains('setting-hint');
      if (inlineDesc) el.classList.add('nu-desc');
      else el.classList.add('nu-clamp');
      const item = el.closest('.setting-item');
      if (item) item.classList.add('nu-desc-item');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nu-readmore';
      btn.setAttribute('data-no-i18n', '');
      btn.textContent = ru() ? 'Читать далее' : 'Read more';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const heading = el.closest('.setting-item')?.querySelector('.setting-name')?.textContent || (ru() ? 'Подробнее' : 'Details');
        show(heading, text);
      });
      el.insertAdjacentElement('afterend', btn);
    });
  }
  apply();
  let raf = 0;
  new MutationObserver((muts) => {
    if (raf || !muts.some((m) => Array.prototype.some.call(m.addedNodes, (n) => n.nodeType === 1))) return;
    raf = requestAnimationFrame(() => { raf = 0; apply(); });
  }).observe(document.body, { childList: true, subtree: true });
})();

/* Noctra: "Discovery of the day" artist card on Home. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const view = document.getElementById('view-discover');
  if (!view) return;
  let index = 0;
  let pool = [];
  let section = null;
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const core = () => window.MurielCore;
  function artistPool() {
    const names = new Map();
    const add = (name, thumb, plays) => {
      const n = String(name || '').trim();
      if (!n) return;
      const key = n.toLowerCase();
      const cur = names.get(key);
      if (!cur) names.set(key, { name: n, thumb: thumb || '', plays: Number(plays) || 0 });
      else { if (!cur.thumb && thumb) cur.thumb = thumb; cur.plays = Math.max(cur.plays, Number(plays) || 0); }
    };
    try {
      const st = window.MurielEncore && window.MurielEncore.stats('month');
      (st && st.artists || []).forEach((a) => add(a.name, a.thumb, a.plays));
    } catch (e) {}
    const c = core();
    const s = c && c.state || {};
    [s.history, s.favorites, s.localTracks, s.queue, s.currentTrack ? [s.currentTrack] : []].forEach((list) => {
      (Array.isArray(list) ? list : []).forEach((t) => add(t && t.artist, t && (t.thumbnail || t.cover || t.image || t.artworkUrl), 0));
    });
    try {
      const cached = JSON.parse(localStorage.getItem('muriel_trending_cache') || 'null');
      (cached && Array.isArray(cached.tracks) ? cached.tracks : []).forEach((t) => add(t && t.artist, t && (t.thumbnail || t.cover || t.image), 0));
    } catch (e) {}
    return [...names.values()].filter((a) => a.name && !/^unknown/i.test(a.name)).slice(0, 24);
  }
  function tracksFor(name) {
    const c = core();
    const s = c && c.state || {};
    const key = String(name || '').toLowerCase();
    const out = [];
    const seen = new Set();
    const add = (t) => {
      if (!t || !t.title) return;
      const a = String(t.artist || '').toLowerCase();
      if (!a.includes(key)) return;
      const id = String(t.id || '') + '|' + String(t.title).toLowerCase();
      if (seen.has(id)) return;
      seen.add(id);
      out.push(t);
    };
    [s.history, s.favorites, s.localTracks, s.queue].forEach((list) => (Array.isArray(list) ? list : []).forEach(add));
    try {
      const cached = JSON.parse(localStorage.getItem('muriel_trending_cache') || 'null');
      (cached && Array.isArray(cached.tracks) ? cached.tracks : []).forEach(add);
    } catch (e) {}
    if (!out.length) {
      try {
        const st = window.MurielEncore && window.MurielEncore.stats('all');
        (st && st.songs || []).forEach((x) => {
          const r = x && x.raw;
          if (!r) return;
          add({ id: r.id, title: r.t, artist: r.a, thumbnail: r.th, platform: r.p, url: r.u, duration: r.d });
        });
      } catch (e) {}
    }
    return out.slice(0, 5);
  }
  function render() {
    if (!section) return;
    const c = core();
    const s = c && c.state || {};
    pool = artistPool();
    if (!pool.length) { section.hidden = true; return; }
    section.hidden = false;
    const today = new Date();
    const seed = Number(String(today.getFullYear()) + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0'));
    const pick = pool[(seed + index) % pool.length];
    const tracks = tracksFor(pick.name);
    const cover = pick.thumb || (tracks[0] && (tracks[0].thumbnail || tracks[0].cover || tracks[0].image)) || '';
    const plays = pick.plays;
    const sub = tracks.length
      ? (ru() ? `${tracks.length} треков · ${plays || 0} прослушиваний` : `${tracks.length} tracks · ${plays || 0} plays`)
      : (ru() ? 'Из вашей библиотеки' : 'From your library');
    section.innerHTML = `
      <div class="nd-head"><div class="nd-title"><span>✦</span>${ru() ? 'Открытие дня' : 'Discovery of the day'}</div><button type="button" class="nd-random" id="nd-random">${ru() ? 'Случайный артист' : 'Random artist'}</button></div>
      <div class="nd-cover-wrap">${cover ? `<img class="nd-cover" src="${esc(cover)}" alt="">` : '<div class="nd-cover"></div>'}<span class="nd-badge">${ru() ? 'Выбор дня' : 'Daily pick'}</span></div>
      <h2 class="nd-name">${esc(pick.name)}</h2>
      <div class="nd-sub">${esc(sub)}</div>
      <div class="nd-actions"><button type="button" class="nd-listen" id="nd-listen">▶ ${ru() ? 'Слушать' : 'Listen'}</button><button type="button" class="nd-profile" id="nd-profile">${ru() ? 'Профиль артиста' : 'Artist profile'}</button></div>
      ${tracks.length ? `<div class="nd-track-head">${ru() ? 'Популярное в вашей библиотеке' : 'Popular in your library'}<span>${tracks.length} ${ru() ? 'трека' : 'tracks'}</span></div><div class="nd-tracks">${tracks.slice(0, 4).map((t, i) => `<button type="button" class="nd-track" data-i="${i}"><img src="${esc(t.thumbnail || t.cover || t.image || '')}" alt=""><span><b>${esc(t.title)}</b><small>${esc(t.artist || '')}</small></span><svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg></button>`).join('')}</div>` : ''}`;
    section.querySelector('#nd-random').addEventListener('click', () => { index++; render(); });
    const play = (i) => { if (tracks[i] && c && c.playTrack) c.playTrack(tracks[i], tracks, i); };
    section.querySelector('#nd-listen').addEventListener('click', () => play(0));
    section.querySelectorAll('.nd-track').forEach((b) => b.addEventListener('click', () => play(Number(b.dataset.i))));
    section.querySelector('#nd-profile').addEventListener('click', () => {
      if (c && typeof c.openArtist === 'function') c.openArtist(pick.name, { id: pick.id || '' });
    });
  }
  function build() {
    if (section) return;
    section = document.createElement('div');
    section.id = 'noctra-daily';
    const content = view.querySelector('.discover-content');
    if (content) view.insertBefore(section, content); else view.appendChild(section);
    render();
    window.addEventListener('muriel:library', render);
    window.addEventListener('muriel:track', () => { if (!section.hidden) render(); });
  }
  const start = () => build();
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', start, { once: true });
})();

/* Noctra: profile editing for banner, bio and profile effects. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const KEY = 'noctra_profile_extra_v1';
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  const L = (en, r) => ru() ? r : en;
  const all = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
  const profileKey = () => { const p = window.MurielProfiles && window.MurielProfiles.current ? window.MurielProfiles.current() : null; return p && (p.id || p.name) || 'default'; };
  const current = () => all()[profileKey()] || {};
  const persist = (obj) => { const a = all(); a[profileKey()] = obj; localStorage.setItem(KEY, JSON.stringify(a)); };
  let sheet = null;
  let pendingBanner = '';
  let pendingAvatar = '';

  function applyExtras() {
    const page = document.getElementById('noctra-profile-page');
    if (!page || !page.classList.contains('open')) return;
    const scroll = page.querySelector('.np-scroll');
    if (!scroll) return;
    const ex = current();
    scroll.querySelectorAll('.np-bio,.np-profile-fx').forEach((e) => e.remove());
    const meta = scroll.querySelector('.np-identity > div:last-child');
    if (meta && ex.bio) {
      const p = document.createElement('p');
      p.className = 'np-bio';
      p.textContent = ex.bio;
      meta.appendChild(p);
    }
    const banner = scroll.querySelector('.np-banner');
    if (banner && ex.banner) {
      banner.style.backgroundImage = 'linear-gradient(135deg, rgba(10,8,14,.72), rgba(10,8,14,.38)), url("' + String(ex.banner).replace(/"/g, '\\"') + '")';
    }
    if (banner && ex.effect && ex.effect !== 'none') {
      const fx = document.createElement('div');
      fx.className = 'np-profile-fx fx-' + ex.effect;
      if (ex.effect === 'embers' || ex.effect === 'stars') {
        fx.innerHTML = Array.from({ length: 14 }, (_, i) => `<i style="left:${(i * 37 + 8) % 94}%;animation-delay:${-(i * 0.47).toFixed(2)}s;animation-duration:${(4.5 + (i % 5) * 0.7).toFixed(1)}s"></i>`).join('');
      }
      banner.appendChild(fx);
    }
    const avatar = scroll.querySelector('.np-avatar');
    if (avatar) {
      if (ex.avatar) {
        avatar.style.backgroundImage = 'url("' + String(ex.avatar).replace(/"/g, '\\"') + '")';
        avatar.classList.add('has-avatar');
      } else {
        avatar.style.backgroundImage = '';
        avatar.classList.remove('has-avatar');
      }
    }
  }
  const FX = [
    { id: 'none', label: L('None', 'Нет'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' },
    { id: 'embers', label: L('Embers', 'Угли'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>' },
    { id: 'fog', label: L('Fog', 'Туман'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M6 13h14M9 17h10"/></svg>' },
    { id: 'aurora', label: L('Aurora', 'Аврора'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18c4-9 6-12 9-12s5 3 9 12"/><path d="M6 18c2.5-5 4-7 6-7s3.5 2 6 7"/></svg>' },
    { id: 'stars', label: L('Stars', 'Звёзды'), icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 2.3 5.2 5.7.7-4.2 3.9 1.1 5.6L12 15.6l-4.9 2.8 1.1-5.6L4 8.9l5.7-.7z"/></svg>' }
  ];

  function previewBannerUrl() {
    if (pendingBanner === '__remove__') return '';
    if (pendingBanner) return pendingBanner;
    return current().banner || '';
  }
  function refreshPreview() {
    if (!sheet) return;
    const ex = current();
    const url = previewBannerUrl();
    const banner = sheet.querySelector('#npe-prev-banner');
    const thumb = sheet.querySelector('#npe-thumb');
    if (banner) banner.style.backgroundImage = url ? `url("${url.replace(/"/g, '\\"')}")` : '';
    if (thumb) {
      thumb.style.backgroundImage = url ? `url("${url.replace(/"/g, '\\"')}")` : '';
      thumb.classList.toggle('empty', !url);
    }
    const bioEl = sheet.querySelector('#npe-bio');
    const bioText = String(bioEl ? bioEl.value : ex.bio || '').trim();
    const prevBio = sheet.querySelector('#npe-prev-bio');
    if (prevBio) prevBio.textContent = bioText || L('A few words about you', 'Пара слов о себе');
    const count = sheet.querySelector('#npe-count');
    if (count) count.textContent = (bioEl ? bioEl.value.length : 0) + '/180';
    const me = window.MurielProfiles && typeof window.MurielProfiles.current === 'function' ? window.MurielProfiles.current() : { name: 'Noctra' };
    const name = String(me && me.name || 'Noctra');
    const prevName = sheet.querySelector('#npe-prev-name');
    if (prevName) prevName.textContent = name;
    const av = sheet.querySelector('#npe-prev-avatar');
    if (av) {
      av.textContent = Array.from(name)[0] ? Array.from(name)[0].toUpperCase() : 'N';
      const avatarUrl = pendingAvatar === '__remove__' ? '' : (pendingAvatar || ex.avatar || '');
      av.style.backgroundImage = avatarUrl ? 'url("' + String(avatarUrl).replace(/"/g, '\\"') + '")' : '';
      av.classList.toggle('has-image', !!avatarUrl);
      const avatarClear = sheet.querySelector('#npe-avatar-clear');
      if (avatarClear) avatarClear.hidden = !avatarUrl;
    }
    const xp = window.NoctraXP ? window.NoctraXP.total() : 0;
    const tier = window.NoctraXP ? window.NoctraXP.rankFor(xp).rank.tier : 1;
    const level = sheet.querySelector('#npe-prev-level');
    if (level) level.textContent = `LVL ${tier} · ${xp} XP`;
    const fx = sheet.querySelector('#npe-prev-fx');
    if (fx) {
      const id = (sheet.querySelector('.npe-effect.active') || {}).dataset?.fx || 'none';
      fx.className = 'np-profile-fx npe-prev-fx' + (id !== 'none' ? ' fx-' + id : '');
      fx.innerHTML = (id === 'embers' || id === 'stars')
        ? Array.from({ length: 10 }, (_, i) => `<i style="left:${(i * 41 + 7) % 94}%;animation-delay:${-(i * 0.51).toFixed(2)}s;animation-duration:${(4 + (i % 4) * 0.8).toFixed(1)}s"></i>`).join('')
        : '';
    }
  }
  function buildSheet() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.id = 'np-edit-sheet';
    sheet.innerHTML = `<div class="npe-backdrop"></div><div class="npe-card">
      <div class="npe-grabber"></div>
      <div class="npe-top">
        <div>
          <span class="npe-kicker">NOCTRA · CUSTOMIZATION</span>
          <h3 data-no-i18n>${L('Edit profile', 'Редактировать профиль')}</h3>
        </div>
        <button type="button" class="npe-close" id="npe-close" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="npe-preview">
        <div class="npe-prev-banner" id="npe-prev-banner">
          <div class="np-profile-fx npe-prev-fx" id="npe-prev-fx"></div>
          <div class="npe-prev-vignette"></div>
        </div>
        <div class="npe-prev-row">
          <div class="npe-prev-avatar-wrap">
            <div class="npe-prev-avatar" id="npe-prev-avatar">M</div>
            <button type="button" class="npe-avatar-edit" id="npe-avatar-pick" aria-label="${L('Change avatar', 'Изменить аватар')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/></svg>
            </button>
            <button type="button" class="npe-avatar-clear" id="npe-avatar-clear" aria-label="${L('Remove avatar', 'Удалить аватар')}" hidden>×</button>
          </div>
          <div class="npe-prev-copy">
            <div class="npe-prev-head">
              <b id="npe-prev-name">Me</b>
              <span class="npe-prev-badge" id="npe-prev-level">LVL 1 · 0 XP</span>
            </div>
            <p id="npe-prev-bio"></p>
          </div>
        </div>
      </div>
      <div class="npe-section">
        <div class="npe-label-row">
          <span class="npe-label">${L('Profile banner', 'Баннер профиля')}</span>
          <span class="npe-hint">16:9 · PNG, JPG, WEBP</span>
        </div>
        <div class="npe-banner-row">
          <div class="npe-thumb empty" id="npe-thumb">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="3" y="5" width="18" height="14" rx="3"></rect>
              <circle cx="8.5" cy="10" r="1.5"></circle>
              <path d="M21 16l-5-5-6 6-3-3-4 4"></path>
            </svg>
            <span>${L('No background', 'Нет фона')}</span>
          </div>
          <div class="npe-banner-actions">
            <button type="button" class="npe-primary" id="npe-pick">${L('Choose image', 'Выбрать изображение')}</button>
            <button type="button" class="npe-ghost" id="npe-clear">${L('Remove background', 'Удалить фон')}</button>
          </div>
        </div>
      </div>
      <div class="npe-section">
        <div class="npe-label-row">
          <span class="npe-label">${L('About me', 'О себе')}</span>
          <span class="npe-count" id="npe-count">0/180</span>
        </div>
        <textarea id="npe-bio" rows="3" maxlength="180" placeholder="${L('A few words about you...', 'Пара слов о себе...')}"></textarea>
      </div>
      <div class="npe-section">
        <div class="npe-label-row">
          <span class="npe-label">${L('Atmosphere effect', 'Атмосферный эффект')}</span>
        </div>
        <div class="npe-fx-grid" id="npe-effects">${FX.map((fx) => `<button type="button" class="npe-effect${fx.id === 'none' ? ' active' : ''}" data-fx="${fx.id}"><div class="npe-fx-icon">${fx.icon}</div><span>${fx.label}</span></button>`).join('')}</div>
      </div>
      <div class="npe-actions">
        <button type="button" class="npe-cancel" id="npe-cancel">${L('Cancel', 'Отмена')}</button>
        <button type="button" class="npe-save" id="npe-save">${L('Save changes', 'Сохранить изменения')}</button>
      </div>
    </div>`;
    document.body.appendChild(sheet);
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    document.body.appendChild(file);
    sheet.querySelector('#npe-pick').addEventListener('click', () => file.click());
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        pendingBanner = String(reader.result || '');
        sheet.querySelector('#npe-pick').textContent = L('Selected ✓', 'Выбрано ✓');
        refreshPreview();
      };
      reader.readAsDataURL(f);
    });
    sheet.querySelector('#npe-clear').addEventListener('click', () => {
      pendingBanner = '__remove__';
      sheet.querySelector('#npe-pick').textContent = L('Choose image', 'Выбрать изображение');
      refreshPreview();
    });
    const avatarFile = document.createElement('input');
    avatarFile.type = 'file';
    avatarFile.accept = 'image/*';
    avatarFile.id = 'npe-avatar-file';
    avatarFile.style.display = 'none';
    document.body.appendChild(avatarFile);
    const openAvatarPicker = () => avatarFile.click();
    sheet.querySelector('#npe-avatar-pick').addEventListener('click', (e) => {
      e.stopPropagation();
      openAvatarPicker();
    });
    sheet.querySelector('#npe-prev-avatar').addEventListener('click', openAvatarPicker);
    avatarFile.addEventListener('change', () => {
      const f = avatarFile.files && avatarFile.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        pendingAvatar = String(reader.result || '');
        refreshPreview();
      };
      reader.readAsDataURL(f);
    });
    sheet.querySelector('#npe-avatar-clear').addEventListener('click', (e) => {
      e.stopPropagation();
      pendingAvatar = '__remove__';
      avatarFile.value = '';
      refreshPreview();
    });
    sheet.querySelectorAll('.npe-effect').forEach((b) => b.addEventListener('click', () => {
      sheet.querySelectorAll('.npe-effect').forEach((x) => x.classList.toggle('active', x === b));
      refreshPreview();
    }));
    sheet.querySelector('#npe-bio').addEventListener('input', refreshPreview);
    const close = () => { sheet.classList.remove('open'); document.body.classList.remove('npe-open'); };
    const dismiss = () => {
      const dirty = sheet.querySelector('#npe-bio').value.trim() !== String(current().bio || '').trim() || pendingBanner || pendingAvatar;
      if (dirty && !window.confirm(L('Discard changes?', 'Отменить изменения?'))) return;
      close();
    };
    sheet.querySelector('#npe-close').addEventListener('click', dismiss);
    sheet.querySelector('#npe-cancel').addEventListener('click', dismiss);
    sheet.querySelector('.npe-backdrop').addEventListener('click', dismiss);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) dismiss(); });
    sheet.querySelector('#npe-save').addEventListener('click', () => {
      const ex = current();
      ex.bio = sheet.querySelector('#npe-bio').value.trim();
      if (pendingBanner === '__remove__') delete ex.banner;
      else if (pendingBanner) ex.banner = pendingBanner;
      if (pendingAvatar === '__remove__') delete ex.avatar;
      else if (pendingAvatar) ex.avatar = pendingAvatar;
      ex.effect = (sheet.querySelector('.npe-effect.active') || {}).dataset?.fx || 'none';
      persist(ex);
      close();
      applyExtras();
      try { window.MurielCore && window.MurielCore.toast(L('Profile updated', 'Профиль обновлён'), 'success'); } catch (e) {}
    });
  }
  function openSheet() {
    buildSheet();
    const ex = current();
    pendingBanner = '';
    pendingAvatar = '';
    const bio = sheet.querySelector('#npe-bio');
    if (bio) bio.value = ex.bio || '';
    sheet.querySelectorAll('.npe-effect').forEach((b) => b.classList.toggle('active', (b.dataset.fx || 'none') === (ex.effect || 'none')));
    sheet.querySelector('#npe-pick').textContent = L('Choose image', 'Выбрать изображение');
    refreshPreview();
    sheet.classList.add('open');
    document.body.classList.add('npe-open');
  }
  document.addEventListener('click', (e) => {
    const edit = e.target.closest && e.target.closest('#np-edit-profile');
    if (!edit) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openSheet();
  }, true);
  window.addEventListener('noctra:profile-open', () => setTimeout(applyExtras, 120));
  window.addEventListener('noctra:profile-rendered', () => setTimeout(applyExtras, 30));
  window.addEventListener('muriel:library', () => setTimeout(applyExtras, 250));
  setTimeout(applyExtras, 1800);
})();

/* Noctra: put the Favorites title above its actions instead of letting them overlap. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  function refactor() {
    const header = document.querySelector('#view-favorites .view-header');
    if (!header || header.querySelector('.fav-actions-row')) return;
    const row = document.createElement('div');
    row.className = 'fav-actions-row';
    ['favorites-sort-dropdown', 'btn-select-favorites', 'btn-download-favorites', 'favorites-sort'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) row.appendChild(el);
    });
    header.appendChild(row);
  }
  const start = () => refactor();
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', start, { once: true });
})();

/* Noctra: concept header for the full player (down / Now playing • Noctra / audio). */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const panel = document.getElementById('right-panel');
  if (!panel) return;
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  function build() {
    if (document.getElementById('noctra-np-head')) return;
    const head = document.createElement('div');
    head.id = 'noctra-np-head';
    head.innerHTML = `<button type="button" class="np-head-btn" id="np-head-down" aria-label="Close"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button><span class="np-head-title"><b>${ru() ? 'СЕЙЧАС ИГРАЕТ' : 'NOW PLAYING'}</b> • NOCTRA</span><button type="button" class="np-head-btn" id="np-head-audio" aria-label="Audio settings"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10" r="2"/><circle cx="20" cy="14" r="2"/></svg></button>`;
    panel.insertBefore(head, panel.firstChild);
    head.querySelector('#np-head-down').addEventListener('click', () => document.getElementById('btn-close-right-panel')?.click());
    head.querySelector('#np-head-audio').addEventListener('click', () => document.getElementById('btn-open-settings')?.click());
  }
  const go = () => build();
  if (document.readyState === 'complete' || document.readyState === 'interactive') go();
  else document.addEventListener('DOMContentLoaded', go, { once: true });
  window.addEventListener('muriel:ready', go, { once: true });
})();

/* Noctra: thick timeline above the transport controls. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const center = document.querySelector('.playbar-center');
  const tempo = document.getElementById('np-tempo-panel');
  if (!center) return;
  const wrap = document.createElement('div');
  wrap.id = 'np-thick-timeline';
  wrap.innerHTML = '<span class="npt-time" id="npt-current">0:00</span><input type="range" id="npt-range" min="0" max="1000" step="1" value="0" aria-label="Seek"><span class="npt-time" id="npt-duration">0:00</span>';
  center.insertBefore(wrap, tempo || null);
  const range = wrap.querySelector('#npt-range');
  const curEl = wrap.querySelector('#npt-current');
  const durEl = wrap.querySelector('#npt-duration');
  const fmt = (s) => { s = Math.max(0, Math.round(Number(s) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const core = () => window.MurielCore;
  let seeking = false;
  function sync() {
    const c = core(); const a = c && c.audio;
    if (!a || seeking) return;
    const d = Number.isFinite(a.duration) ? a.duration : 0;
    const p = d > 0 ? Math.max(0, Math.min(1, a.currentTime / d)) : 0;
    range.value = String(Math.round(p * 1000));
    range.style.setProperty('--p', (p * 100).toFixed(2) + '%');
    curEl.textContent = fmt(a.currentTime);
    durEl.textContent = fmt(d);
  }
  range.addEventListener('pointerdown', () => { seeking = true; });
  range.addEventListener('input', () => {
    const c = core(); const a = c && c.audio;
    const d = a && Number.isFinite(a.duration) ? a.duration : 0;
    if (!d || !c || typeof c.seek !== 'function') return;
    range.style.setProperty('--p', (Number(range.value) / 10).toFixed(2) + '%');
    curEl.textContent = fmt((Number(range.value) / 1000) * d);
    c.seek((Number(range.value) / 1000) * d);
  });
  range.addEventListener('change', () => { seeking = false; sync(); });
  range.addEventListener('pointerup', () => { seeking = false; sync(); });
  const a = (core() && core().audio) || document.querySelector('audio');
  if (a) ['timeupdate','seeked','loadedmetadata','durationchange','play'].forEach((ev) => a.addEventListener(ev, sync));
  setInterval(sync, 700);
  setTimeout(sync, 800);
})();

/* Noctra: developer mode and a touch-first element/background inspector.
   Unlock: Settings -> About -> tap the version label 7 times. The bug button then toggles
   pick mode: tap any element for its tag, selector, path, box, computed style and source
   marker; the "Фон" action cycles the live-background layers instead. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  if (window.__noctraDevInspector) return;
  window.__noctraDevInspector = true;

  const DEV_KEY = 'noctra_dev_mode';
  const FAB_KEY = 'noctra_dev_fab_pos';
  const root = document.documentElement;
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  const t = (ruText, enText) => (ru() ? ruText : enText);
  const toast = (text) => {
    try {
      if (window.MurielCore && typeof window.MurielCore.toast === 'function') window.MurielCore.toast(text, 'info');
    } catch (_) {}
  };

  const SOURCE_MAP = [
    { selector: '#sidebar', label: 'Меню · боковая панель', file: 'mobile/mobile-ui.js', token: 'buildChrome()' },
    { selector: '#mobile-rail-pull', label: 'Меню · язычок', file: 'mobile/mobile-ui.js', token: 'mobile-rail-pull' },
    { selector: '#mobile-rail-backdrop', label: 'Меню · затемнение', file: 'mobile/mobile-ui.js', token: 'mobile-rail-backdrop' },
    { selector: '#playbar', label: 'Мини-плеер', file: 'index.html', token: 'id="playbar"' },
    { selector: '#right-panel', label: 'Полноэкранный плеер', file: 'index.html', token: 'id="right-panel"' },
    { selector: '#noctra-np-head', label: 'Плеер · шапка', file: 'mobile/mobile-ui.js', token: 'noctra-np-head' },
    { selector: '#np-thick-timeline', label: 'Плеер · таймлайн', file: 'mobile/mobile-ui.js', token: 'np-thick-timeline' },
    { selector: '#np-tempo-panel', label: 'Плеер · Speed & Pitch', file: 'mobile/mobile-ui.js', token: 'buildTempo()' },
    { selector: '.right-panel-artwork-box', label: 'Плеер · обложка', file: 'index.html', token: 'right-panel-artwork-box' },
    { selector: '#noctra-mini-wave', label: 'Мини-плеер · волна', file: 'mobile/mobile-ui.js', token: 'NoctraWaveRenderer' },
    { selector: '#noctra-full-wave', label: 'Плеер · волна', file: 'mobile/mobile-ui.js', token: 'NoctraWaveRenderer' },
    { selector: '#view-discover', label: 'Home', file: 'index.html', token: 'id="view-discover"' },
    { selector: '#noctra-home-header', label: 'Home · приветствие', file: 'mobile/mobile-ui.js', token: 'homeHeader()' },
    { selector: '#noctra-daily', label: 'Home · Открытие дня', file: 'mobile/mobile-ui.js', token: "section.id = 'noctra-daily'" },
    { selector: '#noctra-profile-page', label: 'Профиль', file: 'mobile/mobile-ui.js', token: 'noctra-profile-page' },
    { selector: '#view-favorites', label: 'Избранное', file: 'index.html', token: 'id="view-favorites"' },
    { selector: '.fav-actions-row', label: 'Избранное · действия', file: 'mobile/mobile-ui.js', token: 'fav-actions-row' },
    { selector: '#view-settings', label: 'Настройки', file: 'index.html', token: 'id="view-settings"' },
    { selector: '.settings-nav', label: 'Настройки · категории', file: 'index.html', token: 'class="settings-nav"' },
    { selector: '#settings-section-about', label: 'О приложении', file: 'index.html', token: 'id="settings-section-about"' },
    { selector: '#card-gdrive', label: 'Интеграции · Google Drive', file: 'mobile/google-drive.js', token: "id = 'card-gdrive'" },
    { selector: '#nu-readmore-modal', label: 'Читать далее · модальное окно', file: 'mobile/mobile-ui.js', token: 'nu-readmore-modal' }
  ];

  const BG_MAP = [
    { selector: '#noctra-live-bg', label: 'Живой фон · корень', file: 'mobile/mobile-ui.js', token: 'buildLive()' },
    { selector: '#noctra-live-bg .noctra-orb', label: 'Живой фон · орб', file: 'mobile/mobile-ui.js', token: 'class="noctra-orb"' },
    { selector: '#noctra-live-bg .noctra-dot', label: 'Живой фон · частица', file: 'mobile/mobile-ui.js', token: 'class="noctra-dot"' },
    { selector: '#home-ambient', label: 'Home · ambient', file: 'index.html', token: 'id="home-ambient"' },
    { selector: '.home-ambient-layer', label: 'Home · ambient-слой', file: 'index.html', token: 'class="home-ambient-layer"' },
    { selector: '#right-panel', pseudo: '::after', label: 'Плеер · фоновое свечение', file: 'mobile/mobile.css', token: '#right-panel::after' },
    { selector: '.right-panel-artwork-box', pseudo: '::before', label: 'Обложка · свечение', file: 'mobile/mobile.css', token: '.right-panel-artwork-box::before' },
    { selector: '#playbar', label: 'Мини-плеер · фон', file: 'index.html', token: 'id="playbar"' }
  ];

  let fab = null, box = null, tip = null;
  let picking = false;
  let current = null;
  let currentEntry = null;
  let bgIndex = -1;
  let downX = 0, downY = 0, downTarget = null, moved = false;
  let tapCount = 0, tapTimer = 0;

  const isDev = () => root.classList.contains('noctra-dev');
  const devSelector = (el) => {
    if (!el || el.nodeType !== 1) return '';
    const cls = Array.from(el.classList || [])
      .filter((name) => name && !name.startsWith('nu-dev'))
      .slice(0, 3)
      .map((name) => '.' + name)
      .join('');
    if (el.id) return '#' + el.id + cls;
    if (cls) return el.tagName.toLowerCase() + cls;
    const parent = el.parentElement;
    if (parent) return el.tagName.toLowerCase() + ':nth-child(' + (Array.from(parent.children).indexOf(el) + 1) + ')';
    return el.tagName.toLowerCase();
  };

  function sourceFor(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      for (const item of SOURCE_MAP) {
        try { if (node.matches(item.selector)) return { ...item, element: node }; } catch (_) {}
      }
      node = node.parentElement;
    }
    return null;
  }

  function pathFor(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== root && parts.length < 8) {
      let name = node.tagName.toLowerCase();
      if (node.id) name += '#' + node.id;
      else if (node.classList && node.classList.length) name += '.' + Array.from(node.classList)[0];
      parts.unshift(name);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function styleFor(el, pseudo) {
    let cs;
    try { cs = getComputedStyle(el, typeof pseudo === 'string' && pseudo ? pseudo : null); } catch (_) { return ''; }
    const bits = [];
    const bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') bits.push(bg);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') bits.push(cs.backgroundImage.slice(0, 72));
    if (cs.borderRadius && cs.borderRadius !== '0px') bits.push('radius ' + cs.borderRadius);
    if (cs.zIndex && cs.zIndex !== 'auto') bits.push('z ' + cs.zIndex);
    if (cs.filter && cs.filter !== 'none') bits.push(cs.filter.slice(0, 48));
    if (cs.fontSize) bits.push(cs.fontSize);
    return bits.join(' · ');
  }

  function snippetFor(el) {
    if (!el || el === document.body) return '';
    if (el.matches && el.matches('input, textarea')) return String(el.value || el.placeholder || '').slice(0, 90);
    const text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > 1 && text.length <= 120 ? text : '';
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      area.style.pointerEvents = 'none';
      document.body.appendChild(area);
      area.focus();
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch (_) { return false; }
  }

  function copyPayload(el, entry) {
    const rect = el.getBoundingClientRect();
    const bgEntry = entry && typeof entry.selector === 'string' ? entry : null;
    const source = bgEntry || sourceFor(el);
    const pseudo = bgEntry && typeof bgEntry.pseudo === 'string' ? bgEntry.pseudo : '';
    const lines = [
      'selector: ' + (bgEntry ? bgEntry.selector + pseudo : devSelector(el)),
      'tag: ' + el.tagName.toLowerCase(),
      'path: ' + pathFor(el),
      'box: ' + Math.round(rect.width) + '×' + Math.round(rect.height) + ' @ ' + Math.round(rect.left) + ',' + Math.round(rect.top),
      'style: ' + styleFor(el, pseudo || null),
      source ? 'source: ' + source.file + ' :: ' + source.token : 'source: не найден в карте'
    ];
    const text = snippetFor(el);
    if (text) lines.push('text: "' + text + '"');
    return lines.join('\n');
  }

  function updateBox() {
    if (!box) return;
    if (!current || !current.isConnected) { box.classList.remove('visible'); return; }
    const rect = current.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) { box.classList.remove('visible'); return; }
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.width = rect.width + 'px';
    box.style.height = rect.height + 'px';
    box.classList.add('visible');
  }

  function makeButton(label, act, primary) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nu-dev-btn' + (primary ? ' primary' : '');
    btn.dataset.act = act;
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onAction(act, btn);
    });
    return btn;
  }

  function renderTip(opts) {
    if (!tip) return;
    tip.replaceChildren();
    const kicker = document.createElement('span');
    kicker.className = 'nu-dev-kicker';
    kicker.textContent = opts.kicker || 'ЭЛЕМЕНТ';
    const title = document.createElement('div');
    title.className = 'nu-dev-title';
    title.textContent = opts.title || '';
    tip.append(kicker, title);
    if (opts.meta) {
      const meta = document.createElement('div');
      meta.className = 'nu-dev-meta';
      meta.textContent = opts.meta;
      tip.append(meta);
    }
    if (opts.path) {
      const path = document.createElement('div');
      path.className = 'nu-dev-path';
      path.textContent = opts.path;
      tip.append(path);
    }
    if (opts.style) {
      const style = document.createElement('div');
      style.className = 'nu-dev-style';
      style.textContent = opts.style;
      tip.append(style);
    }
    if (opts.text) {
      const text = document.createElement('div');
      text.className = 'nu-dev-text';
      text.textContent = '«' + opts.text + '»';
      tip.append(text);
    }
    if (opts.source) {
      const source = document.createElement('div');
      source.className = 'nu-dev-src';
      source.textContent = opts.source;
      tip.append(source);
    }
    const actions = document.createElement('div');
    actions.className = 'nu-dev-actions';
    actions.append(
      makeButton(t('Копировать', 'Copy'), 'copy'),
      makeButton(t('Родитель', 'Parent'), 'parent'),
      makeButton(t('Фон', 'Background'), 'bg'),
      makeButton(t('Выйти', 'Exit'), 'close', true)
    );
    tip.append(actions);
    tip.classList.add('visible');
  }

  function showIntro() {
    if (!tip) return;
    current = null;
    currentEntry = null;
    if (box) box.classList.remove('visible');
    renderTip({
      kicker: 'DEV',
      title: t('Инспектор элементов', 'Element inspector'),
      meta: t('Нажмите на любой элемент интерфейса. Прокрутка работает как обычно; кнопка «Фон» листает слои живого фона.', 'Tap any UI element. Scrolling still works; the "Background" button cycles the live-background layers.'),
      source: t('Выход — «Выйти» или жук. Кнопку можно перетащить.', 'Exit with "Exit" or the bug. The bug button can be dragged.')
    });
  }

  function showSelection(el, entry) {
    if (!el || el === root || el === document.body) { showIntro(); return; }
    current = el;
    currentEntry = entry && entry.selector ? entry : null;
    updateBox();
    const rect = el.getBoundingClientRect();
    const pseudo = entry && entry.pseudo ? entry.pseudo : '';
    const source = entry || sourceFor(el);
    const title = entry ? entry.label : (source ? source.label : devSelector(el));
    const meta = el.tagName.toLowerCase() + (pseudo ? pseudo : '') + ' · ' +
      Math.round(rect.width) + '×' + Math.round(rect.height) + ' · x ' + Math.round(rect.left) + ', y ' + Math.round(rect.top);
    renderTip({
      kicker: entry ? 'ФОН' : 'ЭЛЕМЕНТ',
      title,
      meta,
      path: pathFor(el),
      style: styleFor(el, pseudo || null),
      text: entry ? '' : snippetFor(el),
      source: source ? source.file + ' :: ' + source.token : t('Источник не найден в карте', 'No source entry in the map')
    });
  }

  function bgLayers() {
    const list = [];
    BG_MAP.forEach((entry) => {
      const el = document.querySelector(entry.selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) return;
      list.push({ ...entry, el });
    });
    return list;
  }

  function cycleBackground() {
    const layers = bgLayers();
    if (!layers.length) {
      toast(t('Фоновые слои не найдены', 'No background layers found'));
      return;
    }
    bgIndex = (bgIndex + 1) % layers.length;
    const entry = layers[bgIndex];
    showSelection(entry.el, entry);
    const badge = tip && tip.querySelector('.nu-dev-kicker');
    if (badge) badge.textContent = 'ФОН ' + (bgIndex + 1) + '/' + layers.length;
  }

  function selectAt(el) {
    if (!el || el.closest('#nu-dev-tip, #nu-dev-fab, #nu-dev-box')) return;
    bgIndex = -1;
    showSelection(el, null);
  }

  function onAction(act, btn) {
    if (act === 'close') { setPicking(false); return; }
    if (act === 'bg') { cycleBackground(); return; }
    if (!current) return;
    if (act === 'parent') {
      const parent = current.parentElement;
      if (parent && parent !== document.body) showSelection(parent, null);
      else toast(t('Выше только body', 'Body is the top level'));
      return;
    }
    if (act === 'copy') {
      copyText(copyPayload(current, currentEntry)).then((ok) => {
        if (ok) {
          const label = btn.textContent;
          btn.textContent = t('Скопировано', 'Copied');
          setTimeout(() => { if (btn.isConnected) btn.textContent = label; }, 1200);
        } else {
          toast(t('Не удалось скопировать', 'Could not copy'));
        }
      });
    }
  }

  function setPicking(on) {
    if (!isDev() && on) return;
    picking = !!on;
    root.classList.toggle('nu-dev-picking', picking);
    if (fab) {
      fab.classList.toggle('active', picking);
      fab.setAttribute('aria-pressed', picking ? 'true' : 'false');
    }
    if (picking) showIntro();
    else {
      if (box) box.classList.remove('visible');
      if (tip) tip.classList.remove('visible');
      current = null;
      currentEntry = null;
      bgIndex = -1;
    }
  }

  function buildUi() {
    if (fab) return;
    fab = document.createElement('button');
    fab.type = 'button';
    fab.id = 'nu-dev-fab';
    fab.setAttribute('data-no-i18n', '');
    fab.setAttribute('aria-pressed', 'false');
    fab.setAttribute('aria-label', t('Инспектор элементов', 'Element inspector'));
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="7" width="8" height="11" rx="4"/><path d="M8 11H4M8 15H5M16 11h4M16 15h3M9 7 7 4M15 7l2-3M12 18v3"/></svg>';

    box = document.createElement('div');
    box.id = 'nu-dev-box';
    tip = document.createElement('div');
    tip.id = 'nu-dev-tip';
    tip.setAttribute('data-no-i18n', '');
    // body has contain:strict in the phone layout, which makes it the containing
    // block for fixed children; keep the inspector above it so it never scrolls away.
    document.documentElement.append(box, tip, fab);

    let drag = null;
    let suppressClick = false;
    fab.addEventListener('pointerdown', (e) => {
      if (!isDev()) return;
      const rect = fab.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, moved: false, startLeft: rect.left, startTop: rect.top };
      try { fab.setPointerCapture(e.pointerId); } catch (_) {}
    });
    fab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true;
      if (!drag.moved) return;
      const size = fab.offsetWidth || 46;
      const left = Math.max(4, Math.min(window.innerWidth - size - 4, drag.startLeft + dx));
      const top = Math.max(4, Math.min(window.innerHeight - size - 4, drag.startTop + dy));
      fab.style.left = left + 'px';
      fab.style.top = top + 'px';
      fab.style.right = 'auto';
      fab.style.bottom = 'auto';
      fab.classList.add('dragging');
    });
    const endDrag = () => {
      if (!drag) return;
      if (drag.moved) {
        suppressClick = true;
        try {
          localStorage.setItem(FAB_KEY, JSON.stringify({ x: parseInt(fab.style.left, 10), y: parseInt(fab.style.top, 10) }));
        } catch (_) {}
        setTimeout(() => { suppressClick = false; }, 300);
      }
      drag = null;
      fab.classList.remove('dragging');
    };
    fab.addEventListener('pointerup', endDrag);
    fab.addEventListener('pointercancel', endDrag);
    fab.addEventListener('click', () => {
      if (!isDev() || suppressClick) return;
      setPicking(!picking);
    });

    document.addEventListener('pointerdown', (e) => {
      if (!picking) return;
      if (e.target.closest('#nu-dev-tip, #nu-dev-fab, #nu-dev-box')) return;
      downX = e.clientX; downY = e.clientY; moved = false; downTarget = e.target;
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
    document.addEventListener('pointermove', (e) => {
      if (!picking || !downTarget) return;
      if (Math.abs(e.clientX - downX) > 10 || Math.abs(e.clientY - downY) > 10) moved = true;
    }, true);
    document.addEventListener('pointerup', (e) => {
      if (!picking || !downTarget) return;
      downTarget = null;
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (moved) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (target) selectAt(target);
    }, true);
    document.addEventListener('click', (e) => {
      if (!picking) return;
      if (e.target.closest('#nu-dev-tip, #nu-dev-fab')) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }, true);
    document.addEventListener('scroll', () => {
      if (picking && current) updateBox();
    }, true);
    window.addEventListener('resize', () => {
      if (!isDev() || !fab) return;
      const size = fab.offsetWidth || 46;
      if (fab.style.left && fab.style.top) {
        fab.style.left = Math.max(4, Math.min(window.innerWidth - size - 4, parseInt(fab.style.left, 10))) + 'px';
        fab.style.top = Math.max(4, Math.min(window.innerHeight - size - 4, parseInt(fab.style.top, 10))) + 'px';
      }
      if (picking && current) updateBox();
    }, { passive: true });

    try {
      const saved = JSON.parse(localStorage.getItem(FAB_KEY) || 'null');
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        fab.style.left = Math.max(4, Math.min(window.innerWidth - 50, saved.x)) + 'px';
        fab.style.top = Math.max(4, Math.min(window.innerHeight - 50, saved.y)) + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
      }
    } catch (_) {}
  }

  function ensureDevSetting() {
    const group = document.querySelector('#settings-section-about .m3-group');
    if (!group || document.getElementById('nu-dev-setting')) return;
    const item = document.createElement('div');
    item.className = 'setting-item';
    item.id = 'nu-dev-setting';
    item.setAttribute('data-no-i18n', '');
    item.innerHTML = '<div class="setting-item-top" style="align-items:center;">' +
      '<div style="display:flex;flex-direction:column;gap:2px;min-width:0;">' +
        '<div style="display:flex;align-items:center;gap:8px;"><span class="setting-name">' + t('Режим разработчика', 'Developer mode') + '</span><span class="noctra-beta-badge">DEV</span></div>' +
        '<span class="setting-hint">' + t('Инспектор элементов и фона — жук на экране.', 'Element and background inspector — the bug button.') + '</span>' +
      '</div>' +
      '<button type="button" class="effect-switch-btn active" id="nu-dev-switch"><span class="thumb"></span></button>' +
    '</div>' +
    '<div class="nu-dev-setting-actions"><button type="button" class="btn-outline-pill" id="nu-dev-open">' + t('Открыть инспектор', 'Open inspector') + '</button></div>';
    group.appendChild(item);
    item.querySelector('#nu-dev-open').addEventListener('click', () => setPicking(true));
    item.querySelector('#nu-dev-switch').addEventListener('click', () => setDev(false, true));
  }

  function removeDevSetting() {
    const item = document.getElementById('nu-dev-setting');
    if (item) item.remove();
  }

  function setDev(on, announce) {
    const next = !!on;
    root.classList.toggle('noctra-dev', next);
    try { localStorage.setItem(DEV_KEY, next ? '1' : '0'); } catch (_) {}
    if (next) {
      buildUi();
      ensureDevSetting();
    } else {
      setPicking(false);
      removeDevSetting();
      if (fab) fab.remove();
      if (box) box.remove();
      if (tip) tip.remove();
      fab = box = tip = null;
    }
    if (announce) toast(next
      ? t('Режим разработчика включён · нажмите жука', 'Developer mode on · tap the bug')
      : t('Режим разработчика выключен', 'Developer mode off'));
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#about-version')) return;
    tapCount += 1;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapCount = 0; }, 1800);
    if (tapCount >= 7) {
      tapCount = 0;
      setDev(!isDev(), true);
    }
  }, true);

  const start = () => {
    if (localStorage.getItem(DEV_KEY) === '1') setDev(true, false);
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', () => {
    if (localStorage.getItem(DEV_KEY) === '1' && !fab) setDev(true, false);
  }, { once: true });
})();

/* Noctra: the karaoke ranges are wrapped by app.js in its flat pill track; drive the fill
   ourselves so the styled track matches the value. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const sync = (input) => {
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max);
    const top = Number.isFinite(max) && max > min ? max : 100;
    const ratio = Math.max(0, Math.min(1, ((parseFloat(input.value) || 0) - min) / (top - min)));
    input.style.setProperty('--v', ratio.toFixed(4));
  };
  const wire = () => {
    document.querySelectorAll('#tv-karaoke input[type="range"]').forEach((input) => {
      if (input.dataset.nuRange === '1') { sync(input); return; }
      input.dataset.nuRange = '1';
      input.addEventListener('input', () => sync(input));
      input.addEventListener('change', () => sync(input));
      sync(input);
    });
  };
  const start = () => { wire(); setTimeout(wire, 600); setTimeout(wire, 1600); };
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', start, { once: true });
})();

/* Noctra: the speed & pitch presets become a compact dropdown in the Audio window.
   The original chips stay in the DOM (hidden) so app.js keeps all click/delete logic. */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  const T = (en, r) => (ru() ? r : en);
  let dd = null, label = null, menu = null, saveRow = null, chosen = '';

  function syncMenu() {
    if (!menu) return;
    const chips = [...document.querySelectorAll('#tempo-preset-chips .tempo-preset-chip')];
    menu.replaceChildren();
    let active = '';
    chips.forEach((chip) => {
      const nameEl = chip.querySelector('span');
      const name = nameEl ? nameEl.textContent.trim() : '';
      if (chip.classList.contains('active')) active = name;
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'nu-preset-option';
      const text = document.createElement('span');
      text.textContent = name;
      option.appendChild(text);
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        if (chip.isConnected) chip.click();
        chosen = name;
        label.textContent = name || T('Choose preset', 'Выберите пресет');
        menu.querySelectorAll('.nu-preset-option').forEach((x) => x.classList.toggle('active', x === option));
        dd.classList.remove('open');
      });
      const del = chip.querySelector('.tempo-preset-del');
      if (del) {
        const x = document.createElement('span');
        x.className = 'nu-preset-del';
        x.textContent = '×';
        x.setAttribute('role', 'button');
        x.setAttribute('aria-label', T('Delete preset', 'Удалить пресет'));
        x.title = T('Delete preset', 'Удалить пресет');
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          del.click();
          chosen = '';
          setTimeout(syncMenu, 40);
        });
        option.appendChild(x);
      }
      menu.appendChild(option);
    });
    const want = active || chosen;
    if (label) label.textContent = want || (chips.length ? T('Presets', 'Пресеты') : T('Choose preset', 'Выберите пресет'));
    [...menu.children].forEach((x) => {
      const text = x.querySelector('span');
      x.classList.toggle('active', !!want && !!text && text.textContent === want);
    });
    if (active) chosen = '';
  }

  function build() {
    const item = document.querySelector('.audio-panel[data-audio-panel="tempo"] .tempo-presets-item');
    const chips = document.getElementById('tempo-preset-chips');
    if (!item || !chips) return false;
    if (document.getElementById('nu-preset-controls')) { dd = document.getElementById('nu-preset-dd'); label = document.getElementById('nu-preset-label'); menu = document.getElementById('nu-preset-menu'); syncMenu(); return true; }
    const heading = item.querySelector('.setting-item-top .setting-name');
    if (heading) {
      heading.textContent = T('Speed & pitch presets', 'Пресеты скорости и шага');
      heading.setAttribute('data-no-i18n', '');
    }
    const controls = document.createElement('div');
    controls.className = 'nu-preset-controls';
    controls.id = 'nu-preset-controls';
    controls.innerHTML = '<div class="nu-preset-dd" id="nu-preset-dd"><button type="button" class="nu-preset-trigger" id="nu-preset-trigger" aria-haspopup="listbox" aria-expanded="false"><span id="nu-preset-label"></span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></button><div class="nu-preset-menu" id="nu-preset-menu" role="listbox"></div></div><button type="button" class="nu-preset-add" id="nu-preset-save-toggle" aria-label="' + T('Save current preset', 'Сохранить текущий пресет') + '">+</button>';
    item.insertBefore(controls, chips);
    dd = controls.querySelector('#nu-preset-dd');
    label = controls.querySelector('#nu-preset-label');
    menu = controls.querySelector('#nu-preset-menu');
    saveRow = item.querySelector('.tempo-preset-save');
    const trigger = controls.querySelector('#nu-preset-trigger');
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dd.classList.toggle('open');
      trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open && !menu.children.length) syncMenu();
    });
    const saveToggle = controls.querySelector('#nu-preset-save-toggle');
    if (saveRow) {
      saveToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = saveRow.classList.toggle('nu-open');
        if (open) {
          const input = saveRow.querySelector('#tempo-preset-name');
          if (input) setTimeout(() => input.focus(), 60);
        }
      });
      const saveBtn = saveRow.querySelector('#btn-save-tempo-preset');
      if (saveBtn) saveBtn.addEventListener('click', () => setTimeout(() => saveRow.classList.remove('nu-open'), 120));
    }
    document.addEventListener('click', () => {
      dd.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dd.classList.remove('open'); });
    new MutationObserver(() => syncMenu()).observe(chips, { childList: true, subtree: true });
    syncMenu();
    return true;
  }

  const start = () => {
    if (build()) return;
    let tries = 0;
    const timer = setInterval(() => {
      if (build() || ++tries > 40) clearInterval(timer);
    }, 250);
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', start, { once: true });
})();
