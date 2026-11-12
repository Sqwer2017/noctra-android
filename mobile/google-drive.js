/* Noctra: Google Drive backup (appDataFolder, drive.appdata scope). */
(() => {
  if (!document.documentElement.classList.contains('is-mobile')) return;
  const CFG = window.NOCTRA_GOOGLE_DRIVE || null;
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  // Same file and format as desktop Noctra: an encrypted .rfacc in appDataFolder.
  const FILE_NAME = 'noctra-account.rfacc';
  const LEGACY_FILE_NAME = 'noctra-backup.json';
  const RFACC_LABEL = 'riff-account-key-v1';
  const PENDING_KEY = 'noctra_gdrive_pending';
  const LAST_KEY = 'noctra_gdrive_last';
  const AUTO_KEY = 'noctra_gdrive_auto';
  const ru = () => localStorage.getItem('muriel_ui_lang') === 'ru';
  const T = (en, ruText) => (ru() ? ruText : en);
  const vault = window.__murielVault ? window.__murielVault('gdrive') : null;
  let busy = false;
  let card = null;

  function readAuth() {
    try {
      if (vault) return vault.read();
      const raw = localStorage.getItem('muriel_gdrive_auth');
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function writeAuth(auth) {
    try {
      if (vault) vault.write(auth);
      else localStorage.setItem('muriel_gdrive_auth', JSON.stringify(auth));
    } catch (e) { console.warn('[noctra] gdrive auth save', e); }
  }
  function clearAuth() {
    try {
      if (vault) { try { vault.write(null); } catch (e) {} }
      localStorage.removeItem('muriel_gdrive_auth');
    } catch (e) {}
  }
  function random(n) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  function b64url(buf) {
    let s = btoa(String.fromCharCode(...new Uint8Array(buf)));
    return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function challenge(verifier) {
    const data = new TextEncoder().encode(verifier);
    return b64url(await crypto.subtle.digest('SHA-256', data));
  }
  async function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function') throw new Error(T('This device cannot create an account backup', 'Это устройство не умеет создавать резервную копию аккаунта'));
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  // Desktop Noctra account file: "RFAC", 12-byte IV, 16-byte GCM tag,
  // then AES-256-GCM of deflate-raw(JSON) under sha256('riff-account-key-v1').
  async function encryptRfacc(payload) {
    const compressed = await deflateRaw(new TextEncoder().encode(JSON.stringify(payload)));
    const keyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(RFACC_LABEL));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, compressed));
    const body = sealed.slice(0, sealed.length - 16);
    const tag = sealed.slice(sealed.length - 16);
    const out = new Uint8Array(4 + 12 + 16 + body.length);
    out.set(new TextEncoder().encode('RFAC'), 0);
    out.set(iv, 4);
    out.set(tag, 16);
    out.set(body, 32);
    return out;
  }
  function toast(text, kind) {
    try { window.MurielCore && window.MurielCore.toast(text, kind || 'info'); } catch (e) {}
  }
  function plugin(name) {
    try { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]; } catch (e) { return null; }
  }
  async function openAuth(authUrl) {
    const Browser = plugin('Browser');
    if (Browser && typeof Browser.open === 'function') return Browser.open({ url: authUrl });
    window.open(authUrl, '_blank');
  }
  async function closeAuthBrowser() {
    const Browser = plugin('Browser');
    try { if (Browser && Browser.close) await Browser.close(); } catch (e) {}
  }
  async function login() {
    if (!CFG || !CFG.clientId) {
      toast(T('Google Drive is not configured in this build', 'Google Диск не настроен в этой сборке'), 'error');
      return false;
    }
    const verifier = random(48);
    const state = random(16);
    const redirectUri = CFG.redirectUri || 'noctra://oauth2redirect';
    localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, redirectUri }));
    const params = new URLSearchParams({
      client_id: CFG.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      state,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent'
    });
    await openAuth('https://accounts.google.com/o/oauth2/v2/auth?' + params.toString());
    return true;
  }
  function pending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { return null; }
  }
  async function exchange(code, p) {
    if (!CFG || !CFG.clientId) throw new Error(T('Google OAuth client ID is missing', 'Не задан Google OAuth client ID'));
    const body = new URLSearchParams({
      client_id: CFG.clientId,
      code,
      code_verifier: p.verifier,
      grant_type: 'authorization_code',
      redirect_uri: p.redirectUri
    });
    // Android/iOS OAuth clients are public and have no secret; web clients still use one.
    if (CFG.clientSecret) body.set('client_secret', CFG.clientSecret);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Google token exchange failed');
    writeAuth({
      accessToken: data.access_token,
      refreshToken: data.refresh_token || '',
      expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
      scope: data.scope || SCOPE
    });
    localStorage.removeItem(PENDING_KEY);
    await closeAuthBrowser();
    refreshUI();
    toast(T('Google Drive connected', 'Google Диск подключён'), 'success');
  }
  async function handleRedirect(rawUrl) {
    const redirectUri = (CFG && CFG.redirectUri) || 'noctra://oauth2redirect';
    if (!rawUrl || !String(rawUrl).startsWith(redirectUri)) return;
    const p = pending();
    if (!p) return;
    let u;
    try { u = new URL(String(rawUrl).replace(redirectUri, 'https://oauth.local/')); } catch (e) { return; }
    const error = u.searchParams.get('error');
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    if (error) { toast(error === 'access_denied' ? T('Google sign-in was cancelled', 'Вход в Google отменён') : error, 'error'); return; }
    if (!code || state !== p.state) { toast(T('Google sign-in could not be verified', 'Не удалось проверить вход в Google'), 'error'); return; }
    try { await exchange(code, p); } catch (e) { toast(e.message, 'error'); }
  }
  function setupRedirect() {
    const AppPlugin = plugin('App');
    if (AppPlugin && AppPlugin.addListener) {
      AppPlugin.addListener('appUrlOpen', (e) => handleRedirect(e && e.url));
      if (AppPlugin.getLaunchUrl) AppPlugin.getLaunchUrl().then((r) => handleRedirect(r && r.url)).catch(() => {});
    }
  }
  async function getToken() {
    const auth = readAuth();
    if (!auth) throw new Error(T('Sign in to Google Drive first', 'Сначала войдите в Google Диск'));
    if (auth.accessToken && auth.expiresAt > Date.now() + 60000) return auth.accessToken;
    if (!auth.refreshToken) throw new Error(T('Google Drive session expired. Sign in again.', 'Сессия Google Диска истекла. Войдите снова.'));
    if (!CFG || !CFG.clientId) throw new Error(T('Google OAuth client ID is missing', 'Не задан Google OAuth client ID'));
    const body = new URLSearchParams({
      client_id: CFG.clientId,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token'
    });
    if (CFG.clientSecret) body.set('client_secret', CFG.clientSecret);
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Google token refresh failed');
    auth.accessToken = data.access_token;
    auth.expiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    if (data.refresh_token) auth.refreshToken = data.refresh_token;
    writeAuth(auth);
    return auth.accessToken;
  }
  async function driveFetch(path, opts = {}) {
    const token = await getToken();
    const res = await fetch('https://www.googleapis.com' + path, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + token }
    });
    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = (j.error && j.error.message) || ''; } catch (e) {}
      throw new Error('Drive ' + res.status + (detail ? ': ' + detail : ''));
    }
    return res;
  }
  async function findFile(name) {
    const fileName = name || FILE_NAME;
    const q = encodeURIComponent("name='" + fileName + "' and trashed=false");
    const res = await driveFetch('/drive/v3/files?spaces=appDataFolder&q=' + q + '&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime%20desc&pageSize=1');
    const data = await res.json();
    return data && Array.isArray(data.files) ? data.files[0] : null;
  }
  function accountPayload() {
    const dump = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.startsWith('muriel_secret_') || k === 'muriel_gdrive_auth' || k === PENDING_KEY) continue;
        dump[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    // Desktop reads riff_user_*; keep the phone profile in that shape too.
    try {
      const P = window.MurielProfiles;
      const me = P && typeof P.current === 'function' ? P.current() : null;
      if (me && me.name) dump.riff_user_nickname = me.name;
      let extras = {};
      try { extras = JSON.parse(localStorage.getItem('noctra_profile_extra_v1') || '{}') || {}; } catch (e) {}
      const ex = extras[(me && (me.id || me.name)) || 'default'] || {};
      if (ex.bio) dump.riff_user_bio = ex.bio;
      if (ex.effect) dump.riff_user_banner_fx = ex.effect;
      if (typeof ex.avatar === 'string' && ex.avatar.startsWith('data:image/')) dump.riff_user_avatar = ex.avatar;
      if (typeof ex.banner === 'string' && ex.banner.startsWith('data:image/')) dump.riff_user_banner = ex.banner;
    } catch (e) {}
    return { app: 'Noctra', version: 1, source: 'google-drive', exportedAt: Date.now(), localStorage: dump };
  }
  async function backup() {
    if (busy) return false;
    busy = true; refreshUI();
    try {
      const payload = accountPayload();
      const body = await encryptRfacc(payload);
      let file = await findFile();
      if (!file) {
        const res = await driveFetch('/drive/v3/files?fields=id,name', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })
        });
        file = await res.json();
      }
      await driveFetch('/upload/drive/v3/files/' + encodeURIComponent(file.id) + '?uploadType=media&fields=id,modifiedTime,size', {
        method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body
      });
      const info = { at: Date.now(), size: body.length };
      localStorage.setItem(LAST_KEY, JSON.stringify(info));
      toast(T('Backup saved to Google Drive', 'Резервная копия сохранена в Google Диск'), 'success');
      refreshUI();
      return true;
    } catch (e) {
      toast(e.message || T('Google Drive backup failed', 'Не удалось сохранить копию'), 'error');
      return false;
    } finally { busy = false; refreshUI(); }
  }
  async function restore() {
    if (!readAuth()) { toast(T('Sign in to Google Drive first', 'Сначала войдите в Google Диск')); return; }
    if (!window.confirm(T('Replace this profile with the Google Drive backup? Noctra will restart.', 'Заменить текущий профиль резервной копией из Google Диска? Noctra перезапустится.'))) return;
    busy = true; refreshUI();
    try {
      const file = await findFile() || await findFile(LEGACY_FILE_NAME);
      if (!file) throw new Error(T('No backup found on Google Drive', 'В Google Диске нет резервной копии'));
      const res = await driveFetch('/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media');
      const bytes = new Uint8Array(await res.arrayBuffer());
      const B = window.MurielBackup;
      if (!B) throw new Error(T('Backup reader is not available', 'Модуль резервных копий недоступен'));
      const parsed = await B.parseBackupFile(bytes);
      const P = window.MurielProfiles;
      const me = P && typeof P.current === 'function' ? P.current() : null;
      const isDevice = (k) => !!(P && typeof P.isDevice === 'function' && P.isDevice(k));
      const backup = B.readBackup(parsed, { isDevice });
      if (!backup.counts.keys) throw new Error(T('That backup has nothing to restore', 'В этой копии нечего восстанавливать'));
      const entries = backup.entries;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && !B.keepOnRestore(k, isDevice) && !(k in entries)) { try { localStorage.removeItem(k); } catch (e) {} }
      }
      Object.entries(entries).forEach(([k, v]) => { try { localStorage.setItem(k, v); } catch (e) {} });

      // The desktop account carries profile fields under riff_user_* and its XP under
      // riff_profile_v1; the mobile profile reads its own extras shape and XP key.
      const raw = (parsed && parsed.localStorage) || parsed || {};
      const rawStr = (k) => (typeof raw[k] === 'string' ? raw[k] : null);
      const xp = rawStr('riff_profile_v1');
      if (xp) { try { localStorage.setItem('riff_profile_v1', xp); } catch (e) {} }
      const nickname = (rawStr('riff_user_nickname') || rawStr('muriel_user_nickname') || '').trim();
      if (nickname && me && P && typeof P.update === 'function') {
        try { P.update(me.id, { name: nickname.slice(0, 32) }); } catch (e) {}
      }
      const bio = (rawStr('riff_user_bio') || rawStr('muriel_user_bio') || '').trim();
      const effect = (rawStr('riff_user_banner_fx') || rawStr('muriel_user_banner_fx') || '').trim();
      const avatar = rawStr('riff_user_avatar') || rawStr('muriel_user_avatar') || '';
      const banner = rawStr('riff_user_banner') || rawStr('muriel_user_banner') || '';
      if (me && (bio || effect || avatar || banner)) {
        let all = {};
        try { all = JSON.parse(localStorage.getItem('noctra_profile_extra_v1') || '{}') || {}; } catch (e) {}
        const id = me.id || me.name || 'default';
        const ex = all[id] || {};
        if (bio) ex.bio = bio.slice(0, 180);
        if (['none', 'embers', 'fog', 'aurora', 'stars'].includes(effect)) ex.effect = effect;
        if (typeof avatar === 'string' && avatar.startsWith('data:image/')) ex.avatar = avatar;
        if (typeof banner === 'string' && banner.startsWith('data:image/')) ex.banner = banner;
        all[id] = ex;
        try { localStorage.setItem('noctra_profile_extra_v1', JSON.stringify(all)); } catch (e) {}
      }
      toast(T('Backup restored, restarting...', 'Копия восстановлена, перезапуск...'), 'success');
      setTimeout(() => location.reload(), 500);
      return true;
    } catch (e) {
      toast(e.message || T('Google Drive restore failed', 'Не удалось восстановить копию'), 'error');
      return false;
    } finally { busy = false; refreshUI(); }
  }
  function lastInfo() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { return null; }
  }
  function when(ts) {
    try { return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function refreshUI() {
    if (!card) return;
    const auth = readAuth();
    const connected = !!(auth && auth.refreshToken);
    card.classList.toggle('is-connected', connected);
    const panel = card.querySelector('#gd-panel');
    if (panel) panel.hidden = !connected;
    const loginBtn = card.querySelector('#gd-login');
    if (loginBtn) {
      loginBtn.hidden = connected;
      loginBtn.disabled = busy;
      loginBtn.textContent = busy ? T('Connecting...', 'Подключение...') : T('Sign in', 'Войти');
    }
    const outBtn = card.querySelector('#gd-logout');
    if (outBtn) outBtn.hidden = !connected;
    const status = card.querySelector('#gd-status');
    if (status) {
      status.textContent = connected
        ? T('Connected — Google Drive backup is ready', 'Подключено — резервное копирование готово')
        : (CFG ? T('Save your library and settings in Google Drive', 'Сохраняйте библиотеку и настройки в Google Диске') : T('Google Drive is not configured in this build', 'Google Диск не настроен в этой сборке'));
    }
    const last = lastInfo();
    const lastEl = card.querySelector('#gd-last');
    if (lastEl) lastEl.textContent = last && last.at ? T('Last backup: ' + when(last.at), 'Последняя копия: ' + when(last.at)) : T('No backup yet', 'Резервной копии пока нет');
    const auto = card.querySelector('#gd-auto');
    if (auto) {
      auto.classList.toggle('active', localStorage.getItem(AUTO_KEY) === '1');
      auto.disabled = !connected;
    }
    card.querySelectorAll('#gd-backup,#gd-restore').forEach((b) => { b.disabled = !connected || busy; });
  }
  function addCard() {
    if (card) return;
    const section = document.querySelector('.settings-section[data-cat="integrations"]');
    if (!section) return;
    const group = section.querySelector('.m3-group') || section;
    card = document.createElement('div');
    card.className = 'setting-item';
    card.id = 'card-gdrive';
    card.innerHTML = `
      <div class="setting-item-top" style="align-items:center;justify-content:space-between;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="#0F9D58" d="M8.3 2.4 1 15.1l3.7 6.5 7.3-12.7z"/><path fill="#4285F4" d="M8.3 2.4h7.4L23 15.1h-7.4z"/><path fill="#EA4335" d="M15.7 15.1H23l-3.7 6.5h-7.4z"/><path fill="#F4B400" d="M4.7 21.6 7 17.7h11.6l-2.3 3.9z" opacity=".92"/></svg>
          <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;"><span class="setting-name" data-no-i18n>${T('Google Drive backup', 'Резервная копия в Google Диске')}</span><span class="noctra-beta-badge">NEW</span></div>
            <span class="setting-hint" id="gd-status" data-no-i18n></span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <button type="button" class="btn-outline-pill" id="gd-logout" data-no-i18n>${T('Sign out', 'Выйти')}</button>
          <button type="button" class="btn-pill-primary" id="gd-login" data-no-i18n>${T('Sign in', 'Войти')}</button>
        </div>
      </div>
      <div id="gd-panel" hidden style="display:flex;flex-direction:column;gap:8px;margin-top:10px;">
        <div class="gd-meta"><span id="gd-last" data-no-i18n></span><span id="gd-info" data-no-i18n></span></div>
        <div class="gd-actions"><button type="button" class="btn-pill-primary" id="gd-backup" data-no-i18n>${T('Back up now', 'Сохранить сейчас')}</button><button type="button" class="btn-outline-pill" id="gd-restore" data-no-i18n>${T('Restore', 'Восстановить')}</button></div>
        <div class="gd-auto"><span data-no-i18n>${T('Automatic backup every 6 hours', 'Автоматическая копия каждые 6 часов')}</span><button type="button" class="effect-switch-btn" id="gd-auto"><span class="thumb"></span></button></div>
      </div>`;
    group.insertBefore(card, group.querySelector('.setting-item') || null);
    card.querySelector('#gd-login').addEventListener('click', async () => { busy = true; refreshUI(); await login(); busy = false; refreshUI(); });
    card.querySelector('#gd-logout').addEventListener('click', async () => { clearAuth(); await closeAuthBrowser(); refreshUI(); toast(T('Signed out of Google Drive', 'Выход из Google Диска выполнен')); });
    card.querySelector('#gd-backup').addEventListener('click', backup);
    card.querySelector('#gd-restore').addEventListener('click', restore);
    card.querySelector('#gd-auto').addEventListener('click', () => {
      const next = localStorage.getItem(AUTO_KEY) !== '1';
      localStorage.setItem(AUTO_KEY, next ? '1' : '0');
      refreshUI();
      toast(next ? T('Automatic backup enabled', 'Автоматическая копия включена') : T('Automatic backup disabled', 'Автоматическая копия выключена'));
      if (next) autoCheck();
    });
    refreshUI();
  }
  async function autoCheck() {
    if (localStorage.getItem(AUTO_KEY) !== '1' || !readAuth()) return;
    const last = lastInfo();
    if (last && last.at && Date.now() - last.at < 6 * 60 * 60 * 1000) return;
    await backup();
  }
  function start() {
    addCard();
    setupRedirect();
    setTimeout(autoCheck, 2500);
    setInterval(autoCheck, 15 * 60 * 1000);
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
  window.addEventListener('muriel:ready', addCard, { once: true });
})();
