// tech@nyu six words (test page).
// A Figma multiplayer cursor ("Jennifer") moves around a measured plane
// (rulers, dotted grid), finds each brand word and drags a selection over
// it to reveal it, with the size and the ruler extents shown like Figma.
// Plays once when it comes on screen and pauses off screen. After that the
// cursor leaves, and hovering a word with your own mouse selects it.
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var UNITS = 1440; // the plane is measured as a 1440-wide frame

    document.querySelectorAll('[data-kw]').forEach(setup);

    function setup(plane) {
        var field = plane.querySelector('.kw-field');
        var rx = plane.querySelector('.kw-rx'), ry = plane.querySelector('.kw-ry');
        var words = Array.prototype.slice.call(field.querySelectorAll('.kw'));
        var sel = field.querySelector('.kw-sel'), dim = sel.querySelector('.kw-dim');
        var cur = field.querySelector('.kw-cur'), tag = cur.querySelector('.kw-tag');
        var bandX = rx.querySelector('.kw-band'), bandY = ry.querySelector('.kw-band');
        var W = 1, H = 1, U = 1;
        var pos = { x: 0, y: 0 };
        var live = false, started = false, done = false, hoverOn = null;

        function u(px) { return Math.round(px / U); }

        function buildRuler(r, len) {
            Array.prototype.slice.call(r.querySelectorAll('.kw-t, .kw-n')).forEach(function (n) { n.remove(); });
            var steps = [50, 100, 200, 250, 500], s = 500;
            for (var k = 0; k < steps.length; k++) { if (steps[k] * U >= 54) { s = steps[k]; break; } }
            var minor = (s / 5) * U >= 6 ? s / 5 : s / 2;
            var vert = r === ry, frag = document.createDocumentFragment();
            for (var v = 0; v * U <= len + 0.5; v += minor) {
                var p = Math.round(v * U), major = Math.abs(v % s) < 0.001;
                var t = document.createElement('span');
                t.className = 'kw-t' + (major ? ' is-major' : '');
                t.style[vert ? 'top' : 'left'] = p + 'px';
                frag.appendChild(t);
                if (major && p + 24 < len) {
                    var n = document.createElement('span');
                    n.className = 'kw-n';
                    n.textContent = String(v);
                    n.style[vert ? 'top' : 'left'] = p + 'px';
                    frag.appendChild(n);
                }
            }
            r.insertBefore(frag, r.firstChild);
        }

        function measure() {
            W = field.clientWidth || 1; H = field.clientHeight || 1; U = W / UNITS;
            buildRuler(rx, W); buildRuler(ry, H);
            place(pos.x, pos.y);
        }

        function place(x, y) {
            x = Math.max(2, Math.min(W - 2, x)); y = Math.max(2, Math.min(H - 2, y));
            pos.x = x; pos.y = y;
            cur.style.transform = 'translate(' + x + 'px,' + y + 'px)';
            tag.classList.toggle('is-flip', x > W - 110);
            tag.classList.toggle('is-up', y > H - 44);
        }

        function rectOf(el) {
            return { x: el.offsetLeft - 6, y: el.offsetTop - 3, w: el.offsetWidth + 12, h: el.offsetHeight + 6 };
        }
        function setBox(x, y, w, h) {
            sel.style.left = x + 'px'; sel.style.top = y + 'px';
            sel.style.width = Math.max(0, w) + 'px'; sel.style.height = Math.max(0, h) + 'px';
        }
        function band(r) {
            if (!r) { bandX.classList.remove('is-on'); bandY.classList.remove('is-on'); hideNear(rx); hideNear(ry); return; }
            bandX.style.left = r.x + 'px'; bandX.style.width = r.w + 'px';
            bandX.children[0].textContent = u(r.x); bandX.children[1].textContent = u(r.x + r.w);
            bandY.style.top = r.y + 'px'; bandY.style.height = r.h + 'px';
            bandY.children[0].textContent = u(r.y); bandY.children[1].textContent = u(r.y + r.h);
            bandX.classList.add('is-on'); bandY.classList.add('is-on');
            hideNear(rx, 'left', r.x, r.x + r.w); hideNear(ry, 'top', r.y, r.y + r.h);
        }
        // ruler numbers step aside for the selection's own start and end numbers
        function hideNear(r, side, a, b) {
            Array.prototype.forEach.call(r.querySelectorAll('.kw-n'), function (n) {
                var p = parseFloat(n.style[side || 'left']) || 0;
                n.classList.toggle('is-hid', !!side && (Math.abs(p - a) < 30 || Math.abs(p - b) < 30));
            });
        }
        function settle(r) {
            dim.textContent = u(r.w) + ' \u00d7 ' + u(r.h);
            sel.classList.add('is-on', 'is-set');
            band(r);
        }
        function clearSel() { sel.classList.remove('is-on', 'is-set'); band(null); }

        // time only runs while the plane is on screen
        function tween(ms, fn) {
            return new Promise(function (res) {
                var t = 0, last = null;
                function step(now) {
                    if (last === null) last = now;
                    var dt = now - last; last = now;
                    if (live && !document.hidden) t += Math.min(dt, 50);
                    var p = Math.min(1, t / ms);
                    fn(p);
                    if (p < 1) requestAnimationFrame(step); else res();
                }
                requestAnimationFrame(step);
            });
        }
        function wait(ms) { return tween(ms, function () {}); }
        function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
        function moveTo(x, y, ms) {
            var x0 = pos.x, y0 = pos.y, dx = x - x0, dy = y - y0, bend = (Math.random() - 0.5) * 0.3;
            return tween(ms, function (p) {
                var e = ease(p), b = Math.sin(Math.PI * e) * bend;
                place(x0 + dx * e - dy * b, y0 + dy * e + dx * b);
            });
        }
        // somewhere on the plane that isn't the word it's about to find
        function wander(r) {
            var cx = r.x + r.w / 2, cy = r.y + r.h / 2, x, y, tries = 0;
            do {
                x = 30 + Math.random() * (W - 60); y = 24 + Math.random() * (H - 48); tries++;
            } while (tries < 12 && Math.hypot(x - cx, y - cy) < Math.min(W, H) * 0.3);
            return { x: x, y: y };
        }

        function revealAll() {
            words.forEach(function (w) { w.classList.add('is-found'); });
            done = true; plane.classList.add('is-done');
        }

        async function run() {
            started = true;
            place(W * 0.5, H * 0.45);
            plane.classList.add('has-cur');
            await wait(300);
            for (var i = 0; i < words.length; i++) {
                var r = rectOf(words[i]);
                var hops = i === 0 ? 2 : 1;
                for (var k = 0; k < hops; k++) {
                    var w = wander(r);
                    await moveTo(w.x, w.y, 500);
                    await wait(110);
                }
                await moveTo(r.x, r.y, 560);
                cur.classList.add('is-press');
                await wait(100);
                sel.classList.remove('is-set', 'is-snap');
                setBox(r.x, r.y, 0, 0);
                sel.classList.add('is-on');
                words[i].classList.add('is-found');
                await tween(480, function (p) {
                    var e = ease(p);
                    setBox(r.x, r.y, r.w * e, r.h * e);
                    place(r.x + r.w * e, r.y + r.h * e);
                });
                cur.classList.remove('is-press');
                settle(r);
                await wait(640);
                clearSel();
                await wait(150);
            }
            await moveTo(W * 0.9, H * 0.88, 600);
            plane.classList.remove('has-cur');
            revealAll();
        }

        // after the search, the visitor's own mouse selects words on hover
        function local(e) {
            var f = field.getBoundingClientRect();
            return { x: (e.clientX - f.left) * (W / (f.width || 1)), y: (e.clientY - f.top) * (H / (f.height || 1)) };
        }
        function hit(p) {
            for (var i = 0; i < words.length; i++) {
                var r = rectOf(words[i]);
                if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return { el: words[i], r: r };
            }
            return null;
        }
        function track(e) {
            if (!done) return;
            var p = local(e);
            var h = hit(p);
            if (h) {
                if (hoverOn !== h.el) {
                    if (!sel.classList.contains('is-on')) sel.classList.remove('is-snap');
                    else sel.classList.add('is-snap');
                    setBox(h.r.x, h.r.y, h.r.w, h.r.h);
                    settle(h.r);
                    hoverOn = h.el;
                }
            } else if (hoverOn) {
                clearSel(); hoverOn = null;
            }
        }
        field.addEventListener('pointermove', track);
        field.addEventListener('pointerdown', track);
        field.addEventListener('pointerleave', function () {
            if (!done) return;
            clearSel(); hoverOn = null;
        });

        if (window.ResizeObserver) new ResizeObserver(measure).observe(field);
        else window.addEventListener('resize', measure);

        var ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
        ready.then(function () {
            measure();
            if (reduce) { revealAll(); return; }
            if (/[?&]kwstill/.test(location.search)) { // review aid: the finished plane, one word selected
                revealAll(); var r0 = rectOf(words[2]); setBox(r0.x, r0.y, r0.w, r0.h); settle(r0);
                place(r0.x + r0.w, r0.y + r0.h); plane.classList.add('has-cur'); return;
            }
            var io = new IntersectionObserver(function (es) {
                es.forEach(function (e) {
                    live = e.isIntersecting;
                    if (!started && e.intersectionRatio >= 0.45) run();
                });
            }, { threshold: [0, 0.45] });
            io.observe(plane);
        });
    }
})();
