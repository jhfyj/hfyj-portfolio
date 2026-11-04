// tech@nyu showreel compositions (test page).
// Marks each composition .is-live only while it is on screen, so the wall,
// the drifting crops and the phone feed stop costing anything off screen.
// Drives the two stepped pieces: the post cycling inside the selection box,
// and the event deck dealing its top card to the back.
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var live = new WeakMap();

    var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
            e.target.classList.toggle('is-live', e.isIntersecting);
            live.set(e.target, e.isIntersecting);
        });
    }, { rootMargin: '80px 0px' });
    document.querySelectorAll('[data-reel]').forEach(function (el) { io.observe(el); });

    function isLive(el) {
        var host = el.closest('[data-reel]');
        return !!(host && live.get(host)) && !document.hidden;
    }

    // ---- the selection box: one post at a time, name and size follow it.
    //      The Figma layers list beside it highlights the same frame, and
    //      clicking a layer jumps the box to it. ----
    document.querySelectorAll('[data-cycle]').forEach(function (box) {
        var imgs = box.querySelectorAll('.cyc');
        var name = box.querySelector('.sel-name');
        var host = box.closest('.bento');
        var list = host && host.querySelector('[data-layers]');
        var rows = list ? list.querySelectorAll('li') : [];
        if (imgs.length < 2) return;
        var i = 0, last = 0;
        function show(n) {
            imgs[i].classList.remove('is-on');
            if (rows[i]) rows[i].classList.remove('is-on');
            i = n;
            imgs[i].classList.add('is-on');
            if (rows[i]) {
                rows[i].classList.add('is-on');
                // keep the active row in view if the panel is short
                var r = rows[i], top = r.offsetTop, bot = top + r.offsetHeight;
                if (bot > list.scrollTop + list.clientHeight) list.scrollTop = bot - list.clientHeight + 6;
                else if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 6);
            }
            if (name) name.textContent = imgs[i].dataset.name || '';
            last = Date.now();
        }
        show(0);
        Array.prototype.forEach.call(rows, function (r, k) {
            r.addEventListener('click', function () { if (k < imgs.length) show(k); });
        });
        // a click on the post steps it on by hand
        box.addEventListener('click', function () { show((i + 1) % imgs.length); });
        if (reduce) return;
        setInterval(function () {
            // a hand-picked frame stays put a little longer before the cycle resumes
            if (isLive(box) && Date.now() - last > 2400) show((i + 1) % imgs.length);
        }, 2600);
    });

    // ---- the @techatnyu phone: measure how far the feed can scroll ----
    document.querySelectorAll('[data-ig]').forEach(function (tile) {
        var view = tile.querySelector('.ig-view');
        var feed = tile.querySelector('.ig-feed');
        var grid = tile.querySelector('.ig-grid');
        if (!view || !feed || !grid) return;
        function measure() {
            var max = Math.max(0, feed.scrollHeight - view.clientHeight);
            var mid = Math.min(max, Math.max(0, grid.offsetTop - view.clientHeight * 0.08));
            feed.style.setProperty('--ig-max', max + 'px');
            feed.style.setProperty('--ig-mid', mid + 'px');
        }
        measure();
        window.addEventListener('resize', measure);
        Array.prototype.forEach.call(tile.querySelectorAll('img'), function (im) {
            if (!im.complete) im.addEventListener('load', measure, { once: true });
        });
    });

    // ---- the six brand words fade in once, when they come on screen ----
    var seen = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-seen'); seen.unobserve(e.target); } });
    }, { threshold: 0.4 });
    document.querySelectorAll('.proc-words').forEach(function (el) { seen.observe(el); });

    // ---- the event deck: deal the top card off, slide it back under ----
    document.querySelectorAll('[data-deck]').forEach(function (deck) {
        var cards = Array.prototype.slice.call(deck.querySelectorAll('img'));
        if (cards.length < 2) return;
        function lay() { cards.forEach(function (c, k) { c.dataset.pos = String(Math.min(k, 2)); c.style.zIndex = String(10 - k); }); }
        lay();
        function deal() {
            var top = cards[0];
            top.classList.add('is-dealt');
            setTimeout(function () {
                top.style.transition = 'none';
                top.classList.remove('is-dealt');
                cards.push(cards.shift());
                lay();
                void top.offsetWidth;
                top.style.transition = '';
            }, 520);
        }
        if (reduce) return;
        setInterval(function () { if (isLive(deck)) deal(); }, 2400);
        deck.addEventListener('click', deal);
    });
    // ---- the Kickoff deck: one slide at a time, the counter and bar follow ----
    document.querySelectorAll('[data-kd]').forEach(function (kd) {
        var slides = Array.prototype.slice.call(kd.querySelectorAll('.kd-slide'));
        var count = kd.querySelector('.kd-count b');
        var bar = kd.querySelector('.kd-prog i');
        var at = 0;
        function show(k) {
            var prev = slides[at];
            at = (k + slides.length) % slides.length;
            var cur = slides[at];
            slides.forEach(function (s) { s.classList.remove('is-off'); });
            if (prev !== cur) { prev.classList.remove('is-on'); prev.classList.add('is-off'); }
            cur.classList.add('is-on');
            var n = +cur.dataset.n;
            if (count) count.textContent = (n < 10 ? '0' : '') + n;
            if (bar) bar.style.width = ((at + 1) / slides.length * 100) + '%';
        }
        show(0);
        kd.querySelector('.kd-stage').addEventListener('click', function () { show(at + 1); });
        if (reduce) return;
        setInterval(function () { if (isLive(kd)) show(at + 1); }, 2600);
    });
})();
