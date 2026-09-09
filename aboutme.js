/* About Me page behaviour: the hero card fan and the FAQ accordion.
   Top bar, cursor and the reveal helper come from site.js.
   Vanilla port of the Framer CardFan component — same geometry and timings,
   driven by the Web Animations API instead of framer-motion. */

(function () {
    'use strict';

    // ---------------------------------------------------------------- fan

    const CARDS = [
        { photo: 'assets/about/fan-1-oc.jpg',           date: '7/8/25',            desc: 'In my hometown OC :)' },
        { photo: 'assets/about/fan-2-germany.webp',     date: '8/20/25',           desc: 'Trip to Germany!' },
        { photo: 'assets/about/fan-3-baby.jpg',         date: 'A long time ago...', desc: 'Baby Pic' },
        { photo: 'assets/about/fan-4-clarus.jpg',       date: '12/14/25',          desc: 'Presenting Clarus AI with my partner' },
        { photo: 'assets/about/fan-5-selfportrait.webp', date: 'September 2023',   desc: 'Self Portrait painting' },
        { photo: 'assets/about/fan-6-technyu.jpg',      date: '11/22/25',          desc: 'tech@nyu retreat all-nighter' },
    ];

    // Polaroid stock. Warm off-white, a shade deeper at the back of the fan so the
    // overlap still reads as depth without the frames going grey.
    const GREYS = ['#ece7e4', '#efebe8', '#f2efec', '#f5f2f0', '#f8f6f4', '#fbfaf9'];

    const BASE_W = 130;   // card size at scale 1
    const BASE_H = 180;
    const RADIUS = 400;   // the arc the cards are laid along
    const ANGLE_FROM = -20;
    const ANGLE_TO = 25;
    const LIFT = -30;     // hover rise, in base units

    const EASE_STACK = 'cubic-bezier(.4, 0, .2, 1)';
    const EASE_FAN = 'cubic-bezier(.34, 1.1, .64, 1)';

    const reduceMotion = Site.reduceMotion;

    const fan = document.getElementById('fan');
    const hero = document.querySelector('.hero');

    if (fan && hero) {
        let scale = 1;
        let dealing = false;

        const els = CARDS.map(function (card, i) {
            const el = document.createElement('div');
            el.className = 'fan-card';
            el.style.zIndex = String(i);
            el.style.background = GREYS[i];

            const photo = document.createElement('div');
            photo.className = 'fan-photo';
            photo.style.backgroundImage = 'url("' + card.photo + '")';
            el.appendChild(photo);

            const cap = document.createElement('div');
            cap.className = 'fan-caption';
            cap.innerHTML = '<p class="fan-date"></p><p class="fan-desc"></p>';
            cap.querySelector('.fan-date').textContent = card.date;
            cap.querySelector('.fan-desc').textContent = card.desc;
            el.appendChild(cap);

            el.addEventListener('mouseenter', function () {
                if (dealing) return;
                el.classList.add('is-hover');
                el.style.zIndex = '7';
                el.style.transform = transformFor(i, true);
            });
            el.addEventListener('mouseleave', function () {
                el.classList.remove('is-hover');
                el.style.zIndex = String(i);
                el.style.transform = transformFor(i, false);
            });

            fan.appendChild(el);
            return { el: el, photo: photo };
        });

        function angleAt(i) {
            return ANGLE_FROM + (ANGLE_TO - ANGLE_FROM) * (i / (CARDS.length - 1));
        }

        // Final resting place: a point on the arc, rotated to stay tangent to it.
        function transformFor(i, lifted) {
            const rad = angleAt(i) * Math.PI / 180;
            const x = RADIUS * Math.sin(rad) * scale;
            const y = RADIUS * (1 - Math.cos(rad)) * scale + (lifted ? LIFT * scale : 0);
            return 'translate(' + x + 'px, ' + y + 'px) rotate(' + angleAt(i) + 'deg)';
        }

        // Pre-deal: one leaning deck at the anchor.
        const TILTED = 'translate(0px, 0px) rotate(-8deg)';
        const STACKED = 'translate(0px, 0px) rotate(0deg)';

        function layout() {
            scale = Math.min(hero.clientWidth / 560, 1.8);
            const w = BASE_W * scale;
            const h = BASE_H * scale;
            const pad = 7 * scale;
            const foot = 38 * scale;

            els.forEach(function (c, i) {
                c.el.style.width = w + 'px';
                c.el.style.height = h + 'px';
                c.el.style.marginLeft = (-w / 2) + 'px';
                c.el.style.marginTop = (-h / 2) + 'px';
                c.photo.style.left = pad + 'px';
                c.photo.style.right = pad + 'px';
                c.photo.style.top = pad + 'px';
                c.photo.style.bottom = foot + 'px';
                if (!dealing && !c.el.classList.contains('is-hover')) {
                    c.el.style.transform = transformFor(i, false);
                }
            });
        }

        function settle(i) {
            const c = els[i];
            c.el.style.transform = transformFor(i, c.el.classList.contains('is-hover'));
            c.el.getAnimations().forEach(function (a) { a.cancel(); });
            c.el.style.transition = 'transform 0.2s ease';
        }

        function deal() {
            if (dealing) return;
            if (reduceMotion) { layout(); return; }
            dealing = true;

            els.forEach(function (c, i) {
                c.el.classList.remove('is-hover');
                c.el.style.zIndex = String(i);
                c.el.style.transition = 'none';
                c.el.getAnimations().forEach(function (a) { a.cancel(); });
                c.el.style.transform = TILTED;

                // Gather into a square stack, pause, then deal out along the arc.
                c.el.animate(
                    [{ transform: TILTED }, { transform: STACKED }],
                    { duration: 520, easing: EASE_STACK, fill: 'forwards' }
                ).finished.then(function () {
                    return c.el.animate(
                        [{ transform: STACKED }, { transform: transformFor(i, false) }],
                        { duration: 650, delay: 80 + (CARDS.length - 1 - i) * 90, easing: EASE_FAN, fill: 'forwards' }
                    ).finished;
                }).then(function () {
                    settle(i);
                    if (i === 0) dealing = false;
                }).catch(function () { /* cancelled by a replay or a resize */ });
            });
        }

        layout();
        deal();

        hero.addEventListener('click', function () {
            if (!dealing) deal();
        });

        let resizeTimer;
        window.addEventListener('resize', function () {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(layout, 120);
        });
    }

    // ------------------------------------------------------------ load-in

    // Each group is one stagger run: siblings rise 70ms apart as the group
    // scrolls into view. Tagged from JS so the page is never blank without it.
    const GROUPS = [
        '.intro > *',
        '.why > .eyebrow, .why > .statement',
        '.why-copy p', '.why-figure',
        '.cv .eyebrow', '.exp-row', '.edu-row',
        '.people > .eyebrow, .people > .statement, .people > .body-copy',
        '.strip', '.org',
        '.sundays-copy > *', '.polaroid',
        '.faq > .eyebrow', '.faq-item',
        '.guitar > *',
    ];

    Site.reveal(GROUPS);

    // ---------------------------------------------------------------- deck

    // The record is the control. Everything else on the deck — the spin, the
    // tonearm, the readout — follows the <audio> element's own events rather
    // than being driven alongside it, so the picture cannot get out of step
    // with the sound: if playback stalls or the file fails, the disc stops
    // because 'pause' fired, not because something remembered to stop it.
    const deck = document.querySelector('[data-deck]');
    if (deck) {
        const audio = deck.querySelector('.deck-audio');
        const platter = deck.querySelector('.deck-platter');
        const elapsed = deck.querySelector('.deck-elapsed');
        const total = deck.querySelector('.deck-total');

        function clock(t) {
            if (!isFinite(t)) return '--:--';
            const m = Math.floor(t / 60);
            const s = Math.floor(t % 60);
            return m + ':' + (s < 10 ? '0' : '') + s;
        }

        function label() {
            platter.setAttribute('aria-pressed', audio.paused ? 'false' : 'true');
            platter.setAttribute('aria-label',
                (audio.paused ? 'Play' : 'Pause') + ' Andante Largo, Op. 5, No. 5');
        }

        platter.addEventListener('click', function () {
            if (audio.paused) {
                // A rejected play() is the autoplay policy or a missing file.
                // Either way the deck must not sit there spinning silently.
                const started = audio.play();
                if (started && started.catch) started.catch(function () { deck.classList.remove('is-playing'); });
            } else {
                audio.pause();
            }
        });

        audio.addEventListener('play', function () { deck.classList.add('is-playing'); label(); });
        audio.addEventListener('pause', function () { deck.classList.remove('is-playing'); label(); });
        audio.addEventListener('ended', function () {
            deck.classList.remove('is-playing');
            audio.currentTime = 0;
            elapsed.textContent = '0:00';
            label();
        });
        audio.addEventListener('timeupdate', function () { elapsed.textContent = clock(audio.currentTime); });
        audio.addEventListener('loadedmetadata', function () { total.textContent = clock(audio.duration); });
        if (audio.readyState >= 1) total.textContent = clock(audio.duration);
        label();
    }

    // ---------------------------------------------------------------- faq

    const items = Array.prototype.slice.call(document.querySelectorAll('.faq-item'));
    items.forEach(function (item) {
        const btn = item.querySelector('.faq-q');
        btn.addEventListener('click', function () {
            const open = item.classList.contains('is-open');
            // one open at a time, matching the original accordion
            items.forEach(function (other) {
                other.classList.remove('is-open');
                other.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
            });
            if (!open) {
                item.classList.add('is-open');
                btn.setAttribute('aria-expanded', 'true');
            }
        });
    });
})();
