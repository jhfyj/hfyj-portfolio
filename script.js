import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { mountCardBuilder, drawCard, newModel, CARD_DESIGN } from "./card-builder.js";

// ── Theme (light ↔ dark) ──────────────────────────────────────────────────────
const THEME_KEY = 'theme';
function getStoredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    return (saved === 'dark' || saved === 'light') ? saved : 'light';
}
let currentTheme = getStoredTheme();
document.documentElement.setAttribute('data-theme', currentTheme);

// Light-mode paper stock for every card drawn in code — faces and backs alike;
// the dark stock lives in THEME_COLORS below. Card 8 (the sketchbook scan) is a
// flat image, so it carries its own background and stays out of this entirely.
const CARD_BG = '#F7F5F5';

// The ink values mirror the site's --t1/--t2 text scale in style.css. Each
// light entry is the literal the card art was already drawn with, so light
// mode renders exactly as before; the dark entries are the tones that clear
// the dark stock. Photos and anything sitting on top of one keep their own
// colors — only the stock and the ink drawn on it follow the theme.
const THEME_COLORS = {
    light: {
        fog: 0xFCFCFE, accent: '#5E81E2', cardBg: CARD_BG,
        ink: '#000', inkSub: '#585858', inkBody: '#626875',
        rule: '#232323', placeholder: '#d9d9d9',
    },
    dark: {
        fog: 0x121212, accent: '#FFFA50', cardBg: '#373737',
        ink: '#F2F2F2', inkSub: '#A8A8A8', inkBody: '#A8AEBC',
        rule: '#8F8F8F', placeholder: '#4A4A4A',
    },
};

// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(THEME_COLORS[currentTheme].fog, 3, 7); // subtle fog — back cards fade toward bg color
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cardgroup = new THREE.Group();
const cards = [];

let targetRotation = null;
let snapSpeed = 0.1;
const cardCount = 10;
let scrollTimeout = null;
let currentView = 'cards';
let totalModels = 10;
let loadedModels = 0;

// Loader
// Null on a return visit, which is what turns the loading screen off: the
// progress block below and the fade-out that follows it are both gated on
// loaderEl, and the "models all loaded" branch starts the carousel directly
// when there is no loader to wait for. Hiding the element in CSS alone would
// leave this reference truthy and the carousel would never start.
// index.html decides this before first paint; see window.__introDone there.
const introSkipped = window.__introDone === true;
const loaderEl        = introSkipped ? null : document.getElementById('loader');
if (introSkipped) {
    const el = document.getElementById('loader');
    if (el) el.remove();
}
const loaderProgressEl = document.getElementById('loader-progress-bar');
const loaderStart = performance.now();
const LOADER_MIN_MS = 3000; // keep the shuffle on screen even on fast loads
let loaderTarget  = 0;   // jumps to each step as models arrive
let loaderDisplay = 0;   // lerps smoothly toward loaderTarget
let loaderDone    = false;

// ── Where-you-left-off state (view + position within it) ─────────────────────
// Clicking into a project is a round trip, not an exit: coming back should put
// the visitor where they were, not at the top of a view they weren't even on.
//
// sessionStorage, not localStorage, on purpose. This is "a moment ago", scoped
// to one tab's browsing session — a visitor who comes back next week should get
// the carousel and the intro again, because that's the first impression, not a
// setting they chose. Every access is wrapped: Safari's private mode throws on
// the getter itself rather than returning null.
//
// One key, one small object, and a version stamp on it. A shape written by an
// older build of this file is discarded rather than half-read, so a field that
// moved or changed meaning can never throw its way into the restore path.
const VIEW_STATE_KEY = 'homeViewState';
const VIEW_STATE_VERSION = 1;

// Kept in memory and written from here, rather than read back off the DOM at
// write time — the throttled writer below runs from the render loop, which
// starts before the grid's own consts exist further down this file.
const viewState = {
    v: VIEW_STATE_VERSION,
    view: 'cards',
    gridScroll: 0,
    rotation: 0,
};

// The angle is sampled from the render loop, so what gets stored is wherever
// the ring happened to be at that moment — mid-drag, mid-fling, part-way
// through the snap easing, or anywhere at all in the idle auto-rotate, which
// drifts continuously and never snaps. Restoring any of those literally is how
// a visitor comes back resting between two cards. Rounding to the nearest whole
// card's share of the circle is the same quantisation snaptoNearestCard eases
// toward, applied instantly instead: nearest rather than truncated, so it is
// still the card they left off on and not card 0, and the accumulated lap count
// rides along in the multiple so nothing jumps a full turn on the way back.
function snappedRotation(raw) {
    const anglePerCard = (Math.PI * 2) / cardCount;
    return Math.round(raw / anglePerCard) * anglePerCard;
}

function readViewState() {
    let raw = null;
    try { raw = sessionStorage.getItem(VIEW_STATE_KEY); } catch (err) { return null; }
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== VIEW_STATE_VERSION) return null;
        return {
            view: parsed.view === 'grid' ? 'grid' : 'cards',
            // Number.isFinite, not a truthiness check: 0 is a legitimate scroll
            // offset and NaN/null from a corrupt entry must not reach scrollTop.
            gridScroll: Number.isFinite(parsed.gridScroll) ? parsed.gridScroll : 0,
            // Snapped on the way in as well as on the way out, because entries
            // written by a build that stored the raw angle are still sitting in
            // whatever tabs were open when this shipped.
            rotation: Number.isFinite(parsed.rotation) ? snappedRotation(parsed.rotation) : 0,
        };
    } catch (err) { return null; }
}

let persistTimer = null;
let lastPersistAt = -Infinity;
const PERSIST_INTERVAL_MS = 250;

function writeViewState() {
    if (persistTimer !== null) { clearTimeout(persistTimer); persistTimer = null; }
    lastPersistAt = performance.now();
    // Snapped here rather than in viewState itself: that field has to stay the
    // live angle, because the render loop diffs against it to decide whether
    // anything has moved since the last write. Only the copy that goes to
    // storage is quantised, so what is stored is a card and not a halfway house.
    const stored = { ...viewState, rotation: snappedRotation(viewState.rotation) };
    try { sessionStorage.setItem(VIEW_STATE_KEY, JSON.stringify(stored)); } catch (err) { /* private mode */ }
}

// Rotation changes every frame while the carousel spins and scroll fires at
// pointer rate, so those two go through here instead of writing directly:
// leading edge plus a trailing write, so the value that actually gets stored is
// where the motion came to rest, not wherever it happened to be 250ms in.
// beforeunload isn't a substitute — it's skipped outright on mobile Safari and
// whenever the tab is discarded, which is exactly the trip we're saving for.
function schedulePersist() {
    const now = performance.now();
    const since = now - lastPersistAt;
    if (since >= PERSIST_INTERVAL_MS) { writeViewState(); return; }
    if (persistTimer !== null) return;
    persistTimer = setTimeout(() => { persistTimer = null; writeViewState(); }, PERSIST_INTERVAL_MS - since);
}

// Read once, up front: the restore paths further down consume this, and reading
// it later would race the writes this same page starts making.
const restoredState = introSkipped ? readViewState() : null;

// The carousel's angle is a single accumulating number that every input funnels
// into (wheel, drag, scrubber, keyboard, the snap easing) — so restoring which
// card faced the viewer is just putting that number back before the first
// render, which is why this sits up here next to the group rather than down
// with the view restore. Gated on introSkipped so a genuinely fresh visit is
// untouched: the deal starts from wherever the group is and rotates a full
// circle from there, and seeding it would land the deal on the wrong card.
if (restoredState) {
    viewState.view = restoredState.view;
    viewState.gridScroll = restoredState.gridScroll;
    viewState.rotation = restoredState.rotation;
    cardgroup.rotation.y = restoredState.rotation;
}

// ── Sound effects — synthesized with Web Audio, no audio files ───────────────
let audioCtx = null;
let noiseBuf = null;

function ensureAudio() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
        // 1s of white noise, reused by every paper/click sound
        noiseBuf = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
}

// Browsers only allow audio after a user gesture — unlock on the first one
['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
    window.addEventListener(ev, ensureAudio, { once: true, passive: true }));

// Filtered-noise burst — shared basis of all the sounds.
// Optional second filter (lp) softens the top end so bursts read as soft
// rustle/texture rather than a sharp percussive hit.
function playNoise(opts) {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state !== 'running') {
        // Context is still resuming from its very first gesture (async) — retry
        // once it's ready instead of dropping the sound, but only if that
        // happens soon, so a long-delayed gesture doesn't trigger a stale sound.
        const requestedAt = performance.now();
        ctx.resume().then(() => {
            if (performance.now() - requestedAt < 1000) playNoise(opts);
        });
        return;
    }
    const { dur, vol, type, freq, q = 1, attack = 0.002, lp } = opts;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2; // subtle variation per play
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = freq;
    filt.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let lastNode = filt;
    if (lp) {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = lp;
        lowpass.Q.value = 0.5;
        filt.connect(lowpass);
        lastNode = lowpass;
    }
    src.connect(filt); lastNode.connect(gain); gain.connect(ctx.destination);
    src.start(t, Math.random() * 0.5, dur + 0.1);
}

// Sound disabled for now — comment/uncomment the bodies below to toggle.
const sfx = {
    tick()   { /* playNoise({ dur: 0.03,  vol: 0.015, type: 'bandpass', freq: 2600, q: 5,   attack: 0.001 }); */ }, // ratchet click as ticker passes a card
    click()  { /* playNoise({ dur: 0.045, vol: 0.015, type: 'bandpass', freq: 1200, q: 3,   attack: 0.004 }); */ }, // subtle press
    whoosh() { /* playNoise({ dur: 2,   vol: 0, type: 'bandpass', freq: 700,  q: 0.3, attack: 0.025  }); */ }, // faint paper flying by
    land()   { /* playNoise({ dur: 0.06,  vol: 0.02,  type: 'bandpass', freq: 900,  q: 2.5, attack: 0.001, lp: 2200 }); */ }, // soft click as a card drops into place
    paper()  { /* playPaperSample(); */ } // real recorded paper rustle, played once per hover
};

let lastWhooshMs = 0;
function playWhooshThrottled() {
    const now = performance.now();
    if (now - lastWhooshMs > 320) { sfx.whoosh(); lastWhooshMs = now; }
}

// Eagerly create the audio context — construction doesn't require a user
// gesture, only playback does — so the paper-rustle recording has time to
// decode before the first hover, instead of starting the fetch on demand.
ensureAudio();
let paperBuffer = null;
fetch('https://jhfyj.github.io/New-Website-Code/sounds/paper-rustle.wav')
    .then(r => r.arrayBuffer())
    .then(buf => audioCtx.decodeAudioData(buf))
    .then(decoded => { paperBuffer = decoded; })
    .catch(() => {}); // missing/blocked file just means no paper sound, not a crash

// Plays a short snippet from a random point in the recording. The source
// clip's loudness varies a lot from one moment to the next (it's a real
// recording, not synthesized noise), so a fixed gain would make some plays
// sound much louder than others. Instead we measure the RMS of the exact
// slice we're about to play and scale gain to hit a consistent target level,
// clamped so a near-silent slice doesn't get amplified into audible hiss.
function playPaperSample() {
    const ctx = ensureAudio();
    if (!ctx || !paperBuffer) return;
    if (ctx.state !== 'running') {
        const requestedAt = performance.now();
        ctx.resume().then(() => {
            if (performance.now() - requestedAt < 1000) playPaperSample();
        });
        return;
    }
    const sliceDur = 0.4 + Math.random() * 0.2; // 400–600ms snippet — slower, more drawn out
    const maxStart = Math.max(0, paperBuffer.duration - sliceDur - 0.05);
    const offset = Math.random() * maxStart;

    const data = paperBuffer.getChannelData(0);
    const startSample = Math.floor(offset * paperBuffer.sampleRate);
    const sliceSamples = Math.min(Math.floor(sliceDur * paperBuffer.sampleRate), data.length - startSample);
    let sumSq = 0;
    for (let i = startSample; i < startSample + sliceSamples; i++) sumSq += data[i] * data[i];
    const rms = Math.sqrt(sumSq / sliceSamples) || 0.0001;

    const TARGET_RMS = 0.0004; // consistent perceived loudness across all plays — tune this to taste
    const gainMul = Math.min(TARGET_RMS / rms, 2.5); // upper clamp only, so TARGET_RMS can go arbitrarily quiet

    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = paperBuffer;
    src.playbackRate.value = 0.78 + Math.random() * 0.1; // slowed down — reads as heavier/lazier, not a quick flick
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(gainMul, t + 0.08); // slower attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t + sliceDur);
    src.connect(gain); gain.connect(ctx.destination);
    src.start(t, offset, sliceDur + 0.05);
}

// Suppresses the hover paper sound while actively scrolling — wheel/swipe
// handlers reset hoveredCard every tick, so mouse jitter mid-scroll would
// otherwise re-trigger a "new hover" on every tick and stack the sound.
let lastScrollMs = 0;
const SCROLL_QUIET_MS = 200;
function isRecentlyScrolling() {
    return performance.now() - lastScrollMs < SCROLL_QUIET_MS;
}

// updateScrubber() runs every rAF frame, and during a fast scroll the active
// card can change on nearly every frame — without a floor on the gap between
// plays that becomes a dense, overlapping buzz instead of distinct ticks.
let lastTickMs = 0;
const TICK_MIN_GAP_MS = 55;
function playTickThrottled() {
    const now = performance.now();
    if (now - lastTickMs > TICK_MIN_GAP_MS) { sfx.tick(); lastTickMs = now; }
}

let carouselSettled = true;
let lastGroupRotY = 0;
let stillFrames = 0;
const ROT_EPS = 0.00035;
const STILL_FRAMES_NEEDED = 8;

let swipeStartY = 0;
let swipeMoved = false;

let isDragging = false;
let previousMouseX = 0;

let dragStartX = 0;
let dragStartY = 0;
let hasDragged = false;
const DRAG_THRESHOLD = 5;

// ── Momentum after a fast drag/swipe release ─────────────────────────────────
// A quick flick should keep spinning — for a few seconds, potentially several
// laps — before friction brings it to a stop and it eases onto the nearest
// card, instead of stopping dead the instant the finger lifts.
let isFlinging = false;
let flingVelocity = 0;             // radians/frame, applied while flinging
let pointerRotSamples = [];        // rolling {t, rot} samples while dragging (mouse or touch)
const FLING_FRICTION = 0.97;       // per-frame velocity decay once released — slow, so a
                                    // strong flick visibly coasts for a few seconds
const FLING_MIN_VELOCITY = 0.002;  // rad/frame — below this, stop flinging and snap
const FLING_START_VELOCITY = 0.006;// rad/frame — release speed needed to trigger a fling at all
const FLING_VELOCITY_CAP = 0.45;   // rad/frame — clamp absurd flick speeds
const FRAME_MS = 16.7;             // normalizes irregular event timing to "per frame"
const VELOCITY_WINDOW_MS = 100;    // how far back we look to estimate release velocity —
                                    // a short rolling window (not a single last-sample delta,
                                    // which lags behind and underestimates genuine fast flicks)

// Record a rolling sample of rotation vs. time; prune anything older than the window.
function recordRotSample(samples) {
    const now = performance.now();
    samples.push({ t: now, rot: cardgroup.rotation.y });
    while (samples.length > 1 && now - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
}

// Net rotation change over the recent window, normalized to radians/frame.
function velocityFromSamples(samples) {
    if (samples.length < 2) return 0;
    const first = samples[0];
    const last = samples[samples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return ((last.rot - first.rot) / dt) * FRAME_MS;
}

// velocity: rad/frame estimate at release. Fast enough → let momentum carry
// the spin (possibly several laps); otherwise ease straight to the nearest card.
function startFlingOrSnap(velocity) {
    const v = THREE.MathUtils.clamp(velocity, -FLING_VELOCITY_CAP, FLING_VELOCITY_CAP);
    if (Math.abs(v) > FLING_START_VELOCITY) {
        isFlinging = true;
        flingVelocity = v;
        targetRotation = null;
    } else {
        isFlinging = false;
        snaptoNearestCard();
    }
}

// Scrubber drag flag — declared here so canvas handlers can check it
let scrubberDragging = false;

// Auto-rotate after idle
const IDLE_TIMEOUT = 5000;       // 5 seconds of no interaction
const AUTO_ROTATE_SPEED = 0.0018; // radians per frame (~0.1°)
let lastInteractionTime = performance.now();
let autoRotating = false;

function resetIdleTimer() {
    lastInteractionTime = performance.now();
    if (autoRotating) {
        autoRotating = false;
        // Clear hover so card drops back down before we stop
        hoveredCard = null;
        // Snap to nearest card when user takes over
        snaptoNearestCard();
    }
}

// Hover tracking
let hoveredCard = null;
// What the render loop last saw in hoveredCard, so it can tell an arrival
// from a frame that simply still has the pointer on the same card.
let lastHoveredCard = null;
// Tracks the card the paper sound last played for, separate from hoveredCard
// (which wheel/touch handlers null out every scroll tick to drop the visual
// lift). Keeping this separate means scrolling can't cause a stationary card
// to look "re-entered" and replay the sound on every tick.
let lastPaperCard = null;
const HOVER_Y = 0.15;
const HOVER_ANIM_SPEED = 0.17;
let hasFinePointer = window.matchMedia('(pointer: fine)').matches;
// Keep in sync if the query changes; also treat any real mousemove as proof of a fine pointer
window.matchMedia('(pointer: fine)').addEventListener('change', (e) => { hasFinePointer = e.matches; });

const cardHoverY = new Array(cardCount).fill(0); // per-card hover lift
const cardShadows = new Array(cardCount).fill(null); // per-card shadow mesh

// Card-0 mouse-follow tilt — active during waitForScroll phase
let card0TiltTargX = 0, card0TiltTargY = 0; // mouse-driven targets (radians)
let card0TiltCurrX = 0, card0TiltCurrY = 0; // smoothly lerped current values
const CARD0_TILT_MAX = 0.24;  // ~10° max tilt in either axis
const CARD0_TILT_SPEED = 0.07;

// --- Intro animation state ---
// 'idle' → 'waitForScroll' (About Me visible) → 'dealing' → 'done'
let introPhase = 'idle';
const cardIntroY = new Array(cardCount).fill(0); // per-card Y offset above normal (eases → 0)

// Per-card drop animation timing (performance.now() when drop started, -Infinity = not started)
const cardDropStartTime = new Array(cardCount+1).fill(-Infinity);
const CARD_DROP_DURATION = 500; // ms — linear drop, matches step interval
const CARD_DROP_START_Y = 12;   // how high above normal each card starts
// Precomputed ms offset from introAnimStartTime at which each card should start dropping.
// Set by triggerDealing(); checked every frame to avoid setTimeout jitter.
const cardDropOffset = new Array(cardCount).fill(Infinity);

// Pending timeout that reveals the About Me panels; cleared if dealing starts first
let panelRevealTimeout = null;

// Continuous intro rotation state (replaces per-step snap during dealing)
let introAnimStartTime = 0;
let introAnimStartRot = 0;
let introAnimEndRot = 0;
let introAnimDuration = 0;
let introAnimActive = false;

// Camera
const camera = new THREE.PerspectiveCamera(80, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 0, 3.6);

// Renderer
const canvas = document.querySelector("canvas.threejs");
if (!canvas) {
    throw new Error('Canvas not found.');
}

const spinHintEl = document.getElementById('spin-hint');

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
});

