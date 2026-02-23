// ==UserScript==
// @name         Cinestream Plugin
// @namespace    https://kisskh.co/
// @version      1.0.1
// @description  Plugin Cinestream untuk KissKH & HiTV Explorer. Install bersama skrip Core.
// @author       UserScript
// @match        https://kisskh.co/*
// @match        https://kisskh.la/*
// @match        https://home.hitv.vip/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @run-at       document-idle
// ==/UserScript==

// ============================================================
// CARA INSTALL:
// Metode B: Isi CINE_PLUGIN_URL di Core dengan URL raw file ini dari GitHub
//           (pastikan nama file BUKAN .user.js agar tidak diintercept Tampermonkey)
// Metode C: Buka Plugin Manager di Explorer -> tab "Paste Kode" -> paste isi file ini
// ============================================================

(function() {
'use strict';

// ── Proxy fetch via BroadcastChannel ke Launcher ─────────────────────
// Gunakan addEventListener (bukan onmessage) agar tidak menimpa handler Core.
// Filter hanya id dengan prefix 'cine_' milik plugin ini.
var _cineReqMap = {};
var _cineReqId  = 0;

function _cineHandleProxyRes(data) {
  if (!data || data.type !== 'proxy_res') return;
  if (typeof data.id !== 'string' || data.id.indexOf('cine_') !== 0) return;
  var cb = _cineReqMap[data.id];
  if (!cb) return;
  delete _cineReqMap[data.id];
  cb(data);
}

// BroadcastChannel sudah diinisialisasi Core sebelum plugin dimuat.
// addEventListener aman dipakai paralel dengan onmessage Core.
if (window._khBlobChannel) {
  window._khBlobChannel.addEventListener('message', function(e) {
    _cineHandleProxyRes(e.data);
  });
} else {
  // Fallback jika karena urutan timing channel belum ada
  setTimeout(function() {
    if (window._khBlobChannel) {
      window._khBlobChannel.addEventListener('message', function(e) {
        _cineHandleProxyRes(e.data);
      });
    }
  }, 500);
}
// Fallback sekunder: window.opener path
window.addEventListener('message', function(e) {
  _cineHandleProxyRes(e.data);
});

function launcherFetch(url, params, headers, method, body, bodyType) {
  return new Promise(function(resolve, reject) {
    var id = 'cine_' + (++_cineReqId);
    _cineReqMap[id] = function(data) {
      if (data.error) reject(new Error(data.error));
      else resolve(data);
    };
    var ch = window._khBlobChannel;
    if (!ch) {
      delete _cineReqMap[id];
      reject(new Error('[Cine] _khBlobChannel tidak tersedia'));
      return;
    }
    // BroadcastChannel.postMessage TIDAK menerima argumen targetOrigin kedua
    ch.postMessage({
      type: 'proxy_req', id: id,
      url: url, params: params || null,
      headers: headers || null,
      method: method || 'GET',
      body: body || null,
      bodyType: bodyType || null
    });
    setTimeout(function() {
      if (_cineReqMap[id]) { delete _cineReqMap[id]; reject(new Error('timeout')); }
    }, 30000);
  });
}

// ── Helper DOM & API key ───────────────────────────────────
function updateCineBadge(id, available) {
  var b = document.getElementById('cineb-' + id);
  if (!b) return;
  b.style.display = '';
  if (available) { b.textContent = '\u2713 Cine'; b.className = 'cine-badge found'; }
  else { b.textContent = '\u2717 Cine'; b.className = 'cine-badge missing'; }
}

// API_KEY dan TMDB dibaca dari scope global — diset oleh Core di blob page
// Fallback ke localStorage jika belum ada (misal saat debug)
if (typeof API_KEY === 'undefined') var API_KEY = localStorage.getItem('kh_tmdb_key') || '';
var TMDB = 'https://api.themoviedb.org/3';

// ── _dbg passthrough ─────────────────────────────────────────
var _dbg = (typeof window._dbg !== 'undefined') ? window._dbg : {
  log: function(msg, t) { console.log('[Cine]', msg); },
  url: function(u) {}, stat: function(k, v) {}
};

// ── HTML escape (tidak tersedia dari Core di scope plugin) ────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Entry points untuk Core ───────────────────────────────────
window._cineGoTo = function(tmdbId, type, season, episode, sourceKey) {
  window.open(cineUrl(tmdbId, type, season, episode, sourceKey || 'superembed'), '_blank');
};

window._cineWatch = function(tmdbId, type, imdbId) {
  if (type === 'movie') {
    showCineStreams(tmdbId, type, null, null, imdbId || null);
  } else {
    loadCineEpisodes(tmdbId, type, imdbId || null);
  }
};

// \u2500\u2500 CINESTREAM MULTI-SOURCE v9 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Implementasi lengkap semua source dari CineStreamExtractors.kt

var ENC_DEC_API    = 'https://enc-dec.app/api';
var VIDSRC_MAIN    = 'https://api.rgshows.ru';
var VIDSRC_HINDI   = 'https://hindi.rgshows.ru';
var VIDLINK_API    = 'https://vidlink.pro';
var VIDZEE_API     = 'https://player.vidzee.wtf';
var MULTIEMBED_API = 'https://multiembed.mov';
var XPASS_API      = 'https://play.xpass.top';
var MADPLAY_CDN    = 'https://cdn.madplay.site';
var MADPLAY_SITE   = 'https://madplay.site';
var HEXA_API       = 'https://themoviedb.hexa.su';
var MAPPLE_API     = 'https://mapple.uk';
var PRIMESRC_API   = 'https://primesrc.me';
var TWOEMBEDAPI    = 'https://www.2embed.cc';
var CINEMACITY_API = 'https://cinemacity.cc';
var WYZIE_API      = 'https://sub.wyzie.ru';
var OPENSUB_API    = 'https://opensubtitles.stremio.homes/en|hi|de|ar|tr|es|ta|te|ru|ko/ai-translated=true|from=all|auto-adjustment=true';

// \u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function hexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < hex.length; i += 2) out[i/2] = parseInt(hex.substr(i, 2), 16);
  return out;
}
function b64ToBytes(b64) {
  var s = atob(b64.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(s, function(c){ return c.charCodeAt(0); });
}
async function aesCbcDecrypt(keyBytes, ivBytes, ctBytes) {
  var k = await crypto.subtle.importKey('raw', keyBytes, {name:'AES-CBC'}, false, ['decrypt']);
  var dec = await crypto.subtle.decrypt({name:'AES-CBC', iv:ivBytes}, k, ctBytes);
  return new TextDecoder().decode(dec);
}

// \u2500\u2500 Proxy fetch helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function pFetch(url, opts) {
  opts = opts || {};
  var r = await launcherFetch(url, opts.params, opts.headers, opts.method, opts.body, opts.bodyType);
  return r.body;
}
async function pJSON(url, opts) {
  var t = await pFetch(url, opts);
  return JSON.parse(t);
}

// \u2500\u2500 Source list \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
var CINE_SOURCES = [
  { key:'vidsrc',    label:'VidSrc'    },
  { key:'vidzee',   label:'Vidzee'    },
  { key:'vidlink',  label:'VidLink'   },
  { key:'hexa',     label:'Hexa'      },
  { key:'mapple',   label:'Mapple'    },
  { key:'xpass',    label:'Xpass'     },
  { key:'madplay',  label:'Madplay'   },
  { key:'superembed',label:'SuperEmbed'},
  { key:'2embed',   label:'2Embed'    },
  { key:'primesrc', label:'PrimeSrc'  },
  { key:'cinemacity',label:'CineCity' },
];

function cineUrl(tmdbId, type, season, episode, sourceKey) {
  var s = season, e = episode || 1;
  switch (sourceKey) {
    case '2embed':
      return s ? TWOEMBEDAPI + '/embedtv/' + tmdbId + '&s=' + s + '&e=' + e : TWOEMBEDAPI + '/embed/' + tmdbId;
    case 'vidlink':
      return s ? VIDLINK_API + '/tv/' + tmdbId + '/' + s + '/' + e : VIDLINK_API + '/movie/' + tmdbId;
    case 'vidzee':
      return s ? VIDZEE_API + '/tv/' + tmdbId + '/' + s + '/' + e : VIDZEE_API + '/movie/' + tmdbId;
    default:
      return s ? MULTIEMBED_API + '/?video_id=' + tmdbId + '&tmdb=1&s=' + s + '&e=' + e : MULTIEMBED_API + '/?video_id=' + tmdbId + '&tmdb=1';
  }
}


// \u2500\u2500 FETCHERS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

// 1. VidSrc \u2014 Main + Hindi multi-lang + Premium embeds
async function fetchVidSrc(tmdbId, type, season, episode) {
  var movie = type === 'movie';
  var hdrs = { 'Origin':'https://www.vidsrc.wtf', 'Referer':'https://www.vidsrc.wtf' };
  var out = [];
  try {
    var url = movie ? VIDSRC_MAIN+'/main/movie/'+tmdbId : VIDSRC_MAIN+'/main/tv/'+tmdbId+'/'+season+'/'+episode;
    var d = await pJSON(url, { headers: hdrs });
    if (d && d.stream && d.stream.url) out.push({ name:'VidSrc Main', url:d.stream.url, type:'m3u8', referer:'https://www.vidsrc.wtf' });
  } catch(e) {}
  try {
    var url2 = movie ? VIDSRC_HINDI+'/movie/'+tmdbId : VIDSRC_HINDI+'/tv/'+tmdbId+'/'+season+'/'+episode;
    var d2 = await pJSON(url2, { headers: hdrs });
    if (d2 && d2.streams) d2.streams.forEach(function(s) {
      if (s.url) out.push({ name:'VidSrc ['+s.language+']', url:s.url, type:'m3u8', referer:'https://www.vidsrc.wtf' });
    });
  } catch(e) {}
  try {
    var url3 = movie ? VIDSRC_MAIN+'/premium_embeds/movie/'+tmdbId : VIDSRC_MAIN+'/premium_embeds/tv/'+tmdbId+'/'+season+'/'+episode;
    var d3 = await pJSON(url3, { headers: hdrs });
    if (d3 && d3.links) d3.links.forEach(function(s) {
      if (s.url) out.push({ name:'VidSrc Embed', url:s.url, type:'iframe' });
    });
  } catch(e) {}
  return out;
}

// 2. Vidzee \u2014 AES-CBC decrypt dengan key hardcoded
async function fetchVidzee(tmdbId, type, season, episode) {
  var KEY_HEX = '6966796f75736372617065796f75617265676179000000000000000000000000';
  var keyBytes = hexToBytes(KEY_HEX);
  var movie = type === 'movie';
  var hdrs = { 'User-Agent':'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36' };
  var out = [];
  for (var i = 1; i <= 10; i++) {
    try {
      var url = movie
        ? VIDZEE_API+'/api/server?id='+tmdbId+'&sr='+i
        : VIDZEE_API+'/api/server?id='+tmdbId+'&sr='+i+'&ss='+season+'&ep='+episode;
      var d = await pJSON(url, { headers: hdrs });
      if (!d || !d.url || !d.url[0]) continue;
      var enc = d.url[0].link;
      var srvName = d.url[0].name;
      var decoded = atob(enc.replace(/-/g,'+').replace(/_/g,'/'));
      var parts = decoded.split(':');
      if (parts.length < 2) continue;
      var iv = b64ToBytes(parts[0]);
      var ct = b64ToBytes(parts[1]);
      var videoUrl = (await aesCbcDecrypt(keyBytes, iv, ct)).trim();
      if (videoUrl && videoUrl.indexOf('http') === 0) {
        out.push({ name:'Vidzee ['+srvName+']', url:videoUrl, type:'m3u8', referer:'https://player.vidzee.wtf/' });
      }
    } catch(e) { if (i > 4) break; }
  }
  return out;
}

// 3. VidLink \u2014 via enc-dec.app/enc-vidlink
async function fetchVidLink(tmdbId, type, season, episode) {
  try {
    var encRes = await pJSON(ENC_DEC_API+'/enc-vidlink?text='+tmdbId);
    var enc = encRes && encRes.result;
    if (!enc) return [];
    var hdrs = { 'Referer':VIDLINK_API+'/', 'Origin':VIDLINK_API+'/' };
    var url = type==='movie' ? VIDLINK_API+'/api/b/movie/'+enc : VIDLINK_API+'/api/b/tv/'+enc+'/'+season+'/'+episode;
    var d = await pJSON(url, { headers: hdrs });
    var m3u8 = d && d.stream && d.stream.playlist;
    if (!m3u8) return [];
    return [{ name:'VidLink', url:m3u8, type:'m3u8', referer:VIDLINK_API+'/' }];
  } catch(e) { return []; }
}

// 4. Hexa \u2014 random key + enc-dec.app/dec-hexa
async function fetchHexa(tmdbId, type, season, episode) {
  try {
    var keyArr = new Uint8Array(32);
    crypto.getRandomValues(keyArr);
    var key = Array.from(keyArr).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
    var url = type==='movie'
      ? HEXA_API+'/api/tmdb/movie/'+tmdbId+'/images'
      : HEXA_API+'/api/tmdb/tv/'+tmdbId+'/season/'+season+'/episode/'+episode+'/images';
    var encData = await pFetch(url, { headers:{ 'X-Api-Key':key, 'Accept':'plain/text', 'Referer':'https://hexa.su/' } });
    var dec = await pJSON(ENC_DEC_API+'/dec-hexa', {
      method:'POST', body:JSON.stringify({text:encData, key:key}), bodyType:'json'
    });
    var sources = dec && dec.result && dec.result.sources || [];
    return sources.map(function(s) {
      return { name:'Hexa ['+(s.server||'').toUpperCase()+']', url:s.url, type:'m3u8', referer:'https://hexa.su/' };
    });
  } catch(e) { return []; }
}

// 5. Mapple \u2014 token dari HTML + POST /api/encrypt per server
async function fetchMapple(tmdbId, type, season, episode) {
  try {
    var movie = type === 'movie';
    var tvSlug = movie ? '' : season+'-'+episode;
    var pageUrl = movie ? MAPPLE_API+'/watch/movie/'+tmdbId : MAPPLE_API+'/watch/tv/'+tmdbId+'/'+tvSlug;
    var hdrs = { 'Referer':MAPPLE_API+'/', 'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
    var html = await pFetch(pageUrl, { headers: hdrs });
    var tokenM = html.match(/window\.__REQUEST_TOKEN__\s*=\s*"([^"]+)"/);
    var token = tokenM && tokenM[1];
    if (!token) return [];
    var servers = ['mapple','sakura','oak','willow','cherry','pines','magnolia','sequoia'];
    var out = [];
    await Promise.all(servers.map(async function(src) {
      try {
        var body = JSON.stringify({ data:{ mediaId:tmdbId, mediaType:movie?'movie':'tv', tv_slug:tvSlug, source:src }, endpoint:'stream-encrypted' });
        var er = await pJSON(MAPPLE_API+'/api/encrypt', { method:'POST', body:body, bodyType:'json', headers:hdrs });
        if (!er || !er.url) return;
        var finalUrl = MAPPLE_API+er.url+'&requestToken='+token;
        var sd = await pJSON(finalUrl, { headers: hdrs });
        if (sd && sd.success && sd.data && sd.data.stream_url) {
          out.push({ name:'Mapple ['+src.toUpperCase()+']', url:sd.data.stream_url, type:'m3u8', referer:MAPPLE_API+'/' });
        }
      } catch(e) {}
    }));
    return out;
  } catch(e) { return []; }
}

// 6. Xpass \u2014 direct JSON API
async function fetchXpass(tmdbId, type, season, episode) {
  try {
    var url = type==='movie'
      ? XPASS_API+'/feb/'+tmdbId+'/0/0/0/playlist.json'
      : XPASS_API+'/meg/tv/'+tmdbId+'/'+season+'/'+episode+'/playlist.json';
    var txt = await pFetch(url);
    var m = txt.match(/"file":"(.*?)"/);
    if (!m) return [];
    var m3u8 = m[1].replace(/\\u0026/g,'&');
    return [{ name:'Xpass', url:m3u8, type:'m3u8', referer:XPASS_API+'/' }];
  } catch(e) { return []; }
}

// 7. Madplay CDN + Vidflix
// Madplay CDN URL selalu di-push tanpa verifikasi — verifikasi dulu via HEAD/pFetch
// sebelum masuk ke daftar agar tidak muncul stream yang langsung gagal CORS/404
async function fetchMadplay(tmdbId, type, season, episode) {
  var cdnUrl = type==='movie'
    ? MADPLAY_CDN+'/api/hls/unknown/'+tmdbId+'/master.m3u8'
    : MADPLAY_CDN+'/api/hls/unknown/'+tmdbId+'/season_'+season+'/episode_'+episode+'/master.m3u8';

  var out = [];

  // Verifikasi CDN URL: cek apakah dapat dijangkau (status 200/206) sebelum ditampilkan
  try {
    var headCheck = await pFetch(cdnUrl, { method:'GET', headers:{ 'Referer':MADPLAY_CDN+'/', 'Range':'bytes=0-0' } });
    // Jika tidak throw (proxy berhasil fetch), URL bisa diakses
    if (headCheck && headCheck.length > 0) {
      out.push({ name:'Madplay CDN', url:cdnUrl, type:'m3u8', referer:MADPLAY_CDN+'/' });
    }
  } catch(e) {
    // CDN URL tidak bisa diakses (404/CORS/network error) — skip
  }

  try {
    var apiUrl = type==='movie'
      ? MADPLAY_SITE+'/api/movies/holly?id='+tmdbId+'&token=direct'
      : MADPLAY_SITE+'/api/movies/holly?id='+tmdbId+'&season='+season+'&episode='+episode+'&token=direct';
    var arr = await pJSON(apiUrl);
    if (arr) arr.forEach(function(i) {
      if (i.file) out.push({
        name:'Vidflix', url:i.file,
        type: i.file.indexOf('.m3u8')>=0 ? 'm3u8' : 'video',
        referer: (i.headers && i.headers.Referer) || MADPLAY_SITE+'/'
      });
    });
  } catch(e) {}
  return out;
}

// 8. SuperEmbed (MultiEmbed) \u2014 follow redirect + token chain
async function fetchSuperEmbed(tmdbId, type, season, episode) {
  var fallback = [{ name:'SuperEmbed', url: cineUrl(tmdbId, type, season, episode, 'superembed'), type:'iframe' }];
  try {
    var baseUrl = type==='movie'
      ? MULTIEMBED_API+'/?video_id='+tmdbId+'&tmdb=1'
      : MULTIEMBED_API+'/?video_id='+tmdbId+'&tmdb=1&s='+season+'&e='+episode;
    var fullRes = await launcherFetch(baseUrl, null, {'Referer':MULTIEMBED_API}, 'GET', null, null);
    var streamingUrl = fullRes.finalUrl || baseUrl;
    if (!streamingUrl || streamingUrl === baseUrl || streamingUrl.indexOf('multiembed.mov') >= 0) return fallback;
    var srcDoc = await pFetch(streamingUrl, {
      method:'POST',
      body:'button-click=ZEhKMVpTLVF0LVBTLVF0TnprekxTLVF5LVBEVXRMLTAtVjNOLTBjMU8tMEF5TmpneC1QRFUtNQ%3D%3D&button-referer=',
      bodyType:'form',
      headers:{ 'Referer':MULTIEMBED_API }
    });
    var hashMatch = srcDoc.match(/load_sources\("(.*?)"\)/);
    if (!hashMatch) return fallback;
    var sourcesHash = hashMatch[1];
    var hostUrl = new URL(streamingUrl).origin;
    var listHtml = await pFetch(hostUrl+'/response.php', {
      method:'POST', body:'token='+sourcesHash, bodyType:'form',
      headers:{ 'X-Requested-With':'XMLHttpRequest', 'Referer':streamingUrl }
    });
    var listDoc = new DOMParser().parseFromString(listHtml, 'text/html');
    var lis = Array.from(listDoc.querySelectorAll('li'));
    if (!lis.length) return fallback;
    var res2 = [];
    for (var j = 0; j < lis.length; j++) {
      try {
        var li = lis[j];
        var dataId = li.getAttribute('data-id');
        var dataSrv = li.getAttribute('data-server');
        var playUrl = hostUrl+'/playvideo.php?video_id='+dataId+'&server_id='+dataSrv+'r&token='+sourcesHash+'&init=0';
        var playHtml = await pFetch(playUrl, { headers:{ 'Referer':streamingUrl } });
        var pDoc2 = new DOMParser().parseFromString(playHtml, 'text/html');
        var iframeSrc = pDoc2.querySelector('iframe') && pDoc2.querySelector('iframe').src;
        if (iframeSrc) res2.push({ name:'SuperEmbed ['+(li.textContent.trim()||dataSrv)+']', url:iframeSrc, type:'iframe' });
      } catch(e) {}
    }
    return res2.length ? res2 : fallback;
  } catch(e) { return fallback; }
}

// 9. 2Embed \u2014 iframe langsung
function fetch2Embed(tmdbId, type, season, episode) {
  var url = type==='movie'
    ? TWOEMBEDAPI+'/embed/'+tmdbId
    : TWOEMBEDAPI+'/embedtv/'+tmdbId+'&s='+season+'&e='+episode;
  return Promise.resolve([{ name:'2Embed', url:url, type:'iframe' }]);
}

// 10. PrimeSrc \u2014 IMDB-based, server list
async function fetchPrimeSrc(imdbId, type, season, episode) {
  if (!imdbId) return [];
  try {
    var referer = type==='movie'
      ? PRIMESRC_API+'/embed/movie?imdb='+imdbId
      : PRIMESRC_API+'/embed/tv?imdb='+imdbId+'&season='+season+'&episode='+episode;
    var hdrs = { 'Referer':referer, 'sec-fetch-dest':'empty', 'sec-fetch-mode':'cors', 'sec-fetch-site':'same-origin' };
    var apiUrl = type==='movie'
      ? PRIMESRC_API+'/api/v1/s?imdb='+imdbId+'&type=movie'
      : PRIMESRC_API+'/api/v1/s?imdb='+imdbId+'&season='+season+'&episode='+episode+'&type=tv';
    var d = await pJSON(apiUrl, { headers: hdrs });
    var servers = d && d.servers || [];
    var out = [];
    await Promise.all(servers.map(async function(sv) {
      try {
        var ld = await pJSON(PRIMESRC_API+'/api/v1/l?key='+sv.key, { headers: hdrs });
        if (ld && ld.link) out.push({ name:'PrimeSrc', url:ld.link, type:'iframe' });
      } catch(e) {}
    }));
    return out;
  } catch(e) { return []; }
}

// 11. CineCity \u2014 atob decode + Playerjs JSON
async function fetchCineCity(imdbId, type, season, episode) {
  if (!imdbId) return [];
  try {
    var url = type==='movie'
      ? CINEMACITY_API+'/movie/'+imdbId
      : CINEMACITY_API+'/tv/'+imdbId+'/'+season+'/'+episode;
    var html = await pFetch(url, { headers:{ 'Referer':CINEMACITY_API } });
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var scripts = Array.from(doc.querySelectorAll('script'));
    var atobScript = null;
    var slen = scripts.length;
    for (var k=1; k < slen; k++) {
      if (scripts[k].textContent.indexOf('atob(') >= 0) { atobScript = scripts[k]; break; }
    }
    if (!atobScript) return [];
    var b64m = atobScript.textContent.match(/atob\("([^"]+)"\)/);
    if (!b64m) return [];
    var decoded = atob(b64m[1]);
    var startIdx = decoded.indexOf('new Playerjs(')+13;
    var endIdx = decoded.lastIndexOf(');');
    var playerRaw = decoded.substring(startIdx, endIdx);
    var playerJson = JSON.parse(playerRaw);
    var fileArr = JSON.parse(playerJson.file);
    var out = [];
    var movie = !season;
    if (movie || !fileArr[0] || !fileArr[0].folder) {
      var f = fileArr[0] && fileArr[0].file;
      if (f) out.push({ name:'CineCity Multi Audio \ud83c\udf10', url:f, type: f.indexOf('.m3u8')>=0?'m3u8':'video', referer:url });
    } else {
      for (var si=0; si !== fileArr.length; si++) {
        var sItem = fileArr[si];
        var snMatch = sItem.title && sItem.title.match(/Season\s*(\d+)/i);
        var sn = snMatch ? parseInt(snMatch[1]) : null;
        if (season && sn !== null && sn !== season) continue;
        var folder = sItem.folder || [];
        for (var ei=0; ei !== folder.length; ei++) {
          var ep = folder[ei];
          var enMatch = ep.title && ep.title.match(/Episode\s*(\d+)/i);
          var en = enMatch ? parseInt(enMatch[1]) : null;
          if (episode && en !== null && en !== episode) continue;
          if (ep.file) out.push({ name:'CineCity Multi Audio \ud83c\udf10', url:ep.file, type: ep.file.indexOf('.m3u8')>=0?'m3u8':'video', referer:url });
        }
      }
    }
    return out;
  } catch(e) { return []; }
}

// \u2500\u2500 Subtitle fetchers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function fetchWyzieSubs(imdbId, season, episode) {
  if (!imdbId) return [];
  try {
    var url = season
      ? WYZIE_API+'/search?id='+imdbId+'&season='+season+'&episode='+episode
      : WYZIE_API+'/search?id='+imdbId;
    var arr = await pJSON(url);
    return (arr || []).filter(function(s){ return !!s.url; }).map(function(s){
      return { lang: s.display || s.language || 'Unknown', url: s.url };
    });
  } catch(e) { return []; }
}
async function fetchOpenSubs(imdbId, season, episode) {
  if (!imdbId) return [];
  try {
    var url = season
      ? OPENSUB_API+'/subtitles/series/'+imdbId+':'+season+':'+episode+'.json'
      : OPENSUB_API+'/subtitles/movie/'+imdbId+'.json';
    var d = await pJSON(url);
    return (d && d.subtitles || []).filter(function(s){ return !!s.url; }).map(function(s){
      return { lang: s.lang || s.lang_code || 'Unknown', url: s.url };
    });
  } catch(e) { return []; }
}

