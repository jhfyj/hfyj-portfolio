/* Make your own card.
   ---------------------------------------------------------------------------
   Everything the visitor makes is held in one plain object — paper, border,
   cord, and an ordered list of the things they have put on the card. Nothing
   is drawn imperatively and then forgotten: the canvas is a pure function of
   that object, redrawn whenever it changes.

   That is what makes undo a single pop rather than a stack of inverse
   operations, and it is why "I'm done" can hand back a full-resolution export
   without a second code path — the same draw() runs at whatever scale it is
   given. The carousel's own card faces are built the same way (see
   buildTemplateCardTexture in script.js), so a finished card can become a real
   card in the ring without being redrawn a third way. */

// Design space. The card itself is the same 1059x1449 frame every other card
// in the carousel uses; the canvas is taller only to leave the cord somewhere
// to hang from, above the card rather than printed on it.
const W = 1059;
const CORD_H = 190;
const CARD = { x: 0, y: CORD_H, w: 1059, h: 1449 };
const H = CORD_H + CARD.h;
const R = 44;               // the card's corner radius, in design units

export const PAPER = { plain: 'Plain', dots: 'Dots', checker: 'Checker' };
export const BORDERS = { none: 'None', dashed: 'Dashed', wiggly: 'Wiggly' };
// Cord colours are named for what they look like rather than by hex, so the
// swatch caption and the model agree without a second lookup table.
export const CORDS = {
    ink:    { label: 'Ink',    hex: '#2B2B2B' },
    indigo: { label: 'Indigo', hex: '#5E81E2' },
    coral:  { label: 'Coral',  hex: '#F2795B' },
};
export const BRUSHES = { fine: 5, medium: 11, bold: 20 };
export const TONES = ['#C7D2FE', '#FFE27A', '#7FC8A9', '#F2A28C', '#C6B8F0'];

// The sticker palette. The categories are the visitor's own facts, the way a
// conference badge collects them — which is the point of the thing.
export const STICKERS = {
    ROLE:       ['designer', 'engineer', 'student', 'founder', 'lurker'],
    'HERE FOR': ['the cards', 'the process', 'the type', 'a nose around'],
    PRONOUNS:   ['she/her', 'he/him', 'they/them', 'ask me'],
    FUEL:       ['matcha', 'coffee', 'guitar', 'dancing', 'no sleep'],
    MOOD:       ['first time', 'long time', 'day one', 'just browsing'],
};

const THEME_PAPER = { light: '#F7F5F5', dark: '#373737' };
const THEME_INK   = { light: '#232323', dark: '#EDEDED' };

export const CARD_DESIGN = { W, H, CARD, CORD_H };