// Pixel ratio first — setSize sizes the backing store using whatever ratio is
// set at the time, so setting it afterwards leaves the scene rendering at 1x.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

// Custom card cursor + dot cursor
const cursorStyle = document.createElement('style');
cursorStyle.textContent = `
  *, *::before, *::after {
    cursor: none !important;
  }
  #card-cursor {
    position: fixed;
    left: 0;
    top: 0;
    transform: translate(-50%, -50%);
    padding: 9px 20px;
    background: rgba(var(--panel-rgb), 0.45);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(var(--ink-rgb), 0.12);
    border-radius: 999px;
    color: var(--t1);
    font-family: "DM Sans", system-ui, sans-serif;
    font-size: 13px;
    letter-spacing: 0.8px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.5);
    pointer-events: none;
    z-index: 999999;
    opacity: 0;
    transition: opacity 0.25s ease;
    white-space: nowrap;
    user-select: none;
  }
  #card-cursor.visible {
    opacity: 1;
  }
  #dot-cursor {
    position: fixed;
    left: 0;
    top: 0;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--t1);
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 999999;
    opacity: 0;
    transition: opacity 0.18s ease, width 0.15s ease, height 0.15s ease, border-radius 0.15s ease;
  }
  #dot-cursor.visible {
    opacity: 1;
  }
  #dot-cursor.pressed {
    width: 12px;
    height: 12px;
    border-radius: 0%;
  }
  /* The "designs" box resize handles are the one place on the site that use
     the browser's native cursor (grab/grabbing) instead of the custom dot,
     so the custom cursor hides itself whenever they're active. */
  html.gh-handle-hover #dot-cursor,
  html.gh-handle-hover #card-cursor,
  html.gh-handle-drag #dot-cursor,
  html.gh-handle-drag #card-cursor {
    opacity: 0 !important;
  }
  html.gh-handle-drag,
  html.gh-handle-drag * {
    cursor: grabbing !important;
  }
  /* While the make-your-own kit is up, the real pointer comes back. The dot is
     a carousel affordance — it says "this whole surface is one thing you turn".
     The kit is the opposite: buttons, sliders, text fields and a drawing
     surface, each wanting its own pointer. Hiding the dot without this left no
     cursor at all from the moment the card starts rising. Same !important the
     resize handles use, for the same reason. */
  body.customizing,
  body.customizing *,
  body.customizing *::before,
  body.customizing *::after {
    cursor: auto !important;
  }
  body.customizing .cb-btn,
  body.customizing .cb-brush,
  body.customizing .cb-color,
  body.customizing .cb-slider {
    cursor: pointer !important;
  }
  body.customizing .cb-slot { cursor: text !important; }
  body.customizing .cb-card { cursor: crosshair !important; }
  body.customizing .cb-sticker { cursor: grab !important; }
  body.customizing .cb-sticker:active { cursor: grabbing !important; }
`;
document.head.appendChild(cursorStyle);

const cardCursor = document.createElement('div');
cardCursor.id = 'card-cursor';
cardCursor.textContent = 'open project';

// The customize card is the only one whose label carries a glyph, so the label
// is set through here rather than by assigning textContent in five places. The
// pen is IBM Carbon's `edit`, inlined: one glyph is not worth a dependency.
const PEN_ICON = '<svg viewBox="0 0 32 32" width="14" height="14" fill="currentColor" '
    + 'aria-hidden="true"><path d="M2 26h28v2H2zM25.4 9c.8-.8.8-2 0-2.8l-3.6-3.6c-.8-.8-2-.8-2.8 0'
    + 'l-15 15V24h6.4l15-15zm-5-5L24 7.6l-3 3L17.4 7l3-3zM6 22v-3.6l10-10 3.6 3.6-10 10H6z"/></svg>';

function setCardCursor(label, icon) {
    if (!icon) { cardCursor.textContent = label; return; }
    cardCursor.textContent = '';
    cardCursor.insertAdjacentHTML('afterbegin', icon);
    cardCursor.appendChild(document.createTextNode(label));
}
document.body.appendChild(cardCursor);

const dotCursor = document.createElement('div');
dotCursor.id = 'dot-cursor';
document.body.appendChild(dotCursor);


// Lights
const ambientLight = new THREE.AmbientLight(0xffffff, 2);
scene.add(ambientLight);

// ── Ember particles ──────────────────────────────────────────────
const PARTICLE_COUNT = 130;
const pPositions  = new Float32Array(PARTICLE_COUNT * 3);
const pColors     = new Float32Array(PARTICLE_COUNT * 3);
const pSpeeds     = new Float32Array(PARTICLE_COUNT); // upward drift speed
const pPhases     = new Float32Array(PARTICLE_COUNT); // wobble phase
const pWobbleAmp  = new Float32Array(PARTICLE_COUNT); // wobble amplitude
const pStartX     = new Float32Array(PARTICLE_COUNT);
const pStartZ     = new Float32Array(PARTICLE_COUNT);
const pBirthTime  = new Float32Array(PARTICLE_COUNT); // ms, negative = pre-spawned

// Palette matching the CSS gradient colours — warm-heavy to match bottom glow
const EMBER_PALETTE = [
    [0.863, 0.290, 0.149], // #dc4a26 warm red-orange
    [0.792, 0.541, 0.016], // #ca8a04 amber
    [0.914, 0.416, 0.624], // #e96a9f rose/pink
    [0.486, 0.227, 0.929], // #7c3aed purple
    [0.035, 0.569, 0.698], // #0891b2 teal
];
const P_BOTTOM = -5, P_TOP = 5;

for (let i = 0; i < PARTICLE_COUNT; i++) {
    pStartX[i]    = (Math.random() - 0.5) * 14;
    pStartZ[i]    = (Math.random() - 0.5) * 5 - 1;
    pSpeeds[i]    = 0.18 + Math.random() * 0.45;
    pPhases[i]    = Math.random() * Math.PI * 2;
    pWobbleAmp[i] = 0.08 + Math.random() * 0.28;
    // stagger so particles are spread across the screen on first load
    pBirthTime[i] = -Math.random() * ((P_TOP - P_BOTTOM) / pSpeeds[i]) * 1000;

    const c = EMBER_PALETTE[Math.floor(Math.random() * EMBER_PALETTE.length)];
    pColors[i * 3] = c[0]; pColors[i * 3 + 1] = c[1]; pColors[i * 3 + 2] = c[2];
}

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
particleGeo.setAttribute('color',    new THREE.BufferAttribute(pColors,    3));

const particleMat = new THREE.PointsMaterial({
    size: 0.016,
    vertexColors: true,
    transparent: true,
    opacity: 0.38,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
});

const particleMesh = new THREE.Points(particleGeo, particleMat);
scene.add(particleMesh);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enableRotate = false;
controls.enableZoom = false;
controls.enablePan = false;

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Inverse of easeOutCubic — given a rotation fraction y, returns the time t
// at which easeOutCubic(t) = y.  Used to sync card drops with the rotation curve.
function easeOutCubicInverse(y) {
    return 1 - Math.cbrt(1 - y);
}


// Load Models
const texLoader = new THREE.TextureLoader();
texLoader.crossOrigin = 'anonymous';

// ── Card back texture (theme-aware, drawn procedurally) ──────────────────────
// Mirrors the Figma card-back frames: light bg + blue border in light mode,
// dark bg + yellow border in dark mode, with the HFYJ mark recolored to match.
const CARD_BACK_DESIGN = { w: 1059, h: 1449 }; // matches the Figma frame
// Same reasoning as the faces — see cardTextureScale() below.
const CARD_BACK_SCALE = () => CARD_TEXTURE_SCALE;

const hfyjMarkImg = new Image();
hfyjMarkImg.src = './assets/hfyj-mark.svg';
const hfyjMarkReady = new Promise((resolve) => { hfyjMarkImg.onload = resolve; });

// Recolors a same-shape image by compositing a solid fill through its alpha —
// lets one logo asset serve both the blue (light) and yellow (dark) card backs.
function tintedImage(img, w, h, color) {
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(img, 0, 0, w, h);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = color;
    octx.fillRect(0, 0, w, h);
    return off;
}

// Every card shows the same back, so there is one canvas and one texture for
// all of them. Painting into that same canvas — rather than building a fresh
// CanvasTexture per theme change, as this used to — means a theme change costs
// one re-upload instead of one allocation plus nine material invalidations, and
// stops leaking the previous texture on every toggle.
const cardBackCanvas = document.createElement('canvas');
const cardBackCtx = cardBackCanvas.getContext('2d');
let cardBackTexture = null;

function paintCardBack(theme) {
    const s = CARD_BACK_SCALE();
    const w = CARD_BACK_DESIGN.w * s, h = CARD_BACK_DESIGN.h * s;
    const canvas = cardBackCanvas;
    canvas.width = w;
    canvas.height = h;
    const ctx = cardBackCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { cardBg, accent } = THEME_COLORS[theme];
    const outerR = 36 * s;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, outerR);
    ctx.clip();
    ctx.fillStyle = cardBg;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Thin outer edge, matching the Figma frame's 1px black border
    ctx.beginPath();
    ctx.roundRect(0.5 * s, 0.5 * s, w - s, h - s, outerR);
    ctx.lineWidth = s;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    // Thick inset accent border
    const borderW = 25 * s;
    const inset = 23 * s + borderW / 2;
    ctx.beginPath();
    ctx.roundRect(inset, inset, w - inset * 2, h - inset * 2, 24 * s);
    ctx.lineWidth = borderW;
    ctx.strokeStyle = accent;
    ctx.stroke();

    // Centered HFYJ mark, tinted to the accent color
    const logoSize = 437 * s;
    const logo = tintedImage(hfyjMarkImg, logoSize, logoSize, accent);
    ctx.drawImage(logo, (w - logoSize) / 2, (h - logoSize) / 2);

}

function makeCardBackTexture(theme) {
    paintCardBack(theme);
    cardBackTexture = new THREE.CanvasTexture(cardBackCanvas);
    cardBackTexture.colorSpace = THREE.SRGBColorSpace;
    cardBackTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return cardBackTexture;
}

function updateCardBackTexture(theme) {
    if (!cardBackTexture) return; // the mark hasn't loaded; the first paint will use the current theme
    paintCardBack(theme);
    // The materials already point at this texture object, so nothing about them
    // has changed — marking them dirty would only push every card back through
    // program resolution for a texture swap that never happened.
    cardBackTexture.needsUpdate = true;
}

// The card faces are the same story as the backs, but each one draws from its
// own images and layout, so what's registered here is a repaint closure rather
// than a material: it redraws that card's canvas in the new theme from assets
// its loader has already resolved. Cards register as they finish loading, so a
// toggle that lands mid-load only skips faces that haven't drawn yet — and
// those draw in currentTheme, which applyTheme has already set.
const cardFaceRepaints = [];

// Repainting every face in one go means re-uploading all nine card textures in
// the same frame — tens of megabytes of texture traffic at once, which the
// driver takes long enough over that the scene visibly locks. The work itself
// is unavoidable; doing it all in one frame is not.
//
// So spread it: nearest the camera first, one card per frame. Whatever is being
// looked at changes immediately, and the cards round the back repaint while they
// are still out of sight. A toggle mid-run abandons the queue rather than
// finishing it in the colour that is no longer current.
let faceRepaintRaf = 0;
const _repaintPos = new THREE.Vector3();

function updateCardFaceTextures(theme) {
    if (faceRepaintRaf) cancelAnimationFrame(faceRepaintRaf);

    const queue = cardFaceRepaints
        .map((entry) => {
            const card = cards[entry.index];
            // unloaded cards sort last; they paint in the current theme anyway
            const d = card ? card.getWorldPosition(_repaintPos).distanceTo(camera.position) : Infinity;
            return { entry, d };
        })
        .sort((a, b) => a.d - b.d)
        .map((x) => x.entry);

    const step = () => {
        const next = queue.shift();
        if (!next) { faceRepaintRaf = 0; return; }
        next.repaint(theme);
        faceRepaintRaf = requestAnimationFrame(step);
    };
    step();   // the card in focus flips on this frame, not the next one
}

// Pre-load shared card back texture — resolves as a promise so card loaders can await it
const backTexturePromise = hfyjMarkReady.then(() => makeCardBackTexture(currentTheme));

// Page URLs for each card — edit these to match your Framer pages
const CARD_URLS = [
    "aboutme.html",                        // 0 — About Me
    "puregym.html",                        // 1 — Puregym
    "techatnyu.html",                      // 2 — tech@nyu
    "clarusai.html",                       // 3 — Clarus AI
    "povi.html",                           // 4 — POVI
    "the-dial.html",                       // 5 — The Dial
    "#",                                    // 6 — BMW Designworks (Coming Soon)
    "#",                                    // 7 — Nenos Inc. (Coming Soon)
    // 8 — Sketchbook. Deliberately external: there is no local sketchbook.html,
    // so the live site is the right destination. Do not "fix" this to a local
    // path. The nav links to it in index.html are external for the same reason.
    "https://hfyj-art.com/sketchbook",
    // 9 — Make your own. The only card with no destination at all: it
    // opens the kit over this same page, so there is nothing for it to
    // navigate to. openCard turns back before it ever reads this.
    null,
];

// Cards with no real destination page yet — hovering shows "coming soon" and
// clicking the front card is a no-op instead of navigating. Keep in sync with
// the "#" placeholders above.
const COMING_SOON_INDICES = new Set([6, 7]);


// ── Card → page hand-off ─────────────────────────────────────────────────────
//
// Opening a card should read as the card *becoming* the page behind it: its
// artwork travelling to where that case page's hero sits, its title to where
// the <h1> sits. The View Transitions API cannot do this — the card is drawn in
// WebGL, so there is no element to give a view-transition-name to — and in any
// case this page has no idea where the destination's hero will land, because
// every case page sets its own column width and its own hero aspect.
//
// So the two halves talk through sessionStorage. Here we write down the one
// thing only this page knows: what the card looked like and where on screen it
// was at the moment it was clicked. card-transition.js on the case page
// measures its own hero and <h1> and plays the flight between the two.
//
// The key and the shape below are card-transition.js's. If the two ever
// diverge the stash is simply ignored and the case page loads exactly as it
// does without one — which is also what happens on a typed URL, a reload, or
// under prefers-reduced-motion.
const HANDOFF_KEY = 'hfyj:card-transition';
// The same geometry, kept for the trip back. The arrival stash above is
// consumed on use — it describes one gesture and must not outlive it — but
// leaving a page for home needs to know where the card is *now*, which is a
// standing fact about the carousel rather than a one-shot. The carousel
// restores its rotation on a return visit, so the card the reader opened is
// still the one facing them, still in this box.
const CARD_ORIGIN_KEY = 'hfyj:card-origin';

// Every project card face is drawn into the same 1059×1449 design frame (see
// TEMPLATE_CARD and PUREGYM_DESIGN, which agree), so the photo well and the
// title sit in the same place on all of them. Held as fractions of the face so
// they survive whatever size the card happens to be projected at.
const CARD_FACE_LAYOUT = {
    photo: { x: 21 / 1059, y: 20 / 1449, w: 1016.663 / 1059, h: 817 / 1449 },
    // The title is measured to its *baseline*, not to a box. That is where the
    // canvas draws it, and it is the only line the destination can match: the
    // top of a text box is a leading-dependent fiction that would put the two
    // titles a few pixels apart no matter what.
    title: { x: 54 / 1059, baseline: 960 / 1449, size: 96 / 1449 },
};

// Only the five project cards. Card 0 (about me) and card 8 (sketchbook) are
// laid out differently and their pages do not open on a hero at all.
const HANDOFF_INDICES = new Set([1, 2, 3, 4, 5]);

// Both halves have to name the destination the same way, and they only share a
// URL. Last path segment, minus any .html — so "puregym.html" here and
// "/puregym" as served in production both come out as "puregym".
function handoffSlug(url) {
    const last = url.split('#')[0].split('?')[0].split('/').pop() || '';
    return last.replace(/\.html$/, '');
}

// The card face's box on screen. The front card sits very nearly square-on to
// the camera, so projecting its four corners and taking their bounding box is
// the rectangle a reader would draw around it — a pixel or two off the true
// perspective quad, and a rectangle is what the destination can FLIP from.
function projectCardFaceRect(group) {
    const mesh = group.children[0];
    mesh.updateWorldMatrix(true, false);   // the click lands between render frames
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const v = new THREE.Vector3();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    [[bb.min.x, bb.min.y], [bb.max.x, bb.min.y], [bb.max.x, bb.max.y], [bb.min.x, bb.max.y]]
        .forEach(([x, y]) => {
            v.set(x, y, 0).applyMatrix4(mesh.matrixWorld).project(camera);
            const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
            minX = Math.min(minX, sx); maxX = Math.max(maxX, sx);
            minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
        });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function stashCardHandoff(index, url) {
    if (!HANDOFF_INDICES.has(index)) return;
    const group = cards[index];
    if (!group || !group.children.length) return;

    const map = group.children[0].material && group.children[0].material.map;
    const face = map && map.image;      // every card face is a CanvasTexture
    if (!face || !face.width) return;

    const rect = projectCardFaceRect(group);
    if (!(rect.w > 1 && rect.h > 1)) return;

    const L = CARD_FACE_LAYOUT;
    let image;
    try {
        // Only the photo well travels, not the whole face: the photo is the
        // part that becomes the hero, and cropping it here saves the
        // destination any background-position arithmetic. 900px across is well
        // past the size it is ever painted at, and keeps the base64 inside
        // sessionStorage's budget — which is spent in UTF-16, so every
        // character of it costs two bytes.
        const sx = L.photo.x * face.width, sy = L.photo.y * face.height;
        const sw = L.photo.w * face.width, sh = L.photo.h * face.height;
        const k = Math.min(1, 900 / sw);
        const out = document.createElement('canvas');
        out.width = Math.round(sw * k);
        out.height = Math.round(sh * k);
        out.getContext('2d').drawImage(face, sx, sy, sw, sh, 0, 0, out.width, out.height);
        image = out.toDataURL('image/jpeg', 0.86);
    } catch (err) {
        // A tainted canvas throws here rather than returning anything. With no
        // pixels to fly there is nothing to hand over, so let the case page
        // open the way it always has.
        return;
    }

    try {
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({
            t: Date.now(),
            slug: handoffSlug(url),
            text: group.userData.cardTitle || '',
            theme: currentTheme,
            image: image,
            // Where the photo well and the title's baseline actually were, in
            // this page's own CSS pixels. The destination FLIPs from exactly
            // these, which is why nothing here is per-page geometry.
            photo: {
                x: rect.x + L.photo.x * rect.w,
                y: rect.y + L.photo.y * rect.h,
                w: L.photo.w * rect.w,
                h: L.photo.h * rect.h,
            },
            title: {
                x: rect.x + L.title.x * rect.w,
                baseline: rect.y + L.title.baseline * rect.h,
                size: L.title.size * rect.h,
            },
        }));
    } catch (err) { /* private mode, or no room — the case page copes either way */ }

    try {
        // No image: the way out shrinks the page's own hero rather than a
        // stand-in, because by then the media has long since settled and there
        // is nothing left that a transform could catch mid-load.
        //
        // The viewport goes with it. These are screen coordinates for one
        // particular window, and a reader who resizes while reading has moved
        // the card out from under them — better to skip the flight than to
        // send the hero somewhere the card no longer is.
        sessionStorage.setItem(CARD_ORIGIN_KEY, JSON.stringify({
            slug: handoffSlug(url),
            vw: window.innerWidth,
            vh: window.innerHeight,
            photo: {
                x: rect.x + L.photo.x * rect.w,
                y: rect.y + L.photo.y * rect.h,
                w: L.photo.w * rect.w,
                h: L.photo.h * rect.h,
            },
            title: {
                x: rect.x + L.title.x * rect.w,
                baseline: rect.y + L.title.baseline * rect.h,
                size: L.title.size * rect.h,
            },
        }));
    } catch (err) { /* the case page falls back to a plain link */ }
}