// \u2500\u2500 Main handler \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function handleCineAction(tmdbId, type, watchHere, season, episode, sourceKey) {
  var st = document.getElementById('kk-status');
  if (!tmdbId) { st.textContent = '\u2717 TMDB ID tidak tersedia.'; return; }
  if (!watchHere) {
    st.textContent = '\u2713 Membuka Cinestream...';
    window.open(cineUrl(tmdbId, type, season, episode, sourceKey || 'superembed'), '_blank');
    return;
  }
  if (type === 'movie') {
    st.textContent = '\u2713 Memuat sumber stream...';
    await showCineStreams(tmdbId, type, null, null, null);
  } else {
    st.textContent = '\u2713 Memuat episode Cinestream...';
    await loadCineEpisodes(tmdbId, type, null);
  }
}

// \u2500\u2500 Stream Sources Panel \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function showCineStreams(tmdbId, type, season, episode, imdbId) {
  var extra = document.getElementById('detail-extra');
  var old = document.getElementById('cine-stream-panel');
  if (old) old.remove();

  var panel = document.createElement('div');
  panel.id = 'cine-stream-panel';
  panel.className = 'player-section';
  panel.innerHTML =
    '<div class="player-title">SUMBER <span style="color:#0ea5e9">CINESTREAM</span></div>' +
    '<div id="csp-src-list" style="display:flex;flex-direction:column;gap:8px;padding:8px 0"></div>' +
    '<div id="csp-sub-wrap" style="display:none;padding-top:8px">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:1px;color:var(--muted);margin-bottom:6px">SUBTITLE TERSEDIA</div>' +
      '<div id="csp-subs" style="display:flex;flex-wrap:wrap;gap:6px"></div>' +
    '</div>' +
    '<div id="csp-player" style="display:none;margin-top:14px">' +
      '<div class="player-wrap">' +
        '<div class="player-loading" id="csp-load"><div class="spinner on"></div><span>Memuat video...</span></div>' +
        '<iframe id="csp-iframe" allowfullscreen allow="autoplay; fullscreen" style="width:100%;height:500px;border:0;border-radius:10px;opacity:0;transition:opacity .3s"></iframe>' +
      '</div>' +
    '</div>';
  extra.appendChild(panel);
  panel.scrollIntoView({ behavior:'smooth', block:'nearest' });

  var srcList = panel.querySelector('#csp-src-list');
  var subWrap = panel.querySelector('#csp-sub-wrap');
  var subsDiv = panel.querySelector('#csp-subs');
  var firstSource = true;

  srcList.innerHTML = '<div style="font-size:12px;color:var(--muted)">\u23f3 Mengambil semua sumber stream, harap tunggu...</div>';

  // ── Blob URL cache ──────────────────────────────────────────────────
  var _cspBlobUrls = [];
  function _cspRevoke() {
    _cspBlobUrls.forEach(function(u){ try{ URL.revokeObjectURL(u); }catch(e){} });
    _cspBlobUrls = [];
  }

  // Resolve URL relatif ke base
  function _cspResolve(base, rel) {
    if (!rel) return base;
    if (/^https?:\/\//.test(rel)) return rel;
    if (rel.indexOf('//') === 0) return base.split(':')[0] + ':' + rel;
    if (rel.indexOf('/') === 0) { var m = base.match(/^(https?:\/\/[^/]+)/); return m ? m[1]+rel : rel; }
    return base.replace(/\/[^/]*$/, '/') + rel;
  }

  function _cspIsMaster(text) { return text.indexOf('#EXT-X-STREAM-INF') >= 0; }

  // Fetch teks via GM proxy — melewati CORS
  async function _cspFetch(url, referer) {
    var hdrs = {};
    if (referer) {
      hdrs['Referer'] = referer;
      try { hdrs['Origin'] = new URL(referer).origin; } catch(e) {}
    }
    var res = await launcherFetch(url, null, hdrs, 'GET', null, null);
    return { text: res.body || '', finalUrl: res.finalUrl || url };
  }

  // Fetch + rewrite m3u8 jadi teks dengan semua URL absolute
  // Return: { playlistText, baseUrl }
  async function _cspFetchPlaylist(origUrl, referer) {
    var r1 = await _cspFetch(origUrl, referer);
    var text = r1.text;
    var base = r1.finalUrl;

    if (!text || text.length < 10) throw new Error('Playlist kosong');

    // Jika master playlist, pilih bandwidth tertinggi
    if (_cspIsMaster(text)) {
      var lines = text.split('\n');
      var bestBw = -1, bestUrl = null;
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l.indexOf('#EXT-X-STREAM-INF') === 0) {
          var bwM = l.match(/BANDWIDTH=(\d+)/);
          var bw = bwM ? parseInt(bwM[1]) : 0;
          var next = lines[i+1] && lines[i+1].trim();
          if (next && next.indexOf('#') !== 0 && bw > bestBw) {
            bestBw = bw; bestUrl = _cspResolve(base, next);
          }
        }
      }
      // Tidak ada stream ditemukan → pakai baris pertama yang bukan komentar
      if (!bestUrl) {
        for (var j = 0; j < lines.length; j++) {
          var lt = lines[j].trim();
          if (lt && lt.indexOf('#') !== 0) { bestUrl = _cspResolve(base, lt); break; }
        }
      }
      if (bestUrl) {
        var r2 = await _cspFetch(bestUrl, referer);
        text = r2.text; base = r2.finalUrl;
        if (!text || text.length < 10) throw new Error('Media playlist kosong');
      }
    }

    // Rewrite semua URL ke absolute
    var out = text.split('\n').map(function(line) {
      var t = line.trim();
      if (!t) return '';
      if (t.indexOf('#') === 0) {
        // Rewrite URI="..." di tag seperti #EXT-X-KEY, #EXT-X-MAP
        return t.replace(/URI="([^"]+)"/g, function(_, uri) {
          return 'URI="' + _cspResolve(base, uri) + '"';
        });
      }
      return _cspResolve(base, t);
    });

    return { playlistText: out.join('\n'), baseUrl: base };
  }

  // Buat HTML player yang embed teks playlist m3u8 sebagai JS string
  // KRITIS: blob URL m3u8 harus dibuat DI DALAM iframe (bukan di Explorer)
  // karena blob URL inherit origin pembuatnya, dan iframe tidak bisa fetch
  // blob dari origin lain.
  function _buildPlayer(playlistText, isM3u8, fallbackUrl) {
    // Embed teks playlist sebagai JSON string — 100% aman untuk semua karakter
    var playlistJson = isM3u8 ? JSON.stringify(playlistText) : 'null';
    var fallbackJson = JSON.stringify(fallbackUrl || '');

    var playerScript = [
      '(function(){',
      'var v=document.getElementById("v");',
      'var err=document.getElementById("err");',
      'var em=document.getElementById("em");',
      'function showErr(msg){',
      '  v.style.display="none";',
      '  err.style.display="flex";',
      '  em.textContent=msg||"";',
      '}',

      // Buat blob m3u8 DI DALAM iframe (origin iframe = sama dengan blob HTML)
      isM3u8 ? [
        'var playlistText=' + playlistJson + ';',
        'var fallback=' + fallbackJson + ';',
        'if(!playlistText){showErr("Playlist tidak tersedia");return;}',

        // Buat blob m3u8 di dalam iframe → origin sama → tidak ada CORS
        'var m3u8Blob=new Blob([playlistText],{type:"application/vnd.apple.mpegurl"});',
        'var m3u8Url=URL.createObjectURL(m3u8Blob);',

        'function loadHls(url){',
        '  if(typeof Hls==="undefined"){',
        // hls.js belum load — tunggu
        '    setTimeout(function(){loadHls(url);},100);return;',
        '  }',
        '  if(!Hls.isSupported()){',
        // Coba native HLS (Safari/iOS)
        '    if(v.canPlayType("application/vnd.apple.mpegurl")){',
        '      v.src=url;',
        '      v.onerror=function(){showErr("Native HLS: error "+(v.error?v.error.code:""));};',
        '    }else{showErr("HLS tidak didukung di browser ini");}',
        '    return;',
        '  }',
        '  var h=new Hls({',
        '    maxBufferLength:30,',
        '    maxMaxBufferLength:60,',
        '    fragLoadingMaxRetry:3,',
        '    manifestLoadingMaxRetry:2,',
        '    levelLoadingMaxRetry:2',
        '  });',
        '  h.loadSource(url);',
        '  h.attachMedia(v);',
        '  h.on(Hls.Events.MANIFEST_PARSED,function(){',
        '    v.play().catch(function(){});',
        '  });',
        '  h.on(Hls.Events.ERROR,function(ev,d){',
        '    if(!d.fatal)return;',
        '    if(d.type===Hls.ErrorTypes.MEDIA_ERROR){',
        '      h.recoverMediaError();',
        '    }else if(d.type===Hls.ErrorTypes.NETWORK_ERROR){',
        // Network error: segment CDN butuh auth/CORS — tampilkan error detail
        '      showErr("Network: "+d.details);',
        '    }else{',
        '      showErr(d.details||"fatal error");',
        '    }',
        '  });',
        '}',
        'loadHls(m3u8Url);',
      ].join('') : [
        // Video biasa (MP4 dll)
        'var fallback=' + fallbackJson + ';',
        'v.src=fallback;',
        'v.onerror=function(){showErr("Error "+(v.error?v.error.code:"unknown"));};',
        'v.play().catch(function(){});',
      ].join(''),

      '})();'
    ].join('');

    var html = [
      '<!DOCTYPE html>',
      '<html><head><meta charset="UTF-8">',
      '<meta name="referrer" content="no-referrer">',
      // Gunakan versi specific hls.js yang stabil
      '<script src="https://cdn.jsdelivr.net/npm/hls.js@1.5.13"><' + '/script>',
      '<style>',
      '*{margin:0;padding:0;box-sizing:border-box}',
      'body{background:#000;overflow:hidden}',
      'video{width:100vw;height:100vh;object-fit:contain;display:block}',
      '#err{display:none;position:fixed;inset:0;background:#0a0a0a;',
      'flex-direction:column;align-items:center;justify-content:center;',
      'font-family:sans-serif;color:#e94560;text-align:center;padding:20px;gap:8px}',
      '#err h3{font-size:15px;margin:0}',
      '#err p{font-size:11px;color:#6b6880;margin:0}',
      '</style>',
      '</head><body>',
      '<video id="v" controls autoplay playsinline></video>',
      '<div id="err">',
      '<h3>\u26A0 Stream Gagal Diputar</h3>',
      '<span id="em" style="font-size:13px;color:#fbbf24"></span>',
      '<p>Segmen CDN mungkin memerlukan autentikasi. Coba tombol \u2197 Buka.</p>',
      '</div>',
      '<script>',
      playerScript,
      '<' + '/script>',
      '</body></html>'
    ].join('');

    var bUrl = URL.createObjectURL(new Blob([html], {type:'text/html'}));
    _cspBlobUrls.push(bUrl);
    return bUrl;
  }

  async function makeCspBlob(source) {
    _cspRevoke();
    var url = source.url;
    var referer = source.referer || '';
    var isM3u8 = source.type === 'm3u8' || url.indexOf('.m3u8') >= 0;

    if (!isM3u8) {
      // MP4/video: embed URL langsung (tidak perlu proxy playlist)
      return _buildPlayer(null, false, url);
    }

    try {
      var result = await _cspFetchPlaylist(url, referer);
      return _buildPlayer(result.playlistText, true, url);
    } catch(err) {
      // Proxy gagal → fallback: embed URL asli, hls.js coba direct (mungkin kena CORS)
      _dbg.log('[Cine] Proxy playlist gagal: ' + err.message + ' — fallback direct', 'warn');
      // Buat minimal playlist yang point ke URL asli
      var minPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\n' + url;
      return _buildPlayer(minPlaylist, true, url);
    }
  }

  function playCsp(source) {
    var pw   = panel.querySelector('#csp-player');
    var load = panel.querySelector('#csp-load');
    var iframe = panel.querySelector('#csp-iframe');
    pw.style.display = 'block';
    load.style.display = 'flex';
    iframe.style.opacity = '0';
    pw.scrollIntoView({ behavior:'smooth', block:'nearest' });
    makeCspBlob(source).then(function(blobUrl) {
      iframe.src = blobUrl;
      iframe.onload = function(){ load.style.display='none'; iframe.style.opacity='1'; };
    }).catch(function(err) {
      load.style.display = 'none';
      pw.innerHTML = '<div style="padding:20px;color:#e94560;font-size:13px;text-align:center">' +
        '\u26A0 Gagal: ' + esc(err.message) + '</div>';
    });
  }
  function addSrc(streams) {
    if (!streams || !streams.length) return;
    if (firstSource) { srcList.innerHTML = ''; firstSource = false; }
    streams.forEach(function(s) {
      var badge =
        s.type==='m3u8'  ? '<span style="background:#0ea5e9;color:#fff;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:700">M3U8</span>' :
        s.type==='video' ? '<span style="background:#10b981;color:#fff;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:700">MP4</span>'  :
                           '<span style="background:#8b5cf6;color:#fff;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:700">EMBED</span>';
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--surface2);border:1px solid var(--border2);border-radius:8px';
      row.innerHTML =
        '<span style="flex:1;font-weight:600;font-size:13px;color:var(--fg)">' + esc(s.name) + '</span>' + badge +
        '<button class="action-btn cine" style="flex:initial;min-width:auto;padding:6px 14px;font-size:12px">\u25ba Tonton</button>' +
        '<button class="action-btn secondary" style="flex:initial;min-width:auto;padding:6px 14px;font-size:12px">\u2197 Buka</button>';
      var src = s;
      row.querySelectorAll('button')[0].addEventListener('click', function(){ playCsp(src); });
      row.querySelectorAll('button')[1].addEventListener('click', function(){ window.open(src.url,'_blank'); });
      srcList.appendChild(row);
    });
  }

  function addSubs(subs) {
    if (!subs || !subs.length) return;
    subWrap.style.display = 'block';
    subs.forEach(function(s) {
      var btn = document.createElement('button');
      btn.className = 'action-btn secondary';
      btn.style.cssText = 'flex:initial;min-width:auto;font-size:11px;padding:4px 10px';
      btn.textContent = s.lang;
      btn.onclick = function(){ window.open(s.url,'_blank'); };
      subsDiv.appendChild(btn);
    });
  }

  var isMovie = type === 'movie';
  // Debug: tampilkan status fetch di UI
  var _fetchLog = [];
  function _wrapFetch(label, promise) {
    return promise.then(function(r) {
      _fetchLog.push(label + ': ' + (r && r.length ? r.length + ' hasil' : 'kosong'));
      return r;
    }).catch(function(err) {
      _fetchLog.push(label + ': ERROR - ' + err.message);
      return [];
    });
  }
  await Promise.all([
    _wrapFetch('VidSrc', fetchVidSrc(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('Vidzee', fetchVidzee(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('VidLink', fetchVidLink(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('Hexa', fetchHexa(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('Mapple', fetchMapple(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('Xpass', fetchXpass(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('Madplay', fetchMadplay(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('SuperEmbed', fetchSuperEmbed(tmdbId, type, season, episode)).then(addSrc),
    _wrapFetch('2Embed', fetch2Embed(tmdbId, type, season, episode)).then(addSrc),
    imdbId ? _wrapFetch('PrimeSrc', fetchPrimeSrc(imdbId, type, season, episode)).then(addSrc) : Promise.resolve(),
    imdbId ? _wrapFetch('CineCity', fetchCineCity(imdbId, type, season, episode)).then(addSrc) : Promise.resolve(),
    imdbId ? _wrapFetch('WyzieSubs', fetchWyzieSubs(imdbId, season, episode)).then(addSubs) : Promise.resolve(),
    imdbId ? _wrapFetch('OpenSubs', fetchOpenSubs(imdbId, season, episode)).then(addSubs) : Promise.resolve(),
  ]);

  // Tampilkan debug log di UI
  var logDiv = document.createElement('div');
  logDiv.style.cssText = 'margin-top:10px;padding:8px 12px;background:#0f172a;border-radius:6px;font-size:10px;color:#94a3b8;font-family:monospace;line-height:1.6';
  logDiv.innerHTML = '<div style="color:#0ea5e9;font-weight:700;margin-bottom:4px">DEBUG FETCH LOG</div>' +
    _fetchLog.map(function(l) { return '<div>' + esc(l) + '</div>'; }).join('');
  panel.appendChild(logDiv);
  if (firstSource) {
    srcList.innerHTML = '<div style="font-size:13px;color:var(--muted);text-align:center;padding:20px 0">Tidak ada sumber stream ditemukan.</div>';
  }
}

// \u2500\u2500 Season/Episode Picker \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
async function loadCineEpisodes(tmdbId, type, imdbId) {
  var extra = document.getElementById('detail-extra');
  var seasons = [];
  try {
    var d = await pJSON('https://api.themoviedb.org/3/'+type+'/'+tmdbId+'?api_key='+API_KEY+'&language=en-US');
    if (d && d.seasons) seasons = d.seasons.filter(function(s){ return s.season_number>0; });
  } catch(e) {}
  if (!seasons.length) { await showCineStreams(tmdbId, type, 1, 1, imdbId); return; }

  var pickId = 'cine-picker-' + tmdbId;
  var oldPicker = document.getElementById(pickId);
  if (oldPicker) oldPicker.remove();
  var picker = document.createElement('div');
  picker.id = pickId;
  picker.className = 'episodes-section';
  picker.innerHTML =
    '<div class="episodes-title">PILIH SEASON <span style="color:#0ea5e9">(Cinestream)</span></div>' +
    '<div id="csn-srow" style="display:flex;flex-wrap:wrap;gap:8px;padding-bottom:8px"></div>' +
    '<div id="csn-ewrap-' + tmdbId + '"></div>';
  extra.appendChild(picker);

  var sRow = picker.querySelector('#csn-srow');
  seasons.forEach(function(s, i) {
    var btn = document.createElement('button');
    btn.className = 'action-btn secondary season-pick-btn';
    btn.style.cssText = 'flex:initial;min-width:auto;font-size:12px;padding:7px 16px';
    btn.textContent = s.name || 'Season '+s.season_number;
    var sNum = s.season_number;
    btn.addEventListener('click', async function() {
      sRow.querySelectorAll('button').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      var wrap = document.getElementById('csn-ewrap-'+tmdbId);
      wrap.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">Memuat episode...</div>';
      var eps = [];
      try {
        var d2 = await pJSON('https://api.themoviedb.org/3/tv/'+tmdbId+'/season/'+sNum+'?api_key='+API_KEY);
        if (d2 && d2.episodes) eps = d2.episodes;
      } catch(e) {}
      if (!eps.length) { wrap.innerHTML='<div style="font-size:12px;color:var(--muted);padding:8px 0">Tidak ada episode ditemukan.</div>'; return; }
      wrap.innerHTML =
        '<div class="episodes-title" style="margin-top:10px">PILIH EPISODE <span style="color:#0ea5e9">('+eps.length+')</span></div>' +
        '<div class="episode-grid" id="cseg-'+tmdbId+'-'+sNum+'"></div>';
      var grid = document.getElementById('cseg-'+tmdbId+'-'+sNum);
      eps.forEach(function(ep) {
        var eb = document.createElement('button');
        eb.className = 'ep-btn';
        eb.textContent = 'Ep '+ep.episode_number;
        var epNum = ep.episode_number;
        eb.addEventListener('click', async function() {
          grid.querySelectorAll('.ep-btn').forEach(function(b){ b.classList.remove('active'); });
          eb.classList.add('active');
          var old2 = document.getElementById('cine-stream-panel');
          if (old2) old2.remove();
          await showCineStreams(tmdbId, type, sNum, epNum, imdbId);
        });
        grid.appendChild(eb);
      });
    });
    sRow.appendChild(btn);
    if (i === 0) btn.click();
  });
}


console.log("[Cinestream Plugin] v1.0.1 aktif");

})();
