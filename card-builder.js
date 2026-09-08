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

// The card keeps the shape every other card in the carousel has: the same
// photo box with the same folded-corner notch, the number sitting in that
// notch, and three tag pills on the bottom-right shelf. What it does not keep
// is anything printed in them — the box is empty and the number and tags are
// the visitor's to type.
//
// Geometry lifted from tmplPhotoClipPath / buildTemplateCardTexture in
// script.js, in the same 1059x1449 design units. If the cards there ever move,
// these move with them.
const CUTOUT = { x: 21, y: 20, w: 1016.663, h: 817 };
const SLOT_NUMBER = { x: 20.5, y: 17, w: 160, h: 54 };
const SLOT_PILL = { y: 1354, h: 68, w: 200, gap: 24, right: 21 };
const TAG_COUNT = 3;

// Where each pill sits, right-aligned to the same inset the photo box uses.
// Fixed widths rather than measured ones: these are inputs, and a pill that
// resized under the caret would shove its neighbours around mid-word.
function pillRect(i) {
    const total = TAG_COUNT * SLOT_PILL.w + (TAG_COUNT - 1) * SLOT_PILL.gap;
    const x0 = W - SLOT_PILL.right - total;
    return { x: x0 + i * (SLOT_PILL.w + SLOT_PILL.gap), y: SLOT_PILL.y,
             w: SLOT_PILL.w, h: SLOT_PILL.h };
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

// The photo box, with the folded corner at the top-left that the number sits
// in. A straight copy of tmplPhotoClipPath in script.js — it is not a simple
// arc: the notch rises from the left edge, holds briefly flat, then rises
// again into the diagonal and curves into the top edge.
function cutoutPath(ctx, x, y) {
    ctx.beginPath();
    ctx.moveTo(x + 992.662, y);
    ctx.bezierCurveTo(x + 1005.92, y, x + 1016.66, y + 10.7452, x + 1016.66, y + 24);
    ctx.lineTo(x + 1016.66, y + 793);
    ctx.bezierCurveTo(x + 1016.66, y + 806.255, x + 1005.92, y + 817, x + 992.662, y + 817);
    ctx.lineTo(x + 24, y + 817);
    ctx.bezierCurveTo(x + 10.7452, y + 817, x, y + 806.255, x, y + 793);
    ctx.lineTo(x, y + 111);
    ctx.bezierCurveTo(x, y + 78, x + 19.9, y + 58.5, x + 51.5, y + 58.5);
    ctx.lineTo(x + 117.932, y + 58.5);
    ctx.bezierCurveTo(x + 129.052, y + 58.5, x + 139.578, y + 53.4981, x + 146.604, y + 44.8789);
    ctx.lineTo(x + 167.294, y + 19.5);
    ctx.bezierCurveTo(x + 167.294, y + 19.5, x + 182, y, x + 210, y);
    ctx.closePath();
}

// Empty, because it is the visitor's to fill: the box tracks the stock rather
// than sitting on it as a bright slab, the same way a template card with no
// photo yet does.
function drawCutout(ctx, ink) {
    ctx.save();
    cutoutPath(ctx, CUTOUT.x, CUTOUT.y);
    ctx.fillStyle = ink;
    ctx.globalAlpha = theme() === 'dark' ? 0.10 : 0.055;
    ctx.fill();
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

function drawItems(ctx, model) {
    ctx.save();
    roundedRectPath(ctx, 0, 0, W, H, R);
    ctx.clip();
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

    let drawing = null;
    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        // Pointer capture, so a stroke that runs off the edge of the card keeps
        // following the pointer instead of stopping dead at the boundary.
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
        const r = canvas.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right
                  && e.clientY >= r.top  && e.clientY <= r.bottom;
        ghost.classList.toggle('is-over', over);
    }
    tray.addEventListener('pointermove', moveGhost);
    tray.addEventListener('pointerup', (e) => {
        if (!ghost) return;
        const r = canvas.getBoundingClientRect();
        const over = e.clientX >= r.left && e.clientX <= r.right
                  && e.clientY >= r.top  && e.clientY <= r.bottom;
        if (over) {
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