// The one place a card actually opens its page. Both the click and the
// keyboard route through here so neither can forget the hand-off.
function openCard(index) {
    if (COMING_SOON_INDICES.has(index)) return;
    // The kit opens over this page rather than as one. No hand-off, no
    // navigation, and nothing written down about it anywhere but this tab.
    if (index === CUSTOMIZE_INDEX) { openCustomize(); return; }
    stashCardHandoff(index, CARD_URLS[index]);
    // Here rather than at either call site for the same reason the hand-off is:
    // this is the single funnel every carousel open passes through. No-op unless
    // analytics.js loaded and a key is configured.
    window.Analytics && window.Analytics.projectOpen(CARD_URLS[index], 'carousel');
    window.open(CARD_URLS[index], '_top');
}


// Responsive card scale — steps down at medium and narrow screens
function getCardScale() {
    if (window.innerWidth <= 768)  return 0.68;
    if (window.innerWidth <= 1100) return 0.72;
    if (window.innerWidth <= 1400) return 0.76;
    return 0.78;
}

// Carousel ring radius — proportional to card scale so spacing stays consistent
function getCarouselRadius() {
    if (window.innerWidth <= 768)  return 1.75;
    if (window.innerWidth <= 1100) return 1.85;
    if (window.innerWidth <= 1400) return 1.95;
    return 2.05;
}

// Builds a flat card with rounded corners (like a playing card).
// Only the 4 corner edges are curved — top/bottom/left/right stay straight.
function makeRoundedCardGeo(cardW, cardH, radius) {
    const hw = cardW / 2, hh = cardH / 2, r = radius;
    const shape = new THREE.Shape();
    shape.moveTo(-hw + r, -hh);
    shape.lineTo( hw - r, -hh);
    shape.quadraticCurveTo( hw, -hh,  hw, -hh + r);
    shape.lineTo( hw,  hh - r);
    shape.quadraticCurveTo( hw,  hh,  hw - r,  hh);
    shape.lineTo(-hw + r,  hh);
    shape.quadraticCurveTo(-hw,  hh, -hw,  hh - r);
    shape.lineTo(-hw, -hh + r);
    shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    // ShapeGeometry UVs are raw x/y — remap to [0,1] so textures display correctly
    const uvAttr = geo.attributes.uv;
    const posAttr = geo.attributes.position;
    for (let i = 0; i < uvAttr.count; i++) {
        uvAttr.setXY(i,
            (posAttr.getX(i) + hw) / cardW,
            (posAttr.getY(i) + hh) / cardH
        );
    }
    uvAttr.needsUpdate = true;
    return geo;
}

// Shared grain texture — subtle paper/card surface bump, created once and reused
function makeGrainTexture(size = 128) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
        const v = Math.floor(128 + (Math.random() - 0.5) * 80);
        img.data[i] = img.data[i+1] = img.data[i+2] = v;
        img.data[i+3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    return tex;
}
const grainTex = makeGrainTexture();

// Procedural card shadow texture — soft ellipse #8D88A2 at 50%.
// Uses a radial gradient (not ctx.filter blur) because iOS Safari ignores
// canvas filter, which caused the shadow to render as a sharp ellipse on mobile.
// Higher resolution + many color stops (vs. a bare 3-stop gradient) avoid banding
// on mobile GPUs' lower color precision, which otherwise reads as an incomplete blur.
const _shadowCanvas = document.createElement('canvas');
_shadowCanvas.width = 512;
_shadowCanvas.height = 256;
const _sctx = _shadowCanvas.getContext('2d');
_sctx.translate(256, 128);
_sctx.scale(1, 0.3);
const _shadowGrad = _sctx.createRadialGradient(0, 0, 0, 0, 0, 200);
for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const alpha = 0.50 * Math.pow(1 - t, 2); // smooth quadratic falloff, no hard cutoff
    _shadowGrad.addColorStop(t, `rgba(141,136,162,${alpha.toFixed(3)})`);
}
_sctx.fillStyle = _shadowGrad;
_sctx.beginPath();
_sctx.arc(0, 0, 200, 0, Math.PI * 2);
_sctx.fill();
const cardShadowTex = new THREE.CanvasTexture(_shadowCanvas);
cardShadowTex.minFilter = THREE.LinearFilter;
cardShadowTex.magFilter = THREE.LinearFilter;
cardShadowTex.generateMipmaps = false;

// Helper — place & register a finished card group into the carousel
function _placeCard(i, group) {
    const s = getCardScale();
    group.scale.set(s, s, s);
    const angle = (i * 360) / cardCount;
    const r = getCarouselRadius();
    group.position.set(
        Math.sin(THREE.MathUtils.degToRad(angle)) * r,
        0,
        Math.cos(THREE.MathUtils.degToRad(angle)) * r
    );
    group.rotation.y = THREE.MathUtils.degToRad(angle);
    group.visible = false; // hidden until intro drops it in

    // Shadow beneath the card
    const shadowGeo = new THREE.PlaneGeometry(1.4, 0.5);
    const shadowMat = new THREE.MeshBasicMaterial({
        map: cardShadowTex, transparent: true, depthWrite: false
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = -1.3;
    shadowMesh.renderOrder = -1;
    shadowMesh.raycast = () => {};
    shadowMesh.userData.baseY = -1.3;
    group.add(shadowMesh);
    cardShadows[i] = shadowMesh;

    // Add card back face using the shared back texture
    const frontMesh = group.children[0];
    backTexturePromise.then((backTex) => {
        // Derive dimensions from the front mesh geometry
        frontMesh.geometry.computeBoundingBox();
        const bb = frontMesh.geometry.boundingBox;
        const w = bb.max.x - bb.min.x;
        const h = bb.max.y - bb.min.y;
        const geo = makeRoundedCardGeo(w, h, 0.06);
        const mat = new THREE.MeshBasicMaterial({
            map: backTex, side: THREE.FrontSide
        });
        const backMesh = new THREE.Mesh(geo, mat);
        backMesh.rotation.y = Math.PI;
        backMesh.position.z = -0.001;
        group.add(backMesh);
    });

    cards[i] = group;
    cardgroup.add(group);
    loadedModels++;
    loaderTarget = (loadedModels / totalModels) * 100;
    if (loadedModels === totalModels && !loaderEl) {
        document.body.classList.add('gradient-visible');
        startIntro();
    }
}

// ── Card 0 — About Me ────────────────────────────────────────────────────────
// Same canvas-texture approach as the PureGym card below: draw the design
// (vector text/shapes) onto a canvas and load one real raster asset, the photo.
// How many pixels a card face canvas is actually worth.
//
// A card's 1.7-unit face, scaled ~0.78, sits about 1.55 units from an
// 80-degree camera, so it covers roughly half the viewport height; the renderer
// caps the pixel ratio at 2. On a 900px-tall window that is a ~460px-tall card,
// and the old fixed scales were drawing 2898- and 4347-pixel canvases for it.
// Nobody could see that detail, but everybody paid for it: every theme change
// re-uploads each of these canvases to the GPU, and the upload cost scales with
// the area, so the oversampling was the whole reason switching themes froze the
// scene for seconds.
//
// Measured once at load. Resizing the window does not repaint the faces, so a
// window dragged onto a denser display keeps the texture it was built with —
// the floor below is what keeps that from ever looking soft.
function cardTextureScale() {
    const onScreenPx = 0.55 * window.innerHeight * Math.min(window.devicePixelRatio, 2);
    const scale = (onScreenPx * 1.25) / 1449;   // 1449 is the design height
    return Math.max(1, Math.min(2, Math.round(scale * 4) / 4));
}
const CARD_TEXTURE_SCALE = cardTextureScale();

const ABOUTME_DESIGN = { w: 1059, h: 1449 }; // matches the Figma frame 1:1
const ABOUTME_SCALE = CARD_TEXTURE_SCALE;
// The photo's folded-corner silhouette, straight off the Figma node. Kept as a
// path (rather than baked into the image's alpha) so the mask edge stays
// resolution-independent — the blur below would otherwise soften it.
const ABOUTME_PHOTO_MASK = 'M1014 20C1027.25 20 1038 30.7452 1038 44V1400C1038 1413.25 1027.25 1424 1014 1424H45C31.7452 1424 21 1413.25 21 1400V131C21 98 40.9 78.5 72.5 78.5H138.932C150.052 78.5 160.578 73.4981 167.604 64.8789L188.294 39.5C188.294 39.5 203 20 231 20H1014Z';
// The Figma node carries a layer blur, but Figma's own render ignores it — its
// PNG export is sharp. Matching the render, not the filter. Raise to soften.
const ABOUTME_PHOTO_BLUR = 0;
const ABOUTME_PILL_FONT_PX = 14; // matches the design's DM Sans optical size
// The bottom-right shelf the tag pills sit on. In Figma this is a separate
// shape ("Vector 15") filled with the card stock and laid over the photo —
// the photo's own silhouette underneath is still the full ABOUTME_PHOTO_MASK,
// so this is a cover, not a clip. Kept in the node's own local coordinates;
// ABOUTME_CUT_MATRIX below is the 180° rotation and placement Figma gives it.
const ABOUTME_BOTTOM_CUT = 'M92.1527 105.785C39 105.785 19.571 132.5 19.571 170L0 83.7852L17.7362 11.0083L155.345 0L837 9.70899C802.751 9.70899 784.763 33.5602 784.763 33.5602L768.188 63.2673C754.411 87.96 728.41 103.32 700.134 103.432C556.671 103.997 124.699 105.785 92.1527 105.785Z';
// Rotated 180° about its own box and dropped so its local origin lands at
// (1058, 1434) — i.e. local (x, y) draws at (1058 - x, 1434 - y).
const ABOUTME_CUT_MATRIX = (s) => new DOMMatrix([-s, 0, 0, -s, 1058 * s, 1434 * s]);
// Tag pills, in design px, straight off the Figma row (node 1122:55): a 724-wide
// row that ends on the same 21px inset the photo does, with 12px gaps.
const ABOUTME_PILLS = [
    { label: 'NYU', x: 315, w: 153 },
    { label: 'TINKERER', x: 480, w: 280 },
    { label: 'DESIGNER', x: 772, w: 266 },
];
// Each pill fills the row box: 8px of padding either side of a 52px DM Sans
// line box, plus the 3px border Figma draws inside that. Measured off the
// design's own render as well as its metadata — both give 68 at y 1352.
const ABOUTME_PILL_Y = 1352;
const ABOUTME_PILL_H = 68;
const ABOUTME_PILL_STROKE = 3;

// ── Card 0 — the photo changes on hover ──────────────────────────
// Four photos; each time the pointer arrives on the card it walks to the next
// one and stays there, so hovering repeatedly cycles the deck rather than
// flicking between two shots. The first is the one the card is built with.
//
// Re-encoded from the originals in Cards/ to webp at the size the well
// actually draws them: b is aboutme3.jpg, c is aboutme4.jpg, d is
// aboutme4.png. Lettered rather than numbered because two of the sources are
// both called "aboutme4".
const ABOUTME_PHOTOS = [
    './Cards/aboutme-photo.webp',
    './Cards/aboutme-b.webp',
    './Cards/aboutme-c.webp',
    './Cards/aboutme-d.webp',
];
const ABOUTME_SWAP_MS = 250;
// The reveal grid, in design px. Cells this size give roughly 24x33 over the
// face, which is coarse enough to read as clumps rather than a dissolve.
const ABOUTME_BLOB_CELL = 44;

// The reveal happens in the card's own fragment shader, and this is why.
//
// Doing it on the canvas instead — painting the incoming photo through a
// growing set of circular holes — looks identical, but every frame of it has
// to end in `texture.needsUpdate`, which re-uploads the whole 1059x1449 face
// to the GPU. That is six megabytes a frame and ninety over a quarter of a
// second: the same cost that used to make changing theme freeze the scene for
// seconds (see cardTextureScale), and it stuttered just as badly here.
//
// So both photos sit on the GPU as textures the whole time and the only thing
// that changes per frame is one float. Nothing is uploaded and nothing is
// repainted mid-reveal. The mask is evaluated per pixel as well, which gives
// it cleaner edges than circles rasterised into a canvas ever had.
const ABOUTME_BLOB_GLSL = `
uniform sampler2D uMapB;
uniform float uProgress;
uniform vec2 uCells;
uniform vec2 uDirA;
uniform vec2 uDirB;
uniform float uSeed;

// Each cell of the grid opens as a circle rather than filling as a square, and
// one big enough to overrun its neighbours: overlapping circles merge into
// rounded clumps, so what spreads across the photo has no straight edges in it
// anywhere. Below about 0.71 — half a cell diagonal — the corners where four
// cells meet never close, and the grid shows through as a lattice of pinholes.
const float ABOUTME_R = 0.8;
// Share of the run one cell spends opening. Short, so the reveal reads as
// something spreading across the photo rather than the whole frame fading.
const float ABOUTME_GROW = 0.42;

float aboutmeHash(vec2 p) {
    return fract(sin(dot(p + uSeed, vec2(127.1, 311.7))) * 43758.5453);
}

// When a given cell starts opening, 0..1. Two sine bands crossing at random
// angles give broad soft clumps; the hash on top breaks the bands up so the
// reveal never reads as a wipe. Angles and seed change per swap, so no two of
// them look alike.
float aboutmeDelay(vec2 id) {
    vec2 u = id / uCells;
    float n = 0.5 + 0.25 * sin(6.2 * dot(u, uDirA)) + 0.25 * sin(9.1 * dot(u, uDirB));
    return clamp(0.72 * n + 0.28 * aboutmeHash(id), 0.0, 1.0);
}

float aboutmeMask(vec2 uv) {
    if (uProgress <= 0.0) return 0.0;
    if (uProgress >= 1.0) return 1.0;
    vec2 g = uv * uCells;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float m = 0.0;
    // The eight neighbours as well as this cell: a blob centred next door can
    // reach across the border, and it is that reach which merges them.
    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 o = vec2(float(i), float(j));
            float q = clamp((uProgress - aboutmeDelay(id + o) * (1.0 - ABOUTME_GROW))
                            / ABOUTME_GROW, 0.0, 1.0);
            float r = ABOUTME_R * (1.0 - pow(1.0 - q, 3.0));
            m = max(m, smoothstep(r, r - 0.05, length(f - o)));
        }
    }
    return m;
}
`;

// Decoded photos by index, and the promise for each in flight.
const aboutmeImages = [];
const aboutmeLoads = [];
function aboutmeLoadPhoto(i) {
    if (aboutmeLoads[i]) return aboutmeLoads[i];
    const img = new Image();
    aboutmeLoads[i] = new Promise((resolve, reject) => {
        img.onload = () => { aboutmeImages[i] = img; resolve(img); };
        img.onerror = reject;
    });
    img.src = ABOUTME_PHOTOS[i];
    return aboutmeLoads[i];
}

// Filled in by loadCard0 once the face exists. Until then every entry point
// below returns without doing anything, which is what makes a hover during the
// intro harmless.
const aboutmeSwap = {
    ready: false,
    index: 0,        // which photo the card is showing
    busy: false,     // a reveal is in flight
    building: false,
    faces: [],       // { canvas, ctx, texture, theme } per photo, painted on demand
};

function aboutmeIdle(fn) {
    if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 3000 });
    else setTimeout(fn, 1200);
}

// Paint a whole second face for a photo, off screen. This is the expensive
// part — tens of milliseconds, plus one texture upload the first time it is
// drawn — so it happens once per photo, on idle, and never during a reveal.
// Faces are kept rather than rebuilt: after one pass round the deck, hovering
// costs nothing at all.
function aboutmeBuildFace(i) {
    const a = aboutmeSwap;
    if (!a.ready || a.building) return;
    const have = a.faces[i];
    if (have && have.theme === currentTheme) return;
    a.building = true;
    aboutmeLoadPhoto(i).then((img) => {
        let face = a.faces[i];
        if (!face) {
            const canvas = document.createElement('canvas');
            canvas.width = a.faces[0].canvas.width;
            canvas.height = a.faces[0].canvas.height;
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            const texture = new THREE.CanvasTexture(canvas);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = a.faces[0].texture.anisotropy;
            face = { canvas: canvas, ctx: ctx, texture: texture, theme: null };
            a.faces[i] = face;
        }
        a.paint(face.ctx, currentTheme, img);
        face.theme = currentTheme;
        face.texture.needsUpdate = true;
        // Hand it to the GPU now rather than letting the renderer do it on the
        // first frame that samples it. Six megabytes going up mid-reveal is a
        // dropped frame exactly where it is most visible; here it lands in the
        // same idle slot that painted the face.
        renderer.initTexture(face.texture);
        a.building = false;
    }, () => { a.building = false; });
}

function aboutmePrepareNext() {
    const a = aboutmeSwap;
    if (a.ready) aboutmeBuildFace((a.index + 1) % ABOUTME_PHOTOS.length);
}

function startAboutmeSwap() {
    const a = aboutmeSwap;
    if (!a.ready || a.busy) return;
    const next = (a.index + 1) % ABOUTME_PHOTOS.length;
    const face = a.faces[next];
    // Not painted yet, or painted before the last theme change: the first
    // hover of the session, or one that beat the idle callback. Get it ready
    // for next time rather than stalling the scene to paint a face now.
    if (!face || face.theme !== currentTheme) {
        aboutmeBuildFace(next);
        return;
    }
    a.busy = true;
    a.uniforms.uMapB.value = face.texture;
    const p1 = Math.random() * Math.PI * 2, p2 = Math.random() * Math.PI * 2;
    a.uniforms.uDirA.value.set(Math.cos(p1), Math.sin(p1));
    a.uniforms.uDirB.value.set(Math.cos(p2), -Math.sin(p2));
    a.uniforms.uSeed.value = Math.random() * 100;

    const t0 = performance.now();
    (function frame() {
        const p = Math.min(1, (performance.now() - t0) / ABOUTME_SWAP_MS);
        a.uniforms.uProgress.value = p;
        if (p < 1) { requestAnimationFrame(frame); return; }
        // Landed. The incoming face becomes the card's own map and the mask
        // goes back to zero, so the next reveal starts from a clean sheet.
        a.material.map = face.texture;
        a.uniforms.uProgress.value = 0;
        a.index = next;
        a.busy = false;
        aboutmeIdle(aboutmePrepareNext);
    })();
}

