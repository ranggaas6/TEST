// ==UserScript==
// @name         KissKH Plugin
// @namespace    https://kisskh.co/
// @version      1.0.0
// @description  Plugin KissKH untuk Drama Explorer — search, badge, episode player
// @author       UserScript
// ==/UserScript==

(function () {
'use strict';

// ── Tunggu PluginAPI siap ─────────────────────────────────────────────────
if (typeof window._pluginAPI === 'undefined') {
  console.warn('[KissKH Plugin] window._pluginAPI tidak tersedia.');
  return;
}

const API    = window._pluginAPI;
const PLUGIN_ID = 'kisskh';

// ── Injeksi CSS khas KissKH ───────────────────────────────────────────────
(function injectCSS() {
  const style = document.createElement('style');
  style.textContent = `
    /* KissKH badge: warna hijau */
    #pb-kk-found { background: #059669cc !important; }
    /* KissKH overlay button */
    .overlay-btn.kk-btn { background: #e94560; }
    .overlay-btn.kk-btn:hover { background: #ff5070; }
    /* KissKH action button di detail */
    .action-btn.kk { background: #e94560; }
    .action-btn.kk:hover { background: #ff5070; }
    /* Episode btn — warna KissKH */
    .ep-btn.kk-ep:hover, .ep-btn.kk-ep.active { border-color: #e94560; color: #e94560; }
    .ep-btn.kk-ep.active { background: #e9456022; }
    /* Detail badge KissKH */
    .detail-badge.kk { border-color: #e94560; color: #f87171; }
  `;
  document.head.appendChild(style);
})();

// ── Constants ─────────────────────────────────────────────────────────────
const KK_SEARCH = 'https://kisskh.co/api/DramaList/Search?q=';
const KK_EP     = 'https://kisskh.co/api/DramaList/Drama/';

// ── Cache per-session ─────────────────────────────────────────────────────
const _kkCache  = new Map(); // tmdbId → { title, list: [] | null }
const _kkEpCache = new Map(); // kkId   → episodes[]

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

function kkUrl(kk, epId) {
  const slug = (kk.title || '')
    .replace(/\([^)]*\)/g, '').trim()
    .replace(/[^a-zA-Z0-9\s-]/g, '').trim()
    .replace(/\s+/g, '-');
  const base = 'https://kisskh.co/Drama/' + encodeURIComponent(slug) + '?id=' + kk.id;
  return epId ? base + '&ep=' + epId : base;
}

// ── Search KissKH ─────────────────────────────────────────────────────────
async function searchKissKH(title, tmdbYear, tmdbType) {
  const results = [];
  const seen    = new Set();
  const normBase = normalizeTitle(title);
  if (!normBase) return results;

  function addIfMatch(item) {
    if (seen.has(item.id)) return;
    const normItem = normalizeTitle(item.title || '');
    if (!normItem) return;
    if (matchScore(normBase, normItem) === 0) return;
    if (tmdbYear) {
      const yearMatch = (item.title || '').match(/\((\d{4})\)/);
      if (yearMatch) {
        const kkYear = parseInt(yearMatch[1]);
        const ty     = parseInt(tmdbYear);
        if (Math.abs(kkYear - ty) > 1) return;
      }
    }
    seen.add(item.id);
    results.push(item);
  }

  try {
    const { body } = await API.launcherFetch(KK_SEARCH + encodeURIComponent(title) + '&type=0');
    const d = JSON.parse(body);
    if (Array.isArray(d)) d.forEach(addIfMatch);
  } catch(e) {}

  results.sort((a, b) => {
    const na = normalizeTitle(a.title || '');
    const nb = normalizeTitle(b.title || '');
    const sa = matchScore(normBase, na);
    const sb = matchScore(normBase, nb);
    if (sb !== sa) return sb - sa;
    return na.length - nb.length;
  });

  if (!results.length) return results;

  // Verifikasi type (tv vs movie)
  if (tmdbType) {
    const verified = [];
    await Promise.all(results.map(async item => {
      try {
        const { body: b2 } = await API.launcherFetch(KK_EP + item.id + '?id=' + item.id);
        const detail = JSON.parse(b2);
        const kkIsMovie  = detail.type === 'Movie';
        const kkIsSeries = detail.type === 'TVSeries';
        if (tmdbType === 'movie' && kkIsSeries) return;
        if (tmdbType === 'tv'    && kkIsMovie)  return;
        item._detail = detail;
        verified.push(item);
      } catch { verified.push(item); }
    }));
    return verified;
  }
  return results;
}

// ── Badge check ───────────────────────────────────────────────────────────
async function checkKissKH(tmdbId, type, title, year, item, isUpcoming) {
  // Ambil dari cache dulu
  if (_kkCache.has(tmdbId)) {
    const cached = _kkCache.get(tmdbId).list;
    // simpan ke shared plugin cache untuk detail panel
    if (API.cache) API.cache[PLUGIN_ID + '_' + tmdbId] = cached ? cached : false;
    return cached ? cached : false;
  }

  let searchTitle = title;
  // Jika judul non-latin, ambil en-US dari TMDB
  if (!normalizeTitle(title)) {
    try {
      const tmdb = API.getTmdb();
      const r = await fetch(tmdb.base + '/' + (type||'tv') + '/' + tmdbId + '?api_key=' + tmdb.apiKey + '&language=en-US');
      if (r.ok) { const d = await r.json(); searchTitle = d.name || d.title || title; }
    } catch {}
  }

  const list = await searchKissKH(searchTitle, year, type);
  const val  = list.length ? list : null;
  _kkCache.set(tmdbId, { title: searchTitle, list: val });
  if (API.cache) API.cache[PLUGIN_ID + '_' + tmdbId] = val ? val : false;
  return val ? val : false;
}

// ── Episode player ────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function showSeasonPicker(kkList, extra, onSelect) {
  const wrap = document.createElement('div');
  wrap.className = 'episodes-section';
  wrap.innerHTML =
    '<div class="episodes-title">PILIH SEASON</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;padding-bottom:8px">' +
    kkList.map((kk, i) =>
      '<button class="action-btn secondary season-pick-btn" data-idx="' + i + '" style="flex:initial;min-width:auto;font-size:12px;padding:7px 16px">' +
        esc(kk.title || ('Season ' + (i+1))) +
      '</button>'
    ).join('') +
    '</div>';
  // Hapus season picker lama jika ada
  const old = extra.querySelector('.kk-season-picker');
  if (old) old.remove();
  wrap.classList.add('kk-season-picker');
  extra.insertBefore(wrap, extra.firstChild);
  wrap.querySelectorAll('.season-pick-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.season-pick-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(kkList[parseInt(btn.dataset.idx)]);
    });
  });
}

