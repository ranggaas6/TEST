// ==UserScript==
// @name         KissKH Plugin
// @namespace    https://kisskh.co/
// @version      2.0.1
// @description  Plugin KissKH untuk Drama Explorer — search, badge, episode player, stream langsung, subtitle decrypt
// @author       UserScript
// ==/UserScript==

(function () {
'use strict';

if (typeof window._pluginAPI === 'undefined') {
  console.warn('[KissKH Plugin] window._pluginAPI tidak tersedia.');
  return;
}

const API       = window._pluginAPI;
const PLUGIN_ID = 'kisskh';

// ── CSS ───────────────────────────────────────────────────────────────────
(function injectCSS() {
  const style = document.createElement('style');
  style.textContent = `
    .overlay-btn.kk-btn { background: #e94560; }
    .overlay-btn.kk-btn:hover { background: #ff5070; }
    .action-btn.kk { background: #e94560; }
    .action-btn.kk:hover { background: #ff5070; }
    .ep-btn.kk-ep:hover, .ep-btn.kk-ep.active { border-color: #e94560; color: #e94560; }
    .ep-btn.kk-ep.active { background: #e9456022; }

    .kk-player-section { padding: 0 24px 24px; }
    .kk-player-title { font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:10px; }
    .kk-player-wrap { position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden; }
    .kk-player-wrap video { width:100%;height:100%;outline:none; }
    .kk-player-wrap iframe { width:100%;height:100%;border:none; }
    .kk-player-loading { position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:var(--surface2);color:var(--muted);font-size:13px;z-index:2; }
    .kk-player-loading .spinner { display:block!important;width:24px;height:24px;border:3px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite; }
    .kk-player-error { padding:20px;display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--accent);font-size:13px;text-align:center;background:var(--surface2);border-radius:10px;margin-bottom:8px; }

    .kk-ctrl-bar { display:flex;align-items:center;gap:8px;padding:6px 0;flex-wrap:wrap; }
    .kk-ctrl-label { font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);flex-shrink:0; }
    .kk-ctrl-btn { background:var(--surface2);border:1px solid var(--border2);color:var(--muted2);font-family:Outfit,sans-serif;font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;transition:all .15s; }
    .kk-ctrl-btn:hover { border-color:var(--accent);color:var(--accent); }
    .kk-ctrl-btn.active { background:var(--accent);border-color:var(--accent);color:#fff; }
    .kk-ctrl-btn.sub-active { background:#059669cc;border-color:#059669;color:#fff; }

    .kk-opentab { display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid var(--border2);color:var(--muted2);font-family:Outfit,sans-serif;font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;text-decoration:none;transition:all .15s; }
    .kk-opentab:hover { border-color:var(--accent2);color:var(--accent2); }
  `;
  document.head.appendChild(style);
})();

// ── Constants ─────────────────────────────────────────────────────────────
const KK_BASE   = 'https://kisskh.co';
const KK_SEARCH = KK_BASE + '/api/DramaList/Search?q=';
const KK_DRAMA  = KK_BASE + '/api/DramaList/Drama/';
const KK_EPSRC  = KK_BASE + '/api/DramaList/Episode/';
const KK_SUB    = KK_BASE + '/api/Sub/';

// ── AES-CBC Subtitle Decryptor (dari SubDecryptor.kt) ─────────────────────
// Tiga pasang Key/IV persis seperti di SubDecryptor.kt
function _i32ToBytes(arr) {
  const b = new Uint8Array(arr.length * 4);
  arr.forEach((v, i) => {
    b[i*4]   = (v >>> 24) & 0xff;
    b[i*4+1] = (v >>> 16) & 0xff;
    b[i*4+2] = (v >>>  8) & 0xff;
    b[i*4+3] =  v         & 0xff;
  });
  return b;
}

const _KK_KEYIVS = [
  { key: 'AmSmZVcH93UQUezi', iv: _i32ToBytes([1382367819, 1465333859, 1902406224, 1164854838]) },
  { key: '8056483646328763', iv: _i32ToBytes([909653298,  909193779,  925905208,  892483379])  },
  { key: 'sWODXX04QRTkHdlZ', iv: _i32ToBytes([946894696,  1634749029, 1127508082, 1396271183]) }
];

async function _decryptLine(b64) {
  let enc;
  try {
    const bin = atob(b64.trim());
    enc = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) enc[i] = bin.charCodeAt(i);
  } catch { return b64; }

  for (const { key, iv } of _KK_KEYIVS) {
    try {
      const ck = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(key), { name: 'AES-CBC' }, false, ['decrypt']
      );
      const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, ck, enc);
      return new TextDecoder().decode(plain);
    } catch {}
  }
  return b64;
}

