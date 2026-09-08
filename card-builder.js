/* Make your own card.
   ---------------------------------------------------------------------------
   Everything the visitor makes is held in one plain object — the tool they are
   holding, and an ordered list of the marks and stickers they have put down.
   Nothing is drawn imperatively and then forgotten: the canvas is a pure
   function of that object, redrawn whenever it changes.

   That is what makes undo a single pop rather than a stack of inverse
   operations, and it is why the same draw() can paint the 300px card on screen
   and the full-resolution face that goes into the carousel — one code path, at
   whatever scale it is handed.

   The card itself is blank. No masthead, no border, no cord, no punched slot:
   the only marks on it are the visitor's own. */

// Design space. The same 1059x1449 frame every other card in the carousel
// uses, so a finished card can become a real card in the ring without being
// redrawn a third way.
const W = 1059;
const H = 1449;
const R = 44;               // corner radius, in design units

const THEME_PAPER = { light: '#F7F5F5', dark: '#373737' };

// The four tools. They differ in the character of the line rather than in what
// they can reach, so picking one never closes anything off.
export const BRUSHES = {
    pen:    { label: 'Pen' },
    dashed: { label: 'Dashed' },
    marker: { label: 'Marker' },
    pencil: { label: 'Pencil' },
};

// Seven inks. The first is the near-neutral the card starts on; the rest are
// deliberately soft, because a saturated primary on this paper reads as an
// error state rather than a choice.
export const COLORS = [
    '#8A93A6', '#F4756E', '#F7A85C', '#FADD6E', '#86DFA0', '#9EE9F2', '#BFA6F0',
];

export const STROKE_MIN = 4;
export const STROKE_MAX = 24;

// The sticker palette. The categories are the visitor's own facts, the way a
// conference badge collects them — which is the point of the thing.
export const STICKERS = {
    ROLE:       ['designer', 'engineer', 'student', 'founder', 'lurker'],
    'HERE FOR': ['the cards', 'the process', 'the type', 'a nose around'],
    PRONOUNS:   ['she/her', 'he/him', 'they/them', 'ask me'],
    FUEL:       ['matcha', 'coffee', 'guitar', 'dancing', 'no sleep'],
    MOOD:       ['first time', 'long time', 'day one', 'just browsing'],
};

// Sticker fills, cycled by position in the flattened list so the tray looks
// varied without the visitor having to choose a colour they do not care about.
const TONES = ['#C7D2FE', '#FFE27A', '#7FC8A9', '#F2A28C', '#C6B8F0'];

// The card takes card 0's full-bleed layout rather than the project cards'
// half-height photo well: the silhouette runs almost the whole face, with the
// same folded-corner notch at the top-left and the same shelf cut out of the
// bottom-right corner for the tag pills to sit on. A visitor handed a blank
// card should get the whole of it to draw on, not the top half of one.
//
// Both shapes are the same Figma nodes the About Me card uses —
// ABOUTME_PHOTO_MASK and ABOUTME_BOTTOM_CUT in script.js — in the same
// 1059x1449 design units. If the cards there ever move, these move with them.
const PHOTO_MASK = 'M1014 20C1027.25 20 1038 30.7452 1038 44V1400C1038 1413.25 1027.25 1424 1014 1424H45C31.7452 1424 21 1413.25 21 1400V131C21 98 40.9 78.5 72.5 78.5H138.932C150.052 78.5 160.578 73.4981 167.604 64.8789L188.294 39.5C188.294 39.5 203 20 231 20H1014Z';
const BOTTOM_CUT = 'M92.1527 105.785C39 105.785 19.571 132.5 19.571 170L0 83.7852L17.7362 11.0083L155.345 0L837 9.70899C802.751 9.70899 784.763 33.5602 784.763 33.5602L768.188 63.2673C754.411 87.96 728.41 103.32 700.134 103.432C556.671 103.997 124.699 105.785 92.1527 105.785Z';
// The shelf is kept in its node's own local coordinates; Figma places it by a
// 180° rotation, so local (x, y) lands at (1058 - x, 1434 - y).
const CUT_MATRIX = new DOMMatrix([-1, 0, 0, -1, 1058, 1434]);
// The silhouette's bounds, for anything that only needs the box.
const CUTOUT = { x: 21, y: 20, w: 1017, h: 1404 };
const SLOT_NUMBER = { x: 20.5, y: 17, w: 160, h: 54 };
// The tag row on the shelf, off the same Figma row card 0 uses (node 1122:55):
// 68 tall at y 1352, ending on the same 21px inset the photo does, 12px gaps.
// `w` is the whole row — pillRect divides it.
const SLOT_PILL = { x: 315, y: 1352, w: 723, h: 68, gap: 12 };
const TAG_COUNT = 3;

