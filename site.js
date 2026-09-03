/* Shared page chrome: the top bar, the custom cursor, and the scroll-reveal
   helper each page calls with its own list of stagger groups. */

window.Site = (function () {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
    function reveal(groups) {
        if (reduceMotion || !('IntersectionObserver' in window)) return;

        const delays = new Map();
        groups.forEach(function (sel) {
            document.querySelectorAll(sel).forEach(function (el, i) {
                if (delays.has(el)) return;
                delays.set(el, i * 70);
                el.style.opacity = '0';
            });
        });

        let io;

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
                    io.unobserve(el);
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
                if (!e.isIntersecting) return;
                io.unobserve(e.target);

                // keep whatever transform the element already carries (the
                // tilted photos and cards) and rise from above it
                const base = getComputedStyle(e.target).transform;
                const rise = base === 'none' ? 'translateY(26px)' : 'translateY(26px) ' + base;
                const rest = base === 'none' ? 'none' : base;

                e.target.style.opacity = '';
                e.target.animate(
                    [{ opacity: 0, transform: rise }, { opacity: 1, transform: rest }],
                    {
                        duration: 700,
                        delay: delays.get(e.target) || 0,
                        easing: 'cubic-bezier(.22, .61, .36, 1)',
                        fill: 'backwards',
                    }
                );
            });
        }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });

        delays.forEach(function (_, el) { io.observe(el); });
    }

    return { reduceMotion: reduceMotion, reveal: reveal };
})();