function theme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function newModel() {
    return { paper: 'plain', border: 'dashed', cord: 'indigo', brush: 'medium', items: [] };
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

function cornerPt(cx, cy, r, a0, k) {
    const a = a0 + k * (Math.PI / 2);
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
}

// Point and outward normal at fraction t along a rounded rect's perimeter.
function perimeterPoint(x, y, w, h, r, t) {
    const sw = w - 2 * r, sh = h - 2 * r, arc = (Math.PI / 2) * r;
    const segs = [
        { len: sw,  f: (u) => ({ x: x + r + u, y: y, nx: 0, ny: -1 }) },
        { len: arc, f: (u) => cornerPt(x + w - r, y + r, r, -Math.PI / 2, u / arc) },
        { len: sh,  f: (u) => ({ x: x + w, y: y + r + u, nx: 1, ny: 0 }) },
        { len: arc, f: (u) => cornerPt(x + w - r, y + h - r, r, 0, u / arc) },
        { len: sw,  f: (u) => ({ x: x + w - r - u, y: y + h, nx: 0, ny: 1 }) },
        { len: arc, f: (u) => cornerPt(x + r, y + h - r, r, Math.PI / 2, u / arc) },
        { len: sh,  f: (u) => ({ x: x, y: y + h - r - u, nx: -1, ny: 0 }) },
        { len: arc, f: (u) => cornerPt(x + r, y + r, r, Math.PI, u / arc) },
    ];
    let d = t * segs.reduce((a, s) => a + s.len, 0);
    for (const s of segs) {
        if (d <= s.len) return s.f(d);
        d -= s.len;
    }
    return segs[0].f(0);
}

// A wobbling rounded rectangle. Walking the perimeter and pushing each step
// sideways by a sine gives a line that reads as hand-drawn without needing a
// second set of coordinates for every corner.
function wigglyRectPath(ctx, x, y, w, h, r, amp, waves) {
    const per = 2 * (w + h) - 8 * r + 2 * Math.PI * r;
    const steps = Math.max(240, Math.round(per / 6));
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = perimeterPoint(x, y, w, h, r, t);
        const off = Math.sin(t * Math.PI * 2 * waves) * amp;
        const px = p.x + p.nx * off, py = p.y + p.ny * off;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

function drawPaper(ctx, model, ink) {
    ctx.save();
    roundedRectPath(ctx, CARD.x, CARD.y, CARD.w, CARD.h, R);
    ctx.clip();
    ctx.fillStyle = THEME_PAPER[theme()];
    ctx.fillRect(CARD.x, CARD.y, CARD.w, CARD.h);

    if (model.paper === 'dots') {
        ctx.fillStyle = ink;
        ctx.globalAlpha = 0.16;
        const step = 46;
        for (let gy = CARD.y + step; gy < CARD.y + CARD.h; gy += step)
            for (let gx = step; gx < CARD.w; gx += step) {
                ctx.beginPath(); ctx.arc(gx, gy, 3.5, 0, Math.PI * 2); ctx.fill();
            }
    } else if (model.paper === 'checker') {
        // Tied to the cord colour rather than a fourth palette: one choice
        // moving two things keeps the card looking designed rather than
        // assembled out of unrelated parts.
        ctx.fillStyle = CORDS[model.cord].hex;
        ctx.globalAlpha = 0.20;
        const cell = 74;
        for (let row = 0; row * cell < CARD.h; row++)
            for (let col = 0; col * cell < CARD.w; col++)
                if ((row + col) % 2 === 0) ctx.fillRect(col * cell, CARD.y + row * cell, cell, cell);
    }
    ctx.restore();
}

function drawBorder(ctx, model, ink) {
    if (model.border === 'none') return;
    const inset = 34;
    ctx.save();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    if (model.border === 'dashed') {
        ctx.setLineDash([26, 20]);
        roundedRectPath(ctx, CARD.x + inset, CARD.y + inset, CARD.w - inset * 2, CARD.h - inset * 2, R - 14);
    } else {
        wigglyRectPath(ctx, CARD.x + inset, CARD.y + inset, CARD.w - inset * 2, CARD.h - inset * 2, R - 14, 7, 58);
    }
    ctx.stroke();
    ctx.restore();
}

// The cord is drawn first and the card's paper goes over it, so its two ends
// disappear behind the card's top edge; a short segment is painted back across
// the slot afterwards (see drawSlot) and the whole thing reads as threaded
// through rather than resting on top.
const CORD_SPAN = 58;      // half the distance between the cord's two ends

function drawCord(ctx, model) {
    const cx = W / 2, endY = CARD.y + 100;
    ctx.save();
    ctx.strokeStyle = CORDS[model.cord].hex;
    ctx.lineWidth = 19;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - CORD_SPAN, endY);
    ctx.bezierCurveTo(cx - CORD_SPAN - 4, CORD_H * 0.34, cx - 44, 12, cx, 12);
    ctx.bezierCurveTo(cx + 44, 12, cx + CORD_SPAN + 4, CORD_H * 0.34, cx + CORD_SPAN, endY);
    ctx.stroke();
    ctx.restore();
}

// The card floats a little off the page, the way the carousel's cards do. Drawn
// under the paper rather than as a CSS shadow because the canvas extends above
// the card and a box-shadow would trace that empty strip as well.
function drawCardShadow(ctx) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.20)';
    ctx.shadowBlur = 54;
    ctx.shadowOffsetY = 22;
    ctx.fillStyle = '#000';
    roundedRectPath(ctx, CARD.x + 6, CARD.y + 6, CARD.w - 12, CARD.h - 12, R);
    ctx.fill();
    ctx.restore();
}

