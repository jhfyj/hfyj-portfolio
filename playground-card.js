/* Live felt inside the home Playground card.
   ---------------------------------------------------------------------------
   The carousel card is not a photograph of the table. This is the table:
   the same #felt / #surface / WebGL grass the playground page uses, plus
   the dyed name and the rim pieces, clipped and scaled to sit inside the
   card's well. Clicking that card expands this cloth to full span — the
   destination page continues the same layer, not a JPEG of it.

   The five-card hand is not here. Those arrive after the felt has landed. */
(function () {
    'use strict';

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var CHIP_W = 52;

    var felt = document.getElementById('felt');
    var surface = document.getElementById('surface');
    var fanEl = document.getElementById('fan');
    var playedEl = document.getElementById('played');
    if (!felt || !surface || !fanEl || !playedEl) return;

    // The card is a cover, not a window onto wherever the table was left.
    // Sketchbook.html still restores the last pan; dice.js must not replay
    // those coordinates here or the cubes land outside this opening.
    window.__playgroundScene = null;
    try { localStorage.removeItem('hfyj:playground-cover'); } catch (err) {}

    var pan = { x: 0, y: 0 };

    function applyPan() {
        surface.style.setProperty('--px', Math.round(pan.x) + 'px');
        surface.style.setProperty('--py', Math.round(pan.y) + 'px');
    }

    function sizeSurface() {
        // The cover is the well, not a cropped table. Matching the opening
        // keeps the albedo over the whole hole and skips the 1920×720
        // canvas that was fighting the carousel for a GPU context.
        var w = Math.max(1, felt.clientWidth);
        var h = Math.max(1, felt.clientHeight);
        surface.style.width = w + 'px';
        surface.style.height = h + 'px';
    }

    function centrePan() {
        pan.x = 0;
        pan.y = 0;
        applyPan();
    }

    function dyeSpans(mark) {
        var srNow = surface.getBoundingClientRect();
        var k = srNow.width / (surface.offsetWidth || srNow.width || 1);
        if (!k) k = 1;
        var spans = mark.querySelectorAll('.mat-title, .mat-tag');
        for (var i = 0; i < spans.length; i++) {
            var box = spans[i].getBoundingClientRect();
            spans[i].style.backgroundPosition =
                Math.round(-(box.left - srNow.left) / k) + 'px '
                + Math.round(-(box.top - srNow.top) / k) + 'px';
        }
    }

    function placeMatMark() {
        var mark = document.getElementById('table-heading');
        if (!mark) return;
        // Layout boxes, not getBoundingClientRect: the home card scales #felt
        // with a transform, and screen rects would mix with local left/top.
        // Centre the name in the opening so height-fill still reads it.
        var viewX = -pan.x;
        var viewY = -pan.y;
        var cx = viewX + felt.clientWidth / 2;
        var cy = viewY + felt.clientHeight / 2;
        mark.classList.add('is-placed');
        mark.style.left = Math.round(cx - mark.offsetWidth / 2) + 'px';
        mark.style.top = Math.round(cy - mark.offsetHeight / 2) + 'px';
        dyeSpans(mark);
    }

    function buildChip() {
        var wrap = document.createElement('div');
        wrap.className = 'chip';
        wrap.setAttribute('aria-hidden', 'true');
        wrap.style.setProperty('--chip-w', CHIP_W + 'px');

        var cast = document.createElement('div');
        cast.className = 'chip-cast';
        var disc = document.createElement('div');
        disc.className = 'chip-cast-disc';
        cast.appendChild(disc);
        wrap.appendChild(cast);

        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.style.pointerEvents = 'none';
        function circle(r, fill, stroke, width, dash, opacity) {
            var c = document.createElementNS(SVG_NS, 'circle');
            c.setAttribute('cx', '50');
            c.setAttribute('cy', '50');
            c.setAttribute('r', String(r));
            c.setAttribute('fill', fill || 'none');
            if (stroke) {
                c.setAttribute('stroke', stroke);
                c.setAttribute('stroke-width', String(width));
            }
            if (dash) c.setAttribute('stroke-dasharray', dash);
            if (opacity) c.setAttribute('opacity', String(opacity));
            svg.appendChild(c);
        }
        circle(49, 'var(--accent)');
        circle(43, null, 'var(--felt)', 12, '19 26.03');
        circle(33, null, 'var(--felt)', 2, null, 0.5);
        circle(17, 'var(--felt)', null, null, null, 0.92);
        wrap.appendChild(svg);
        return wrap;
    }

    function visibleOpening(pad) {
        // Layout boxes, not screen rects: the well is warped onto the card
        // with a matrix3d, and getBoundingClientRect would be the AABB of
        // that quad — chips would land outside the opening you can see.
        var feltW = felt.clientWidth;
        var feltH = felt.clientHeight;
        var well = felt.parentElement;
        var wellW = well && well.clientWidth > 0 ? well.clientWidth : feltW;
        var wellH = well && well.clientHeight > 0 ? well.clientHeight : feltH;
        var scale = feltH ? wellH / feltH : 1;
        var visW = scale ? wellW / scale : feltW;
        var x0 = (feltW - visW) / 2;
        return {
            x: -pan.x + x0 + pad,
            y: -pan.y + pad,
            w: Math.max(pad, visW - pad * 2),
            h: Math.max(pad * 2, feltH - pad * 2)
        };
    }

    function placeChips() {
        var mark = document.getElementById('table-heading');
        var pad = 28;
        var keep = mark && mark.offsetWidth
            ? {
                x: (parseFloat(mark.style.left) || 0) - pad,
                y: (parseFloat(mark.style.top) || 0) - pad,
                w: mark.offsetWidth + pad * 2,
                h: mark.offsetHeight + pad * 2
            }
            : {
                x: felt.clientWidth * 0.22,
                y: felt.clientHeight * 0.28,
                w: felt.clientWidth * 0.56,
                h: felt.clientHeight * 0.36
            };
        var seats = [
            { x: keep.x - CHIP_W - 18, y: keep.y + keep.h * 0.35 },
            { x: keep.x + keep.w + 18, y: keep.y + keep.h * 0.2 }
        ];
        for (var c = 0; c < seats.length; c++) {
            var chip2 = buildChip();
            var x = Math.max(8, Math.min(seats[c].x, surface.offsetWidth - CHIP_W - 8));
            var y = Math.max(8, Math.min(seats[c].y, surface.offsetHeight - CHIP_W - 8));
            chip2.style.left = Math.round(x) + 'px';
            chip2.style.top = Math.round(y) + 'px';
            chip2.style.setProperty('--chip-rot', Math.round(Math.random() * 360) + 'deg');
            surface.insertBefore(chip2, playedEl);
        }
    }

    var chipsPlaced = false;

    function layout() {
        if (felt.clientWidth < 40) return;
        sizeSurface();
        // Always the middle of the cloth: a saved sketchbook pan would put
        // the name off the well, and the cover would read as a crop of a
        // table rather than as the card.
        centrePan();
        placeMatMark();
        if (!chipsPlaced) {
            placeChips();
            chipsPlaced = true;
            window.__playgroundMatReady = true;
        }
    }

    window.PlaygroundCard = { layout: layout };

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { placeMatMark(); }).catch(function () {});
    }

    // Do not lay chips or mark the mat ready while the well is parked
    // off-screen. script.js calls layout the first time the face is shown.
})();