function loadCard0() {
    const s = ABOUTME_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = ABOUTME_DESIGN.w * s;
    canvas.height = ABOUTME_DESIGN.h * s;
    const ctx = canvas.getContext('2d');

    const photo = new Image();
    photo.src = ABOUTME_PHOTOS[0];
    aboutmeImages[0] = photo;
    aboutmeLoads[0] = new Promise((resolve) => { photo.onload = () => resolve(photo); });

    Promise.all([
        // document.fonts.ready alone is not enough: it settles once the fonts
        // the *document* asked for have arrived, and index.html renders nothing
        // in Play, so the face used to paint its name in whatever sans-serif
        // the canvas fell back to — 2% wider than Play, which is why the name
        // never quite sat where the design put it. Naming the faces this card
        // draws with is what actually fetches them.
        document.fonts.ready,
        document.fonts.load(`700 ${80 * s}px "Play"`),
        document.fonts.load(`italic 400 ${36 * s}px "Inter"`),
        document.fonts.load(`600 ${ABOUTME_PILL_FONT_PX}px "DM Sans"`),
        aboutmeLoads[0],
    ]).then(() => {
        const r = 36 * s;
        // Set once, up front — save()/restore() below would otherwise
        // revert this back to the canvas default partway through drawing.
        function smoothing(c) {
            c.imageSmoothingEnabled = true;
            c.imageSmoothingQuality = 'high';
        }
        smoothing(ctx);

        // Takes its context and its photo rather than closing over them: the
        // hover reveal paints a second, identical face off screen with the next
        // photo in it, and there is no version of that which should be allowed
        // to drift from the one on screen.
        function paint(ctx, theme, img) {
            const canvas = ctx.canvas;
            const { cardBg, ink } = THEME_COLORS[theme];

            // Background + photo, clipped to the card's rounded corners
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, r);
            ctx.clip();
            ctx.fillStyle = cardBg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Clip to the silhouette first, then blur — so the blur only ever
            // softens the photo's interior and never bleeds across the mask edge.
            const maskPath = new Path2D();
            maskPath.addPath(new Path2D(ABOUTME_PHOTO_MASK), new DOMMatrix([s, 0, 0, s, 0, 0]));
            ctx.save();
            ctx.clip(maskPath);
            // Figma's transform for this fill, in design px. Overscanning by the
            // blur radius keeps the blur from fading out against the mask edge;
            // it grows uniformly so the photo's aspect ratio is preserved.
            const pw = 1110.777, ph = 1404;
            const bleed = ABOUTME_PHOTO_BLUR * 2;
            const k = Math.max(1 + (bleed * 2) / pw, 1 + (bleed * 2) / ph);
            ctx.filter = `blur(${ABOUTME_PHOTO_BLUR * s}px)`;
            // Cover rather than a straight stretch. The photo this card was
            // built with is exactly the box's shape, so this changes nothing
            // for it; the three the hover walks through are 2:3, 1:1 and 3:4,
            // and stretching those to fit would be unmissable.
            tmplDrawImageCover(
                ctx,
                img,
                (-25.888 - (pw * k - pw) / 2) * s,
                (20 - (ph * k - ph) / 2) * s,
                pw * k * s,
                ph * k * s,
            );
            ctx.filter = 'none';
            ctx.restore();
            // Hairline around the photo silhouette
            ctx.strokeStyle = ink;
            ctx.lineWidth = s;
            ctx.stroke(maskPath);
            // …then the stock-coloured shelf laid over its bottom-right corner,
            // which is what the pills sit on. Drawn after the hairline on
            // purpose: the design's cut edge carries no stroke, and covering
            // that stretch of it is how Figma gets the same result.
            const cutPath = new Path2D();
            cutPath.addPath(new Path2D(ABOUTME_BOTTOM_CUT), ABOUTME_CUT_MATRIX(s));
            ctx.fillStyle = cardBg;
            ctx.fill(cutPath);
            ctx.restore();

            // Figma positions text by its line box; canvas draws from a baseline.
            // Deriving the baseline from the font's own metrics is what keeps these
            // landing where the design says, instead of a hand-tuned offset.
            function drawBoxedText(text, x, y, w, h, align, mode) {
                const m = ctx.measureText(text);
                ctx.textAlign = align;
                ctx.textBaseline = 'alphabetic';
                const inner = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
                const baseline = y + (h - inner) / 2 + m.fontBoundingBoxAscent;
                const tx = align === 'center' ? x + w / 2 : x;
                if (mode === 'stroke') ctx.strokeText(text, tx, baseline);
                else ctx.fillText(text, tx, baseline);
            }

            // "#000" tag, sitting over the folded corner — the one bit of ink on
            // this card that lands on bare stock, so it's the one that follows it
            ctx.fillStyle = ink;
            ctx.font = `italic 400 ${36 * s}px "Inter", "DM Sans", sans-serif`;
            drawBoxedText('#000', 56 * s, 24 * s, 91 * s, 44 * s, 'center');

            // Name. Both colours here are fixed in both themes, on purpose: the
            // folded corner clears this text, so it sits on the photo's sky
            // rather than on the stock, and the photo does not follow the theme.
            // Black glyphs inside a white outline is what the design uses to
            // hold them apart from the sky, and that reads the same either way.
            // Stroke first, fill over it, so the halo only ever sits outside the
            // glyphs and the letterforms keep their designed weight — 4px of
            // stroke straddling the path leaves the 2px the design shows.
            ctx.font = `700 ${80 * s}px "Play", sans-serif`;
            ctx.lineJoin = 'round';
            ctx.miterLimit = 2;
            ctx.lineWidth = 4 * s;
            ctx.strokeStyle = '#fff';
            drawBoxedText('Jennifer Huang', 205 * s, 35 * s, 572 * s, 93 * s, 'left', 'stroke');
            ctx.fillStyle = '#000';
            drawBoxedText('Jennifer Huang', 205 * s, 35 * s, 572 * s, 93 * s, 'left');

            // Tag pills — outline only, on the bare stock of the shelf, so they
            // follow the theme's ink. Widths come from the design rather than text
            // measurement, so a font that metrics slightly differently can't drift
            // the row out of place.
            function drawPill(label, x, w) {
                const y = ABOUTME_PILL_Y * s, h = ABOUTME_PILL_H * s;
                // Figma's border sits inside the pill's box; a canvas stroke
                // straddles the path, so inset the path by half the weight to
                // put the same 3px band in the same place.
                const lw = ABOUTME_PILL_STROKE * s, inset = lw / 2;
                ctx.beginPath();
                ctx.roundRect(x * s + inset, y + inset, w * s - lw, h - lw, h / 2 - inset);
                ctx.lineWidth = lw;
                ctx.strokeStyle = ink;
                ctx.stroke();
                ctx.fillStyle = ink;
                // DM Sans is optically sized, and canvas derives that axis from the
                // font size — at 40px it picks noticeably narrower letterforms than
                // the design's opsz 14. Drawing small and scaling up restores them.
                const k = (40 * s) / ABOUTME_PILL_FONT_PX;
                ctx.save();
                ctx.scale(k, k);
                ctx.font = `600 ${ABOUTME_PILL_FONT_PX}px "DM Sans", sans-serif`;
                drawBoxedText(label, (x * s) / k, y / k, (w * s) / k, h / k, 'center');
                ctx.restore();
            }
            ABOUTME_PILLS.forEach((p) => drawPill(p.label, p.x, p.w));

            // Slight paper-grain overlay, same as the rest of the deck
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, r);
            ctx.clip();
            ctx.globalAlpha = 0.05;
            ctx.globalCompositeOperation = 'overlay';
            ctx.fillStyle = ctx.createPattern(grainTex.image, 'repeat');
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        paint(ctx, currentTheme, photo);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        aboutmeSwap.faces[0] = { canvas: canvas, ctx: ctx, texture: texture, theme: currentTheme };
        cardFaceRepaints.push({
            index: 0,
            repaint: (theme) => {
                const live = aboutmeSwap.faces[aboutmeSwap.index] || aboutmeSwap.faces[0];
                paint(live.ctx, theme, aboutmeImages[aboutmeSwap.index] || photo);
                live.theme = theme;
                live.texture.needsUpdate = true; // three.js re-uploads a canvas only when told to
                // Every other face in the deck now holds the wrong theme, but
                // repainting them all here is exactly the cost the staggering
                // in updateCardFaceTextures exists to avoid — and nobody is
                // looking at them. They are marked stale and rebuilt one at a
                // time, on idle, as the hover walks round to them.
                aboutmeSwap.faces.forEach((f, i) => { if (i !== aboutmeSwap.index) f.theme = null; });
                aboutmeIdle(aboutmePrepareNext);
            },
        });

        const aspect = ABOUTME_DESIGN.w / ABOUTME_DESIGN.h;
        const cardH = 1.7, cardW = cardH * aspect;
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });

        // The reveal is the card's own material with a second map and a mask,
        // rather than a shader of its own: patching MeshBasicMaterial keeps
        // three's colour management, and both maps are sampled through the same
        // sRGB path, so the mix happens between two colours that already agree.
        // The uniforms are made here rather than inside onBeforeCompile so the
        // swap can reach them before the material has ever been compiled.
        const uniforms = {
            uMapB: { value: texture },
            uProgress: { value: 0 },
            uCells: { value: new THREE.Vector2(
                ABOUTME_DESIGN.w / ABOUTME_BLOB_CELL, ABOUTME_DESIGN.h / ABOUTME_BLOB_CELL) },
            uDirA: { value: new THREE.Vector2(1, 0) },
            uDirB: { value: new THREE.Vector2(0, 1) },
            uSeed: { value: 0 },
        };
        frontMat.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, uniforms);
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>', '#include <common>\n' + ABOUTME_BLOB_GLSL)
                .replace('#include <map_fragment>', [
                    '#ifdef USE_MAP',
                    '  vec4 sampledDiffuseColor = mix(',
                    '    texture2D( map, vMapUv ), texture2D( uMapB, vMapUv ), aboutmeMask( vMapUv ) );',
                    '  diffuseColor *= sampledDiffuseColor;',
                    '#endif',
                ].join('\n'));
        };
        // Without this the patched program would be shared with every other
        // unpatched MeshBasicMaterial that happens to hash the same.
        frontMat.customProgramCacheKey = () => 'aboutme-reveal';

        Object.assign(aboutmeSwap, {
            ready: true, paint: paint, material: frontMat, uniforms: uniforms,
        });
        // The alternates are not part of the first paint, so the next one is
        // fetched and its face painted once the page has nothing better to do.
        aboutmeIdle(aboutmePrepareNext);
        const mesh = new THREE.Mesh(geometry, frontMat);
        const group = new THREE.Group();
        group.userData.cardIndex = 0;
        group.add(mesh);
        _placeCard(0, group);
    });
}
/////puregym -->
// Experiment: instead of shipping a single flattened 388KB JPEG for this
// card face, draw the design onto a canvas (vector text/shapes) and only
// load one real raster asset — the phone-mockup photo (~60KB JPEG) — then
// upload that canvas as a CanvasTexture. Same geometry/material pipeline as
// every other card, just a different texture source.
const PUREGYM_DESIGN = { w: 1059, h: 1449 }; // matches the Figma frame 1:1
// Canvas px per design px. Generating this texture costs zero network bytes
// (no file to download), so we render well past 1:1 to avoid the GPU having
// to magnify it — magnification blur reads as much softer on crisp vector
// text/edges than the same blur does on a photo, which is what made the
// flat JPEG card look "sharper" at the same nominal resolution.
const PUREGYM_SCALE = CARD_TEXTURE_SCALE;

function puregymWrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            ctx.fillText(line.trim(), x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line.trim(), x, y);
}

function puregymDrawPill(ctx, x, y, w, h, label, s, theme) {
    const { ink, rule } = THEME_COLORS[theme];
    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = rule;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = `600 ${40 * s}px "DM Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 2 * s);
}

function loadCard1() {
    const s = PUREGYM_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = PUREGYM_DESIGN.w * s;
    canvas.height = PUREGYM_DESIGN.h * s;
    const ctx = canvas.getContext('2d');

    const mockup = new Image();
    mockup.crossOrigin = 'anonymous';
    mockup.src = 'https://jhfyj.github.io/New-Website-Code/Cards/puregym-mockups.webp';

    Promise.all([
        document.fonts.ready,
        new Promise((resolve) => { mockup.onload = resolve; }),
    ]).then(() => {
        const r = 36 * s;

        function paint(theme) {
            const { cardBg, ink, inkSub, inkBody } = THEME_COLORS[theme];

            // Card stock, clipped to the card's rounded corners
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, r);
            ctx.clip();
            ctx.fillStyle = cardBg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();

            // Phone-mockup photo, clipped to the same rounded well + folded-corner
            // notch the template cards use (tmplPhotoClipPath), so this card's photo
            // box matches the rest of the deck instead of running square to the edges.
            // Cover rather than stretch: the mockup is 1250x1004 (1.2450) against a
            // 1016.663x817 well (1.2444), so the crop is sub-pixel and nothing of the
            // phones is lost — but it keeps the aspect honest like every other card.
            ctx.save();
            tmplPhotoClipPath(ctx, 21 * s, 20 * s, s);
            ctx.clip();
            tmplDrawImageCover(ctx, mockup, 21 * s, 20 * s, 1016.663 * s, 817 * s);
            ctx.restore();

            // "#003" — this card's position in the site's numbering (not Figma's placeholder number).
            // Sits in the folded-corner notch on bare stock, so it follows the theme's ink
            // like the template cards' tags do.
            ctx.fillStyle = ink;
            ctx.font = `italic 400 ${36 * s}px "DM Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('#003', 100.5 * s, 24 * s);

            // Title + date
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = ink;
            ctx.font = `700 ${96 * s}px "Play", sans-serif`;
            ctx.fillText('Puregym Redesign', 54 * s, 960 * s);
            ctx.fillStyle = inkSub;
            ctx.font = `400 ${64 * s}px "DM Sans", sans-serif`;
            ctx.fillText('Winter 2025', 54 * s, 1050 * s);

            // Description (wrapped to match the Figma column width)
            ctx.fillStyle = inkBody;
            ctx.font = `400 ${46 * s}px "DM Sans", sans-serif`;
            puregymWrapText(
                ctx,
                'Mobile redesign case study for Puregym focused on minimizing friction during check-in.',
                54 * s, 1150 * s, 901 * s, 58 * s
            );

            // Tag pills
            puregymDrawPill(ctx, 218 * s, 1354 * s, 242 * s, 68 * s, '2025-26', s, theme);
            puregymDrawPill(ctx, 472 * s, 1354 * s, 335 * s, 68 * s, 'CASE STUDY', s, theme);
            puregymDrawPill(ctx, 819 * s, 1354 * s, 219 * s, 68 * s, 'MOBILE', s, theme);

            // Slight paper-grain overlay — reuses the same procedural noise tile
            // as grainTex (see makeGrainTexture above), so it's free: no image
            // file, just a repeating pattern drawn from an in-memory canvas.
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, r);
            ctx.clip();
            ctx.globalAlpha = 0.05;
            ctx.globalCompositeOperation = 'overlay';
            ctx.fillStyle = ctx.createPattern(grainTex.image, 'repeat');
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        paint(currentTheme);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        cardFaceRepaints.push({
            index: 1,
            repaint: (theme) => {
                paint(theme);
                texture.needsUpdate = true; // three.js re-uploads a canvas only when told to
            },
        });

        const aspect = PUREGYM_DESIGN.w / PUREGYM_DESIGN.h;
        const cardH = 1.7, cardW = cardH * aspect;
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
        const mesh  = new THREE.Mesh(geometry, frontMat);
        const group = new THREE.Group();
        group.userData.cardIndex = 1;
        // What the face says, kept for the card → page hand-off above
        group.userData.cardTitle = 'Puregym Redesign';
        group.add(mesh);
        _placeCard(1, group);
    });
}

// ── Cards 2–7 — same treatment as the Puregym card (see loadCard1 above): a
// canvas-drawn texture instead of a single flattened JPEG. The top "photo"
// region of each card is cropped straight from that card's original flat
// JPEG (or, for BMW/Nenos, the client-supplied mockup) and re-compressed as
// WebP; the "#00X" tag and title/date/description/pills are drawn as vector
// text on top.
const TEMPLATE_CARD = { w: 1059, h: 1449 };
const TEMPLATE_CARD_SCALE = CARD_TEXTURE_SCALE;

function tmplWrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            ctx.fillText(line.trim(), x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line.trim(), x, y);
    return y + lineHeight;
}

// The photo region on every card is rounded-cornered with a "folded corner"
// cutout at top-left — that's where the "#00X" tag sits. This is traced
// directly from Figma's own vector path (node 1060:7, the Puregym card's
// "Subtract" layer — every card's photo box is the same 1016.663×817 size,
// so this exact geometry applies to all of them, not an approximation). It's
// not a simple arc: the notch rises from the left edge, holds briefly flat
// (the "equilibrium" plateau), then rises again into the diagonal and curves
// into the top edge — a compound S-curve, not a single bulge.
function tmplPhotoClipPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x + 992.662 * s, y);
    ctx.bezierCurveTo(x + 1005.92 * s, y, x + 1016.66 * s, y + 10.7452 * s, x + 1016.66 * s, y + 24 * s);
    ctx.lineTo(x + 1016.66 * s, y + 793 * s);
    ctx.bezierCurveTo(x + 1016.66 * s, y + 806.255 * s, x + 1005.92 * s, y + 817 * s, x + 992.662 * s, y + 817 * s);
    ctx.lineTo(x + 24 * s, y + 817 * s);
    ctx.bezierCurveTo(x + 10.7452 * s, y + 817 * s, x, y + 806.255 * s, x, y + 793 * s);
    ctx.lineTo(x, y + 111 * s);
    ctx.bezierCurveTo(x, y + 78 * s, x + 19.9 * s, y + 58.5 * s, x + 51.5 * s, y + 58.5 * s);
    ctx.lineTo(x + 117.932 * s, y + 58.5 * s);
    ctx.bezierCurveTo(x + 129.052 * s, y + 58.5 * s, x + 139.578 * s, y + 53.4981 * s, x + 146.604 * s, y + 44.8789 * s);
    ctx.lineTo(x + 167.294 * s, y + 19.5 * s);
    ctx.bezierCurveTo(x + 167.294 * s, y + 19.5 * s, x + 182 * s, y, x + 210 * s, y);
    ctx.closePath();
}

