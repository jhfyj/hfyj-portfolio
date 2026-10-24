// PureGym case study, motion test.
// 1) Hero: the gym card swipes between saved gyms on a loop.
// 2) Zoom: a sticky stage. Scrolling moves a "camera" over the check-in screen,
//    each part lifts out of the phone and a leader line draws to its note.

(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. hero gym swap ---------- */
  var hero = document.getElementById('hero-phone');
  function fitHero() {
    var h = Math.min(window.innerHeight * 0.74, 700);
    hero.style.setProperty('--hero-scale', (h / 852).toFixed(3));
  }
  fitHero();
  window.addEventListener('resize', fitHero);
  if (!reduce) setInterval(function () { hero.classList.toggle('wh'); }, 2800);

  /* ---------- 2. zoom ---------- */
  var section = document.getElementById('zoom');
  var stage = section.querySelector('.zoom-stage');
  var camera = document.getElementById('camera');
  var lifts = [].slice.call(section.querySelectorAll('.lift'));
  var callouts = [].slice.call(section.querySelectorAll('.callout'));
  var bars = [].slice.call(section.querySelectorAll('.zoom-progress i'));
  var svg = document.getElementById('leaders');
  var NS = 'http://www.w3.org/2000/svg';

  // place each lift piece and give it its slice of the screenshot
  lifts.forEach(function (el) {
    var x = +el.dataset.x, y = +el.dataset.y;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.width = el.dataset.w + 'px'; el.style.height = el.dataset.h + 'px';
    el.style.backgroundPosition = (-x) + 'px ' + (-y) + 'px';
    // the empty slot the piece leaves behind when it lifts out
    var slot = document.createElement('div');
    slot.className = 'slot'; slot.dataset.step = el.dataset.step;
    slot.style.cssText = el.style.cssText;
    slot.style.background = el.dataset.bg || '#FFFFFF';
    el.parentNode.insertBefore(slot, el);
  });
  var slots = [].slice.call(section.querySelectorAll('.slot'));

  // one leader (line + dot) per callout
  var leaders = callouts.map(function () {
    var p = document.createElementNS(NS, 'path');
    var c = document.createElementNS(NS, 'circle'); c.setAttribute('r', 3.5);
    svg.appendChild(p); svg.appendChild(c);
    return { path: p, dot: c };
  });

  // camera keyframes: p = scroll progress, s = zoom (x fit), fy = phone y to focus, ax = where on screen (0-1 of width)
  var KF = [
    { p: 0.00, s: 1.00, fy: 426, ax: 0.64 },
    { p: 0.10, s: 1.00, fy: 426, ax: 0.64 },
    { p: 0.20, s: 1.60, fy: 195, ax: 0.34 },
    { p: 0.36, s: 1.60, fy: 195, ax: 0.34 },
    { p: 0.44, s: 1.60, fy: 311, ax: 0.34 },
    { p: 0.58, s: 1.60, fy: 311, ax: 0.34 },
    { p: 0.66, s: 1.35, fy: 480, ax: 0.34 },
    { p: 0.76, s: 1.35, fy: 480, ax: 0.34 },
    { p: 0.83, s: 1.60, fy: 670, ax: 0.34 },
    { p: 0.88, s: 1.60, fy: 670, ax: 0.34 },
    { p: 0.96, s: 1.00, fy: 426, ax: 0.36 },
    { p: 1.00, s: 1.00, fy: 426, ax: 0.36 }
  ];
  // which note is up for each stretch of scroll; 'all' = overview at the end
  var STEPS = [
    { from: 0.17, to: 0.41, step: 0 },
    { from: 0.41, to: 0.62, step: 1 },
    { from: 0.62, to: 0.80, step: 2 },
    { from: 0.80, to: 0.92, step: 3 },
    { from: 0.92, to: 1.01, step: 'all' }
  ];

  function smooth(t) { return t * t * (3 - 2 * t); }
  function sample(p) {
    for (var i = 0; i < KF.length - 1; i++) {
      var a = KF[i], b = KF[i + 1];
      if (p <= b.p) {
        var t = smooth(Math.max(0, Math.min(1, (p - a.p) / (b.p - a.p))));
        return { s: a.s + (b.s - a.s) * t, fy: a.fy + (b.fy - a.fy) * t, ax: a.ax + (b.ax - a.ax) * t };
      }
    }
    var l = KF[KF.length - 1]; return { s: l.s, fy: l.fy, ax: l.ax };
  }

  var cur = null, active = null;

  function progress() {
    var r = section.getBoundingClientRect();
    var total = r.height - window.innerHeight;
    return Math.max(0, Math.min(1, -r.top / total));
  }

  function setActive(step) {
    if (step === active) return;
    active = step;
    stage.classList.toggle('zoomed', step !== null);
    lifts.forEach(function (el) {
      var s = +el.dataset.step;
      el.classList.toggle('on', step === s);
    });
    slots.forEach(function (el) { el.classList.toggle('on', step === +el.dataset.step); });
    callouts.forEach(function (el, i) {
      el.classList.toggle('on', step === i || step === 'all');
    });
    bars.forEach(function (b, i) {
      b.classList.toggle('on', step === 'all' || (step !== null && i <= step));
    });
  }

  function layoutCallouts() {
    var sr = stage.getBoundingClientRect();
    var narrow = sr.width < 860;
    var placed = [];
    callouts.forEach(function (el, i) {
      var lr = lifts[i].getBoundingClientRect();
      var on = el.classList.contains('on');
      var L = leaders[i];
      if (narrow || !on) {
        L.path.style.opacity = 0; L.dot.style.opacity = 0;
        L.path.style.strokeDashoffset = L.path.getAttribute('data-len') || 400;
        return;
      }
      var cy = lr.top - sr.top + lr.height / 2;
      var x1 = lr.right - sr.left + 6;
      var left = Math.min(x1 + 80, sr.width - 350);
      var top = cy - 14;
      if (active === 'all') {
        // overview: stack the notes in one column, no overlaps
        var prev = placed[placed.length - 1];
        if (prev !== undefined && top < prev + 118) top = prev + 118;
        placed.push(top);
      }
      top = Math.max(24, Math.min(top, sr.height - 120));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      var y2 = top + 14, x2 = left - 14;
      var mid = x1 + (x2 - x1) * 0.45;
      var d = 'M' + x1 + ' ' + cy + ' H' + mid + ' V' + y2 + ' H' + x2;
      L.path.setAttribute('d', d);
      var len = Math.abs(x2 - x1) + Math.abs(y2 - cy) + 2;
      L.path.setAttribute('data-len', len);
      L.path.style.strokeDasharray = len;
      L.path.style.strokeDashoffset = 0;
      L.path.style.opacity = 1;
      L.dot.setAttribute('cx', x1); L.dot.setAttribute('cy', cy);
      L.dot.style.opacity = 1;
    });
  }

  function frame() {
    var W = stage.clientWidth, H = stage.clientHeight;
    var narrow = W < 860;
    var p = progress();
    var t = sample(p);
    if (narrow) { t.ax = 0.5; t.s = 1 + (t.s - 1) * 0.7; }
    var base = Math.min((H * (narrow ? 0.7 : 0.84)) / 852, (W * 0.9) / 393);
    var target = { S: base * t.s, fy: t.fy, ax: t.ax };
    if (!cur || reduce) cur = target;
    else {
      var k = 0.14;
      cur = { S: cur.S + (target.S - cur.S) * k, fy: cur.fy + (target.fy - cur.fy) * k, ax: cur.ax + (target.ax - cur.ax) * k };
    }
    var ay = narrow ? H * 0.42 : H / 2;
    var tx = cur.ax * W - 196.5 * cur.S;
    var ty = ay - cur.fy * cur.S;
    if (t.s === 1 && !narrow) ty = Math.max(ty, (H - 852 * cur.S) / 2); // keep the full phone centred when zoomed out
    camera.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + cur.S.toFixed(4) + ')';

    var step = null;
    for (var i = 0; i < STEPS.length; i++) if (p >= STEPS[i].from && p < STEPS[i].to) step = STEPS[i].step;
    setActive(step);
    layoutCallouts();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
