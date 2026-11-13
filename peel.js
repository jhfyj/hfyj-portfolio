// Peel-back corner (Jen, Nov 13). See peel.css for how the corner is drawn.
//
// The theme itself is still switched by each page's own #theme-toggle
// handler (script.js on the home page, site.js elsewhere), which this just
// presses. The button stays in the page, hidden, so every place that already
// knows how to apply a theme keeps doing it and nothing is duplicated here.
(function () {
    'use strict';


    var root = document.documentElement;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    function theme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

    var peel = document.createElement('button');
    peel.id = 'theme-peel';
    peel.type = 'button';
    // The curl, drawn in a 100 x 100 box that stretches with the corner
    // (Jen's reference: a curled page corner). The fold runs from the top
    // edge (30,0) to the right edge (100,70) and bows a little toward the
    // flap, like paper that is bent rather than creased. The flap's left
    // edge runs down to a sharp point at the bottom left (it reaches a bit
    // past the box), and its outer edge swells out as it rolls back up to
    // the fold.
    // revealPath() below uses the same fold for the page underneath.
    var FOLD = 'Q45 55 30 0';
    var LEAF = 'M30 0 C28 44 14 86 -2 112 C36 96 84 94 100 70 ' + FOLD + ' Z';
    var UNDER = 'M30 0 L100 0 L100 70 ' + FOLD + ' Z';
    peel.innerHTML =
        '<svg class="peel-under" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
            '<path d="' + UNDER + '"/>' +
        '</svg>' +
        '<span class="peel-flap-wrap" aria-hidden="true">' +
            '<svg class="peel-flap" viewBox="0 0 100 100" preserveAspectRatio="none" focusable="false">' +
                '<defs><linearGradient id="peel-back" x1="0.1" y1="0.62" x2="0.62" y2="0.42">' +
                    '<stop class="pf-0" offset="0"/>' +
                    '<stop class="pf-1" offset="0.2"/>' +
                    '<stop class="pf-2" offset="0.55"/>' +
                    '<stop class="pf-3" offset="0.85"/>' +
                    '<stop class="pf-4" offset="1"/>' +
                '</linearGradient></defs>' +
                '<path d="' + LEAF + '" fill="url(#peel-back)"/>' +
            '</svg>' +
        '</span>';
    document.body.appendChild(peel);

    function sync() {
        var t = theme();
        peel.dataset.paper = t;
        var label = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
        peel.setAttribute('aria-label', label);
        peel.title = label;
    }
    sync();

    // A theme can change without the corner (the OS, a back/forward restore):
    // keep the curl showing the right side.
    new MutationObserver(function () {
        if (!peel.classList.contains('is-sweeping')) sync();
    }).observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    // Curl in with the nav. On the home page the nav waits for the cards to
    // finish building; everywhere else it is there from the start.
    // A project page inside the small pop-up keeps its old button; the
    // corner curls in once the pop-up goes full screen (site.js swaps
    // in-modal for in-frame-full on <html>).
    function curlIn() {
        if (root.classList.contains('in-modal')) return;
        peel.classList.add('is-in');
    }
    if (root.classList.contains('in-modal')) {
        var mm = new MutationObserver(function () {
            if (!root.classList.contains('in-modal')) { mm.disconnect(); setTimeout(curlIn, 350); }
        });
        mm.observe(root, { attributes: true, attributeFilter: ['class'] });
    }
    var nav = document.getElementById('top-nav');
    if (nav && !nav.classList.contains('visible')) {
        var mo = new MutationObserver(function () {
            if (nav.classList.contains('visible')) { mo.disconnect(); setTimeout(curlIn, 250); }
        });
        mo.observe(nav, { attributes: true, attributeFilter: ['class'] });
    } else {
        setTimeout(curlIn, 300);
    }

    function pressToggle() {
        var btn = document.getElementById('theme-toggle');
        if (btn) btn.click();
    }

    // The part of the screen behind the corner, as a clip path in pixels:
    // the same shape as UNDER, for a corner box of size s at the top right
    // of a W-wide window. Same commands at every size, so it animates.
    function revealPath(W, s) {
        var x0 = W - s, k = s / 100;
        return 'path("M' + (x0 + 30 * k) + ' 0 L' + W + ' 0 L' + W + ' ' + (70 * k) +
            ' Q' + (x0 + 45 * k) + ' ' + (55 * k) + ' ' + (x0 + 30 * k) + ' 0 Z")';
    }

    var busy = false;
    peel.addEventListener('click', function () {
        if (busy) return;
        var from = theme();
        var to = from === 'dark' ? 'light' : 'dark';

        if (!document.startViewTransition || reduce.matches) {
            pressToggle();
            sync();
            return;
        }

        busy = true;
        var W = window.innerWidth;
        var H = window.innerHeight;
        var s = peel.getBoundingClientRect().width;
        // Big enough that the fold has left the screen entirely: the fold's
        // ends sit 70% of the box in from the corner, and a right triangle
        // with legs W + H covers the whole viewport.
        var D = Math.ceil((W + H) / 0.7) + 80;

        peel.style.viewTransitionName = 'theme-peel';
        var vt = document.startViewTransition(function () {
            pressToggle();
            // The curl being swept across is the page being peeled off, so it
            // keeps the old page's paper. Nothing behind it shows mid-sweep.
            peel.dataset.paper = from;
            peel.classList.add('is-sweeping');
            peel.style.width = D + 'px';
            peel.style.height = D + 'px';
            // Give the WebGL cards a moment to redraw in the new theme before
            // the new page is captured.
            return new Promise(function (r) { setTimeout(r, 90); });
        });

        vt.ready.then(function () {
            root.animate({
                clipPath: [revealPath(W, s), revealPath(W, D)]
            }, {
                duration: 950,
                easing: 'cubic-bezier(0.55, 0, 0.2, 1)',
                fill: 'both',
                pseudoElement: '::view-transition-new(root)'
            });
        }).catch(function () {});

        vt.finished.finally(function () {
            // Put the corner back at nothing, then let it curl in fresh,
            // now showing what is behind the new side.
            peel.style.viewTransitionName = '';
            peel.classList.remove('is-in');
            peel.style.width = '';
            peel.style.height = '';
            sync();
            void peel.offsetWidth;
            peel.classList.remove('is-sweeping');
            setTimeout(function () { curlIn(); busy = false; }, 120);
        });
    });
})();