// drawImage's 5-arg form stretches the source to fill dw×dh, distorting any
// image whose aspect ratio doesn't match the photo box exactly (visible as a
// horizontal squeeze/stretch). This crops to dw×dh's aspect first — same as
// CSS `background-size: cover` — so the source is scaled uniformly and only
// centered ends are cropped off, never distorted.
function tmplDrawImageCover(ctx, img, dx, dy, dw, dh) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const srcAspect = iw / ih;
    const dstAspect = dw / dh;
    let sx, sy, sw, sh;
    if (srcAspect > dstAspect) {
        sh = ih;
        sw = ih * dstAspect;
        sx = (iw - sw) / 2;
        sy = 0;
    } else {
        sw = iw;
        sh = iw / dstAspect;
        sx = 0;
        sy = (ih - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
}

// Draws a pill sized to fit its label (unlike the Puregym card, these don't
// have Figma-exact pill widths to work from) and returns its width so the
// caller can lay out the next one.
function tmplDrawPill(ctx, x, y, h, label, s, theme) {
    const { ink, rule } = THEME_COLORS[theme];
    ctx.font = `600 ${40 * s}px "DM Sans", sans-serif`;
    const w = ctx.measureText(label).width + 80 * s;
    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = rule;
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 2 * s);
    return w;
}

