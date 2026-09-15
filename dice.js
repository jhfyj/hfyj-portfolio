/* Dice, lying on the sketchbook's mat.
   ---------------------------------------------------------------------------
   Classic script, no imports, no build step — the same shape as sketchbook.js,
   and loaded after it because where a die can go depends on what sketchbook.js
   has already put down.

   Two or three of them, around the printed name — never on it. Press one and it hops,
   tumbles and settles on a different number; drag it
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

    /* ---------------- the shadow ---------------- */

    // The shadow at rest is a second cube, the same size as the die, laid down
    // on the paper so it reads as the shadow a cube casts on a table rather
    // than as an oval smudge. CAST_LIE tips it onto the felt; CAST_YAW turns it
    // enough that a second face shows, so at rest it is always a cube sitting
    // on the table and never a dark square that happens to match whichever
    // number the die is showing.
    //
    // The rest offset (CAST_OX/OY) lives on the wrapper as --cast-dx/dy so
    // the lamp can nudge it without rewriting the cube's own turn. A few
    // pixels toward the far side of the cursor is enough; the crescent on
    // a chip is the same idea.
    var CAST_LIE = 52;
    var CAST_YAW = 36;
    var CAST_OX = 12;
    var CAST_OY = 17;
    var CAST_LAMP = 6;
    var PERSPECTIVE = 520;

    function restCastFrame(rz) {
        return 'rotateX(' + CAST_LIE + 'deg) rotateY(' + CAST_YAW + 'deg) rotateZ(' + rz + 'deg)';
    }

    function restCast(el) {
        el.__lx = CAST_OX;
        el.__ly = CAST_OY;
        el.style.setProperty('--cast-dx', CAST_OX + 'px');
        el.style.setProperty('--cast-dy', CAST_OY + 'px');
    }

    // Shadow falls away from the lamp, a little. Rest is already down-right;
    // the cursor only slides that sliver, it does not throw it across the mat.
    // A die also keeps the numbers, because a shadow in the air is drawn from
    // them and not from the custom property.
    function aimCast(el, cx, cy, baseX, baseY, throwPx) {
        var r = el.getBoundingClientRect();
        var px = (r.left + r.width / 2 - cx) / LIGHT_REACH;
        var py = (r.top + r.height / 2 - cy) / LIGHT_REACH;
        if (px > 1) px = 1; else if (px < -1) px = -1;
        if (py > 1) py = 1; else if (py < -1) py = -1;
        var dx = baseX + px * throwPx, dy = baseY + py * throwPx;
        el.__lx = dx;
        el.__ly = dy;
        el.style.setProperty('--cast-dx', dx.toFixed(1) + 'px');
        el.style.setProperty('--cast-dy', dy.toFixed(1) + 'px');
    }

    /* In the air the laid-down cube is the wrong picture. Turned with the die,
       it is a dark solid seen from above, and every time one of its faces
       comes square to the camera it is a flat slab lying next to the die —
       which is what a tumble looked like. A shadow has no sides. It is the
       outline of the cube pressed onto the cloth along the light, and for a box
       that outline is exactly the convex hull of its eight corners, each slid
       away from the lamp by its height. So for the length of a throw the cube
       is hidden and that outline is computed from the die's own pose, every
       frame, and painted as one clipped, blurred polygon: it turns corner for
       corner with the die because it is read off the die, and it grows,
       softens and fades with the hop.

       It has to leave the resting shadow and come back to it without a jump.
       The resting cube's outline is also a hull of eight projected corners —
       the same corners, put through the lie-down and the camera instead of
       the light — so both are computed and the throw moves each corner from
       one to the other and back. At either end of a roll the die is square
       and a cube turned by quarter turns is the same cube, so the blend lands
       on precisely the silhouette the resting cube draws, and the swap back to
       it is a swap between two pictures of the same shape.

       Under the cast sits a contact shadow, the die's own outline with almost
       no throw: dark where it comes down on the cloth mid-throw and gone a
       finger's width up. It is never there at rest, which is unchanged. */
    // Room round the die for a thrown, spread shadow and its blur. The clip
    // polygon is in this box's pixels, so nothing can fall outside it.
    var AIR_PAD = 80;
    // The mat lies DIE_HALF behind the plane through the die's centre, so the
    // camera draws the true shadow a touch smaller than the die.
    var AIR_PERSP = PERSPECTIVE / (PERSPECTIVE + DIE_HALF);

    // Andrew's monotone chain. Eight points; the sort is the whole cost.
    function hull(pts) {
        pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
        function cross(o, a, b) {
            return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        }
        var lower = [], upper = [], i;
        for (i = 0; i < pts.length; i++) {
            while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
            lower.push(pts[i]);
        }
        for (i = pts.length - 1; i >= 0; i--) {
            while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
            upper.push(pts[i]);
        }
        lower.pop();
        upper.pop();
        return lower.concat(upper);
    }

    function polygon(pts) {
        var c = DIE_HALF + AIR_PAD;
        var out = [];
        for (var i = 0; i < pts.length; i++) {
            out.push((pts[i][0] + c).toFixed(1) + 'px ' + (pts[i][1] + c).toFixed(1) + 'px');
        }
        return 'polygon(' + out.join(', ') + ')';
    }

    function smooth(e0, e1, x) {
        var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
    }

    // One frame of the shadow in the air. `p` is how far through the throw
    // this is, 0 to 1; the pose is whatever the cube is actually showing.
    function airShadow(el, p) {
        var t = getComputedStyle(el.__cube).transform;
        var m = (t && t !== 'none') ? new DOMMatrix(t) : new DOMMatrix();
        // The hop comes back out of the corners and goes in as height. The
        // shadow stays on the table while the die jumps up the screen — that
        // jump is how the page draws height — and the gap between them is
        // what says how high it went.
        // Whether a face is within a few degrees of square to the camera: the
        // start and the last frames of every throw. The rim slices of the core
        // stand down then, for the same reason they do at rest (CORE_DEPTHS).
        var square = Math.max(Math.abs(m.m13), Math.abs(m.m23), Math.abs(m.m33)) > 0.9986;
        el.classList.toggle('is-square', square);
        var ty = m.m42, tz = m.m43;
        m.m41 = 0; m.m42 = 0; m.m43 = 0;
        var lift = Math.max(0, tz) + Math.max(0, -ty) * 0.6;
        var lx = el.__lx == null ? CAST_OX : el.__lx;
        var ly = el.__ly == null ? CAST_OY : el.__ly;
        var kx = lx / DIE_W, ky = ly / DIE_W;
        // The resting cube's own chain: the wrapper's offset, the lie-down,
        // then this die's turn. rotateZ is already inside m.
        var rest = new DOMMatrix('translate3d(' + lx + 'px, ' + ly + 'px, 0px)'
            + ' rotateX(' + CAST_LIE + 'deg) rotateY(' + CAST_YAW + 'deg)').multiply(m);
        // How far the shadow is from its resting picture. Held off for the
        // first and last few frames of the throw, where the die is still close
        // to square and the two pictures are close to the same shape.
        var w = smooth(0, 0.14, p) * (1 - smooth(0.8, 1, p));

        var cast = [], contact = [];
        for (var i = 0; i < 8; i++) {
            var cx = (i & 1) ? DIE_HALF : -DIE_HALF;
            var cy = (i & 2) ? DIE_HALF : -DIE_HALF;
            var cz = (i & 4) ? DIE_HALF : -DIE_HALF;
            var q = m.transformPoint(new DOMPoint(cx, cy, cz));
            var r = rest.transformPoint(new DOMPoint(cx, cy, cz));
            var k = PERSPECTIVE / (PERSPECTIVE - r.z);
            // Height over the cloth. A corner dipping below it half way
            // through a turn is a die rocking on an edge, not sinking in.
            var h = Math.max(0, q.z + DIE_HALF + lift);
            var sx = (q.x + h * kx) * AIR_PERSP;
            var sy = (q.y + h * ky) * AIR_PERSP;
            cast.push([r.x * k + (sx - r.x * k) * w, r.y * k + (sy - r.y * k) * w]);
            contact.push([q.x * AIR_PERSP + lift * kx, q.y * AIR_PERSP + lift * ky]);
        }

        // At the ends it matches the resting cube's tone and edge; up in the
        // air it spreads and lets the light through.
        var blur = 2 + w * lift * 0.08;
        var alpha = 1 - w * Math.min(0.4, lift / 100);
        el.__airCastShape.style.clipPath = polygon(hull(cast));
        el.__airCast.style.filter = 'blur(' + blur.toFixed(2) + 'px)';
        el.__airCast.style.opacity = alpha.toFixed(3);
        el.__airContactShape.style.clipPath = polygon(hull(contact));
        el.__airContact.style.opacity = (w * Math.max(0, 1 - lift / 10)).toFixed(3);
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

    /* The body behind the faces. Each face is a rounded square, which is what
       makes the die's outline soft face-on — and what leaves a hole at every
       corner once it turns: three faces each missing the same small corner,
       and the grass showing through where a real die is solid. So inside the
       six faces sit copies of each face's outline, parallel to it, further in.

       The solid these faces actually bound is not a rounded cube. Its twelve
       edges are sharp — a face runs straight to the edge everywhere except at
       its four corners — so the body is three rounded-square prisms, one
       through each pair of opposite faces, laid over each other. A slice of
       a prism is just its outline again, so that is what these are: two per
       face, one a hair behind it and one a little under a corner's depth
       further in. Between the three axes they close every corner from any
       side, including the case that shows it worst — a die nearly square on,
       with only a sliver of its top and side, where the hole is at the very
       front of the corner and a slice deep in the middle cannot reach it.
       Face-on each slice is the face's own outline, hidden behind it, so a
       die at rest looks exactly as it did.

       They are painted after the faces, and that is not cosmetic. The
       compositor sorts a 3D cube's planes by splitting them against one
       another, starting from the first one painted, and a face that gets
       split draws its cut as a hairline — straight across the pips, where a
       slice's plane crosses them. With the faces first, every split is made
       against a face plane, and no slice straddles one, so the faces are
       never cut; only the slices are, and those sit behind opaque faces.
       Each slice also stops a pixel short of the faces so none touches one. */
    var CORNER_R = 0.22;   // Same fraction as .die-face's border-radius.
    // How far in from the face each slice sits: most of the way to the inner
    // end of a corner, and just behind the face (the rim). Two was the fewest
    // that left no grass at any angle tried, corner-on included.
    //
    // The rim slices only exist while the die is off the table. Seen edge-on
    // through a perspective camera, a plane that close to the side of the
    // cube projects just outside the front face's rounded corner, and a die
    // at rest drew square corners with a dark tick in each. A die at rest is
    // square to its camera by construction (settle writes no tilt), and so is
    // a die in the first and last frames of a throw; square on there is no
    // notch for them to fill, so they are shown only once a throw has turned
    // it more than about three degrees (airShadow decides, every frame). The
    // deeper slices stay on in every state and sit inside the face's outline
    // even edge-on.
    var CORE_DEPTHS = [DIE_W * CORNER_R * 0.8, 0.7];
    function paintCore(parent) {
        var turns = ['', 'rotateY(90deg) ', 'rotateX(90deg) '];
        for (var l = 0; l < CORE_DEPTHS.length; l++) {
            var depth = DIE_HALF - CORE_DEPTHS[l];
            for (var a = 0; a < 3; a++) {
                for (var s = -1; s <= 1; s += 2) {
                    var core = document.createElement('div');
                    core.className = 'die-core';
                    if (l === 1) core.setAttribute('data-rim', '');
                    core.style.transform = turns[a] + 'translateZ(' + (s * depth).toFixed(2) + 'px)';
                    parent.appendChild(core);
                }
            }
        }
    }

    // One layer of the shadow in the air: a box that carries the blur and the
    // fade, and inside it the clipped shape. Two elements, because clip-path
    // on the same element as a filter is applied after it and would cut the
    // blur off square.
    function airLayer(el, part) {
        var layer = document.createElement('div');
        layer.className = 'die-air';
        layer.setAttribute('data-part', part);
        layer.style.inset = -AIR_PAD + 'px';
        var shape = document.createElement('div');
        shape.className = 'die-air-shape';
        layer.appendChild(shape);
        el.appendChild(layer);
        return { layer: layer, shape: shape };
    }

    function buildDie() {
        var el = document.createElement('button');
        el.type = 'button';
        el.className = 'die';
        el.style.setProperty('--die-w', DIE_W + 'px');

        var cast = document.createElement('div');
        cast.className = 'die-cast';
        var castCube = document.createElement('div');
        castCube.className = 'die-cast-cube';
        paintFaces(castCube, false);
        cast.appendChild(castCube);
        el.appendChild(cast);

        // Contact over cast, the die over both.
        var airCast = airLayer(el, 'cast');
        var airContact = airLayer(el, 'contact');
        el.__airCast = airCast.layer;
        el.__airCastShape = airCast.shape;
        el.__airContact = airContact.layer;
        el.__airContactShape = airContact.shape;

        var cube = document.createElement('div');
        cube.className = 'die-cube';
        // Faces before the core — see paintCore for why the order matters.
        paintFaces(cube, true);
        paintCore(cube);
        el.appendChild(cube);
        el.__cube = cube;
        el.__cast = cast;
        el.__castCube = castCube;
        el.__faces = cube.querySelectorAll('.die-face');
        restCast(el);
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
        el.__castCube.style.transform = restCastFrame(a.z);
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

        var keys = [];
        for (var i = 0; i < ARC.length; i++) {
            var k = ARC[i];
            var kf = {
                offset: k.at,
                transform: frame(k.y, k.z,
                    from.z + spinZ * k.turned,
                    from.x + spinX * k.turned,
                    from.y + spinY * k.turned)
            };
            if (k.ease) kf.easing = k.ease;
            keys.push(kf);
        }

        el.__rolling = true;
        // Promised for the length of the throw and taken back after, the same
        // way a dragged card does it: a layer that is kept for a die sitting
        // still is a layer being paid for and not used.
        el.__cube.style.willChange = 'transform';

        // Settled before it is animated, not after. The animation is left to
        // fill nothing, so when it lets go the die is already holding the pose
        // its last frame arrived at, and there is no frame in between where the
        // number could be read as something else.
        settle(el, next, to.z);
        announce(next);

        var anim = el.__cube.animate(keys, { duration: ROLL_MS, easing: 'linear' });

        // The shadow in the air is drawn from the cube's computed pose, so it
        // is read after the animation has had its say for this frame and can
        // never be a frame behind or a different ease. The first frame is
        // drawn before the resting cube is hidden, so there is no frame with
        // no shadow at all.
        airShadow(el, 0);
        el.classList.add('is-airborne');
        function tick() {
            if (!el.__rolling) return;
            airShadow(el, Math.min(1, (anim.currentTime || 0) / ROLL_MS));
            requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);

        anim.onfinish = function () {
            el.__cube.style.willChange = '';
            el.__rolling = false;
            // Back to the resting cube, which the last frames have already
            // been drawing the outline of.
            el.classList.remove('is-airborne');
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
            if (window.PlaygroundPieces && window.PlaygroundPieces.keepOff) {
                var parked = window.PlaygroundPieces.keepOff(x, y, el, b);
                x = parked.x;
                y = parked.y;
            }
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

    /* ---------------- the lamp ---------------- */

    /* The mat already has a key that follows the pointer (felt.js). The dice
       catch the same lamp. At rest only the front face is showing, so a uniform
       wash per side would not move with the cursor — the highlight has to sit
       on the face and slide. A phone has no mouse, so there every face stays
       the same stock. Desktop, including reduced motion, still gets the lamp. */

    /* Outward normal plus the face's own right/down, matching the rotateY/X
       that plants each side. Cube space: +X right, +Y down, +Z toward you. */
    var FACE_BASIS = {
        front:  { n: [0, 0, 1],   u: [1, 0, 0],   v: [0, 1, 0] },
        back:   { n: [0, 0, -1],  u: [-1, 0, 0],  v: [0, 1, 0] },
        right:  { n: [1, 0, 0],   u: [0, 0, -1],  v: [0, 1, 0] },
        left:   { n: [-1, 0, 0],  u: [0, 0, 1],   v: [0, 1, 0] },
        top:    { n: [0, -1, 0],  u: [1, 0, 0],   v: [0, 0, 1] },
        bottom: { n: [0, 1, 0],   u: [1, 0, 0],   v: [0, 0, -1] }
    };
    var SHADE_MAX = 0.14;
    var LIT_MAX = 0.22;
    var LIGHT_REACH = 140;
    var lastPtr = null;
    var lightTick = false;
    var coarseLight = window.matchMedia && window.matchMedia('(pointer: coarse)');
    var noHoverLight = window.matchMedia && window.matchMedia('(hover: none)');

    // A phone, and only a phone — same test as felt.js. iOS will report a
    // mouse after a tap, so the UA is what actually puts the wash out there.
    // The home Playground card is the other exception: a lamp there would
    // restyle every cube on every move, on top of the carousel.
    var onHomeCard = !tableEl;
    function lampShouldBeEven() {
        if (onHomeCard) return true;
        var ua = navigator.userAgent || '';
        if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
        if (/iPhone|iPod/i.test(ua)) return true;
        if (/Android/i.test(ua) && /Mobile/i.test(ua)) return true;
        if (coarseLight && coarseLight.matches) return true;
        if (noHoverLight && noHoverLight.matches) return true;
        return false;
    }
    var evenLight = lampShouldBeEven();

    function mulBasis(m, v) {
        return [
            m.m11 * v[0] + m.m21 * v[1] + m.m31 * v[2],
            m.m12 * v[0] + m.m22 * v[1] + m.m32 * v[2],
            m.m13 * v[0] + m.m23 * v[1] + m.m33 * v[2]
        ];
    }

    function shadeDie(el, cx, cy) {
        var faces = el.__faces;
        if (!faces || !faces.length) return;
        var r = el.getBoundingClientRect();
        var dx = (cx - (r.left + r.width / 2)) / LIGHT_REACH;
        var dy = (cy - (r.top + r.height / 2)) / LIGHT_REACH;
        var dz = 0.55;
        var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        var L = [dx / len, dy / len, dz / len];
        var near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) * 0.62);
        var t = getComputedStyle(el.__cube).transform;
        var m = (t && t !== 'none') ? new DOMMatrix(t) : new DOMMatrix();
        for (var i = 0; i < faces.length; i++) {
            var b = FACE_BASIS[faces[i].getAttribute('data-at')];
            if (!b) continue;
            var n = mulBasis(m, b.n);
            var u = mulBasis(m, b.u);
            var v = mulBasis(m, b.v);
            var ndl = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
            var lu = u[0] * L[0] + u[1] * L[1] + u[2] * L[2];
            var lv = v[0] * L[0] + v[1] * L[1] + v[2] * L[2];
            var side = Math.min(1, Math.sqrt(lu * lu + lv * lv));
            var face = faces[i];
            face.style.setProperty('--shade', (SHADE_MAX * ndl * (0.25 + 0.75 * side)).toFixed(3));
            face.style.setProperty('--lit', (LIT_MAX * ndl * (0.35 + 0.65 * near)).toFixed(3));
            face.style.setProperty('--lx', (50 + lu * 46).toFixed(1) + '%');
            face.style.setProperty('--ly', (50 + lv * 46).toFixed(1) + '%');
            face.style.setProperty('--sx', (50 - lu * 50).toFixed(1) + '%');
            face.style.setProperty('--sy', (50 - lv * 50).toFixed(1) + '%');
        }
    }

    function shadeAll() {
        if (evenLight || !lastPtr) return;
        var dice = surface.querySelectorAll(':scope > .die');
        var rolling = false;
        for (var i = 0; i < dice.length; i++) {
            shadeDie(dice[i], lastPtr.x, lastPtr.y);
            aimCast(dice[i], lastPtr.x, lastPtr.y, CAST_OX, CAST_OY, CAST_LAMP);
            if (dice[i].__rolling) rolling = true;
        }
        var chips = surface.querySelectorAll(':scope > .chip');
        for (var c = 0; c < chips.length; c++) {
            var w = parseFloat(chips[c].style.getPropertyValue('--chip-w')) || 52;
            aimCast(chips[c], lastPtr.x, lastPtr.y, w * 0.12, w * 0.16, w * 0.07);
        }
        if (rolling && !lightTick) {
            lightTick = true;
            requestAnimationFrame(function () {
                lightTick = false;
                shadeAll();
            });
        }
    }

    function onLampMove(e) {
        if (evenLight || lampShouldBeEven()) return;
        if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
        lastPtr = { x: e.clientX, y: e.clientY };
        shadeAll();
    }

    function setEvenLight(on) {
        evenLight = on;
        if (evenLight) {
            felt.removeEventListener('pointermove', onLampMove, { capture: true });
            lastPtr = null;
            var dice = surface.querySelectorAll(':scope > .die');
            for (var i = 0; i < dice.length; i++) {
                restCast(dice[i]);
                var faces = dice[i].__faces;
                if (!faces) continue;
                for (var f = 0; f < faces.length; f++) {
                    faces[f].style.setProperty('--shade', '0');
                    faces[f].style.setProperty('--lit', '0');
                    faces[f].style.setProperty('--lx', '50%');
                    faces[f].style.setProperty('--ly', '38%');
                    faces[f].style.setProperty('--sx', '50%');
                    faces[f].style.setProperty('--sy', '62%');
                }
            }
            var chips = surface.querySelectorAll(':scope > .chip');
            for (var c = 0; c < chips.length; c++) {
                chips[c].style.removeProperty('--cast-dx');
                chips[c].style.removeProperty('--cast-dy');
            }
        } else {
            felt.addEventListener('pointermove', onLampMove, { passive: true, capture: true });
        }
    }

    function onLampMedia() {
        setEvenLight(lampShouldBeEven());
    }
    function watchLightMedia(mq) {
        if (!mq) return;
        if (mq.addEventListener) mq.addEventListener('change', onLampMedia);
        else if (mq.addListener) mq.addListener(onLampMedia);
    }
    watchLightMedia(coarseLight);
    watchLightMedia(noHoverLight);

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

    // The band of the surface you can actually see, above the hand. Dice
    // planted outside it are dice the reader has to go looking for, which is
    // how a table with three of them can photograph as one.
    function visibleBand() {
        var pad = DIE_W;
        // Home card: the well is matrix3d-warped onto the mesh. Screen
        // rects are the AABB of that quad, and dice planted from them
        // land outside the opening. Use the untransformed opening.
        if (!tableEl) {
            var feltW = felt.clientWidth;
            var feltH = felt.clientHeight;
            var well = felt.parentElement;
            var wellW = well && well.clientWidth > 0 ? well.clientWidth : feltW;
            var wellH = well && well.clientHeight > 0 ? well.clientHeight : feltH;
            var sc = feltH ? wellH / feltH : 1;
            var visW = sc ? wellW / sc : feltW;
            var x0 = (feltW - visW) / 2;
            var px = parseFloat(surface.style.getPropertyValue('--px')) || 0;
            var py = parseFloat(surface.style.getPropertyValue('--py')) || 0;
            return {
                x: -px + x0 + pad,
                y: -py + pad,
                w: Math.max(DIE_W, visW - pad * 2),
                h: Math.max(DIE_W * 2, feltH - pad * 2)
            };
        }
        var f = felt.getBoundingClientRect();
        var sr = surface.getBoundingClientRect();
        var viewX = f.left - sr.left, viewY = f.top - sr.top;
        var fanTop = fanEl.getBoundingClientRect().top - sr.top;
        return {
            x: viewX + pad,
            y: viewY + pad,
            w: Math.max(DIE_W, f.width - pad * 2),
            h: Math.max(DIE_W * 2, fanTop - viewY - pad - 24)
        };
    }

    function titleKeepout() {
        var mark = document.getElementById('table-heading');
        var sw = surface.offsetWidth;
        var sh = surface.offsetHeight;
        var pad = 32;
        if (mark && mark.classList.contains('is-placed') && mark.offsetWidth > 0) {
            return {
                x: (parseFloat(mark.style.left) || 0) - pad,
                y: (parseFloat(mark.style.top) || 0) - pad,
                w: mark.offsetWidth + pad * 2,
                h: mark.offsetHeight + pad * 2
            };
        }
        var w = Math.min(560, sw * 0.62);
        var h = Math.min(200, sh * 0.28);
        return { x: sw / 2 - w / 2, y: sh / 2 - h / 2, w: w, h: h };
    }

    function overlapsKeep(x, y, keep) {
        return x < keep.x + keep.w && x + DIE_W > keep.x
            && y < keep.y + keep.h && y + DIE_W > keep.y;
    }

    function clampToBand(x, y, band) {
        return {
            x: Math.max(band.x, Math.min(x, band.x + band.w - DIE_W)),
            y: Math.max(band.y, Math.min(y, band.y + band.h - DIE_W))
        };
    }

    function pushOffKeep(x, y, keep, band) {
        var spot = clampToBand(x, y, band);
        if (!overlapsKeep(spot.x, spot.y, keep)) return spot;
        var cx = spot.x + DIE_HALF;
        var cy = spot.y + DIE_HALF;
        var kcx = keep.x + keep.w / 2;
        var kcy = keep.y + keep.h / 2;
        var dx = cx - kcx;
        var dy = cy - kcy;
        var gap = 10;
        var alongX = Math.abs(dx) * keep.h >= Math.abs(dy) * keep.w;
        var tried = alongX
            ? { x: dx < 0 ? keep.x - DIE_W - gap : keep.x + keep.w + gap, y: spot.y }
            : { x: spot.x, y: dy < 0 ? keep.y - DIE_W - gap : keep.y + keep.h + gap };
        tried = clampToBand(tried.x, tried.y, band);
        if (!overlapsKeep(tried.x, tried.y, keep)) return tried;
        var other = alongX
            ? { x: spot.x, y: dy < 0 ? keep.y - DIE_W - gap : keep.y + keep.h + gap }
            : { x: dx < 0 ? keep.x - DIE_W - gap : keep.x + keep.w + gap, y: spot.y };
        return clampToBand(other.x, other.y, band);
    }

    function wellNearTitle(band, keep, side) {
        var gap = 22;
        var kcx = keep.x + keep.w / 2;
        var kcy = keep.y + keep.h / 2;
        var x = kcx - DIE_HALF;
        var y = kcy - DIE_HALF;
        if (side === 'nw') { x = keep.x - DIE_W * 0.2; y = keep.y - DIE_W - gap; }
        else if (side === 'ne') { x = keep.x + keep.w - DIE_W * 0.8; y = keep.y - DIE_W - gap; }
        else if (side === 'se') { x = keep.x + keep.w + gap; y = keep.y + keep.h + gap * 0.35; }
        else if (side === 'sw') { x = keep.x - DIE_W - gap; y = keep.y + keep.h + gap * 0.35; }
        return pushOffKeep(x, y, keep, band);
    }

    // Three seats around the name — north-west, north-east, south-east —
    // so the dice and the chips (west / east) read as a ring, not a pile
    // through the letters. Each well jitters, and still keeps clear of
    // the chips. The fallback still leaves the word alone.
    function placeInWell(band, keep, side, taken) {
        var seed = wellNearTitle(band, keep, side);
        var best = null, bestGap = -Infinity;
        for (var t = 0; t < 48; t++) {
            var x = seed.x + rand(-26, 26);
            var y = seed.y + rand(-22, 22);
            var clamped = clampToBand(x, y, band);
            x = clamped.x;
            y = clamped.y;
            if (overlapsKeep(x, y, keep)) continue;
            var gap = clearance(x, y, taken);
            if (gap > bestGap) { bestGap = gap; best = { x: x, y: y }; }
            if (bestGap >= 0) break;
        }
        if (!best) {
            best = pushOffKeep(seed.x, seed.y, keep, band);
            bestGap = clearance(best.x, best.y, taken);
        }
        best.clear = bestGap >= 0 && !overlapsKeep(best.x, best.y, keep);
        return best;
    }

    function layDie(x, y, face, rz) {
        var die = buildDie();
        die.style.left = Math.round(x) + 'px';
        die.style.top = Math.round(y) + 'px';
        settle(die, face, rz);
        wire(die);
        surface.insertBefore(die, playedEl);
        return die;
    }

    function placeSavedDice(list) {
        if (!list || !list.length) return false;
        var keep = titleKeepout();
        var band = {
            x: 8,
            y: 8,
            w: Math.max(8, surface.offsetWidth - 16),
            h: Math.max(8, surface.offsetHeight - 16)
        };
        for (var i = 0; i < list.length; i++) {
            var s = list[i];
            var parked = overlapsKeep(s.x, s.y, keep)
                ? pushOffKeep(s.x, s.y, keep, band)
                : { x: s.x, y: s.y };
            layDie(parked.x, parked.y, s.face || 1, s.rz || 0);
        }
        return true;
    }

    function scatterDice() {
        status = document.createElement('p');
        status.id = 'dice-status';
        status.className = 'visually-hidden';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        (tableEl || document.body).appendChild(status);

        var saved = window.__playgroundScene;
        if (saved && placeSavedDice(saved.dice)) {
            setEvenLight(evenLight);
            return;
        }

        var taken = chipSpots();
        var band = visibleBand();
        var keep = titleKeepout();
        var sides = ['nw', 'ne', 'se'];
        for (var i = 0; i < DICE; i++) {
            var s = placeInWell(band, keep, sides[i], taken);
            // Two is the fewest that reads as dice rather than as one stray
            // object, so the first two go down even on a crowded window. The
            // third only goes down if it can have room of its own.
            if (!s.clear && i >= 2) break;

            // Square-on, with only a few degrees of roll in the picture plane.
            // The cube-shaped shadow is what stops it reading as a pip card,
            // and the roll is what stops three of them looking like one drawing
            // repeated.
            layDie(s.x, s.y, 1 + Math.floor(Math.random() * 6), rand(-6, 6));
            taken.push({ x: s.x + DIE_HALF, y: s.y + DIE_HALF, r: DIE_REACH });
        }
        setEvenLight(evenLight);
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
        var ready = window.__playgroundMatReady
            || (!onHomeCard && surface.querySelectorAll(':scope > .chip').length >= 2
                && surface.style.getPropertyValue('--px') !== '');
        if (ready) { scatterDice(); return; }
        // The home cover parks the well off-screen until the card faces
        // the camera. Scattering on a 240-frame cap planted the cubes
        // in that empty box, and they never moved. Wait for the mat.
        if (onHomeCard) {
            setTimeout(whenMatIsSet, 250);
            return;
        }
        if (frames > 240) { scatterDice(); return; }
        frames++;
        requestAnimationFrame(whenMatIsSet);
    }
    requestAnimationFrame(whenMatIsSet);
})();
