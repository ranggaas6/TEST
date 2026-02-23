// ==UserScript==
// @name         HiTV Plugin
// @namespace    https://home.hitv.vip/
// @version      1.0.0
// @description  Plugin HiTV untuk Drama Explorer — search, badge, buka di HiTV
// @author       UserScript
// ==/UserScript==

(function () {
'use strict';

// ── Tunggu PluginAPI siap ─────────────────────────────────────────────────
if (typeof window._pluginAPI === 'undefined') {
  console.warn('[HiTV Plugin] window._pluginAPI tidak tersedia.');
  return;
}

const API       = window._pluginAPI;
const PLUGIN_ID = 'hitv';

// ── Injeksi CSS khas HiTV ─────────────────────────────────────────────────
(function injectCSS() {
  const style = document.createElement('style');
  style.textContent = `
    /* HiTV overlay button */
    .overlay-btn.hitv-btn { background: #7c3aed; }
    .overlay-btn.hitv-btn:hover { background: #6d28d9; }
    /* HiTV action button di detail */
    .action-btn.hitv { background: #7c3aed; }
    .action-btn.hitv:hover { background: #6d28d9; }
    /* HiTV detail badge */
    .detail-badge.hitv { border-color: #7c3aed; color: #a78bfa; }
    /* HiTV episode btn */
    .ep-btn.hitv-ep:hover, .ep-btn.hitv-ep.active { border-color: #7c3aed; color: #a78bfa; }
    .ep-btn.hitv-ep.active { background: #7c3aed22; }
  `;
  document.head.appendChild(style);
})();

// ── Constants ─────────────────────────────────────────────────────────────
const HITV_BASE   = 'https://home.hitv.vip';
const HITV_SEARCH = HITV_BASE + '/s1/w/search/api/aggregate/search';
const HITV_SALT   = 'V2NiMjZhcldrdmtjQVpjMzc4ZVI='; // base64("Wcb26arWkvkcAZc378eR")

// ── Cache per-session ─────────────────────────────────────────────────────
const _hitvCache = new Map(); // tmdbId → results[] | null

// ── Helpers ───────────────────────────────────────────────────────────────
function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}
function matchScore(normBase, normItem) {
  if (!normBase || !normItem) return 0;
  if (normItem === normBase) return 100;
  const bw = normBase.split(' '), iw = normItem.split(' ');
  if (iw.length < bw.length) return 0;
  for (let i = 0; i < bw.length; i++) if (iw[i] !== bw[i]) return 0;
  const suf = iw.slice(bw.length);
  if (!suf.length) return 90;
  if (suf.length === 1 && /^\d+$/.test(suf[0])) return 80;
  if (suf.length === 2 && suf[0] === 'season' && /^\d+$/.test(suf[1])) return 80;
  if (bw.length >= 4) return 50;
  return 0;
}

function hitvGetDid() {
  if (window.__HITV_DID__) return window.__HITV_DID__;
  let did = localStorage.getItem('hitv_did');
  if (!did) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    did = Array.from({length: 24}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    localStorage.setItem('hitv_did', did);
  }
  return did;
}

function hitvDecrypt(ts, did, encryptedData) {
  if (!encryptedData || typeof CryptoJS === 'undefined') return null;
  try {
    const salt     = atob(HITV_SALT);
    const inner    = CryptoJS.MD5(did + ts).toString();
    const hash     = CryptoJS.MD5(inner + salt).toString();
    const key      = CryptoJS.enc.Utf8.parse(hash.slice(0, 16));
    const iv       = CryptoJS.enc.Utf8.parse(hash.slice(16));
    const decoded  = CryptoJS.enc.Base64.parse(encryptedData);
    const b64str   = CryptoJS.enc.Base64.stringify(decoded);
    const decrypted = CryptoJS.AES.decrypt(b64str, key, {
      iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7
    });
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    return result ? JSON.parse(result) : null;
  } catch(e) {
    API.dbg.log('[HiTV] Decrypt error: ' + e.message, 'error');
    return null;
  }
}

async function hitvFetch(url, params) {
  const did = hitvGetDid();
  let proxyRes;
  try {
    proxyRes = await API.launcherFetch(url, params);
  } catch(e) {
    throw new Error('HiTV proxy: ' + e.message);
  }
  const { body: bodyText, hitvDid: serverDid } = proxyRes;
  const decryptDid = serverDid || did;
  let raw;
  try { raw = JSON.parse(bodyText); } catch { throw new Error('HiTV parse error'); }
  API.dbg.log('[HiTV] raw: rescode=' + raw.rescode + ' hasData=' + !!raw.data + ' ts=' + raw.ts, 'info');
  if (raw.rescode !== 0) throw new Error('HiTV rescode ' + raw.rescode);
  if (raw.data && typeof raw.data === 'string' && raw.ts) {
    const decrypted = hitvDecrypt(raw.ts, decryptDid, raw.data);
    API.dbg.log('[HiTV] decrypt: ' + (decrypted ? JSON.stringify(decrypted).substring(0, 100) : 'null'), decrypted ? 'success' : 'error');
    return decrypted;
  }
  return raw.data || raw;
}

function hitvUrl(item) {
  const alias = item.sidAlias || item.alias || '';
  if (alias) return HITV_BASE + '/series/' + alias + '?frm=search';
  const sid = item.sid || item.id || item.contentId || '';
  return HITV_BASE + '/series/' + sid + '?frm=search';
}

// ── Search HiTV ───────────────────────────────────────────────────────────
async function searchHiTV(title) {
  if (!title || !normalizeTitle(title)) return [];
  try {
    API.dbg.log('[HiTV] search: "' + title + '"', 'info');
    const data = await hitvFetch(HITV_SEARCH, { keyword: title, scope: 101, page: 1 });
    if (!data) return [];
    const list = Array.isArray(data) ? data :
                 (data.seriesData && data.seriesData.seriesList) ||
                 (data.list || data.result || data.items || data.data || []);
    if (!list.length) {
      API.dbg.log('[HiTV] tidak ada hasil untuk "' + title + '"', 'warn');
      return [];
    }
    API.dbg.log('[HiTV] ' + list.length + ' hasil untuk "' + title + '"', 'success');
    return list;
  } catch(e) {
    API.dbg.log('[HiTV] search error: ' + e.message, 'error');
    return [];
  }
}

// ── Badge check ───────────────────────────────────────────────────────────
async function checkHiTV(tmdbId, type, title, year, item, isUpcoming) {
  if (_hitvCache.has(tmdbId)) {
    const cached = _hitvCache.get(tmdbId);
    if (API.cache) API.cache[PLUGIN_ID + '_' + tmdbId] = cached ? cached : false;
    return cached ? cached : false;
  }

  let searchTitle = title;
  if (!normalizeTitle(title)) {
    try {
      const tmdb = API.getTmdb();
      const r = await fetch(tmdb.base + '/' + (type||'tv') + '/' + tmdbId + '?api_key=' + tmdb.apiKey + '&language=en-US');
      if (r.ok) { const d = await r.json(); searchTitle = d.name || d.title || title; }
    } catch {}
  }

  const results = await searchHiTV(searchTitle);
  const normBase = normalizeTitle(searchTitle);
  const matched  = results.filter(i => matchScore(normBase, normalizeTitle(i.name || i.title || '')) > 0);
  matched.sort((a, b) => {
    const na = normalizeTitle(a.name || a.title || '');
    const nb = normalizeTitle(b.name || b.title || '');
    return matchScore(normBase, nb) - matchScore(normBase, na);
  });
  API.dbg.log('[HiTV] match: ' + matched.length + '/' + results.length + ' untuk "' + searchTitle + '"', matched.length ? 'success' : 'warn');

  const val = matched.length ? matched : null;
  _hitvCache.set(tmdbId, val);
  if (API.cache) API.cache[PLUGIN_ID + '_' + tmdbId] = val ? val : false;
  return val ? val : false;
}

// ── Handler tombol ────────────────────────────────────────────────────────
async function handleHitvOpen(tmdbId, type, title, year) {
  let cached = _hitvCache.get(tmdbId);
  if (cached === undefined) {
    API.toast('Mencari di HiTV...');
    try {
      const results  = await searchHiTV(title);
      const normBase = normalizeTitle(title);
      const matched  = results.filter(i => matchScore(normBase, normalizeTitle(i.name || i.title || '')) > 0);
      cached = matched.length ? matched : null;
      _hitvCache.set(tmdbId, cached);
    } catch { cached = null; }
  }
  if (!cached || !cached.length) { API.toast('Tidak tersedia di HiTV', 'error'); return; }
  window.open(hitvUrl(cached[0]), '_blank');
}

// ── Registrasi ke PluginAPI ───────────────────────────────────────────────
API.registerBadge({
  pluginId:   PLUGIN_ID,
  id:         'hitv',
  label:      'HiTV',
  foundColor: '#7c3aedcc',
  checkFn:    checkHiTV
});

API.registerAction({
  pluginId:      PLUGIN_ID,
  id:            'hitv-open',
  label:         '\u2197 HiTV',
  cssClass:      'hitv-btn hitv',
  scope:         'both',
  respectStatus: true,
  onCard:        (tmdbId, type, title, year) => handleHitvOpen(tmdbId, type, title, year),
  onDetail:      (tmdbId, type, title, year, item, extra) => {
    const statusEl = document.getElementById('plugin-status');
    if (statusEl) statusEl.textContent = '\u23f3 Mencari di HiTV...';
    handleHitvOpen(tmdbId, type, title, year).then(() => {
      if (statusEl) statusEl.textContent = '';
    }).catch(() => {
      if (statusEl) statusEl.textContent = '\u2717 Gagal menghubungi HiTV.';
    });
  }
});

API.dbg.log('[HiTV Plugin] v1.0.0 terdaftar', 'success');

})();
