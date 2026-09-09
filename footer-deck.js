/* The three cards in the footer.
   ---------------------------------------------------------------------------
   Classic script, no imports — same shape as site.js and skeleton.js, so it
   loads on the home page without going through the bundler.

   Three cards off a thirteen-card deck, dealt fresh on every visit, and each
   one flips like the real thing: click it and it turns face down, click it
   again and it comes back up as a different card. The swap happens while the
   back is towards you, which is the whole trick — the front is changed at the
   moment nobody can see it, so the second click reveals a card rather than
   catching one mid-change.

   Nothing is stored. A reload deals a new hand, which is the point. */
(function () {
    'use strict';

    var DECK_DIR = './assets/PokerDeck/';
    var BACK_SRC = './Cards/back.jpg';
    var HAND_SIZE = 3;

    // The filenames have spaces in them, so every URL is built through
    // encodeURIComponent rather than pasted together.
    var FACES = [
        'Frame 470.jpg', 'Frame 471.jpg', 'Frame 472.jpg', 'Frame 473.jpg',
        'Frame 474.jpg', 'Frame 475.jpg', 'Frame 476.jpg', 'Frame 477.jpg',
        'Frame 478.jpg', 'Frame 479.jpg', 'Frame 480.jpg', 'Frame 481.jpg',
        'Frame 482.jpg'
    ];

    var reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Kept in step with the transition in style.css, but only as a backstop.
    var FLIP_MS = reduced ? 0 : 560;
    var FLIP_SLACK_MS = 1200;

    function url(face) { return DECK_DIR + encodeURIComponent(face); }

    function shuffle(a) {
        for (var i = a.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
    }

    // One shuffled pile, drawn from in order and reshuffled when it runs out,
    // so a visitor who keeps flipping works through the whole deck instead of
    // seeing the same two or three faces come round again. Anything already on
    // the table is skipped: three cards showing should be three different
    // cards.
    var pile = shuffle(FACES.slice());
    var next = 0;

    function draw(taken) {
        for (var tries = 0; tries < FACES.length * 2; tries++) {
            if (next >= pile.length) { pile = shuffle(FACES.slice()); next = 0; }
            var face = pile[next++];
            if (taken.indexOf(face) === -1) return face;
        }
        return pile[0];
    }

    function build(root) {
        var cards = [];

        function taken() {
            var out = [];
            for (var i = 0; i < cards.length; i++) out.push(cards[i].face);
            return out;
        }

        for (var i = 0; i < HAND_SIZE; i++) {
            var face = draw(taken());

            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'gf-card';
            btn.setAttribute('aria-label', 'Flip card');

            var inner = document.createElement('span');
            inner.className = 'gf-card-inner';

            var front = document.createElement('img');
            front.className = 'gf-card-face gf-card-front';
            front.src = url(face);
            front.alt = '';
            front.setAttribute('data-skel', '');
            front.setAttribute('draggable', 'false');

            var back = document.createElement('img');
            back.className = 'gf-card-face gf-card-back';
            back.src = BACK_SRC;
            back.alt = '';
            back.setAttribute('data-skel', '');
            back.setAttribute('draggable', 'false');

            inner.appendChild(front);
            inner.appendChild(back);
            btn.appendChild(inner);
            root.appendChild(btn);

            cards.push({ el: btn, inner: inner, front: front, face: face, down: false, busy: false });
        }

        // Runs `fn` once the turn has actually finished on screen.
        //
        // A plain timer is not enough. The class goes on immediately, but the
        // transition only starts when the browser next paints, and on this page
        // that can be a long way off — under software GL the carousel held the
        // main thread for 1.4s while the card sat unturned. A timer fired then
        // would have changed the front while it was still facing the visitor,
        // which is the one thing this must never do. So the transition's own
        // end event is what we listen for, and the timer is only there for the
        // cases where no transition runs at all: reduced motion, or a card in a
        // part of the page the browser is not rendering.
        function afterFlip(card, fn) {
            var settled = false;
            function finish() {
                if (settled) return;
                settled = true;
                window.clearTimeout(timer);
                card.inner.removeEventListener('transitionend', onEnd);
                fn();
            }
            function onEnd(e) {
                if (e.target === card.inner && e.propertyName === 'transform') finish();
            }
            if (FLIP_MS > 0) card.inner.addEventListener('transitionend', onEnd);
            var timer = window.setTimeout(finish, FLIP_MS > 0 ? FLIP_MS + FLIP_SLACK_MS : 0);
        }

        function flip(card) {
            if (card.busy) return;
            card.busy = true;
            card.down = !card.down;
            card.el.classList.toggle('is-flipped', card.down);
            card.el.setAttribute('aria-label', card.down ? 'Turn the card back over' : 'Flip card');

            afterFlip(card, function () {
                // Face down now: change the front while it is hidden, so the
                // next click turns up a card the visitor has not seen.
                if (card.down) {
                    var face = draw(taken());
                    card.face = face;
                    card.front.setAttribute('data-skel', '');
                    card.front.src = url(face);
                }
                card.busy = false;
            });
        }

        for (var k = 0; k < cards.length; k++) {
            (function (card) {
                card.el.addEventListener('click', function () { flip(card); });
            })(cards[k]);
        }
    }

    function start() {
        var slots = document.querySelectorAll('[data-deck-hand]');
        for (var i = 0; i < slots.length; i++) {
            if (slots[i].getAttribute('data-deck-dealt') === '1') continue;
            slots[i].setAttribute('data-deck-dealt', '1');
            build(slots[i]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