// Dekripsi file .txt subtitle (format chunk-based dari getVideoInterceptor)
async function _decryptSubTxt(raw) {
  const chunks = raw.split(/^\d+$/m).filter(c => c.trim());
  const out = [];
  let idx = 0;
  for (const chunk of chunks) {
    const parts = chunk.trim().split('\n');
    if (!parts.length) continue;
    const header = parts[0];
    const lines  = parts.slice(1);
    const dec    = [];
    for (const ln of lines) {
      if (!ln.trim()) { dec.push(''); continue; }
      try { dec.push(await _decryptLine(ln)); } catch { dec.push(ln); }
    }
    out.push([idx + 1, header, dec.join('\n')].join('\n'));
    idx++;
  }
  return out.join('\n\n');
}

// ── Cache ─────────────────────────────────────────────────────────────────
const _kkCache    = new Map(); // tmdbId  → { title, list }
const _kkEpCache  = new Map(); // kkId    → episodes[]
const _kkKeyCache = new Map(); // epsId   → kkey

// ── Helpers ───────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function normT(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
function score(base, item) {
  if (!base || !item) return 0;
  if (item === base) return 100;
  const bw = base.split(' '), iw = item.split(' ');
  if (iw.length < bw.length) return 0;
  for (let i = 0; i < bw.length; i++) if (iw[i] !== bw[i]) return 0;
  const suf = iw.slice(bw.length);
  if (!suf.length) return 90;
  if (suf.length === 1 && /^\d+$/.test(suf[0])) return 80;
  if (suf.length === 2 && suf[0] === 'season' && /^\d+$/.test(suf[1])) return 80;
  if (bw.length >= 4) return 50;
  return 0;
}
function kkPageUrl(kk, epId) {
  const slug = (kk.title || '').replace(/\([^)]*\)/g,'').trim()
    .replace(/[^a-zA-Z0-9\s-]/g,'').trim().replace(/\s+/g,'-');
  const base = KK_BASE + '/Drama/' + encodeURIComponent(slug) + '?id=' + kk.id;
  return epId ? base + '&ep=' + epId : base;
}
function _detectType(url) {
  const u = (url||'').split('?')[0].toLowerCase();
  if (u.endsWith('.m3u8')) return 'm3u8';
  if (u.endsWith('.mp4'))  return 'mp4';
  return 'embed';
}
function _subLang(label) {
  const l = (label||'').toLowerCase();
  if (l.includes('indo'))    return 'id';
  if (l.includes('eng'))     return 'en';
  if (l.includes('arabic'))  return 'ar';
  if (l.includes('spanish')) return 'es';
  return 'und';
}
async function _loadHlsJs() {
  if (window.Hls) return;
  await new Promise(res => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.4.12/hls.min.js';
    s.onload = res; s.onerror = res;
    document.head.appendChild(s);
  });
}

// ── Ambil kkey (diperlukan untuk /api/DramaList/Episode/{id}.png) ─────────
// KisskhProvider mengambil kkey dari private BuildConfig endpoint.
// Endpoint tersebut tidak publik sehingga kita coba dengan kkey kosong dahulu.
// Jika gagal, arahkan user ke halaman KissKH langsung.
async function _getKkey(epsId) {
  if (_kkKeyCache.has(epsId)) return _kkKeyCache.get(epsId);
  return '';
}