function drawSlot(ctx, model, ink) {
    const cx = W / 2, slotY = CARD.y + 74, slotW = 178, slotH = 24;
    ctx.save();
    ctx.fillStyle = theme() === 'dark' ? '#1C1C1C' : '#E4E1E1';
    roundedRectPath(ctx, cx - slotW / 2, slotY, slotW, slotH, slotH / 2);
    ctx.fill();
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // The bit of cord you would see through the punched slot. Clipped to the
    // slot so it cannot spill over the card either side of it.
    roundedRectPath(ctx, cx - slotW / 2, slotY, slotW, slotH, slotH / 2);
    ctx.clip();
    ctx.strokeStyle = CORDS[model.cord].hex;
    ctx.lineWidth = 19;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(cx - CORD_SPAN, slotY - 20);
    ctx.lineTo(cx - CORD_SPAN, slotY + slotH + 20);
    ctx.moveTo(cx + CORD_SPAN, slotY - 20);
    ctx.lineTo(cx + CORD_SPAN, slotY + slotH + 20);
    ctx.stroke();
    ctx.restore();
}

// The masthead is the one part the visitor does not control, because it is
// what makes the finished thing a card from this site rather than a blank.
function drawMasthead(ctx, ink) {
    const y = CARD.y + 152, h = 128;
    ctx.save();
    ctx.font = '700 82px Play, "DM Sans", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const nameW = ctx.measureText('HFYJ').width + 76;
    const yearW = ctx.measureText('2026').width + 76;
    const gap = 18;
    const x0 = (W - (nameW + gap + yearW)) / 2;

    ctx.fillStyle = ink;
    roundedRectPath(ctx, x0, y, nameW, h, h / 2.6);
    ctx.fill();
    ctx.fillStyle = THEME_PAPER[theme()];
    ctx.fillText('HFYJ', x0 + nameW / 2, y + h / 2 + 3);

    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    roundedRectPath(ctx, x0 + nameW + gap, y, yearW, h, h / 2.6);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.fillText('2026', x0 + nameW + gap + yearW / 2, y + h / 2 + 3);
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

function drawItems(ctx, model, ink) {
    ctx.save();
    roundedRectPath(ctx, CARD.x, CARD.y, CARD.w, CARD.h, R);
    ctx.clip();
    for (const item of model.items) {
        if (item.type === 'stroke') {
            ctx.strokeStyle = ink;
            ctx.fillStyle = ink;
            ctx.lineWidth = item.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (item.pts.length < 2) {
                ctx.beginPath();
                ctx.arc(item.pts[0][0], item.pts[0][1], item.size / 2, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
            // Midpoint quadratics: pointer samples are coarse, and joining them
            // with straight segments looks like it. Curving through the
            // midpoints gives the smooth line a drawn mark is expected to have.
            ctx.beginPath();
            ctx.moveTo(item.pts[0][0], item.pts[0][1]);
            for (let i = 1; i < item.pts.length - 1; i++) {
                const [ax, ay] = item.pts[i], [bx, by] = item.pts[i + 1];
                ctx.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
            }
            const last = item.pts[item.pts.length - 1];
            ctx.lineTo(last[0], last[1]);
            ctx.stroke();
        } else {
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
    }
    ctx.restore();
}

// One draw for the screen and for the export, so what is downloaded is exactly
// what was on screen.
export function drawCard(ctx, model, scale) {
    const ink = THEME_INK[theme()];
    ctx.save();
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, W, H);
    drawCardShadow(ctx);
    drawCord(ctx, model);
    drawPaper(ctx, model, ink);
    drawSlot(ctx, model, ink);
    drawBorder(ctx, model, ink);
    drawMasthead(ctx, ink);
    drawItems(ctx, model, ink);
    ctx.restore();
}

/* ── the kit ─────────────────────────────────────────────────────────────── */

function el(tag, attrs, kids) {
    const n = document.createElement(tag);
    for (const k in (attrs || {})) {
        if (k === 'class') n.className = attrs[k];
        else if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach((c) => n.appendChild(c));
    return n;
}

// A row of labelled choices that all write the same key on the model. The
// preview inside each swatch is drawn by the caller, because what makes a
// paper or a cord recognisable is not something a generic control can know.
function swatchGroup(title, keys, labelOf, previewOf, get, set) {
    const boxes = [];
    const row = el('div', { class: 'cb-swatches' });
    keys.forEach((key) => {
        const box = el('span', { class: 'cb-swatch-box' });
        const prev = previewOf(key);
        if (prev) box.appendChild(prev);
        const btn = el('button', {
            class: 'cb-swatch', type: 'button', 'aria-pressed': 'false', 'data-key': key,
        }, [box, el('span', { text: labelOf(key) })]);
        btn.addEventListener('click', () => { set(key); sync(); });
        boxes.push(btn);
        row.appendChild(btn);
    });
    function sync() {
        boxes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.key === get())));
    }
    sync();
    return { node: el('section', { class: 'cb-group' }, [el('h3', { text: title }), row]), sync };
}

function styled(css) {
    const s = el('span');
    s.setAttribute('style', css);
    return s;
}

function paperPreview(key) {
    const s = styled('display:block;width:100%;height:100%;background:var(--cb-stock)');
    if (key === 'dots') {
        s.style.backgroundImage = 'radial-gradient(color-mix(in srgb, var(--cb-ink) 45%, transparent) 1.1px, transparent 1.2px)';
        s.style.backgroundSize = '8px 8px';
    } else if (key === 'checker') {
        s.style.backgroundImage =
            'linear-gradient(45deg,#C7D2FE 25%,transparent 25%,transparent 75%,#C7D2FE 75%),' +
            'linear-gradient(45deg,#C7D2FE 25%,transparent 25%,transparent 75%,#C7D2FE 75%)';
        s.style.backgroundSize = '14px 14px';
        s.style.backgroundPosition = '0 0, 7px 7px';
    }
    return s;
}

function borderPreview(key) {
    const s = styled('display:block;width:100%;height:100%;background:var(--cb-stock);position:relative');
    if (key === 'none') return s;
    const style = key === 'dashed' ? 'dashed' : 'solid';
    const inner = styled('position:absolute;inset:7px;border-radius:4px;border:1.5px ' + style + ' var(--cb-ink)');
    // "Wiggly" is not a border-style, so the preview shows what the option
    // actually produces — a wavy edge — rather than a straight one mislabelled.
    if (key === 'wiggly') inner.style.borderRadius = '40% 60% 45% 55% / 55% 45% 60% 40%';
    s.appendChild(inner);
    return s;
}

function cordPreview(key) {
    const s = styled('display:block;width:100%;height:100%;background:var(--cb-stock);position:relative');
    s.appendChild(styled(
        'position:absolute;left:50%;top:7px;width:22px;height:22px;margin-left:-11px;' +
        'border-radius:50% 50% 0 0;border:5px solid ' + CORDS[key].hex + ';border-bottom:0'));
    return s;
}

function brushPreview(key) {
    const d = BRUSHES[key] * 0.9 + 3;
    const s = styled('display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:var(--cb-stock)');
    s.appendChild(styled('display:block;border-radius:50%;background:var(--cb-ink);width:' + d + 'px;height:' + d + 'px'));
    return s;
}

export function mountCardBuilder(root) {
    const model = newModel();
    const canvas = el('canvas', { class: 'cb-card' });
    const ctx = canvas.getContext('2d');
    const wrap = el('div', { class: 'cb-card-wrap' }, [canvas]);

    const backBtn = el('button', { class: 'cb-btn', type: 'button', text: 'Back' });
    const undoBtn = el('button', { class: 'cb-btn', type: 'button', text: 'Undo' });
    const clearBtn = el('button', { class: 'cb-btn', type: 'button', text: 'Clear' });
    const doneBtn = el('button', { class: 'cb-btn cb-btn--primary', type: 'button', text: 'Save my card' });
    const stage = el('div', { class: 'cb-stage' }, [
        wrap, el('div', { class: 'cb-actions' }, [backBtn, undoBtn, clearBtn, doneBtn]),
    ]);

    const groups = [];
    const kit = el('div', { class: 'cb-kit' }, [
        el('div', { class: 'cb-kit-head' }, [
            el('h2', { text: 'Make it yours' }),
            el('p', { text: 'Pick your paper, thread a cord, sign it, stick on whatever fits.' }),
        ]),
    ]);
    const add = (g) => { groups.push(g); kit.appendChild(g.node); };
    const cap = (k) => k[0].toUpperCase() + k.slice(1);

    add(swatchGroup('Paper', Object.keys(PAPER), (k) => PAPER[k], paperPreview,
        () => model.paper, (k) => { model.paper = k; render(); }));
    add(swatchGroup('Border', Object.keys(BORDERS), (k) => BORDERS[k], borderPreview,
        () => model.border, (k) => { model.border = k; render(); }));
    add(swatchGroup('Cord', Object.keys(CORDS), (k) => CORDS[k].label, cordPreview,
        () => model.cord, (k) => { model.cord = k; render(); }));
    add(swatchGroup('Draw', Object.keys(BRUSHES), cap, brushPreview,
        () => model.brush, (k) => { model.brush = k; }));

    // Stickers: tabs over a palette. One category at a time, because all five
    // at once is a wall of pills nobody reads.
    const tabs = el('div', { class: 'cb-tabs', role: 'tablist' });
    const palette = el('div', { class: 'cb-palette' });
    const cats = Object.keys(STICKERS);
    let activeCat = cats[0];
    cats.forEach((cat) => {
        const t = el('button', {
            class: 'cb-tab', type: 'button', role: 'tab', text: cat,
            'aria-selected': 'false', 'data-cat': cat,
        });
        t.addEventListener('click', () => { activeCat = cat; syncStickers(); });
        tabs.appendChild(t);
    });
    function syncStickers() {
        [...tabs.children].forEach((t) => t.setAttribute('aria-selected', String(t.dataset.cat === activeCat)));
        palette.textContent = '';
        STICKERS[activeCat].forEach((label, i) => {
            const tone = TONES[i % TONES.length];
            const b = el('button', { class: 'cb-sticker', type: 'button', text: label });
            b.style.background = tone;
            b.addEventListener('click', () => placeSticker(label, tone));
            palette.appendChild(b);
        });
    }
    syncStickers();
    kit.appendChild(el('section', { class: 'cb-group' }, [
        el('h3', { text: 'Stickers' }), tabs, palette,
        el('p', { class: 'cb-hint', text: 'Tap to add, then drag it around the card. Drag anywhere else to draw.' }),
    ]));

    root.appendChild(stage);
    root.appendChild(kit);

    /* ── canvas sizing ───────────────────────────────────────────────────── */

    // The canvas is a fixed design-space drawing scaled to whatever room the
    // layout gave it, so nothing in draw() ever has to know the display size.
    // Re-measured on resize because the left pane is fluid.
    let scale = 1;
    function resize() {
        const r = wrap.getBoundingClientRect();
        if (!r.width) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        scale = (r.width / CARD_DESIGN.W) * dpr;
        canvas.width = Math.round(CARD_DESIGN.W * scale);
        canvas.height = Math.round(CARD_DESIGN.H * scale);
        render();
    }
    // Watching the wrapper rather than the window catches the layout changing
    // for reasons the window never hears about — the kit growing a scrollbar,
    // the overlay opening for the first time.
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    function render() {
        if (raf) return;         // several control changes in one turn still cost one draw
        raf = requestAnimationFrame(() => {
            raf = 0;
            drawCard(ctx, model, scale);
            undoBtn.disabled = clearBtn.disabled = model.items.length === 0;
        });
    }

    /* ── pointer ─────────────────────────────────────────────────────────── */

    // Screen point to design point. Everything stored on the model is in design
    // space, so a card made in a small window is the same card in a large one.
    function toDesign(ev) {
        const r = canvas.getBoundingClientRect();
        return {
            x: ((ev.clientX - r.left) / r.width) * CARD_DESIGN.W,
            y: ((ev.clientY - r.top) / r.height) * CARD_DESIGN.H,
        };
    }

    // Hit-test in the sticker's own rotated frame: undo the rotation about its
    // centre and the test is an ordinary box again. Walked back to front so the
    // sticker on top is the one that answers.
    function stickerAt(p) {
        for (let i = model.items.length - 1; i >= 0; i--) {
            const it = model.items[i];
            if (it.type !== 'sticker') continue;
            const { w, h } = stickerBox(ctx, it.label);
            const dx = p.x - it.x, dy = p.y - it.y;
            const c = Math.cos(-it.rot), s = Math.sin(-it.rot);
            if (Math.abs(dx * c - dy * s) <= w / 2 && Math.abs(dx * s + dy * c) <= h / 2) return i;
        }
        return -1;
    }

    // New stickers land down the middle of the free area rather than all on one
    // spot, so adding several in a row does not bury them in a single stack.
    let placed = 0;
    function placeSticker(label, tone) {
        const step = (placed++ % 6);
        model.items.push({
            type: 'sticker', label, tone,
            x: CARD_DESIGN.W * (step % 2 === 0 ? 0.36 : 0.64),
            y: CARD_DESIGN.CARD.y + 480 + step * 118,
            rot: (Math.random() - 0.5) * 0.18,
        });
        render();
    }

    let drag = null;
    canvas.addEventListener('pointerdown', (ev) => {
        const p = toDesign(ev);
        const hit = stickerAt(p);
        canvas.setPointerCapture(ev.pointerId);
        if (hit >= 0) {
            // Dragging also raises it: the one being moved should end up on top
            // of whatever it is moved over.
            const [it] = model.items.splice(hit, 1);
            model.items.push(it);
            drag = { kind: 'sticker', item: it, dx: it.x - p.x, dy: it.y - p.y };
            canvas.classList.add('cb-dragging');
        } else {
            const stroke = { type: 'stroke', size: BRUSHES[model.brush], pts: [[p.x, p.y]] };
            model.items.push(stroke);
            drag = { kind: 'stroke', item: stroke };
        }
        render();
    });
    canvas.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const p = toDesign(ev);
        if (drag.kind === 'sticker') { drag.item.x = p.x + drag.dx; drag.item.y = p.y + drag.dy; }
        else drag.item.pts.push([p.x, p.y]);
        render();
    });
    const endDrag = () => { drag = null; canvas.classList.remove('cb-dragging'); };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    /* ── actions ─────────────────────────────────────────────────────────── */

    undoBtn.addEventListener('click', () => { model.items.pop(); render(); });
    clearBtn.addEventListener('click', () => { model.items.length = 0; placed = 0; render(); });

    // Exported at a fixed 2x of the design rather than at whatever the window
    // happened to be, so the file a visitor keeps does not depend on the size
    // of the browser they made it in.
    doneBtn.addEventListener('click', () => {
        const out = document.createElement('canvas');
        out.width = CARD_DESIGN.W * 2;
        out.height = CARD_DESIGN.H * 2;
        drawCard(out.getContext('2d'), model, 2);
        out.toBlob((blob) => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'hfyj-card.png';
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Revoked on the next turn, not immediately: Safari has not
            // finished with the URL by the time click() returns.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
    });

    const api = {
        model, canvas, render,
        onBack: () => {},
        // The theme decides the card stock and the ink, so a toggle while the
        // kit is open has to reach the canvas — CSS cannot repaint it.
        refresh: () => { groups.forEach((g) => g.sync()); render(); },
        destroy: () => { ro.disconnect(); root.textContent = ''; },
    };
    backBtn.addEventListener('click', () => api.onBack());
    resize();
    return api;
}
