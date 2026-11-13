// Peel-back corner (Jen, Nov 13). See peel.css for how the corner is drawn.
//
// The theme itself is still switched by each page's own #theme-toggle
// handler (script.js on the home page, site.js elsewhere), which this just
// presses. The button stays in the page, hidden, so every place that already
// knows how to apply a theme keeps doing it and nothing is duplicated here.
(function () {
    'use strict';

    var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 0c.6 5.9 6.1 11.4 12 12-5.9.6-11.4 6.1-12 12-.6-5.9-6.1-11.4-12-12C5.9 11.4 11.4 5.9 12 0z"/></svg>';

    var root = document.documentElement;
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    function theme() { return root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'; }

    var peel = document.createElement('button');
    peel.id = 'theme-peel';
    peel.type = 'button';
    peel.innerHTML =
        '<span class="peel-under" aria-hidden="true">' +
            '<span class="peel-speck s1"></span><span class="peel-speck s2"></span>' +
            '<span class="peel-star">' + STAR + '</span>' +
            '<span class="peel-sun"></span>' +
        '</span>' +
        '<span class="peel-flap-wrap" aria-hidden="true"><span class="peel-flap"></span></span>';
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
        // Big enough that the fold has left the screen entirely: a right
        // triangle with legs W + H covers the whole viewport.
        var D = W + H + 60;

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
                clipPath: [
                    'polygon(' + (W - s) + 'px 0px, ' + W + 'px 0px, ' + W + 'px ' + s + 'px)',
                    'polygon(' + (W - D) + 'px 0px, ' + W + 'px 0px, ' + W + 'px ' + D + 'px)'
                ]
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
