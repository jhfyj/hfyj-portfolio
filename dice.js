/* Dice, lying on the sketchbook's mat.
   ---------------------------------------------------------------------------
   Classic script, no imports, no build step — the same shape as sketchbook.js,
   and loaded after it because where a die can go depends on what sketchbook.js
   has already put down.

   Two or three of them, scattered across the part of the table you can see.
   Press one and it hops, tumbles and settles on a different number; drag it
   and it slides, the same slop a card uses so a wobble is not a throw. The
   chips slide; the dice roll, or they move.

   The one thing worth being careful about is that the number a die shows and
   the number it says it is holding are the same number. Those are two different
   things — one is a rotation, one is a variable — and nothing stops them
   drifting apart except making it impossible. That is what SIDES below is for:
   it is the only place either of them is written down, the faces are built from
   it and the rotation that shows a face is its exact inverse, term for term. */
(function () {
    'use strict';

    var surface = document.getElementById('surface');
    var felt = document.getElementById('felt');
    var playedEl = document.getElementById('played');
    var fanEl = document.getElementById('fan');
    var tableEl = document.getElementById('table');
    if (!surface || !felt || !playedEl || !fanEl) return;

    // The die's width in pixels, and how far each face therefore sits from the
    // centre of the cube. A die is a little smaller than a chip: it is the one
    // thing on the table you are meant to reach for, and at chip size three of
    // them start competing with the cards for the eye.
    var DIE_W = 46;
    var DIE_HALF = DIE_W / 2;
    // How far a corner of the cube reaches from its centre at the worst point
    // of a turn. Every clearance below is measured against this and not against
    // DIE_HALF, because a die that clears its neighbour at rest and clips it
    // half way through a tumble has not cleared it.
    var DIE_REACH = DIE_W * 0.71;
    var DICE = 3;
    var ROLL_MS = 620;
    // Same four pixels the cards and chips use. Below it a press is a click
    // and the die rolls; above it the press was a drag and the click that
    // follows is swallowed.
    var DRAG_SLOP = 4;

    /* ---------------- the cube ---------------- */

    /* Where each number lives on the cube, and — by construction — how to turn
       the cube so that number faces you.

       Read it as: face v is the front face taken to its place by
       `rotateY(ry) rotateX(rx)`. Turning it back to the front is therefore
       `rotateX(-rx) rotateY(-ry)`, which cancels exactly: the two rotations are
       inverses about the same two axes, so the face lands square on and the
       right way up, for all six, without a second table saying so.

       The numbers themselves are a real die and not six arbitrary placements:
       opposite faces sum to seven (1-6, 2-5, 3-4), and the three faces round a
       corner run 1, 2, 3 anticlockwise, which is the Western die everyone has
       held. Putting 3 on the left rather than the right is what makes it that
       one rather than its mirror image. */
    var SIDES = {
        1: { at: 'front',  ry: 0,    rx: 0 },
        2: { at: 'top',    ry: 0,    rx: 90 },
        3: { at: 'left',   ry: -90,  rx: 0 },
        4: { at: 'right',  ry: 90,   rx: 0 },
        5: { at: 'bottom', ry: 0,    rx: -90 },
        6: { at: 'back',   ry: 180,  rx: 0 }
    };

    // Which of the nine cells on a face carry a pip, as [column, row] counting
    // from the top left. Diagonals for 2 and 3, corners for 4, corners and the
    // middle for 5, two columns of three for 6.
    var PIPS = {
        1: [[1, 1]],
        2: [[0, 0], [2, 2]],
        3: [[0, 0], [1, 1], [2, 2]],
        4: [[0, 0], [2, 0], [0, 2], [2, 2]],
        5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
        6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]]
    };

    // The only place a die's transform is written. Every resting pose and every
    // frame of every tumble goes through here, so a keyframe and the style the
    // animation lands on cannot end up composing their rotations in a different
    // order and disagreeing by a quarter turn.
    //
    // Order matters and is not arbitrary. The hop is outermost, so it is a
    // movement in front of the camera rather than along whichever way the die
    // happens to be pointing. rotateZ is next, so the settle's slight lean is a
    // roll in the picture plane. The two that decide which number you are
    // looking at come last.
    function frame(hopY, hopZ, rz, rx, ry) {
        return 'translate3d(0px, ' + hopY + 'px, ' + hopZ + 'px)'
            + ' rotateZ(' + rz + 'deg)'
            + ' rotateX(' + rx + 'deg)'
            + ' rotateY(' + ry + 'deg)';
    }

    // The angles that put face v square-on to the viewer. No extra lean: at
    // rest the die shows exactly one face, and the cube-on-the-table shadow is
    // what tells you it has volume. A few degrees of rotateZ still sit on top
    // of this, but that is a turn in the picture plane — the same face stays
    // in front.
    function showAngles(v) {
        var s = SIDES[v];
        return { x: -s.rx, y: -s.ry };
    }

    // The shadow's own transform. It is a second cube, the same size as the
    // die, laid down on the paper so it reads as the shadow a cube casts on a
    // table rather than as an oval smudge. CAST_LIE tips it onto the felt;
    // CAST_YAW turns it enough that a second face shows, so at rest it is
    // always a cube sitting on the table and never a dark square that happens
    // to match whichever number the die is showing. The hop never lifts it —
    // a shadow stays on the table — and only slides it further from the die,
    // spreads it and lets it go, which is what height looks like when the
    // light is coming from above and slightly to the left.
    var CAST_LIE = 50;
    var CAST_YAW = 34;
    var CAST_OX = 9;
    var CAST_OY = 13;

    function castFrame(hopY, hopZ, rz, tumbleX, tumbleY, opacity) {
        var lift = Math.max(0, -hopY) + hopZ * 0.18;
        var spread = 1 + lift / 40;
        var ox = CAST_OX + lift * 0.22;
        var oy = CAST_OY + lift * 0.36;
        return {
            transform: 'translate3d(' + ox + 'px, ' + oy + 'px, 0px)'
                + ' rotateX(' + CAST_LIE + 'deg)'
                + ' rotateY(' + CAST_YAW + 'deg)'
                + ' scale(' + spread + ')'
                + ' rotateZ(' + rz + 'deg)'
                + ' rotateX(' + tumbleX + 'deg)'
                + ' rotateY(' + tumbleY + 'deg)',
            opacity: opacity == null ? Math.max(0.3, 1 - lift / 52) : opacity
        };
    }

    function applyCast(el, hopY, hopZ, rz, rx, ry, opacity) {
        var c = castFrame(hopY, hopZ, rz, rx, ry, opacity);
        el.__cast.style.transform = c.transform;
        el.__cast.style.opacity = String(c.opacity);
    }

    function paintFaces(parent, withPips) {
        for (var v = 1; v <= 6; v++) {
            var s = SIDES[v];
            var face = document.createElement('div');
            face.className = withPips ? 'die-face' : 'die-cast-face';
            face.setAttribute('data-at', s.at);
            face.style.transform = 'rotateY(' + s.ry + 'deg) rotateX(' + s.rx + 'deg)'
                + ' translateZ(' + DIE_HALF + 'px)';
            if (withPips) {
                // Named so the stylesheet can light it, and so a check can ask
                // the document which face it is looking at without reading this
                // script.
                face.setAttribute('data-value', String(v));
                var pips = PIPS[v];
                for (var i = 0; i < pips.length; i++) {
                    var pip = document.createElement('div');
                    pip.className = 'die-pip';
                    pip.style.gridColumn = String(pips[i][0] + 1);
                    pip.style.gridRow = String(pips[i][1] + 1);
                    face.appendChild(pip);
                }
            }
            parent.appendChild(face);
        }
    }

    function buildDie() {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'die';
        el.style.setProperty('--die-w', DIE_W + 'px');

        var cast = document.createElement('div');
        cast.className = 'die-cast';
        paintFaces(cast, false);
        el.appendChild(cast);

        var cube = document.createElement('div');
        cube.className = 'die-cube';
        paintFaces(cube, true);
        el.appendChild(cube);
        el.__cube = cube;
        el.__cast = cast;
        return el;
    }

    /* ---------------- rolling one ---------------- */

    var status = null;

    function announce(v) {
        if (!status) return;
        // A reader who cannot watch the tumble gets the result in words. Its own
        // region rather than the rack's, which belongs to sketchbook.js and is
        // saying something else.
        status.textContent = 'Rolled a ' + v + '.';
    }

    function setValue(el, v) {
        el.__value = v;
        el.setAttribute('data-value', String(v));
        el.setAttribute('aria-label', 'Die showing ' + v + '. Roll it, or drag it.');
    }

    // Never the number it is already on. The ask was that a die flips to a
    // different number, and a roll that comes up the same reads as a click that
    // did nothing — worse than no animation at all. Drawing one of the other
    // five and stepping over the current value keeps that uniform: no face is
    // favoured, and over any run of rolls all six turn up.
    function otherFace(v) {
        var n = 1 + Math.floor(Math.random() * 5);
        return n >= v ? n + 1 : n;
    }

    function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

    // The shortest way round from one angle to another, in degrees. Without this
    // a die going from 180 to -180 would take the long way for no reason.
    function wrap(d) {
        d = d % 360;
        if (d > 180) d -= 360;
        if (d <= -180) d += 360;
        return d;
    }

    // Settle a die on a value with no movement at all: the pose it holds
    // between rolls, and the whole of a roll when the reader has asked for less
    // motion.
    function settle(el, v, rz) {
        var a = showAngles(v);
        a.z = rz;
        el.__angles = a;
        el.__cube.style.transform = frame(0, 0, a.z, a.x, a.y);
        applyCast(el, 0, 0, a.z, 0, 0, 1);
        setValue(el, v);
    }

    // The shape of the throw, as fractions: when the die is in the air, and how
    // much of its turning is behind it by then. It leaves the table fast, does
    // most of its turning on the way up, comes down hard at 0.62, catches a
    // small rebound and stops. That deceleration is the difference between a
    // die that was knocked and a die that is spinning like a top.
    var ARC = [
        { at: 0.00, y: 0,   z: 0,  turned: 0.00, ease: 'cubic-bezier(0.15, 0.62, 0.35, 1)' },
        { at: 0.30, y: -19, z: 30, turned: 0.44, ease: 'cubic-bezier(0.42, 0, 0.55, 1)' },
        { at: 0.62, y: 0,   z: 5,  turned: 0.79, ease: 'cubic-bezier(0.25, 0, 0.24, 1)' },
        { at: 0.80, y: -6,  z: 11, turned: 0.93, ease: 'cubic-bezier(0.33, 0, 0.3, 1)' },
        { at: 1.00, y: 0,   z: 0,  turned: 1.00 }
    ];

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');

    function roll(el) {
        // A die already in the air cannot be thrown again.
        if (el.__rolling) return;

        var from = el.__angles;
        var next = otherFace(el.__value);
        // A die that has been knocked does not come to rest exactly as it
        // started; a few degrees of roll each time is what keeps three of them
        // from looking like one drawing repeated.
        var to = showAngles(next);
        to.z = rand(-6, 6);

        if (reduce && reduce.matches) {
            settle(el, next, to.z);
            announce(next);
            return;
        }

        // How far it turns. The shortest way round to the new number, plus a
        // whole extra turn on each axis so there is a tumble to watch rather
        // than a nudge. Because the extra is a whole turn, the angles the
        // animation ends on and the angles the die is left holding describe the
        // same matrix — which is why the die can be settled first and animated
        // afterwards with no snap when the animation lets go.
        var spinX = wrap(to.x - from.x) + 360 * (Math.random() < 0.5 ? -1 : 1);
        var spinY = wrap(to.y - from.y) + 360 * (Math.random() < 0.5 ? -1 : 1);
        // No extra turns in the picture plane: a die rolling flat like that
        // reads as a spinning top, which is the one thing it must not look like.
        var spinZ = wrap(to.z - from.z);

        // The shadow cube lands on the same cube-on-the-table pose every time,
        // so its extra turns are whole revolutions — the die's face-change is
        // not its problem. Same direction as the die, so the two stay a pair
        // on the way round rather than winding against each other.
        var castSpinX = 360 * (spinX < 0 ? -1 : 1);
        var castSpinY = 360 * (spinY < 0 ? -1 : 1);

        var keys = [];
        var castKeys = [];
        for (var i = 0; i < ARC.length; i++) {
            var k = ARC[i];
            var rz = from.z + spinZ * k.turned;
            var rx = from.x + spinX * k.turned;
            var ry = from.y + spinY * k.turned;
            var kf = {
                offset: k.at,
                transform: frame(k.y, k.z, rz, rx, ry)
            };
            var ck = castFrame(k.y, k.z, rz, castSpinX * k.turned, castSpinY * k.turned);
            ck.offset = k.at;
            if (k.ease) {
                kf.easing = k.ease;
                ck.easing = k.ease;
            }
            keys.push(kf);
            castKeys.push(ck);
        }

        el.__rolling = true;
        // Promised for the length of the throw and taken back after, the same
        // way a dragged card does it: a layer that is kept for a die sitting
        // still is a layer being paid for and not used.
        el.__cube.style.willChange = 'transform';
        el.__cast.style.willChange = 'transform, opacity';

        // Settled before it is animated, not after. The animation is left to
        // fill nothing, so when it lets go the die is already holding the pose
        // its last frame arrived at, and there is no frame in between where the
        // number could be read as something else.
        settle(el, next, to.z);
        announce(next);

        var anim = el.__cube.animate(keys, { duration: ROLL_MS, easing: 'linear' });
        // The shadow cube turns with the die — a whole extra revolution, the
        // same way round — so a tumble on the table is a tumbling silhouette
        // rather than a smudge that merely grows. It does not hop: lift only
        // pushes it further from the die, spreads it and lets more light in.
        el.__cast.animate(castKeys, { duration: ROLL_MS, easing: 'linear' });

        anim.onfinish = function () {
            el.__cube.style.willChange = '';
            el.__cast.style.willChange = '';
            el.__rolling = false;
        };
    }

    // The rectangle a die may sit in and stay whole, in the surface's own
    // coordinates. The whole surface, not the visible part: same reason a card
    // dragged off the edge of the window is still on the table.
    function dieBounds() {
        var s = surface.getBoundingClientRect();
        var pad = 8;
        return {
            minX: pad,
            maxX: Math.max(pad, s.width - DIE_W - pad),
            minY: pad,
            maxY: Math.max(pad, s.height - DIE_W - pad)
        };
    }

    function wire(el) {
        var drag = null;
        // Set when a gesture turned out to be a drag, so the click that follows
        // it does not also roll the die. Same flag makePlayable keeps on a card.
        var swallowClick = false;

        // The mat's pan handler is on #felt and takes pointer capture the moment
        // it sees a press. It steps aside for a card or a chip by name; a die
        // still has to stop the press here, because the gesture belongs to the
        // thing under the pointer and the mat should not have to know what that
        // is.
        el.addEventListener('pointerdown', function (e) {
            if (e.button !== undefined && e.button !== 0) return;
            e.stopPropagation();
            drag = {
                id: e.pointerId,
                px: e.clientX, py: e.clientY,
                ox: parseFloat(el.style.left) || 0,
                oy: parseFloat(el.style.top) || 0,
                moved: false
            };
            if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
        });

        el.addEventListener('dragstart', function (e) { e.preventDefault(); });

        el.addEventListener('pointermove', function (e) {
            if (!drag || e.pointerId !== drag.id) return;
            var dx = e.clientX - drag.px, dy = e.clientY - drag.py;
            if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_SLOP) return;
            if (!drag.moved) {
                drag.moved = true;
                drag.bounds = dieBounds();
                el.classList.add('is-dragging');
                el.style.willChange = 'left, top';
            }
            var b = drag.bounds;
            var x = Math.min(Math.max(drag.ox + dx, b.minX), b.maxX);
            var y = Math.min(Math.max(drag.oy + dy, b.minY), b.maxY);
            el.style.left = Math.round(x) + 'px';
            el.style.top = Math.round(y) + 'px';
        });

        function end(e) {
            if (!drag || e.pointerId !== drag.id) return;
            if (el.releasePointerCapture && el.hasPointerCapture && el.hasPointerCapture(e.pointerId)) {
                el.releasePointerCapture(e.pointerId);
            }
            el.classList.remove('is-dragging');
            el.style.willChange = '';
            swallowClick = drag.moved;
            drag = null;
        }
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);

        // click and not pointerup, so Enter and Space on a focused die throw it
        // too. A die you can press is a control, and a control you cannot reach
        // from the keyboard is a control only half the readers have.
        el.addEventListener('click', function (e) {
            e.stopPropagation();
            if (swallowClick) { swallowClick = false; return; }
            roll(el);
        });
    }

    /* ---------------- putting them down ---------------- */

    // Where the chips ended up, and how much room each of them wants kept
    // clear. Their own inline geometry rather than their boxes: a chip is laid
    // down turned, and a rotated element's bounding box is up to root-two wider
    // than the thing inside it, which would push the dice further out than they
    // need to go.
    function chipSpots() {
        var out = [];
        var chips = surface.querySelectorAll(':scope > .chip');
        for (var i = 0; i < chips.length; i++) {
            var s = chips[i];
            var w = parseFloat(s.style.getPropertyValue('--chip-w')) || 52;
            var x = parseFloat(s.style.left) || 0;
            var y = parseFloat(s.style.top) || 0;
            out.push({ x: x + w / 2, y: y + w / 2, r: w / 2 });
        }
        return out;
    }

    // How much daylight there is between a die whose top left corner would be
    // at x, y and everything already on the table. Negative means it would
    // crowd something.
    function clearance(x, y, taken) {
        var cx = x + DIE_HALF, cy = y + DIE_HALF;
        var least = Infinity;
        for (var i = 0; i < taken.length; i++) {
            var t = taken[i];
            var dx = t.x - cx, dy = t.y - cy;
            var gap = Math.sqrt(dx * dx + dy * dy) - (t.r + DIE_REACH + 16);
            if (gap < least) least = gap;
        }
        return least;
    }

    // Somewhere on the part of the table you can actually see, clear of the hand
    // and of everything already lying on it. Surface coordinates, and measured
    // at the moment of placing, because the surface is half again as big as the
    // window onto it and only the band showing through is worth using — a die
    // outside it is a die the reader has to go looking for.
    //
    // Best of a run of draws rather than the first one that fits, and the run
    // stops the moment something fits: a retry loop that can fail is worse than
    // a choice that cannot, and this one always returns its best attempt along
    // with whether that attempt was good enough.
    function spot(taken) {
        var f = felt.getBoundingClientRect();
        var sr = surface.getBoundingClientRect();
        var viewX = f.left - sr.left, viewY = f.top - sr.top;
        var fanTop = fanEl.getBoundingClientRect().top - sr.top;

        var minX = viewX + DIE_W;
        var maxX = Math.max(minX, viewX + f.width - DIE_W * 2);
        var minY = viewY + DIE_W;
        var maxY = Math.max(minY, fanTop - DIE_W - 24);

        var best = null, bestGap = -Infinity;
        for (var t = 0; t < 200; t++) {
            var x = minX + Math.random() * (maxX - minX);
            var y = minY + Math.random() * (maxY - minY);
            var gap = clearance(x, y, taken);
            if (gap > bestGap) { bestGap = gap; best = { x: x, y: y }; }
            if (bestGap >= 0) break;
        }
        best.clear = bestGap >= 0;
        return best;
    }

    function scatterDice() {
        status = document.createElement('p');
        status.id = 'dice-status';
        status.className = 'visually-hidden';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        (tableEl || document.body).appendChild(status);

        var taken = chipSpots();
        for (var i = 0; i < DICE; i++) {
            var s = spot(taken);
            // Two is the fewest that reads as dice rather than as one stray
            // object, so the first two go down wherever the roomiest spot is
            // even on a window with little room to give. The third only goes
            // down if it can have room of its own; crowding a chip to make up
            // the number is worse than there being two.
            if (!s.clear && i >= 2) break;

            var die = buildDie();
            die.style.left = Math.round(s.x) + 'px';
            die.style.top = Math.round(s.y) + 'px';
            // Square-on, with only a few degrees of roll in the picture plane.
            // The cube-shaped shadow is what stops it reading as a pip card,
            // and the roll is what stops three of them looking like one drawing
            // repeated.
            settle(die, 1 + Math.floor(Math.random() * 6), rand(-6, 6));
            wire(die);
            // Ahead of #played in the document, same as the chips. What puts a
            // die above a card — dragged or not — is z-index, not this order:
            // see --die-z on #surface.
            surface.insertBefore(die, playedEl);
            taken.push({ x: s.x + DIE_HALF, y: s.y + DIE_HALF, r: DIE_REACH });
        }
    }

    /* ---------------- start ---------------- */

    // sketchbook.js lays the chips down only once the catalogue has arrived and
    // the table has been centred, and both of those decide where a die can go:
    // the chips because a die must not crowd one, the pan because it is what
    // settles which part of the surface is the part you can see. So this waits
    // for the mat to be finished rather than racing it. The cap is there so that
    // a catalogue that never arrives leaves dice on an empty table rather than
    // a frame loop running for the life of the page.
    var frames = 0;
    function whenMatIsSet() {
        var ready = surface.querySelectorAll(':scope > .chip').length >= 2
            && surface.style.getPropertyValue('--px') !== '';
        if (ready || frames > 240) { scatterDice(); return; }
        frames++;
        requestAnimationFrame(whenMatIsSet);
    }
    requestAnimationFrame(whenMatIsSet);
})();