async function loadEpisodes(kk, extra) {
  let eps = _kkEpCache.get(kk.id);
  if (!eps) {
    try {
      const { body } = await API.launcherFetch(KK_EP + kk.id + '?id=' + kk.id);
      const d = JSON.parse(body);
      eps = d.sub || d.episodes || [];
      _kkEpCache.set(kk.id, eps);
    } catch {
      extra.innerHTML += '<div style="padding:16px 24px;font-size:13px;color:var(--muted)">\u26a0 Gagal memuat episode.</div>';
      return;
    }
  }
  if (!eps || !eps.length) {
    extra.innerHTML += '<div style="padding:16px 24px;font-size:13px;color:var(--muted)">Tidak ada episode.</div>';
    return;
  }

  // Hapus episode grid lama jika ada
  const oldEp = extra.querySelector('.kk-ep-section');
  if (oldEp) oldEp.remove();

  const section = document.createElement('div');
  section.className = 'episodes-section kk-ep-section';
  section.innerHTML =
    '<div class="episodes-title">EPISODE <span style="color:var(--accent)">(' + eps.length + ')</span></div>' +
    '<div class="episode-grid" id="kk-ep-grid-' + kk.id + '"></div>';
  extra.appendChild(section);

  // Player section
  let playerSec = extra.querySelector('.kk-player-section');
  if (!playerSec) {
    playerSec = document.createElement('div');
    playerSec.className = 'player-section kk-player-section';
    playerSec.style.display = 'none';
    playerSec.innerHTML =
      '<div class="player-title" id="kk-player-ep-title">EPISODE</div>' +
      '<div class="player-wrap">' +
        '<div class="player-loading" id="kk-player-load"><div class="spinner on"></div><span>Memuat video...</span></div>' +
        '<iframe id="kk-player-frame" allowfullscreen allow="autoplay; fullscreen" style="opacity:0;transition:opacity .3s"></iframe>' +
      '</div>';
    extra.appendChild(playerSec);
  }

  const grid = extra.querySelector('#kk-ep-grid-' + kk.id);
  eps.forEach((ep, i) => {
    const n   = ep.number || ep.sub_number || (i + 1);
    const btn = document.createElement('button');
    btn.className = 'ep-btn kk-ep';
    btn.textContent = 'Ep ' + n;
    btn.addEventListener('click', () => loadPlayer(ep, n, kk, btn, extra));
    grid.appendChild(btn);
  });
}

