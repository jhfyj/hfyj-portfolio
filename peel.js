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
    // The curl, traced from Jen's reference (a page corner curled back,
    // Nov 13 2 AM), turned to sit at the top right. Drawn in a 100 x 64 box
    // that keeps that shape at every size (peel.css sizes it 100:64).
    //  - The fold runs from the top edge at (0,0) down to the right edge at
    //    (100,52.6), long and shallow, bowing very slightly like bent paper.
    //  - The flap's left edge leaves the corner hugging the fold, then peels
    //    away and curves down into a broad rounded tip; its bottom edge
    //    runs on to the right edge and rolls gently up into it.
    //  - Under the flap, the revealed corner gets a soft shadow along the
    //    fold that fades toward the corner.
    // revealPath() below uses the same fold for the page underneath.
    var FOLD = 'Q50 28.5 0 0';
    // Nov 13, 2:30 AM (Jen: "the little tip of the paper bends suddenly"):
    // the outline is now one smooth sweep. The left edge curves down into a
    // broad rounded tip and carries straight on along the bottom edge, which
    // rises gently to the right edge. No hook at the tip and no dip before
    // the right edge; every join keeps the same direction on both sides.
    var LEAF = 'M0 0 C28 17.5 50 36 61 54 C64.5 59.5 69 63 75 62.4 ' +
        'C83 61.4 90 59.6 95 58.6 C98 58 99.7 57 100 55.4 L100 52.6 ' + FOLD + ' Z';
    var UNDER = 'M0 0 L100 0 L100 52.6 ' + FOLD + ' Z';
    peel.innerHTML =
        '<svg class="peel-under" viewBox="0 0 100 64" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
            // The shadow runs across the fold: dark right at it, gone about
            // halfway to the corner.
            '<defs><linearGradient id="peel-shade" gradientUnits="userSpaceOnUse" x1="50" y1="26.3" x2="70" y2="-11.7">' +
                '<stop class="ps-0" offset="0"/>' +
                '<stop class="ps-1" offset="0.35"/>' +
                '<stop class="ps-2" offset="1"/>' +
            '</linearGradient></defs>' +
            '<path class="pu-base" d="' + UNDER + '"/>' +
            '<path class="pu-shade" d="' + UNDER + '" fill="url(#peel-shade)"/>' +
        '</svg>' +
        '<span class="peel-flap-wrap" aria-hidden="true">' +
            '<svg class="peel-flap" viewBox="0 0 100 64" preserveAspectRatio="none" focusable="false">' +
                // The back of the paper is shaded across the fold too: a
                // bright roll right at the fold, a grey band through the
                // middle of the flap, lighter again toward the tip.
                '<defs><linearGradient id="peel-back" gradientUnits="userSpaceOnUse" x1="50" y1="26.3" x2="38.4" y2="48.4">' +
                    '<stop class="pf-0" offset="0"/>' +
                    '<stop class="pf-1" offset="0.08"/>' +
                    '<stop class="pf-2" offset="0.45"/>' +
                    '<stop class="pf-3" offset="0.7"/>' +
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
        return 'path("M' + x0 + ' 0 L' + W + ' 0 L' + W + ' ' + (52.6 * k) +
            ' Q' + (x0 + 50 * k) + ' ' + (28.5 * k) + ' ' + x0 + ' 0 Z")';
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
        // Big enough that the fold has left the screen entirely: the fold
        // drops 0.526 px for every px it runs left, so it clears the bottom
        // left corner of the window once the box is W + H / 0.526 wide.
        var D = Math.ceil(W + H / 0.526) + 80;
        peel.style.viewTransitionName = 'theme-peel';
        var vt = document.startViewTransition(function () {
            pressToggle();
            // The curl being swept across is the page being peeled off, so it
            // keeps the old page's paper. Nothing behind it shows mid-sweep.
            peel.dataset.paper = from;
            peel.classList.add('is-sweeping');
            peel.style.width = D + 'px';
            peel.style.height = (D * 0.64) + 'px';
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