// ── Ambil sources video episode ───────────────────────────────────────────
async function _fetchSources(epsId, kkItem) {
  const kkey    = await _getKkey(epsId);
  const referer = kkPageUrl(kkItem, epsId);

  // Coba dua variasi URL endpoint (dengan dan tanpa .png)
  const urls = [
    KK_EPSRC + epsId + '.png?err=false&ts=&time=&kkey=' + kkey,
    KK_EPSRC + epsId + '?err=false&ts=&time=&kkey=' + kkey
  ];

  let lastErr = null;
  for (const url of urls) {
    try {
      API.dbg.log('[KissKH] Fetch source: ' + url.replace(/kkey=[^&]*/,'kkey=***'), 'info');
      const res = await API.launcherFetch(url, null, {
        'Referer': referer,
        'Origin':  KK_BASE
      }, 'GET');
      const rawBody = res.body || res;
      if (!rawBody || rawBody === 'undefined' || typeof rawBody !== 'string' || rawBody.trim() === '') {
        API.dbg.log('[KissKH] Source response kosong, status: ' + (res.status||'?'), 'warn');
        lastErr = new Error('Response kosong (status ' + (res.status||'?') + ')');
        continue;
      }
      const d = JSON.parse(rawBody);
      API.dbg.log('[KissKH] Source OK: video=' + (d.Video||d.video||'-') + ' 3p=' + (d.ThirdParty||d.thirdParty||'-'), 'success');
      return {
        video:      d.Video      || d.video      || null,
        thirdParty: d.ThirdParty || d.thirdParty || null
      };
    } catch(e) {
      API.dbg.log('[KissKH] Source error: ' + e.message, 'warn');
      lastErr = e;
    }
  }
  throw lastErr || new Error('Semua endpoint gagal');
}

// ── Ambil subtitle list ───────────────────────────────────────────────────
async function _fetchSubs(epsId) {
  try {
    const kkey = await _getKkey(epsId);
    const url  = KK_SUB + epsId + (kkey ? '?kkey=' + kkey : '');
    const res  = await API.launcherFetch(url, null, {}, 'GET');
    const rawBody = (res && res.body) ? res.body : res;
    if (!rawBody || typeof rawBody !== 'string' || rawBody.trim() === '' || rawBody === 'undefined') return [];
    const arr = JSON.parse(rawBody);
    return Array.isArray(arr) ? arr.filter(s => s.src && s.label) : [];
  } catch { return []; }
}

// ── Fetch + dekripsi konten subtitle ─────────────────────────────────────
async function _fetchSubContent(src) {
  try {
    const res = await API.launcherFetch(src, null, {}, 'GET');
    const body = (res && res.body) ? res.body : res;
    if (!body || typeof body !== 'string' || body === 'undefined') return null;
    // File .txt → AES decrypt (dari getVideoInterceptor KisskhProvider)
    if (src.includes('.txt')) return await _decryptSubTxt(body);
    return body; // .srt / .vtt langsung pakai
  } catch { return null; }
}

