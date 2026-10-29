// Clarus AI redesign (test page): the motion. Everything waits until it is on
// screen and pauses when it leaves, same as the PureGym page.
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    function onView(el, cb, opts) {
        if (!el) return;
        var io = new IntersectionObserver(function (es) {
            es.forEach(function (e) { cb(e.isIntersecting, e); });
        }, opts || { threshold: 0.35 });
        io.observe(el);
    }

    // ---------- context: count the numbers up once ----------
    document.querySelectorAll('.count').forEach(function (el) {
        var to = parseFloat(el.dataset.to), dec = +el.dataset.dec || 0, done = false;
        onView(el, function (vis) {
            if (!vis || done) return;
            done = true;
            if (reduce) { el.textContent = to.toFixed(dec); return; }
            var t0 = performance.now(), dur = 1300;
            (function tick(now) {
                var k = Math.min(1, (now - t0) / dur);
                k = 1 - Math.pow(1 - k, 3);
                el.textContent = (to * k).toFixed(dec);
                if (k < 1) requestAnimationFrame(tick);
            })(t0);
        }, { threshold: 0.6 });
    });

    // ---------- challenge: type the question once ----------
    var ask = document.querySelector('.ask');
    if (ask) {
        var typed = ask.querySelector('.ask-typed'), text = ask.dataset.text, started = false;
        onView(ask, function (vis) {
            if (!vis || started) return;
            started = true;
            if (reduce) { typed.textContent = text; ask.classList.add('done'); return; }
            var i = 0;
            (function step() {
                typed.textContent = text.slice(0, ++i);
                if (i < text.length) setTimeout(step, 26 + Math.random() * 30);
                else ask.classList.add('done');
            })();
        }, { threshold: 0.8 });
    }


    // ---------- process 01: the sketchbook pages get laid on the table, once ----------
    var skb = document.getElementById('sketchbook');
    if (skb && !reduce) {
        skb.classList.add('sk-ready');
        var skDone = false;
        onView(skb, function (vis) {
            if (!vis || skDone) return;
            skDone = true;
            // pages in order (each lands on the one before), then pencil and clip
            [].slice.call(skb.children).forEach(function (el, i) {
                setTimeout(function () { el.classList.add('in'); }, 80 + i * 140);
            });
        }, { threshold: 0.3 });
    }

    // ---------- process 01: pick up the pages, pencil and clip and move them around the table ----------
    // Same feel as the grid view's table: whatever you press comes to the top,
    // tips a little toward the side you pressed, swings with the drag, and
    // settles flat when you let go. It can't leave the table. Offsets are kept
    // in cqw of the table so a moved page stays in its spot on resize.
    var skTable = document.getElementById('sk-table');
    if (skTable && skb) {
        var skTop = 10;
        var clampN = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
        [].slice.call(skb.children).forEach(function (item) {
            var start = null, tilt = 0, raf = 0;
            var setTilt = function (d) { tilt = d; item.style.setProperty('--tilt', d.toFixed(2) + 'deg'); };
            var loop = function () {
                cancelAnimationFrame(raf);
                (function f() {
                    if (!start) return;
                    start.vx *= 0.86;
                    var target = start.press + clampN(start.vx * 18, -6, 6);
                    setTilt(tilt + (target - tilt) * 0.22);
                    raf = requestAnimationFrame(f);
                })();
            };
            item.addEventListener('pointerdown', function (e) {
                if (e.button !== 0) return;
                e.preventDefault();
                var r = item.getBoundingClientRect(), t = skTable.getBoundingClientRect(), PAD = 4;
                start = {
                    x: e.clientX, y: e.clientY, w: t.width,
                    dx: parseFloat(item.style.getPropertyValue('--dx')) || 0,
                    dy: parseFloat(item.style.getPropertyValue('--dy')) || 0,
                    // stays on the table; something already past an edge can come back in but not go further out
                    minX: Math.min(0, t.left + PAD - r.left), maxX: Math.max(0, t.right - PAD - r.right),
                    minY: Math.min(0, t.top + PAD - r.top), maxY: Math.max(0, t.bottom - PAD - r.bottom),
                    press: (e.clientX < r.left + r.width / 2 ? -1 : 1) * 1.5,
                    lx: e.clientX, lt: performance.now(), vx: 0
                };
                try { item.setPointerCapture(e.pointerId); } catch (err) {}
                item.style.zIndex = ++skTop;
                item.classList.remove('is-settling');
                item.classList.add('is-dragging');
                setTilt(reduce ? 0 : start.press);
                if (!reduce) loop();
            });
            item.addEventListener('pointermove', function (e) {
                if (!start) return;
                var now = performance.now(), dt = Math.max(8, now - start.lt);
                start.vx = start.vx * 0.5 + ((e.clientX - start.lx) / dt) * 0.5;
                start.lx = e.clientX; start.lt = now;
                var mx = clampN(e.clientX - start.x, start.minX, start.maxX);
                var my = clampN(e.clientY - start.y, start.minY, start.maxY);
                item.style.setProperty('--dx', (start.dx + mx / start.w * 100).toFixed(3) + 'cqw');
                item.style.setProperty('--dy', (start.dy + my / start.w * 100).toFixed(3) + 'cqw');
            });
            var end = function () {
                if (!start) return;
                start = null;
                cancelAnimationFrame(raf);
                item.classList.remove('is-dragging');
                item.classList.add('is-settling');
                setTilt(0);
            };
            item.addEventListener('pointerup', end);
            item.addEventListener('pointercancel', end);
            item.addEventListener('lostpointercapture', end);
        });
    }

    // ---------- process: go through the four stages; each shows all its images ----------
    var proc = document.getElementById('proc');
    if (proc) {
        var pSteps = proc.querySelectorAll('.proc-step');
        var sets = proc.querySelectorAll('.pm-set');
        var STAGE_MS = 4800, cur = 0, manual = false, pVisible = false, raf = 0, t0 = 0;

        // phones: the stages sit in a row as tabs, so the active stage's text
        // moves out of its button into one line under the row (hidden on desktop)
        var pDesc = document.createElement('p');
        pDesc.className = 'proc-desc';
        pDesc.setAttribute('aria-live', 'polite');
        proc.insertBefore(pDesc, proc.querySelector('.proc-media'));

        var show = function (i) {
            cur = (i + pSteps.length) % pSteps.length;
            pSteps.forEach(function (b, j) {
                b.classList.toggle('on', j === cur);
                b.classList.toggle('done', j < cur);
                b.setAttribute('aria-selected', j === cur ? 'true' : 'false');
                b.querySelector('.ps-bar i').style.width = '';
            });
            sets.forEach(function (s) { s.classList.toggle('on', +s.dataset.step === cur); });
            pDesc.textContent = pSteps[cur].querySelector('.ps-b').textContent;
            pDesc.classList.remove('swap'); void pDesc.offsetWidth; pDesc.classList.add('swap');
        };
        // the line under the active stage fills, then the next stage takes over
        var tick = function (now) {
            if (manual || !pVisible) return;
            var k = Math.min(1, (now - t0) / STAGE_MS);
            pSteps[cur].querySelector('.ps-bar i').style.width = (k * 100) + '%';
            if (k >= 1) { show(cur + 1); t0 = now; }
            raf = requestAnimationFrame(tick);
        };
        var run = function () {
            cancelAnimationFrame(raf);
            if (manual || reduce || !pVisible) return;
            t0 = performance.now();
            raf = requestAnimationFrame(tick);
        };

        pSteps.forEach(function (b, j) {
            b.addEventListener('click', function () {
                manual = true;
                cancelAnimationFrame(raf);
                show(j);
                pSteps[j].querySelector('.ps-bar i').style.width = '100%';
            });
        });
        show(0);
        onView(proc, function (vis) { pVisible = vis; run(); }, { threshold: 0.4 });
    }

    // ---------- images blur in as they arrive ----------
    document.querySelectorAll('.reveal').forEach(function (el, i) {
        onView(el, function (vis) {
            if (!vis) return;
            setTimeout(function () { el.classList.add('in'); }, (i % 3) * 90);
        }, { threshold: 0.2 });
    });


    // ---------- next: 0.24 Wh stays on the left, the right side cycles through equivalents ----------
    var conv = document.getElementById('convert');
    if (conv) {
        // 0.24 Wh / 10 W = 86 s; / 13 Wh = 1.8%; / 1000 W = 0.86 s
        var OUT = [
            ['bulb', '86', 'seconds', 'of a 10 W LED bulb'],
            ['battery', '1.8', '%', 'of a phone battery'],
            ['popcorn', '0.9', 'seconds', 'of a microwave']
        ];
        OUT.forEach(function (o) { new Image().src = 'assets/clarusai/emoji/' + o[0] + '.png'; });
        var CYCLE_MS = 3200;
        var box = conv.querySelector('.cmp-swap'), dots = conv.querySelectorAll('.cmp-dot');
        var cEmoji = box.querySelector('.cmp-emoji'), cBig = box.querySelector('.cmp-big'),
            cUnit = box.querySelector('.cmp-unit'), cDesc = box.querySelector('.cmp-desc');
        var at = 0, timer = 0, seen = false;
        var go = function (i) {
            at = (i + OUT.length) % OUT.length;
            dots.forEach(function (d, j) { d.classList.toggle('on', j === at); d.setAttribute('aria-selected', j === at ? 'true' : 'false'); });
            box.classList.add('swap');
            setTimeout(function () {
                var o = OUT[at];
                cEmoji.src = 'assets/clarusai/emoji/' + o[0] + '.png'; cBig.textContent = o[1]; cUnit.textContent = o[2]; cDesc.textContent = o[3];
                box.classList.remove('swap');
            }, reduce ? 0 : 240);
        };
        var loop = function () {
            clearInterval(timer);
            if (reduce || !seen) return;
            timer = setInterval(function () { go(at + 1); }, CYCLE_MS);
        };
        dots.forEach(function (d, j) {
            d.addEventListener('click', function (ev) { ev.stopPropagation(); go(j); loop(); });
        });
        // a click anywhere on the right side moves to the next one
        conv.querySelector('.cmp-cycle').addEventListener('click', function () { go(at + 1); loop(); });
        onView(conv, function (vis) { seen = vis; if (vis) loop(); else clearInterval(timer); }, { threshold: 0.5 });
        // a hidden tab slows timers down; pause there so the side never sits half-faded
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) { clearInterval(timer); box.classList.remove('swap'); }
            else loop();
        });
    }
})();