function loadPlayer(ep, epNum, kk, clickedBtn, extra) {
  const playerSec = extra.querySelector('.kk-player-section');
  const playerLoad = extra.querySelector('#kk-player-load');
  const iframe    = extra.querySelector('#kk-player-frame');
  if (!playerSec || !iframe) return;

  playerSec.style.display = 'block';
  extra.querySelector('#kk-player-ep-title').textContent = 'EPISODE ' + epNum;
  playerLoad.style.display = 'flex';
  iframe.style.opacity = '0';
  playerSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  extra.querySelectorAll('.kk-ep').forEach(b => b.classList.remove('active'));
  clickedBtn.classList.add('active');

  const epId = ep.id || ep.sub_id || ep.number;
  iframe.src = kkUrl(kk, epId);
  iframe.onload = () => { playerLoad.style.display = 'none'; iframe.style.opacity = '1'; };
}

// ── Handler tombol di detail ──────────────────────────────────────────────
async function handleKKOpen(tmdbId, type, title, year) {
  const cached = _kkCache.get(tmdbId);
  let list = cached ? cached.list : undefined;

  if (!list) {
    API.toast('Mencari di KissKH...');
    list = (await searchKissKH(title, year, type)) || null;
    _kkCache.set(tmdbId, { title, list });
  }
  if (!list || !list.length) { API.toast('Tidak tersedia di KissKH', 'error'); return; }
  window.open(kkUrl(list[0]), '_blank');
}

async function handleKKWatch(tmdbId, type, title, year, item, extra) {
  const statusEl = document.getElementById('plugin-status');
  if (statusEl) statusEl.textContent = '\u23f3 Mencari di KissKH...';

  let cached = _kkCache.get(tmdbId);
  let list   = cached ? cached.list : undefined;

  if (list === undefined) {
    try {
      const results = await searchKissKH(title, year, type);
      list = results.length ? results : null;
      _kkCache.set(tmdbId, { title, list });
    } catch { list = null; }
  }

  if (!list || !list.length) {
    if (statusEl) statusEl.textContent = '\u2717 Tidak tersedia di KissKH.';
    return;
  }

  if (statusEl) statusEl.textContent = '\u2713 Memuat episode...';

  if (list.length === 1) {
    await loadEpisodes(list[0], extra);
  } else {
    showSeasonPicker(list, extra, async (kk) => {
      if (statusEl) statusEl.textContent = '\u2713 Memuat episode...';
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
  label:         '\u2197 KissKH',
  cssClass:      'secondary kk-btn',
  scope:         'both',
  respectStatus: true,
  onCard:        (tmdbId, type, title, year) => handleKKOpen(tmdbId, type, title, year),
  onDetail:      (tmdbId, type, title, year, item, extra) => handleKKOpen(tmdbId, type, title, year)
});

API.registerAction({
  pluginId:      PLUGIN_ID,
  id:            'kk-watch',
  label:         '\u25b6 Tonton (KissKH)',
  cssClass:      'kk',
  scope:         'detail',
  respectStatus: true,
  onDetail:      (tmdbId, type, title, year, item, extra) => handleKKWatch(tmdbId, type, title, year, item, extra)
});

API.dbg.log('[KissKH Plugin] v1.0.0 terdaftar', 'success');

})();
