/* Project pop-up (home page).

   Opening a project from the ring or the grid no longer jumps straight to the
   case page. It opens in a pop-up over a blurred, frosted home page: the case
   page itself, loaded with ?view=modal so site.js lays it out for the panel
   (title + theme toggle top left, the section steps bottom left, the content
   on the right, no top bar and no back link). The grey button at the top right
   of the panel goes full screen, which is simply the real case page.

   Phones skip the pop-up: there is no room for the side panel, so a tap opens
   the page the way it always has.

   script.js calls CaseModal.open(url) from openCard(); grid cards are picked up
   here with a capture-phase click so script.js never sees them. */

window.CaseModal = (function () {
    'use strict';

    const MOBILE = window.matchMedia('(max-width: 768px)');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const CLOSE_MS = reduceMotion ? 0 : 260;
    const GROW_MS = reduceMotion ? 0 : 380;
    const LEAVE_MS = reduceMotion ? 0 : 320;

    let root = null, panel = null, frame = null, fullBtn = null;
    let isOpen = false, isFull = false, closeTimer = 0;
    let lastFocus = null;
    let homeTitle = document.title, homeUrl = window.location.href;

    function withView(url) {
        const u = new URL(url, window.location.href);
        u.searchParams.set('view', 'modal');
        return u.href;
    }
    function withoutView(url) {
        const u = new URL(url, window.location.href);
        u.searchParams.delete('view');
        return u.href;
    }

    function build() {
        if (root) return;
        root = document.createElement('div');
        root.id = 'case-modal';
        root.setAttribute('aria-hidden', 'true');
        root.innerHTML =
            '<div class="cm-backdrop" data-cm-close></div>' +
            '<div class="cm-panel" role="dialog" aria-modal="true" aria-label="Project">' +
                '<iframe class="cm-frame" title="Project" name="hfyj-case-modal"></iframe>' +
                '<button class="cm-full" type="button" title="Open full screen" aria-label="Open full screen">' +
                    '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
                        '<path d="M2 6V2H6M10 2H14V6M14 10V14H10M6 14H2V10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
                    '</svg>' +
                '</button>' +
            '</div>';
        document.body.appendChild(root);
        panel = root.querySelector('.cm-panel');
        frame = root.querySelector('.cm-frame');
        fullBtn = root.querySelector('.cm-full');

        root.querySelector('[data-cm-close]').addEventListener('click', close);
        fullBtn.addEventListener('click', goFull);

        frame.addEventListener('load', onFrameLoad);

        // Nothing behind the pop-up should react while it is up: no ring
        // spinning under a scroll, no drag picking up a card through the blur.
        ['wheel', 'pointerdown', 'mousedown', 'touchstart', 'touchmove', 'click', 'dblclick'].forEach(function (type) {
            root.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
        });
        root.addEventListener('wheel', function (e) { e.preventDefault(); }, { passive: false });

        // The page's own cursor dot cannot follow the pointer into the iframe
        // (the case page draws its own there), so it steps aside over the panel.
        panel.addEventListener('pointerenter', function () { document.documentElement.classList.add('cm-over-panel'); });
        panel.addEventListener('pointerleave', function () { document.documentElement.classList.remove('cm-over-panel'); });
        // ...except over the full-screen button, which lives on this page
        fullBtn.addEventListener('pointerenter', function () { document.documentElement.classList.remove('cm-over-panel'); });
        fullBtn.addEventListener('pointerleave', function () { document.documentElement.classList.add('cm-over-panel'); });
    }

    function onFrameLoad() {
        if (!isOpen) return;
        root.classList.add('is-loaded');
        // Moved to another project while expanded: the address and the tab
        // title follow it, so a refresh or a shared link lands on the same page.
        if (isFull) syncAddress(true);
        try { frame.contentWindow.focus(); } catch (err) {}
    }

    // A new frame for every opening. A frame's first page never adds a
    // history entry, where pointing a used frame somewhere new does — and
    // those entries would sit on the home page's Back button.
    function freshFrame() {
        const f = document.createElement('iframe');
        f.className = 'cm-frame';
        f.title = 'Project';
        f.name = 'hfyj-case-modal';
        f.addEventListener('load', onFrameLoad);
        frame.replaceWith(f);
        frame = f;
    }

    function canOpen() {
        return !MOBILE.matches;
    }

    function open(url) {
        if (!canOpen()) return false;
        build();
        window.clearTimeout(closeTimer);
        lastFocus = document.activeElement;
        root.classList.remove('is-loaded', 'is-growing', 'is-full', 'is-closing', 'is-leaving');
        panel.style.cssText = '';
        freshFrame();
        frame.src = withView(url);
        root.setAttribute('aria-hidden', 'false');
        document.documentElement.classList.add('cm-open');
        isOpen = true;
        // next frame, so the opening transition has a start to run from
        requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('is-open'); }); });
        return true;
    }

    function close() {
        if (!isOpen) return;
        // Expanded: the page's address is on the history stack, so step back
        // over it and let popstate do the leaving; Back in the browser and the
        // back button then behave the same.
        if (isFull) {
            if (history.state && history.state.cmFull) {
                history.back();
                // if Back does not bring popstate here, leave anyway
                window.setTimeout(function () {
                    if (isFull) { try { history.replaceState(null, '', homeUrl); } catch (err) {} leaveFull(); }
                }, 400);
            } else {
                try { history.replaceState(null, '', homeUrl); } catch (err) {}
                leaveFull();
            }
            return;
        }
        isOpen = false;
        root.classList.remove('is-open');
        root.classList.add('is-closing');
        document.documentElement.classList.remove('cm-open', 'cm-over-panel');
        root.setAttribute('aria-hidden', 'true');
        closeTimer = window.setTimeout(function () {
            root.classList.remove('is-loaded', 'is-closing');
            frame.removeAttribute('src');
            try { frame.contentWindow.location.replace('about:blank'); } catch (err) {}
        }, CLOSE_MS);
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (err) {} }
    }

    // Full screen: the page in the panel switches to its full layout where it
    // stands (back button in, title down) while the panel grows to the edges
    // of the window. Nothing reloads: the reader keeps their place, and the
    // address bar takes the real page's address so a refresh, a shared link
    // or Back all do what they should.
    function goFull() {
        if (!isOpen || isFull) return;
        const r = panel.getBoundingClientRect();
        panel.style.setProperty('--cm-from-x', r.left + 'px');
        panel.style.setProperty('--cm-from-y', r.top + 'px');
        try { frame.contentWindow.postMessage({ type: 'hfyj-modal:full' }, window.location.origin); } catch (err) {}
        root.classList.add('is-growing');
        homeUrl = window.location.href;
        homeTitle = document.title;
        isFull = true;
        syncAddress(false);
        window.setTimeout(function () {
            if (!isFull) return;
            root.classList.add('is-full');
            document.documentElement.classList.remove('cm-over-panel');
            document.documentElement.classList.add('cm-full');
        }, GROW_MS);
    }

    // The real page's address (no ?view, plus the section in view) into the
    // address bar: pushed once on expanding, replaced when moving between
    // projects while expanded.
    function syncAddress(replace) {
        let target = frame.src, docTitle = '';
        try {
            const w = frame.contentWindow;
            target = w.location.href;
            docTitle = w.document.title;
            const active = w.document.querySelector('#toc a.is-active');
            const hash = active && active.getAttribute('href');
            const u = new URL(target);
            u.hash = (hash && hash !== '#top') ? hash : '';
            target = u.href;
        } catch (err) {}
        target = withoutView(target);
        try {
            if (replace) history.replaceState({ cmFull: true }, '', target);
            else history.pushState({ cmFull: true }, '', target);
        } catch (err) {}
        if (docTitle) document.title = docTitle;
    }

    // Back to the cards from the expanded page: the cards are already right
    // here underneath, so the page simply fades away off them.
    function leaveFull() {
        if (!isOpen) return;
        isFull = false;
        isOpen = false;
        document.title = homeTitle;
        root.classList.add('is-leaving');
        document.documentElement.classList.remove('cm-open', 'cm-over-panel', 'cm-full');
        root.setAttribute('aria-hidden', 'true');
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(function () {
            root.classList.remove('is-open', 'is-loaded', 'is-growing', 'is-full', 'is-leaving');
            panel.style.cssText = '';
            frame.removeAttribute('src');
            try { frame.contentWindow.location.replace('about:blank'); } catch (err) {}
        }, LEAVE_MS);
        if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (err) {} }
    }

    window.addEventListener('popstate', function (e) {
        const st = e.state;
        if (isFull && !(st && st.cmFull)) leaveFull();
        // Forward again after leaving: that address is a real page, so load it.
        else if (!isOpen && st && st.cmFull) window.location.reload();
    });
    // The case page in the panel talks back: close, a theme press, a move to
    // another project.
    window.addEventListener('message', function (e) {
        if (e.origin !== window.location.origin) return;
        const d = e.data || {};
        if (d.type === 'hfyj-modal:close') close();
        else if (d.type === 'hfyj-modal:theme') {
            const now = document.documentElement.getAttribute('data-theme');
            if (d.theme && d.theme !== now) {
                const t = document.getElementById('theme-toggle');
                if (t) t.click();
            }
        }
    });

    document.addEventListener('keydown', function (e) {
        if (isOpen && !isFull && e.key === 'Escape') { e.preventDefault(); close(); }
    });

    // Grid view cards: the same pop-up. Capture phase, so this decides before
    // anything else on the page sees the click.
    document.addEventListener('click', function (e) {
        const a = e.target.closest && e.target.closest('#grid-view a.grid-card');
        if (!a || a.hasAttribute('data-coming-soon')) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        const href = a.getAttribute('href');
        if (!href || href === '#' || /^(aboutme|playground|sketchbook)\.html/.test(href)) return;
        if (!canOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        window.Analytics && window.Analytics.projectOpen && window.Analytics.projectOpen(href, 'grid');
        open(href);
    }, true);

    return { open: open, close: close, canOpen: canOpen, isOpen: function () { return isOpen; }, isFull: function () { return isFull; } };
})();