// Three equal pills across the row, rather than card 0's 153/280/266: those
// widths are cut to the words "NYU / TINKERER / DESIGNER", and these are empty
// boxes to type into. Fixed rather than measured for the same reason they are
// there — a pill that resized under the caret would shove its neighbours
// around mid-word.
function pillRect(i) {
    const w = (SLOT_PILL.w - (TAG_COUNT - 1) * SLOT_PILL.gap) / TAG_COUNT;
    return { x: SLOT_PILL.x + i * (w + SLOT_PILL.gap), y: SLOT_PILL.y,
             w, h: SLOT_PILL.h };
}

export const CARD_DESIGN = { W, H, R, CUTOUT, SLOT_NUMBER, SLOT_PILL, TAG_COUNT, pillRect };

function theme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function newModel() {
    return {
        brush: 'pen', color: COLORS[0], size: 8,
        number: '', tags: new Array(TAG_COUNT).fill(''),
        items: [],
    };
}

/* ── path helpers ────────────────────────────────────────────────────────── */

function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

function drawPaper(ctx) {
    ctx.save();
    roundedRectPath(ctx, 0, 0, W, H, R);
    ctx.clip();
    ctx.fillStyle = THEME_PAPER[theme()];
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

/* ── the drawing region ──────────────────────────────────────────────────── */
//
// Where the photo would have been: the silhouette, with the shelf taken out of
// it. This is the only part of the card that can be drawn on, so it is also
// the wash the empty card shows — one region, so the two can never disagree
// about where the edge is.
//
// Built once. Path2D is immutable once constructed, and these are handed to
// clip() on every pointer sample.
let _mask = null, _shelf = null, _notShelf = null;
function maskPath() {
    if (!_mask) _mask = new Path2D(PHOTO_MASK);
    return _mask;
}
function shelfPath() {
    if (!_shelf) { _shelf = new Path2D(); _shelf.addPath(new Path2D(BOTTOM_CUT), CUT_MATRIX); }
    return _shelf;
}
function notShelfPath() {
    if (!_notShelf) {
        _notShelf = new Path2D();
        _notShelf.rect(0, 0, W, H);
        _notShelf.addPath(shelfPath());
    }
    return _notShelf;
}

// Two intersecting clips rather than one even-odd path holding both subpaths.
// In the design the shelf is a cover, not a cutter: it is filled with the card
// stock and laid over the photo, and it overhangs the silhouette by ~20px on
// the right and bottom edges. Even-odd would count that overhang as inside and
// fill a sliver of wash back in outside the photo. Intersecting the mask with
// "the card, minus the shelf" cannot do that.
//
// Cutting the shelf out of the clip, rather than clipping to the whole
// silhouette and painting the shelf over the top afterwards: the latter looks
// the same on a finished card, but it makes ink vanish under the shelf while
// the visitor is still drawing the line, which reads as a bug rather than as
// an edge.
function clipRegion(ctx) {
    ctx.clip(maskPath());
    ctx.clip(notShelfPath(), 'evenodd');
}

// isPointInPath is evaluated in the context's current transform. drawCard puts
// its scale back when it is done, so the transform here is whatever the caller
// left — pinned to the identity so the design-space point and the design-space
// paths are being compared in the same units.
function inRegion(ctx, x, y) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const ok = ctx.isPointInPath(maskPath(), x, y)
            && !ctx.isPointInPath(shelfPath(), x, y);
    ctx.restore();
    return ok;
}

