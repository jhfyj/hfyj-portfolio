/* Shared page chrome: the theme toggle, the top bar, the custom cursor, and the
   scroll-reveal helper each page calls with its own list of stagger groups. */

window.Site = (function () {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Theme (light ↔ dark) ─────────────────────────────────────────────────
    //
    // The key and its two values are index.html/script.js's, on purpose: a
    // reader who picks dark on the home page has to arrive on a case page
    // already dark, and the same choice made here has to survive the trip back.
    // One shared key is the whole mechanism; if this ever diverges from
    // THEME_KEY in script.js the two halves of the site stop agreeing.
    //
    // Everything visual is already settled by the time this runs. The inline
    // block in each page's <head> resolves the theme and stamps it on <html>
    // before the first paint, and site.css keys the palette and the icon swap
    // off that attribute. So this file only has to own the *choice*: read what
    // the head decided, write the new one, and persist it.
    const THEME_KEY = 'theme';
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

    // Storage throws outright in some privacy modes rather than returning null,
    // and a theme toggle is not worth taking the page down over.
    function readStoredTheme() {
        try {
            const saved = localStorage.getItem(THEME_KEY);
            return (saved === 'dark' || saved === 'light') ? saved : null;
        } catch (err) { return null; }
    }

    const themeToggle = document.getElementById('theme-toggle');

    function syncThemeButton(theme) {
        // aria-pressed, not a changing label: this is one control whose state
        // flips, and a screen reader announces the new state on press. The
        // sighted equivalent is the sun/moon swap, which CSS already handles.
        if (themeToggle) themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
    }

    function applyTheme(theme, persist) {
        document.documentElement.setAttribute('data-theme', theme);
        // Only an explicit press is written down. Persisting the system default
        // too would freeze it: the reader would be pinned to whatever their OS
        // happened to be on the first visit, and switching the OS afterwards
        // would do nothing.
        if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch (err) {} }
        syncThemeButton(theme);
        // The favicon is a second surface with a light and a dark cut; the home
        // page swaps it on the same event, so a case page must too or the tab
        // icon disagrees with the tab.
        const favicon = document.getElementById('favicon');
        if (favicon) favicon.href = theme === 'dark' ? './assets/favicon-dark.svg' : './assets/favicon-light.svg';
    }

    // <html> is the source of truth, because the head block already wrote it —
    // re-deriving the theme here would just be a second chance to disagree.
    syncThemeButton(document.documentElement.getAttribute('data-theme'));

    if (themeToggle) {
        themeToggle.addEventListener('click', function () {
            const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            applyTheme(next, true);
        });
    }

    // Nothing stored means the page is still mirroring the OS, so it should
    // keep mirroring it if the OS changes mid-visit — a reader on a scheduled
    // dark mode shouldn't have to reload at sunset. A stored choice outranks
    // this, which is why the guard reads storage rather than a local flag.
    const onSystemTheme = function (e) {
        if (readStoredTheme()) return;
        applyTheme(e.matches ? 'dark' : 'light', false);
    };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemTheme);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemTheme);   // Safari < 14

    // Restored from the back/forward cache rather than loaded. The document was
    // never re-parsed, so the <head> block that resolves the theme never ran
    // again and <html> still carries whatever this page was left in — which is
    // stale the moment the reader pressed the toggle somewhere else in between.
    // Back and forward are ordinary ways around this site (card-transition.js
    // goes home with history.back() so the carousel does not have to be
    // rebuilt), so the choice has to be re-read here.
    //
    // Not persisted: this is catching up with a choice, not making one. script.js
    // carries the same handler for the home page.
    window.addEventListener('pageshow', function (e) {
        if (!e.persisted) return;
        applyTheme(readStoredTheme() || (darkQuery.matches ? 'dark' : 'light'), false);
    });

    // Hides on the way down, comes back on the way up, and is always there at
    // the very top. The 6px deadband keeps trackpad jitter from flapping it.
    const topbar = document.getElementById('topbar');
    if (topbar) {
        const TOP = 20;
        const DEADBAND = 6;
        let lastY = window.scrollY;
        let ticking = false;

        const sync = function () {
            ticking = false;
            const y = Math.max(0, window.scrollY);
            const delta = y - lastY;
            if (Math.abs(delta) < DEADBAND && y > TOP) return;
            lastY = y;

            topbar.classList.toggle('is-hidden', y > TOP && delta > 0);
            // only floating over content once it has left its resting place
            topbar.classList.toggle('is-floating', y > TOP);
        };

        window.addEventListener('scroll', function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(sync);
        }, { passive: true });
        sync();
    }

    const dot = document.getElementById('cursor-dot');
    if (dot && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        document.body.classList.add('has-dot');
        window.addEventListener('mousemove', function (e) {
            dot.style.transform = 'translate(' + e.clientX + 'px, ' + e.clientY + 'px)';
            document.body.classList.add('dot-live');
        }, { passive: true });
        // hide it when the pointer leaves the window entirely
        document.addEventListener('mouseleave', function () { dot.style.opacity = '0'; });
        document.addEventListener('mouseenter', function () { dot.style.opacity = ''; });

        // Anything with data-cursor swaps the dot for a labelled pill.
        const label = document.getElementById('cursor-label');
        let hot = null;
        document.addEventListener('mouseover', function (e) {
            const t = e.target.closest ? e.target.closest('[data-cursor]') : null;
            if (t === hot) return;
            hot = t;
            if (t) {
                if (label) label.textContent = t.getAttribute('data-cursor');
                // An optional glyph ahead of the words, named by the element
                // rather than drawn by it: the pill stays one element on every
                // page and site.css decides what each name looks like.
                dot.setAttribute('data-icon', t.getAttribute('data-cursor-icon') || '');
                dot.classList.add('is-pill');
            } else {
                dot.classList.remove('is-pill');
            }
        }, { passive: true });
    }

    // Each selector is one stagger run: matched siblings rise 70ms apart as they
    // scroll into view. Hidden from JS so the page is never blank without it.
    //
    // The rise is a Web Animation rather than a CSS class. A class-driven
    // transition would also animate the *hiding*, so anything already in view
    // when the page loads faded down and straight back up instead of rising in;
    // it would also have to out-specify each page's own hover and colour
    // transitions on the same elements. This touches neither.
    // A spring expressed as a linear() easing: sample the damped oscillator and
    // hand the samples over, letting the browser interpolate between them. This
    // is how a spring reaches CSS without running physics every frame, and
    // unlike any cubic-bezier it can overshoot the target and come back.
    // Null on engines without linear(), where callers keep the plain ease.
    const springEasing = (function () {
        if (!(window.CSS && CSS.supports &&
              CSS.supports('animation-timing-function', 'linear(0, 1)'))) return null;
        // State the overshoot, derive the damping. How far a spring's first
        // swing carries past its target is an exact function of the damping
        // ratio, so the readable direction is to name the thing you can see —
        // the overshoot, as a fraction of the travel — and solve for the rest.
        // 4% of the cards' 300px rise is the ~12px they carry past.
        const OVERSHOOT = 0.041;
        const lnO = Math.log(OVERSHOOT);
        const ZETA = -lnO / Math.sqrt(Math.PI * Math.PI + lnO * lnO);
        const OMEGA = 12;    // normalised so the envelope is spent by t = 1
        // Enough samples that the straight segments between them do not chord
        // the tip off the peak, which is the part being tuned here.
        const N = 90;
        const wd = OMEGA * Math.sqrt(1 - ZETA * ZETA);
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const t = i / N;
            pts.push((1 - Math.exp(-ZETA * OMEGA * t) *
                (Math.cos(wd * t) + (ZETA * OMEGA / wd) * Math.sin(wd * t))).toFixed(4));
        }
        // pin the ends: the samples land a rounding error short of 0 and 1
        pts[0] = '0';
        pts[N] = '1';
        return 'linear(' + pts.join(',') + ')';
    })();

    function reveal(groups) {
        if (reduceMotion || !('IntersectionObserver' in window)) return;

        // A card → page transition, when there is one in flight, is already
        // carrying the hero and the <h1> into place from the card that was
        // clicked (card-transition.js). Those two are its to hand over, so they
        // are left out of the reveal entirely — otherwise both would be fading
        // the same elements in at once, from different places.
        const ct = window.CardTransition;
        const spokenFor = function (el) { return !!(ct && ct.active && ct.owns(el)); };

        const delays = new Map();
        groups.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (el, i) {
                if (delays.has(el) || spokenFor(el)) return;
                delays.set(el, i * 70);
                el.style.opacity = '0';
            });
        });

        let io;

        // Opt-in, read off the element the same way --rise and --rise-ms are.
        const wantsReplay = function (el) {
            return parseFloat(getComputedStyle(el).getPropertyValue('--rise-replay')) === 1;
        };
        // Elements with a rise in flight. The rise starts by displacing the
        // element — 300px for the cards — and that displacement can carry it
        // straight back out of the observer's box. Without this the leave
        // handler below would reset it, the reset would bring it back in, and
        // the two would trade places every frame with the animation restarting
        // from zero each time and never advancing.
        const rising = new Set();

        // Failsafe. reveal() hides these elements from JS, so anything the
        // observer misses would stay invisible for good — a blank section with
        // no way to recover. After scrolling settles, show whatever is on
        // screen and still hidden. The delay is far longer than the observer
        // takes, so a normal reveal always animates and never trips this.
        let settle = null;
        const sweep = function () {
            let hidden = 0;
            delays.forEach(function (_, el) {
                if (el.style.opacity !== '0') return;
                if (el.getBoundingClientRect().top < window.innerHeight) {
                    el.style.opacity = '';
                    // a replaying element stays observed, or it could never
                    // rise again on the way back down
                    if (!wantsReplay(el)) io.unobserve(el);
                } else {
                    hidden++;
                }
            });
            if (!hidden) window.removeEventListener('scroll', onScroll);
        };
        const onScroll = function () {
            clearTimeout(settle);
            settle = setTimeout(sweep, 900);
        };
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();

        io = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                const replayable = wantsReplay(e.target);

                if (!e.isIntersecting) {
                    // Most blocks reveal once and are done. A block that opts
                    // into replay goes back to hidden on the way out instead,
                    // so scrolling down to it a second time plays it again.
                    // Only a leave with nothing in flight is the reader
                    // actually scrolling away; see `rising` above.
                    if (replayable && !rising.has(e.target)) e.target.style.opacity = '0';
                    return;
                }
                // already shown, or already on its way in
                if (replayable && e.target.style.opacity !== '0') return;
                if (!replayable) io.unobserve(e.target);

                // Keep whatever transform the element already carries (the
                // tilted photos and cards) and rise from below it. Distance and
                // duration come from CSS so a block can ask for a longer travel
                // than the default nudge — the next-project cards slide a long
                // way up out of their clip — without a second code path here.
                const cs = getComputedStyle(e.target);
                const base = cs.transform;
                const dy = parseFloat(cs.getPropertyValue('--rise')) || 26;
                const ms = parseFloat(cs.getPropertyValue('--rise-ms')) || 700;
                const spring = springEasing &&
                    parseFloat(cs.getPropertyValue('--rise-spring')) === 1;
                // Both keyframes carry the same function list — a translateY
                // in front of whatever the element already had. That is what
                // lets a spring overshoot: matched lists interpolate function
                // by function and extrapolate past the endpoints, while
                // mismatched ones fall back to decomposing the matrix, which
                // stops dead at the last keyframe and swallows the overshoot.
                const shift = 'translateY(' + dy + 'px)';
                const settled = 'translateY(0px)';
                const rise = base === 'none' ? shift : shift + ' ' + base;
                const rest = base === 'none' ? settled : settled + ' ' + base;

                e.target.style.opacity = '';
                const anim = e.target.animate(
                    [{ opacity: 0, transform: rise }, { opacity: 1, transform: rest }],
                    {
                        duration: ms,
                        delay: delays.get(e.target) || 0,
                        easing: spring ? springEasing : 'cubic-bezier(.22, .61, .36, 1)',
                        fill: 'backwards',
                    }
                );

                if (replayable) {
                    const el = e.target;
                    rising.add(el);
                    const done = function () {
                        rising.delete(el);
                        // If the reader scrolled clear of it mid-rise, the leave
                        // above was ignored as self-inflicted. Settle up now, so
                        // the next approach still gets a rise.
                        const r = el.getBoundingClientRect();
                        if (r.top > window.innerHeight || r.bottom < 0) el.style.opacity = '0';
                    };
                    anim.finished.then(done, function () { rising.delete(el); });
                }
            });
        }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

        delays.forEach(function (_, el) { io.observe(el); });
    }

    return { reduceMotion: reduceMotion, reveal: reveal };
})();
