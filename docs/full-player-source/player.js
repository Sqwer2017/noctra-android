// Источник: mobile/mobile-ui.js. Каждый блок — отдельный IIFE, который выполняется в мобильной сборке.

// ===== mobile-ui.js:957-1040 — фоновая волна полноэкранного плеера =====
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


// ===== mobile-ui.js:1056-1171 — общий Canvas-рендерер волн (bars / wave / ribbon / aurora) =====
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

// ===== mobile-ui.js:1246-1332 — бейдж профиля + карточка Speed & Pitch =====
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

// ===== mobile-ui.js:2080-2137 — режим текста и прогресс для playbar =====
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

// ===== mobile-ui.js:2520-2539 — верхняя панель #noctra-np-head =====
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

// ===== mobile-ui.js:2541-2582 — #np-thick-timeline (толстый таймлайн) =====
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