// ── Search KissKH ─────────────────────────────────────────────────────────
async function searchKissKH(title, tmdbYear, tmdbType) {
  const normBase = normT(title);
  if (!normBase) return [];

  const seen = new Set(), results = [];
  function addIfMatch(item) {
    if (seen.has(item.id)) return;
    const ns = normT(item.title || '');
    if (!ns || score(normBase, ns) === 0) return;
    if (tmdbYear) {
      const m = (item.title || '').match(/\((\d{4})\)/);
      if (m && Math.abs(parseInt(m[1]) - parseInt(tmdbYear)) > 1) return;
    }
    seen.add(item.id); results.push(item);
  }

  try {
    const _sRes = await API.launcherFetch(KK_SEARCH + encodeURIComponent(title) + '&type=0');
    const _sBody = (_sRes && _sRes.body) ? _sRes.body : _sRes;
    if (!_sBody || typeof _sBody !== 'string' || _sBody === 'undefined') throw new Error('empty');
    const d = JSON.parse(_sBody);
    if (Array.isArray(d)) d.forEach(addIfMatch);
  } catch {}

  results.sort((a, b) => {
    const sa = score(normBase, normT(a.title||''));
    const sb = score(normBase, normT(b.title||''));
    return sb !== sa ? sb - sa : normT(a.title||'').length - normT(b.title||'').length;
  });

  if (!results.length || !tmdbType) return results;

  // Verifikasi tipe (movie vs tv) — sesuai loadLinks KisskhProvider
  const verified = [];
  await Promise.all(results.map(async item => {
    try {
      const _dr2 = await API.launcherFetch(KK_DRAMA + item.id + '?id=' + item.id);
      const _db2 = (_dr2 && _dr2.body) ? _dr2.body : _dr2;
      const detail = JSON.parse(_db2);
      const t = (detail.type || '').toLowerCase();
      const isMovie  = ['movie','hollywood','bollywood'].includes(t);
      const isSeries = !isMovie;
      if (tmdbType === 'movie' && isSeries) return;
      if (tmdbType === 'tv'    && isMovie)  return;
      item._detail = detail;
      verified.push(item);
    } catch { verified.push(item); }
  }));
  return verified;
}

// ── Badge check ───────────────────────────────────────────────────────────
async function checkKissKH(tmdbId, type, title, year) {
  if (_kkCache.has(tmdbId)) {
    const c = _kkCache.get(tmdbId).list;
    if (API.cache) API.cache[PLUGIN_ID + '_' + tmdbId] = c || false;
    return c || false;
  }

  let searchTitle = title;
  // Judul non-latin → ambil en-US dari TMDB
  if (!normT(title)) {
    try {
      const tmdb = API.getTmdb();
      const r = await fetch(tmdb.base + '/' + (type||'tv') + '/' + tmdbId + '?api_key=' + tmdb.apiKey + '&language=en-US');
      if (r.ok) { const d = await r.json(); searchTitle = d.name || d.title || title; }
    } catch {}
  }

  const list = await searchKissKH(searchTitle, year, type);
  const val  = list.length ? list : null;
  _kkCache.set(tmdbId, { title: searchTitle, list: val });
  if (API.cache) API.cache[PLUGIN_ID + '_' + tmdbId] = val || false;
  return val || false;
}

// ── Load daftar episode ───────────────────────────────────────────────────
async function _loadEpList(kkItem) {
  if (_kkEpCache.has(kkItem.id)) return _kkEpCache.get(kkItem.id);

  let eps = kkItem._detail ? (kkItem._detail.episodes || kkItem._detail.sub || []) : [];
  if (!eps.length) {
    try {
      const _epR = await API.launcherFetch(KK_DRAMA + kkItem.id + '?id=' + kkItem.id);
      const _epB = (_epR && _epR.body) ? _epR.body : _epR;
      const d = JSON.parse(_epB);
      eps = d.episodes || d.sub || [];
      kkItem._detail = d;
    } catch { eps = []; }
  }
  _kkEpCache.set(kkItem.id, eps);
  return eps;
}

