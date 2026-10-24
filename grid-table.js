/* The table in the grid view's header.
   ---------------------------------------------------------------------------
   Classic script, same shape as footer-deck.js. Builds a scattered table of
   Jen's own poker cards (the footer deck), a deck with the card back on top,
   a blank card to draw on, a pencil, an eraser and a colour palette, and
   drops them onto a faint grid once the header text is in.

   Layout is in the units of Jen's mock: a 1600 x 800 frame on desktop
   (x, y = centre, w/h = size, r = degrees clockwise), and a 1600 x 1200
   frame on phones, where only the canvas, tools and one card are kept.
   CSS turns the units into cqw of the frame, so the whole table scales as one. */
(function () {
    'use strict';

    var DECK_DIR = './assets/PokerDeck/';
    var FACES = [
        'Frame 470.jpg', 'Frame 471.jpg', 'Frame 472.jpg', 'Frame 473.jpg',
        'Frame 474.jpg', 'Frame 475.jpg', 'Frame 476.jpg', 'Frame 477.jpg',
        'Frame 478.jpg', 'Frame 479.jpg', 'Frame 480.jpg', 'Frame 481.jpg',
        'Frame 482.jpg'
    ];
    var CARD_RATIO = 1449 / 1059;
    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    // [desktop pose, phone pose or null]
    var LAYOUT = {
        cardA:   [{ x: 1020, y: 133, w: 205, r: -9 },   null],
        cardB:   [{ x: 920,  y: 279, w: 190, r: -21 },  null],
        deck:    [{ x: 1440, y: 112, w: 186, r: 24 },   null],
        canvas:  [{ x: 1250, y: 425, w: 187, r: 20 },   { x: 850,  y: 560, w: 450, r: 8 }],
        cardC:   [{ x: 1522, y: 590, w: 187, r: -15.5 }, { x: 1325, y: 600, w: 450, r: -12 }],   // phone: same size as the canvas card
        eraser:  [{ x: 1000, y: 578, w: 54,  h: 99,  r: -18 }, { x: 210, y: 880, w: 140, h: 258, r: -16 }],
        pencil:  [{ x: 1089, y: 591, w: 18,  h: 272, r: -10.8 }, { x: 420, y: 560, w: 44, h: 660, r: -14 }],
        palette: [{ x: 1267, y: 626, w: 170, h: 50,  r: 0 },   { x: 850,  y: 1090, w: 460, h: 130, r: 0 }]
    };

    var COLORS = [
        { key: 'accent', css: 'var(--accent)' },
        { key: 'pink',   css: '#F54672' },
        { key: 'green',  css: '#00D343' },
        { key: 'orange', css: '#F5B846' }
    ];

    function isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }
    // Project covers: flat exports of the ring's cover cards (light + dark),
    // the three cards lying face up on the table. Nenos (coming soon) is left out.
    var COVER_DIR = './assets/table-covers/';
    var PROJECTS = ['puregym', 'bmw', 'the-dial', 'povi', 'clarus-ai', 'tech-nyu'];
    function faceUrl(face) {
        if (face.indexOf('cover:') === 0) {
            return COVER_DIR + face.slice(6) + (isDark() ? '-dark' : '') + '.webp';
        }
        var name = isDark() ? face.replace(/\.jpg$/, '-dark.jpg') : face;
        return DECK_DIR + encodeURIComponent(name);
    }
    function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }
    var pile = shuffle(FACES.slice()), next = 0;
    var cards = [];   // every face-up card on the table
    function draw() {
        var shown = cards.map(function (c) { return c.face; });
        for (var t = 0; t < FACES.length * 2; t++) {
            if (next >= pile.length) { pile = shuffle(FACES.slice()); next = 0; }
            var f = pile[next++];
            if (shown.indexOf(f) === -1) return f;
        }
        return pile[0];
    }
    // The first three dealt are PureGym, BMW and The Dial; after that a flip
    // turns up whichever project isn't already showing
    var projPile = PROJECTS.slice(0, 3).concat(shuffle(PROJECTS.slice(3))), projNext = 0;
    function drawProject() {
        var shown = cards.map(function (c) { return c.face; });
        for (var t = 0; t < PROJECTS.length * 2; t++) {
            if (projNext >= projPile.length) { projPile = shuffle(PROJECTS.slice()); projNext = 0; }
            var f = 'cover:' + projPile[projNext++];
            if (shown.indexOf(f) === -1) return f;
        }
        return 'cover:' + projPile[0];
    }

    var SVG_NS = 'http://www.w3.org/2000/svg';
    function el(tag, cls, parent) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (parent) parent.appendChild(e);
        return e;
    }
    // The card back: same frame + mark as the footer and the carousel
    function buildBack(parent) {
        var back = el('span', 'gt-face gt-back', parent);
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'gf-card-frame');
        svg.setAttribute('viewBox', '0 0 1059 1449');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('aria-hidden', 'true');
        var r = document.createElementNS(SVG_NS, 'rect');
        r.setAttribute('x', '35.5'); r.setAttribute('y', '35.5');
        r.setAttribute('width', String(1059 - 71)); r.setAttribute('height', String(1449 - 71));
        r.setAttribute('rx', '24'); r.setAttribute('fill', 'none');
        r.setAttribute('stroke', 'currentColor'); r.setAttribute('stroke-width', '25');
        svg.appendChild(r);
        back.appendChild(svg);
        el('span', 'gf-card-mark', back);
        return back;
    }

    function place(item, name, isCard) {
        var L = LAYOUT[name], d = L[0], m = L[1];
        var s = item.style;
        s.setProperty('--x', d.x); s.setProperty('--y', d.y); s.setProperty('--w', d.w);
        s.setProperty('--h', d.h || d.w * CARD_RATIO); s.setProperty('--r', d.r);
        if (m) {
            s.setProperty('--mx', m.x); s.setProperty('--my', m.y); s.setProperty('--mw', m.w);
            s.setProperty('--mh', m.h || m.w * CARD_RATIO); s.setProperty('--mr', m.r);
        } else {
            item.classList.add('gt-desk-only');
        }
        if (isCard) item.classList.add('gt-cardsize');
    }

    var stage, frame, zTop = 10;

    /* ---------- loose cards: click flips, drag moves ---------- */
    function makeCard(name, pose) {
        var item = el('div', 'gt-item gt-card');
        if (name) place(item, name, true);
        else {
            var s = item.style;
            s.setProperty('--x', pose.x); s.setProperty('--y', pose.y);
            s.setProperty('--w', 187); s.setProperty('--h', 187 * CARD_RATIO); s.setProperty('--r', pose.r);
            item.classList.add('gt-desk-only', 'gt-cardsize', 'gt-dealt');
        }
        var lift = el('div', 'gt-lift', item);
        var inner = el('span', 'gt-inner', lift);
        // Cards laid out on the table are project covers; any dealt later are poker cards
        var project = !!name;
        var face = project ? drawProject() : draw();
        var img = el('img', 'gt-face gt-front', inner);
        img.alt = ''; img.draggable = false; img.src = faceUrl(face);
        buildBack(inner);
        var card = { item: item, inner: inner, img: img, face: face, project: project, busy: false };
        cards.push(card);
        dragOrClick(item, function () { flip(card); });
        return card;
    }

    function flip(card) {
        if (card.busy) return;
        card.busy = true;
        card.item.classList.add('is-flipped');
        var done = false;
        function turned() {
            if (done) return; done = true;
            card.inner.removeEventListener('transitionend', onEnd);
            card.face = card.project ? drawProject() : draw();
            card.img.src = faceUrl(card.face);
            setTimeout(function () {
                card.item.classList.remove('is-flipped');
                setTimeout(function () { card.busy = false; }, reduced ? 0 : 560);
            }, 300);
        }
        function onEnd(e) { if (e.target === card.inner && e.propertyName === 'transform') turned(); }
        card.inner.addEventListener('transitionend', onEnd);
        setTimeout(turned, reduced ? 0 : 860);
    }

    function dragOrClick(item, onClick) {
        var start = null;
        item.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            start = { x: e.clientX, y: e.clientY,
                      dx: parseFloat(item.style.getPropertyValue('--dx')) || 0,
                      dy: parseFloat(item.style.getPropertyValue('--dy')) || 0, moved: false };
            item.setPointerCapture(e.pointerId);
            item.style.zIndex = ++zTop;
        });
        item.addEventListener('pointermove', function (e) {
            if (!start) return;
            var mx = e.clientX - start.x, my = e.clientY - start.y;
            if (!start.moved && Math.hypot(mx, my) < 5) return;
            start.moved = true;
            item.classList.add('is-dragging');
            item.style.setProperty('--dx', (start.dx + mx) + 'px');
            item.style.setProperty('--dy', (start.dy + my) + 'px');
        });
        function end() {
            if (!start) return;
            var moved = start.moved;
            start = null;
            item.classList.remove('is-dragging');
            if (!moved) onClick();
        }
        item.addEventListener('pointerup', end);
        item.addEventListener('pointercancel', function () { start = null; item.classList.remove('is-dragging'); });
    }

    /* ---------- the card box: a poker tuck box, open end facing the table,
       a small stack of cards showing their edges at the open end. Hover slides
       the top card out a bit. Clicking doesn't deal more.
       Layers, bottom to top: the open tuck flap + dust flaps (lying flat),
       the box's thickness, the card, then the box front with its thumb notch. */
    // How far the peeking card sits out of the box, as a share of the box width
    var PEEK = 0.2;
    var boxCard = null;
    // Seen from straight above, like a real opened tuck box lying on its back:
    // the end panel (as deep as the box is thick) folds flat onto the table
    // from the box's bottom edge, then the tongue, both showing the unprinted
    // inside of the board. The dust flaps hang off the side panels, so from
    // above they're standing walls: just thin slivers along each side,
    // splayed out a touch. Units: 100 = the box width.
    function flapSvg() {
        return '<svg viewBox="0 0 100 48" aria-hidden="true">' +
            '<defs><linearGradient id="gtBoxHinge" x1="0" x2="0" y1="0" y2="1">' +
                '<stop offset="0" stop-color="#000" stop-opacity=".10"/>' +
                '<stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>' +
            // end panel + tongue in one piece: straight end panel, a small
            // step in at the crease, then the tongue with big rounded corners
            '<path class="gt-box-tuck" d="M0.8 0 L99.2 0 L99.2 25 L97.6 26 L97.6 31 ' +
                'Q97.6 45.5 87 47.2 Q84 47.6 79 47.6 L21 47.6 Q16 47.6 13 47.2 ' +
                'Q2.4 45.5 2.4 31 L2.4 26 L0.8 25 Z"/>' +
            '<line class="gt-box-crease" x1="2.4" y1="26" x2="97.6" y2="26"/>' +
            // the box's shadow falling onto the end panel right at the hinge
            '<rect class="gt-box-hinge" x="0.8" y="0" width="98.4" height="5"/>' +
            // dust flaps, standing up at the sides of the opening
            // bent outward along their length, splaying away from the opening
            '<path class="gt-box-dust" d="M0.8 0 L3 0 Q2.4 12 -1.6 21.4 Q-2.6 23.6 -4.4 23.1 L-5.6 22.5 Q-1.8 12 0.8 0 Z"/>' +
            '<path class="gt-box-dust" d="M99.2 0 L97 0 Q97.6 12 101.6 21.4 Q102.6 23.6 104.4 23.1 L105.6 22.5 Q101.8 12 99.2 0 Z"/>' +
            '</svg>';
    }
    function buildDeck() {
        var item = el('div', 'gt-item gt-deck');
        place(item, 'deck', true);
        var lift = el('div', 'gt-lift', item);
        var flap = el('span', 'gt-box-flap', lift);
        flap.innerHTML = flapSvg();
        el('span', 'gt-box-body', lift);
        // A few cards stacked inside, edges stepping out of the open end so
        // the stack reads as several cards. Bottom of the stack first; only
        // the top card (right under the front) slides out on hover.
        for (var i = 3; i >= 0; i--) {
            var c = el('span', 'gt-box-card' + (i === 0 ? ' gt-box-top' : ''), lift);
            c.style.setProperty('--i', i);
            if (i === 0) { buildBack(c); boxCard = c; }
            else el('span', 'gt-face gt-box-plain', c);
        }
        var front = el('span', 'gt-box-front', lift);
        buildBack(front);
        // Hover slides the top card out a little; dragging pulls it out
        pullFromBox(item);
        return item;
    }

    /* ---------- pulling a card out of the box ----------
       Drag the top card out of the box and let go: it flies to the middle of
       the screen, turns over to one of Jen's cards at random, and the rest of
       the page blurs behind it. After 2 seconds it turns face down, lines up
       with the box's open end and slides back in on top of the stack.
       A short drag (or a plain click) just lets the card drop back. */
    var HOLD_MS = 2000;
    // How far outside the box (share of the box width) the card lines up
    // before it slides back in
    var SLIDE_OUT = 0.85;
    function pullFromBox(item) {
        var busy = false;
        item.addEventListener('pointerdown', function (e) {
            if (e.button !== 0 || busy || !boxCard) return;
            e.preventDefault();
            busy = true;
            item.setPointerCapture(e.pointerId);
            // the box comes to the top of the table so the card slides out
            // over the cards next to it, not under them
            item.style.zIndex = ++zTop;

            // Where the card sits now, unrotated size + on-screen centre
            var r = boxCard.getBoundingClientRect();
            var w0 = boxCard.offsetWidth;
            var rot = parseFloat(item.style.getPropertyValue('--r')) || 0;
            var cx0 = r.left + r.width / 2, cy0 = r.top + r.height / 2;

            // The card's big size in the middle of the screen
            var H = Math.min(window.innerHeight * 0.64, 600);
            var W = H / CARD_RATIO;
            var s0 = w0 / W;

            var pull = el('div', 'gt-pull');
            pull.style.width = W + 'px';
            pull.style.height = H + 'px';
            pull.style.setProperty('--rad', (W * 0.055) + 'px');
            var inner = el('span', 'gt-inner', pull);
            var face = draw();
            var img = el('img', 'gt-face gt-front', inner);
            img.alt = ''; img.draggable = false; img.src = faceUrl(face);
            buildBack(inner);

            function at(x, y, ang, sc) {
                return 'translate(-50%, -50%) translate(' + (x - window.innerWidth / 2) + 'px, ' +
                    (y - window.innerHeight / 2) + 'px) rotate(' + ang + 'deg) scale(' + sc + ')';
            }

            // Phase 1, in the box: the card slides along the box (out of the
            // open end) under the box front, the sleeve holding it straight,
            // so only the part of the drag pointing out of the box counts.
            // Phase 2, once it's clear of the box: it's handed to the overlay
            // and follows the pointer freely over the page.
            var a = rot * Math.PI / 180;
            var ox = -Math.sin(a), oy = Math.cos(a);          // the box's "out" direction on screen
            var m0 = new DOMMatrix(getComputedStyle(boxCard).transform);
            var base = m0.f;                                   // where it sits now (hover peek included)
            var clear = item.offsetHeight * 0.97;              // slid this far, the card is out of the box
            var slide = base, out = false, hx = 0, hy = 0, hpx = 0, hpy = 0;
            boxCard.style.transition = 'none';

            var sx = e.clientX, sy = e.clientY, dist = 0;
            function move(ev) {
                var mx = ev.clientX - sx, my = ev.clientY - sy;
                dist = Math.hypot(mx, my);
                if (!out) {
                    slide = Math.max(0, base + mx * ox + my * oy);
                    if (slide < clear) { boxCard.style.transform = 'translateY(' + slide + 'px)'; return; }
                    handOver(ev);
                }
                var dx = ev.clientX - hpx, dy = ev.clientY - hpy;
                // straightens up a little and grows a touch as it leaves the box
                var k = Math.min(Math.hypot(dx, dy) / 220, 1);
                pull.style.transform = at(hx + dx, hy + dy, rot * (1 - 0.5 * k), s0 * (1 + 0.15 * k));
            }
            // The real card has just cleared the box: the overlay takes its
            // place exactly where it is, and the real one hides
            function handOver(ev) {
                out = true;
                boxCard.style.transform = 'translateY(' + clear + 'px)';
                var b = boxCard.getBoundingClientRect();
                hx = b.left + b.width / 2; hy = b.top + b.height / 2;
                hpx = ev ? ev.clientX : hx; hpy = ev ? ev.clientY : hy;
                pull.style.transform = at(hx, hy, rot, s0);
                document.body.appendChild(pull);
                boxCard.style.visibility = 'hidden';
                boxCard.style.transform = '';
            }
            function up() {
                item.removeEventListener('pointermove', move);
                item.removeEventListener('pointerup', up);
                item.removeEventListener('pointercancel', up);
                if (!out) {
                    // Let go inside the box: a short pull slides back in, a
                    // long one carries on out and up to the middle
                    if (slide - base < item.offsetHeight * 0.3) { slideHome(); return; }
                    boxCard.style.transform = 'translateY(' + slide + 'px)';
                    var b = boxCard.getBoundingClientRect();
                    out = true;
                    hx = b.left + b.width / 2; hy = b.top + b.height / 2;
                    pull.style.transform = at(hx, hy, rot, s0);
                    document.body.appendChild(pull);
                    boxCard.style.visibility = 'hidden';
                    boxCard.style.transform = '';
                    void pull.offsetWidth;
                    reveal();
                    return;
                }
                if (dist < 30) { putBack(false); return; }
                reveal();
            }
            function slideHome() {
                boxCard.style.transition = 'transform ' + (reduced ? 0 : 320) + 'ms cubic-bezier(0.2, 0.8, 0.25, 1)';
                boxCard.style.transform = '';
                setTimeout(function () { boxCard.style.transition = ''; busy = false; }, reduced ? 0 : 340);
            }
            item.addEventListener('pointermove', move);
            item.addEventListener('pointerup', up);
            item.addEventListener('pointercancel', up);

            var veil = null;
            function reveal() {
                veil = el('div', 'gt-veil');
                document.body.appendChild(veil);
                veil.addEventListener('click', function () { clearTimeout(hold); putBack(true); });
                void veil.offsetWidth;
                veil.classList.add('is-on');
                pull.classList.add('is-flying');
                pull.style.transform = 'translate(-50%, -50%)';
                // turn it over once it's on its way
                setTimeout(function () { pull.classList.add('is-open'); }, reduced ? 0 : 120);
                var hold = setTimeout(function () { putBack(true); }, (reduced ? 0 : 700) + HOLD_MS);
            }
            var leaving = false;
            function done() {
                pull.remove();
                if (veil) veil.remove();
                busy = false;
            }
            function putBack(fromMiddle) {
                if (leaving) return; leaving = true;
                // Where the box card rests now (the page may have scrolled)
                var b = boxCard.getBoundingClientRect();
                var bx = b.left + b.width / 2, by = b.top + b.height / 2;
                pull.classList.add('is-flying', 'is-back');
                pull.classList.remove('is-open');
                if (veil) veil.classList.remove('is-on');
                if (!fromMiddle) {
                    // A short drag: it just drops back where it was
                    pull.style.transform = at(bx, by, rot, s0);
                    setTimeout(function () { boxCard.style.transition = ''; boxCard.style.visibility = ''; done(); }, reduced ? 0 : 320);
                    return;
                }
                // From the middle: turn face down and line up just outside the
                // open end, square to the box, then slide in under the front
                // to join the stack
                var out = item.offsetWidth * SLIDE_OUT;
                var a = rot * Math.PI / 180;
                pull.style.transform = at(bx - Math.sin(a) * out, by + Math.cos(a) * out, rot, s0);
                setTimeout(function () {
                    // Hand over to the real top card, parked outside the box,
                    // and slide it home
                    boxCard.style.transition = 'none';
                    boxCard.style.transform = 'translateY(calc(var(--bw) * ' + (SLIDE_OUT + 0.035) + '))';
                    boxCard.style.visibility = '';
                    done();
                    void boxCard.offsetWidth;
                    boxCard.style.transition = 'transform ' + (reduced ? 0 : 460) + 'ms cubic-bezier(0.3, 0.7, 0.2, 1)';
                    boxCard.style.transform = '';
                    setTimeout(function () { boxCard.style.transition = ''; }, reduced ? 0 : 480);
                }, reduced ? 0 : 560);
            }
        });
    }

    /* ---------- tools ---------- */
    // Penco Prime Timber 2.0 style (Jen's reference): silver end cap, a band
    // a shade darker than the body, a long body in the chosen colour with gold
    // printing, a silver cone and a thin graphite lead. Tip at the bottom.
    // The body follows the palette (--gt-ink). Ids are unique per copy: the
    // table one and the one in hand are both on the page.
    var pencilN = 0;
    function pencilSvg() {
        var n = ++pencilN, m = 'gtPm' + n, c = 'gtPc' + n;
        return '<svg viewBox="0 0 18 272" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs>' +
            '<linearGradient id="' + m + '" x1="0" x2="1" y1="0" y2="0">' +
                '<stop offset="0" stop-color="#9C9EA3"/><stop offset=".3" stop-color="#F4F5F7"/>' +
                '<stop offset=".55" stop-color="#C4C6CB"/><stop offset="1" stop-color="#7D8086"/></linearGradient>' +
            '<linearGradient id="' + c + '" x1="0" x2="1" y1="0" y2="0">' +
                '<stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset=".28" stop-color="#fff" stop-opacity=".38"/>' +
                '<stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>' +
            '</defs>' +
            // end cap + ring
            '<rect x="3" y="0" width="12" height="11" rx="3" fill="url(#' + m + ')"/>' +
            '<rect x="1.5" y="10" width="15" height="3" fill="url(#' + m + ')"/>' +
            // band, then body, in the chosen colour (the band a shade darker)
            '<rect x="1.5" y="13" width="15" height="30" class="gt-pbody"/>' +
            '<rect x="1.5" y="13" width="15" height="30" fill="#000" opacity=".38"/>' +
            '<rect x="1.5" y="43" width="15" height="187" class="gt-pbody"/>' +
            // gold printing along the body
            '<text x="0" y="0" transform="translate(11.6 196) rotate(-90)" fill="#9E7826" ' +
                'font-family="DM Sans, system-ui, sans-serif" font-size="5.6" font-weight="700" letter-spacing=".9">PRIME TIMBER 2.0</text>' +
            '<text x="0" y="0" transform="translate(11.2 70) rotate(-90)" fill="#9E7826" ' +
                'font-family="DM Sans, system-ui, sans-serif" font-size="3.2" font-weight="600" letter-spacing=".4">HFYJ</text>' +
            // round body shading over band + body
            '<rect x="1.5" y="13" width="15" height="217" fill="url(#' + c + ')"/>' +
            // silver cone and lead
            '<path d="M1.5 230 H16.5 L11 260 H7 Z" fill="url(#' + m + ')"/>' +
            '<rect x="7" y="258" width="4" height="4" fill="url(#' + m + ')"/>' +
            '<path d="M7.9 262 H10.1 L9.6 272 H8.4 Z" fill="#3B3B3D"/>' +
            '</svg>';
    }
    // A Pink Pearl-style block eraser seen straight down from above, like the
    // cards: the flat top face, the two slanted ends showing as narrow strips
    // (far end catching the light, near end in shade), no side faces. The
    // printing runs along its length (Jen's mark, not Paper Mate's)
    //
    // It wears down as you rub: the rubbing end (the one on the pointer, the
    // near end in the drawing) loses rubber, so the block gets shorter, the
    // printing nearest that end goes with it, and what's left of the end
    // rounds off lopsided and picks up a grey graphite smudge.
    // eraserWear: 0 = new, 1 = worn to its stub (about a third shorter).
    var eraserN = 0, eraserWear = 0, wearShown = 0, wearLast = null;
    var WEAR_PX = 60000;   // px of rubbing (on screen) to wear it down to nothing (~1.5 min of scrubbing)
    function eraserSvg() {
        var g = 'gtE' + (++eraserN), h = g + 'h', c = g + 'c', s = g + 's';
        // w runs all the way to 1 = worn down to nothing (a last little nub);
        // a = how rounded/greyed the worn end looks, settled early on
        var w = wearShown, cut = 88 * w, y0 = 1 + cut, len = 90 - cut;
        var a = Math.min(1, w * 2.5), cap = Math.max(0.5, Math.min(24, len / 2));
        var rt = Math.min(3.2, cap), rl = Math.min(3.2 + 15 * a, cap), rr = Math.min(3.2 + 9 * a, cap);   // worn end rounds off unevenly
        var foot = 'M' + (1 + rt) + ' ' + y0 + 'H' + (49 - rt) + 'Q49 ' + y0 + ' 49 ' + (y0 + rt) +
            'V' + (91 - rr) + 'Q49 91 ' + (49 - rr) + ' 91H' + (1 + rl) + 'Q1 91 1 ' + (91 - rl) +
            'V' + (y0 + rt) + 'Q1 ' + y0 + ' ' + (1 + rt) + ' ' + y0 + 'Z';
        var worn = w > 0 ?
            '<linearGradient id="' + s + '" x1="0" y1="0" x2="0" y2="1">' +
                '<stop offset="0" stop-color="#7A5E66" stop-opacity="0"/>' +
                '<stop offset="1" stop-color="#7A5E66" stop-opacity="' + (0.15 + 0.3 * a).toFixed(3) + '"/></linearGradient>' : '';
        return '<svg viewBox="0 0 50 92" preserveAspectRatio="none" aria-hidden="true">' +
            '<defs>' + worn +
            '<clipPath id="' + c + '"><path d="' + foot + '"/></clipPath>' +
            '<linearGradient id="' + g + '" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0" stop-color="#F7B6C6"/><stop offset=".6" stop-color="#F3A7BA"/>' +
                '<stop offset="1" stop-color="#EE9DB1"/></linearGradient>' +
            '<radialGradient id="' + h + '" cx=".35" cy=".3" r=".75">' +
                '<stop offset="0" stop-color="#fff" stop-opacity=".22"/>' +
                '<stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>' +
            '</defs>' +
            // what's left of the block: the new eraser slid toward the
            // rubbing end by the rubber lost, cut off at the worn footprint
            '<g clip-path="url(#' + c + ')"><g transform="translate(0 ' + cut.toFixed(2) + ')">' +
            // footprint: the whole block, its rounded rubber corners
            '<rect x="1" y="1" width="48" height="90" rx="3.2" fill="#E88EA5"/>' +
            // far slanted end, lit
            '<path d="M1 4.2 Q1 1 4.2 1 H45.8 Q49 1 49 4.2 V12 H1 Z" fill="#F9C9D5"/>' +
            // near slanted end, in shade
            '<path d="M1 80 H49 V87.8 Q49 91 45.8 91 H4.2 Q1 91 1 87.8 Z" fill="#DE8099"/>' +
            // flat top face
            '<rect x="1" y="12" width="48" height="68" fill="url(#' + g + ')"/>' +
            '<rect x="1" y="12" width="48" height="68" fill="url(#' + h + ')"/>' +
            // soft creases where the top meets the slanted ends
            '<path d="M1 12 H49" stroke="#fff" stroke-opacity=".55" stroke-width=".6"/>' +
            '<path d="M1 80 H49" stroke="#B85D76" stroke-opacity=".35" stroke-width=".6"/>' +
            // printing, read along the length
            '<g transform="translate(25 46) rotate(-90)" fill="#4A2B35" fill-opacity=".78" text-anchor="middle">' +
                '<text x="-17" y="-9" font-family="DM Sans, system-ui, sans-serif" font-size="3.8" font-weight="700" letter-spacing=".3">HFYJ</text>' +
                '<text x="0" y="5" font-family="Caveat, cursive" font-size="16" font-weight="500">Jennifer</text>' +
                '<text x="18" y="11.5" font-family="DM Sans, system-ui, sans-serif" font-size="3" font-weight="700" letter-spacing=".2">Smudge FREE!</text>' +
            '</g></g>' +
            // the worn end: rounded-off rubber in shade, greyed by graphite
            (w > 0 ? '<rect x="0" y="' + (91 - 7 - 10 * a).toFixed(2) + '" width="50" height="' + (8 + 10 * a).toFixed(2) + '" fill="url(#' + s + ')"/>' +
                '<path d="' + foot + '" fill="none" stroke="#B85D76" stroke-opacity="' + (0.25 * a).toFixed(3) + '" stroke-width=".8"/>' : '') +
            '</g></svg>';
    }
    // Rubbing wears it a little; the drawing only changes in small steps
    // (and both copies, the one in hand and the one on the table, follow)
    function wearEraser(e) {
        if (wearLast) {
            var d = Math.hypot(e.clientX - wearLast[0], e.clientY - wearLast[1]);
            eraserWear = Math.min(1, eraserWear + d / WEAR_PX);
        }
        wearLast = [e.clientX, e.clientY];
        if (eraserWear >= 1) { newEraser(); return true; }
        var q = Math.round(eraserWear * 80) / 80;
        if (q === wearShown) return false;
        wearShown = q;
        if (held === 'eraser' && heldEl) heldEl.innerHTML = eraserSvg();
        var t = tools.eraser && tools.eraser.querySelector('.gt-lift');
        if (t) t.innerHTML = eraserSvg();
        return false;
    }
    // Rubbed down to nothing: it's gone from your hand, and a fresh one
    // drops onto the table where the eraser lives, ready to pick up
    function newEraser() {
        eraserWear = 0; wearShown = 0; wearLast = null;
        if (held === 'eraser') pickUp(null);
        var item = tools.eraser;
        if (!item) return;
        var t = item.querySelector('.gt-lift');
        if (t) t.innerHTML = eraserSvg();
        item.classList.remove('gt-fresh');
        void item.offsetWidth;   // restart the drop-in if it runs twice
        item.classList.add('gt-fresh');
        setTimeout(function () { item.classList.remove('gt-fresh'); }, 700);
    }
    var held = null, heldEl = null, ink = 'accent';
    var tools = {};

    function buildTool(name, svg) {
        var item = el('div', 'gt-item gt-tool gt-' + name);
        place(item, name, false);
        var lift = el('div', 'gt-lift', item);
        lift.innerHTML = svg;
        item.addEventListener('pointerdown', function (e) {
            e.stopPropagation();
            pickUp(held === name ? null : name, e);
        });
        tools[name] = item;
        return item;
    }

    function pickUp(name, e) {
        if (held) tools[held].classList.remove('is-held');
        held = name;
        document.body.classList.toggle('gt-holding', !!name && !coarse);
        if (!heldEl) {
            heldEl = el('div', 'gt-held');
            (document.getElementById('grid-view') || document.body).appendChild(heldEl);
        }
        if (!name) { heldEl.className = 'gt-held'; heldEl.innerHTML = ''; return; }
        tools[name].classList.add('is-held');
        if (coarse) return;
        heldEl.className = 'gt-held gt-held-' + name;
        heldEl.innerHTML = name === 'pencil' ? pencilSvg() : eraserSvg();
        if (e) moveHeld(e);
    }
    function moveHeld(e) {
        if (heldEl && held) heldEl.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    }
    window.addEventListener('pointermove', moveHeld, { passive: true });
    // Click anywhere that is not the canvas, the palette or a tool: put it down
    document.addEventListener('pointerdown', function (e) {
        if (!held) return;
        if (e.target.closest && e.target.closest('.gt-canvas, .gt-palette, .gt-tool')) return;
        pickUp(null);
    }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && held) pickUp(null); });

    function buildPalette() {
        var item = el('div', 'gt-item gt-palette');
        place(item, 'palette', false);
        var lift = el('div', 'gt-lift', item);
        COLORS.forEach(function (c) {
            var b = el('button', 'gt-swatch', lift);
            b.type = 'button';
            b.style.setProperty('--c', c.css);
            b.setAttribute('aria-label', c.key + ' pencil');
            if (c.key === ink) b.classList.add('is-on');
            b.addEventListener('click', function () {
                ink = c.key;
                stage.style.setProperty('--gt-ink', c.css);
                document.documentElement.style.setProperty('--gt-ink', c.css);
                lift.querySelectorAll('.gt-swatch').forEach(function (s) { s.classList.toggle('is-on', s === b); });
                if (held !== 'pencil') pickUp('pencil');
            });
        });
        return item;
    }

    /* ---------- the drawable card ---------- */
    var strokes = [], cv, ctx, clearBtn;
    // Cmd/Ctrl+Z steps back one stroke at a time (pencil or eraser, and a
    // Clear comes back whole); Cmd/Ctrl+Shift+Z or Ctrl+Y steps forward again
    var undoStack = [], redoStack = [];
    function undoDraw() {
        var a = undoStack.pop();
        if (!a) return false;
        if (a.clear) strokes = a.clear;
        else { var i = strokes.lastIndexOf(a.stroke); if (i >= 0) strokes.splice(i, 1); }
        redoStack.push(a);
        render();
        return true;
    }
    function redoDraw() {
        var a = redoStack.pop();
        if (!a) return false;
        if (a.clear) strokes = [];
        else strokes.push(a.stroke);
        undoStack.push(a);
        render();
        return true;
    }
    document.addEventListener('keydown', function (e) {
        if (!cv || !(e.metaKey || e.ctrlKey) || e.altKey) return;
        var t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (!cv.offsetParent) return;   // only while the table is on screen
        var k = (e.key || '').toLowerCase();
        var did = false;
        if (k === 'z' && !e.shiftKey) did = undoDraw();
        else if ((k === 'z' && e.shiftKey) || (k === 'y' && e.ctrlKey)) did = redoDraw();
        if (did) e.preventDefault();
    });
    function colorOf(key) {
        if (key === 'accent') return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#5E81E2';
        for (var i = 0; i < COLORS.length; i++) if (COLORS[i].key === key) return COLORS[i].css;
        return '#5E81E2';
    }
    /* ---------- eraser crumbs ----------
       Rubbing with the eraser sheds little rolled shards of pink rubber
       (some picking up a little of the ink they rubbed off). They scatter a
       touch and settle on the card; once you stop erasing for a moment a gust
       sweeps across from the left and blows them away, spinning and fading.
       One fixed overlay canvas, drawn only while there are crumbs. Positions
       are kept relative to the drawing card so a scroll carries them along. */
    var CRUMB_COLORS = ['#F3A7BA', '#EE9DB1', '#F7B6C6', '#E88EA5', '#DE8099'];
    var crumbs = [], crumbCv = null, crumbCtx = null, crumbRaf = 0, crumbAnchor = null;
    var lastShed = 0, gustAt = 0, shedFrom = null;
    var GUST_AFTER = 1700;   // ms of no erasing before the gust
    var MAX_CRUMBS = 90;
    function mixHex(a, b, t) {
        var m = /^#([0-9a-f]{6})$/i, pa = m.exec(a), pb = m.exec(b);
        if (!pa || !pb) return b;
        var x = parseInt(pa[1], 16), y = parseInt(pb[1], 16), out = 0;
        for (var s = 16; s >= 0; s -= 8) out |= Math.round(((x >> s) & 255) * t + ((y >> s) & 255) * (1 - t)) << s;
        return '#' + ('00000' + out.toString(16)).slice(-6);
    }
    function crumbLayer() {
        if (crumbCv) return;
        crumbCv = el('canvas', 'gt-crumbs', document.body);
        crumbCtx = crumbCv.getContext('2d');
        sizeCrumbs();
        window.addEventListener('resize', sizeCrumbs);
    }
    function sizeCrumbs() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        crumbCv.width = Math.round(window.innerWidth * dpr);
        crumbCv.height = Math.round(window.innerHeight * dpr);
        crumbCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function anchorPos() {
        var b = crumbAnchor.getBoundingClientRect();
        return { x: b.left, y: b.top };
    }
    // Shed crumbs along the eraser's path from the last point to this one
    function shed(e, anchor, eraserW, inkColor) {
        crumbLayer();
        crumbAnchor = anchor;
        var a = anchorPos();
        var x = e.clientX - a.x, y = e.clientY - a.y;
        var now = performance.now();
        if (!shedFrom) { shedFrom = { x: x, y: y }; lastShed = now; return; }
        var dist = Math.hypot(x - shedFrom.x, y - shedFrom.y);
        // about one crumb every 18px of rubbing: a light sprinkle, not a pile
        var n = Math.floor(dist / 18);
        if (n < 1) return;
        for (var i = 0; i < n; i++) {
            var t = Math.random();
            var px = shedFrom.x + (x - shedFrom.x) * t, py = shedFrom.y + (y - shedFrom.y) * t;
            var ang = Math.random() * Math.PI * 2, off = Math.random() * eraserW * 0.4;
            var dirx = (x - shedFrom.x) / (dist || 1), diry = (y - shedFrom.y) / (dist || 1);
            var len = 1.6 + Math.random() * 3.4;
            crumbs.push({
                x: px + Math.cos(ang) * off, y: py + Math.sin(ang) * off,
                // flicked out sideways and back from the stroke, then friction stops them
                vx: (-dirx * 0.6 + (Math.random() - 0.5) * 1.6) * 1.6,
                vy: (-diry * 0.6 + (Math.random() - 0.5) * 1.6) * 1.6,
                rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
                len: len, w: Math.max(1.2, len * (0.38 + Math.random() * 0.2)),
                // mostly pink rubber; now and then one tinged with the ink it lifted
                color: (inkColor && Math.random() < 0.12) ? mixHex(inkColor, '#E88EA5', 0.45) : CRUMB_COLORS[(Math.random() * CRUMB_COLORS.length) | 0],
                blown: false, delay: 0, a: 1
            });
        }
        if (crumbs.length > MAX_CRUMBS) {
            // too many on the card: the oldest drift off early
            for (var k = 0; k < crumbs.length - MAX_CRUMBS; k++) if (!crumbs[k].blown) blow(crumbs[k], 0);
        }
        shedFrom = { x: x, y: y };
        lastShed = now;
        gustAt = 0;
        if (!crumbRaf) crumbRaf = requestAnimationFrame(tickCrumbs);
    }
    function endShed() { shedFrom = null; }
    function blow(c, delay) {
        c.blown = true;
        c.delay = delay;
        c.vx = 0.4 + Math.random() * 0.8;
        c.vy = -0.3 - Math.random() * 0.6;
        c.vr = (Math.random() - 0.5) * 0.5;
        c.gust = 0.07 + Math.random() * 0.11;   // how hard this one catches the wind
    }
    function tickCrumbs(now) {
        crumbRaf = 0;
        if (!crumbs.length || !crumbAnchor) return;
        // A moment after the last rub: one gust sweeps across, left to right
        if (!gustAt && !shedFrom && now - lastShed > GUST_AFTER) {
            gustAt = now;
            var minX = Infinity, maxX = -Infinity;
            crumbs.forEach(function (c) { if (!c.blown) { minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x); } });
            var span = Math.max(maxX - minX, 1);
            crumbs.forEach(function (c) {
                if (!c.blown) blow(c, reduced ? 0 : ((c.x - minX) / span) * 260 + Math.random() * 90);
            });
        }
        var a = anchorPos();
        var W = window.innerWidth, H = window.innerHeight;
        crumbCtx.clearRect(0, 0, W, H);
        var alive = [];
        for (var i = 0; i < crumbs.length; i++) {
            var c = crumbs[i];
            if (c.blown) {
                if (c.delay > 0) { c.delay -= 16; }
                else if (reduced) { c.a -= 0.06; }
                else {
                    // the wind picks it up: speeds off to the right, lifting a little,
                    // tumbling, and thins out as it goes
                    c.vx += c.gust; c.vy -= c.gust * 0.12;
                    c.vr *= 1.01;
                    c.a -= 0.006 + c.gust * 0.04;
                }
            } else {
                c.vx *= 0.82; c.vy *= 0.82; c.vr *= 0.82;
            }
            c.x += c.vx; c.y += c.vy; c.rot += c.vr;
            var sx = a.x + c.x, sy = a.y + c.y;
            if (c.a <= 0 || sx > W + 40 || sy < -40) continue;
            alive.push(c);
            crumbCtx.save();
            crumbCtx.globalAlpha = Math.max(0, Math.min(1, c.a));
            crumbCtx.translate(sx, sy);
            crumbCtx.rotate(c.rot);
            // a little rolled worm of rubber: capsule body, a darker underside
            crumbCtx.fillStyle = c.color;
            crumbCtx.beginPath();
            var r = c.w / 2, hl = Math.max(c.len / 2 - r, 0);
            crumbCtx.moveTo(-hl, -r); crumbCtx.lineTo(hl, -r);
            crumbCtx.arc(hl, 0, r, -Math.PI / 2, Math.PI / 2);
            crumbCtx.lineTo(-hl, r);
            crumbCtx.arc(-hl, 0, r, Math.PI / 2, Math.PI * 1.5);
            crumbCtx.fill();
            crumbCtx.globalAlpha *= 0.35;
            crumbCtx.fillStyle = '#9C4A62';
            crumbCtx.fillRect(-hl, r * 0.15, hl * 2, r * 0.7);
            crumbCtx.restore();
        }
        crumbs = alive;
        if (crumbs.length) crumbRaf = requestAnimationFrame(tickCrumbs);
        else crumbCtx.clearRect(0, 0, W, H);
    }

    function buildCanvas() {
        var item = el('div', 'gt-item gt-canvas');
        place(item, 'canvas', true);
        var lift = el('div', 'gt-lift', item);
        var face = el('span', 'gt-face gt-paper', lift);
        cv = el('canvas', '', face);
        ctx = cv.getContext('2d');
        clearBtn = el('button', 'gt-clear', face);
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';
        clearBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
        clearBtn.addEventListener('click', function () {
            if (!strokes.length) return;
            undoStack.push({ clear: strokes }); redoStack = [];
            strokes = []; render();
        });

        var cur = null;
        function local(e) {
            var b = cv.getBoundingClientRect();
            var r = (parseFloat(getComputedStyle(item).getPropertyValue('--rr')) || 0) * Math.PI / 180;
            var ox = e.clientX - (b.left + b.width / 2), oy = e.clientY - (b.top + b.height / 2);
            var x = ox * Math.cos(r) + oy * Math.sin(r), y = -ox * Math.sin(r) + oy * Math.cos(r);
            return [(x + cv.offsetWidth / 2) / cv.offsetWidth, (y + cv.offsetHeight / 2) / cv.offsetWidth];
        }
        face.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            // Starting to draw with nothing in hand picks up the pencil, so the
            // pencil is the cursor the whole time you draw (eraser stays if held)
            if (!held) pickUp('pencil', e);
            face.setPointerCapture(e.pointerId);
            cur = { tool: held || 'pencil', color: ink, pts: [local(e)] };
            strokes.push(cur);
            undoStack.push({ stroke: cur }); redoStack = [];
            if (cur.tool === 'eraser') { endShed(); rub(e); }
            render();
        });
        face.addEventListener('pointermove', function (e) {
            if (!cur) return;
            var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
            for (var i = 0; i < evs.length; i++) cur.pts.push(local(evs[i]));
            if (cur.tool === 'eraser') rub(e);
            render();
        });
        // Crumbs carry a little of the most recent ink, if there is any
        function rub(e) {
            var inkC = null;
            for (var i = strokes.length - 1; i >= 0; i--) {
                if (strokes[i].tool !== 'eraser') { inkC = colorOf(strokes[i].color); break; }
            }
            shed(e, face, cv.offsetWidth * 0.09, inkC);
            // used up mid-stroke: the rubbing stops right there
            if (wearEraser(e)) { endShed(); cur = null; }
        }
        function up() { if (cur && cur.tool === 'eraser') endShed(); cur = null; wearLast = null; }
        face.addEventListener('pointerup', up);
        face.addEventListener('pointercancel', up);
        if (window.ResizeObserver) new ResizeObserver(size).observe(face);
        return item;
    }
    function size() {
        var dpr = Math.min(window.devicePixelRatio || 1, 2);
        var w = cv.offsetWidth, h = cv.offsetHeight;
        if (!w) return;
        cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
        render();
    }
    function render() {
        if (!ctx) return;
        var W = cv.width;
        ctx.clearRect(0, 0, cv.width, cv.height);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        strokes.forEach(function (s) {
            ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
            ctx.strokeStyle = ctx.fillStyle = colorOf(s.color);
            ctx.lineWidth = (s.tool === 'eraser' ? 0.09 : 0.016) * W;
            var p = s.pts;
            if (p.length === 1) {
                ctx.beginPath(); ctx.arc(p[0][0] * W, p[0][1] * W, ctx.lineWidth / 2, 0, Math.PI * 2); ctx.fill();
                return;
            }
            ctx.beginPath();
            ctx.moveTo(p[0][0] * W, p[0][1] * W);
            for (var i = 1; i < p.length - 1; i++) {
                var mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
                ctx.quadraticCurveTo(p[i][0] * W, p[i][1] * W, mx * W, my * W);
            }
            ctx.lineTo(p[p.length - 1][0] * W, p[p.length - 1][1] * W);
            ctx.stroke();
        });
        ctx.globalCompositeOperation = 'source-over';
        clearBtn.classList.toggle('is-on', strokes.length > 0);
    }

    /* ---------- build + drop in ---------- */
    function build() {
        var hero = document.getElementById('grid-hero');
        if (!hero || document.getElementById('gt-stage')) return;
        stage = el('div', 'gt-stage');
        stage.id = 'gt-stage';
        frame = el('div', 'gt-frame', stage);
        // Order = stacking order and drop order
        var items = [
            makeCard('cardA').item, makeCard('cardB').item, buildDeck(),
            buildCanvas(), makeCard('cardC').item,
            buildTool('pencil', pencilSvg()), buildTool('eraser', eraserSvg()),
            buildPalette()
        ];
        items.forEach(function (it, i) {
            it.style.setProperty('--d', (i * 80) + 'ms');
            frame.appendChild(it);
        });
        hero.classList.add('gt-has-table');
        hero.appendChild(stage);
        size();

        // Drop everything onto the table once the header text has risen in
        function go() { setTimeout(function () { stage.classList.add('gt-in'); }, reduced ? 0 : 450); }
        if (hero.classList.contains('visible')) go();
        else {
            var mo = new MutationObserver(function () {
                if (hero.classList.contains('visible')) { mo.disconnect(); go(); }
            });
            mo.observe(hero, { attributes: true, attributeFilter: ['class'] });
        }

        // Theme: dark/light faces, and the accent pencil redraws in the new accent
        new MutationObserver(function () {
            cards.forEach(function (c) { c.img.src = faceUrl(c.face); });
            render();
        }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})();
