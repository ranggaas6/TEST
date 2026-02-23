// ==UserScript==
// @name         KissKH & HiTV Explorer (Core)
// @namespace    https://kisskh.co/
// @version      10.0.0
// @description  Explorer drama Asia berbasis TMDB. KissKH, HiTV, Cinestream dimuat via plugin.
// @author       UserScript
// @match        https://kisskh.co/*
// @match        https://kisskh.la/*
// @match        https://home.hitv.vip/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    GM_registerMenuCommand('\u{1F3AC} Buka Explorer', openExplorer);
    GM_registerMenuCommand('\u{1F511} Ganti TMDB API Key', changeApiKey);
    GM_registerMenuCommand('\u{1F9E9} Plugin Manager', openPluginManagerFromMenu);

    GM_addStyle(
        '#kh-explorer-btn{' +
        'position:fixed!important;bottom:28px!important;right:28px!important;' +
        'z-index:2147483647!important;' +
        'background:linear-gradient(135deg,#e94560,#f4a261)!important;' +
        'border:none!important;border-radius:50px!important;color:#fff!important;' +
        'font-size:14px!important;font-weight:bold!important;font-family:Arial,sans-serif!important;' +
        'letter-spacing:1px!important;padding:12px 22px!important;cursor:pointer!important;' +
        'box-shadow:0 4px 20px rgba(233,69,96,0.6)!important;' +
        'transition:transform .2s!important;white-space:nowrap!important;' +
        'display:block!important;visibility:visible!important;opacity:1!important;}' +
        '#kh-explorer-btn:hover{transform:scale(1.06)!important;}' +
        '#kh-explorer-btn:active{transform:scale(.95)!important;}'
    );

    function ensureBtn() {
        if (document.getElementById('kh-explorer-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'kh-explorer-btn';
        btn.textContent = '\ud83c\udfac EXPLORER';
        btn.title = 'Buka Explorer (Alt+E)';
        btn.addEventListener('click', openExplorer);
        (document.body || document.documentElement).appendChild(btn);
    }

    function attachObserver() {
        if (!document.body) return;
        new MutationObserver(() => {
            if (!document.getElementById('kh-explorer-btn')) ensureBtn();
        }).observe(document.body, { childList: true });
    }

    // ── HiTV Cookie capture (tetap di launcher — butuh GM_getValue/GM_setValue) ──
    function saveHitvCookie() {
        if (!location.hostname.includes('hitv.vip')) return;
        try {
            const c = document.cookie;
            if (!c) return;
            GM_setValue('hitv_cookie', c);
            GM_setValue('hitv_cookie_ts', Date.now().toString());
            const authMatch = c.match(/hitv_auth_info=([^;]+)/);
            if (authMatch) {
                try {
                    const auth = JSON.parse(decodeURIComponent(authMatch[1]));
                    if (auth.authToken) GM_setValue('hitv_auth_token', auth.authToken);
                } catch(e) {}
            }
            const userMatch = c.match(/hitv_user_info=([^;]+)/);
            if (userMatch) {
                try {
                    const user = JSON.parse(decodeURIComponent(userMatch[1]));
                    if (user.userId) GM_setValue('hitv_auth_uid', String(user.userId));
                } catch(e) {}
            }
            const didMatch = c.match(/hpwa_did=([^;]+)/);
            if (didMatch) GM_setValue('hitv_did_saved', didMatch[1].trim());
        } catch(e) {}
    }
    saveHitvCookie();
    setInterval(saveHitvCookie, 30000);

    setInterval(ensureBtn, 1000);
    document.addEventListener('DOMContentLoaded', () => { ensureBtn(); attachObserver(); });
    if (document.body) { ensureBtn(); attachObserver(); }

    document.addEventListener('keydown', e => {
        if (e.altKey && (e.key === 'e' || e.key === 'E')) { e.preventDefault(); openExplorer(); }
    });

    let _explorerWindow = null;

    // ── BroadcastChannel: terima pesan dari Explorer blob ──────────────────
    const _khLauncherChannel = new BroadcastChannel('kh_proxy');
    _khLauncherChannel.onmessage = function(ev) {
        if (!ev.data) return;
        const d = ev.data;
        if (d.type === 'explorer_ready') return;
        if (d.type === 'pm_req') {
            _handlePmReq(d, null);
            return;
        }
        if (d.type === 'proxy_req') {
            _handleProxyReq(d, null);
        }
    };

    // ── window.postMessage fallback (untuk GM_openInTab) ──────────────────
    window.addEventListener('message', function(e) {
        if (!e.data) return;
        if (e.data.type === 'explorer_ready') {
            _explorerWindow = e.source || _explorerWindow;
            return;
        }
        if (e.data.type === 'pm_req') {
            _handlePmReq(e.data, e.source || _explorerWindow);
            return;
        }
        if (e.data.type === 'open_plugin_manager') { return; }
        if (e.data.type !== 'proxy_req') return;
        _handleProxyReq(e.data, e.source || _explorerWindow);
    });

    function _handlePmReq(d, target) {
        const send = (msg) => {
            if (target) target.postMessage(msg, '*');
            _khLauncherChannel.postMessage(msg);
        };
        if (d.action === 'load_all') {
            const raw = GM_getValue('plugin_registry', '[]');
            send({ type: 'pm_res', action: 'load_all', data: raw });
        } else if (d.action === 'save_all') {
            GM_setValue('plugin_registry', d.data);
            send({ type: 'pm_res', action: 'save_all', ok: true });
        } else if (d.action === 'fetch_code') {
            GM_xmlhttpRequest({
                method: 'GET', url: d.url,
                onload: function(r) {
                    send({ type: 'pm_res', action: 'fetch_code', id: d.id, body: r.responseText, status: r.status });
                },
                onerror: function() {
                    send({ type: 'pm_res', action: 'fetch_code', id: d.id, error: 'network error' });
                }
            });
        }
    }

    function _handleProxyReq(d, target) {
        const { id, url, params, headers, method, body, bodyType } = d;
        const qs = params ? new URLSearchParams(params).toString() : '';
        const fullUrl = qs ? url + '?' + qs : url;
        const isHitv = url.includes('hitv.vip');
        const reqMethod = method || 'GET';

        const hitvCookieVal = isHitv ? (GM_getValue('hitv_cookie', '') || '') : '';
        const hitvAuthToken = isHitv ? (GM_getValue('hitv_auth_token', '') || '') : '';
        const hitvAuthUid  = isHitv ? (GM_getValue('hitv_auth_uid',  '') || '') : '';
        let hitvDid = isHitv ? GM_getValue('hitv_did_gm', '') : '';
        if (isHitv && !hitvDid) {
            hitvDid = Array.from({length:24},()=>'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*62)]).join('');
            GM_setValue('hitv_did_gm', hitvDid);
        }

        const reqHeaders = Object.assign({
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        }, isHitv ? {
            'Aid':'hitv.pc','Platform':'pc','Wt':'page','Lth':'en-US',
            'Cookie': hitvCookieVal, 'W-Auth-Token': hitvAuthToken,
            'W-Auth-Uid': hitvAuthUid, 'Did': hitvDid
        } : {}, headers || {});

        let reqData = undefined;
        if (body) {
            if (bodyType === 'json') {
                reqHeaders['Content-Type'] = 'application/json';
                reqData = typeof body === 'string' ? body : JSON.stringify(body);
            } else if (bodyType === 'form') {
                reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
                reqData = typeof body === 'string' ? body : new URLSearchParams(body).toString();
            } else { reqData = body; }
        }

        const sendTarget = target || _explorerWindow;
        if (sendTarget && !_explorerWindow) _explorerWindow = sendTarget;

        const send = (msg) => {
            if (sendTarget) sendTarget.postMessage(msg, '*');
            _khLauncherChannel.postMessage(msg);
        };

        GM_xmlhttpRequest({
            method: reqMethod, url: fullUrl, headers: reqHeaders, data: reqData, withCredentials: false,
            onload: function(r) {
                send({ type: 'proxy_res', id, body: r.responseText, status: r.status,
                       responseHeaders: r.responseHeaders, finalUrl: r.finalUrl,
                       hitvDid: isHitv ? hitvDid : undefined });
            },
            onerror: function() { send({ type: 'proxy_res', id, error: 'network error' }); },
            ontimeout: function() { send({ type: 'proxy_res', id, error: 'timeout' }); }
        });
    }

    function changeApiKey() {
        const cur = GM_getValue('tmdb_key', '');
        const k = prompt('TMDB API Key (dari themoviedb.org/settings/api):', cur);
        if (k === null) return;
        if (k.length > 10) { GM_setValue('tmdb_key', k); alert('\u2713 API Key disimpan!'); }
        else if (!k.length) alert('Key saat ini:\n' + (cur || '(belum diset)'));
        else alert('\u26a0 API Key tidak valid');
    }

    function openPluginManagerFromMenu() {
        if (_explorerWindow && !_explorerWindow.closed) {
            _explorerWindow.postMessage({ type: 'open_plugin_manager' }, '*');
        } else {
            alert('\u26a0 Buka Explorer terlebih dahulu, lalu gunakan tombol \u{1F9E9} Plugins di header.');
        }
    }

    window.addEventListener('load', () => setTimeout(ensureBtn, 400));
    if (document.readyState !== 'loading') setTimeout(ensureBtn, 400);

    // ════════════════════════════════════════════════════════════════════════
    // PM ENGINE — diinjeksikan ke blob Explorer sebagai string
    // ════════════════════════════════════════════════════════════════════════
    const _PM_ENGINE_CODE = `
// ── PLUGIN MANAGER ENGINE v10 ─────────────────────────────────────────────
// Registry: array of { id, name, version, method, url, code, status, loadedAt }
var _pmRegistry  = [];
var _pmLoaded    = {};
var _pmCallbacks = {};
var _pmLoading   = {};

// ── Plugin Registry untuk renderCards & openDetail ──────────────────────
// Plugin mendaftarkan diri lewat window._pluginAPI setelah dieksekusi
var _pluginBadges    = [];  // [{ pluginId, id, label, cssClass, checkFn }]
var _pluginActions   = [];  // [{ pluginId, id, label, cssClass, scope, showWhen, onCard, onDetail }]
var _pluginDetailSec = [];  // [{ pluginId, id, renderFn }]
var _pluginEpProviders = []; // [{ pluginId, id, label, color, fetchFn, playerUrlFn }]

// ── PluginAPI — interface untuk semua plugin ─────────────────────────────
window._pluginAPI = {
  version: '10.0.0',

  // Proxy fetch via launcher (bypass CORS)
  launcherFetch: launcherFetch,

  // Utilities
  esc: esc,
  escInner: escInner,
  normalizeTitle: normalizeTitle,
  matchScore: matchScore,
  toast: toast,
  setStatus: setStatus,
  dbg: _dbg,

  // TMDB data access
  getTmdb: function() { return { base: TMDB, imgW: IMG_W, imgL: IMG_L, apiKey: API_KEY }; },
  tmdbDetailCache: tmdbDetailCache,

  // Badge registry
  // def: { pluginId, id, label, cssClass, foundColor, missingColor, checkFn }
  // checkFn: async(tmdbId, type, title, year, item) => true | false | null
  registerBadge: function(def) {
    _pluginBadges.push(def);
    _dbg.log('[API] Badge registrasi: ' + def.id + ' (' + def.pluginId + ')', 'info');
  },

  // Action registry (tombol di card overlay dan/atau detail panel)
  // def: { pluginId, id, label, cssClass, scope('card'|'detail'|'both'),
  //        showWhen(tmdbId)=>bool, onCard(tmdbId,type,title,year), onDetail(tmdbId,type,title,year,item,extra) }
  registerAction: function(def) {
    _pluginActions.push(def);
    _dbg.log('[API] Action registrasi: ' + def.id + ' (' + def.pluginId + ')', 'info');
  },

  // Detail section — konten tambahan di detail panel (setelah tombol)
  // def: { pluginId, id, renderFn(item, type, extra) => HTMLElement }
  registerDetailSection: function(def) {
    _pluginDetailSec.push(def);
  },

  // Episode provider — provider episode list + player URL (untuk KissKH dll)
  // def: { pluginId, id, label, color, fetchFn async(item,type)=>episodes[], playerUrlFn(ep,provider)=>url }
  registerEpisodeProvider: function(def) {
    _pluginEpProviders.push(def);
    _dbg.log('[API] EpProvider registrasi: ' + def.id + ' (' + def.pluginId + ')', 'info');
  },

  // Shared plugin cache namespace
  cache: {}
};

// ── Normalizer & matcher (shared — dipakai plugin via API) ───────────────
function normalizeTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9\\s]/g, '').replace(/\\s+/g, ' ').trim();
}
function matchScore(normBase, normItem) {
  if (!normBase || !normItem) return 0;
  if (normItem === normBase) return 100;
  const baseWords = normBase.split(' ');
  const itemWords = normItem.split(' ');
  if (itemWords.length < baseWords.length) return 0;
  for (let i = 0; i < baseWords.length; i++) {
    if (itemWords[i] !== baseWords[i]) return 0;
  }
  const suffix = itemWords.slice(baseWords.length);
  if (suffix.length === 0) return 90;
  if (suffix.length === 1 && /^\\d+$/.test(suffix[0])) return 80;
  if (suffix.length === 2 && suffix[0] === 'season' && /^\\d+$/.test(suffix[1])) return 80;
  if (baseWords.length >= 4) return 50;
  return 0;
}

// ── PM: Eksekusi kode plugin ─────────────────────────────────────────────
function _pmExecCode(code, plugin) {
  try {
    var body = code.replace(/^\\/\\/ ==UserScript==[\\s\\S]*?==\\/UserScript==/m, '').trim();
    body = body.replace(/^\\(function\\s*\\(\\)\\s*\\{\\s*['"\\\`]use strict['"\\\`];?\\s*/m, '');
    body = body.replace(/\\s*\\}\\s*\\)\\s*\\(\\s*\\)\\s*;?\\s*$/, '');
    var fn = new Function(body);
    fn.call(window);
    var nameM = code.match(/\\/\\/ @name\\s+(.+)/);
    var verM  = code.match(/\\/\\/ @version\\s+(.+)/);
    if (nameM) plugin.name    = nameM[1].trim();
    if (verM)  plugin.version = verM[1].trim();
    plugin.status   = 'ok';
    plugin.loadedAt = new Date().toISOString();
    _pmLoaded[plugin.id] = true;
    _dbg.log('[PM] Plugin "' + plugin.name + '" v' + (plugin.version||'?') + ' dimuat', 'success');
    _pmSaveRegistry();
    _pmRenderList();
    return true;
  } catch(err) {
    plugin.status   = 'error';
    plugin.errorMsg = err.message;
    _dbg.log('[PM] Plugin "' + (plugin.name||plugin.id) + '" error: ' + err.message, 'error');
    _pmSaveRegistry();
    _pmRenderList();
    return false;
  }
}

function _pmLoadPlugin(plugin, callback) {
  if (_pmLoaded[plugin.id]) { if (callback) callback(); return; }
  if (!_pmCallbacks[plugin.id]) _pmCallbacks[plugin.id] = [];
  if (callback) _pmCallbacks[plugin.id].push(callback);
  if (_pmLoading[plugin.id]) return;
  _pmLoading[plugin.id] = true;

  function _done() {
    delete _pmLoading[plugin.id];
    var cbs = _pmCallbacks[plugin.id] || [];
    _pmCallbacks[plugin.id] = [];
    cbs.forEach(function(cb) { try { cb(); } catch(e) {} });
  }

  if (plugin.method === 'url' && plugin.url) {
    plugin.status = 'pending'; _pmRenderList();
    _dbg.log('[PM] Fetching "' + (plugin.name||plugin.id) + '"...', 'info');
    var _t = setTimeout(function() {
      if (_pmLoading[plugin.id]) {
        plugin.status = 'error'; plugin.errorMsg = 'timeout';
        _pmSaveRegistry(); _pmRenderList(); _done();
      }
    }, 20000);
    plugin._pendingTimeout = _t;
    _khBlobChannel.postMessage({ type: 'pm_req', action: 'fetch_code', id: plugin.id, url: plugin.url });
  } else if (plugin.method === 'code' && plugin.code) {
    plugin.status = 'pending'; _pmRenderList();
    _pmExecCode(plugin.code, plugin);
    _done();
  } else {
    plugin.status = 'error'; plugin.errorMsg = 'Tidak ada sumber kode';
    _pmSaveRegistry(); _pmRenderList(); _done();
  }
}

function _pmHandlePmRes(data) {
  if (data.action === 'load_all') {
    try { _pmRegistry = JSON.parse(data.data) || []; } catch(err) { _pmRegistry = []; }
    _pmRenderList();
    _pmRegistry.forEach(function(p) { if (!_pmLoaded[p.id]) _pmLoadPlugin(p, null); });
  } else if (data.action === 'fetch_code') {
    var plugin = _pmRegistry.find(function(p) { return p.id === data.id; });
    if (!plugin) return;
    clearTimeout(plugin._pendingTimeout);
    if (data.error || !data.body || data.body.length < 100) {
      plugin.status = 'error'; plugin.errorMsg = data.error || 'Response kosong';
      _pmSaveRegistry(); _pmRenderList();
    } else { _pmExecCode(data.body, plugin); }
    delete _pmLoading[plugin.id];
    var cbs = _pmCallbacks[plugin.id] || []; _pmCallbacks[plugin.id] = [];
    cbs.forEach(function(cb) { try { cb(); } catch(e2) {} });
  }
}

if (typeof _khBlobChannel !== 'undefined') {
  _khBlobChannel.addEventListener('message', function(bcEv) {
    if (!bcEv.data || bcEv.data.type !== 'pm_res') return;
    _pmHandlePmRes(bcEv.data);
  });
}
window.addEventListener('message', function(e) {
  if (!e.data) return;
  if (e.data.type === 'pm_res') { _pmHandlePmRes(e.data); return; }
  if (e.data.type === 'open_plugin_manager') { _pmOpen(); return; }
});

function _pmSaveRegistry() {
  var toSave = _pmRegistry.map(function(p) {
    return { id: p.id, name: p.name, version: p.version,
             method: p.method, url: p.url || '',
             code: p.method === 'code' ? (p.code || '') : '',
             status: p.status, loadedAt: p.loadedAt || '' };
  });
  _khBlobChannel.postMessage({ type: 'pm_req', action: 'save_all', data: JSON.stringify(toSave) });
}
function _pmLoadRegistry() {
  setTimeout(function() {
    _khBlobChannel.postMessage({ type: 'pm_req', action: 'load_all' });
  }, 500);
}

function _pmOpen()  { document.getElementById('pm-overlay').classList.add('active'); }
function _pmClose() { document.getElementById('pm-overlay').classList.remove('active'); }
function _pmRenderList() {
  var list = document.getElementById('pm-list');
  if (!list) return;
  if (!_pmRegistry.length) { list.innerHTML = '<div class="pm-empty">Belum ada plugin terpasang.</div>'; return; }
  list.innerHTML = '';
  _pmRegistry.forEach(function(p) {
    var st = p.status || 'pending';
    var stLabel = st === 'ok' ? '✓ Aktif' : st === 'error' ? '✗ Error' : '⏳ Loading';
    var card = document.createElement('div');
    card.className = 'pm-card';
    card.innerHTML =
      '<div class="pm-card-top">' +
        '<span class="pm-card-name">' + esc(p.name || p.id) + '</span>' +
        (p.version ? '<span class="pm-card-ver">v' + esc(p.version) + '</span>' : '') +
        '<span class="pm-card-status ' + st + '">' + stLabel + '</span>' +
        '<span class="pm-card-method">' + esc(p.method || '?') + '</span>' +
      '</div>' +
      (p.url ? '<div class="pm-card-url">' + esc(p.url) + '</div>' : '') +
      (p.errorMsg ? '<div style="font-size:11px;color:#e94560;margin-top:4px">' + esc(p.errorMsg) + '</div>' : '') +
      '<div class="pm-card-actions">' +
        '<button class="pm-btn-del" data-id="' + esc(p.id) + '">Hapus</button>' +
        '<button class="pm-btn-reload" data-id="' + esc(p.id) + '">Reload</button>' +
      '</div>';
    card.querySelector('.pm-btn-del').addEventListener('click', function() { _pmRemove(p.id); });
    card.querySelector('.pm-btn-reload').addEventListener('click', function() {
      delete _pmLoaded[p.id]; p.status = 'pending'; _pmLoadPlugin(p, null);
    });
    list.appendChild(card);
  });
}
function _pmRemove(id) {
  _pmRegistry = _pmRegistry.filter(function(p) { return p.id !== id; });
  delete _pmLoaded[id];
  _pmSaveRegistry(); _pmRenderList();
}
var _pmCurrentMethod = 'url';
function _pmAdd() {
  var btn = document.getElementById('pm-add-btn');
  btn.disabled = true;
  var url  = (document.getElementById('pm-url-input').value  || '').trim();
  var code = (document.getElementById('pm-code-input').value || '').trim();
  var id   = 'plugin_' + Date.now();

  if (_pmCurrentMethod === 'url' && url) {
    _pmRegistry.push({ id, name: url.split('/').pop() || id, version: '?', method: 'url', url, status: 'pending' });
    _pmSaveRegistry(); _pmRenderList();
    _pmLoadPlugin(_pmRegistry[_pmRegistry.length - 1], null);
    document.getElementById('pm-url-input').value = '';
  } else if (_pmCurrentMethod === 'code' && code) {
    var nameM = code.match(/\\/\\/ @name\\s+(.+)/);
    var verM  = code.match(/\\/\\/ @version\\s+(.+)/);
    var name  = nameM ? nameM[1].trim() : 'Plugin ' + id;
    var ver   = verM  ? verM[1].trim()  : '1.0.0';
    _pmRegistry.push({ id, name, version: ver, method: 'code', code, status: 'pending' });
    _pmSaveRegistry(); _pmRenderList();
    _pmLoadPlugin(_pmRegistry[_pmRegistry.length - 1], null);
    document.getElementById('pm-code-input').value = '';
  } else {
    toast('\\u26a0 Isi URL atau paste kode plugin', 'error');
  }
  btn.disabled = false;
}
`;

    function openExplorer() {
        const apiKey    = GM_getValue('tmdb_key', '');
        const hitvCookie = GM_getValue('hitv_cookie', '');
        let hitvDid = GM_getValue('hitv_did_gm', '');
        if (!hitvDid) {
            hitvDid = Array.from({length: 24}, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random()*62)]).join('');
            GM_setValue('hitv_did_gm', hitvDid);
        }
        const html = getHTML(apiKey, hitvCookie, hitvDid);
        const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
        const blobUrl = URL.createObjectURL(blob);
        _explorerWindow = window.open(blobUrl, '_blank');
        if (!_explorerWindow) {
            GM_openInTab(blobUrl, { active: true, insert: true });
        }
    }

    function getHTML(apiKey, hitvCookie, hitvDid) {
        return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Drama Explorer</title>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<script>
(function(){
  var s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js';
  s.async = false;
  s.onerror = function(){ window._cryptoJsFailed = true; };
  document.head.appendChild(s);
})();
<\/script>
<style>
:root{--bg:#080810;--surface:#0f0f1a;--surface2:#161625;--surface3:#1e1e30;--border:#ffffff08;--border2:#ffffff14;--accent:#e94560;--accent2:#f4a261;--accent3:#7c3aed;--text:#f0eeff;--muted:#6b6880;--muted2:#9896aa;--success:#2dd4bf;--warning:#fbbf24;--radius:12px;--font-display:'Bebas Neue'}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'Outfit',sans-serif;min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background:radial-gradient(ellipse 70% 40% at 10% 0%,#e9456018 0%,transparent 55%),radial-gradient(ellipse 50% 30% at 90% 100%,#f4a26110 0%,transparent 50%);pointer-events:none;z-index:0}
header{position:sticky;top:0;z-index:200;background:#080810ee;backdrop-filter:blur(20px);border-bottom:1px solid var(--border2);padding:0 28px;height:58px;display:flex;align-items:center;gap:20px}
.logo{font-family:'Bebas Neue',sans-serif;font-size:26px;letter-spacing:2px;background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;-webkit-text-fill-color:transparent;white-space:nowrap;flex-shrink:0}
.logo-sub{font-size:13px;font-family:'Outfit',sans-serif;font-weight:400;letter-spacing:.5px;margin-left:8px;background:none;-webkit-text-fill-color:#ffffff44}
.header-spacer{flex:1}
#api-key-btn{background:var(--surface2);border:1px solid var(--border2);color:var(--muted2);padding:6px 14px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:12px;cursor:pointer;transition:all .2s}
#api-key-btn:hover{border-color:var(--accent);color:var(--accent)}
.filter-bar{position:relative;z-index:1;background:var(--surface);border-bottom:1px solid var(--border2);padding:16px 28px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
.filter-group{display:flex;flex-direction:column;gap:5px;flex-shrink:0}
.filter-label{font-size:10px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted)}
select,input[type=number],input[type=text]{background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:8px 12px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:13px;outline:none;cursor:pointer;transition:border-color .2s,background .2s;appearance:none;-webkit-appearance:none}
select:focus,input:focus{border-color:var(--accent);background:var(--surface3)}
select{min-width:140px;padding-right:28px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%236b6880'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center}
input[type=number]{width:100px;-moz-appearance:textfield}
input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{display:none}
input::placeholder{color:var(--muted)}
.tags-wrap{display:flex;flex-direction:column;gap:5px;flex:1;min-width:200px}
.tags-input-row{display:flex;flex-wrap:wrap;gap:5px;align-items:center;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;padding:5px 8px;min-height:38px;cursor:text;transition:border-color .2s}
.tags-input-row:focus-within{border-color:var(--accent)}
.tag-pill{background:var(--accent);color:#fff;font-size:11px;font-weight:600;padding:2px 8px 2px 10px;border-radius:20px;display:flex;align-items:center;gap:4px;white-space:nowrap}
.tag-pill-x{background:none;border:none;color:#fff;font-size:14px;cursor:pointer;line-height:1;padding:0;opacity:.7}
.tag-pill-x:hover{opacity:1}
#tag-input{background:none;border:none;outline:none;color:var(--text);font-family:'Outfit',sans-serif;font-size:12px;min-width:80px;flex:1;padding:2px 4px}
.search-btn{background:var(--accent);border:none;color:#fff;padding:9px 26px;border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1.5px;cursor:pointer;transition:background .2s,transform .1s;align-self:flex-end;white-space:nowrap;box-shadow:0 4px 20px #e9456033}
.search-btn:hover{background:#ff5070}
.search-btn:active{transform:scale(.97)}
.search-btn:disabled{opacity:.4;cursor:not-allowed}
.mode-tabs{display:flex;gap:0;background:var(--surface2);border-radius:8px;padding:3px;border:1px solid var(--border2);flex-shrink:0;align-self:flex-end}
.mode-tab{background:transparent;border:none;color:var(--muted2);font-family:'Outfit',sans-serif;font-size:12px;font-weight:600;padding:5px 14px;border-radius:6px;cursor:pointer;transition:all .15s;white-space:nowrap;letter-spacing:.3px}
.mode-tab.active{background:var(--accent);color:#fff;box-shadow:0 2px 8px #e9456044}
.mode-tab:not(.active):hover{color:var(--text)}
.kw-pill{background:#7c3aed33;border:1px solid #7c3aed88;color:#a78bfa;font-size:11px;font-weight:600;padding:2px 8px 2px 10px;border-radius:20px;display:flex;align-items:center;gap:4px;white-space:nowrap}
.kw-pill-x{background:none;border:none;color:#a78bfa;font-size:14px;cursor:pointer;line-height:1;padding:0;opacity:.7}
.kw-pill-x:hover{opacity:1}
.kw-autocomplete{position:relative;flex:1;min-width:200px}
.kw-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--surface2);border:1px solid var(--border2);border-radius:8px;z-index:999;max-height:220px;overflow-y:auto;display:none;box-shadow:0 8px 24px #00000066}
.kw-dropdown.open{display:block}
.kw-option{padding:9px 14px;font-size:13px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background .1s}
.kw-option:hover,.kw-option.focused{background:var(--surface3)}
.kw-option-count{font-size:11px;color:var(--muted);flex-shrink:0;margin-left:8px}
.kw-option-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kw-spinner{padding:10px 14px;font-size:12px;color:var(--muted);text-align:center}
#f-title{flex:1;min-width:200px}
.sort-bar{position:relative;z-index:1;padding:10px 28px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);flex-wrap:wrap}
.sort-label{font-size:12px;color:var(--muted)}
.sort-chips{display:flex;gap:6px;flex-wrap:wrap}
.sort-chip{background:transparent;border:1px solid var(--border2);color:var(--muted2);font-family:'Outfit',sans-serif;font-size:12px;padding:4px 12px;border-radius:20px;cursor:pointer;transition:all .15s;white-space:nowrap}
.sort-chip:hover{border-color:var(--accent);color:var(--accent)}
.sort-chip.active{background:var(--accent);color:#fff;border-color:var(--accent);font-weight:600}
.status-bar{position:relative;z-index:1;padding:8px 28px;display:flex;align-items:center;gap:10px;min-height:36px}
.spinner{width:14px;height:14px;border:2px solid var(--border2);border-top-color:var(--accent);border-radius:50%;animation:spin .7s linear infinite;display:none;flex-shrink:0}
.spinner.on{display:block}
@keyframes spin{to{transform:rotate(360deg)}}
.status-text{font-size:12px;color:var(--muted)}
.debug-panel{position:relative;z-index:1;background:var(--surface);border-bottom:1px solid var(--border2);font-size:11px;font-family:monospace}
.debug-header{display:flex;align-items:center;gap:8px;padding:5px 28px;cursor:pointer;user-select:none;border-bottom:1px solid transparent;transition:border-color .2s}
.debug-header:hover{border-color:var(--border2)}
.debug-title{color:var(--accent2);font-weight:700;font-size:11px}
.debug-summary{color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.debug-toggle{color:var(--muted);font-size:10px;flex-shrink:0}
.debug-body{display:none;padding:8px 28px 10px;border-top:1px solid var(--border);max-height:260px;overflow-y:auto}
.debug-body.open{display:block}
.debug-section{margin-bottom:10px}
.debug-section-title{color:var(--accent2);font-weight:700;margin-bottom:4px;font-size:10px;letter-spacing:1px;text-transform:uppercase}
.debug-url{color:#7dd3fc;word-break:break-all;line-height:1.6;margin-bottom:3px}
.debug-url:before{content:'\u2192 ';color:var(--muted)}
.debug-stat{color:var(--muted2);line-height:1.8}
.debug-stat span{color:var(--text)}
.debug-log{color:var(--muted);line-height:1.7;max-height:100px;overflow-y:auto;border-top:1px solid var(--border);padding-top:6px;margin-top:4px}
.debug-log-entry{display:block;padding:1px 0}
.debug-log-entry.info{color:var(--muted2)}
.debug-log-entry.warn{color:var(--warning)}
.debug-log-entry.error{color:var(--accent)}
.debug-log-entry.success{color:var(--success)}
.results{position:relative;z-index:1;padding:20px 28px 60px;display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:14px}
.empty-state{grid-column:1/-1;text-align:center;padding:100px 20px}
.empty-state h2{font-family:'Bebas Neue',sans-serif;font-size:40px;letter-spacing:2px;color:var(--surface3);margin-bottom:10px}
.empty-state p{font-size:14px;line-height:1.6;color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;cursor:pointer;transition:transform .2s,border-color .2s,box-shadow .2s;animation:fadeUp .35s ease both;position:relative}
.card:hover{transform:translateY(-5px) scale(1.01);border-color:var(--accent);box-shadow:0 10px 40px #e9456020}
@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
.card-poster-wrap{position:relative;width:100%;aspect-ratio:2/3;overflow:hidden;background:var(--surface2)}
.card-poster{width:100%;height:100%;object-fit:cover;display:block;transition:transform .3s}
.card:hover .card-poster{transform:scale(1.05)}
.card-no-poster{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:36px}
.card-overlay{position:absolute;inset:0;background:linear-gradient(to top,#000000cc 0%,transparent 50%);opacity:0;transition:opacity .25s;display:flex;align-items:flex-end;padding:10px;gap:5px}
.card:hover .card-overlay{opacity:1}
.overlay-btn{flex:1;background:var(--accent);border:none;color:#fff;font-family:'Outfit',sans-serif;font-size:11px;font-weight:600;padding:6px 4px;border-radius:6px;cursor:pointer;text-align:center;white-space:nowrap}
.overlay-btn:hover{filter:brightness(1.15)}
/* ── Generic plugin badge ── */
.plugin-badge{position:absolute;right:7px;font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:4px;backdrop-filter:blur(4px);z-index:2;transition:opacity .2s}
.plugin-badge.checking{background:#00000066;color:#ffffff66}
.plugin-badge.found{color:#fff}
.plugin-badge.missing{background:#374151aa;color:#9ca3af}
.type-badge{position:absolute;top:7px;left:7px;font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:4px;background:#000000aa;backdrop-filter:blur(4px);color:var(--accent2);z-index:2}
.card-rating-strip{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top,#000000dd,transparent);padding:18px 8px 7px;display:flex;align-items:center;gap:4px;font-size:12px;font-weight:600;color:var(--warning)}
.card-info{padding:9px 10px 10px}
.card-title{font-size:13px;font-weight:600;line-height:1.3;margin-bottom:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{font-size:11px;color:var(--muted2);display:flex;gap:8px;flex-wrap:wrap;margin-top:0}
.card-meta-year{color:var(--accent2);font-weight:500}
.status-badge{display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:4px;pointer-events:none;margin-top:1px;margin-bottom:4px;width:fit-content}
.status-badge.ongoing{background:#05966922;border:1px solid #05966966;color:#2dd4bf}
.status-badge.ended{background:#ffffff0a;border:1px solid #ffffff18;color:#6b6880}
.status-badge.canceled{background:#dc262622;border:1px solid #dc262666;color:#f87171}
.upcoming-badge{display:inline-flex;align-items:center;font-size:9px;font-weight:700;letter-spacing:.5px;padding:2px 7px;border-radius:4px;background:#d97706cc;color:#fff;pointer-events:none;margin-top:1px;margin-bottom:4px;width:fit-content}
.load-more-wrap{grid-column:1/-1;display:flex;justify-content:center;padding:10px 0 20px}
.load-more-btn{background:var(--surface2);border:1px solid var(--border2);color:var(--muted2);padding:10px 36px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:13px;cursor:pointer;transition:all .2s}
.load-more-btn:hover{border-color:var(--accent);color:var(--accent)}
.detail-overlay{position:fixed;inset:0;background:#000000bb;backdrop-filter:blur(12px);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;pointer-events:none;transition:opacity .25s}
.detail-overlay.active{opacity:1;pointer-events:all}
.detail-panel{background:var(--surface);border:1px solid var(--border2);border-radius:18px;width:100%;max-width:780px;max-height:90vh;overflow-y:auto;transform:scale(.95) translateY(10px);transition:transform .25s;scrollbar-width:thin}
.detail-overlay.active .detail-panel{transform:scale(1) translateY(0)}
.detail-hero{display:flex;position:relative}
.detail-poster{width:200px;min-width:200px;aspect-ratio:2/3;object-fit:cover;border-radius:18px 0 0 0}
.detail-poster-ph{width:200px;min-width:200px;aspect-ratio:2/3;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:48px;border-radius:18px 0 0 0}
.detail-info{padding:24px;flex:1;display:flex;flex-direction:column;gap:10px;min-width:0}
.detail-close{position:absolute;top:14px;right:14px;background:var(--surface3);border:1px solid var(--border2);color:var(--muted2);width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:2}
.detail-close:hover{border-color:var(--accent);color:var(--accent)}
.detail-title{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:1px;line-height:1.1}
.detail-tagline{font-size:13px;color:var(--muted2);font-style:italic}
.detail-badges{display:flex;flex-wrap:wrap;gap:6px}
.detail-badge{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px;border:1px solid var(--border2);color:var(--muted2)}
.detail-badge.accent{border-color:var(--accent);color:var(--accent)}
.detail-badge.success{border-color:var(--success);color:var(--success)}
.detail-rating-row{display:flex;align-items:center;gap:8px}
.detail-score{font-size:20px;font-weight:700}
.detail-votes{font-size:11px;color:var(--muted)}
.detail-overview{font-size:13px;line-height:1.7;color:var(--muted2)}
.detail-genres{display:flex;flex-wrap:wrap;gap:5px}
.detail-genre-chip{font-size:11px;background:var(--surface3);border-radius:4px;padding:2px 8px;color:var(--muted2)}
.detail-actions{padding:16px 24px 20px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:12px}
.action-row{display:flex;gap:10px;flex-wrap:wrap}
.action-btn{flex:1;min-width:140px;background:var(--accent);border:none;color:#fff;padding:10px 16px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:8px}
.action-btn:hover{filter:brightness(1.15)}
.action-btn.secondary{background:var(--surface2);border:1px solid var(--border2);color:var(--muted2)}
.action-btn.secondary:hover{border-color:var(--accent2);color:var(--accent2)}
.action-btn:disabled{opacity:.4;cursor:not-allowed}
.episodes-section{padding:0 24px 24px}
.episodes-title{font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.episode-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:5px;max-height:140px;overflow-y:auto;scrollbar-width:thin}
.ep-btn{background:var(--surface2);border:1px solid var(--border);color:var(--muted2);border-radius:6px;padding:7px 4px;font-family:'Outfit',sans-serif;font-size:12px;cursor:pointer;transition:all .15s;text-align:center}
.ep-btn:hover,.ep-btn.active{border-color:var(--accent);color:var(--accent)}
.ep-btn.active{background:#e9456022}
.player-section{padding:0 24px 24px}
.player-title{font-size:12px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.player-wrap{position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden}
.player-wrap iframe{width:100%;height:100%;border:none}
.player-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:var(--surface2);color:var(--muted);font-size:13px}
.player-loading .spinner{display:block;width:24px;height:24px;border-width:3px}
.modal-overlay{position:fixed;inset:0;background:#000000cc;backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s}
.modal-overlay.active{opacity:1;pointer-events:all}
.modal{background:var(--surface);border:1px solid var(--border2);border-radius:16px;padding:28px;width:420px;max-width:90vw;transform:scale(.95);transition:transform .2s}
.modal-overlay.active .modal{transform:scale(1)}
.modal h3{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;margin-bottom:8px}
.modal p{font-size:13px;color:var(--muted2);margin-bottom:16px;line-height:1.6}
.modal input[type=text]{width:100%;margin-bottom:14px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:10px 14px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:13px;outline:none;transition:border-color .2s;appearance:none;-webkit-appearance:none}
.modal input:focus{border-color:var(--accent)}
.modal-btns{display:flex;gap:8px;justify-content:flex-end}
.btn-cancel{background:transparent;border:1px solid var(--border2);color:var(--muted);padding:8px 18px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:13px;cursor:pointer}
.btn-save{background:var(--accent);border:none;color:#fff;padding:8px 22px;border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;cursor:pointer}
.btn-save:hover{background:#ff5070}
.toast{position:fixed;bottom:24px;right:24px;background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:11px 18px;border-radius:10px;font-size:13px;z-index:99999;transform:translateY(16px);opacity:0;transition:all .25s;pointer-events:none;max-width:320px}
.toast.show{transform:translateY(0);opacity:1}
.toast.error{border-color:var(--accent);color:var(--accent)}
.toast.success{border-color:var(--success);color:var(--success)}
#plugin-mgr-btn{background:var(--surface2);border:1px solid var(--border2);color:var(--muted2);padding:6px 14px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:12px;cursor:pointer;transition:all .2s}
#plugin-mgr-btn:hover{border-color:#0ea5e9;color:#0ea5e9}
.pm-overlay{position:fixed;inset:0;background:#000000cc;backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .2s}
.pm-overlay.active{opacity:1;pointer-events:all}
.pm-modal{background:var(--surface);border:1px solid var(--border2);border-radius:16px;padding:28px;width:580px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;gap:16px;transform:scale(.95);transition:transform .2s}
.pm-overlay.active .pm-modal{transform:scale(1)}
.pm-modal h3{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;margin:0}
.pm-list{display:flex;flex-direction:column;gap:10px;overflow-y:auto;max-height:340px;scrollbar-width:thin;padding-right:4px}
.pm-card{background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.pm-card-top{display:flex;align-items:center;gap:10px}
.pm-card-name{font-weight:700;font-size:14px;flex:1}
.pm-card-ver{font-size:11px;color:var(--muted);background:var(--surface3);padding:2px 8px;border-radius:4px}
.pm-card-status{font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px}
.pm-card-status.ok{background:#0ea5e922;color:#0ea5e9;border:1px solid #0ea5e955}
.pm-card-status.error{background:#e9456022;color:#e94560;border:1px solid #e9456055}
.pm-card-status.pending{background:#f4a26122;color:#f4a261;border:1px solid #f4a26155}
.pm-card-url{font-size:11px;color:var(--muted);word-break:break-all;font-family:monospace}
.pm-card-method{font-size:10px;font-weight:700;padding:1px 6px;border-radius:3px;background:var(--surface3);color:var(--muted2)}
.pm-card-actions{display:flex;gap:6px;margin-top:2px}
.pm-btn-del{background:transparent;border:1px solid #e9456066;color:#e94560;padding:4px 12px;border-radius:6px;font-size:11px;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .15s}
.pm-btn-del:hover{background:#e9456022}
.pm-btn-reload{background:transparent;border:1px solid var(--border2);color:var(--muted2);padding:4px 12px;border-radius:6px;font-size:11px;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .15s}
.pm-btn-reload:hover{border-color:#0ea5e9;color:#0ea5e9}
.pm-add{border-top:1px solid var(--border);padding-top:16px;display:flex;flex-direction:column;gap:10px}
.pm-add h4{font-size:13px;font-weight:700;color:var(--muted2);letter-spacing:.5px;text-transform:uppercase;margin:0}
.pm-method-tabs{display:flex;gap:6px}
.pm-method-tab{background:var(--surface2);border:1px solid var(--border2);color:var(--muted2);padding:5px 14px;border-radius:6px;font-size:12px;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .15s}
.pm-method-tab.active{border-color:#0ea5e9;color:#0ea5e9;background:#0ea5e911}
.pm-input{width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:9px 12px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:12px;outline:none;transition:border-color .2s;box-sizing:border-box}
.pm-input:focus{border-color:#0ea5e9}
.pm-textarea{width:100%;background:var(--surface2);border:1px solid var(--border2);color:var(--text);padding:9px 12px;border-radius:8px;font-family:monospace;font-size:11px;outline:none;transition:border-color .2s;box-sizing:border-box;resize:vertical;min-height:80px;max-height:160px}
.pm-textarea:focus{border-color:#0ea5e9}
.pm-footer{display:flex;gap:8px;justify-content:flex-end}
.pm-btn-add{background:#0ea5e9;border:none;color:#fff;padding:8px 20px;border-radius:8px;font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;cursor:pointer;transition:background .2s}
.pm-btn-add:hover{background:#0284c7}
.pm-btn-add:disabled{opacity:.4;cursor:not-allowed}
.pm-btn-close{background:transparent;border:1px solid var(--border2);color:var(--muted);padding:8px 18px;border-radius:8px;font-family:'Outfit',sans-serif;font-size:13px;cursor:pointer}
.pm-empty{text-align:center;padding:24px;color:var(--muted);font-size:13px}
.no-key-banner{background:var(--surface);border:1px solid var(--accent);border-radius:10px;padding:14px 18px;margin:16px 28px 0;display:flex;align-items:center;gap:12px;font-size:13px;color:var(--muted2)}
.no-key-banner b{color:var(--accent)}
.no-key-banner button{margin-left:auto;background:var(--accent);border:none;color:#fff;padding:6px 14px;border-radius:6px;font-family:'Outfit',sans-serif;font-size:12px;cursor:pointer;white-space:nowrap}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:3px}
@media(max-width:600px){header{padding:0 16px}.filter-bar,.sort-bar,.status-bar{padding-left:16px;padding-right:16px}.results{padding:16px 16px 40px;grid-template-columns:repeat(auto-fill,minmax(130px,1fr))}.detail-hero{flex-direction:column}.detail-poster,.detail-poster-ph{width:100%;border-radius:18px 18px 0 0}}
</style>
</head>
<body>
<header>
  <div class="logo">DRAMA <span class="logo-sub">EXPLORER</span></div>
  <div class="header-spacer"></div>
  <button id="plugin-mgr-btn">\u{1F9E9} Plugins</button>
  <button id="api-key-btn">\u2699 API Key</button>
</header>

<div id="no-key-banner" class="no-key-banner" style="display:none">
  \u26a0 <b>API Key belum diset.</b> &nbsp;Explorer membutuhkan TMDB API Key gratis untuk bekerja.
  <button onclick="showModal()">Set API Key</button>
</div>

<div class="filter-bar" id="filter-bar">
  <div style="width:100%;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
    <div class="filter-label" style="flex-shrink:0">MODE:</div>
    <div class="mode-tabs" id="mode-tabs">
      <button class="mode-tab active" data-mode="discover">\ud83d\udd0d Discover</button>
      <button class="mode-tab" data-mode="title">\ud83d\udd24 Cari Judul</button>
      <button class="mode-tab" data-mode="keyword">\ud83c\udff7 Keyword</button>
    </div>
  </div>
  <div class="filter-group"><div class="filter-label">Tipe</div>
    <select id="f-type"><option value="tv">Serial TV</option><option value="movie">Film</option></select>
  </div>
  <div class="filter-group"><div class="filter-label">Genre</div>
    <select id="f-genre"><option value="">Semua Genre</option></select>
  </div>
  <div class="filter-group"><div class="filter-label">Negara</div>
    <select id="f-country">
      <option value="">Semua Negara</option>
      <option value="KR">Korea Selatan</option>
      <option value="CN">China</option>
      <option value="JP">Jepang</option>
      <option value="TH">Thailand</option>
      <option value="TW">Taiwan</option>
      <option value="HK">Hong Kong</option>
      <option value="PH">Filipina</option>
      <option value="US">Amerika Serikat</option>
    </select>
  </div>
  <div class="filter-group"><div class="filter-label">Tahun</div>
    <input type="number" id="f-year" placeholder="2024" min="1990" max="2099">
  </div>
  <div class="filter-group"><div class="filter-label">Rating Min</div>
    <input type="number" id="f-rating" placeholder="7.0" min="0" max="10" step="0.5">
  </div>
  <div class="tags-wrap" id="mode-discover">
    <div class="filter-label">Kata Kunci (opsional)</div>
    <div class="tags-input-row" id="tags-container">
      <input type="text" id="tag-input" placeholder="Ketik judul/tag lalu Enter..." autocomplete="off">
    </div>
  </div>
  <div class="filter-group" id="mode-title" style="display:none;flex:1">
    <div class="filter-label">Judul / Nama</div>
    <input type="text" id="f-title" placeholder="Cth: True Beauty, Goblin..." autocomplete="off">
  </div>
  <div class="kw-autocomplete" id="mode-keyword" style="display:none">
    <div class="filter-label">Keyword TMDB</div>
    <div class="tags-input-row" id="kw-container">
      <input type="text" id="kw-input" placeholder="Ketik keyword..." autocomplete="off">
    </div>
    <div class="kw-dropdown" id="kw-dropdown"></div>
  </div>
  <button class="search-btn" id="search-btn">CARI</button>
</div>

<div id="sort-bar-wrap">
<div class="sort-bar">
  <div class="sort-label">URUTAN:</div>
  <div class="sort-chips" id="sort-chips">
    <button class="sort-chip active" data-sort="popularity.desc">Terpopuler</button>
    <button class="sort-chip" data-sort="vote_average.desc">Rating \u2191</button>
    <button class="sort-chip" data-sort="first_air_date.desc">Terbaru</button>
    <button class="sort-chip" data-sort="first_air_date.asc">Terlama</button>
    <button class="sort-chip" data-sort="vote_count.desc">Banyak Votes</button>
  </div>
</div>
</div>

<div class="status-bar">
  <div class="spinner" id="spinner"></div>
  <div class="status-text" id="status-text">Siap. Pilih filter dan klik Cari.</div>
</div>
<div class="debug-panel" id="debug-panel">
  <div class="debug-header" id="debug-header">
    <span class="debug-title">\u2699 DEBUG</span>
    <span class="debug-summary" id="debug-summary">Siap.</span>
    <span class="debug-toggle" id="debug-toggle">\u25b6 buka</span>
  </div>
  <div class="debug-body" id="debug-body">
    <div class="debug-section"><div class="debug-section-title">URL API</div><div id="debug-urls"></div></div>
    <div class="debug-section"><div class="debug-section-title">Statistik</div><div id="debug-stats"></div></div>
    <div class="debug-section"><div class="debug-section-title">Log</div><div class="debug-log" id="debug-log"></div></div>
  </div>
</div>

<div class="results" id="results">
  <div class="empty-state">
    <h2>DRAMA EXPLORER</h2>
    <p>Temukan drama & film favoritmu.<br>Filter by genre, negara, tahun, rating, atau tag.</p>
  </div>
</div>

<div class="detail-overlay" id="detail-overlay">
  <div class="detail-panel">
    <div class="detail-hero" id="detail-hero"></div>
    <div class="detail-actions" id="detail-actions"></div>
    <div id="detail-extra"></div>
  </div>
</div>

<div class="modal-overlay" id="modal-overlay">
  <div class="modal">
    <h3>\ud83d\udd11 TMDB API Key</h3>
    <p>Masukkan API Key gratis dari <a href="https://www.themoviedb.org/settings/api" target="_blank" style="color:var(--accent)">themoviedb.org</a>.<br>
    Daftar \u2192 Settings \u2192 API \u2192 API Key (v3 auth).</p>
    <input type="text" id="modal-key-input" placeholder="Paste API Key di sini...">
    <div class="modal-btns">
      <button class="btn-cancel" id="modal-cancel">Batal</button>
      <button class="btn-save" id="modal-save">SIMPAN</button>
    </div>
  </div>
</div>

<div class="pm-overlay" id="pm-overlay">
  <div class="pm-modal">
    <h3>\u{1F9E9} PLUGIN MANAGER</h3>
    <div class="pm-list" id="pm-list"><div class="pm-empty">Belum ada plugin terpasang.</div></div>
    <div class="pm-add">
      <h4>Tambah Plugin Baru</h4>
      <div class="pm-method-tabs">
        <button class="pm-method-tab active" data-pm-method="url">\u{1F517} URL GitHub</button>
        <button class="pm-method-tab" data-pm-method="code">\u{1F4CB} Paste Kode</button>
      </div>
      <div id="pm-input-url">
        <input class="pm-input" id="pm-url-input" placeholder="https://raw.githubusercontent.com/..." autocomplete="off">
      </div>
      <div id="pm-input-code" style="display:none">
        <textarea class="pm-textarea" id="pm-code-input" placeholder="Paste seluruh isi file plugin di sini..."></textarea>
      </div>
      <div class="pm-footer">
        <button class="pm-btn-close" id="pm-close">Tutup</button>
        <button class="pm-btn-add" id="pm-add-btn">TAMBAH</button>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
window.__HITV_COOKIE__ = ${JSON.stringify(hitvCookie||'')};
window.__HITV_DID__ = '__HITV_DID_PLACEHOLDER__';
var API_KEY = '__TMDB_KEY_PLACEHOLDER__' || localStorage.getItem('kh_tmdb_key') || '';

var currentMode = 'discover';
var currentSort = 'popularity.desc';
var currentPage = 1;
var totalPages  = 1;
var isLoading   = false;
var tags        = [];
var selectedKeywords = [];
var tmdbDetailCache  = new Map();
var genreMap         = {};

document.addEventListener('DOMContentLoaded', function() {

const TMDB  = 'https://api.themoviedb.org/3';
const IMG_W = 'https://image.tmdb.org/t/p/w342';
const IMG_L = 'https://image.tmdb.org/t/p/w780';

// ── Proxy Fetch ───────────────────────────────────────────────────────────
const _proxyPending = new Map();
window._khBlobChannel = new BroadcastChannel('kh_proxy');
_khBlobChannel.onmessage = function(e) {
  if (!e.data || e.data.type !== 'proxy_res') return;
  const { id, body, error } = e.data;
  const cb = _proxyPending.get(id);
  if (!cb) return;
  _proxyPending.delete(id);
  if (error) cb.reject(new Error(error));
  else cb.resolve(e.data);
};
window.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'proxy_res') return;
  const { id, body, error } = e.data;
  const cb = _proxyPending.get(id);
  if (!cb) return;
  _proxyPending.delete(id);
  if (error) cb.reject(new Error(error));
  else cb.resolve({ body, hitvDid: e.data.hitvDid, finalUrl: e.data.finalUrl });
});

function launcherFetch(url, params, headers, method, body, bodyType) {
  const id = Date.now() + '_' + Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { _proxyPending.delete(id); reject(new Error('Proxy timeout')); }, 15000);
    _proxyPending.set(id, {
      resolve: (res) => { clearTimeout(timer); resolve(res); },
      reject:  (err) => { clearTimeout(timer); reject(err); }
    });
    _khBlobChannel.postMessage({ type:'proxy_req', id, url, params, headers, method:method||'GET', body, bodyType });
  });
}

// ── PM Engine ─────────────────────────────────────────────────────────────
// __PM_ENGINE_PLACEHOLDER__

// ── Utilities ─────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escInner(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setStatus(msg) { document.getElementById('status-text').textContent = msg; }
function toast(msg, type) { const t=document.getElementById('toast'); t.textContent=msg; t.className='toast show'+(type?' '+type:''); clearTimeout(t._to); t._to=setTimeout(()=>{t.className='toast';},3500); }
function showEmpty() { document.getElementById('results').innerHTML='<div class="empty-state"><h2>KOSONG</h2><p>Tidak ada hasil. Coba ubah filter.</p></div>'; }
function showModal() { document.getElementById('modal-key-input').value=API_KEY||''; document.getElementById('modal-overlay').classList.add('active'); setTimeout(()=>document.getElementById('modal-key-input').focus(),100); }
function hideModal() { document.getElementById('modal-overlay').classList.remove('active'); }

const _dbg = {
  urls:[], stats:{}, logs:[], startTime:0,
  reset() { this.urls=[]; this.stats={}; this.logs=[]; this.startTime=performance.now(); document.getElementById('debug-urls').innerHTML=''; document.getElementById('debug-stats').innerHTML=''; document.getElementById('debug-log').innerHTML=''; this.summary('Mencari...'); },
  summary(msg) { const el=document.getElementById('debug-summary'); if(el) el.textContent=msg; },
  url(u) { const clean=u.replace(/api_key=[^&]+/,'api_key=***'); this.urls.push(clean); const el=document.getElementById('debug-urls'); if(el){const d=document.createElement('div');d.className='debug-url';d.textContent=clean;el.appendChild(d);} },
  stat(key,val) { this.stats[key]=val; const el=document.getElementById('debug-stats'); if(el) el.innerHTML=Object.entries(this.stats).map(([k,v])=>'<div class="debug-stat">'+k+': <span>'+v+'</span></div>').join(''); },
  log(msg,type='info') { const elapsed=((performance.now()-this.startTime)/1000).toFixed(2); const entry='['+elapsed+'s] '+msg; this.logs.push(entry); const el=document.getElementById('debug-log'); if(el){const d=document.createElement('span');d.className='debug-log-entry '+type;d.textContent=entry;el.appendChild(d);el.scrollTop=el.scrollHeight;} },
  done(total) { const elapsed=((performance.now()-this.startTime)/1000).toFixed(2); this.stat('\u23f1 Waktu',elapsed+'s'); this.stat('\u2705 Total hasil',total); this.summary(total+' hasil \u00b7 '+elapsed+'s'); this.log('Selesai: '+total+' item dalam '+elapsed+'s','success'); }
};

document.getElementById('debug-header').addEventListener('click', () => {
  const body=document.getElementById('debug-body');
  const toggle=document.getElementById('debug-toggle');
  const isOpen=body.classList.toggle('open');
  toggle.textContent=isOpen?'\u25bc tutup':'\u25b6 buka';
});

// ── Genre ─────────────────────────────────────────────────────────────────
async function loadGenres() {
  const sel = document.getElementById('f-genre');
  try {
    const r = await fetch(TMDB+'/genre/tv/list?api_key='+API_KEY+'&language=id');
    if (!r.ok) return;
    const d = await r.json();
    (d.genres||[]).forEach(g => {
      const opt = document.createElement('option'); opt.value=g.id; opt.textContent=g.name; sel.appendChild(opt);
    });
  } catch(e) {}
}
async function buildGenreMap() {
  try {
    const [tv,mv] = await Promise.all([
      fetch(TMDB+'/genre/tv/list?api_key='+API_KEY+'&language=id').then(r=>r.json()),
      fetch(TMDB+'/genre/movie/list?api_key='+API_KEY+'&language=id').then(r=>r.json())
    ]);
    [...(tv.genres||[]),...(mv.genres||[])].forEach(g=>{ genreMap[g.id]=g.name; });
  } catch(e) {}
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  enableSearch();
  if (!API_KEY) {
    document.getElementById('no-key-banner').style.display='flex';
    setStatus('\u26a0 API Key belum diset. Klik "Set API Key" untuk mulai.');
    return;
  }
  loadGenres().catch(()=>{});
  buildGenreMap().catch(()=>{});
  setStatus('Siap.');
}
function enableSearch() { document.getElementById('search-btn').disabled=false; isLoading=false; }

// ── Mode tabs ─────────────────────────────────────────────────────────────
document.getElementById('mode-tabs').addEventListener('click', e => {
  const t = e.target.closest('.mode-tab'); if (!t) return;
  currentMode = t.dataset.mode;
  document.querySelectorAll('.mode-tab').forEach(b=>b.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('mode-discover').style.display = currentMode==='discover' ? '' : 'none';
  document.getElementById('mode-title').style.display    = currentMode==='title'    ? '' : 'none';
  document.getElementById('mode-keyword').style.display  = currentMode==='keyword'  ? '' : 'none';
  setStatus('Siap. Pilih filter dan klik Cari.');
});

// ── Tags ──────────────────────────────────────────────────────────────────
const tagInput = document.getElementById('tag-input');
function addTag(v) { v=v.trim(); if(!v||tags.includes(v)) return; tags.push(v); renderTags(); }
function removeTag(v) { tags=tags.filter(t=>t!==v); renderTags(); }
function renderTags() {
  document.getElementById('tags-container').querySelectorAll('.tag-pill').forEach(e=>e.remove());
  tags.forEach(tag => {
    const p=document.createElement('div'); p.className='tag-pill';
    p.innerHTML=tag+'<button class="tag-pill-x">\u00d7</button>';
    p.querySelector('.tag-pill-x').addEventListener('click',()=>removeTag(tag));
    document.getElementById('tags-container').insertBefore(p,tagInput);
  });
}
tagInput.addEventListener('keydown', e => {
  if (e.key==='Enter'||e.key===',') { e.preventDefault(); addTag(tagInput.value); tagInput.value=''; }
  else if (e.key==='Backspace'&&tagInput.value===''&&tags.length) removeTag(tags[tags.length-1]);
});
document.getElementById('tags-container').addEventListener('click', ()=>tagInput.focus());

// ── Keyword autocomplete ──────────────────────────────────────────────────
const kwInput    = document.getElementById('kw-input');
const kwDropdown = document.getElementById('kw-dropdown');
let kwFocusedIdx = -1, kwDebounce = null;
function addKeyword(kw) { if(selectedKeywords.find(k=>k.id===kw.id)) return; selectedKeywords.push(kw); renderKeywords(); kwInput.value=''; kwDropdown.classList.remove('open'); kwDropdown.innerHTML=''; }
function removeKeyword(id) { selectedKeywords=selectedKeywords.filter(k=>k.id!==id); renderKeywords(); }
function renderKeywords() {
  document.getElementById('kw-container').querySelectorAll('.kw-pill').forEach(e=>e.remove());
  selectedKeywords.forEach(kw => {
    const p=document.createElement('div'); p.className='kw-pill';
    p.innerHTML='\ud83c\udff7 '+esc(kw.name)+'<button class="kw-pill-x">\u00d7</button>';
    p.querySelector('.kw-pill-x').addEventListener('click',()=>removeKeyword(kw.id));
    document.getElementById('kw-container').insertBefore(p,kwInput);
  });
}
kwInput.addEventListener('input', () => {
  clearTimeout(kwDebounce); const q=kwInput.value.trim();
  if(!q){kwDropdown.classList.remove('open');kwDropdown.innerHTML='';return;}
  kwDebounce=setTimeout(()=>fetchKeywordSuggestions(q),280);
});
kwInput.addEventListener('keydown', e => {
  const opts=kwDropdown.querySelectorAll('.kw-option');
  if(e.key==='ArrowDown'){e.preventDefault();kwFocusedIdx=Math.min(kwFocusedIdx+1,opts.length-1);highlightKwOpt(opts);}
  else if(e.key==='ArrowUp'){e.preventDefault();kwFocusedIdx=Math.max(kwFocusedIdx-1,0);highlightKwOpt(opts);}
  else if(e.key==='Enter'){e.preventDefault();if(kwFocusedIdx>=0&&opts[kwFocusedIdx])opts[kwFocusedIdx].click();else if(opts.length===1)opts[0].click();else search(1);}
  else if(e.key==='Escape'){kwDropdown.classList.remove('open');kwFocusedIdx=-1;}
  else if(e.key==='Backspace'&&kwInput.value===''&&selectedKeywords.length)removeKeyword(selectedKeywords[selectedKeywords.length-1].id);
});
function highlightKwOpt(opts){opts.forEach((o,i)=>o.classList.toggle('focused',i===kwFocusedIdx));if(opts[kwFocusedIdx])opts[kwFocusedIdx].scrollIntoView({block:'nearest'});}
document.getElementById('kw-container').addEventListener('click',()=>kwInput.focus());
document.addEventListener('click',e=>{if(!e.target.closest('.kw-autocomplete')){kwDropdown.classList.remove('open');kwFocusedIdx=-1;}});
async function fetchKeywordSuggestions(q) {
  if (!API_KEY) return;
  kwDropdown.innerHTML='<div class="kw-spinner">Mencari keyword...</div>'; kwDropdown.classList.add('open'); kwFocusedIdx=-1;
  try {
    const r=await fetch(TMDB+'/search/keyword?api_key='+API_KEY+'&query='+encodeURIComponent(q)+'&page=1');
    if (!r.ok) throw new Error();
    const d=await r.json(); const results=(d.results||[]).slice(0,10);
    if (!results.length){kwDropdown.innerHTML='<div class="kw-spinner">Tidak ada keyword ditemukan.</div>';return;}
    kwDropdown.innerHTML='';
    results.forEach(kw=>{
      const div=document.createElement('div'); div.className='kw-option';
      div.innerHTML='<span class="kw-option-name">'+esc(kw.name)+'</span><span class="kw-option-count">ID:'+kw.id+'</span>';
      div.addEventListener('click',()=>{addKeyword({id:kw.id,name:kw.name});kwFocusedIdx=-1;});
      kwDropdown.appendChild(div);
    });
  } catch { kwDropdown.innerHTML='<div class="kw-spinner">Gagal memuat keyword.</div>'; }
}

// ── Sort ──────────────────────────────────────────────────────────────────
document.getElementById('sort-chips').addEventListener('click', e => {
  const c=e.target.closest('.sort-chip'); if(!c) return;
  document.querySelectorAll('.sort-chip').forEach(b=>b.classList.remove('active'));
  c.classList.add('active'); currentSort=c.dataset.sort;
});

// ── Search ────────────────────────────────────────────────────────────────
async function search(page=1) {
  if (!API_KEY) { showModal(); return; }
  if (isLoading) return;
  isLoading=true; currentPage=page;
  const btn=document.getElementById('search-btn'); btn.disabled=true;
  setStatus(page===1?'Mencari...':'Memuat lebih...');
  document.getElementById('spinner').classList.add('on');
  if (page===1) {
    document.getElementById('results').innerHTML='';
    tmdbDetailCache=new Map();
    _pendingChecks.length=0; _activeChecks=0;
    _dbg.reset(); _dbg.log('Mode: '+currentMode);
  }
  try {
    const type    = document.getElementById('f-type').value;
    const genre   = document.getElementById('f-genre').value;
    const country = document.getElementById('f-country').value;
    const year    = document.getElementById('f-year').value;
    const rmin    = parseFloat(document.getElementById('f-rating').value)||0;
    let items=[], total=0;

    if (currentMode==='title') {
      const rawInput=(document.getElementById('tag-input').value||'').trim();
      const titleQuery=(document.getElementById('f-title').value||'').trim()||[...tags,rawInput].filter(Boolean).join(' ').trim();
      if (!titleQuery){setStatus('\u26a0 Masukkan judul.');isLoading=false;btn.disabled=false;document.getElementById('spinner').classList.remove('on');return;}
      setStatus('Mencari "'+titleQuery+'"...');
      const url=TMDB+'/search/'+type+'?api_key='+API_KEY+'&query='+encodeURIComponent(titleQuery)+'&page='+page+'&include_adult=false';
      const res=await fetch(url); if(!res.ok) throw new Error('HTTP '+res.status);
      const data=await res.json(); totalPages=data.total_pages||1; total=data.total_results||0;
      if (total===0&&page===1) {
        const fb=await fetch(TMDB+'/search/multi?api_key='+API_KEY+'&query='+encodeURIComponent(titleQuery)+'&page=1&include_adult=false');
        if (fb.ok) { const fbd=await fb.json(); totalPages=fbd.total_pages||1; total=fbd.total_results||0; items=(fbd.results||[]).filter(i=>i.media_type==='tv'||i.media_type==='movie'); if(items.length){setStatus(total.toLocaleString('id')+' hasil (multi-search)');renderCards(items,type);renderLoadMore();return;} }
      }
      items=(data.results||[]).filter(item=>{
        if(genre&&!(item.genre_ids||[]).includes(parseInt(genre))) return false;
        if(country&&!(item.origin_country||[]).includes(country)) return false;
        if(year){const iy=(item.first_air_date||item.release_date||'').substring(0,4);if(iy!==year) return false;}
        if(rmin>0&&(item.vote_average||0)<rmin) return false;
        return true;
      });
      setStatus(total.toLocaleString('id')+' hasil untuk "'+titleQuery+'"');

    } else if (currentMode==='keyword') {
      if (!selectedKeywords.length){setStatus('\u26a0 Pilih minimal satu keyword.');isLoading=false;btn.disabled=false;document.getElementById('spinner').classList.remove('on');return;}
      const kwIds=selectedKeywords.map(k=>k.id).join(',');
      const kwNames=selectedKeywords.map(k=>k.name).join(', ');
      async function fetchAllPages(url,maxPg=500) {
        _dbg.url(url+'&page=1');
        const r1=await fetch(url+'&page=1'); if(!r1.ok) throw new Error('HTTP '+r1.status);
        const d1=await r1.json(); if(d1.success===false) throw new Error(d1.status_message||'API Error');
        const pg=Math.min(d1.total_pages||1,maxPg); let all=d1.results||[];
        if (pg>1) {
          for (let start=2;start<=pg;start+=10) {
            const batch=[];
            for (let p=start;p<=Math.min(start+9,pg);p++) batch.push(fetch(url+'&page='+p).then(r=>r.json()).catch(()=>null));
            const results=await Promise.all(batch);
            results.forEach(d=>{if(d&&Array.isArray(d.results))all=all.concat(d.results);});
            setStatus('Memuat... '+all.length+' item (hal.'+Math.min(start+9,pg)+'/'+pg+')');
          }
        }
        return all;
      }
      setStatus('Mencari...');
      const seen=new Set(); items=[];
      let discoverUrl=TMDB+'/discover/'+type+'?api_key='+API_KEY+'&sort_by='+currentSort+'&include_adult=false&with_keywords='+kwIds;
      if (genre) discoverUrl+='&with_genres='+genre;
      if (country) discoverUrl+='&with_origin_country='+country;
      const allItems=await fetchAllPages(discoverUrl);
      allItems.forEach(item=>{if(seen.has(item.id))return;seen.add(item.id);items.push(item);});
      if (year) items=items.filter(item=>{const d=item.first_air_date||item.release_date||'';if(!d)return true;return d.substring(0,4)===year;});
      if (rmin>0) items=items.filter(item=>(item.vote_count||0)===0||(item.vote_average||0)>=rmin);
      if (currentSort==='popularity.desc') items.sort((a,b)=>(b.popularity||0)-(a.popularity||0));
      else if (currentSort==='vote_average.desc') items.sort((a,b)=>(b.vote_average||0)-(a.vote_average||0));
      else if (currentSort==='first_air_date.desc') items.sort((a,b)=>(b.first_air_date||'').localeCompare(a.first_air_date||''));
      else if (currentSort==='first_air_date.asc') items.sort((a,b)=>(a.first_air_date||'').localeCompare(b.first_air_date||''));
      else if (currentSort==='vote_count.desc') items.sort((a,b)=>(b.vote_count||0)-(a.vote_count||0));
      totalPages=1; total=items.length;
      setStatus(total.toLocaleString('id')+' hasil \u00b7 keyword: '+kwNames);
      _dbg.done(total);

    } else {
      const rawInput=(document.getElementById('tag-input').value||'').trim();
      const query=[...tags,rawInput].filter(Boolean).join(' ').trim();
      if (query) {
        setStatus('Mencari "'+query+'"...');
        const url=TMDB+'/search/'+type+'?api_key='+API_KEY+'&query='+encodeURIComponent(query)+'&page='+page+'&include_adult=false';
        const res=await fetch(url); if(!res.ok) throw new Error('HTTP '+res.status);
        const data=await res.json(); totalPages=data.total_pages||1; total=data.total_results||0;
        if (total===0&&page===1) {
          const fb=await fetch(TMDB+'/search/multi?api_key='+API_KEY+'&query='+encodeURIComponent(query)+'&page=1&include_adult=false');
          if (fb.ok){const fbd=await fb.json();totalPages=fbd.total_pages||1;total=fbd.total_results||0;items=(fbd.results||[]).filter(i=>i.media_type==='tv'||i.media_type==='movie');if(items.length){setStatus(total.toLocaleString('id')+' hasil (multi-search)');renderCards(items,type);renderLoadMore();return;}}
        }
        items=(data.results||[]).filter(item=>{
          if(genre&&!(item.genre_ids||[]).includes(parseInt(genre))) return false;
          if(country&&!(item.origin_country||[]).includes(country)) return false;
          if(year){const iy=(item.first_air_date||item.release_date||'').substring(0,4);if(iy!==year) return false;}
          if(rmin>0&&(item.vote_average||0)<rmin) return false;
          return true;
        });
        setStatus(total.toLocaleString('id')+' hasil untuk "'+query+'"');
      } else {
        let url=TMDB+'/discover/'+type+'?api_key='+API_KEY+'&sort_by='+currentSort+'&page='+page+'&language=en-US&include_adult=false';
        if(genre) url+='&with_genres='+genre;
        if(country) url+='&with_origin_country='+country;
        if(year) url+=(type==='tv'?'&first_air_date_year=':'&primary_release_year=')+year;
        if(rmin>0) url+='&vote_average.gte='+rmin+'&vote_count.gte=50';
        const res=await fetch(url); if(!res.ok) throw new Error('HTTP '+res.status+' \u2014 Cek API Key');
        const data=await res.json(); if(data.success===false) throw new Error(data.status_message||'API Error');
        totalPages=data.total_pages||1; total=data.total_results||0; items=data.results||[];
      }
    }

    if (!items.length){if(page===1) showEmpty();setStatus('Tidak ada hasil.');}
    else { renderCards(items,type); renderLoadMore(); }
  } catch(e) {
    setStatus('\u26a0 '+(e.message||'Gagal memuat.'));
    toast('Error: '+(e.message||'Cek API Key.'),'error');
    if (page===1&&!document.getElementById('results').children.length) showEmpty();
  } finally {
    isLoading=false; btn.disabled=false; document.getElementById('spinner').classList.remove('on');
  }
}
document.getElementById('search-btn').addEventListener('click',()=>search(1));
document.getElementById('f-title').addEventListener('keydown',e=>{if(e.key==='Enter')search(1);});

// ── Cards ─────────────────────────────────────────────────────────────────
function renderCards(items, type) {
  const grid = document.getElementById('results');
  const ex = grid.querySelector('.load-more-wrap'); if(ex) ex.remove();

  items.forEach((item, i) => {
    const title   = item.name || item.title || 'Unknown';
    const enTitle = item.name || item.title || '';
    const year    = (item.first_air_date||item.release_date||'').substring(0,4);
    const rating  = item.vote_average ? item.vote_average.toFixed(1) : '\u2014';
    const poster  = item.poster_path ? IMG_W+item.poster_path : null;
    const id      = item.id;
    const mt      = item.media_type || type;

    const card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = (i%20*30)+'ms';
    card.dataset.tmdbId   = id;
    card.dataset.tmdbYear = year;
    card.dataset.tmdbType = mt;
    card.setAttribute('data-tmdb-id', id);

    const _rd=item.first_air_date||item.release_date||'';
    const _st=(item.status||'').toLowerCase();
    const _now=new Date(); const _curYear=_now.getFullYear(); const _itemYear=parseInt(year,10)||0;
    const _today=new Date(_now.getFullYear(),_now.getMonth(),_now.getDate());
    const _rdDate=_rd?new Date(_rd+'T00:00:00'):null;
    const _rdFuture=!!(_rdDate&&_rdDate>=_today);
    const _yearFuture=_itemYear>_curYear;
    const _yearCurrNoDate=_itemYear===_curYear&&!_rd&&(item.vote_count||0)===0;
    const _statusUp=['planned','announced','in production','returning series'].includes(_st);
    const _isUp=_rdFuture||_yearFuture||_yearCurrNoDate||_statusUp;
    let _upLabel='';
    if (_isUp&&_rd){const _d=new Date(_rd);_upLabel='\u23f3 '+_d.getDate().toString().padStart(2,'0')+'/'+(_d.getMonth()+1).toString().padStart(2,'0')+'/'+_d.getFullYear();}
    else if (_isUp&&_itemYear){_upLabel='\u23f3 '+_itemYear;}
    else if (_isUp){_upLabel='\u23f3 Upcoming';}

    // Badge dari plugin — posisi top dihitung dari index registrasi
    const badgeHtml = _pluginBadges.map((b, idx) => {
      const top = 7 + idx * 19;
      return '<span class="plugin-badge checking" id="pb-'+b.id+'-'+id+'" style="top:'+top+'px;background:#00000066">\u2022 '+esc(b.label)+'</span>';
    }).join('');

    // Tombol overlay dari plugin (scope 'card' atau 'both')
    const cardActionHtml = _pluginActions
      .filter(a => a.scope === 'card' || a.scope === 'both')
      .map(a => '<button class="overlay-btn '+esc(a.cssClass||'')+'" data-plugin-action="'+esc(a.id)+'" style="display:none">'+esc(a.label)+'</button>')
      .join('');

    card.innerHTML =
      '<div class="card-poster-wrap">' +
        (poster?'<img class="card-poster" src="'+esc(poster)+'" alt="'+esc(title)+'" loading="lazy">':'<div class="card-no-poster">\ud83c\udfac</div>') +
        badgeHtml +
        '<span class="type-badge">'+(mt==='tv'?'SERIAL':'FILM')+'</span>' +
        '<div class="card-rating-strip">\u2605 '+rating+'</div>' +
        '<div class="card-overlay">' +
          '<button class="overlay-btn" data-action="detail">Detail</button>' +
          cardActionHtml +
        '</div>' +
      '</div>' +
      '<div class="card-info">' +
        '<div class="card-title">'+esc(title)+'</div>' +
        (_isUp?'<span class="upcoming-badge" id="upb-'+id+'">'+esc(_upLabel)+'</span>':'') +
        '<span class="status-badge" id="stb-'+id+'" style="display:none"></span>' +
        '<div class="card-meta"><span class="card-meta-year">'+esc(year)+'</span><span>'+(item.vote_count||0)+' votes</span></div>' +
      '</div>';

    card.addEventListener('click', e => {
      const b = e.target.closest('[data-action],[data-plugin-action]');
      if (!b) { openDetail(item, mt); return; }
      if (b.dataset.action === 'detail') { openDetail(item, mt); return; }
      // Plugin action
      if (b.dataset.pluginAction) {
        const action = _pluginActions.find(a => a.id === b.dataset.pluginAction);
        if (action && action.onCard) action.onCard(id, mt, enTitle, year);
        return;
      }
    });

    grid.appendChild(card);
    _pendingChecks.push({ title: enTitle, id, mt, item, isUpcoming: _isUp });
    if (mt !== 'movie' && !_isUp && !tmdbDetailCache.has(id)) fetchTmdbStatus(id, mt);
  });

  _flushPendingChecks();
}

// ── Pending checks via Plugin registry ───────────────────────────────────
const _pendingChecks = [];
let _activeChecks = 0;
const MAX_CONCURRENT = 5;

function _flushPendingChecks() {
  while (_pendingChecks.length > 0 && _activeChecks < MAX_CONCURRENT) {
    const { title, id, mt, item, isUpcoming } = _pendingChecks.shift();
    _activeChecks++;
    // Jalankan semua checkFn yang terdaftar via registerBadge
    const checks = _pluginBadges.map(b => _runBadgeCheck(b, id, mt, title, item, isUpcoming));
    Promise.all(checks).finally(() => {
      _activeChecks--;
      _flushPendingChecks();
    });
  }
}

async function _runBadgeCheck(badgeDef, tmdbId, type, title, item, isUpcoming) {
  const badgeEl = document.getElementById('pb-'+badgeDef.id+'-'+tmdbId);
  if (!badgeEl) return;
  try {
    const result = await badgeDef.checkFn(tmdbId, type, title,
      (item.first_air_date||item.release_date||'').substring(0,4), item, isUpcoming);
    if (result === true || (Array.isArray(result) && result.length)) {
      badgeEl.textContent = '\u2713 '+badgeDef.label+(Array.isArray(result)&&result.length>1?' ('+result.length+')':'');
      badgeEl.className   = 'plugin-badge found';
      badgeEl.style.background = badgeDef.foundColor || '#059669cc';
      // Tampilkan tombol overlay yang terkait plugin ini
      const card = document.querySelector('[data-tmdb-id="'+tmdbId+'"]');
      if (card) {
        _pluginActions.filter(a=>a.pluginId===badgeDef.pluginId&&(a.scope==='card'||a.scope==='both')).forEach(a=>{
          const btn = card.querySelector('[data-plugin-action="'+a.id+'"]');
          if (btn) btn.style.display='';
        });
      }
    } else if (result === false) {
      badgeEl.textContent = '\u2717';
      badgeEl.className   = 'plugin-badge missing';
    } else {
      // null = tidak diketahui / sembunyikan
      badgeEl.style.display = 'none';
    }
  } catch(e) {
    badgeEl.style.display = 'none';
  }
}

// ── Status badge ──────────────────────────────────────────────────────────
function updateStatusBadge(id, status, eps, seasons) {
  const b = document.getElementById('stb-'+id); if (!b) return;
  if (!eps || eps < 2) return;
  const st=(status||'').toLowerCase(); let cls='',icon='',label='';
  if(['returning series','in production'].includes(st)){cls='ongoing';icon='\u25cf';label='ON AIR';}
  else if(st==='ended'){cls='ended';icon='\u2713';label='TAMAT';}
  else if(['canceled','cancelled'].includes(st)){cls='canceled';icon='\u2715';label='DIBATALKAN';}
  else return;
  const epLabel=eps?' \u00b7 '+eps+' ep'+(seasons>1?' / '+seasons+' season':''):'';
  b.className='status-badge '+cls; b.textContent=icon+' '+label+epLabel; b.style.display='inline-flex';
}
const _statusFetchQueue=[]; let _statusFetching=0; const MAX_STATUS_CONCURRENT=3;
async function fetchTmdbStatus(id,type) {
  if(tmdbDetailCache.has(id)){const d=tmdbDetailCache.get(id);updateStatusBadge(id,d.status,d.number_of_episodes,d.number_of_seasons);return;}
  _statusFetchQueue.push({id,type}); _flushStatusQueue();
}
function _flushStatusQueue(){while(_statusFetchQueue.length>0&&_statusFetching<MAX_STATUS_CONCURRENT){const{id,type}=_statusFetchQueue.shift();_statusFetching++;_doFetchStatus(id,type).finally(()=>{_statusFetching--;_flushStatusQueue();});}}
async function _doFetchStatus(id,type){
  try{const r=await fetch(TMDB+'/'+type+'/'+id+'?api_key='+API_KEY+'&language=en-US');if(!r.ok)return;const d=await r.json();let epsFromSeasons=0;if(Array.isArray(d.seasons))d.seasons.forEach(s=>{if(s.season_number>0)epsFromSeasons+=(s.episode_count||0);});const totalEps=Math.max(d.number_of_episodes||0,epsFromSeasons);const info={status:d.status||'',number_of_episodes:totalEps,number_of_seasons:d.number_of_seasons||1};tmdbDetailCache.set(id,info);updateStatusBadge(id,info.status,info.number_of_episodes,info.number_of_seasons);}catch{}
}

// ── Detail panel ──────────────────────────────────────────────────────────
async function openDetail(item, type) {
  const title  = item.name || item.title;
  const year   = (item.first_air_date||item.release_date||'').substring(0,4);
  const poster = item.poster_path ? IMG_L+item.poster_path : null;
  const rating = item.vote_average ? item.vote_average.toFixed(1) : '\u2014';
  const genres = (item.genre_ids||[]).map(id=>genreMap[id]||'').filter(Boolean);
  let overview='', tagline='', status='', epsTotal=null, epsSeasons=1;
  let englishTitle = item.name || item.title || '';

  try {
    const r=await fetch(TMDB+'/'+type+'/'+item.id+'?api_key='+API_KEY+'&language=en-US');
    if (r.ok) {
      const full=await r.json();
      overview=full.overview||overview; tagline=full.tagline||''; status=full.status||'';
      let _epsFromSeasons=0;
      if(Array.isArray(full.seasons)) full.seasons.forEach(s=>{if(s.season_number>0)_epsFromSeasons+=(s.episode_count||0);});
      epsTotal=Math.max(full.number_of_episodes||0,_epsFromSeasons)||null;
      epsSeasons=full.number_of_seasons||1;
      englishTitle=full.name||full.title||full.original_name||full.original_title||englishTitle;
    }
  } catch(e) {}

  // Kumpulkan badge detail dari plugin (cek apakah tersedia)
  const pluginDetailBadges = _pluginBadges.map(b => {
    const cached = window._pluginAPI && window._pluginAPI.cache && window._pluginAPI.cache[b.pluginId+'_'+item.id];
    if (!cached && cached !== false) return ''; // belum dicek
    return cached ? '<span class="detail-badge" style="border-color:'+esc(b.foundColor||'#059669')+';color:'+esc(b.foundColor||'#059669')+'">\u2713 '+esc(b.label)+'</span>' : '';
  }).join('');

  document.getElementById('detail-hero').innerHTML =
    (poster?'<img class="detail-poster" src="'+esc(poster)+'" alt="'+esc(title)+'">':'<div class="detail-poster-ph">\ud83c\udfac</div>') +
    '<button class="detail-close" id="detail-close">\u2715</button>' +
    '<div class="detail-info">' +
      '<div class="detail-title">'+esc(title)+'</div>' +
      (tagline?'<div class="detail-tagline">"'+esc(tagline)+'"</div>':'') +
      '<div class="detail-badges">' +
        (year?'<span class="detail-badge accent">'+esc(year)+'</span>':'') +
        (status?(()=>{const st=status.toLowerCase();let stCls='success',stIcon='';if(['returning series','in production'].includes(st)){stCls='success';stIcon='\u25cf ';}else if(st==='ended'){stCls='';stIcon='\u2713 ';}else if(['canceled','cancelled'].includes(st)){stCls='accent';stIcon='\u2715 ';}return '<span class="detail-badge '+stCls+'">'+stIcon+esc(status)+'</span>';})():'') +
        (epsTotal?'<span class="detail-badge">'+epsTotal+' Ep'+(epsSeasons>1?' / '+epsSeasons+' Season':'')+'</span>':'') +
        pluginDetailBadges +
      '</div>' +
      '<div class="detail-rating-row"><span style="color:var(--warning)">\u2605</span><span class="detail-score">'+rating+'</span><span class="detail-votes">/ 10 \u00b7 '+(item.vote_count||0).toLocaleString('id')+' votes</span></div>' +
      (overview?'<div class="detail-overview">'+esc(overview)+'</div>':'') +
      (genres.length?'<div class="detail-genres">'+genres.map(g=>'<span class="detail-genre-chip">'+esc(g)+'</span>').join('')+'</div>':'') +
    '</div>';

  document.getElementById('detail-close').addEventListener('click', closeDetail);

  const notAired = ['Planned','In Production','Announced','Canceled','Cancelled'].includes(status);
  const extra    = document.getElementById('detail-extra');
  extra.innerHTML = '';

  // Tombol dari plugin (scope 'detail' atau 'both')
  const detailActions = _pluginActions.filter(a => a.scope==='detail' || a.scope==='both');
  const kkDisabled = notAired ? ' disabled title="Status: '+status+' \u2014 belum tersedia"' : '';

  let actionsHtml = '';
  if (detailActions.length) {
    // Group tiap 3 tombol per row
    for (let i=0; i<detailActions.length; i+=3) {
      const row = detailActions.slice(i, i+3);
      actionsHtml += '<div class="action-row">' +
        row.map(a => {
          const disabled = notAired && a.respectStatus ? kkDisabled : '';
          return '<button class="action-btn '+esc(a.cssClass||'')+'" data-detail-action="'+esc(a.id)+'"'+disabled+'>'+esc(a.label)+'</button>';
        }).join('') +
        '</div>';
    }
  }
  actionsHtml += '<div id="plugin-status" style="font-size:12px;color:var(--muted);text-align:center;min-height:18px"></div>';

  document.getElementById('detail-actions').innerHTML = actionsHtml;

  // Bind click events untuk tombol plugin
  detailActions.forEach(a => {
    const btn = document.querySelector('[data-detail-action="'+a.id+'"]');
    if (btn && a.onDetail) {
      btn.addEventListener('click', () => {
        if (notAired && a.respectStatus) return;
        a.onDetail(item.id, type, englishTitle, year, item, extra);
      });
    }
  });

  // Jalankan renderFn dari plugin detail sections
  _pluginDetailSec.forEach(s => {
    try {
      const el = s.renderFn(item, type, extra);
      if (el) extra.appendChild(typeof el === 'string' ? Object.assign(document.createElement('div'),{innerHTML:el}) : el);
    } catch(e) {}
  });

  document.getElementById('detail-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('active');
  document.body.style.overflow='';
}
document.getElementById('detail-overlay').addEventListener('click', e => {
  if (e.target===document.getElementById('detail-overlay')) closeDetail();
});
document.addEventListener('keydown', e => { if(e.key==='Escape') closeDetail(); });

// ── Load More ─────────────────────────────────────────────────────────────
function renderLoadMore() {
  if (currentPage>=totalPages) return;
  const grid=document.getElementById('results');
  const wrap=document.createElement('div'); wrap.className='load-more-wrap';
  wrap.innerHTML='<button class="load-more-btn">Muat Lebih ('+(totalPages-currentPage)+' halaman lagi)</button>';
  wrap.querySelector('button').addEventListener('click',()=>{wrap.remove();search(currentPage+1);});
  grid.appendChild(wrap);
}

// ── Modal API Key ─────────────────────────────────────────────────────────
document.getElementById('api-key-btn').addEventListener('click', showModal);
document.getElementById('modal-cancel').addEventListener('click', hideModal);
document.getElementById('modal-save').addEventListener('click', () => {
  const k=document.getElementById('modal-key-input').value.trim();
  if(k.length>10){API_KEY=k;localStorage.setItem('kh_tmdb_key',k);hideModal();document.getElementById('no-key-banner').style.display='none';toast('\u2713 API Key tersimpan!','success');loadGenres().catch(()=>{});buildGenreMap().catch(()=>{});setStatus('Siap.');}
  else{toast('\u26a0 API Key tidak valid','error');}
});
document.getElementById('modal-key-input').addEventListener('keydown', e=>{if(e.key==='Enter') document.getElementById('modal-save').click();});

// ── Plugin Manager UI ─────────────────────────────────────────────────────
document.getElementById('plugin-mgr-btn').addEventListener('click', _pmOpen);
document.getElementById('pm-close').addEventListener('click', _pmClose);
document.getElementById('pm-overlay').addEventListener('click', function(e){if(e.target===document.getElementById('pm-overlay'))_pmClose();});
document.getElementById('pm-add-btn').addEventListener('click', _pmAdd);
document.querySelectorAll('.pm-method-tab').forEach(function(tab){
  tab.addEventListener('click', function(){
    _pmCurrentMethod=tab.dataset.pmMethod;
    document.querySelectorAll('.pm-method-tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('pm-input-url').style.display  = _pmCurrentMethod==='url'  ? '' : 'none';
    document.getElementById('pm-input-code').style.display = _pmCurrentMethod==='code' ? '' : 'none';
  });
});

// ── Start ─────────────────────────────────────────────────────────────────
(window.opener||window.parent||window).postMessage({type:'explorer_ready'},'*');
_pmLoadRegistry();
init();

}); // end DOMContentLoaded
<\/script>
</body>
</html>
`.replace('__TMDB_KEY_PLACEHOLDER__', apiKey||'').replace('__HITV_DID_PLACEHOLDER__', hitvDid||'').replace('// __PM_ENGINE_PLACEHOLDER__', _PM_ENGINE_CODE);
    }

})();
