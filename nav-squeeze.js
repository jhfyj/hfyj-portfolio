/*NSQDBG-START*/
(function () {
    try { if (/nsqdbg=1/.test(location.search)) localStorage.setItem('nsqdbg', '1'); if (/nsqdbg=0/.test(location.search)) localStorage.removeItem('nsqdbg'); } catch (e) {}
    var on = false; try { on = !!localStorage.getItem('nsqdbg'); } catch (e) {}
    if (!on) return;
    var page = location.pathname.split('/').pop() || 'index.html';
    function push(o) { try { var a = JSON.parse(localStorage.getItem('nsqlog') || '[]'); a.push(o); localStorage.setItem('nsqlog', JSON.stringify(a.slice(-400))); } catch (e) {} }
    var t0 = performance.now();
    push({ p: page, ev: 'script', t: 0, nav: (window.navigation && navigation.activation) ? navigation.activation.navigationType : '?', ref: document.referrer.split('/').pop() });
    window.addEventListener('pageswap', function (e) { push({ p: page, ev: 'pageswap', vt: !!e.viewTransition, to: e.activation && e.activation.entry ? e.activation.entry.url.split('/').pop() : '?', type: e.activation ? e.activation.navigationType : '?' }); });
    window.addEventListener('pageshow', function (e) { push({ p: page, ev: 'pageshow', persisted: e.persisted, t: Math.round(performance.now() - t0) }); if (e.persisted) frames('bfcache'); });
    window.addEventListener('pagereveal', function (e) { push({ p: page, ev: 'pagereveal', vt: !!e.viewTransition, t: Math.round(performance.now() - t0) }); frames('reveal'); });
    var running = false;
    function frames(tag) {
        if (running) return; running = true;
        var start = performance.now(), rows = [];
        (function tick() {
            var now = performance.now() - start;
            var tn = document.getElementById('top-nav') || document.getElementById('topbar');
            var c = tn && tn.querySelector('.nav-cluster');
            if (c) {
                var r = c.getBoundingClientRect(), cs = getComputedStyle(tn), ccs = getComputedStyle(c);
                var sw = tn.querySelector('.view-switch, .nsq-switch');
                rows.push([Math.round(now), (+cs.opacity).toFixed(2), cs.transform === 'none' ? '-' : cs.transform.replace(/matrix\(1, 0, 0, 1, /, 'T(').slice(0, 20), Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height), ccs.backgroundColor.replace(/ /g, ''), (+ccs.opacity).toFixed(2), sw ? Math.round(sw.getBoundingClientRect().width) : 'none', (tn.className || '').replace(/\s+/g, '.'), ['data-nav-carry', 'data-card-return', 'data-intro-done'].filter(function (a) { return root().hasAttribute(a); }).join('|')].join(' '));
            }
            if (now < 1600) requestAnimationFrame(tick); else { push({ p: page, ev: 'frames-' + tag, rows: rows }); running = false; }
        })();
    }
    function root() { return document.documentElement; }
})();
/*NSQDBG-END*/
// One nav across pages, with the card / grid switch (Jen, Nov 16).
//
// Home's nav pill has the card / grid switch at its right end; About Me and
// Playground don't. Moving between them, the pill should not reload: it
// stays on screen (the site-nav view transition holds it) and the switch is
// smashed in, squashed sideways against the links while the pill closes up
// around it. Coming back Home it is the reverse: the pill opens and the
// switch springs back out.
//
// How: the page arriving shows the nav exactly as the page leaving had it,
// so the view transition has nothing to morph, then this plays the squash
// (or the un-squash) once the transition is done.
//  - About Me / Playground: a copy of the switch (and the gap before it) is
//    put in the pill before the first frame, then squashed away and removed.
//  - Home: the real switch starts squashed, then opens out.
// The switch itself is never scaled (its icons keep their shape): the pill's
// right edge slides in over it, clipping it as it goes, and it fades out.
// Must be a plain script in <head>: pagereveal fires before the first frame.
(function () {
    'use strict';

    var root = document.documentElement;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function pathOf(url) {
        try { return new URL(url, location.href).pathname; } catch (e) { return ''; }
    }
    function isHome(p) { return /(^|\/)(index\.html)?$/.test(p); }
    function isSub(p) { return /(aboutme|playground)\.html$/.test(p); }

    // Where we came from. The Navigation API knows even for scripted
    // navigations (the Playground card); the referrer covers the rest.
    var fromUrl = '';
    try {
        var act = window.navigation && navigation.activation;
        if (act && act.navigationType === 'reload') return;
        if (act && act.from && act.from.url) fromUrl = act.from.url;
    } catch (e) {}
    if (!fromUrl) fromUrl = document.referrer || '';
    if (!fromUrl) return;
    try { if (new URL(fromUrl).origin !== location.origin) return; } catch (e) { return; }

    var here = location.pathname;
    var from = pathOf(fromUrl);
    var mode = null;
    if (isSub(here) && isHome(from)) mode = 'squash';
    else if (isHome(here) && isSub(from)) mode = 'open';
    if (!mode) return;

    var DUR = 560;
    var EASE = 'cubic-bezier(0.6, 0, 0.25, 1)';
    var built = false;
    var anims = [];
    var cleanup = null;

    function frames(sw, gap, w) {
        // full -> tucked away. Nov 16 (Jen: "don't squash the width of the
        // element"): the switch is never scaled, so its icons keep their exact
        // shape. Instead the pill's right edge slides in over it: a negative
        // right margin pulls the edge in while a clip of the same width hides
        // whatever has passed under it, and the switch fades on the way out.
        // The pill keeps one height on every page (peel.css), so the logo and
        // links never move up or down.
        return {
            sw: [
                { clipPath: 'inset(0 0px 0 0 round 13px)', marginRight: '0px', opacity: 1, offset: 0 },
                { opacity: 1, offset: 0.4 },
                { clipPath: 'inset(0 ' + w + 'px 0 0 round 13px)', marginRight: (-w) + 'px', opacity: 0, offset: 1 }
            ],
            gap: [
                { flexBasis: gap + 'px', width: gap + 'px' },
                { flexBasis: '0px', width: '0px' }
            ]
        };
    }

    function setup() {
        if (built) return;
        if (mode === 'squash') {
            var cluster = document.querySelector('#topbar.home-nav .nav-cluster');
            var links = cluster && cluster.querySelector('#nav-links');
            if (!links) return;
            built = true;
            var view = 'cards';
            try {
                var st = JSON.parse(sessionStorage.getItem('homeViewState'));
                if (st && st.view === 'grid') view = 'grid';
            } catch (e) {}
            var gap = document.createElement('div');
            gap.className = 'nsq-gap';
            gap.setAttribute('aria-hidden', 'true');
            var sw = document.createElement('div');
            sw.className = 'nsq-switch';
            sw.setAttribute('aria-hidden', 'true');
            sw.dataset.active = view;
            sw.innerHTML =
                '<span class="nsq-thumb"></span>' +
                '<span class="nsq-btn' + (view === 'cards' ? ' is-on' : '') + '" data-view="cards">' +
                    '<svg viewBox="-4 0 26 18" fill="none" style="overflow:visible">' +
                        '<rect class="card-left" x="3" y="3" width="9" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/>' +
                        '<rect class="card-right" x="6" y="3" width="9" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/>' +
                    '</svg></span>' +
                '<span class="nsq-btn' + (view === 'grid' ? ' is-on' : '') + '" data-view="grid">' +
                    '<svg viewBox="0 0 18 18" fill="none">' +
                        '<rect x="2" y="2" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.4"/>' +
                        '<rect x="10" y="2" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.4"/>' +
                        '<rect x="2" y="10" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.4"/>' +
                        '<rect x="10" y="10" width="6" height="6" rx="1.2" stroke="currentColor" stroke-width="1.4"/>' +
                    '</svg></span>';
            links.after(gap, sw);
            var f = frames(sw, 20, sw.offsetWidth);
            var opts = { duration: DUR, easing: EASE, fill: 'forwards' };
            anims = [sw.animate(f.sw, opts), gap.animate(f.gap, opts)];
            cleanup = function () { gap.remove(); sw.remove(); };
        } else {
            var nav = document.getElementById('top-nav');
            var sw2 = nav && nav.querySelector('.view-switch');
            var gap2 = nav && nav.querySelector('.nav-spacer');
            if (!sw2 || !gap2) return;
            // Only when the nav is carried over from the page before (index.html
            // sets data-nav-carry on a return visit); otherwise it fades in on
            // its own and there is nothing to open.
            if (!root.hasAttribute('data-nav-carry') && !window.__skipBuild) return;
            built = true;
            var f2 = frames(sw2, gap2.offsetWidth || 20, sw2.offsetWidth);
            var o2 = { duration: DUR, easing: EASE, direction: 'reverse', fill: 'backwards' };
            anims = [sw2.animate(f2.sw, o2), gap2.animate(f2.gap, o2)];
            cleanup = null;
        }
        // Hold on the first frame until the page's transition is over.
        anims.forEach(function (a) { a.pause(); a.currentTime = 0; });
    }

    var played = false;
    function play() {
        if (played || !built) return;
        played = true;
        anims.forEach(function (a) { a.play(); });
        Promise.all(anims.map(function (a) { return a.finished; })).then(function () {
            if (cleanup) cleanup();
            anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
        }).catch(function () {});
    }

    var gotReveal = false;
    window.addEventListener('pagereveal', function (e) {
        gotReveal = true;
        setup();
        var vt = e.viewTransition;
        if (vt) {
            vt.finished.then(function () { setTimeout(play, 40); }, function () { setTimeout(play, 40); });
        } else {
            setTimeout(play, 120);
        }
    });
    // Browsers without pagereveal: build as soon as the nav exists and play
    // just after.
    // Also the backstop if the nav wasn't parsed yet when pagereveal fired.
    document.addEventListener('DOMContentLoaded', function () {
        if (built) return;
        setup();
        setTimeout(play, gotReveal ? 60 : 150);
    });
})();