function buildTemplateCardTexture({ imageSrc, tag, title, subtitle, accentLine, description, pills }) {
    const s = TEMPLATE_CARD_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = TEMPLATE_CARD.w * s;
    canvas.height = TEMPLATE_CARD.h * s;
    const ctx = canvas.getContext('2d');

    // No image yet (e.g. a placeholder card) — skip the network round-trip
    // entirely and just fall through to a flat gray fill below.
    const photo = imageSrc ? new Image() : null;
    if (photo) {
        photo.crossOrigin = 'anonymous';
        photo.src = imageSrc;
    }

    return Promise.all([
        document.fonts.ready,
        photo ? new Promise((resolve) => { photo.onload = resolve; }) : Promise.resolve(),
    ]).then(() => {
        const r = 36 * s;

        function paint(theme) {
            const { cardBg, accent, ink, inkSub, inkBody, placeholder } = THEME_COLORS[theme];

            ctx.save();
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, r);
            ctx.clip();
            ctx.fillStyle = cardBg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();

            ctx.save();
            tmplPhotoClipPath(ctx, 21 * s, 20 * s, s);
            ctx.clip();
            if (photo) {
                tmplDrawImageCover(ctx, photo, 21 * s, 20 * s, 1016.663 * s, 817 * s);
            } else {
                // Nothing photographic to protect here, so the empty photo box
                // tracks the stock rather than sitting on it as a bright slab.
                ctx.fillStyle = placeholder;
                ctx.fillRect(21 * s, 20 * s, 1016.663 * s, 817 * s);
            }
            ctx.restore();

            // Only draw the "#00X" tag ourselves when it isn't already baked
            // into the photo (see loadCard1 for the baked-in case).
            // Same position/size Figma uses for the real tag (node 1060:10) —
            // the exact notch shape above comfortably fits it as-is.
            if (tag) {
                ctx.fillStyle = ink;
                ctx.font = `italic 400 ${36 * s}px "DM Sans", sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.fillText(tag, 100.5 * s, 24 * s);
            }

            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = ink;
            ctx.font = `700 ${96 * s}px "Play", sans-serif`;
            ctx.fillText(title, 54 * s, 960 * s);
            ctx.fillStyle = inkSub;
            ctx.font = `400 ${64 * s}px "DM Sans", sans-serif`;
            ctx.fillText(subtitle, 54 * s, 1050 * s);

            ctx.font = `400 ${46 * s}px "DM Sans", sans-serif`;
            let y = 1150 * s;
            if (accentLine) {
                ctx.fillStyle = accent;
                y = tmplWrapText(ctx, accentLine, 54 * s, y, 901 * s, 58 * s);
            }
            ctx.fillStyle = inkBody;
            tmplWrapText(ctx, description, 54 * s, y, 901 * s, 58 * s);

            const pillH = 68 * s, gap = 24 * s;
            const widths = pills.map((label) => {
                ctx.font = `600 ${40 * s}px "DM Sans", sans-serif`;
                return ctx.measureText(label).width + 80 * s;
            });
            const totalW = widths.reduce((a, b) => a + b, 0) + gap * (pills.length - 1);
            let px = canvas.width - 21 * s - totalW; // right-align to the same inset the photo uses
            pills.forEach((label, i) => {
                px += tmplDrawPill(ctx, px, 1354 * s, pillH, label, s, theme) + gap;
            });

            // Slight paper-grain overlay — see loadCard1 for why this is free.
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, r);
            ctx.clip();
            ctx.globalAlpha = 0.05;
            ctx.globalCompositeOperation = 'overlay';
            ctx.fillStyle = ctx.createPattern(grainTex.image, 'repeat');
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        paint(currentTheme);
        return { canvas, paint };
    });
}

function loadTemplateCard(index, opts) {
    buildTemplateCardTexture(opts).then(({ canvas, paint }) => {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        cardFaceRepaints.push({
            index: index,
            repaint: (theme) => {
                paint(theme);
                texture.needsUpdate = true; // three.js re-uploads a canvas only when told to
            },
        });

        const aspect = TEMPLATE_CARD.w / TEMPLATE_CARD.h;
        const cardH = 1.7, cardW = cardH * aspect;
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
        const mesh = new THREE.Mesh(geometry, frontMat);
        const group = new THREE.Group();
        group.userData.cardIndex = index;
        // What the face says, kept for the card → page hand-off above
        group.userData.cardTitle = opts.title || '';
        group.add(mesh);
        _placeCard(index, group);
    });
}

// ── Card 2 — tech@nyu ────────────────────────────────────────────────────────
function loadCard2() {
    loadTemplateCard(2, {
        imageSrc: 'https://jhfyj.github.io/New-Website-Code/Cards/tech-mockups.webp',
        tag: '#001',
        title: 'tech@nyu',
        subtitle: 'Summer 2025',
        description: "Rebranding and website design for tech@nyu, NYU’s oldest tech-focused club.",
        pills: ['2025', 'BRANDING', 'UIUX'],
    });
}

// ── Card 3 — Clarus AI ───────────────────────────────────────────────────────
function loadCard3() {
    loadTemplateCard(3, {
        imageSrc: 'https://jhfyj.github.io/New-Website-Code/Cards/clarus-mockups.webp',
        tag: '#002',
        title: 'CLARUS.AI',
        subtitle: 'Fall 2025',
        description: 'Interactive installation focused on the question: what happens when using LLMs required more than just type and enter?',
        pills: ['2025', 'INSTALLATION', 'UIUX'],
    });
}

// ── Card 4 — POVI ────────────────────────────────────────────────────────────
function loadCard4() {
    loadTemplateCard(4, {
        imageSrc: 'https://jhfyj.github.io/New-Website-Code/Cards/povi-mockups.webp',
        tag: '#004',
        title: 'POVI',
        subtitle: 'Figbuild 2026',
        description: "Speculative design focused on the question: How can we design for a technology that doesn’t exist yet?",
        pills: ['2026', 'COMPETITION', 'MOBILE'],
    });
}

// ── Card 5 — The Dial ────────────────────────────────────────────────────────
function loadCard5() {
    loadTemplateCard(5, {
        imageSrc: 'https://jhfyj.github.io/New-Website-Code/Cards/the-dial-mockups.webp',
        tag: '#005',
        title: 'The Dial',
        subtitle: 'Summer 2026',
        accentLine: 'Open Doors x Framer 1st place winner',
        description: 'Interaction focused on the micro-details and what it means to express a moment',
        pills: ['2026', 'COMPETITION', 'INTERACTION'],
    });
}

// ── Card 6 — BMW Designworks ─────────────────────────────────────────────────
function loadCard6() {
    loadTemplateCard(6, {
        imageSrc: 'https://jhfyj.github.io/New-Website-Code/Cards/bmw-mockups.webp',
        tag: '#006',
        title: 'BMW Designworks',
        subtitle: 'Summer 2026',
        description: 'Product Design Internship across B2B, SAS, consumer, and more at BMW Designworks.',
        pills: ['2026', 'INTERNSHIP', 'UI/UX'],
    });
}

// ── Card 7 — Nenos Inc. ───────────────────────────────────────────────────────
function loadCard7() {
    loadTemplateCard(7, {
        imageSrc: 'https://jhfyj.github.io/New-Website-Code/Cards/nenos-mockups.webp',
        tag: '#007',
        title: 'Nenos Inc.',
        subtitle: 'Summer 2026',
        description: 'Design Manager working with 7 designers to design the Places feature in a B2C product, from ideation to handoff.',
        pills: ['2026', 'INTERNSHIP', 'LEADERSHIP'],
    });
}

// ── Card 8 — Sketchbook ──────────────────────────────────────────────────────
// Kept next to card 0 (About Me) — they're adjacent in the ring (8 and 0 sit
// next to each other since the carousel wraps around).

// ── Card 9 — make your own ───────────────────────────
//
// The tenth card starts blank, and it is the only one that goes nowhere:
// clicking it opens the kit over this same page. No navigation, no second
// document, and nothing it makes leaves the tab it was made in.
const CUSTOMIZE_INDEX = 9;
const CUSTOMIZE_KEY = 'hfyj:my-card';

// How far the chosen card lifts, and how far the rest of the ring falls away
// beneath it. The lift is small: the card is already the thing being looked at,
// so it only has to read as stepping forward, not as leaving.
const CUSTOMIZE_RISE_Y = 0.55;
const CUSTOMIZE_DROP_Y = -9;
const CUSTOMIZE_EASE = 0.11;
// Long enough for the ring to clear out from under the card before the kit
// arrives over it.
const CUSTOMIZE_HANDOFF_MS = 460;

// The whole ring slides left as it opens, so the card comes to rest in the
// space the panels leave rather than behind them. Below the width where the
// kit stacks, there is nothing to make room for.
function customizeShiftX() {
    return window.innerWidth <= 900 ? 0 : -0.9;
}

// Where card 9 actually is on screen, in CSS pixels. The card being drawn on
// is a DOM canvas and the card in the ring is a WebGL mesh; this is what lets
// the second one be put down exactly where the first one is, so the swap
// between them is not visible.
function customizeCardRect() {
    const card = cards[CUSTOMIZE_INDEX];
    if (!card || !card.children.length) return null;
    const mesh = card.children[0];
    mesh.updateWorldMatrix(true, false);
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    [[bb.min.x, bb.min.y], [bb.max.x, bb.min.y],
     [bb.max.x, bb.max.y], [bb.min.x, bb.max.y]].forEach(([x, y]) => {
        const v = new THREE.Vector3(x, y, 0).applyMatrix4(mesh.matrixWorld).project(camera);
        const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
        const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
    });
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Puts the drawn card, and the buttons under it, on the ring card's footprint.
function pinCustomizeCard() {
    const host = document.getElementById('card-builder');
    if (!host || !customizeKit) return;
    const rect = customizeCardRect();
    const wrap = host.querySelector('.cb-card-wrap');
    const actions = host.querySelector('.cb-actions');
    if (!rect || !wrap) return;
    host.classList.add('is-pinned');
    wrap.style.left = rect.x + 'px';
    wrap.style.top = rect.y + 'px';
    wrap.style.width = rect.w + 'px';
    wrap.style.height = rect.h + 'px';
    if (actions) {
        actions.style.left = rect.x + 'px';
        actions.style.top = (rect.y + rect.h + 22) + 'px';
        actions.style.width = rect.w + 'px';
    }
}

function unpinCustomizeCard() {
    const host = document.getElementById('card-builder');
    if (!host) return;
    host.classList.remove('is-pinned');
    ['.cb-card-wrap', '.cb-actions'].forEach((sel) => {
        const n = host.querySelector(sel);
        if (!n) return;
        n.style.left = n.style.top = n.style.width = n.style.height = '';
    });
}

const cardCustomizeY = new Array(cardCount).fill(0);
let customizeOpen = false;
let customizeKit = null;
let customizeHandoff = null;
let customizeFace = null;   // { ctx, texture } once card 9 has been built

// The model lives here rather than inside the kit, so the card in the ring can
// be painted from it before the kit has ever been mounted — someone who made a
// card, went back to the carousel and reloaded still sees it on the ring
// without the overlay being built at all.
const customizeModel = newModel();

// sessionStorage, deliberately and only. The card belongs to whoever drew it,
// it is not ours to keep, and it goes when the tab does. Nothing about it is
// ever sent anywhere — there is no request in this file.
function saveCustomizeCard() {
    try {
        sessionStorage.setItem(CUSTOMIZE_KEY, JSON.stringify({
            brush: customizeModel.brush, color: customizeModel.color,
            size: customizeModel.size, number: customizeModel.number,
            tags: customizeModel.tags, items: customizeModel.items,
        }));
    } catch (err) { /* private mode, or full — the card simply is not kept */ }
}

function restoreCustomizeCard() {
    try {
        const raw = sessionStorage.getItem(CUSTOMIZE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (!saved || !Array.isArray(saved.items)) return;
        customizeModel.brush = saved.brush || customizeModel.brush;
        customizeModel.color = saved.color || customizeModel.color;
        customizeModel.size = Number(saved.size) || customizeModel.size;
        customizeModel.number = typeof saved.number === 'string' ? saved.number : '';
        if (Array.isArray(saved.tags)) {
            for (let i = 0; i < customizeModel.tags.length; i++) {
                customizeModel.tags[i] = typeof saved.tags[i] === 'string' ? saved.tags[i] : '';
            }
        }
        customizeModel.items.length = 0;
        saved.items.forEach((it) => customizeModel.items.push(it));
    } catch (err) { /* nothing stored, or not ours — start blank */ }
}

// The ring card and the card in the kit are the same drawing at two sizes.
function repaintCustomizeFace() {
    if (!customizeFace) return;
    drawCard(customizeFace.ctx, customizeModel, CARD_TEXTURE_SCALE);
    customizeFace.texture.needsUpdate = true;
}

function loadCard9() {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(CARD_DESIGN.W * CARD_TEXTURE_SCALE);
    canvas.height = Math.round(CARD_DESIGN.H * CARD_TEXTURE_SCALE);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    restoreCustomizeCard();
    drawCard(ctx, customizeModel, CARD_TEXTURE_SCALE);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    customizeFace = { ctx: ctx, texture: texture };
    // The stock is themed, so a toggle has to reach the canvas; drawCard reads
    // the theme off the document itself, so repainting is the whole job.
    cardFaceRepaints.push({ index: CUSTOMIZE_INDEX, repaint: repaintCustomizeFace });

    const aspect = CARD_DESIGN.W / CARD_DESIGN.H;
    const cardH = 1.7, cardW = cardH * aspect;
    const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
    const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
    const group = new THREE.Group();
    group.userData.cardIndex = CUSTOMIZE_INDEX;
    group.add(new THREE.Mesh(geometry, frontMat));
    _placeCard(CUSTOMIZE_INDEX, group);
}

// Built on first open rather than at load: it is a canvas widget and a few
// dozen DOM nodes that most visits never ask for, and the intro has better
// things to do with those frames.
function ensureCustomizeKit() {
    if (customizeKit) return customizeKit;
    const host = document.getElementById('card-builder');
    if (!host) return null;
    customizeKit = mountCardBuilder(host);
    customizeKit.load(customizeModel);
    // Every mark reaches the ring card and the session store as it is made, so
    // leaving by any route — a scroll, Escape, a reload — keeps what was drawn.
    // Save is the same promise as scrolling down: the card is kept for the
    // session and the carousel comes back with it on the ring. Everything is
    // already written on every change, so this is a way out, not a commit.
    customizeKit.onSave = () => closeCustomize();
    customizeKit.onChange = (m) => {
        customizeModel.brush = m.brush;
        customizeModel.color = m.color;
        customizeModel.size = m.size;
        customizeModel.number = m.number;
        // Copies, not the kit's own arrays. Aliasing them means the next
        // kit.load(customizeModel) empties the very array it is about to read
        // back, and the card silently loses everything on it.
        customizeModel.tags = m.tags.slice();
        customizeModel.items = m.items.slice();
        repaintCustomizeFace();
        saveCustomizeCard();
    };
    return customizeKit;
}

function openCustomize() {
    if (customizeOpen) return;
    customizeOpen = true;
    currentView = 'customize';
    // The ring is parked, not just ignored: momentum, the snap easing and the
    // idle auto-rotate would all keep turning the card out from under the kit.
    isFlinging = false;
    autoRotating = false;
    targetRotation = null;
    hoveredCard = null;
    lastPaperCard = null;
    cardCursor.classList.remove('visible');
    dotCursor.classList.remove('visible');
    document.body.classList.add('customizing');

    clearTimeout(customizeHandoff);
    customizeHandoff = setTimeout(() => {
        const kit = ensureCustomizeKit();
        if (!kit) return;
        kit.load(customizeModel);
        kit.refresh();

        // Land the rise exactly before measuring, and put the card where the
        // render loop is going to leave it rather than where it has got to.
        // Two things move it: the eased lift, which at any given moment is
        // merely close to its target, and the hover lift it still carries from
        // being clicked — which decays to nothing over the next few frames and
        // would slide the card out from under the pin.
        const ringCard = cards[CUSTOMIZE_INDEX];
        cardHoverY[CUSTOMIZE_INDEX] = 0;
        cardCustomizeY[CUSTOMIZE_INDEX] = CUSTOMIZE_RISE_Y;
        if (ringCard) ringCard.position.y = CUSTOMIZE_RISE_Y;
        cardgroup.position.x = customizeShiftX();
        cardgroup.updateMatrixWorld(true);

        pinCustomizeCard();
        // Anything the pointer put back up during the rise goes now, before
        // the kit covers the canvas and strands it there.
        cardCursor.classList.remove('visible');
        dotCursor.classList.remove('visible');
        document.getElementById('card-builder').classList.add('visible');
        // The ring card goes out in the same frame the drawn one comes up, on
        // the same footprint, so there is nothing to see between them. The
        // WebGL canvas itself stays exactly where it was — fading it out is
        // what made this read as leaving for another page.
        if (ringCard) ringCard.visible = false;
    }, CUSTOMIZE_HANDOFF_MS);
}

function closeCustomize() {
    if (!customizeOpen) return;
    customizeOpen = false;
    currentView = 'cards';
    clearTimeout(customizeHandoff);
    saveCustomizeCard();
    repaintCustomizeFace();
    const host = document.getElementById('card-builder');
    if (host) host.classList.remove('visible');
    // The ring card comes back before the kit has finished fading, so the card
    // is never missing from the scene — it is simply handed back.
    const ringCard = cards[CUSTOMIZE_INDEX];
    if (ringCard) ringCard.visible = true;
    unpinCustomizeCard();
    document.body.classList.remove('customizing');
    resetIdleTimer();
}

// The pin is measured in CSS pixels, so a resize invalidates it.
window.addEventListener('resize', () => {
    if (customizeOpen) pinCustomizeCard();
});

// A read-only window onto the ring, for the drivers in pw-driver/. The rise
// happens in WebGL and the canvas is faded out by the time the kit is up, so
// there is otherwise no way to tell a card that lifted from one that did not.
// Localhost only: nothing about the internals is exposed on the live site.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__probe = {
        customizeY: () => cardCustomizeY.slice(),
        customizeOpen: () => customizeOpen,
        cardCount: () => cardCount,
        ringX: () => cardgroup.position.x,
        rotationY: () => cardgroup.rotation.y,
        // Where the ring's own card 9 is on screen. The drawn card is supposed
        // to be sitting exactly on top of this.
        cardRect: () => customizeCardRect(),
        cardVisible: () => !!(cards[CUSTOMIZE_INDEX] && cards[CUSTOMIZE_INDEX].visible),
    };
}

function loadCard8() {
    texLoader.load("https://jhfyj.github.io/New-Website-Code/Cards/SKETCH.jpg", (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image.naturalWidth / texture.image.naturalHeight || 1.586;
        const cardH = 1.7, cardW = cardH * aspect;
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
        const mesh  = new THREE.Mesh(geometry, frontMat);
        const group = new THREE.Group();
        group.userData.cardIndex = 8;
        group.add(mesh);
        _placeCard(8, group);
    });
}

loadCard0();
loadCard1();
loadCard2();
loadCard3();
loadCard4();
loadCard5();
loadCard6();
loadCard7();
loadCard8();
loadCard9();

scene.add(cardgroup);

// Scroll handling
window.addEventListener("wheel", (e) => {
    if (currentView === 'grid') return; // allow normal scroll in grid view
    // Scrolling down is how the kit is left: the card is kept, and the
    // carousel comes back up under it. Scrolling up inside the kit does
    // nothing, so a trackpad nudge cannot throw the visitor out mid-stroke.
    if (customizeOpen) {
        e.preventDefault();
        if (e.deltaY > 12) closeCustomize();
        return;
    }
    e.preventDefault();
    resetIdleTimer();
    if (introPhase === 'waitForScroll') { playWhooshThrottled(); triggerDealing(); return; }
    if (introPhase !== 'done') return;
    // deltaY = vertical scroll/swipe, deltaX = horizontal two-finger trackpad swipe
    hoveredCard = null;
    lastScrollMs = performance.now();
    card0TiltTargX = 0; card0TiltTargY = 0;
    playWhooshThrottled(); // faint paper whoosh while cards scroll past
    isFlinging = false;
    cardgroup.rotation.y += (e.deltaY - e.deltaX) * 0.002;
    targetRotation = null;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => snaptoNearestCard(), 100);
}, { passive: false });

// Touch handling — only responsible for the swipe-down-to-reveal intro gesture.
// Actual carousel drag/spin is handled exclusively by the pointerdown/move/up
// handlers below (pointer events fire for touch too), so there's a single
// source of truth for rotation instead of two systems fighting over the same
// gesture on different axes.
canvas.addEventListener("touchstart", (e) => {
    resetIdleTimer();
    if (e.touches.length !== 1) return;
    swipeStartY = e.touches[0].clientY;
    swipeMoved = false;
}, { passive: true });

canvas.addEventListener("touchmove", (e) => {
    resetIdleTimer();
    if (e.touches.length !== 1) return;
    if (introPhase !== 'waitForScroll') return;

    const y = e.touches[0].clientY;
    const dyFromStart = y - swipeStartY;
    if (!swipeMoved && Math.abs(dyFromStart) > 8) swipeMoved = true;
    if (swipeMoved) triggerDealing();
}, { passive: true });

// Hover detection via mousemove
window.addEventListener('mousemove', (e) => {
    resetIdleTimer();
    // If we see real mouse movement, override a false-negative from the media query
    if (!hasFinePointer && (e.movementX || e.movementY)) hasFinePointer = true;
    if (!hasFinePointer) return; // touch devices — no cursor label

    dotCursor.style.left = e.clientX + 'px';
    dotCursor.style.top = e.clientY + 'px';

    // In grid view, show pill cursor over grid cards, dot cursor elsewhere
    if (currentView === 'grid') {
        cardCursor.style.left = e.clientX + 'px';
        cardCursor.style.top = e.clientY + 'px';
        const gridCard = e.target.closest('.grid-card');
        if (gridCard) {
            const alt = gridCard.querySelector('img')?.alt || '';
            if (alt === 'About Me') {
                cardCursor.textContent = 'about me';
            } else if (alt === 'Sketchbook') {
                cardCursor.textContent = 'view sketchbook';
            } else if (gridCard.dataset.comingSoon !== undefined) {
                cardCursor.textContent = 'coming soon';
            } else {
                cardCursor.textContent = 'open project';
            }
            cardCursor.classList.add('visible');
            dotCursor.classList.remove('visible');
        } else {
            cardCursor.classList.remove('visible');
            dotCursor.classList.add('visible');
        }
        return;
    }

    if (customizeOpen) {
        cardCursor.classList.remove('visible');
        dotCursor.classList.remove('visible');
        canvas.style.cursor = '';
        return;
    }

    cardCursor.style.left = e.clientX + 'px';
    cardCursor.style.top = e.clientY + 'px';

    if (isDragging || scrubberDragging) {
        hoveredCard = null;
        lastPaperCard = null;
        cardCursor.classList.remove('visible');
        dotCursor.classList.add('visible');
        canvas.style.cursor = 'none';
        return;
    }

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(cardgroup.children, true);
    if (hits.length > 0) {
        const root = findCardRoot(hits[0].object);
        if (root) {
            // Paper rustle plays once when hover starts on a new card, not while
            // the carousel is actively scrolling past the cursor
            if (root !== lastPaperCard && introPhase === 'done' && !isRecentlyScrolling()) sfx.paper();
            lastPaperCard = root;
            hoveredCard = root;
            // Only tilt card 0 when the mouse is directly over it
            if (introPhase === 'waitForScroll' ) {
                card0TiltTargY = ((e.clientX / window.innerWidth)  - 0.5) * 2 * CARD0_TILT_MAX;
                card0TiltTargX =  ((e.clientY / window.innerHeight) - 0.5) * 2 * CARD0_TILT_MAX;
            }
            cardCursor.classList.add('visible');
            dotCursor.classList.remove('visible');
            canvas.style.cursor = 'none';
            if (introPhase === 'waitForScroll') {
                cardCursor.textContent = 'scroll down';
            } else {
                const idx = root.userData.cardIndex;
                if (idx === CUSTOMIZE_INDEX) setCardCursor('customize', PEN_ICON);
                else setCardCursor(idx === 0 ? 'about me'
                    : idx === 8 ? 'view sketchbook'
                    : COMING_SOON_INDICES.has(idx) ? 'coming soon'
                    : 'open project');
            }
        } else {
            hoveredCard = null;
            lastPaperCard = null;
            card0TiltTargX = 0;
            card0TiltTargY = 0;
            cardCursor.classList.remove('visible');
            dotCursor.classList.add('visible');
            canvas.style.cursor = 'none';
        }
    } else {
        hoveredCard = null;
        lastPaperCard = null;
        card0TiltTargX = 0;
        card0TiltTargY = 0;
        cardCursor.classList.remove('visible');
        dotCursor.classList.add('visible');
        canvas.style.cursor = 'none';
    }
});

canvas.addEventListener('mouseleave', () => {
    hoveredCard = null;
    lastPaperCard = null;
    card0TiltTargX = 0;
    card0TiltTargY = 0;
    cardCursor.classList.remove('visible');
    dotCursor.classList.remove('visible');
    canvas.style.cursor = '';
});

// Click handling
canvas.addEventListener("click", (event) => {
    resetIdleTimer();
    if (hasDragged || introPhase !== 'done') return;

    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    checkCardIntersections();
});

function findCardRoot(obj) {
    let cur = obj;
    while (cur) {
        if (cur.userData && Number.isInteger(cur.userData.cardIndex)) return cur;
        cur = cur.parent;
    }
    return null;
}

function getFrontCard() {
    const worldPos = new THREE.Vector3();
    let frontCard = null;
    let maxZ = -Infinity;
    cards.forEach((card) => {
        if (!card) return;
        card.getWorldPosition(worldPos);
        if (worldPos.z > maxZ) {
            maxZ = worldPos.z;
            frontCard = card;
        }
    });
    return frontCard;
}

function checkCardIntersections() {
    const hits = raycaster.intersectObjects(cardgroup.children, true);
    if (!hits.length) return;

    const clickedRoot = findCardRoot(hits[0].object);
    if (!clickedRoot) return;

    const front = getFrontCard();

    // If the clicked card is the front card, navigate — unless it's a
    // Coming Soon card with no real page to go to yet
    if (front && clickedRoot === front) {
        openCard(front.userData.cardIndex);
        return;
    }

    // Otherwise rotate the carousel to bring the clicked card to the front
    const clickedIdx = clickedRoot.userData.cardIndex;
    const cardAngle = THREE.MathUtils.degToRad((clickedIdx * 360) / cardCount);
    const rawTarget = -cardAngle;
    const current = cardgroup.rotation.y;
    const TWO_PI = Math.PI * 2;
    let diff = rawTarget - current;
    diff = diff - Math.round(diff / TWO_PI) * TWO_PI;
    isFlinging = false;
    targetRotation = current + diff;
}


// Dot cursor press effect
window.addEventListener('pointerdown', () => {
    dotCursor.classList.add('pressed');
});
window.addEventListener('pointerup', () => dotCursor.classList.remove('pressed'));

// Drag rotation
canvas.addEventListener("pointerdown", (e) => {
    resetIdleTimer();
    if (scrubberDragging) return;   // ignore if scrubber is active

    if (introPhase !== 'done') return; // no dragging during intro
    isDragging = true;
    isFlinging = false;
    pointerRotSamples = [];
    previousMouseX = e.clientX;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    hasDragged = false;
});

window.addEventListener("pointerup", (e) => {
    if (scrubberDragging) return;   // scrubber handles its own release
    if (!isDragging) return;
    isDragging = false;
    startFlingOrSnap(velocityFromSamples(pointerRotSamples));
    setTimeout(() => { hasDragged = false; }, 50);
});

canvas.addEventListener("pointermove", (e) => {
    if (scrubberDragging) return;   // scrubber owns the pointer
    if (!isDragging) return;

    const totalDx = Math.abs(e.clientX - dragStartX);
    const totalDy = Math.abs(e.clientY - dragStartY);
    if (totalDx > DRAG_THRESHOLD || totalDy > DRAG_THRESHOLD) hasDragged = true;

    hoveredCard = null;
    card0TiltTargX = 0; card0TiltTargY = 0;
    const dx = e.clientX - previousMouseX;
    previousMouseX = e.clientX;
    cardgroup.rotation.y += dx * 0.003;
    recordRotSample(pointerRotSamples);
});

// ── Spin particles (2D overlay) ──────────────────────────────────────────────
const spinCanvas = document.createElement('canvas');
spinCanvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99997;';
spinCanvas.width = window.innerWidth;
spinCanvas.height = window.innerHeight;
document.body.appendChild(spinCanvas);
const spinCtx = spinCanvas.getContext('2d');

const SPIN_PALETTE = [
    '#dc4a26', '#ca8a04', '#e96a9f', '#7c3aed', '#0891b2',
];
const spinParticles = [];
const SPIN_SPEED_THRESHOLD = 25; // min px/frame mouse speed to emit
const SPIN_EMIT_RATE = 3;        // particles per qualifying frame

function emitSpinParticles(x, y, speed) {
    const count = Math.min(Math.floor((speed - SPIN_SPEED_THRESHOLD) / 25) + 1, SPIN_EMIT_RATE);
    for (let i = 0; i < count; i++) {
        spinParticles.push({
            x: x + (Math.random() - 0.5) * 10,
            y: y + (Math.random() - 0.5) * 10,
            vx: (Math.random() - 0.5) * speed * 0.15,
            vy: (Math.random() - 0.5) * 2 - 1.5, // drift upward
            life: 1,
            decay: 0.015 + Math.random() * 0.015,
            size: 1 + Math.random() * 1.5,
            color: SPIN_PALETTE[Math.floor(Math.random() * SPIN_PALETTE.length)],
        });
    }
}

let lastDragX = 0;
canvas.addEventListener("pointermove", (e) => {
    if (!isDragging || scrubberDragging) return;
    const speed = Math.abs(e.clientX - lastDragX);
    lastDragX = e.clientX;
    if (speed > SPIN_SPEED_THRESHOLD) {
        emitSpinParticles(e.clientX, e.clientY, speed);
    }
});

function updateSpinParticles() {
    spinCtx.clearRect(0, 0, spinCanvas.width, spinCanvas.height);
    for (let i = spinParticles.length - 1; i >= 0; i--) {
        const p = spinParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= p.decay;
        if (p.life <= 0) { spinParticles.splice(i, 1); continue; }
        spinCtx.globalAlpha = p.life * 0.7;
        spinCtx.fillStyle = p.color;
        spinCtx.beginPath();
        spinCtx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        spinCtx.fill();
    }
    spinCtx.globalAlpha = 1;
}

window.addEventListener('resize', () => {
    spinCanvas.width = window.innerWidth;
    spinCanvas.height = window.innerHeight;
});

// Resize
window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    // Re-scale cards and tighten ring radius when crossing the mobile breakpoint
    const s = getCardScale();
    const r = getCarouselRadius();
    cards.forEach((c, i) => {
        if (!c) return;
        c.scale.set(s, s, s);
        const angle = (i * 360) / cardCount;
        c.position.set(
            Math.sin(THREE.MathUtils.degToRad(angle)) * r,
            c.position.y, // preserve current Y (hover/drop offset)
            Math.cos(THREE.MathUtils.degToRad(angle)) * r
        );
    });
});


// Render loop
const renderloop = (now = 0) => {

    controls.update();
    window.requestAnimationFrame(renderloop);

    // --- Update all positions BEFORE rendering so no one-frame flash ---

    // Card 0's photo changes each time the pointer arrives on it. Watched from
    // here rather than from the mousemove handler because hoveredCard is
    // cleared in half a dozen places — a drag, a scroll, the pointer leaving
    // the canvas, a change of view — and this is the one spot that sees all
    // of them, so it is the only one that can tell an arrival from a frame
    // that merely still has the pointer on the same card.
    if (hoveredCard !== lastHoveredCard) {
        lastHoveredCard = hoveredCard;
        if (hoveredCard && hoveredCard.userData.cardIndex === 0 && introPhase === 'done') {
            startAboutmeSwap();
        }
    }

    // Hover lift + intro drop animation
    cards.forEach((card, i) => {
        if (!card) return;
        // Hover lift — suppressed until intro is fully done
        const isHovered = card === hoveredCard && introPhase === 'done';
        const hoverTarget = isHovered ? HOVER_Y : 0;
        cardHoverY[i] += (hoverTarget - cardHoverY[i]) * HOVER_ANIM_SPEED;
        // rAF-driven drop trigger — no setTimeout jitter
        if (cardDropOffset[i] < Infinity && cardDropStartTime[i] === -Infinity
            && now >= introAnimStartTime + cardDropOffset[i]) {
            cards[i].visible = true;
            cardDropStartTime[i] = now;
        }
        if (cardDropStartTime[i] > 0) {
            const elapsed = Math.max(0, now - cardDropStartTime[i]);
            const t = easeOutCubic(Math.min(1, elapsed / CARD_DROP_DURATION));
            cardIntroY[i] = CARD_DROP_START_Y * (1 - t);
            if (t >= 1) { cardIntroY[i] = 0; cardDropStartTime[i] = -Infinity; cardDropOffset[i] = Infinity; sfx.land(); }
        }
        // The customize card steps up and holds; every other card drops out
        // from under it. Eased per frame rather than animated once, so opening
        // and closing in quick succession stays continuous instead of fighting
        // over the same property.
        const riseTo = !customizeOpen ? 0
            : i === CUSTOMIZE_INDEX ? CUSTOMIZE_RISE_Y : CUSTOMIZE_DROP_Y;
        cardCustomizeY[i] += (riseTo - cardCustomizeY[i]) * CUSTOMIZE_EASE;

        card.position.y = cardHoverY[i] + cardIntroY[i] + cardCustomizeY[i];

        // Shadow: stay in place, shrink + fade on hover
        const shadow = cardShadows[i];
        if (shadow) {
            shadow.position.y = shadow.userData.baseY - cardHoverY[i];
            const targetOpacity = isHovered ? 0.5 : 1.0;
            const targetScale = isHovered ? 0.7 : 1.0;
            shadow.material.opacity += (targetOpacity - shadow.material.opacity) * HOVER_ANIM_SPEED;
            shadow.scale.x += (targetScale - shadow.scale.x) * HOVER_ANIM_SPEED;
            shadow.scale.z += (targetScale - shadow.scale.z) * HOVER_ANIM_SPEED;
        }
    });

    // The ring itself slides aside while the kit is open — see customizeShiftX.
    const ringShiftTo = customizeOpen ? customizeShiftX() : 0;
    if (Math.abs(cardgroup.position.x - ringShiftTo) > 0.0005) {
        cardgroup.position.x += (ringShiftTo - cardgroup.position.x) * CUSTOMIZE_EASE;
    }

    // Card-0 mouse-tilt + push spring (waitForScroll / early dealing fade-out)
    const c0 = cards[0];
    if (c0) {
        const tiltActive = introPhase === 'waitForScroll';
        const targX = tiltActive ? card0TiltTargX : 0;
        const targY = tiltActive ? card0TiltTargY : 0;
        card0TiltCurrX += (targX - card0TiltCurrX) * CARD0_TILT_SPEED;
        card0TiltCurrY += (targY - card0TiltCurrY) * CARD0_TILT_SPEED;

        c0.rotation.x = card0TiltCurrX;
        c0.rotation.y = card0TiltCurrY; // base y = 0 for card 0

        // Keep shadow flat — counter-rotate so it doesn't tilt with the card
        const s0 = cardShadows[0];
        if (s0) {
            s0.rotation.x = -Math.PI / 2 - card0TiltCurrX;
            s0.rotation.y = -card0TiltCurrY;
        }
    }

    // Continuous intro rotation (linear sweep across all cards — no per-step easing)
    if (introAnimActive) {
        const elapsed = Math.max(0, now - introAnimStartTime);
        const t = easeOutCubic(Math.min(1, elapsed / introAnimDuration));
        cardgroup.rotation.y = introAnimStartRot + (introAnimEndRot - introAnimStartRot) * t;
        if (t >= 1) {
            cardgroup.rotation.y = introAnimEndRot;
            introAnimActive = false;
        }
    }

    // Momentum after a fast drag/swipe release — decays each frame, possibly
    // carrying the carousel through several full laps, then hands off to the
    // snap-to-nearest-card easing below once it slows enough to settle.
    if (isFlinging) {
        cardgroup.rotation.y += flingVelocity;
        flingVelocity *= FLING_FRICTION;
        if (Math.abs(flingVelocity) < FLING_MIN_VELOCITY) {
            isFlinging = false;
            snaptoNearestCard();
        }
    }
    if (spinHintEl) spinHintEl.classList.toggle('visible', isFlinging);

    // Snap animation (only when intro rotation is not active)
    if (!introAnimActive && !isDragging && !isFlinging && targetRotation !== null) {
        const diff = targetRotation - cardgroup.rotation.y;
        if (Math.abs(diff) < 0.001) {
            cardgroup.rotation.y = targetRotation;
            targetRotation = null;
        } else {
            cardgroup.rotation.y += diff * (snapSpeed);
        }
    }

    // Auto-rotate after idle
    if (introPhase === 'done' && !isDragging && !isFlinging && !scrubberDragging
        && !introAnimActive && targetRotation === null
        && now - lastInteractionTime > IDLE_TIMEOUT) {
        if (!autoRotating) {
            autoRotating = true;
            hoveredCard = null;          // drop any hovered card first
            lastPaperCard = null;
            card0TiltTargX = 0;
            card0TiltTargY = 0;
            cardCursor.classList.remove('visible');
            dotCursor.classList.remove('visible');
            canvas.style.cursor = '';
        }
        cardgroup.rotation.y += AUTO_ROTATE_SPEED;
    }

    // Settle detection
    const dy = Math.abs(cardgroup.rotation.y - lastGroupRotY);
    lastGroupRotY = cardgroup.rotation.y;

    if (dy < ROT_EPS) {
        stillFrames++;
    } else {
        stillFrames = 0;
    }

    carouselSettled = !isDragging && !isFlinging && targetRotation === null && stillFrames >= STILL_FRAMES_NEEDED;

    // Loader progress — lerps toward the loaded target; fade-out also waits
    // for LOADER_MIN_MS so the shuffle plays a few seconds on fast loads
    if (loaderEl && !loaderDone) {
        loaderDisplay += (loaderTarget - loaderDisplay) * 0.06;
        // Bar fill is capped by elapsed-time-toward-minimum too, so on a fast
        // load it doesn't jump to full and then just sit there waiting —
        // it keeps crawling until the minimum display time is actually up.
        if (loaderProgressEl) {
            const timePct = Math.min(1, (performance.now() - loaderStart) / LOADER_MIN_MS) * 100;
            loaderProgressEl.style.width = Math.min(loaderDisplay, timePct) + '%';
        }
        if (loaderTarget >= 100 && loaderDisplay >= 99 &&
            performance.now() - loaderStart >= LOADER_MIN_MS) {
            loaderDone = true;
            if (loaderProgressEl) loaderProgressEl.style.width = '100%';
            setTimeout(() => {
                loaderEl.classList.add('fade-out');
                document.body.classList.add('gradient-visible');
                setTimeout(() => {
                    loaderEl.remove();
                    startIntro(); // card drop plays after loader is fully gone
                }, 700);
            }, 200);
        }
    }

    // Update scrubber UI
    updateScrubber();

    // Remember which card is facing the viewer. Sampled from the loop rather
    // than from the input handlers because there is no single "rotation ended"
    // moment — wheel, drag, fling momentum, the scrubber and the snap easing all
    // keep moving the group for a while after the last event, and it's where
    // they come to rest that's worth storing. Gated on 'done' so the deal's own
    // full-circle sweep never gets written down as a resting position.
    if (introPhase === 'done' && Math.abs(cardgroup.rotation.y - viewState.rotation) > 0.0005) {
        viewState.rotation = cardgroup.rotation.y;
        schedulePersist();
    }

    // ── Update ember particles ──
    const posAttr = particleGeo.attributes.position;
    const tSec    = now * 0.001;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
        const elapsed  = (now - pBirthTime[i]) * 0.001;
        const lifetime = (P_TOP - P_BOTTOM) / pSpeeds[i];
        const frac     = (elapsed % lifetime) / lifetime;
        const y        = P_BOTTOM + frac * (P_TOP - P_BOTTOM);
        // horizontal wobble — fire-like side sway
        const x        = pStartX[i]
                       + Math.sin(tSec * 0.9 + pPhases[i]) * pWobbleAmp[i]
                       + Math.sin(tSec * 2.1 + pPhases[i] * 1.3) * pWobbleAmp[i] * 0.4;
        posAttr.setXYZ(i, x, y, pStartZ[i]);
    }
    posAttr.needsUpdate = true;

    // ── Update spin particles ──
    updateSpinParticles();

    // Render last — all positions are current, no stale-position flash possible
    renderer.render(scene, camera);
};

// Helpers
// Eases to the angle snappedRotation names; the restore path up top jumps
// straight to it. Same arithmetic either way, kept in one place so the two
// cannot drift apart and land a reload one card off from a snap.
function snaptoNearestCard() {
    targetRotation = snappedRotation(cardgroup.rotation.y);
}


// --- Scrubber ---
// NOTE: this is NOT indexed by card index — it's indexed by rotation "step"
// distance from About Me (card 0), same scheme the nav-link data-card-index
// attributes use. Card i's slot here is at position (cardCount - i) % cardCount.
const CARD_NAMES = [
    'About Me',            // card 0
    'Make Your Own',       // card 9
    'Sketchbook',          // card 8
    'Nenos Inc.',          // card 7
    'BMW Designworks',     // card 6
    'The Dial',            // card 5
    'POVI',                // card 4
    'Clarus AI',           // card 3
    'tech@nyu Rebrand',    // card 2
    'Puregym Redesign',    // card 1
];

// Tick heights (px) — repeating 3-pattern: short, short, tall
const TICK_HEIGHTS = Array.from({ length: 50 }, (_, i) => i % 3 === 2 ? 30 : 20);
const TICK_COUNT = TICK_HEIGHTS.length;

const scrubberLabel = document.getElementById('scrubber-label');
const scrubberTrack = document.getElementById('scrubber-track');
let lastScrubberActiveIdx = -1;

// Build 3 copies of the tick strip end-to-end so scrolling loops seamlessly.
// Each tick stores its *logical* index (0..TICK_COUNT-1) via data-tickIndex.
const ticks = [];
for (let rep = 0; rep < 3; rep++) {
    TICK_HEIGHTS.forEach((h, i) => {
        const tick = document.createElement('div');
        tick.className = 'scrubber-tick';
        tick.style.height = h + 'px';
        tick.dataset.tickIndex = i;   // logical index within one period
        scrubberTrack.appendChild(tick);
        ticks.push(tick);
    });
}

// Map tick index → card index (distribute ticks evenly across cards)
function tickToCardIndex(tickIdx) {
    return Math.round((tickIdx / (TICK_COUNT - 1)) * (cardCount - 1));
}

// Clicking any tick snaps to the corresponding card
scrubberTrack.addEventListener('click', (e) => {
    resetIdleTimer();
    const tick = e.target.closest('.scrubber-tick');
    if (!tick) return;
    const cardIdx = tickToCardIndex(parseInt(tick.dataset.tickIndex));
    const apc = (Math.PI * 2) / cardCount;
    const current = Math.round(cardgroup.rotation.y / apc);
    const currentMod = ((current % cardCount) + cardCount) % cardCount;
    let diff = cardIdx - currentMod;
    if (diff > cardCount / 2) diff -= cardCount;
    if (diff < -cardCount / 2) diff += cardCount;
    isFlinging = false;
    targetRotation = (current + diff) * apc;
});

// Drag-to-scrub on the track
let scrubberStartX = 0;
let scrubberStartRotation = 0;
const SCRUB_SENSITIVITY = 0.035;
const scrubberWrap = document.getElementById('scrubber-track-wrap');

function onScrubMove(e) {
    if (!scrubberDragging) return;
    const isTouch = !!e.touches;
    const clientX = isTouch ? e.touches[0].clientX : e.clientX;
    const dx = clientX - scrubberStartX;
    // Negative dx (drag left) → rotation increases → carousel moves forward
    cardgroup.rotation.y = scrubberStartRotation - dx * SCRUB_SENSITIVITY;
    // scrubberWrap.setPointerCapture() redirects pointer events to it while
    // dragging, which suppresses the normal 'mousemove' updates that drive the
    // custom cursor overlay — leaving it frozen until release, then jumping to
    // catch up. Drive it directly from these pointer events instead so it
    // keeps tracking smoothly throughout the drag.
    if (!isTouch) {
        dotCursor.style.left = e.clientX + 'px';
        dotCursor.style.top = e.clientY + 'px';
    }
}

function onScrubEnd() {
    if (!scrubberDragging) return;
    scrubberDragging = false;
    window.removeEventListener('pointermove', onScrubMove);
    window.removeEventListener('pointerup', onScrubEnd);
    scrubberWrap.removeEventListener('touchmove', onScrubMove);
    scrubberWrap.removeEventListener('touchend', onScrubEnd);
    scrubberWrap.removeEventListener('touchcancel', onScrubEnd);
    snaptoNearestCard();
}

// Pointer (mouse + stylus + some touch)
scrubberWrap.addEventListener('pointerdown', (e) => {
    // Only handle if not a touch-driven pointer (we handle those separately)
    if (e.pointerType === 'touch') return;
    scrubberDragging = true;
    scrubberStartX = e.clientX;
    scrubberStartRotation = cardgroup.rotation.y;
    targetRotation = null;
    scrubberWrap.setPointerCapture(e.pointerId);
    window.addEventListener('pointermove', onScrubMove);
    window.addEventListener('pointerup', onScrubEnd);
    e.stopPropagation();
    e.preventDefault();
}, { passive: false });

scrubberWrap.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') return;
    onScrubEnd();
});

// Touch (mobile) — handled independently so it never conflicts with canvas
scrubberWrap.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    scrubberDragging = true;
    scrubberStartX = e.touches[0].clientX;
    scrubberStartRotation = cardgroup.rotation.y;
    targetRotation = null;
    scrubberWrap.addEventListener('touchmove', onScrubMove, { passive: false });
    scrubberWrap.addEventListener('touchend', onScrubEnd);
    scrubberWrap.addEventListener('touchcancel', onScrubEnd);
    e.stopPropagation();
    e.preventDefault();
}, { passive: false });

// Called every frame from the render loop
function updateScrubber() {
    const TWO_PI = Math.PI * 2;
    const apc = TWO_PI / cardCount;

    // Single-copy strip pixel width (gap:4px, tick width:2px)
    const stripWidth = TICK_COUNT * 2 + (TICK_COUNT - 1) * 4;

    // Map raw rotation to pixels — no modulo, so it grows continuously.
    // Then modulo into [0, stripWidth) for the looped offset.
    // We start at -stripWidth (middle copy) so both sides are buffered.
    const rawOffset = (cardgroup.rotation.y / TWO_PI) * stripWidth;
    const loopedOffset = ((rawOffset % stripWidth) + stripWidth) % stripWidth;
    scrubberTrack.style.transform = `translateX(${-(stripWidth + loopedOffset)}px)`;

    // Label + active tick highlight — only recalculate when snapped card changes
    const raw = Math.round(cardgroup.rotation.y / apc);
    const activeIdx = ((raw % cardCount) + cardCount) % cardCount;
    if (activeIdx !== lastScrubberActiveIdx) {
        // Ratchet click each time the ticker passes a card — only for user-driven
        // rotation (scroll/drag/scrubber), not during the intro deal or idle auto-rotate
        if (lastScrubberActiveIdx !== -1 && introPhase === 'done' && !autoRotating) playTickThrottled();
        lastScrubberActiveIdx = activeIdx;
        scrubberLabel.textContent = CARD_NAMES[activeIdx] || 'Untitled';
        // All 3 copies share the same logical tickIndex, so this highlights all at once
        ticks.forEach((t) => {
            t.classList.toggle('active', tickToCardIndex(parseInt(t.dataset.tickIndex)) === activeIdx);
        });
    }
}

renderloop();

// --- Keyboard navigation ---
// ArrowLeft / ArrowRight  →  snap one card in that direction
// Enter / Space           →  activate (select) the front card
window.addEventListener('keydown', (e) => {
    resetIdleTimer();
    if (customizeOpen) {
        if (e.key === 'Escape') { e.preventDefault(); closeCustomize(); }
        return;   // arrows and Enter belong to the kit while it is open
    }
    // Ignore if focus is inside a text input / textarea
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    const apc = (Math.PI * 2) / cardCount;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        // Work out the currently snapped index
        const current = Math.round(cardgroup.rotation.y / apc);
        // Right arrow → advance carousel forward (next card), Left → back
        const step = e.key === 'ArrowRight' ? 1 : -1;
        isFlinging = false;
        targetRotation = (current + step) * apc;
    }

    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!carouselSettled) return;
        const front = getFrontCard();
        if (!front) return;
        openCard(front.userData.cardIndex);
    }
});

// ── Theme toggle (light ↔ dark) ───────────────────────────────────────────────
function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    scene.fog.color.set(THEME_COLORS[theme].fog);
    updateCardBackTexture(theme);
    updateCardFaceTextures(theme);
    const favicon = document.getElementById('favicon');
    if (favicon) favicon.href = theme === 'dark' ? './assets/favicon-dark.svg' : './assets/favicon-light.svg';
}

document.getElementById('theme-toggle')?.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// ── View toggle (cards ↔ grid) ───────────────────────────────────────────────
// The grid's project clips carry preload="none", so nothing about them is
// fetched until the grid is actually opened — most visits never open it, and
// the five of them together used to be the bulk of the page's weight. Playing
// them here is also what starts the download; pausing on the way out stops
// five videos decoding behind a hidden panel.
function setGridMediaPlaying(playing) {
    document.querySelectorAll('#grid-view video.grid-card-media').forEach((v) => {
        if (playing) { const r = v.play(); if (r) r.catch(() => {}); }
        else v.pause();
    });
}

const toggleBtns = document.querySelectorAll('.toggle-btn');
const gridView = document.getElementById('grid-view');
const gridHero = document.getElementById('grid-hero');
const gridHeroMask = document.getElementById('gh-reveal-mask');
const gridHeroInner = gridHeroMask ? gridHeroMask.querySelector('.gh-reveal-inner') : null;
const canvasEl = document.querySelector('canvas.threejs');

// Reassigned by the "designs" corner-handle drag IIFE further down this file
// (it owns the --gh-scale state that dragging also drives). Resetting to
// tiny happens immediately so "designs" is never briefly full-size; playing
// the grow-in is deferred until the hero's own slide-up has settled.
let ghResetDesignsIntro = () => {};
let ghPlayDesignsIntro = () => {};

// The "art" doodles (green droplets, orange arcs, pink dots, squiggle) stay
// off (animation-name: none, see .gh-art .gh-green etc. in style.css) until
// .gh-doodles-play is added — which happens only once "designs" has finished
// growing in, so the two intros play in sequence rather than at once.
// Turning the class off first discards any running animation instance
// outright, so re-adding it later always restarts from a clean 0%, instead
// of resuming from wherever a merely-paused animation had drifted to.
function resetArtDoodles() {
    document.querySelector('.gh-art')?.classList.remove('gh-doodles-play');
}
function playArtDoodles() {
    document.querySelector('.gh-art')?.classList.add('gh-doodles-play');
}

// Replay the hero's slide-up-from-below intro each time the grid view opens.
// The mask stays overflow:hidden only for the duration of the slide so the
// "art" doodles (which poke outside the text's line box) aren't clipped
// once the text has settled into place.
function replayGridHeroReveal() {
    if (!gridHero || !gridHeroMask || !gridHeroInner) return;
    gridHero.classList.remove('visible');
    gridHeroMask.classList.remove('revealed');
    ghResetDesignsIntro();
    resetArtDoodles();
    // Jump straight back to the hidden position with transitions off, then
    // force a reflow to commit that jump, before re-enabling transitions and
    // re-adding .visible. Without this, removing .visible while a transition
    // is defined on transform just starts a reverse transition — which gets
    // overridden the instant .visible is re-added a few lines below, all
    // within the same synchronous tick, so it never actually renders a
    // frame. The element stays visually stuck at its already-revealed
    // position and the slide-up never replays on repeat opens.
    gridHeroInner.style.transition = 'none';
    void gridHero.offsetHeight;
    gridHeroInner.style.transition = '';
    gridHero.classList.add('visible');
    gridHeroInner.addEventListener('transitionend', () => {
        gridHeroMask.classList.add('revealed');
        // "designs" grows to full size only once the slide-up reveal has
        // fully settled, not while it's still sliding in. The art doodles
        // only start once designs' own grow-in animation has finished.
        ghPlayDesignsIntro(playArtDoodles);
    }, { once: true });
}

// Everything that has to swap over when the view changes, minus the reveal
// animations. Shared by the toggle handler and by the session restore below, so
// the restored grid can't end up with, say, the scrubber still sitting over it
// because only one of the two places was updated.
function applyViewChrome(view) {
    const scrubber = document.getElementById('scrubber');
    const socialLinks = document.getElementById('social-links');

    toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.view === view));

    if (view === 'grid') {
        // Show grid, hide carousel
        gridView.classList.add('visible');
        canvasEl.style.opacity = '0';
        canvasEl.style.pointerEvents = 'none';
        if (scrubber) scrubber.classList.add('slide-down');
        if (socialLinks) socialLinks.style.opacity = '0';
        if (socialLinks) socialLinks.style.pointerEvents = 'none';
        dotCursor.classList.remove('visible');
        cardCursor.classList.remove('visible');
        setGridMediaPlaying(true);
    } else {
        // Show carousel, hide grid
        gridView.classList.remove('visible');
        canvasEl.style.opacity = '1';
        canvasEl.style.pointerEvents = 'auto';
        if (scrubber) scrubber.classList.remove('slide-down');
        if (socialLinks) { socialLinks.style.opacity = ''; socialLinks.style.pointerEvents = ''; }
        setGridMediaPlaying(false);
    }
}

toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === currentView) return;
        sfx.click();
        currentView = view;

        applyViewChrome(view);

        if (view === 'grid') {
            gridView.scrollTo({ top: 0, behavior: 'auto' });
            replayGridHeroReveal();
            replayGridCardReveal();
        }

        // Written straight through rather than throttled: a toggle is a single
        // deliberate act, and it is the one moment where losing the write to a
        // pending timer would mean coming back to the wrong view entirely.
        viewState.view = view;
        viewState.gridScroll = view === 'grid' ? 0 : viewState.gridScroll;
        writeViewState();
    });
});

// Non-null only while the restore below is still trying to land its offset; see
// the guard in the scroll handler for why that matters.
let pendingGridScrollRestore = null;

// The grid is its own scroll container (position: fixed with overflow-y: auto),
// so its offset lives on the element, not on the window — nothing about the
// page's own scroll position describes where the visitor is inside it.
gridView.addEventListener('scroll', () => {
    if (currentView !== 'grid') return;
    // A restore that got clamped short still fires a scroll event, and writing
    // that back would overwrite the offset we're in the middle of restoring with
    // the clamped one — the stored position would decay a little on every trip.
    // Anything at or past the target is real movement, so the restore is done.
    if (pendingGridScrollRestore !== null) {
        if (gridView.scrollTop < pendingGridScrollRestore - 1) return;
        pendingGridScrollRestore = null;
    }
    viewState.gridScroll = gridView.scrollTop;
    schedulePersist();
}, { passive: true });

// ── Grid-view footer ─────────────────────────────────────────────────────────

// "Last updated" — pick the most-recent mtime among the three source files.
// Falls back to document.lastModified when fetch isn't available (e.g. file:// URLs).
async function _gfSetLastUpdated() {
    const el = document.querySelector('#grid-footer .gf-updated');
    if (!el) return;
    let latest = 0;
    try {
        const results = await Promise.all(
            ['./index.html', './style.css', './script.js'].map(async (f) => {
                const r = await fetch(f, { method: 'HEAD', cache: 'no-store' });
                const lm = r.headers.get('Last-Modified');
                return lm ? Date.parse(lm) : NaN;
            })
        );
        results.forEach(t => { if (!isNaN(t) && t > latest) latest = t; });
    } catch (_) { /* fetch unavailable — fall through to document.lastModified */ }
    if (!latest) {
        const d = Date.parse(document.lastModified);
        if (!isNaN(d)) latest = d;
    }
    if (latest) {
        const d = new Date(latest);
        el.textContent = `Last updated ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }
}
_gfSetLastUpdated();

// Live clocks for the three city columns
const _gfTimes = document.querySelectorAll('#grid-footer .gf-time-value');
function _gfTickClocks() {
    _gfTimes.forEach(el => {
        const tz = el.dataset.tz;
        try {
            el.textContent = new Intl.DateTimeFormat('en-US', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false, timeZone: tz
            }).format(new Date());
        } catch (_) { /* invalid tz — leave placeholder */ }
    });
}
if (_gfTimes.length) {
    _gfTickClocks();
    setInterval(_gfTickClocks, 1000);
}

// Footer nav — HOME switches to card view, PROJECT scrolls grid to top,
// SKETCHBOOK / ABOUT switch to card view then rotate to that card.
document.querySelectorAll('#grid-footer .gf-nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        const action = link.dataset.action;
        const cardIdxAttr = link.dataset.cardIndex;

        if (action === 'home') {
            e.preventDefault();
            document.querySelector('.toggle-btn[data-view="cards"]')?.click();
            return;
        }
        if (action === 'project') {
            e.preventDefault();
            gridView.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (cardIdxAttr !== undefined) {
            e.preventDefault();
            const cardIdx = parseInt(cardIdxAttr, 10);
            if (Number.isNaN(cardIdx)) return;
            if (currentView !== 'cards') {
                document.querySelector('.toggle-btn[data-view="cards"]')?.click();
            }
            const apc = (Math.PI * 2) / cardCount;
            const current = Math.round(cardgroup.rotation.y / apc);
            const currentMod = ((current % cardCount) + cardCount) % cardCount;
            let diff = cardIdx - currentMod;
            if (diff > cardCount / 2) diff -= cardCount;
            if (diff < -cardCount / 2) diff += cardCount;
            isFlinging = false;
            targetRotation = (current + diff) * apc;
        }
    });
});

