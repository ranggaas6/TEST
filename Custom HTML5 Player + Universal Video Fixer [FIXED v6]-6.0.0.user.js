// ==UserScript==
// @name         Custom HTML5 Player + Universal Video Fixer [FIXED v6]
// @namespace    https://gist.github.com/narcolepticinsomniac
// @version      6.0.0
// @description  Fix controls hilang setelah awal — pakai global mousemove + rect check
// @author       narcolepticinsomniac + varenc + merged
// @match        *://*/*
// @include      *
// @require      https://cdnjs.cloudflare.com/ajax/libs/arrive/2.4.1/arrive.min.js
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// @connect      v.redd.it
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    GM_addStyle(`
        video::-webkit-media-controls,
        video::-webkit-media-controls-enclosure,
        video::-webkit-media-controls-panel {
            display: none !important;
            opacity: 0 !important;
            pointer-events: none !important;
        }
    `);

    // ────────────────────────────────────────────────
    //  Helpers
    // ────────────────────────────────────────────────
    function css(el, styles) { Object.assign(el.style, styles); }

    function formatTime(t) {
        if (!isFinite(t) || isNaN(t)) return '0:00';
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return m + ':' + (s < 10 ? '0' + s : s);
    }

    function removeVideoRestrictions(video) {
        ['disablePictureInPicture', 'disableRemotePlayback', 'controlsList'].forEach(a => video.removeAttribute(a));
        video.controls = false;
        video.removeAttribute('controls');
    }

    // ── Cek apakah koordinat mouse di dalam suatu rect ──
    function inRect(rect, x, y, padding) {
        const p = padding || 0;
        return x >= rect.left   - p &&
               x <= rect.right  + p &&
               y >= rect.top    - p &&
               y <= rect.bottom + p;
    }

    // ────────────────────────────────────────────────
    //  Apply custom player
    // ────────────────────────────────────────────────
    function applyCustomPlayer(video) {
        if (video.dataset.cvpInit) return;
        video.dataset.cvpInit = '1';

        video.controls = false;
        video.removeAttribute('controls');

        // ── Wrapper (untuk fullscreen request) ───────
        const wrapper = document.createElement('div');
        css(wrapper, {
            position:   'relative',
            display:    'inline-block',
            lineHeight: '0',
            padding:    '0',
            margin:     '0',
            border:     '0',
            background: 'transparent',
        });
        video.parentNode.insertBefore(wrapper, video);
        wrapper.appendChild(video);

        // ── Controls bar ──────────────────────────────
        const bar = document.createElement('div');
        css(bar, {
            height:          '46px',
            display:         'flex',
            alignItems:      'center',
            padding:         '0 10px',
            boxSizing:       'border-box',
            gap:             '5px',
            background:      'linear-gradient(transparent, rgba(0,0,0,0.92))',
            zIndex:          '2147483647',
            opacity:         '0',
            transition:      'opacity 0.2s',
            pointerEvents:   'none',
            userSelect:      'none',
            WebkitUserSelect:'none',
        });

        // ── State ─────────────────────────────────────
        let isFS      = false;
        let isVisible = false;
        let hideTimer = null;

        // ── Show / hide ───────────────────────────────
        const showBar = () => {
            clearTimeout(hideTimer);
            if (!isVisible) {
                isVisible             = true;
                bar.style.opacity     = '1';
                bar.style.pointerEvents = 'auto';
            }
        };

        const hideBar = (delay) => {
            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
                if (!video.paused) {
                    isVisible             = false;
                    bar.style.opacity     = '0';
                    bar.style.pointerEvents = 'none';
                }
            }, delay !== undefined ? delay : 2000);
        };

        // ── Global mousemove: cek apakah mouse di atas video/bar ──
        // Ini jauh lebih reliable dari mouseenter/mouseleave chain
        let mouseMoveTimer = null;
        const onGlobalMouseMove = (e) => {
            if (isFS) return; // fullscreen punya handler sendiri

            const mx = e.clientX;
            const my = e.clientY;
            const videoRect = video.getBoundingClientRect();
            const barRect   = bar.getBoundingClientRect();

            // Mouse di atas video atau bar → tampilkan
            if (inRect(videoRect, mx, my) || inRect(barRect, mx, my, 5)) {
                showBar();
                clearTimeout(mouseMoveTimer);
                // Jadwalkan hide setelah mouse berhenti bergerak
                mouseMoveTimer = setTimeout(() => {
                    if (!video.paused) hideBar(0);
                }, 2500);
            }
        };

        document.addEventListener('mousemove', onGlobalMouseMove, { passive: true });

        // Saat mouse keluar jendela browser → hide
        document.addEventListener('mouseleave', () => {
            if (!video.paused) hideBar(500);
        });

        // Pause → selalu tampil; play → jadwalkan hide
        video.addEventListener('pause', () => { clearTimeout(hideTimer); clearTimeout(mouseMoveTimer); showBar(); });
        video.addEventListener('play',  () => { hideBar(2000); });

        // Klik video → toggle play
        video.addEventListener('click', () => { video.paused ? video.play() : video.pause(); });

        // Tampilkan awal
        showBar();
        hideBar(3000);

        // ── Helper: tombol ────────────────────────────
        function makeBtn(icon, title) {
            const b = document.createElement('div');
            css(b, {
                cursor:         'pointer',
                width:          '30px',
                minWidth:       '30px',
                height:         '30px',
                display:        'flex',
                alignItems:     'center',
                justifyContent: 'center',
                fontSize:       '14px',
                color:          '#fff',
                flexShrink:     '0',
                borderRadius:   '4px',
            });
            b.textContent = icon;
            b.title = title;
            b.addEventListener('mouseenter', () => { b.style.background = 'rgba(255,255,255,0.18)'; });
            b.addEventListener('mouseleave', () => { b.style.background = 'transparent'; });
            return b;
        }

        function makeLabel(text, w) {
            const s = document.createElement('span');
            css(s, {
                fontSize:   '11px',
                color:      '#fff',
                fontFamily: 'monospace, sans-serif',
                minWidth:   w || '38px',
                textAlign:  'center',
                flexShrink: '0',
                lineHeight: '1',
                whiteSpace: 'nowrap',
            });
            s.textContent = text;
            return s;
        }

        function makeSlider(min, max, step, initVal, fillColor, grow) {
            const wrap  = document.createElement('div');
            const track = document.createElement('div');
            const fill  = document.createElement('div');
            const inp   = document.createElement('input');

            css(wrap, {
                position:   'relative',
                height:     '4px',
                flexGrow:   grow ? '1' : '0',
                minWidth:   grow ? '40px' : '0',
                width:      grow ? '' : '60px',
                cursor:     'pointer',
                flexShrink: '0',
            });
            css(track, {
                position:     'absolute',
                inset:        '0',
                background:   'rgba(255,255,255,0.3)',
                borderRadius: '2px',
            });
            css(fill, {
                position:      'absolute',
                top:           '0', left: '0',
                height:        '100%',
                background:    fillColor || '#fff',
                borderRadius:  '2px',
                pointerEvents: 'none',
                width:         ((initVal - min) / (max - min) * 100) + '%',
            });

            inp.type  = 'range';
            inp.min   = String(min);
            inp.max   = String(max);
            inp.step  = String(step);
            inp.value = String(initVal);
            css(inp, {
                position:  'absolute',
                top:       '50%',
                left:      '0',
                transform: 'translateY(-50%)',
                width:     '100%',
                height:    '20px',
                margin:    '0', padding: '0',
                opacity:   '0',
                cursor:    'pointer',
                zIndex:    '5',
            });

            wrap.appendChild(track);
            wrap.appendChild(fill);
            wrap.appendChild(inp);
            return { wrap, fill, inp };
        }

        // ── Buat elemen controls ──────────────────────
        const btnPlay  = makeBtn('▶',  'Play / Pause');
        const btnBegin = makeBtn('⏮',  'Ke awal');
        const btnBwd   = makeBtn('⏪',  'Mundur 10s');
        const lblCur   = makeLabel('0:00');
        const lblSep   = makeLabel('/', '10px');
        const lblTot   = makeLabel('0:00');
        const seeker   = makeSlider(0, 100, 0.01, 0, '#ff4444', true);
        const btnFwd   = makeBtn('⏩',  'Maju 10s');
        const rateBtn  = makeLabel('1x', '30px');
        rateBtn.style.cursor = 'pointer';
        rateBtn.title        = 'Klik: ganti kecepatan';
        const vol      = makeSlider(0, 1, 0.01, 1, '#fff', false);
        const btnMute  = makeBtn('🔊', 'Mute / Unmute');
        const btnFS    = makeBtn('⛶',  'Fullscreen');

        [btnPlay, btnBegin, btnBwd, lblCur, lblSep, lblTot, seeker.wrap,
         btnFwd, rateBtn, vol.wrap, btnMute, btnFS
        ].forEach(el => bar.appendChild(el));

        // ── Update UI ─────────────────────────────────
        const updateUI = () => {
            const pct = video.duration ? (video.currentTime / video.duration) * 100 : 0;
            seeker.fill.style.width = pct + '%';
            seeker.inp.value        = String(pct);
            lblCur.textContent      = formatTime(video.currentTime);

            const volPct = video.muted ? 0 : video.volume;
            vol.fill.style.width = (volPct * 100) + '%';
            vol.inp.value        = String(volPct);

            btnMute.textContent = (video.muted || video.volume === 0) ? '🔇' : '🔊';
            btnPlay.textContent = video.paused ? '▶' : '⏸';
        };

        video.addEventListener('timeupdate',     updateUI);
        video.addEventListener('volumechange',   updateUI);
        video.addEventListener('play',           updateUI);
        video.addEventListener('pause',          updateUI);
        video.addEventListener('loadedmetadata', () => {
            lblTot.textContent = formatTime(video.duration);
            updateUI();
        });

        // ── Aksi tombol ───────────────────────────────
        const stop = e => e.stopPropagation();

        btnPlay.addEventListener('click',  e => { stop(e); video.paused ? video.play() : video.pause(); });
        btnBegin.addEventListener('click', e => { stop(e); video.currentTime = 0; });
        btnBwd.addEventListener('click',   e => { stop(e); video.currentTime = Math.max(0, video.currentTime - 10); });
        btnFwd.addEventListener('click',   e => { stop(e); video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); });
        btnMute.addEventListener('click',  e => { stop(e); video.muted = !video.muted; });

        // Speed
        const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
        let rateIdx = 3;
        rateBtn.addEventListener('click', e => {
            stop(e);
            rateIdx = (rateIdx + 1) % rates.length;
            video.playbackRate  = rates[rateIdx];
            rateBtn.textContent = rates[rateIdx] + 'x';
        });

        seeker.inp.addEventListener('input', () => {
            video.currentTime = (parseFloat(seeker.inp.value) / 100) * (video.duration || 0);
        });
        vol.inp.addEventListener('input', () => {
            video.volume = parseFloat(vol.inp.value);
            video.muted  = video.volume === 0;
        });

        // ── rAF: posisikan bar mengikuti video (mode normal) ──
        let rafId    = null;
        let lastRect = {};

        const positionBar = () => {
            if (isFS) return;
            const r = video.getBoundingClientRect();
            if (r.left   === lastRect.left   &&
                r.bottom === lastRect.bottom &&
                r.width  === lastRect.width) return;
            lastRect = r;
            css(bar, {
                left:   r.left + 'px',
                bottom: (window.innerHeight - r.bottom) + 'px',
                width:  r.width + 'px',
                top:    '',
            });
        };

        const startRaf = () => {
            const loop = () => { positionBar(); rafId = requestAnimationFrame(loop); };
            rafId = requestAnimationFrame(loop);
        };
        const stopRaf = () => {
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            lastRect = {};
        };

        // ── Mode normal: bar di documentElement, position:fixed ──
        const setModeNormal = () => {
            css(bar, { position: 'fixed', bottom: '0', left: '0', width: '200px', top: '' });
            document.documentElement.appendChild(bar);
            startRaf();
        };

        // ── Mode fullscreen: bar di dalam wrapper, position:absolute ──
        const setModeFullscreen = () => {
            stopRaf();
            css(bar, { position: 'absolute', bottom: '0', left: '0', width: '100%', top: '' });
            wrapper.appendChild(bar);
        };

        // ── Fullscreen handler ────────────────────────
        btnFS.addEventListener('click', e => {
            stop(e);
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                wrapper.requestFullscreen().catch(() => video.requestFullscreen());
            }
        });

        // Handler mousemove khusus fullscreen
        const onFSMouseMove = () => {
            showBar();
            clearTimeout(mouseMoveTimer);
            mouseMoveTimer = setTimeout(() => {
                if (!video.paused) hideBar(0);
            }, 2500);
        };

        document.addEventListener('fullscreenchange', () => {
            if (document.fullscreenElement === wrapper) {
                // ── Masuk fullscreen ──
                isFS = true;

                css(wrapper, {
                    position:       'fixed',
                    inset:          '0',
                    width:          '100vw',
                    height:         '100vh',
                    zIndex:         '2147483646',
                    background:     '#000',
                    display:        'flex',
                    alignItems:     'center',
                    justifyContent: 'center',
                });
                css(video, {
                    width:     '100%',
                    height:    '100%',
                    maxWidth:  '100vw',
                    maxHeight: '100vh',
                    objectFit: 'contain',
                });

                setModeFullscreen();
                wrapper.addEventListener('mousemove', onFSMouseMove, { passive: true });
                showBar();
                hideBar(3000);

            } else if (isFS) {
                // ── Keluar fullscreen ──
                isFS = false;
                wrapper.removeEventListener('mousemove', onFSMouseMove);

                css(wrapper, {
                    position:       '',
                    inset:          '',
                    width:          '',
                    height:         '',
                    zIndex:         '',
                    background:     'transparent',
                    display:        'inline-block',
                    alignItems:     '',
                    justifyContent: '',
                });
                css(video, {
                    width:     '',
                    height:    '',
                    maxWidth:  '',
                    maxHeight: '',
                    objectFit: '',
                });

                setModeNormal();
                showBar();
                hideBar(2000);
            }
        });

        // ── FIX: black screen saat scroll ────────────
        let scrollTimer;
        window.addEventListener('scroll', () => {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                requestAnimationFrame(() => {
                    wrapper.style.transform = 'translateZ(0)';
                    requestAnimationFrame(() => { wrapper.style.transform = ''; });
                });
            }, 60);
        }, { passive: true });

        // ── Mulai dalam mode normal ───────────────────
        setModeNormal();
    }

    // ────────────────────────────────────────────────
    //  Proses satu video
    // ────────────────────────────────────────────────
    function processVideo(video) {
        if (video.dataset.cvpDone) return;
        video.dataset.cvpDone = '1';
        removeVideoRestrictions(video);
        applyCustomPlayer(video);
    }

    // ────────────────────────────────────────────────
    //  Init
    // ────────────────────────────────────────────────
    function init() {
        document.querySelectorAll('video').forEach(processVideo);

        if (typeof document.arrive === 'function') {
            document.arrive('video', { onceOnly: false }, function () {
                processVideo(this);
            });
        }

        new MutationObserver(muts => {
            muts.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeName === 'VIDEO') processVideo(n);
                else if (n.querySelectorAll) n.querySelectorAll('video').forEach(processVideo);
            }));
        }).observe(document.body || document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    setTimeout(() => document.querySelectorAll('video').forEach(processVideo), 3000);

})();