// PureGym case study, motion test.
// Phones are real HTML (from Figma), cloned from <template id="pg-screen">.
// 1) Hero: the gym card swipes between saved gyms on a loop.
// 2) Zoom: plays on its own like a video. A "camera" moves over the
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

  // The gym name at the top is always centred, whichever gym it shows: the
  // name box takes the width of the name in view and eases to the next one's
  // when the phone switches gyms (class "wh" = Washington Heights).
  function centreName(phone) {
    var roll = phone.querySelector('.gymname-roll');
    if (!roll) return;
    var n = roll.querySelectorAll('span');
    function sync() {
      var el = phone.classList.contains('wh') ? n[1] : n[0];
      roll.style.width = Math.ceil(el.scrollWidth) + 'px';
    }
    sync();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sync);
    new MutationObserver(sync).observe(phone, { attributes: true, attributeFilter: ['class'] });
  }
  var _build = buildPhone;
  buildPhone = function (host, from) { _build(host, from); centreName(host); };

  // Guest pass, as designed (Figma: Version B, the one testers picked): a
  // ticket with the visits left, the date it runs to, two lines of copy and
  // Share link. Used by the decision demo and the testing card.
  var SHARE = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>';
  function addGuest(card) {
    card.insertAdjacentHTML('beforeend',
      '<div class="guest">' +
        '<div class="g-ticket"><p class="g-big"><b>5</b><span>Visits<br>remaining</span></p></div>' +
        '<p class="g-valid">Valid until: Feb 1 2026</p>' +
        '<p class="g-copy">With your current membership you can bring friends to the gym to train together!</p>' +
        '<p class="g-copy">Share the unique link with your friend and have them sign up via the PureGym site.</p>' +
        '<div class="g-share">' + SHARE + 'Share link</div>' +
      '</div>');
  }

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

  // The solution plays on its own like a short video: whole phone, then the
  // camera glides to each part (gym, guest pass, code, wallet), then back out
  // to the whole screen with every note, and loops. Camera moves are tweens
  // between finished camera positions (scale + x + y together), so the zoom
  // in and out is one smooth ease, no jump. Click a step name to jump to it;
  // the loop stops there until the panel leaves the screen and comes back.
  // z = zoom (x fit), fy = screen y in focus, ax = phone centre (0-1 of stage width)
  var STOPS = [
    { z: 1.00, fy: 426, ax: 0.50, step: null,  hold: 450 },
    { z: 1.55, fy: 195, ax: 0.30, step: 0,     hold: 1700 },
    { z: 1.55, fy: 311, ax: 0.30, step: 1,     hold: 1700 },
    { z: 1.30, fy: 480, ax: 0.30, step: 2,     hold: 1700 },
    { z: 1.55, fy: 669, ax: 0.30, step: 3,     hold: 1700 },
    { z: 1.00, fy: 426, ax: 0.32, step: 'all', hold: 2800 }
  ];
  var MOVE = 750, JUMP = 600;

  function clamp01(v) { return Math.max(0, Math.min(1, v)); }
  function ease(t) { return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  var W = 0, H = 0, narrow = false, base = 1;
  function measure() {
    W = stage.clientWidth; H = stage.clientHeight; narrow = W < 640; stage.classList.toggle('is-narrow', narrow);
    base = Math.min((H * (narrow ? 0.72 : 0.88)) / FH, (W * 0.9) / FW);
  }
  // where the camera sits for one stop
  function camOf(st) {
    var z = narrow ? 1 + (st.z - 1) * 0.6 : st.z;
    var ax = narrow ? 0.5 : st.ax;
    var S = base * z;
    var tx = ax * W - (FW / 2) * S;
    var ty = st.z === 1 ? (H - FH * S) / 2 : (narrow ? H * 0.40 : H / 2) - (st.fy + 13) * S;
    return { S: S, tx: tx, ty: ty };
  }

  var cur = null, active = null;
  var idx = 0, from = null, t0 = 0, dur = 0, live = false, held = false;

  function setActive(step) {
    if (step === active) return;
    active = step;
    parts.forEach(function (el, i) { el.classList.toggle('lift', step === i); });
    slots.forEach(function (el, i) { el.classList.toggle('on', step === i); });
    callouts.forEach(function (el, i) { el.classList.toggle('on', step === i || step === 'all'); });
  }

  function go(i, ms) {
    measure();
    from = cur || camOf(STOPS[i]);
    idx = i; t0 = performance.now(); dur = ms;
    setActive(STOPS[i].step);
  }
  function restart() {
    measure();
    idx = 0; cur = camOf(STOPS[0]); from = cur; t0 = performance.now(); dur = 0;
    setActive(null);
  }

  // the step names under the panel are clickable (same as the problem panel)
  var tabs = fills.map(function (b) { return b.parentNode; });
  var row = tabs.length ? tabs[0].parentNode : null;
  if (row) { row.removeAttribute('aria-hidden'); row.setAttribute('role', 'tablist'); row.classList.add('clickable'); }
  function hold(i) {
    held = true;
    go(i + 1, JUMP);
    tabs.forEach(function (t, j) { t.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
  }
  tabs.forEach(function (t, i) {
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', 'false');
    t.tabIndex = 0;
    t.addEventListener('click', function () { hold(i); });
    t.addEventListener('keydown', function (e) {
      var k = e.key, n = null;
      if (k === 'Enter' || k === ' ') n = i;
      else if (k === 'ArrowRight') n = (i + 1) % tabs.length;
      else if (k === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
      if (n === null) return;
      e.preventDefault(); hold(n); tabs[n].focus();
    });
  });

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) {
      var v = en[0].isIntersecting && en[0].intersectionRatio >= 0.45;
      if (v === live) return;
      live = v;
      if (!v) { held = false; tabs.forEach(function (t) { t.setAttribute('aria-selected', 'false'); }); }
      restart();
    }, { threshold: [0, 0.45, 1] }).observe(stage);
  } else { live = true; }

  function bars(now) {
    var st = STOPS[idx].step;
    var k = clamp01((now - t0 - dur) / STOPS[idx].hold);
    fills.forEach(function (b, j) {
      var w;
      if (held) w = st === j ? 1 : 0;
      else if (st === 'all') w = 1;
      else if (typeof st === 'number') w = j < st ? 1 : j === st ? k : 0;
      else w = 0;
      b.style.width = (w * 100) + '%';
      b.parentNode.classList.toggle('on', st === j);
    });
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

  function frame(now) {
    measure();
    if (!cur) restart();
    if (reduce) { idx = STOPS.length - 1; held = true; setActive('all'); cur = camOf(STOPS[idx]); }
    else {
      var target = camOf(STOPS[idx]);
      var k = dur ? ease(clamp01((now - t0) / dur)) : 1;
      cur = { S: from.S + (target.S - from.S) * k, tx: from.tx + (target.tx - from.tx) * k, ty: from.ty + (target.ty - from.ty) * k };
      // hold done: glide on to the next stop (back to the start after the last)
      if (live && !held && now - t0 >= dur + STOPS[idx].hold) go((idx + 1) % STOPS.length, MOVE);
    }
    camera.style.transform = 'translate(' + cur.tx.toFixed(2) + 'px,' + cur.ty.toFixed(2) + 'px) scale(' + cur.S.toFixed(4) + ')';
    bars(now);
    layoutCallouts(W, H, narrow);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- 3. problem (visual 1): the old home screen ----------
     The real screenshot, untouched. No scroll motion: once the panel is on
     screen, each piece members complained about floats up out of it in its
     own shape, with what they said, one after another. Then all five are
     outlined together and it lands on one line. Loops while on screen. */
  (function () {
    var sec = document.getElementById('problem-story');
    if (!sec) return;
    var st = sec.querySelector('.zoom-stage');
    var cam = sec.querySelector('.camera');
    var ph = sec.querySelector('.iphone');
    buildPhone(ph, document.getElementById('pg-old'));
    ph.style.left = '13px'; ph.style.top = '13px';
    var shot = ph.querySelector('.old');
    var src = ph.querySelector('.old-shot').getAttribute('src');
    var notes = [].slice.call(sec.querySelectorAll('.callout'));
    var bars = [].slice.call(sec.querySelectorAll('.zoom-progress b'));
    var lines = sec.querySelector('.leaders');
    var close = sec.querySelector('.p-close');
    var bits = ['search', 'account', 'tabs', 'scan', 'promo'].map(function (k) {
      return ph.querySelector('[data-part="' + k + '"]');
    });
    // each piece shows exactly the part of the screenshot it sits on
    var holes = bits.map(function (el) {
      var b = el.getAttribute('data-box').split(',');
      var r = /%$/.test(b[4]) ? b[4] : b[4] + 'px';
      el.style.left = b[0] + 'px'; el.style.top = b[1] + 'px';
      el.style.width = b[2] + 'px'; el.style.height = b[3] + 'px';
      el.style.borderRadius = r;
      el.style.backgroundImage = 'url("' + src + '")';
      el.style.backgroundPosition = (-b[0]) + 'px ' + (-b[1]) + 'px';
      var s = document.createElement('div');
      s.className = 'slot';
      s.style.left = b[0] + 'px'; s.style.top = b[1] + 'px';
      s.style.width = b[2] + 'px'; s.style.height = b[3] + 'px';
      s.style.borderRadius = r;
      el.parentNode.insertBefore(s, el);
      return s;
    });
    var ls = notes.map(function () {
      var p = document.createElementNS(NS, 'path');
      var c = document.createElementNS(NS, 'circle'); c.setAttribute('r', 3.5);
      lines.appendChild(p); lines.appendChild(c);
      return { path: p, dot: c };
    });

    var S = 1;
    function fit() {
      var W = st.clientWidth, H = st.clientHeight, narrow = W < 640;
      st.classList.toggle('is-narrow', narrow);
      S = Math.min((H * (narrow ? 0.64 : 0.9)) / FH, (W * 0.9) / FW);
      var tx = narrow ? (W - FW * S) / 2 : Math.max(28, W * 0.3 - (FW * S) / 2);
      var ty = narrow ? 22 : (H - FH * S) / 2;
      cam.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + S.toFixed(4) + ')';
    }

    var on = undefined;
    function pick(step) {
      if (step === on) return;
      on = step;
      shot.classList.toggle('dim', typeof step === 'number');
      bits.forEach(function (el, i) {
        el.classList.toggle('lift', step === i);
        el.classList.toggle('pg-mark', step === 'all');
      });
      holes.forEach(function (el, i) { el.classList.toggle('on', step === i); });
      notes.forEach(function (el, i) { el.classList.toggle('on', step === i); });
      close.classList.toggle('on', step === 'all');
    }

    function place() {
      var W = st.clientWidth, H = st.clientHeight, narrow = W < 640;
      var sr = st.getBoundingClientRect();
      var right = ph.getBoundingClientRect().right - sr.left + 13 * S;
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

    // the timeline: five pieces, then the ending, then start over
    var STEP = 3400, END = 5200, REST = 1000;
    var idx = -1, timer = null, live = false;
    function fill(step, ms) {
      bars.forEach(function (b, i) {
        var done = step === 'all' || (typeof step === 'number' && i < step);
        b.parentNode.classList.toggle('on', step === i);
        b.style.transition = 'none';
        b.style.width = done ? '100%' : '0%';
        if (step === i) {
          void b.offsetWidth;
          b.style.transition = reduce ? 'none' : 'width ' + ms + 'ms linear';
          b.style.width = '100%';
        }
      });
    }
    function show(step, ms) { pick(step); fill(step, ms); }

    // click a step name to jump straight to it. The loop stops on that step
    // (like the iterations row) until the panel leaves the screen and comes back.
    var held = false;
    var tabs = bars.map(function (b) { return b.parentNode; });
    var row = tabs.length ? tabs[0].parentNode : null;
    if (row) {
      row.removeAttribute('aria-hidden');
      row.setAttribute('role', 'tablist');
      row.classList.add('clickable');
    }
    function hold(i) {
      clearTimeout(timer);
      held = true; idx = i;
      pick(i);
      bars.forEach(function (b, j) {
        b.parentNode.classList.toggle('on', j === i);
        b.style.transition = reduce ? 'none' : 'width .35s ease';
        b.style.width = j === i ? '100%' : '0%';
      });
      tabs.forEach(function (t, j) { t.setAttribute('aria-selected', j === i ? 'true' : 'false'); });
    }
    tabs.forEach(function (t, i) {
      t.setAttribute('role', 'tab');
      t.setAttribute('aria-selected', 'false');
      t.tabIndex = 0;
      t.addEventListener('click', function () { hold(i); });
      t.addEventListener('keydown', function (e) {
        var k = e.key, go = null;
        if (k === 'Enter' || k === ' ') go = i;
        else if (k === 'ArrowRight') go = (i + 1) % tabs.length;
        else if (k === 'ArrowLeft') go = (i - 1 + tabs.length) % tabs.length;
        if (go === null) return;
        e.preventDefault();
        hold(go);
        tabs[go].focus();
      });
    });

    function next() {
      clearTimeout(timer);
      if (!live || held) return;
      idx++;
      if (idx < bits.length) { show(idx, STEP); timer = setTimeout(next, STEP); }
      else if (idx === bits.length) { show('all'); timer = setTimeout(next, END); }
      else { idx = -1; show(null); timer = setTimeout(next, REST); }
    }
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        var v = en[0].isIntersecting && en[0].intersectionRatio >= 0.45;
        if (v === live) return;
        live = v;
        clearTimeout(timer);
        if (!v) {
          held = false;
          tabs.forEach(function (t) { t.setAttribute('aria-selected', 'false'); });
        }
        if (v && !held) { idx = -1; show(null); timer = setTimeout(next, 500); }
      }, { threshold: [0, 0.5] }).observe(st);
    } else { live = true; next(); }

    fit();
    window.addEventListener('resize', fit);
    (function frame() {
      requestAnimationFrame(frame);
      if (live || held) place();
    })();
  })();

  /* ================================================================
     The rest of the page. Each piece plays only while it's on screen
     and starts clean every time it comes back.
     ================================================================ */

  // run fn(true) when el is mostly on screen, fn(false) when it leaves
  function whenSeen(el, ratio, fn) {
    if (!('IntersectionObserver' in window)) { fn(true); return; }
    var on = false;
    new IntersectionObserver(function (en) {
      var v = en[0].isIntersecting && en[0].intersectionRatio >= ratio;
      if (v !== on) { on = v; fn(v); }
    }, { threshold: [0, ratio, 1] }).observe(el);
  }

  var GYM = 'assets/puregym/v2/ui/gym-photo.png';
  var CHECK = '<svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2l2.3 2.3 4.7-5"/></svg>';

  /* ---------- 2b. challenge: type the question ---------- */
  (function () {
    var ask = document.querySelector('.ask');
    if (!ask) return;
    var out = ask.querySelector('.ask-typed'), text = ask.getAttribute('data-text'), t = null;
    function stop() { clearTimeout(t); }
    whenSeen(ask, 0.9, function (v) {
      stop();
      if (!v) return;
      if (reduce) { out.textContent = text; ask.classList.add('done'); return; }
      if (ask.classList.contains('done')) return;
      var i = out.textContent.length;
      (function step() {
        out.textContent = text.slice(0, ++i);
        if (i < text.length) t = setTimeout(step, text[i - 1] === ',' ? 260 : 26 + Math.random() * 34);
        else ask.classList.add('done');
      })();
    });
  })();

  /* ---------- 4. decision demos ---------- */
  // A tiny script runner: moves the finger, taps, types. Every wait checks a
  // run id, so leaving the screen stops a demo mid-step and resets it.
  function makeDemo(article, extend, script, reset) {
    var stage = article.querySelector('.demo-stage');
    var box = article.querySelector('.demo-phone');
    var phone = box.querySelector('.iphone');
    var finger = article.querySelector('.finger');
    buildPhone(phone);
    var screen = phone.querySelector('.screen');
    var parts = extend(screen, phone) || {};
    var S = 1, run = 0;

    function fit() {
      var W = stage.clientWidth, H = stage.clientHeight;
      S = Math.min((H - 64) / FH, (W * 0.8) / FW);
      box.style.left = ((W - FW * S) / 2).toFixed(1) + 'px';
      box.style.top = ((H - FH * S) / 2).toFixed(1) + 'px';
      phone.style.transform = 'translate(' + (13 * S) + 'px,' + (13 * S) + 'px) scale(' + S + ')';
    }
    fit();
    window.addEventListener('resize', fit);

    function Stop() {}
    var api = {
      parts: parts, screen: screen, phone: phone,
      wait: function (ms) {
        var id = run;
        return new Promise(function (res, rej) { setTimeout(function () { id === run ? res() : rej(new Stop()); }, ms); });
      },
      // put the finger on an element (ox/oy = where on it, 0..1)
      at: function (el, ox, oy, ms) {
        var sr = stage.getBoundingClientRect(), r = el.getBoundingClientRect();
        var x = r.left - sr.left + r.width * (ox == null ? 0.5 : ox);
        var y = r.top - sr.top + r.height * (oy == null ? 0.5 : oy);
        finger.classList.add('on');
        finger.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
        return api.wait(ms || 820);
      },
      park: function () { // rest just off the phone, bottom right
        var x = stage.clientWidth * 0.5 + FW * S * 0.62, y = stage.clientHeight * 0.78;
        finger.style.transform = 'translate(' + x + 'px,' + y + 'px)';
      },
      tap: function () {
        finger.classList.add('press');
        return api.wait(150).then(function () {
          finger.classList.remove('press', 'ripple'); void finger.offsetWidth; finger.classList.add('ripple');
          return api.wait(120);
        });
      },
      hide: function () { finger.classList.remove('on'); return api.wait(350); },
      type: function (el, text, speed) {
        var i = 0;
        function step() {
          el.textContent = text.slice(0, ++i);
          return i < text.length ? api.wait(speed + Math.random() * 30).then(step) : Promise.resolve();
        }
        return step();
      },
      count: function (el, to, ms) {
        var id = run, t0 = performance.now();
        return new Promise(function (res) {
          (function f(now) {
            if (id !== run) return res();
            var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
            el.textContent = Math.round(to * e);
            if (k < 1) requestAnimationFrame(f); else res();
          })(t0);
        });
      }
    };

    function loop() {
      var id = run;
      reset(api); api.park();
      script(api).then(function () { if (id === run) loop(); }, function () {});
    }
    whenSeen(stage, 0.5, function (v) {
      run++;
      finger.classList.remove('on');
      if (v && !reduce) { setTimeout(loop, 60); }
      else reset(api);
    });
    return api;
  }

  // 1) guest pass toggle
  var guestEl = document.querySelector('.demo[data-demo="guest"]');
  if (guestEl) makeDemo(guestEl, function (screen) {
    var card = screen.querySelector('.qr-card');
    addGuest(card);
    screen.insertAdjacentHTML('beforeend', '<div class="toast">Link copied. Send it to a friend.</div>');
    var opts = card.querySelectorAll('.seg-opt');
    return { card: card, me: opts[0], guest: opts[1], share: card.querySelector('.g-share'), toast: screen.querySelector('.toast') };
  }, function (d) {
    var p = d.parts;
    return d.wait(900)
      .then(function () { return d.at(p.guest); }).then(d.tap)
      .then(function () { p.card.classList.add('is-guest'); return d.wait(1500); })
      .then(function () { return d.at(p.share); }).then(d.tap)
      .then(function () { p.toast.classList.add('on'); return d.wait(1700); })
      .then(function () { p.toast.classList.remove('on'); return d.at(p.me); }).then(d.tap)
      .then(function () { p.card.classList.remove('is-guest'); return d.wait(700); })
      .then(d.hide).then(function () { return d.wait(1600); });
  }, function (d) {
    d.parts.card.classList.remove('is-guest');
    d.parts.toast.classList.remove('on');
  });

  // 2) saved gyms: the sheet, adding a gym, switching to it
  var gymsEl = document.querySelector('.demo[data-demo="gyms"]');
  if (gymsEl) makeDemo(gymsEl, function (screen) {
    function row(name, addr, sel) {
      return '<div class="g-row' + (sel ? ' sel' : '') + '"><img src="' + GYM + '" alt=""><span class="t"><span class="n">' + name + '</span><span class="a">' + addr + '</span></span>' +
        (sel ? '<span class="g-check">' + CHECK + '</span>' : '') + '</div>';
    }
    screen.insertAdjacentHTML('beforeend',
      '<div class="scrim"></div>' +
      '<div class="sheet">' +
        '<div class="sheet-grab"></div>' +
        '<div class="sheet-page select">' +
          '<h4>Select your gym</h4><span class="more">&middot;&middot;&middot;</span>' +
          row('East Village', '98 Avenue A, New York', true) +
          row('116th', '27 W. 116th Street, New York') +
          row('Bedford Park', '3000 Jerome Avenue, Bronx') +
          '<div class="g-add"><span class="plus">+</span>Add Gym</div>' +
        '</div>' +
        '<div class="sheet-page add">' +
          '<h4>Add gym</h4>' +
          '<div class="g-search"><span><span class="ph">Search</span><span class="typed"></span><span class="caret"></span></span>' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#678788" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg></div>' +
          '<div class="g-map"><img src="assets/puregym/v2/ui/map.webp" alt="">' +
            '<svg class="g-pin" viewBox="0 0 26 34"><path d="M13 33s11-11.6 11-20A11 11 0 0 0 2 13c0 8.4 11 20 11 20z" fill="#FB7572"/><circle cx="13" cy="13" r="4.5" fill="#fff"/></svg></div>' +
          '<div class="g-row g-result"><img src="' + GYM + '" alt=""><span class="t"><span class="n">Washington Heights</span><span class="a">4200 Broadway Suite 1.3, New York</span></span>' +
            '<span class="g-plus">+</span><span class="g-check">' + CHECK + '</span></div>' +
          '<div class="g-save">SAVE</div>' +
        '</div>' +
      '</div>');
    var sheet = screen.querySelector('.sheet');
    return {
      name: screen.querySelector('.app-gymname'), sheet: sheet,
      addRow: sheet.querySelector('.g-add'), search: sheet.querySelector('.g-search'),
      ph: sheet.querySelector('.ph'), typed: sheet.querySelector('.typed'),
      result: sheet.querySelector('.g-result'), save: sheet.querySelector('.g-save')
    };
  }, function (d) {
    var p = d.parts, scr = d.screen;
    return d.wait(800)
      .then(function () { return d.at(p.name); }).then(d.tap)
      .then(function () { scr.classList.add('open'); return d.wait(1100); })
      .then(function () { return d.at(p.addRow, 0.3); }).then(d.tap)
      .then(function () { p.sheet.classList.add('to-add'); return d.wait(800); })
      .then(function () { return d.at(p.search, 0.4); }).then(d.tap)
      .then(function () { p.ph.textContent = ''; p.sheet.classList.add('typing'); return d.type(p.typed, 'Washington Heights', 55); })
      .then(function () { p.sheet.classList.remove('typing'); p.sheet.classList.add('pinned'); return d.wait(900); })
      .then(function () { return d.at(p.result, 0.92); }).then(d.tap)
      .then(function () { p.sheet.classList.add('added'); return d.wait(700); })
      .then(function () { return d.at(p.save); }).then(d.tap)
      .then(function () { scr.classList.remove('open'); return d.wait(650); })
      .then(function () { d.phone.classList.add('wh'); return d.wait(400); })
      .then(d.hide).then(function () { return d.wait(2200); });
  }, function (d) {
    var p = d.parts;
    d.screen.classList.remove('open');
    p.sheet.classList.remove('to-add', 'typing', 'pinned', 'added');
    p.typed.textContent = ''; p.ph.textContent = 'Search';
    d.phone.classList.remove('wh');
  });

  // 3) the Progress tab
  var progEl = document.querySelector('.demo[data-demo="progress"]');
  if (progEl) makeDemo(progEl, function (screen) {
    var STAR = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FB7572" stroke-width="1.4" stroke-linejoin="round"><path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z"/></svg>';
    var MEDAL = '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FB7572" stroke-width="1.4" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M8.5 14l-1.5 7.5 5-2.5 5 2.5-1.5-7.5"/><path d="M12 6.5v5"/></svg>';
    var app = screen.querySelector('.app');
    app.insertAdjacentHTML('beforeend',
      '<div class="prog">' +
        '<div class="prog-top"><p>Progress</p><img src="assets/puregym/v2/ui/bell.svg" width="22" height="22" alt=""></div>' +
        '<div class="prog-banner"><span>Find your personal<br>trainer today</span><span>&rsaquo;</span></div>' +
        '<div class="prog-tiles"><div class="prog-tile">number of hours<br>in Puregym<b class="c1">0</b></div><div class="prog-tile t2">number of<br>achievements<b class="c2">0</b></div></div>' +
        '<div class="prog-ach"><h5>Achievements</h5><small>Streaks</small><div class="badges">' +
          '<span class="badge">' + STAR + '2 Weeks Streak</span><span class="badge">' + STAR + '3 Weeks Streak</span><span class="badge">' + MEDAL + '1 Month Streak</span>' +
        '</div></div>' +
      '</div>');
    var tabs = screen.querySelectorAll('.app-tabs .tab');
    tabs[0].classList.add('t-progress'); tabs[1].classList.add('t-check');
    return { app: app, prog: app.querySelector('.prog'), tabs: tabs, c1: app.querySelector('.c1'), c2: app.querySelector('.c2') };
  }, function (d) {
    var p = d.parts;
    return d.wait(900)
      .then(function () { return d.at(p.tabs[0], 0.5, 0.4); }).then(d.tap)
      .then(function () {
        p.prog.classList.add('on'); p.app.classList.add('on-progress');
        p.tabs[0].classList.add('on'); p.tabs[1].classList.remove('on');
        return d.wait(350);
      })
      .then(function () { return Promise.all([d.count(p.c1, 124, 1100), d.count(p.c2, 36, 900)]); })
      .then(function () { return d.wait(2000); })
      .then(function () { return d.at(p.tabs[1], 0.5, 0.4); }).then(d.tap)
      .then(function () {
        p.prog.classList.remove('on'); p.app.classList.remove('on-progress');
        p.tabs[1].classList.add('on'); p.tabs[0].classList.remove('on');
        return d.wait(500);
      })
      .then(d.hide).then(function () { return d.wait(1800); });
  }, function (d) {
    var p = d.parts;
    p.prog.classList.remove('on'); p.app.classList.remove('on-progress');
    p.tabs[1].classList.add('on'); p.tabs[0].classList.remove('on');
    p.c1.textContent = '0'; p.c2.textContent = '0';
  });

  /* ---------- 5. iterations rail: V1 -> V2 -> V3 -> final, on a loop ---------- */
  (function () {
    var rail = document.getElementById('rail');
    if (!rail) return;
    var steps = [].slice.call(rail.querySelectorAll('.rail-step'));
    var mini = rail.querySelector('.rail-mini'), rp = document.getElementById('rail-phone');
    buildPhone(rp);
    function fit() {
      var s = mini.clientHeight / FH;
      mini.style.width = (FW * s) + 'px';
      rp.style.transform = 'translate(' + (13 * s) + 'px,' + (13 * s) + 'px) scale(' + s + ')';
    }
    fit(); window.addEventListener('resize', fit);
    var i = -1, t = null;
    // no bar on top any more: the version in focus is simply the one lit up
    function show(k) {
      steps.forEach(function (s, j) { s.classList.toggle('on', j === k); s.classList.toggle('seen', j < k); });
    }
    // V1, V2, V3 go by quickly, then it lands on Final and stays there
    // (no loop back to V1). It plays again from V1 the next time it comes on screen.
    var QUICK = 1100;
    function next() {
      i++;
      show(i);
      if (i < steps.length - 1) t = setTimeout(next, QUICK);
    }
    // click (or Enter/Space) on any version: stop the loop and keep that one lit
    var manual = false;
    function pick(k) {
      clearTimeout(t); manual = true; i = k;
      rail.classList.add('manual');
      steps.forEach(function (s, j) { s.classList.toggle('on', j === k); s.classList.remove('seen'); });
    }
    steps.forEach(function (s, k) {
      s.setAttribute('tabindex', '0');
      s.setAttribute('role', 'button');
      s.addEventListener('click', function () { pick(k); });
      s.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(k); }
      });
    });
    whenSeen(rail, 0.6, function (v) {
      clearTimeout(t);
      if (manual) return;
      if (!v) { i = -1; show(-1); return; }
      if (reduce) { steps.forEach(function (s) { s.classList.add('seen'); }); return; }
      t = setTimeout(next, 300);
    });
  })();

  /* ---------- 6a. testing: Popular times, before and after ---------- */
  (function () {
    var card = document.getElementById('times-card');
    if (!card) return;
    var plot = card.querySelector('.times-plot');
    var wipe = card.querySelector('.times-wipe');
    var H = [24, 32, 50, 66, 58, 38, 30, 44, 60, 76, 92, 84, 64, 46, 34, 28, 22];
    var NOW = 6;
    var before = card.querySelector('.before'), after = card.querySelector('.after');
    H.forEach(function (h, k) {
      // before: one teal for everything, the current hour in coral
      var b = document.createElement('i');
      b.style.height = h + '%';
      b.style.background = k === NOW ? '#FB7572' : '#5FD6D9';
      b.style.color = '#FB7572';
      if (k === NOW) { b.className = 'now'; b.setAttribute('data-l', 'less busy'); }
      before.appendChild(b);
      // after: coral means busy, teal means quiet, the current hour is the dark dot
      var a = document.createElement('i');
      a.style.height = h + '%';
      a.style.background = k === NOW ? '#0EBABF' : h >= 60 ? '#FB7572' : h >= 44 ? '#F9A9A7' : '#5FD6D9';
      a.style.color = '#0EBABF';
      if (k === NOW) { a.className = 'now'; a.setAttribute('data-l', 'less busy'); }
      after.appendChild(a);
    });
    var t = null, run = 0;
    function sweep(to, ms) {
      var id = run, from = parseFloat(plot.style.getPropertyValue('--w')) || 0, t0 = performance.now();
      return new Promise(function (res) {
        (function f(now) {
          if (id !== run) return;
          var k = Math.min(1, (now - t0) / ms), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
          var w = from + (to - from) * e;
          plot.style.setProperty('--w', w + '%');
          wipe.setAttribute('data-l', w > 50 ? 'After' : 'Before');
          if (k < 1) requestAnimationFrame(f); else res();
        })(t0);
      });
    }
    function wait(ms) { var id = run; return new Promise(function (res) { t = setTimeout(function () { if (id === run) res(); }, ms); }); }
    function loop() { var id = run; wait(900).then(function () { return sweep(100, 1500); }).then(function () { return wait(2600); })
      .then(function () { return sweep(0, 1500); }).then(function () { return wait(1600); }).then(function () { if (id === run) loop(); }); }
    plot.style.setProperty('--w', '0%'); wipe.setAttribute('data-l', 'Before');
    whenSeen(card, 0.6, function (v) {
      run++; clearTimeout(t);
      if (!v) { plot.style.setProperty('--w', '0%'); wipe.setAttribute('data-l', 'Before'); return; }
      if (reduce) { plot.style.setProperty('--w', '100%'); wipe.setAttribute('data-l', 'After'); return; }
      loop();
    });
  })();

  /* ---------- 6b. testing: Version A vs B, the real screens ---------- */
  (function () {
    var ab = document.querySelector('#ab-card .ab');
    if (!ab) return;
    var t = null;
    var pa = ab.querySelector('.ab-a'), pb = ab.querySelector('.ab-b');
    buildPhone(pa, document.getElementById('pg-vera'));
    buildPhone(pb);
    // A: popular times bars, coloured by how busy (as in the final chart)
    var bars = pa.querySelector('.va-bars');
    [24, 32, 50, 66, 58, 38, 30, 44, 60, 76, 92, 84, 64, 46, 34, 28, 22].forEach(function (h, k) {
      var b = document.createElement('i');
      b.style.height = h + '%';
      b.style.background = k === 6 ? '#0EBABF' : h >= 60 ? '#FB7572' : h >= 44 ? '#F9A9A7' : '#5FD6D9';
      bars.appendChild(b);
    });
    // B: the check-in screen with Guest pass picked
    var bc = pb.querySelector('.qr-card');
    addGuest(bc);
    bc.classList.add('is-guest');
    function fitAB() {
      [pa, pb].forEach(function (p) {
        var box = p.parentNode, s = box.clientWidth / FW;
        box.style.height = (FH * s) + 'px';
        p.style.transform = 'translate(' + (13 * s) + 'px,' + (13 * s) + 'px) scale(' + s + ')';
      });
    }
    fitAB(); window.addEventListener('resize', fitAB);
    whenSeen(ab, 0.6, function (v) {
      clearTimeout(t);
      ab.classList.remove('decided');
      if (!v) return;
      (function loop() {
        t = setTimeout(function () {
          ab.classList.add('decided');
          t = setTimeout(function () { ab.classList.remove('decided'); loop(); }, 4200);
        }, reduce ? 0 : 1200);
      })();
    });
  })();

  /* ---------- 7. success means: the little loops run while on screen ---------- */
  (function () {
    var m = document.querySelector('.metrics');
    if (!m) return;
    // the timer on the first card counts while the app opens, and stops the
    // moment the code is on screen (kept in step with the CSS loop, 3.2s)
    var secs = m.querySelector('.m-secs'), raf = 0, t0 = 0;
    function tick(now) {
      var k = ((now - t0) % 3200) / 3200;
      var v = k < 0.1 ? 0 : Math.min(k, 0.3) - 0.1;
      secs.textContent = (v * 3.2 * 1.4).toFixed(1) + 's';
      secs.classList.toggle('done', k >= 0.3 && k < 0.9);
      raf = requestAnimationFrame(tick);
    }
    whenSeen(m, 0.3, function (v) {
      m.classList.toggle('in', v);
      cancelAnimationFrame(raf);
      if (v && !reduce && secs) { t0 = performance.now(); raf = requestAnimationFrame(tick); }
    });
  })();

  /* ---------- 8. next: a to-do list you can tick off ----------
     The rows fade in, then "Create prototype" ticks itself off, the strike
     draws through it and it slides down to the bottom (the others move up).
     The rest stay open; a visitor can tick any of them, and a ticked row
     goes to the bottom too. Unticking puts it back above the done ones. */
  (function () {
    var box = document.getElementById('todo');
    if (!box) return;
    var ul = box.querySelector('ul');
    var items = [].slice.call(ul.children);
    var played = false;

    // move a row and let every row glide from where it was (FLIP)
    function moveTo(li, before) {
      var rows = [].slice.call(ul.children);
      var first = rows.map(function (r) { return r.getBoundingClientRect().top; });
      ul.insertBefore(li, before || null);
      if (reduce) return;
      rows.forEach(function (r, k) {
        var dy = first[k] - r.getBoundingClientRect().top;
        if (!dy) return;
        r.style.transition = 'none';
        r.style.transform = 'translateY(' + dy + 'px)';
        void r.offsetWidth;
        r.style.transition = 'transform .55s cubic-bezier(.22, 1, .36, 1), opacity .4s ease';
        r.style.transform = '';
      });
    }
    function set(li, on) {
      li.classList.toggle('done', on);
      li.querySelector('.todo-row').setAttribute('aria-checked', on ? 'true' : 'false');
      clearTimeout(li._t);
      li._t = setTimeout(function () {
        if (on) moveTo(li, null);
        else moveTo(li, ul.querySelector('li.done'));
      }, reduce ? 0 : 600);
    }
    items.forEach(function (li) {
      li.querySelector('.todo-row').addEventListener('click', function () {
        set(li, !li.classList.contains('done'));
      });
    });

    whenSeen(box, 0.4, function (v) {
      if (!v || played) return;
      played = true;
      var gap = reduce ? 0 : 110;
      items.forEach(function (li, k) {
        setTimeout(function () { li.classList.add('in'); }, 120 + k * gap);
      });
      var auto = ul.querySelector('li[data-auto]');
      if (auto) setTimeout(function () { if (!auto.classList.contains('done')) set(auto, true); }, reduce ? 0 : 120 + items.length * gap + 650);
    });
  })();
  /* ---------- 6b. final design: screen recordings in the page's iPhone ---------- */
  // Each recording is Jen's own prototype capture. The video sits in the
  // phone's screen (cropped by CSS), the frame/island/status are added here
  // the same way buildPhone dresses the demo phones, and it only plays while
  // it's on screen, starting from the top each time it comes back.
  (function () {
    var arts = [].slice.call(document.querySelectorAll('.rec-demo'));
    arts.forEach(function (article) {
      var stage = article.querySelector('.demo-stage');
      var box = article.querySelector('.demo-phone');
      var phone = box.querySelector('.iphone');
      var video = phone.querySelector('video');
      var K = 393 / 416; // recorded screen is 416 px wide, ours is 393
      phone.style.setProperty('--rx', (-(+phone.getAttribute('data-x')) * K).toFixed(1) + 'px');
      phone.insertAdjacentHTML('beforeend',
        '<div class="island" aria-hidden="true"></div>' +
        '<div class="status" aria-hidden="true"><span>9:41</span>' + STATUS_ICONS + '</div>' +
        '<span class="btn l" style="top:118px;height:32px"></span>' +
        '<span class="btn l" style="top:178px;height:62px"></span>' +
        '<span class="btn l" style="top:252px;height:62px"></span>' +
        '<span class="btn r" style="top:206px;height:98px"></span>' +
        '<span class="btn r" style="top:470px;height:56px"></span>');
      function fit() {
        var W = stage.clientWidth, H = stage.clientHeight;
        var S = Math.min((H - 64) / FH, (W * 0.8) / FW);
        box.style.left = ((W - FW * S) / 2).toFixed(1) + 'px';
        box.style.top = ((H - FH * S) / 2).toFixed(1) + 'px';
        phone.style.transform = 'translate(' + (13 * S) + 'px,' + (13 * S) + 'px) scale(' + S + ')';
      }
      fit();
      window.addEventListener('resize', fit);
      whenSeen(stage, 0.5, function (v) {
        if (v) {
          try { video.currentTime = 0; } catch (e) {}
          if (!reduce) { var pr = video.play(); if (pr && pr.catch) pr.catch(function () {}); }
        } else {
          video.pause();
        }
      });
    });
  })();
})();