// ── Render Player ─────────────────────────────────────────────────────────
async function _renderPlayer(ep, epNum, kkItem, extra) {
  // Buat/reset section player
  let sec = extra.querySelector('.kk-player-section');
  if (!sec) { sec = document.createElement('div'); sec.className = 'kk-player-section'; extra.appendChild(sec); }
  sec.style.display = 'block';
  sec.innerHTML =
    '<div class="kk-player-title">EPISODE ' + esc(String(epNum)) + '</div>' +
    '<div class="kk-player-wrap" id="kk-pwrap">' +
      '<div class="kk-player-loading" id="kk-pload"><div class="spinner"></div><span>Mengambil sumber video...</span></div>' +
    '</div>' +
    '<div class="kk-ctrl-bar" id="kk-srcbar" style="display:none"></div>' +
    '<div class="kk-ctrl-bar" id="kk-subbar" style="display:none"></div>';
  sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const pwrap  = sec.querySelector('#kk-pwrap');
  const pload  = sec.querySelector('#kk-pload');
  const srcBar = sec.querySelector('#kk-srcbar');
  const subBar = sec.querySelector('#kk-subbar');

  const epsId = ep.id || ep.sub_id || ep.number;

  // ── Ambil sources ─────────────────────────────────────────────────────
  let sources;
  try {
    sources = await _fetchSources(epsId, kkItem);
  } catch(e) {
    pload.style.display = 'none';
    pwrap.insertAdjacentHTML('afterbegin',
      '<div class="kk-player-error">⚠ Gagal mengambil sumber video.<br>' +
      '<small style="color:var(--muted)">' + esc(e.message||'') + '</small></div>');
    _appendOpenTab(sec, kkItem, epsId);
    return;
  }

  // Kumpulkan semua link yang valid
  const links = [];
  if (sources.video)      links.push({ label: 'KissKH',     url: sources.video,      kind: _detectType(sources.video) });
  if (sources.thirdParty) links.push({ label: 'ThirdParty', url: sources.thirdParty, kind: _detectType(sources.thirdParty) });

  if (!links.length) {
    pload.style.display = 'none';
    pwrap.insertAdjacentHTML('afterbegin', '<div class="kk-player-error">⚠ Tidak ada sumber video tersedia.</div>');
    _appendOpenTab(sec, kkItem, epsId);
    return;
  }

  // ── Ambil daftar subtitle ─────────────────────────────────────────────
  const subs = await _fetchSubs(epsId);

  pload.style.display = 'none';

  // State
  let vidEl       = null;
  let blobUrl     = null;
  let activeSrc   = 0;
  let activeSub   = -1; // -1 = off

  function _freeBlob() { if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; } }

  // ── Play sumber ke-idx ────────────────────────────────────────────────
  async function playLink(idx) {
    _freeBlob();
    activeSrc = idx;
    pwrap.innerHTML = '';
    srcBar.querySelectorAll('.kk-ctrl-btn').forEach((b, i) => b.classList.toggle('active', i === idx));

    const lnk = links[idx];

    if (lnk.kind === 'embed') {
      subBar.style.display = 'none';
      const iframe = document.createElement('iframe');
      iframe.allowFullscreen = true;
      iframe.allow = 'autoplay; fullscreen';
      iframe.src = lnk.url;
      pwrap.appendChild(iframe);
      return;
    }

    // <video> untuk mp4/m3u8
    vidEl = document.createElement('video');
    vidEl.controls = true;
    vidEl.style.cssText = 'width:100%;height:100%;background:#000;';
    vidEl.crossOrigin = 'anonymous';

    if (lnk.kind === 'mp4') {
      vidEl.src = lnk.url;
    } else {
      // m3u8 — native Safari atau hls.js
      if (vidEl.canPlayType('application/vnd.apple.mpegurl')) {
        vidEl.src = lnk.url;
      } else {
        await _loadHlsJs();
        if (window.Hls && window.Hls.isSupported()) {
          const hls = new window.Hls({ enableWorker: false });
          hls.loadSource(lnk.url);
          hls.attachMedia(vidEl);
        } else {
          vidEl.src = lnk.url;
        }
      }
    }

    pwrap.appendChild(vidEl);
    vidEl.play().catch(() => {});

    // Terapkan subtitle aktif
    if (activeSub >= 0 && subs[activeSub]) await _applySub(vidEl, subs[activeSub]);
    subBar.style.display = subs.length ? 'flex' : 'none';
  }

  // ── Apply subtitle ke <video> ─────────────────────────────────────────
  async function _applySub(video, sub) {
    // Hapus track lama
    Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
    _freeBlob();

    const raw = await _fetchSubContent(sub.src);
    if (!raw) return;

    // Konversi SRT/TXT → VTT
    let vtt = raw;
    if (!raw.startsWith('WEBVTT')) {
      vtt = 'WEBVTT\n\n' + raw.replace(/\r\n/g, '\n').replace(/(\d+:\d+:\d+),(\d+)/g, '$1.$2');
    }

    const blob = new Blob([vtt], { type: 'text/vtt' });
    blobUrl    = URL.createObjectURL(blob);

    const track = document.createElement('track');
    track.kind    = 'subtitles';
    track.label   = sub.label;
    track.srclang = _subLang(sub.label);
    track.src     = blobUrl;
    track.default = true;
    video.appendChild(track);

    // Force mode showing
    try {
      const tt = video.textTracks[video.textTracks.length - 1];
      if (tt) tt.mode = 'showing';
    } catch {}
  }

  // ── Render source bar ─────────────────────────────────────────────────
  if (links.length > 1) {
    srcBar.style.display = 'flex';
    srcBar.innerHTML = '<span class="kk-ctrl-label">SUMBER:</span>';
    links.forEach((l, i) => {
      const btn = document.createElement('button');
      btn.className = 'kk-ctrl-btn' + (i === 0 ? ' active' : '');
      btn.textContent = l.label;
      btn.addEventListener('click', () => playLink(i));
      srcBar.appendChild(btn);
    });
  }
  _appendOpenTab(srcBar, kkItem, epsId);

  // ── Render subtitle bar ───────────────────────────────────────────────
  if (subs.length) {
    subBar.style.display = 'flex';
    subBar.innerHTML = '<span class="kk-ctrl-label">SUB:</span>';

    const offBtn = document.createElement('button');
    offBtn.className = 'kk-ctrl-btn active';
    offBtn.textContent = 'Off';
    offBtn.addEventListener('click', () => {
      activeSub = -1;
      subBar.querySelectorAll('.kk-ctrl-btn').forEach(b => b.classList.remove('active','sub-active'));
      offBtn.classList.add('active');
      if (vidEl) {
        Array.from(vidEl.querySelectorAll('track')).forEach(t => t.remove());
        _freeBlob();
        Array.from(vidEl.textTracks).forEach(t => { t.mode = 'disabled'; });
      }
    });
    subBar.appendChild(offBtn);

    subs.forEach((sub, i) => {
      const btn = document.createElement('button');
      btn.className = 'kk-ctrl-btn';
      btn.textContent = sub.label;
      btn.addEventListener('click', async () => {
        activeSub = i;
        subBar.querySelectorAll('.kk-ctrl-btn').forEach(b => b.classList.remove('active','sub-active'));
        btn.classList.add('sub-active');
        if (vidEl) await _applySub(vidEl, sub);
      });
      subBar.appendChild(btn);
    });
  }

  // ── Mulai play ────────────────────────────────────────────────────────
  await playLink(0);
}