// ── Grid card reveal-on-scroll (fade + slide up, staggered DOM order) ───────
const _gridCardObserver = new IntersectionObserver((entries) => {
    // Stagger cards that enter together (e.g., initial grid view open) in DOM order.
    const intersecting = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => (a.target.compareDocumentPosition(b.target) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    intersecting.forEach((entry, i) => {
        entry.target.style.transitionDelay = `${i * 100}ms`;
        entry.target.classList.add('visible');
        _gridCardObserver.unobserve(entry.target);
    });
}, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

function replayGridCardReveal() {
    const cards = document.querySelectorAll('.grid-card');
    cards.forEach(card => {
        _gridCardObserver.unobserve(card);
        card.classList.remove('visible');
    });
    // Force reflow so the reset state (opacity 0 + translateY) commits
    // before the observer re-fires and adds .visible back.
    void document.body.offsetHeight;
    cards.forEach(card => _gridCardObserver.observe(card));
}

// Coming Soon grid cards (marked with data-coming-soon) don't have a real
// page yet — block the click instead of following href="#".
document.querySelectorAll('.grid-card[data-coming-soon]').forEach(card => {
    card.addEventListener('click', (e) => e.preventDefault());
});

// ── Grid-card hover swap: title scrolls up, description scrolls in ──────────
document.querySelectorAll('.grid-card-info').forEach(info => {
    const title = info.querySelector('.grid-card-title');
    const desc  = info.querySelector('.grid-card-desc');
    if (!title || !desc) return;

    const arrow = title.querySelector('.grid-card-arrow');
    if (arrow) arrow.remove();

    // Move the #001-style number out of the image and prepend it to the title
    const card = info.closest('.grid-card');
    const number = card?.querySelector('.grid-card-number');
    if (number) title.appendChild(number);

    const swap = document.createElement('div');
    swap.className = 'grid-card-swap';

    const descRow = document.createElement('div');
    descRow.className = 'grid-card-desc-row';

    descRow.appendChild(desc);
    if (arrow) descRow.appendChild(arrow);

    info.insertBefore(swap, title);
    swap.appendChild(title);
    swap.appendChild(descRow);
});

// ── Restore the grid view a returning visitor left off in ────────────────────
// Deliberately placed at this point in the file rather than next to the toggle
// handler: everything above has finished building the grid's final DOM — the
// hover-swap block just above physically re-parents every card's title and
// description — and a scroll offset measured against a layout that is still
// about to change is an offset that lands in the wrong place.

// The same end state replayGridHeroReveal() and replayGridCardReveal() animate
// towards, arrived at directly. Restoring is not a re-entry; the visitor has
// already watched the hero slide up and the cards fade in, and replaying that
// on the way back from a project page reads as the site having forgotten them.
function revealGridSilently() {
    if (gridHero && gridHeroMask && gridHeroInner) {
        // Suppress the slide-up transition across the class change and commit it
        // with a reflow before handing transitions back, exactly as the replay
        // path does — otherwise adding .visible here animates from below.
        gridHeroInner.style.transition = 'none';
        gridHero.classList.add('visible');
        gridHeroMask.classList.add('revealed');
        void gridHero.offsetHeight;
        gridHeroInner.style.transition = '';
    }
    // The doodles are an infinite ambient loop rather than a one-shot reveal, so
    // turning them on here is restoring the resting state, not replaying an intro.
    playArtDoodles();

    // Only the cards actually on screen are forced visible; the ones further
    // down are handed to the observer untouched, so scrolling on from a restored
    // position still reveals them the normal way instead of finding everything
    // already faded in.
    const vh = window.innerHeight;
    document.querySelectorAll('.grid-card').forEach(card => {
        const r = card.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) {
            card.style.transition = 'none';
            card.classList.add('visible');
            void card.offsetHeight;
            card.style.transition = '';
        } else {
            _gridCardObserver.observe(card);
        }
    });
}

// Setting scrollTop on a container whose content is shorter than the target is
// silently clamped to whatever the max happens to be at that instant — and the
// grid's content is still growing at this point: the webfonts are async, so the
// hero and every card caption reflow taller once they swap in. So the offset is
// applied straight away (which is what makes it silent — the grid's first paint
// is already at the right place, with no frame at the top and no scroll
// animation) and then re-asserted at the two moments the height can jump, but
// only while it is still short of the target and the visitor hasn't taken over.
function restoreGridScroll(top) {
    if (!(top > 0)) return;
    pendingGridScrollRestore = top;
    // Stop re-asserting the moment the visitor touches the grid themselves —
    // yanking them back to a stored offset mid-scroll would be worse than
    // simply having missed it.
    const release = () => { pendingGridScrollRestore = null; };
    ['wheel', 'touchstart', 'pointerdown'].forEach(t =>
        gridView.addEventListener(t, release, { once: true, passive: true }));
    window.addEventListener('keydown', release, { once: true });

    const apply = () => {
        if (pendingGridScrollRestore === null) return;
        // A short read means the previous set was clamped, not that the visitor
        // scrolled up — that case is covered by `release` above.
        if (gridView.scrollTop < top - 1) gridView.scrollTop = top;
    };
    gridView.scrollTop = top;
    requestAnimationFrame(apply);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(apply).catch(() => {});
    window.addEventListener('load', apply, { once: true });
}

if (restoredState && restoredState.view === 'grid' && gridView) {
    currentView = 'grid';
    applyViewChrome('grid');
    revealGridSilently();
    restoreGridScroll(restoredState.gridScroll);
    // Hand the pre-paint hint back: index.html only sets it so the grid is
    // opaque in the very first frame, and leaving it on would keep the grid
    // painted over the carousel after a toggle back to cards. Dropping it in the
    // same tick that .visible went on means the computed opacity never changes,
    // so the fade transition has nothing to run on.
    document.documentElement.removeAttribute('data-restore-view');
}

// --- Intro animation functions ---

// The deal is a first-impression moment, not something to sit through again on
// the way back from a project page. Once it has played, the rest of the visit
// lands straight in the interactive state.
//
// Two signals, because neither covers everything on its own. sessionStorage
// survives a reload but not a fresh tab; the hash survives being linked to and
// travels with a history entry, so Back from a project page returns to a URL
// that already says "skip". Project pages link to index.html#cards directly.
const INTRO_KEY = 'introPlayed';
const INTRO_HASH = '#cards';

function introAlreadyPlayed() {
    if (window.location.hash === INTRO_HASH) return true;
    // storage throws outright in some privacy modes rather than returning null
    try { return sessionStorage.getItem(INTRO_KEY) === '1'; } catch (err) { return false; }
}

function markIntroPlayed() {
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch (err) { /* not fatal */ }
    if (window.location.hash === INTRO_HASH) return;
    // replaceState, not a hash assignment: stamping the URL must not push a
    // history entry, or Back would land on the same page minus the hash and
    // replay the deal.
    try {
        history.replaceState(null, '', window.location.pathname + window.location.search + INTRO_HASH);
    } catch (err) { /* file:// and the like */ }
}

function startIntro() {
    if (introAlreadyPlayed()) { skipIntro(); return; }
    // No extra delay needed — loader fade already provides the transition buffer
    const c = cards[0];
    if (!c) return;
    c.visible = true;
    cardDropStartTime[0] = performance.now();
    introPhase = 'waitForScroll';
    const panels = document.getElementById('about-panels');
    if (panels) panelRevealTimeout = setTimeout(() => {
        panelRevealTimeout = null;
        panels.classList.add('visible');
    }, 350);
}

function triggerDealing() {
    if (introPhase !== 'waitForScroll') return;
    introPhase = 'dealing';
    // Cancel any pending reveal so the panels can't pop back in after we start exiting
    if (panelRevealTimeout !== null) {
        clearTimeout(panelRevealTimeout);
        panelRevealTimeout = null;
    }
    // Slide panels upward then remove them
    const panels = document.getElementById('about-panels');
    if (panels) {
        panels.classList.remove('visible');
        panels.classList.add('exiting');
        setTimeout(() => panels.classList.remove('exiting'), 600);
    }

    const STEP_MS = 500; // ms per card slot
    const totalDuration = STEP_MS * cardCount; // one full circle over cardCount steps

    // One continuous linear rotation: current → current - 2π (full circle, lands on About Me)
    introAnimStartTime = performance.now();
    introAnimStartRot = cardgroup.rotation.y;
    introAnimEndRot = cardgroup.rotation.y - (Math.PI * 2);
    introAnimDuration = totalDuration;
    introAnimActive = true;
    targetRotation = null;

    // Precompute each card's drop offset from introAnimStartTime so each card's
    // drop — and its landing click — finishes right as the eased rotation brings
    // it to centre, not after. The rotation keeps moving continuously, so any
    // later finish means the click fires once that card has already rotated
    // past centre, while a *different* (still-falling) card is now in focus —
    // reading as if the click were mistimed against whatever card you're
    // actually looking at. Starting the drop a full CARD_DROP_DURATION before
    // centreTime makes it finish (fully landed, y=0) exactly at centreTime.
    // The eased rotation curve is front-loaded, so the first few cards' centreTime
    // values land less than CARD_DROP_DURATION apart — without a floor, their raw
    // offsets all clamp to 0 and they drop simultaneously instead of staggered.
    const MIN_DROP_GAP = 100; // ms — minimum stagger between consecutive drop starts
    let prevOffset = -Infinity;
    for (let i = 1; i < cardCount; i++) {
        const rotFraction = i / cardCount; // fraction of full rotation when card i faces front
        const centreTime = easeOutCubicInverse(rotFraction) * totalDuration;
        let offset = Math.max(0, Math.round(centreTime - CARD_DROP_DURATION));
        offset = Math.max(offset, prevOffset + MIN_DROP_GAP);
        cardDropOffset[i] = offset;
        cardDropStartTime[i] = -Infinity; // reset in case of re-deal
        prevOffset = offset;
    }

    // Unlock interaction and reveal social links + scrubber + top nav
    setTimeout(() => {
        introPhase = 'done';
        markIntroPlayed();
        const sl = document.getElementById('social-links');
        if (sl) setTimeout(() => sl.classList.add('ui-intro-visible'), 100);
        if (scrubberEl) setTimeout(() => scrubberEl.classList.add('ui-intro-visible'), 350);
        const tn = document.getElementById('top-nav');
        if (tn) setTimeout(() => tn.classList.add('visible'), 200);
    }, totalDuration + 200);
}

function skipIntro() {
    // Instantly show all cards and jump straight to interactive state
    cards.forEach((c, i) => {
        if (!c) return;
        c.visible = true;
        cardIntroY[i] = 0;
        cardHoverY[i] = 0;
        c.position.y = 0;
    });
    introPhase = 'done';
    markIntroPlayed();
    const sl = document.getElementById('social-links');
    if (sl) sl.classList.add('ui-intro-visible');
    const sc = document.getElementById('scrubber');
    if (sc) sc.classList.add('ui-intro-visible');
    const tn = document.getElementById('top-nav');
    if (tn) tn.classList.add('visible');
    if (panelRevealTimeout !== null) {
        clearTimeout(panelRevealTimeout);
        panelRevealTimeout = null;
    }
    const panels = document.getElementById('about-panels');
    if (panels) { panels.classList.remove('visible'); panels.classList.remove('exiting'); }
}

// --- Scrubber overlay hide/show ---
const scrubberEl = document.getElementById('scrubber');

// --- Social links handler ---
// Clicks open a new tab when not embedded; if the page is embedded inside
// an iframe this will navigate the top-level parent (so the parent address
// is replaced). Update the links in the `data-href` attributes in index.html.
(function () {
    const links = document.querySelectorAll('.social-link');
    if (!links || !links.length) return;
    links.forEach((el) => {
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            const url = el.getAttribute('parent-href') || el.dataset.href || el.getAttribute('href');
            if (!url || url === '#') return;
            try {
                // Open in a new tab — use window.top.open so popup isn't blocked inside an iframe
                (window.top || window).open(url, '_blank', 'noopener,noreferrer');
            } catch (err) {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        });
    });
})();

