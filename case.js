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