// Empty, because it is the visitor's to fill: the region tracks the stock
// rather than sitting on it as a bright slab, the same way a template card
// with no photo yet does.
function drawCutout(ctx, ink) {
    ctx.save();
    clipRegion(ctx);
    ctx.fillStyle = ink;
    ctx.globalAlpha = theme() === 'dark' ? 0.10 : 0.055;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
}

// The number and the tag pills. Skipped on the canvas the visitor is typing
// into — there the real <input>s are what they see, and painting the text
// underneath them would double every glyph.
function drawSlots(ctx, model, ink) {
    ctx.save();
    ctx.fillStyle = ink;
    ctx.font = 'italic 400 36px "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (model.number) {
        ctx.fillText(model.number, SLOT_NUMBER.x + SLOT_NUMBER.w / 2,
                     SLOT_NUMBER.y + SLOT_NUMBER.h / 2);
    }

    for (let i = 0; i < TAG_COUNT; i++) {
        const r = pillRect(i);
        ctx.beginPath();
        roundedRectPath(ctx, r.x, r.y, r.w, r.h, r.h / 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = ink;
        ctx.globalAlpha = 0.28;
        ctx.stroke();
        ctx.globalAlpha = 1;
        const label = (model.tags && model.tags[i]) || '';
        if (!label) continue;
        ctx.fillStyle = ink;
        ctx.font = '600 40px "DM Sans", system-ui, sans-serif';
        ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 2);
    }
    ctx.restore();
}

// Midpoint quadratics: pointer samples are coarse, and joining them with
// straight segments looks like it. Curving through the midpoints gives the
// smooth line a drawn mark is expected to have.
function strokePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last[0], last[1]);
}

function drawStroke(ctx, item) {
    const size = item.size;
    ctx.save();
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = size;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (item.brush === 'dashed') {
        // Scaled to the nib, so a fat dashed line reads as dashes rather than
        // as a solid line with occasional nicks in it.
        ctx.setLineDash([size * 0.2, size * 1.9]);
    } else if (item.brush === 'marker') {
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = size * 1.7;
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'bevel';
    }

    // A single tap is a dot, not a zero-length line — which most canvas
    // line caps refuse to render at all.
    if (item.pts.length < 2) {
        ctx.beginPath();
        ctx.arc(item.pts[0][0], item.pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
    }

    if (item.brush === 'pencil') {
        // Grain, cheaply: the same path drawn a few times, faint and nudged a
        // little each pass. Deterministic offsets rather than random ones,
        // because this redraws on every pointer sample and a random jitter
        // would make the finished line crawl.
        ctx.globalAlpha = 0.30;
        const nudge = [[0, 0], [0.6, -0.5], [-0.5, 0.6], [0.3, 0.4]];
        for (const [dx, dy] of nudge) {
            ctx.save();
            ctx.translate(dx * size * 0.18, dy * size * 0.18);
            strokePath(ctx, item.pts);
            ctx.stroke();
            ctx.restore();
        }
        ctx.restore();
        return;
    }

    strokePath(ctx, item.pts);
    ctx.stroke();
    ctx.restore();
}

// Pills are measured, not guessed: the same measurement decides where the
// sticker paints and what counts as a hit when it is dragged, so the two can
// never drift apart.
export function stickerBox(ctx, label) {
    ctx.save();
    ctx.font = '600 40px "DM Sans", system-ui, sans-serif';
    const w = ctx.measureText(label).width + 62;
    ctx.restore();
    return { w, h: 76 };
}

function drawSticker(ctx, item) {
    const { w, h } = stickerBox(ctx, item.label);
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rot);
    ctx.fillStyle = item.tone;
    roundedRectPath(ctx, -w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = '#232323';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#232323';
    ctx.font = '600 40px "DM Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(item.label, 0, 2);
    ctx.restore();
}

// Clipped to the drawing region, not to the card: ink belongs where the photo
// would have been and nowhere else. The region sits well inside the card's
// rounded corners, so this is also what keeps a stroke off them.
function drawItems(ctx, model) {
    ctx.save();
    clipRegion(ctx);
    for (const item of model.items) {
        if (item.type === 'stroke') drawStroke(ctx, item);
        else drawSticker(ctx, item);
    }
    ctx.restore();
}

const THEME_INK = { light: '#232323', dark: '#EDEDED' };

// One draw for the screen and for the carousel face, so the card in the ring
// is exactly the card that was made. `slots: false` leaves the number and tags
// unpainted, which is what the canvas being typed into wants — see drawSlots.
export function drawCard(ctx, model, scale, opts) {
    const ink = THEME_INK[theme()];
    ctx.save();
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, W, H);
    drawPaper(ctx);
    drawCutout(ctx, ink);
    drawItems(ctx, model);
    if (!opts || opts.slots !== false) drawSlots(ctx, model, ink);
    ctx.restore();
}

