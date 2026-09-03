/* Case-study page behaviour, shared by every project page: the table-of-contents
   scroll-spy and the load-in. Top bar, cursor and the reveal helper come from
   site.js. Include this after site.js and no page needs a script of its own. */

(function () {
    'use strict';

    // ------------------------------------------------------- scroll-spy

    // The active section is the last one whose top has passed the reading line,
    // a third of the way down the viewport. Falls back to the first section
    // while the header is still on screen.
    const links = Array.prototype.slice.call(document.querySelectorAll('#toc a'));
    const sections = links
        .map(function (a) {
            const href = a.getAttribute('href') || '';
            if (href.charAt(0) !== '#' || href.length < 2) return null;
            // ids on these pages carry odd casing straight from Framer (#detailS),
            // so match them literally rather than normalising
            return document.getElementById(href.slice(1));
        })
        .filter(Boolean);

    if (links.length && sections.length === links.length) {
        let ticking = false;

        const sync = function () {
            ticking = false;
            const line = window.innerHeight / 3;
            let active = 0;
            for (let i = 0; i < sections.length; i++) {
                if (sections[i].getBoundingClientRect().top <= line) active = i;
            }
            links.forEach(function (a, i) {
                a.classList.toggle('is-active', i === active);
            });
        };

        window.addEventListener('scroll', function () {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(sync);
        }, { passive: true });
        window.addEventListener('resize', sync, { passive: true });
        sync();
    }

    // ------------------------------------------------- proximity magnify

    // Dock magnification: the item under the pointer grows most, its
    // neighbours grow by how near they are, everything else stays put. Same
    // construction the established dock components use (Magic UI's Dock,
    // Aceternity's Floating Dock, both after the macOS original) — distance
    // from the pointer mapped linearly to a scale over a fixed radius, then a
    // spring toward that scale — with their icon-sized numbers brought down to
    // something that suits 16px text.
    const toc = document.getElementById('toc');

    if (toc && links.length &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {

        const MAX_SCALE = 1.35;   // 2x reads well on icons and absurd on type
        const RADIUS = 110;       // px over which a neighbour's share falls to 0
        // The dock components' spring defaults. The ratio here is overdamped,
        // so the text settles without the overshoot that looks like a wobble
        // when it is letterforms rather than icons moving.
        const STIFFNESS = 150, DAMPING = 12, MASS = 0.1;
        const REST = 0.001;

        // Integrated at a fixed step, with the frame's elapsed time consumed in
        // whole steps. It matters: this spring is stiff enough that an explicit
        // integrator diverges somewhere above a ~19ms step, and a dropped frame
        // or a busy machine hands you exactly that. Stepping 4ms at a time is
        // stable however the frame lands, and costs nothing at eight items.
        const STEP = 1 / 240;

        const state = links.map(function () { return { scale: 1, v: 0 }; });
        let centres = null;   // #toc is fixed, so only a resize moves these
        let pointerY = null;  // null = disengaged, everything returns to 1
        let raf = 0, last = 0, acc = 0;

        const measure = function () {
            centres = links.map(function (a) {
                const r = a.getBoundingClientRect();
                return r.top + r.height / 2;
            });
        };

        const frame = function (now) {
            raf = 0;
            // Capped: a backgrounded tab hands back a huge first delta, and
            // without this the loop would try to catch up over thousands of
            // steps in one frame.
            const elapsed = last ? Math.min(0.1, (now - last) / 1000) : STEP;
            last = now;
            if (!centres) measure();

            acc += elapsed;
            const steps = Math.floor(acc / STEP);
            acc -= steps * STEP;

            let moving = false;
            for (let i = 0; i < state.length; i++) {
                const s = state[i];
                let target = 1;
                if (pointerY !== null) {
                    const d = Math.abs(pointerY - centres[i]);
                    if (d < RADIUS) target = 1 + (MAX_SCALE - 1) * (1 - d / RADIUS);
                }
                for (let n = 0; n < steps; n++) {
                    const accel = ((target - s.scale) * STIFFNESS - s.v * DAMPING) / MASS;
                    s.v += accel * STEP;
                    s.scale += s.v * STEP;
                }
                if (Math.abs(target - s.scale) > REST || Math.abs(s.v) > REST) {
                    moving = true;
                } else {
                    s.scale = target;
                    s.v = 0;
                }
                // cleared rather than set to scale(1) so a resting link carries
                // no transform at all and cannot pin a compositing layer
                links[i].style.transform =
                    s.scale === 1 ? '' : 'scale(' + s.scale.toFixed(4) + ')';
            }

            if (moving) raf = requestAnimationFrame(frame);
            else { last = 0; acc = 0; }
        };

        // No standing rAF: the loop runs only while something is in motion, and
        // each pointer move starts it again if it has stopped.
        const kick = function () {
            if (!raf) { last = 0; acc = 0; raf = requestAnimationFrame(frame); }
        };

        toc.addEventListener('pointermove', function (e) {
            if (e.pointerType === 'touch') return;  // a tap is not a hover
            pointerY = e.clientY;
            kick();
        });
        toc.addEventListener('pointerleave', function () {
            pointerY = null;
            kick();
        });

        // Keyboard parity: tabbing through the nav magnifies the focused link
        // as though the pointer were sitting on it.
        toc.addEventListener('focusin', function (e) {
            if (!centres) measure();
            const i = links.indexOf(e.target);
            if (i !== -1) { pointerY = centres[i]; kick(); }
        });
        toc.addEventListener('focusout', function () {
            pointerY = null;
            kick();
        });

        window.addEventListener('resize', function () {
            centres = null;
            kick();
        }, { passive: true });
    }

    // ---------------------------------------------------------- load-in

    // Each selector is one stagger run. Sections are picked up generically, so
    // adding a section to the markup needs no change here.
    const groups = ['#toc a', '.case-head > *', '.shot-hero', '.frame', '.embed'];
    document.querySelectorAll('.case-section').forEach(function (s) {
        groups.push('#' + (window.CSS && CSS.escape ? CSS.escape(s.id) : s.id) + ' > *');
    });
    groups.push('.thanks > *', '.next-label', '.next-slot');

    Site.reveal(groups.filter(function (sel) {
        // a bare "#" + empty id would match nothing useful
        return sel.indexOf('# >') === -1;
    }));
})();