// ── "designs" box corner handles — drag to scale just that word ─────────────
// Dragging the tl/tr/br handles resizes only the word "designs" (via the
// --gh-scale CSS var, consumed by .gh-boxed's font-size); the opposite
// corner of the box stays anchored, like resizing a shape in a design tool.
// Everything else keeps its own font size and simply reflows around it.
(function () {
    const heroEl = document.getElementById('grid-hero');
    const boxEl = document.querySelector('.gh-boxed');
    if (!heroEl || !boxEl) return;

    const MIN_SCALE = 0.7;
    const MAX_SCALE = 1.8; // cap on how big the text can get

    let scale = 1;
    const html = document.documentElement;

    function applyScale(next) {
        scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
        heroEl.style.setProperty('--gh-scale', scale.toFixed(3));
    }

    // "designs" entrance: grows from tiny up to its normal size via the same
    // --gh-scale/font-size mechanism dragging uses (bypassing applyScale's
    // MIN_SCALE clamp, since 0.15 is intentionally far below the drag
    // floor) — a real size change, not a visual-only transform, so "I treat
    // my" and "like" genuinely reflow closer together while it's small and
    // ease apart as it grows, instead of sitting at their final spacing the
    // whole time.
    const INTRO_START_SCALE = 0.15;
    const INTRO_DURATION = 650;
    let introToken = 0;

    function setScaleRaw(v) {
        scale = v;
        heroEl.style.setProperty('--gh-scale', v.toFixed(4));
    }

    function easeOutExpo(t) {
        return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    ghResetDesignsIntro = function () {
        introToken++; // invalidate any in-flight grow loop
        setScaleRaw(INTRO_START_SCALE);
    };

    ghPlayDesignsIntro = function (onDone) {
        const myToken = ++introToken;
        const start = performance.now();
        function frame(now) {
            if (myToken !== introToken) return; // superseded by a reset/replay
            const t = Math.min(1, (now - start) / INTRO_DURATION);
            setScaleRaw(INTRO_START_SCALE + (1 - INTRO_START_SCALE) * easeOutExpo(t));
            if (t < 1) {
                requestAnimationFrame(frame);
            } else if (onDone) {
                onDone();
            }
        }
        requestAnimationFrame(frame);
    };

    const anchorFor = {
        tl: (rect) => ({ x: rect.right, y: rect.bottom }),
        tr: (rect) => ({ x: rect.left, y: rect.bottom }),
        br: (rect) => ({ x: rect.left, y: rect.top }),
    };

    ['tl', 'tr', 'br'].forEach((corner) => {
        const handle = document.querySelector(`.gh-handle.${corner}`);
        if (!handle) return;

        // Hide the custom dot cursor and let the real native grab cursor
        // (set in CSS) show through while hovering these handles.
        handle.addEventListener('pointerenter', () => html.classList.add('gh-handle-hover'));
        handle.addEventListener('pointerleave', () => {
            if (!html.classList.contains('gh-handle-drag')) html.classList.remove('gh-handle-hover');
        });

        handle.addEventListener('pointerdown', (e) => {
            // preventDefault stops the browser from starting a native text
            // selection drag (user-select: none alone wasn't reliable here).
            // That also suppresses the *compatibility mouse events* the
            // site's custom cursor tracker depends on — but not genuine
            // pointer events — so we mirror the cursor position ourselves
            // in onMove below instead of relying on the global mousemove handler.
            e.preventDefault();
            html.classList.add('gh-handle-drag');
            document.body.style.userSelect = 'none';

            const anchor = anchorFor[corner](boxEl.getBoundingClientRect());
            const startDist = Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) || 1;
            const startScale = scale;

            function onMove(ev) {
                dotCursor.style.left = ev.clientX + 'px';
                dotCursor.style.top = ev.clientY + 'px';
                cardCursor.style.left = ev.clientX + 'px';
                cardCursor.style.top = ev.clientY + 'px';

                const dist = Math.hypot(ev.clientX - anchor.x, ev.clientY - anchor.y);
                applyScale(startScale * (dist / startDist));
            }
            function onUp() {
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                html.classList.remove('gh-handle-drag');
                document.body.style.userSelect = '';
                if (!handle.matches(':hover')) html.classList.remove('gh-handle-hover');
            }
            window.addEventListener('pointermove', onMove);
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        });
    });
})();

// ── Greeting typewriter — types "Jennifer", deletes it, types "HFYJ", loops ──
(function () {
    const el = document.getElementById('gh-typewriter');
    if (!el) return;

    const WORDS = ['Jennifer', 'HFYJ'];
    const TYPE_MS = 90;
    const DELETE_MS = 55;
    const HOLD_FULL_MS = 5000;
    const HOLD_EMPTY_MS = 300;
    let wordIndex = 0;

    function typeWord(word, i) {
        el.textContent = word.slice(0, i);
        if (i < word.length) {
            setTimeout(() => typeWord(word, i + 1), TYPE_MS);
        } else {
            setTimeout(() => deleteWord(word, word.length), HOLD_FULL_MS);
        }
    }
    function deleteWord(word, i) {
        el.textContent = word.slice(0, i);
        if (i > 0) {
            setTimeout(() => deleteWord(word, i - 1), DELETE_MS);
        } else {
            wordIndex++;
            setTimeout(() => typeWord(WORDS[wordIndex % WORDS.length], 0), HOLD_EMPTY_MS);
        }
    }

    typeWord(WORDS[wordIndex % WORDS.length], 0);
})();