/* ── the kit ─────────────────────────────────────────────────────────────── */

function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else if (k === 'html') n.innerHTML = attrs[k];
        else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
}

// The four brush glyphs from the design: one stroke each, drawn in the tile so
// the tool is recognised by its line rather than by its name.
const BRUSH_WAVE = 'M4 22C9 22 10 11 16 11S23 22 28 11';
const BRUSH_GLYPH = {
    pen:    `<path d="${BRUSH_WAVE}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
    dashed: `<path d="${BRUSH_WAVE}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="1 5"/>`,
    marker: `<path d="${BRUSH_WAVE}" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/>`,
    pencil: `<path d="${BRUSH_WAVE}" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" opacity=".55"/>`,
};

export function mountCardBuilder(root) {
    const model = newModel();

    /* the card ---------------------------------------------------------- */
    const canvas = el('canvas', { class: 'cb-card' });
    const ctx = canvas.getContext('2d');

    // The number and the tags are real inputs sitting over the canvas, placed
    // in percentages of the design frame so they track the card at any size.
    // Everything else on the card is painted; only the things that are typed
    // into are DOM, because nothing else gives a caret and an IME for free.
    const pct = (v, of) => (v / of * 100) + '%';
    function slot(cls, rect, extra) {
        const n = el('input', Object.assign({
            class: cls, type: 'text', autocomplete: 'off', spellcheck: 'false',
        }, extra || {}));
        n.style.left = pct(rect.x, W);
        n.style.top = pct(rect.y, H);
        n.style.width = pct(rect.w, W);
        n.style.height = pct(rect.h, H);
        return n;
    }

    const numberInput = slot('cb-slot cb-slot--number', SLOT_NUMBER, {
        maxlength: '6', placeholder: '#001', 'aria-label': 'Card number',
    });
    numberInput.addEventListener('input', () => { model.number = numberInput.value; render(); });

    const tagInputs = [];
    const slotLayer = el('div', { class: 'cb-slots' }, [numberInput]);
    for (let i = 0; i < TAG_COUNT; i++) {
        const t = slot('cb-slot cb-slot--tag', pillRect(i), {
            maxlength: '14', placeholder: 'tag', 'aria-label': 'Tag ' + (i + 1),
        });
        t.addEventListener('input', () => { model.tags[i] = t.value; render(); });
        tagInputs.push(t);
        slotLayer.appendChild(t);
    }

    const clearBtn = el('button', { class: 'cb-btn cb-btn--quiet', type: 'button', text: 'Clear' });
    const saveBtn = el('button', { class: 'cb-btn cb-btn--primary', type: 'button', text: 'Save' });
    const stage = el('div', { class: 'cb-stage' }, [
        el('div', { class: 'cb-card-wrap' }, [canvas, slotLayer]),
        el('div', { class: 'cb-actions' }, [clearBtn, saveBtn]),
    ]);

    /* the draw panel ---------------------------------------------------- */
    const brushBtns = {};
    const brushRow = el('div', { class: 'cb-brushes' });
    Object.keys(BRUSHES).forEach((key) => {
        const b = el('button', {
            class: 'cb-brush', type: 'button', 'aria-label': BRUSHES[key].label,
            html: '<svg viewBox="0 0 32 32" width="32" height="32">' + BRUSH_GLYPH[key] + '</svg>',
        });
        b.addEventListener('click', () => { model.brush = key; syncTools(); });
        brushBtns[key] = b;
        brushRow.appendChild(b);
    });

    const colorBtns = [];
    const colorRow = el('div', { class: 'cb-colors' });
    COLORS.forEach((hex) => {
        const b = el('button', { class: 'cb-color', type: 'button', 'aria-label': hex });
        b.style.background = hex;
        b.addEventListener('click', () => { model.color = hex; syncTools(); });
        colorBtns.push(b);
        colorRow.appendChild(b);
    });

    const slider = el('input', {
        class: 'cb-slider', type: 'range',
        min: String(STROKE_MIN), max: String(STROKE_MAX), value: String(model.size),
        'aria-label': 'Stroke width',
    });
    slider.addEventListener('input', () => { model.size = Number(slider.value); });

    const drawPanel = el('section', { class: 'cb-panel' }, [
        el('h2', { class: 'cb-panel-title', text: 'Draw' }),
        brushRow,
        colorRow,
        el('p', { class: 'cb-field-label', text: 'Stroke width' }),
        el('div', { class: 'cb-slider-row' }, [
            el('span', { class: 'cb-slider-cap', text: STROKE_MIN + 'px' }),
            slider,
            el('span', { class: 'cb-slider-cap', text: STROKE_MAX + 'px' }),
        ]),
    ]);

    /* the sticker tray -------------------------------------------------- */
    const tray = el('div', { class: 'cb-tray' });
    let toneAt = 0;
    Object.keys(STICKERS).forEach((group) => {
        STICKERS[group].forEach((label) => {
            const tone = TONES[toneAt++ % TONES.length];
            const tile = el('button', {
                class: 'cb-sticker', type: 'button', text: label,
                'data-label': label, 'data-tone': tone,
                'aria-label': 'Add sticker: ' + label,
            });
            tile.style.setProperty('--tone', tone);
            tray.appendChild(tile);
        });
    });

    const stickerPanel = el('section', { class: 'cb-panel cb-panel--tray' }, [
        el('h2', { class: 'cb-panel-title', text: 'Stickers' }),
        el('p', { class: 'cb-panel-sub', text: 'Drag the stickers onto the card' }),
        tray,
    ]);

    const kit = el('div', { class: 'cb-kit' }, [drawPanel, stickerPanel]);
    root.textContent = '';
    root.appendChild(stage);
    root.appendChild(kit);

    /* sizing ------------------------------------------------------------ */
    //
    // The canvas backing store is the design frame times the device pixel
    // ratio; CSS decides how big it looks. Pointer coordinates are converted
    // through the element's own rect, so the two never need to agree on a
    // scale factor and a resize mid-drawing cannot shift what is already down.
    let dpr = 1;
    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        render();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function render() {
        // slots: false — the number and tags are the <input>s above, and
        // painting them here as well would double every glyph.
        drawCard(ctx, model, dpr, { slots: false });
        api.onChange(model);
    }

    function syncTools() {
        Object.keys(brushBtns).forEach((k) => {
            brushBtns[k].classList.toggle('is-on', k === model.brush);
        });
        colorBtns.forEach((b, i) => b.classList.toggle('is-on', COLORS[i] === model.color));
    }

    /* drawing on the card ----------------------------------------------- */
    //
    // Design-space coordinates, not CSS pixels: what is stored has to survive
    // the window being resized, and it has to mean the same thing when the
    // model is drawn again at carousel resolution.
    function atEvent(e) {
        const r = canvas.getBoundingClientRect();
        return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H];
    }

    // Over the part of the card that can be drawn on — the photo region, not
    // merely the canvas element.
    function overRegion(e) {
        const r = canvas.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right
         || e.clientY < r.top || e.clientY > r.bottom) return false;
        const [x, y] = atEvent(e);
        return inRegion(ctx, x, y);
    }

    let drawing = null;
    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        // A press on the margin or the shelf is not the start of anything. The
        // clip in drawItems is what actually confines the ink; this is so a
        // press out there does not leave an invisible stroke in the model for
        // Clear to have to account for.
        if (!overRegion(e)) return;
        // Pointer capture, so a stroke that runs off the edge of the region
        // keeps following the pointer instead of stopping dead at the boundary.
        canvas.setPointerCapture(e.pointerId);
        drawing = {
            type: 'stroke', brush: model.brush, color: model.color,
            size: model.size, pts: [atEvent(e)],
        };
        model.items.push(drawing);
        render();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (!drawing) return;
        drawing.pts.push(atEvent(e));
        render();
    });
    const endStroke = () => { if (drawing) { drawing = null; render(); } };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    /* dragging stickers onto the card ------------------------------------ */
    //
    // Pointer events rather than HTML5 drag-and-drop: the card is a canvas, so
    // there is no drop target to speak of, and drag-and-drop has no useful
    // touch story. A ghost follows the pointer and the sticker is committed
    // wherever it is let go, if that is over the card.
    let ghost = null, ghostTile = null;
    tray.addEventListener('pointerdown', (e) => {
        const tile = e.target.closest('.cb-sticker');
        if (!tile) return;
        e.preventDefault();
        tray.setPointerCapture(e.pointerId);
        ghostTile = tile;
        ghost = el('div', { class: 'cb-ghost', text: tile.dataset.label });
        ghost.style.setProperty('--tone', tile.dataset.tone);
        document.body.appendChild(ghost);
        moveGhost(e);
    });
    function moveGhost(e) {
        if (!ghost) return;
        ghost.style.left = e.clientX + 'px';
        ghost.style.top = e.clientY + 'px';
        // The region, not the element: a sticker let go over the shelf would be
        // clipped away to nothing, so the ghost must not promise otherwise.
        ghost.classList.toggle('is-over', overRegion(e));
    }
    tray.addEventListener('pointermove', moveGhost);
    tray.addEventListener('pointerup', (e) => {
        if (!ghost) return;
        if (overRegion(e)) {
            const [x, y] = atEvent(e);
            model.items.push({
                type: 'sticker', label: ghostTile.dataset.label,
                tone: ghostTile.dataset.tone, x, y,
                // A little off square, so a card full of them looks stuck on
                // by hand rather than laid out on a grid.
                rot: (Math.random() - 0.5) * 0.22,
            });
            render();
        }
        ghost.remove();
        ghost = null;
        ghostTile = null;
    });
    tray.addEventListener('pointercancel', () => {
        if (ghost) { ghost.remove(); ghost = null; ghostTile = null; }
    });

    // Clear takes the card back to blank — the marks and the typing both, since
    // the alternative is a "clear" that visibly leaves things behind.
    clearBtn.addEventListener('click', () => {
        model.items.length = 0;
        model.number = '';
        model.tags.fill('');
        numberInput.value = '';
        tagInputs.forEach((t) => { t.value = ''; });
        render();
    });
    saveBtn.addEventListener('click', () => api.onSave());

    const api = {
        model, canvas, render,
        // What the Save button means is the page's business, not the kit's:
        // here it is only the fact that it was pressed.
        onSave: () => {},
        // Fires on every change to the model, which is what the page above
        // listens to when it wants to keep the card in the carousel in step
        // with the one being drawn on.
        onChange: () => {},
        // The theme decides the card stock, and CSS cannot repaint a canvas.
        refresh: () => { syncTools(); render(); },
        // Replaces the whole model in place — the reference is handed out in
        // `api.model`, so it is refilled rather than reassigned.
        load: (saved) => {
            if (!saved || !Array.isArray(saved.items)) return;
            model.brush = BRUSHES[saved.brush] ? saved.brush : 'pen';
            model.color = COLORS.indexOf(saved.color) >= 0 ? saved.color : COLORS[0];
            model.size = Math.min(STROKE_MAX, Math.max(STROKE_MIN, Number(saved.size) || 8));
            // Snapshot first: `saved` may be an object whose arrays are these
            // arrays, in which case emptying them below would empty the source.
            const items = saved.items.slice();
            const tags = Array.isArray(saved.tags) ? saved.tags.slice() : [];
            model.items.length = 0;
            items.forEach((it) => model.items.push(it));
            model.number = typeof saved.number === 'string' ? saved.number : '';
            for (let i = 0; i < TAG_COUNT; i++) {
                model.tags[i] = typeof tags[i] === 'string' ? tags[i] : '';
            }
            numberInput.value = model.number;
            tagInputs.forEach((t, i) => { t.value = model.tags[i]; });
            slider.value = String(model.size);
            syncTools();
            render();
        },
        destroy: () => { ro.disconnect(); if (ghost) ghost.remove(); root.textContent = ''; },
    };

    syncTools();
    resize();
    return api;
}