function _appendOpenTab(container, kkItem, epsId) {
  const a = document.createElement('a');
  a.href = kkPageUrl(kkItem, epsId);
  a.target = '_blank';
  a.className = 'kk-opentab';
  a.textContent = '↗ Buka di KissKH';
  container.appendChild(a);
}

// ── Render episode grid ───────────────────────────────────────────────────
async function loadEpisodes(kkItem, extra) {
  const eps = await _loadEpList(kkItem);

  if (!eps || !eps.length) {
    extra.insertAdjacentHTML('beforeend',
      '<div style="padding:16px 24px;font-size:13px;color:var(--muted)">Tidak ada episode.</div>');
    return;
  }

  const oldEp = extra.querySelector('.kk-ep-section');
  if (oldEp) oldEp.remove();
  const oldPl = extra.querySelector('.kk-player-section');
  if (oldPl) oldPl.remove();

  const sec = document.createElement('div');
  sec.className = 'episodes-section kk-ep-section';
  sec.innerHTML =
    '<div class="episodes-title">EPISODE <span style="color:var(--accent)">(' + eps.length + ')</span></div>' +
    '<div class="episode-grid" id="kk-grid-' + kkItem.id + '"></div>';
  extra.appendChild(sec);

  const grid = sec.querySelector('#kk-grid-' + kkItem.id);
  eps.forEach((ep, i) => {
    const n   = ep.number || ep.sub_number || (i + 1);
    const btn = document.createElement('button');
    btn.className = 'ep-btn kk-ep';
    btn.textContent = 'Ep ' + n;
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.kk-ep').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _renderPlayer(ep, n, kkItem, extra);
    });
    grid.appendChild(btn);
  });
}

