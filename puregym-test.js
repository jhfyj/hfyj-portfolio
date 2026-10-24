// PureGym case study, motion test.
// Phones are real HTML (from Figma), cloned from <template id="pg-screen">.
// 1) Hero: the gym card swipes between saved gyms on a loop.
// 2) Zoom: a sticky stage inside the column. Scrolling moves a "camera" over the
//    phone; each part lifts out in its own shape and a leader draws to its note.

(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var tpl = document.getElementById('pg-screen');
  var STATUS_ICONS =
    '<svg width="72" height="13" viewBox="0 0 72 13" fill="currentColor" aria-hidden="true">' +
    '<rect x="0" y="8.5" width="3" height="4" rx="1"/><rect x="5" y="6" width="3" height="6.5" rx="1"/>' +
    '<rect x="10" y="3.5" width="3" height="9" rx="1"/><rect x="15" y="1" width="3" height="11.5" rx="1"/>' +
    '<path d="M31 3.2a9.6 9.6 0 0 1 6.6 2.6l1.3-1.3A11.5 11.5 0 0 0 31 1.3a11.5 11.5 0 0 0-7.9 3.2l1.3 1.3A9.6 9.6 0 0 1 31 3.2Zm0 3.7a5.9 5.9 0 0 1 4 1.6l1.3-1.3A7.8 7.8 0 0 0 31 5a7.8 7.8 0 0 0-5.3 2.2L27 8.5a5.9 5.9 0 0 1 4-1.6Zm0 3.6a2.2 2.2 0 0 1 1.4.5L31 12.4l-1.4-1.4a2.2 2.2 0 0 1 1.4-.5Z"/>' +
    '<rect x="44.5" y="1" width="23" height="11.5" rx="3.6" fill="none" stroke="currentColor" stroke-opacity=".4"/>' +
    '<rect x="46.5" y="3" width="19" height="7.5" rx="2"/><rect x="69" y="4.5" width="1.6" height="4.5" rx=".8" fill-opacity=".45"/></svg>';

  function buildPhone(host, from) {
    var screen = document.createElement('div');
    screen.className = 'screen';
    screen.appendChild((from || tpl).content.cloneNode(true));
    host.appendChild(screen);
    host.insertAdjacentHTML('beforeend',
      '<div class="island" aria-hidden="true"></div>' +
      '<div class="status" aria-hidden="true"><span>9:41</span>' + STATUS_ICONS + '</div>' +
      '<div class="home" aria-hidden="true"></div>' +
      '<span class="btn l" style="top:118px;height:32px"></span>' +
      '<span class="btn l" style="top:178px;height:62px"></span>' +
      '<span class="btn l" style="top:252px;height:62px"></span>' +
      '<span class="btn r" style="top:206px;height:98px"></span>' +
      '<span class="btn r" style="top:470px;height:56px"></span>');
  }

  var FW = 393 + 26, FH = 852 + 26; // phone incl. the bezel

  /* ---------- 1. hero ---------- */
  var heroPhone = document.getElementById('hero-phone');
  buildPhone(heroPhone);
  var heroFit = heroPhone.parentNode, heroStage = heroFit.parentNode;
  function fitHero() {
    var s = Math.min((heroStage.clientHeight - 96) / FH, (heroStage.clientWidth - 48) / FW);
    heroPhone.style.transform = 'translate(' + (13 * s) + 'px,' + (13 * s) + 'px) scale(' + s + ')';
    heroFit.style.width = (FW * s) + 'px';
    heroFit.style.height = (FH * s) + 'px';
    heroFit.style.marginBottom = '28px';
  }
  fitHero();
  window.addEventListener('resize', fitHero);
  if (!reduce) setInterval(function () { heroPhone.classList.toggle('wh'); }, 3000);

  /* ---------- 2. zoom ---------- */
  var zoomPhone = document.getElementById('zoom-phone');
  buildPhone(zoomPhone);
  zoomPhone.style.left = '13px'; zoomPhone.style.top = '13px';

  var section = document.getElementById('zoom');
  var stage = section.querySelector('.zoom-stage');
  var camera = document.getElementById('camera');
  var callouts = [].slice.call(section.querySelectorAll('.callout'));
  var fills = [].slice.call(section.querySelectorAll('.zoom-progress b'));
  var svg = document.getElementById('leaders');
  var NS = 'http://www.w3.org/2000/svg';
  var PARTS = ['gym', 'seg', 'qr', 'wallet'];
  var parts = PARTS.map(function (k) { return zoomPhone.querySelector('[data-part="' + k + '"]'); });

  // dashed slot behind each part, same box and same corner radius
  var slots = parts.map(function (el) {
    var slot = document.createElement('div');
    slot.className = 'slot';
    slot.style.left = el.offsetLeft + 'px'; slot.style.top = el.offsetTop + 'px';
    slot.style.width = el.offsetWidth + 'px'; slot.style.height = el.offsetHeight + 'px';
    slot.style.borderRadius = getComputedStyle(el).borderRadius;
    el.parentNode.insertBefore(slot, el);
    return slot;
  });

  var leaders = callouts.map(function () {
    var p = document.createElementNS(NS, 'path');
    var c = document.createElementNS(NS, 'circle'); c.setAttribute('r', 3.5);
    svg.appendChild(p); svg.appendChild(c);
    return { path: p, dot: c };
  });

  // camera keyframes: p = scroll progress, z = zoom (x fit), fy = screen y in focus, ax = phone centre (0-1 of stage width)
  var KF = [
    { p: 0.00, z: 1.00, fy: 426, ax: 0.50 },
    { p: 0.08, z: 1.00, fy: 426, ax: 0.50 },
    { p: 0.18, z: 1.55, fy: 195, ax: 0.30 },
    { p: 0.34, z: 1.55, fy: 195, ax: 0.30 },
    { p: 0.42, z: 1.55, fy: 311, ax: 0.30 },
    { p: 0.56, z: 1.55, fy: 311, ax: 0.30 },
    { p: 0.64, z: 1.30, fy: 480, ax: 0.30 },
    { p: 0.74, z: 1.30, fy: 480, ax: 0.30 },
    { p: 0.81, z: 1.55, fy: 669, ax: 0.30 },
    { p: 0.87, z: 1.55, fy: 669, ax: 0.30 },
    { p: 0.95, z: 1.00, fy: 426, ax: 0.32 },
    { p: 1.00, z: 1.00, fy: 426, ax: 0.32 }
  ];
  var STEPS = [
    { from: 0.15, to: 0.39, step: 0 },
    { from: 0.39, to: 0.60, step: 1 },
    { from: 0.60, to: 0.78, step: 2 },
    { from: 0.78, to: 0.92, step: 3 },
    { from: 0.92, to: 1.01, step: 'all' }
  ];

  function smooth(t) { return t * t * (3 - 2 * t); }
  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function sample(p) {
    for (var i = 0; i < KF.length - 1; i++) {
      var a = KF[i], b = KF[i + 1];
      if (p <= b.p) {
        var t = smooth(clamp01((p - a.p) / (b.p - a.p)));
        return { z: a.z + (b.z - a.z) * t, fy: a.fy + (b.fy - a.fy) * t, ax: a.ax + (b.ax - a.ax) * t };
      }
    }
    var l = KF[KF.length - 1]; return { z: l.z, fy: l.fy, ax: l.ax };
  }
  function progress() {
    var r = section.getBoundingClientRect();
    var sr = stage.getBoundingClientRect();
    var stickTop = sr.top - r.top; // how far the stage has travelled
    var travel = r.height - stage.offsetHeight;
    return clamp01(stickTop / travel);
  }

  var cur = null, active = null;

  function setActive(step) {
    if (step === active) return;
    active = step;
    parts.forEach(function (el, i) { el.classList.toggle('lift', step === i); });
    slots.forEach(function (el, i) { el.classList.toggle('on', step === i); });
    callouts.forEach(function (el, i) { el.classList.toggle('on', step === i || step === 'all'); });
  }

  function layoutCallouts(W, H, narrow) {
    var sr = stage.getBoundingClientRect();
    var prev = null;
    var phoneRight = zoomPhone.getBoundingClientRect().right - sr.left + 13 * cur.S;
    callouts.forEach(function (el, i) {
      var L = leaders[i];
      if (narrow || !el.classList.contains('on')) {
        L.path.style.opacity = 0; L.dot.style.opacity = 0;
        return;
      }
      var lr = parts[i].getBoundingClientRect();
      var cy = lr.top - sr.top + lr.height / 2;
      var x1 = lr.right - sr.left + 4;
      var left = Math.min(Math.max(x1 + 64, phoneRight + 44), W - 270);
      var top = cy - 9;
      if (active === 'all') {
        if (prev !== null && top < prev + 104) top = prev + 104;
        prev = top;
      }
      top = Math.max(20, Math.min(top, H - 110));
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      var y2 = top + 9, x2 = left - 16;
      var mid = x1 + (x2 - x1) * 0.5;
      L.path.setAttribute('d', 'M' + x1 + ' ' + cy + ' H' + mid + ' V' + y2 + ' H' + x2);
      L.path.style.opacity = 1;
      L.dot.setAttribute('cx', x1); L.dot.setAttribute('cy', cy);
      L.dot.style.opacity = 1;
    });
  }

  function frame() {
    var W = stage.clientWidth, H = stage.clientHeight;
    var narrow = W < 640;
    var p = progress();
    var t = sample(p);
    if (narrow) { t.ax = 0.5; t.z = 1 + (t.z - 1) * 0.6; }
    var base = Math.min((H * (narrow ? 0.72 : 0.88)) / FH, (W * 0.9) / FW);
    var target = { S: base * t.z, fy: t.fy, ax: t.ax };
    if (!cur || reduce) cur = target;
    else {
      var k = 0.16;
      cur = { S: cur.S + (target.S - cur.S) * k, fy: cur.fy + (target.fy - cur.fy) * k, ax: cur.ax + (target.ax - cur.ax) * k };
    }
    var ay = narrow ? H * 0.40 : H / 2;
    var tx = cur.ax * W - (FW / 2) * cur.S;
    var ty = ay - (cur.fy + 13) * cur.S;
    // zoomed all the way out: centre the whole phone instead of the focus point
    var out = clamp01((1.12 - cur.S / base) / 0.12);
    var tyOut = (H - FH * cur.S) / 2;
    ty = ty + (tyOut - ty) * out;
    camera.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + cur.S.toFixed(4) + ')';

    var step = null;
    for (var i = 0; i < STEPS.length; i++) if (p >= STEPS[i].from && p < STEPS[i].to) step = STEPS[i].step;
    setActive(step);
    fills.forEach(function (b, i) { b.style.width = (clamp01((p - STEPS[i].from) / (STEPS[i].to - STEPS[i].from)) * 100) + '%'; });
    layoutCallouts(W, H, narrow);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- 3. problem (visual 1): the old home screen ----------
     Same camera idea as the zoom. Each piece members complained about lifts
     out in coral, in its own shape, pinned to what they said. At the end the
     camera pulls all the way out: every piece outlined, one line. */
  (function () {
    var sec = document.getElementById('problem-story');
    if (!sec) return;
    var st = sec.querySelector('.zoom-stage');
    var cam = sec.querySelector('.camera');
    var ph = sec.querySelector('.iphone');
    buildPhone(ph, document.getElementById('pg-old'));
    ph.style.left = '13px'; ph.style.top = '13px';
    var notes = [].slice.call(sec.querySelectorAll('.callout'));
    var bars = [].slice.call(sec.querySelectorAll('.zoom-progress b'));
    var lines = sec.querySelector('.leaders');
    var close = sec.querySelector('.p-close');
    var bits = ['search', 'account', 'tabs', 'scan', 'promo'].map(function (k) {
      return ph.querySelector('[data-part="' + k + '"]');
    });
    var holes = bits.map(function (el) {
      var s = document.createElement('div');
      s.className = 'slot';
      s.style.left = el.offsetLeft + 'px'; s.style.top = el.offsetTop + 'px';
      s.style.width = el.offsetWidth + 'px'; s.style.height = el.offsetHeight + 'px';
      s.style.borderRadius = getComputedStyle(el).borderRadius;
      el.parentNode.insertBefore(s, el);
      return s;
    });
    var ls = notes.map(function () {
      var p = document.createElementNS(NS, 'path');
      var c = document.createElementNS(NS, 'circle'); c.setAttribute('r', 3.5);
      lines.appendChild(p); lines.appendChild(c);
      return { path: p, dot: c };
    });

    // fy = screen y in focus: header 78, account 124, tabs 182, scan 354, promos 570
    var K = [
      { p: 0.00, z: 1.00, fy: 426, ax: 0.50 },
      { p: 0.05, z: 1.00, fy: 426, ax: 0.50 },
      { p: 0.13, z: 1.55, fy: 118, ax: 0.30 },
      { p: 0.38, z: 1.55, fy: 118, ax: 0.30 },
      { p: 0.45, z: 1.55, fy: 190, ax: 0.30 },
      { p: 0.55, z: 1.55, fy: 190, ax: 0.30 },
      { p: 0.62, z: 1.55, fy: 354, ax: 0.30 },
      { p: 0.71, z: 1.55, fy: 354, ax: 0.30 },
      { p: 0.79, z: 1.08, fy: 572, ax: 0.30 },
      { p: 0.86, z: 1.08, fy: 572, ax: 0.30 },
      { p: 0.94, z: 1.00, fy: 426, ax: 0.30 },
      { p: 1.00, z: 1.00, fy: 426, ax: 0.30 }
    ];
    var S5 = [
      { from: 0.10, to: 0.27, step: 0 },
      { from: 0.27, to: 0.42, step: 1 },
      { from: 0.42, to: 0.59, step: 2 },
      { from: 0.59, to: 0.75, step: 3 },
      { from: 0.75, to: 0.90, step: 4 },
      { from: 0.90, to: 1.01, step: 'all' }
    ];
    function at(p) {
      for (var i = 0; i < K.length - 1; i++) {
        var a = K[i], b = K[i + 1];
        if (p <= b.p) {
          var t = smooth(clamp01((p - a.p) / (b.p - a.p)));
          return { z: a.z + (b.z - a.z) * t, fy: a.fy + (b.fy - a.fy) * t, ax: a.ax + (b.ax - a.ax) * t };
        }
      }
      var l = K[K.length - 1]; return { z: l.z, fy: l.fy, ax: l.ax };
    }
    function prog() {
      var r = sec.getBoundingClientRect();
      var sr = st.getBoundingClientRect();
      return clamp01((sr.top - r.top) / (r.height - st.offsetHeight));
    }

    var now = null, on = undefined;
    function pick(step) {
      if (step === on) return;
      on = step;
      bits.forEach(function (el, i) {
        el.classList.toggle('lift', step === i);
        el.classList.toggle('pg-mark', step === 'all');
      });
      holes.forEach(function (el, i) { el.classList.toggle('on', step === i); });
      notes.forEach(function (el, i) { el.classList.toggle('on', step === i); });
      close.classList.toggle('on', step === 'all');
    }

    function place(W, H, narrow) {
      var sr = st.getBoundingClientRect();
      var right = ph.getBoundingClientRect().right - sr.left + 13 * now.S;
      notes.forEach(function (el, i) {
        var L = ls[i];
        if (narrow || !el.classList.contains('on')) { L.path.style.opacity = 0; L.dot.style.opacity = 0; return; }
        var r = bits[i].getBoundingClientRect();
        var cy = r.top - sr.top + r.height / 2;
        var x1 = r.right - sr.left + 4;
        var left = Math.min(Math.max(x1 + 64, right + 44), W - 260);
        var top = Math.max(20, Math.min(cy - 9, H - 130));
        el.style.left = left + 'px'; el.style.top = top + 'px';
        var y2 = top + 9, x2 = left - 16, mid = x1 + (x2 - x1) * 0.5;
        L.path.setAttribute('d', 'M' + x1 + ' ' + cy + ' H' + mid + ' V' + y2 + ' H' + x2);
        L.path.style.opacity = 1;
        L.dot.setAttribute('cx', x1); L.dot.setAttribute('cy', cy);
        L.dot.style.opacity = 1;
      });
      if (!narrow) {
        var cl = right + 48;
        close.style.left = cl + 'px';
        close.style.width = Math.max(180, W - cl - 32) + 'px';
        close.style.top = Math.max(20, (H - close.offsetHeight) / 2) + 'px';
      }
    }

    function tick() {
      requestAnimationFrame(tick);
      var vr = sec.getBoundingClientRect();
      if (now && (vr.bottom < -200 || vr.top > window.innerHeight + 200)) return;
      var W = st.clientWidth, H = st.clientHeight;
      var narrow = W < 640;
      var p = prog();
      var t = at(p);
      if (narrow) { t.ax = 0.5; t.z = 1 + (t.z - 1) * 0.6; }
      var base = Math.min((H * (narrow ? 0.72 : 0.88)) / FH, (W * 0.9) / FW);
      var target = { S: base * t.z, fy: t.fy, ax: t.ax };
      if (!now || reduce) now = target;
      else {
        var k = 0.16;
        now = { S: now.S + (target.S - now.S) * k, fy: now.fy + (target.fy - now.fy) * k, ax: now.ax + (target.ax - now.ax) * k };
      }
      var ay = narrow ? H * 0.40 : H / 2;
      var tx = now.ax * W - (FW / 2) * now.S;
      var ty = ay - (now.fy + 13) * now.S;
      var out = clamp01((1.12 - now.S / base) / 0.12);
      ty = ty + ((H - FH * now.S) / 2 - ty) * out;
      if (narrow && on === 'all') ty = Math.min(ty, 20);
      cam.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + now.S.toFixed(4) + ')';

      var step = null;
      for (var i = 0; i < S5.length; i++) if (p >= S5[i].from && p < S5[i].to) step = S5[i].step;
      pick(step);
      bars.forEach(function (b, i) { b.style.width = (clamp01((p - S5[i].from) / (S5[i].to - S5[i].from)) * 100) + '%'; });
      place(W, H, narrow);
    }
    requestAnimationFrame(tick);
  })();
})();
