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
//
// Nov 16 (Jen: "the transition from Playground back into the home page is not
// smooth, it refreshes"): Playground goes Home with history.back()
// (card-transition.js), so the browser usually shows Home straight from its
// back/forward cache instead of loading it. The page's scripts don't run again
// on that path, so the switch was simply there at full width and the pill
// jumped. pagereveal fires on those restores too, before the first frame, so
// the same open-out now runs there as well (and on the browser's own Back).
(function () {
    'use strict';

    var root = document.documentElement;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    function pathOf(url) {
        try { return new URL(url, location.href).pathname; } catch (e) { return ''; }
    }
    function sameOrigin(url) {
        try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
    }
    function isHome(p) { return /(^|\/)(index\.html)?$/.test(p); }
    function isSub(p) { return /(aboutme|playground)\.html$/.test(p); }

    // Every page notes itself on the way out, for the restore case below where
    // the browser may not say where we came from.
    var FROM_KEY = 'nsq:from';
    window.addEventListener('pagehide', function () {
        try { sessionStorage.setItem(FROM_KEY, JSON.stringify({ p: location.pathname, t: Date.now() })); } catch (e) {}
    });

    // Where we came from. The Navigation API knows even for scripted
    // navigations (the Playground card) and for restores; the referrer covers
    // fresh loads elsewhere, and the note above covers restores elsewhere.
    function fromPath(restored) {
        var url = '';
        try {
            var act = window.navigation && navigation.activation;
            if (act && act.navigationType === 'reload') return '';
            if (act && act.from && act.from.url) url = act.from.url;
        } catch (e) {}
        if (!url && !restored) url = document.referrer || '';
        if (url) return sameOrigin(url) ? pathOf(url) : '';
        if (restored) {
            try {
                var n = JSON.parse(sessionStorage.getItem(FROM_KEY));
                if (n && Date.now() - n.t < 10000) return n.p;
            } catch (e) {}
        }
        return '';
    }

    function modeFor(from) {
        var here = location.pathname;
        if (!from) return null;
        if (isSub(here) && isHome(from)) return 'squash';
        if (isHome(here) && isSub(from)) return 'open';
        return null;
    }

    var DUR = 560;
    var EASE = 'cubic-bezier(0.6, 0, 0.25, 1)';
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

    // One run of the animation: built before the first frame, held there,
    // played once the page's view transition (if any) is done.
    function makeRun(mode, restored) {
        var built = false, played = false, anims = [], cleanup = null;

        function setupSquash() {
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
        }

        function setupOpen() {
            var nav = document.getElementById('top-nav');
            var sw2 = nav && nav.querySelector('.view-switch');
            var gap2 = nav && nav.querySelector('.nav-spacer');
            if (!sw2 || !gap2) return;
            // Only when the nav is carried over from the page before: on a fresh
            // load index.html sets data-nav-carry; on a restore the nav is simply
            // still up. Otherwise it fades in on its own and there's nothing to open.
            var carried = restored ? nav.classList.contains('visible')
                : (root.hasAttribute('data-nav-carry') || window.__skipBuild);
            if (!carried) return;
            // A restore can land in grid view scrolled down with the nav tucked
            // away; nothing to animate then.
            if (nav.classList.contains('is-scroll-hidden')) return;
            built = true;
            var f2 = frames(sw2, gap2.offsetWidth || 20, sw2.offsetWidth);
            var o2 = { duration: DUR, easing: EASE, direction: 'reverse', fill: 'backwards' };
            anims = [sw2.animate(f2.sw, o2), gap2.animate(f2.gap, o2)];
            cleanup = null;
        }

        function setup() {
            if (built) return;
            if (mode === 'squash') setupSquash(); else setupOpen();
            // Hold on the first frame until the page's transition is over.
            anims.forEach(function (a) { a.pause(); a.currentTime = 0; });
        }

        function play() {
            if (played || !built) return;
            played = true;
            anims.forEach(function (a) { a.play(); });
            Promise.all(anims.map(function (a) { return a.finished; })).then(function () {
                if (cleanup) cleanup();
                anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
            }).catch(function () {});
        }

        return { setup: setup, play: play, isBuilt: function () { return built; } };
    }

    function playAfter(run, vt) {
        if (vt) {
            vt.finished.then(function () { setTimeout(run.play, 40); }, function () { setTimeout(run.play, 40); });
        } else {
            setTimeout(run.play, 120);
        }
    }

    // The first load.
    var first = null;
    var firstMode = modeFor(fromPath(false));
    if (firstMode) first = makeRun(firstMode, false);

    var revealed = false;
    window.addEventListener('pagereveal', function (e) {
        if (!revealed) {
            revealed = true;
            if (!first) return;
            first.setup();
            playAfter(first, e.viewTransition);
            return;
        }
        // Any later reveal is a restore from the back/forward cache.
        var mode = modeFor(fromPath(true));
        if (!mode) return;
        var run = makeRun(mode, true);
        run.setup();
        playAfter(run, e.viewTransition);
    });

    // Browsers without pagereveal: build as soon as the nav exists and play
    // just after. Also the backstop if the nav wasn't parsed yet when
    // pagereveal fired.
    document.addEventListener('DOMContentLoaded', function () {
        if (!first || first.isBuilt()) return;
        first.setup();
        setTimeout(first.play, revealed ? 60 : 150);
    });
    // Same for restores in browsers without pagereveal.
    if (!('onpagereveal' in window)) {
        window.addEventListener('pageshow', function (e) {
            if (!e.persisted) return;
            var mode = modeFor(fromPath(true));
            if (!mode) return;
            var run = makeRun(mode, true);
            run.setup();
            setTimeout(run.play, 120);
        });
    }
})();