// ── Season / judul picker ─────────────────────────────────────────────────
function showSeasonPicker(kkList, extra, onSelect) {
  const old = extra.querySelector('.kk-season-picker');
  if (old) old.remove();

  const wrap = document.createElement('div');
  wrap.className = 'episodes-section kk-season-picker';
  wrap.innerHTML =
    '<div class="episodes-title">PILIH SEASON / JUDUL</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;padding-bottom:8px">' +
    kkList.map((kk, i) =>
      '<button class="action-btn secondary season-pick-btn" data-idx="' + i + '" ' +
        'style="flex:initial;min-width:auto;font-size:12px;padding:7px 16px">' +
        esc(kk.title || ('Bagian ' + (i+1))) +
      '</button>'
    ).join('') + '</div>';
  extra.insertBefore(wrap, extra.firstChild);

  wrap.querySelectorAll('.season-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.season-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(kkList[parseInt(btn.dataset.idx)]);
    });
  });

  // Auto-pilih pertama
  const first = wrap.querySelector('.season-pick-btn');
  if (first) { first.classList.add('active'); onSelect(kkList[0]); }
}

// ── Handler: buka tab KissKH ──────────────────────────────────────────────
async function handleKKOpen(tmdbId, type, title, year) {
  let list = _kkCache.get(tmdbId)?.list;
  if (!list) {
    API.toast('Mencari di KissKH...');
    list = (await searchKissKH(title, year, type)) || null;
    _kkCache.set(tmdbId, { title, list });
  }
  if (!list || !list.length) { API.toast('Tidak tersedia di KissKH', 'error'); return; }
  window.open(kkPageUrl(list[0]), '_blank');
}

// ── Handler: tonton langsung ──────────────────────────────────────────────
async function handleKKWatch(tmdbId, type, title, year, item, extra) {
  const statusEl = document.getElementById('plugin-status');
  if (statusEl) statusEl.textContent = '⏳ Mencari di KissKH...';

  let list = _kkCache.get(tmdbId)?.list;
  if (list === undefined) {
    try {
      const r = await searchKissKH(title, year, type);
      list = r.length ? r : null;
      _kkCache.set(tmdbId, { title, list });
    } catch { list = null; }
  }

  if (!list || !list.length) {
    if (statusEl) statusEl.textContent = '✗ Tidak tersedia di KissKH.';
    API.toast('Tidak tersedia di KissKH', 'error');
    return;
  }

  if (statusEl) statusEl.textContent = '✓ Ditemukan. Memuat episode...';

  if (list.length === 1) {
    await loadEpisodes(list[0], extra);
  } else {
    showSeasonPicker(list, extra, async kk => {
      if (statusEl) statusEl.textContent = '✓ Memuat episode...';
      await loadEpisodes(kk, extra);
    });
  }
}

// ── Registrasi ke PluginAPI ───────────────────────────────────────────────
API.registerBadge({
  pluginId:   PLUGIN_ID,
  id:         'kk',
  label:      'KissKH',
  foundColor: '#059669cc',
  checkFn:    checkKissKH
});

API.registerAction({
  pluginId:      PLUGIN_ID,
  id:            'kk-open',
  label:         '↗ KissKH',
  cssClass:      'secondary',
  scope:         'both',
  respectStatus: true,
  onCard:   (tmdbId, type, title, year) => handleKKOpen(tmdbId, type, title, year),
  onDetail: (tmdbId, type, title, year) => handleKKOpen(tmdbId, type, title, year)
});

API.registerAction({
  pluginId:      PLUGIN_ID,
  id:            'kk-watch',
  label:         '▶ Tonton (KissKH)',
  cssClass:      'kk',
  scope:         'detail',
  respectStatus: true,
  onDetail: (tmdbId, type, title, year, item, extra) => handleKKWatch(tmdbId, type, title, year, item, extra)
});

API.dbg.log('[KissKH Plugin] v2.0.0 terdaftar', 'success');

})();
