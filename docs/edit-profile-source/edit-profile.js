// Источник: mobile/mobile-ui.js:2321-2607
// IIFE окна «Редактировать профиль»: шаблон HTML, живой предпросмотр, аватар, баннер, эффекты и сохранение.

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
