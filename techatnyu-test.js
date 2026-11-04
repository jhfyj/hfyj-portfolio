// tech@nyu redesign (test page): count the impact numbers up once, as they arrive.
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var fmt = function (n, dec) { return dec ? n.toFixed(dec) : Math.round(n).toLocaleString('en-US'); };

    document.querySelectorAll('.count').forEach(function (el) {
        var to = parseFloat(el.dataset.to), pre = el.dataset.pre || '', dec = +el.dataset.dec || 0, done = false;
        var io = new IntersectionObserver(function (es) {
            es.forEach(function (e) {
                if (!e.isIntersecting || done) return;
                done = true;
                io.disconnect();
                if (reduce) { el.textContent = pre + fmt(to, dec); return; }
                var t0 = performance.now(), dur = 1300;
                (function tick(now) {
                    var k = Math.min(1, (now - t0) / dur);
                    k = 1 - Math.pow(1 - k, 3);
                    el.textContent = pre + fmt(to * k, dec);
                    if (k < 1) requestAnimationFrame(tick);
                })(t0);
            });
        }, { threshold: 0.6 });
        io.observe(el);
    });
})();
