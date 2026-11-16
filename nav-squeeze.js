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
// The squash is a scaleX on the switch from its left edge, while a matching
// negative right margin closes the space it held, so the pill's right edge
// moves in step with the switch's.
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
        // full -> squashed. Only the width goes: the pill keeps one height on
        // every page (peel.css), so the logo and links never move up or down.
        return {
            sw: [
                { transform: 'scaleX(1)', marginRight: '0px', opacity: 1, offset: 0 },
                { opacity: 1, offset: 0.55 },
                { transform: 'scaleX(0)', marginRight: (-w) + 'px', opacity: 0, offset: 1 }
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
            sw2.style.transformOrigin = 'left center';
            anims = [sw2.animate(f2.sw, o2), gap2.animate(f2.gap, o2)];
            cleanup = function () { sw2.style.transformOrigin = ''; };
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
