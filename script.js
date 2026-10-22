import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ── Theme (light ↔ dark) ──────────────────────────────────────────────────────
const THEME_KEY = 'theme';
// Only an explicit press is ever stored, so with nothing written down the OS
// preference is what to honour. This has to resolve exactly the way the <head>
// block in index.html and the other eight pages do — the whole point of the
// shared key is that every page reaches the same answer, and a home page that
// pinned itself to light while every other page followed the OS was a visible
// disagreement the moment a dark-mode reader left the carousel.
function getStoredTheme() {
    let saved = null;
    // storage throws outright in some privacy modes rather than returning null
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) {}
    if (saved === 'dark' || saved === 'light') return saved;
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        ? 'dark' : 'light';
}
let currentTheme = getStoredTheme();
document.documentElement.setAttribute('data-theme', currentTheme);

// Light-mode paper stock for every card drawn in code — faces and backs alike;
// the dark stock lives in THEME_COLORS below. Card 8 (playground) is a
// still of the table, so its face does not follow the stock.
const CARD_BG = '#F7F5F5';

// The ink values mirror the site's --t1/--t2 text scale in style.css. Each
// light entry is the literal the card art was already drawn with, so light
// mode renders exactly as before; the dark entries are the tones that clear
// the dark stock. Photos and anything sitting on top of one keep their own
// colors — only the stock and the ink drawn on it follow the theme.
const THEME_COLORS = {
    light: {
        fog: 0xFCFCFE, accent: '#5E81E2', cardBg: CARD_BG, shadow: 1,
        ink: '#000', inkSub: '#585858', inkBody: '#626875',
        rule: '#232323', placeholder: '#d9d9d9',
    },
    dark: {
        // The lavender ground shadow glows on the dark floor, so it sits lower.
        fog: 0x121212, accent: '#FFFA50', cardBg: '#373737', shadow: 0.55,
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
const cardCount = 9;
let scrollTimeout = null;
let currentView = 'cards';
// How many faces have sat down. The first-visit shuffle stays up until
// this reaches every card and the playground cloth has finished painting.
let loadedModels = 0;
let playgroundFaceReady = false;

// Loader
// Null on a return visit, which is what turns the loading screen off: the
// progress block below and the fade-out that follows it are both gated on
// loaderEl, and About Me sitting down starts the carousel directly
// when there is no loader to wait for. Hiding the element in CSS alone would
// leave this reference truthy and the carousel would never start.
// index.html decides this before first paint; see window.__introDone there.
const introSkipped = window.__introDone === true;
// The loading screen is gone: the cards build themselves in instead (see
// "Card build-in"). Kept as a null so the old loader paths stay switched off.
const loaderEl = null;
{
    const el = document.getElementById('loader');
    if (el) el.remove();
}
const loaderProgressEl = document.getElementById('loader-progress-bar');
const loaderStart = performance.now();
const LOADER_MIN_MS = 1200; // a beat of shuffle, even when the cache is hot
const LOADER_MAX_MS = 10000; // a stuck asset must not shuffle forever
let loaderTarget  = 0;   // jumps to each step as models arrive
let loaderDisplay = 0;   // lerps smoothly toward loaderTarget
let loaderBarPct  = -1;  // last percent written to the bar; skips repeat writes
let loaderDone    = false;
// Assets are in, but the shuffle is still mid-pull. Held until the next
// time a card lands back in the deck, so the shuffle can finish.
let loaderAwaitShuffle = false;
let shuffleBeatSeen = null;
const ARRIVE_MS = 920;
const ARRIVE_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
// The other cards leave, and the top one squares up, before it turns.
const SETTLE_MS = 420;
const SETTLE_HOLD_MS = 180;

// Faces plus the playground cloth. The cloth's stand-in sits down early,
// so loadedModels alone would end the shuffle while that paint was still
// ahead — which is the hitch.
function refreshLoaderTarget() {
    if (!loaderEl) return;
    const total = cardCount + 1;
    const step = Math.min(total, loadedModels + (playgroundFaceReady ? 1 : 0));
    const ready = playgroundFaceReady && loadedModels >= cardCount;
    loaderTarget = ready ? 100 : (step / total) * 100;
}

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

// The rustle is off with the rest of sfx, so this stays cold until
// playPaperSample() is actually called — the wav is a third-party fetch
// that was racing the cards for no reason.
let paperBuffer = null;
let paperFetch = null;
function ensurePaper() {
    if (paperBuffer || paperFetch) return paperFetch;
    paperFetch = fetch('https://jhfyj.github.io/New-Website-Code/sounds/paper-rustle.wav')
        .then(r => r.arrayBuffer())
        .then(buf => {
            const ctx = ensureAudio();
            return ctx ? ctx.decodeAudioData(buf) : null;
        })
        .then(decoded => { paperBuffer = decoded; })
        .catch(() => {}); // missing/blocked file just means no paper sound
    return paperFetch;
}

// Plays a short snippet from a random point in the recording. The source
// clip's loudness varies a lot from one moment to the next (it's a real
// recording, not synthesized noise), so a fixed gain would make some plays
// sound much louder than others. Instead we measure the RMS of the exact
// slice we're about to play and scale gain to hit a consistent target level,
// clamped so a near-silent slice doesn't get amplified into audible hiss.
function playPaperSample() {
    if (!paperBuffer) {
        ensurePaper();
        return;
    }
    const ctx = ensureAudio();
    if (!ctx) return;
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
    if (introPhase === 'waitForScroll') armScrollCue();
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
// Full lean grows the ground shadow by this fraction. Position stays put —
// a shadow doesn't travel with the card's axes, only its size does.
const CARD0_SHADOW_LEAN_SCALE = 0.22;
const _shadowTiltEuler = new THREE.Euler(0, 0, 0, 'XYZ');
const _shadowParentQ = new THREE.Quaternion();
const _shadowFlatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'XYZ'));
const _shadowChildQ = new THREE.Quaternion();

// The shadow is a child of the card, so tilting the card swings it as if it
// were stuck to the card. Put it back on the ground directly under the card
// and lay it flat. `groundY` is the shadow's rest height in the card's
// unrotated frame (negative, below the card).
function pinCardShadow(shadow, tiltX, tiltY, groundY) {
    const sx = Math.sin(tiltX), cx = Math.cos(tiltX);
    const sy = Math.sin(tiltY), cy = Math.cos(tiltY);
    shadow.position.set(groundY * sx * sy, groundY * cx, groundY * -sx * cy);
    _shadowTiltEuler.set(tiltX, tiltY, 0);
    _shadowParentQ.setFromEuler(_shadowTiltEuler);
    shadow.quaternion.copy(_shadowChildQ.copy(_shadowParentQ).invert().multiply(_shadowFlatQ));
}

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
// The name type-on, and the pause before the bio fade. One handle: each step
// replaces it, so clearing it stops the chain wherever it is.
let panelTypeTimer = null;

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
    /* The pill does not jump between states. Moving onto a coming-soon card
       changes its fill, its ink and its border at once, and snapping all three
       reads as a different pill appearing rather than as this one answering.

       This rule is the one that wins: style.css also has a #card-cursor block
       with the same properties, and this one is injected at runtime, so at
       equal specificity it comes later and takes the cascade. Anything about
       the pill's own box has to be changed HERE — a change to the copy in
       style.css is dead unless it carries a class (.is-soon does, which is why
       the accent fill works at all). */
    transition:
      opacity 0.25s ease,
      background-color 0.22s ease,
      border-color 0.22s ease,
      color 0.22s ease,
      box-shadow 0.22s ease;
    white-space: nowrap;
    user-select: none;
  }
  @media (prefers-reduced-motion: reduce) {
    #card-cursor { transition: opacity 0.25s ease; }
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
`;
document.head.appendChild(cursorStyle);

const cardCursor = document.createElement('div');
cardCursor.id = 'card-cursor';
// The words sit in their own element so they can be faded independently of the
// pill. Fading the pill itself would take its fill with it, and the fill is
// what is meant to be changing smoothly underneath the swap.
const cardCursorLabel = document.createElement('span');
cardCursorLabel.className = 'cc-label';
cardCursorLabel.textContent = 'open project';
cardCursor.appendChild(cardCursorLabel);

// The one label that is a state rather than an instruction, so the pill fills
// with the theme's accent when it is showing — see #card-cursor.is-soon.
const COMING_SOON_LABEL = 'coming soon';

// How long .cc-label takes to fade out, kept in step with style.css. The words
// are swapped at the far end of that fade so the change happens behind it.
const CURSOR_SWAP_MS = 80;
let cursorLabel = 'open project';
let cursorSwapTimer = 0;

function writeCardCursor(label) {
    cardCursorLabel.textContent = label;
}

function setCardCursor(label) {
    // The fill is a property of the pill and transitions on its own; only the
    // words need the fade, and only when they are actually changing. Hovering
    // along a row of project cards asks for 'open project' on every frame, and
    // fading it out and back in each time would flicker.
    if (label === cursorLabel) return;
    cursorLabel = label;

    cardCursor.classList.toggle('is-soon', label === COMING_SOON_LABEL);

    // Not yet on screen: there is nothing to fade out of, and a swap animation
    // would only delay the first label behind the pill's own fade-in.
    if (!cardCursor.classList.contains('visible')) {
        window.clearTimeout(cursorSwapTimer);
        cardCursorLabel.classList.remove('is-swapping');
        writeCardCursor(label);
        return;
    }

    window.clearTimeout(cursorSwapTimer);
    cardCursorLabel.classList.add('is-swapping');
    cursorSwapTimer = window.setTimeout(function () {
        writeCardCursor(label);
        cardCursorLabel.classList.remove('is-swapping');
    }, CURSOR_SWAP_MS);
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
    const w0 = cardBackCanvas.width;
    paintCardBack(theme);
    // A resize can change the scale it is drawn at, and a texture's GPU
    // storage is fixed at its first size.
    if (cardBackCanvas.width !== w0) cardBackTexture.dispose();
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
    "bmw.html",                            // 6 — BMW Designworks
    "#",                                    // 7 — Nenos Inc. (Coming Soon)
    // 8 — Playground. Local now: playground.html is the built page, and it is
    // the one this site should be sending people to. It used to point at the
    // live Framer site because there was nothing here to point at.
    "playground.html",
];

// Cards with no real destination page yet — hovering shows "coming soon" and
// clicking the front card is a no-op instead of navigating. Keep in sync with
// the "#" placeholders above.
const COMING_SOON_INDICES = new Set([7]);


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
// Nothing is stashed for the trip back. The same geometry used to be kept
// under a second key so a case page could shrink its hero into the card it
// came out of; going home is a plain fade now, which needs to know nothing
// about where the card is.

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

// The six project cards fly a photo well into a case-page hero. Card 8
// (playground) flies that same well into the live table on sketchbook.
// Card 0 still has no hand-off: About Me does not open on a hero either.
const HANDOFF_INDICES = new Set([1, 2, 3, 4, 5, 6]);
const PLAYGROUND_INDEX = 8;
// The About Me photo mask, as fractions of the face: nearly the whole
// card, with the folded corner and the pill shelf sitting on top of it.
// The inner felt well: below the #0000 fold and above the pill shelf,
// so the live cloth does not cover the stock chrome. The flight starts
// from this same box.
const PLAYGROUND_FACE_LAYOUT = {
    // The grass opening on the cover still — where the live table grows
    // from when the card opens.
    photo: { x: 21 / 1059, y: 20 / 1449, w: 1017 / 1059, h: 1332 / 1449 },
};

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
    const isFelt = index === PLAYGROUND_INDEX;
    if (!HANDOFF_INDICES.has(index) && !isFelt) return;
    const group = cards[index];
    if (!group || !group.children.length) return;

    const rect = projectCardFaceRect(group);
    if (!(rect.w > 1 && rect.h > 1)) return;

    const L = isFelt ? PLAYGROUND_FACE_LAYOUT : CARD_FACE_LAYOUT;
    let image = null;
    if (!isFelt) {
        const map = group.children[0].material && group.children[0].material.map;
        const face = map && map.image;
        if (!face || !face.width) return;
        try {
            // Only the picture travels, never the card around it. The photo is
            // the part that becomes the hero; 900px across is past the size it
            // is ever painted at, and keeps the base64 inside sessionStorage's
            // budget — which is spent in UTF-16, so every character costs two
            // bytes.
            //
            // Drawn fresh from the card's own source image rather than cut out
            // of the painted face. The face has the folded corner in the
            // well's top-left with the "#00X" tag printed on it, and a crop of
            // the face carried both into the flight — the tag would grow with
            // the picture on its way to the hero. From the source it is just the
            // picture, framed exactly as the well frames it, and at the source's
            // own resolution rather than the face's (which is drawn only as big
            // as the card is on screen).
            const out = document.createElement('canvas');
            const src = group.userData.handoffPhoto;
            const wellW = L.photo.w * TEMPLATE_CARD.w, wellH = L.photo.h * TEMPLATE_CARD.h;
            if (src && (src.naturalWidth || src.width)) {
                out.width = 900;
                out.height = Math.round(900 * wellH / wellW);
                const octx = out.getContext('2d');
                octx.imageSmoothingQuality = 'high';
                tmplDrawImageCover(octx, src, 0, 0, out.width, out.height);
            } else {
                const sx = L.photo.x * face.width, sy = L.photo.y * face.height;
                const sw = L.photo.w * face.width, sh = L.photo.h * face.height;
                const k = Math.min(1, 900 / sw);
                out.width = Math.round(sw * k);
                out.height = Math.round(sh * k);
                out.getContext('2d').drawImage(face, sx, sy, sw, sh, 0, 0, out.width, out.height);
            }
            image = out.toDataURL('image/jpeg', 0.86);
        } catch (err) {
            return;
        }
    }

    const photo = {
        x: rect.x + L.photo.x * rect.w,
        y: rect.y + L.photo.y * rect.h,
        w: L.photo.w * rect.w,
        h: L.photo.h * rect.h,
    };

    try {
        const stash = {
            t: Date.now(),
            slug: handoffSlug(url),
            text: group.userData.cardTitle || '',
            theme: currentTheme,
            image: image,
            // Where the photo well and the title's baseline actually were, in
            // this page's own CSS pixels. The destination FLIPs from exactly
            // these, which is why nothing here is per-page geometry.
            photo: photo,
        };
        if (isFelt) {
            stash.kind = 'felt';
            delete stash.image;
        }
        else {
            stash.title = {
                x: rect.x + L.title.x * rect.w,
                baseline: rect.y + L.title.baseline * rect.h,
                size: L.title.size * rect.h,
            };
        }
        sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(stash));
    } catch (err) { /* private mode, or no room — the case page copes either way */ }
}

// The one place a card actually opens its page. Both the click and the
// keyboard route through here so neither can forget the hand-off.
function openCard(index) {
    if (COMING_SOON_INDICES.has(index)) return;
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
    const hw = cardW / 2, hh = cardH / 2;
    const geo = new THREE.ShapeGeometry(makeRoundedCardShape(cardW, cardH, radius));
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

// The card's outline on its own, so the edge band (makeCardEdgeGeo) follows
// exactly the corners the faces were cut with.
function makeRoundedCardShape(cardW, cardH, radius) {
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
    return shape;
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

// ── Card stock ───────────────────────────────────────────────────────────────
// Three things make the cards read as printed cards rather than flat pictures:
//
//   1. An embossed linen finish — the fine basket weave pressed into trading
//      and playing cards — kept as a height map, never painted into the art.
//   2. A sliver of thickness: an edge band joining the face to the back.
//   3. The mouse as a faint light. The weave is shaded from the cursor's
//      direction, so moving it slides the highlights and the tiny shadows
//      across the surface. Touch screens have no cursor to follow, so there the
//      stock sits under a still light from the upper left and only the texture
//      shows.
//
// Every number that decides how much of this you can see is here. It is meant
// to be found by looking for it, not noticed.
const CARD_STOCK = {
    thickness: 0.005,      // card-local units; a face is 1.7 tall (~real card stock)
    tiles: 1.15,           // height-map tiles down the card (fibres ~1–3% of its height)
    relief: 0.5,           // how far the surface tilts the normal
    // The texture is applied in perceived lightness (cube root of linear
    // light, i.e. CIE L* / 116), not in linear light. Linear light treats the
    // two stocks completely differently: the same added light is ~8× more
    // visible on #373737 than on #F7F5F5, and multiplying near-white runs
    // into 1.0 and clips. In lightness units one number looks the same on both.
    reliefGain: 0.15,      // relief → lightness (≈ 17 L* per unit of relief)
    poolGain: 0.03,        // the soft brightening right under the cursor
    poolFalloff: 1.6,      // how quickly that pool fades, per unit²
    sheen: 0.008,          // tiny glints off the fibre tops, in lightness (≈ 0.9 L*)
    // Per-theme trim on top. Equal lightness still reads stronger on the dark
    // stock: light-on-dark specks stand out, and the eye is dark-adapted there.
    themeGain: { light: 1.25, dark: 0.6 },
    // The gloss streak: a slanted line of light through the cursor, like the
    // shine across a trading card. Sizes in card-local units (a face is 1.7
    // tall); gains in lightness, like reliefGain.
    streak: {
        angle: 24,         // degrees off vertical
        core: 0.045,       // half-width of the bright centre line
        halo: 0.2,         // half-width of the soft glow around it
        length: 0.85,      // how far along the line before it fades out
        lead: 0.35,        // the streak runs this much ahead of the cursor
        coreGain: 0.02,    // brightness of the centre line (≈ 2.3 L*)
        haloGain: 0.01,    // brightness of the glow (≈ 1.2 L*)
        fibre: 0.6,        // how much the fibres break the line up
    },
    lightLift: 0.3,        // how far in front of the face the cursor light floats (lower = more raking)
    edgeShade: { light: 0.86, dark: 0.78 },   // edge colour vs. the card stock
};
const CARD_STOCK_HEIGHT_PX = 512;

// The stock's surface, as heights in 0..1.
//
// Not a weave. A linen finish is a crosshatch pressed in by a patterned roller,
// and however it is softened it reads as a grid. Uncoated card stock — felt and
// vellum finishes, the "papery" playing cards — has no pattern at all. Under a
// raking light it shows three things, at three scales, and this is those three:
//
//   1. Formation: the sheet is never perfectly even. Fibres settle into soft
//      clumps and thin patches a few millimetres across, a faint cloudiness.
//   2. Fibres: the surface is matted cellulose, strands a millimetre or few
//      long lying every which way (with a slight lean along the machine
//      direction), each catching the light along one side.
//   3. Tooth: the fine eggshell grain between them, what a vellum finish is.
//
// All of it wraps at the edge, so the tile repeats without a seam, and the
// tile is big enough that it is never seen to repeat on one card.
function makeCardStockHeightTexture(size = CARD_STOCK_HEIGHT_PX) {
    const N = size;
    let seed = 7331;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const wrap = (v) => ((v % N) + N) % N;
    const smooth = (t) => t * t * (3 - 2 * t);

    // Wrapping value noise on a cells×cells lattice
    function valueNoise(cells) {
        const lat = new Float32Array(cells * cells).map(() => rand());
        const out = new Float32Array(N * N);
        for (let y = 0; y < N; y++) {
            const gy = (y / N) * cells, y0 = Math.floor(gy), fy = smooth(gy - y0);
            const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
            for (let x = 0; x < N; x++) {
                const gx = (x / N) * cells, x0 = Math.floor(gx), fx = smooth(gx - x0);
                const c0 = x0 % cells, c1 = (x0 + 1) % cells;
                const top = lat[r0 + c0] + (lat[r0 + c1] - lat[r0 + c0]) * fx;
                const bot = lat[r1 + c0] + (lat[r1 + c1] - lat[r1 + c0]) * fx;
                out[y * N + x] = top + (bot - top) * fy;
            }
        }
        return out;
    }

    // 1. Formation
    const f1 = valueNoise(5), f2 = valueNoise(12), f3 = valueNoise(28);
    // 2. Fibres — laid down as soft strokes. Raised and pressed-in fibres go in
    // separate layers and each keeps its highest value rather than summing, so
    // crossings stay crossings instead of building up into blobs.
    const up = new Float32Array(N * N), down = new Float32Array(N * N);
    // A tile is ~0.9 of a card's height, so 1% of the card is ~4.5px here.
    // Real fibres are ~1–3mm on an 88mm card: 5–15px, short and fine. Longer
    // than that and they overlap into a network that reads as crumpled.
    const FIBRES = Math.round(3200 * (N / 512) * (N / 512));
    for (let i = 0; i < FIBRES; i++) {
        let x = rand() * N, y = rand() * N;
        // A light machine-direction lean: some fibres run near horizontal,
        // the rest point anywhere.
        let a = rand() < 0.35 ? (rand() - 0.5) * 0.8 : rand() * Math.PI;
        const len = 4 + Math.pow(rand(), 1.5) * 13;
        const w = 0.45 + rand() * 0.4;            // half-width, px
        const invW2 = 1 / (w * w);
        const amp = 0.5 + rand() * 0.5;
        const layer = rand() < 0.25 ? down : up;
        const bend = (rand() - 0.5) * 0.06;
        for (let t = 0; t < len; t += 0.5) {
            a += bend + (rand() - 0.5) * 0.04;
            x += Math.cos(a) * 0.5;
            y += Math.sin(a) * 0.5;
            // Fibres taper at both ends
            const taper = Math.sin(Math.PI * Math.min(1, t / len));
            const cx = Math.round(x), cy = Math.round(y);
            const peak = amp * taper;
            for (let dy = -2; dy <= 2; dy++) {
                const ey = cy + dy - y, row = wrap(cy + dy) * N;
                for (let dx = -2; dx <= 2; dx++) {
                    const ex = cx + dx - x;
                    const d = (ex * ex + ey * ey) * invW2;
                    if (d > 4.6) continue;   // under 1% of the peak: skip the exp
                    const v = peak * Math.exp(-d);
                    const k = row + wrap(cx + dx);
                    if (v > layer[k]) layer[k] = v;
                }
            }
        }
    }
    // 3. Tooth — white noise, softened twice so it is a smooth eggshell grain
    // rather than static (once left it reading as sandpaper)
    const soften = (src) => {
        const out = new Float32Array(N * N);
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                let sum = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        sum += src[wrap(y + dy) * N + wrap(x + dx)] * (dx === 0 && dy === 0 ? 4 : (dx === 0 || dy === 0) ? 2 : 1);
                    }
                }
                out[y * N + x] = sum / 16;
            }
        }
        return out;
    };
    const tooth = soften(soften(new Float32Array(N * N).map(() => rand())));

    const h = new Float32Array(N * N);
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < N * N; k++) {
        const formation = 0.5 * f1[k] + 0.3 * f2[k] + 0.2 * f3[k];
        // Tooth kept low: the fine grain is what reads as "rough"
        const v = 0.26 * formation + 0.50 * (up[k] - 0.8 * down[k]) + 0.24 * tooth[k];
        h[k] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
    }

    // The shader only ever wants the surface's SLOPE, so that is what is
    // stored — x slope in red, y slope in green — worked out here once
    // instead of from four height lookups per pixel, every frame. Slopes are
    // stretched to fill the 8 bits and the stretch is handed to the shader.
    const range = hi - lo;
    const sx = new Float32Array(N * N), sy = new Float32Array(N * N);
    let maxSlope = 1e-6;
    for (let y = 0; y < N; y++) {
        const up1 = wrap(y - 1) * N, dn1 = wrap(y + 1) * N, row = y * N;
        for (let x = 0; x < N; x++) {
            const k = row + x;
            const gx = (h[row + wrap(x + 1)] - h[row + wrap(x - 1)]) / range;
            const gy = (h[dn1 + x] - h[up1 + x]) / range;
            sx[k] = gx; sy[k] = gy;
            const m = Math.max(Math.abs(gx), Math.abs(gy));
            if (m > maxSlope) maxSlope = m;
        }
    }
    const data = new Uint8Array(N * N * 4);
    for (let k = 0; k < N * N; k++) {
        data[k * 4]     = Math.round((sx[k] / maxSlope * 0.5 + 0.5) * 255);
        data[k * 4 + 1] = Math.round((sy[k] / maxSlope * 0.5 + 0.5) * 255);
        data[k * 4 + 2] = 128;
        data[k * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace;   // slopes, not colour
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    // 4× is all a fine grain needs at a card's tilt; the max (often 16×)
    // costs texture bandwidth on every pixel of every face for nothing visible.
    tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return { tex, slope: maxSlope };
}

// Building the surface is ~a quarter-million-pixel job, so it is kept off the
// load path: the cards start perfectly flat (slope 0 — the texture is only
// ever a subtle difference on top of the artwork, so nothing looks missing)
// and the real surface is swapped in once the browser is idle.
const _flatStock = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1, THREE.RGBAFormat);
_flatStock.needsUpdate = true;
function loadCardStockSurface() {
    const { tex, slope } = makeCardStockHeightTexture();
    CARD_STOCK_UNIFORMS.uStockHeight.value = tex;
    CARD_STOCK_UNIFORMS.uStockSlope.value = slope;
}
(window.requestIdleCallback || ((fn) => setTimeout(fn, 1200)))(loadCardStockSurface, { timeout: 4000 });

// One set of uniforms, shared by reference with every card material, so the
// light is moved once a frame for the whole deck.
const CARD_STOCK_UNIFORMS = {
    uStockHeight:  { value: _flatStock },   // the real surface arrives on idle
    uStockSlope:   { value: 0 },            // undoes the 8-bit stretch of the slopes
    uStockRelief:  { value: CARD_STOCK.relief },
    uStockGain:    { value: CARD_STOCK.reliefGain },
    uStockTheme:   { value: CARD_STOCK.themeGain[currentTheme] },
    uStreakDir:    { value: new THREE.Vector2(
        Math.sin(THREE.MathUtils.degToRad(CARD_STOCK.streak.angle)),
        Math.cos(THREE.MathUtils.degToRad(CARD_STOCK.streak.angle))) },
    uStreakShape:  { value: new THREE.Vector4(CARD_STOCK.streak.core, CARD_STOCK.streak.halo,
        CARD_STOCK.streak.length, CARD_STOCK.streak.lead) },
    uStreakGain:   { value: new THREE.Vector3(CARD_STOCK.streak.coreGain, CARD_STOCK.streak.haloGain,
        CARD_STOCK.streak.fibre) },
    uStockPool:    { value: CARD_STOCK.poolGain },
    uStockFalloff: { value: CARD_STOCK.poolFalloff },
    uStockSheen:   { value: CARD_STOCK.sheen },
    uStockLight:   { value: new THREE.Vector3(0, 0, 0) },   // view space
    uStockLightOn: { value: 0 },                            // 0 = still light, 1 = cursor
};

const CARD_STOCK_VERT_PARS = `
varying vec3 vStockCentre;
varying float vStockScale;
varying vec3 vStockPos;
varying vec3 vStockN;
varying vec3 vStockT;
varying vec3 vStockB;
`;
const CARD_STOCK_VERT = `
vStockPos = mvPosition.xyz;
vStockCentre = ( modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
vStockScale = length( mat3( modelViewMatrix ) * vec3( 1.0, 0.0, 0.0 ) );
vStockN = normalize( normalMatrix * normal );
vStockT = normalize( mat3( modelViewMatrix ) * vec3( 1.0, 0.0, 0.0 ) );
vStockB = normalize( mat3( modelViewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );
`;
const CARD_STOCK_FRAG_PARS = `
varying vec3 vStockCentre;
varying float vStockScale;
varying vec3 vStockPos;
varying vec3 vStockN;
varying vec3 vStockT;
varying vec3 vStockB;
uniform vec2 uStreakDir;
uniform vec4 uStreakShape;
uniform vec3 uStreakGain;
uniform sampler2D uStockHeight;
uniform float uStockSlope;
uniform float uStockRelief;
uniform float uStockGain;
uniform float uStockTheme;
uniform float uStockPool;
uniform float uStockFalloff;
uniform float uStockSheen;
uniform vec3 uStockLight;
uniform float uStockLightOn;
uniform vec2 uStockRepeat;

vec3 stockLightDir() {
    // The still light for touch screens: up and to the left, like a desk lamp.
    vec3 still = normalize( vec3( -0.35, 0.55, 0.76 ) );
    vec3 cursor = normalize( uStockLight - vStockPos );
    return normalize( mix( still, cursor, uStockLightOn ) );
}
float stockPool() {
    vec2 d = uStockLight.xy - vStockPos.xy;
    return uStockLightOn * exp( -dot( d, d ) * uStockFalloff );
}
`;
// The face: the weave tilts the normal, and only the DIFFERENCE that tilt
// makes is applied — a flat card under the same light is left exactly as
// painted, so the artwork's colours never shift, only the texture breathes.
const CARD_STOCK_FRAG_FACE = `
{
    vec2 p = vMapUv * uStockRepeat;
    // One lookup: the slope was worked out ahead of time (see the texture).
    vec2 s = ( texture2D( uStockHeight, p ).rg * 2.0 - 1.0 ) * uStockSlope;
    float hx = s.x, hy = s.y;
    vec3 N = normalize( vStockN );
    vec3 n = normalize( N - uStockRelief * ( hx * normalize( vStockT ) + hy * normalize( vStockB ) ) );
    vec3 L = stockLightDir();
    float relief = max( dot( n, L ), 0.0 ) - max( dot( N, L ), 0.0 );
    vec3 H = normalize( L + normalize( -vStockPos ) );
    float glint = pow( max( dot( n, H ), 0.0 ), 48.0 ) * uStockLightOn;
    outgoingLight *= 1.0 + stockPool() * uStockPool;
    // Into perceived lightness, so the same number reads the same on light and
    // dark stock (see CARD_STOCK.reliefGain).
    vec3 pl = pow( max( outgoingLight, vec3( 0.0 ) ), vec3( 1.0 / 3.0 ) );
    // The gloss streak. Where the cursor sits on this face, in the face's own
    // axes, pushed a little further out than the cursor itself (a reflection
    // moves faster than the light that makes it), then a slanted line through
    // that point: a thin bright core in a soft glow, fading out along its length.
    vec3 T = normalize( vStockT ), B = normalize( vStockB );
    vec3 fromCentre = vStockPos - vStockCentre;
    vec3 litCentre  = uStockLight - vStockCentre;
    // (divided by the card's scale, so the sizes are in card-local units)
    vec2 here = vec2( dot( fromCentre, T ), dot( fromCentre, B ) ) / vStockScale;
    vec2 lit  = vec2( dot( litCentre, T ),  dot( litCentre, B ) ) / vStockScale * ( 1.0 + uStreakShape.w );
    vec2 q = here - lit;
    float across = dot( q, vec2( uStreakDir.y, -uStreakDir.x ) );
    float along  = dot( q, uStreakDir );
    // (squared by hand: GLSL's pow() is undefined for a negative base)
    float ac = across / uStreakShape.x, ah = across / uStreakShape.y, al = along / uStreakShape.z;
    float streak = ( uStreakGain.x * exp( -ac * ac ) + uStreakGain.y * exp( -ah * ah ) )
                 * exp( -al * al )
                 // only on the side of the card that faces the viewer
                 * max( dot( N, normalize( -vStockPos ) ), 0.0 )
                 // the fibres break the line up a little, so it reads as gloss on paper
                 * clamp( 1.0 + relief * uStreakGain.z, 0.0, 2.0 )
                 * uStockLightOn;
    float d = ( relief * uStockGain + glint * uStockSheen + streak ) * uStockTheme;
    // Brightening rolls off softly toward white instead of clipping, so the
    // near-white stock keeps its highlights; darkening is applied as is.
    vec3 room = max( 1.0 - pl, vec3( 1e-4 ) );
    pl = d > 0.0 ? 1.0 - room * exp( -d / room ) : pl + d;
    outgoingLight = pl * pl * pl;
}
`;
// The edge has no texture to speak of; it is just shaded by which way it faces.
const CARD_STOCK_FRAG_EDGE = `
{
    vec3 L = stockLightDir();
    outgoingLight *= 0.88 + 0.12 * max( dot( normalize( vStockN ), L ), 0.0 ) + stockPool() * uStockPool * 2.0;
}
`;

// Adds the stock to a card material, on top of whatever patch it already has
// (card 0's photo reveal replaces map_fragment, so the hook here is
// opaque_fragment, which nothing else touches).
function applyCardStock(material, { face = true, aspect = 1 } = {}) {
    const repeat = new THREE.Vector2(CARD_STOCK.tiles * aspect, CARD_STOCK.tiles);
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, r) => {
        prevCompile.call(material, shader, r);
        Object.assign(shader.uniforms, CARD_STOCK_UNIFORMS, { uStockRepeat: { value: repeat } });
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\n' + CARD_STOCK_VERT_PARS)
            .replace('#include <project_vertex>', '#include <project_vertex>\n' + CARD_STOCK_VERT);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', '#include <common>\n' + CARD_STOCK_FRAG_PARS)
            .replace('#include <opaque_fragment>',
                (face ? CARD_STOCK_FRAG_FACE : CARD_STOCK_FRAG_EDGE) + '\n#include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => prevKey() + (face ? '|stock-face' : '|stock-edge');
    material.needsUpdate = true;
}

// The band round the card's edge: the outline extruded back to the card's
// thickness, sides only (the faces are already there, front and back).
function makeCardEdgeGeo(cardW, cardH, radius, depth) {
    const geo = new THREE.ExtrudeGeometry(makeRoundedCardShape(cardW, cardH, radius), {
        depth, bevelEnabled: false, curveSegments: 8,
    });
    geo.translate(0, 0, -depth);
    return geo;
}
const cardEdgeMats = [];
const _hiddenCapMat = new THREE.MeshBasicMaterial({ visible: false });
function cardEdgeColor(theme) {
    return new THREE.Color(THEME_COLORS[theme].cardBg).multiplyScalar(CARD_STOCK.edgeShade[theme]);
}
function updateCardStockTheme(theme) {
    const c = cardEdgeColor(theme);
    cardEdgeMats.forEach((m) => m.color.copy(c));
    CARD_STOCK_UNIFORMS.uStockTheme.value = CARD_STOCK.themeGain[theme];
}

// Where the cursor light is. Only a real mouse moves it; a finger or a pen
// leaves the still light alone.
const stockPointer = { x: 0, y: 0, active: false };
window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    stockPointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    stockPointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    stockPointer.active = true;
}, { passive: true });
document.documentElement.addEventListener('mouseleave', () => { stockPointer.active = false; });
window.addEventListener('blur', () => { stockPointer.active = false; });

const _stockRing = new THREE.Vector3();
const _stockTarget = new THREE.Vector3();
let _stockPlaced = false;
function updateCardStockLight() {
    const u = CARD_STOCK_UNIFORMS;
    u.uStockLightOn.value += ((stockPointer.active ? 1 : 0) - u.uStockLightOn.value) * 0.05;
    if (u.uStockLightOn.value < 0.001 && !stockPointer.active) return;
    // The light floats just in front of the front card, right over the cursor.
    _stockRing.setFromMatrixPosition(cardgroup.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
    const faceDepth = Math.max(0.4, -_stockRing.z - getCarouselRadius());
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    _stockTarget.set(
        stockPointer.x * tanHalf * camera.aspect * faceDepth,
        stockPointer.y * tanHalf * faceDepth,
        -faceDepth + CARD_STOCK.lightLift,
    );
    if (!_stockPlaced) { u.uStockLight.value.copy(_stockTarget); _stockPlaced = true; }
    else u.uStockLight.value.lerp(_stockTarget, 0.18);
}

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

// Nenos is not open yet. The card itself stays solid — same stock,
// same shadow as the rest of the deck — and only what is printed on it is
// faded, in buildTemplateCardTexture (see `comingSoon` there).
const COMING_SOON_INK = 0.5;

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
    // First visit: hidden until the deal drops them in. A return already
    // saw that, and waiting for the last of nine textures is the pause
    // after Playground — the page is up, the ring is empty, then
    // everything appears at once. Sit each card down as it finishes.
    // Hidden while the build-in still has it; its stand-in is on screen.
    group.visible = !cbOwns(i);
    cardIntroY[i] = 0;
    cardHoverY[i] = 0;
    group.position.y = 0;

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

    // Card stock: the face gets the linen finish, and an edge band gives the
    // card its thickness — the back sits that far behind the face.
    const frontMesh = group.children[0];
    frontMesh.geometry.computeBoundingBox();
    const bb = frontMesh.geometry.boundingBox;
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;
    applyCardStock(frontMesh.material, { aspect: w / h });
    cbAttach(i, group);

    const edgeMat = new THREE.MeshBasicMaterial({ color: cardEdgeColor(currentTheme) });
    applyCardStock(edgeMat, { face: false });
    cardEdgeMats.push(edgeMat);
    // ExtrudeGeometry's group 0 is the two caps, group 1 the sides; the caps
    // would only cover the faces, so they are never drawn.
    const edgeMesh = new THREE.Mesh(
        makeCardEdgeGeo(w, h, 0.06, CARD_STOCK.thickness), [_hiddenCapMat, edgeMat]);
    group.add(edgeMesh);

    // Add card back face using the shared back texture
    backTexturePromise.then((backTex) => {
        const geo = makeRoundedCardGeo(w, h, 0.06);
        const mat = new THREE.MeshBasicMaterial({
            map: backTex, side: THREE.FrontSide
        });
        applyCardStock(mat, { aspect: w / h });
        const backMesh = new THREE.Mesh(geo, mat);
        backMesh.rotation.y = Math.PI;
        backMesh.position.z = -CARD_STOCK.thickness;
        group.add(backMesh);
    });

    if (COMING_SOON_INDICES.has(i)) group.userData.comingSoon = true;

    cards[i] = group;
    cardgroup.add(group);
    loadedModels++;
    if (i === 0) document.body.classList.add('gradient-visible');
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
// The faces are drawn at very nearly the size they are shown at. A canvas much
// bigger than its spot on screen is not sharper — the GPU has to shrink it, and
// it does that by blending its pre-shrunk copies, which is exactly what made the
// text and pills read soft (a 1449px face was going into ~525 real pixels).
// Drawn ~1:1, the type lands on the screen's own pixel grid, like the page UI.
//
// Worked out from the scene itself — the front card's height at its distance
// from the camera, as a share of the view — rather than a rule of thumb, so it
// stays right at every breakpoint. Rounded up in 5% steps: a hair too big
// shrinks cleanly, a hair too small would have to be stretched.
//
// And kept current. When the window is resized (or dragged onto a denser
// screen) and the card's size on screen changes, every face is redrawn at the
// new size — see the resize handler below.
function cardTextureScale() {
    const dist = camera.position.z - getCarouselRadius();
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
    const share = (1.7 * getCardScale()) / viewH;
    const onScreenPx = share * window.innerHeight * Math.min(window.devicePixelRatio, 2);
    const scale = onScreenPx / 1449;   // 1449 is the design height
    return Math.max(0.3, Math.min(2, Math.ceil(scale * 20) / 20));
}
let CARD_TEXTURE_SCALE = cardTextureScale();

// Brings a face canvas to the current scale. Resizing a canvas wipes it, so
// this is only ever called at the top of a paint. Returns whether the size
// changed — when it has, the GPU copy is the wrong shape and has to be dropped
// (three.js allocates a texture's storage once, at its first size).
function fitFaceCanvas(canvas, design) {
    const w = Math.floor(design.w * CARD_TEXTURE_SCALE);
    const h = Math.floor(design.h * CARD_TEXTURE_SCALE);
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
}

// Once a resize settles, redraw the faces if the card's size on screen has
// moved to a new step. Through the same staggered queue a theme change uses —
// nearest card first, one per frame — so it never locks the scene up, and the
// card being looked at is sharp again on the very first frame.
let _faceScaleTimer = 0;
function refreshCardFaceScale() {
    const next = cardTextureScale();
    if (next === CARD_TEXTURE_SCALE) return;
    CARD_TEXTURE_SCALE = next;
    updateCardBackTexture(currentTheme);
    updateCardFaceTextures(currentTheme);
}
window.addEventListener('resize', () => {
    clearTimeout(_faceScaleTimer);
    _faceScaleTimer = setTimeout(refreshCardFaceScale, 180);
});

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
// Local x=0 stays on the card's right, so the rounded corner never uncovers.
// Local x=837 is the shelf's far left — scale that axis down and the notch
// walks toward the pills without the hard clip a pointwise shift produced.
const ABOUTME_CUT_FAR_X = 837;
const ABOUTME_CUT_ORIGIN_X = 1058;
function playgroundCutMatrix(s, rowXDesign) {
    const hug = ABOUTME_PILLS[0].x - (ABOUTME_CUT_ORIGIN_X - ABOUTME_CUT_FAR_X);
    const farX = ABOUTME_CUT_ORIGIN_X - (rowXDesign - hug);
    const k = Math.max(0.55, Math.min(1, farX / ABOUTME_CUT_FAR_X));
    return new DOMMatrix([-s * k, 0, 0, -s, ABOUTME_CUT_ORIGIN_X * s, 1434 * s]);
}
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
        const w0 = face.canvas.width;
        a.paint(face.ctx, currentTheme, img);
        // Built before a resize: the canvas has just changed size under it
        if (face.canvas.width !== w0) face.texture.dispose();
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
    if (!a.ready || a.busy || cbOwns(0)) return;
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
        // Naming the faces this card draws with is what actually fetches
        // them. fonts.ready only waits on type the document already asked
        // for, and index.html renders nothing in Play — so the name used
        // to paint 2% wide in the fallback sans. It also waits on every
        // other face on the page, which is the pause on the way back.
        document.fonts.load(`700 ${80 * s}px "DM Sans"`),
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
            // Drawn at the current scale, which the window can change
            const s = CARD_TEXTURE_SCALE, r = 36 * s;
            if (fitFaceCanvas(canvas, ABOUTME_DESIGN)) smoothing(ctx);
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
            ctx.font = `700 ${80 * s}px "DM Sans", sans-serif`;
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
                const w0 = live.canvas.width;
                paint(live.ctx, theme, aboutmeImages[aboutmeSwap.index] || photo);
                if (live.canvas.width !== w0) live.texture.dispose();   // new size, new storage
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
        document.fonts.load(`700 ${96 * s}px "DM Sans"`),
        document.fonts.load(`italic 400 ${36 * s}px "DM Sans"`),
        document.fonts.load(`400 ${64 * s}px "DM Sans"`),
        document.fonts.load(`600 ${40 * s}px "DM Sans"`),
        new Promise((resolve) => { mockup.onload = resolve; }),
    ]).then(() => {
        const r = 36 * s;

        function paint(theme) {
            // Drawn at the current scale, which the window can change
            const s = CARD_TEXTURE_SCALE, r = 36 * s;
            fitFaceCanvas(canvas, PUREGYM_DESIGN);
            const { cardBg, ink, inkBody } = THEME_COLORS[theme];

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
            tmplPhotoInnerShadow(ctx, 21 * s, 20 * s, s);

            // "#003" — this card's position in the site's numbering (not Figma's placeholder number).
            // Sits in the folded-corner notch on bare stock, so it follows the theme's ink
            // like the template cards' tags do.
            ctx.fillStyle = ink;
            ctx.font = `italic 400 ${36 * s}px "DM Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText('#003', 100.5 * s, 24 * s);

            // Title
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = ink;
            ctx.font = `700 ${96 * s}px "DM Sans", sans-serif`;
            ctx.fillText('Puregym Redesign', 54 * s, 960 * s, 951 * s);

            // Description, on the same measure as every template card
            ctx.fillStyle = inkBody;
            ctx.font = `400 ${CARD_BODY.size * s}px "DM Sans", sans-serif`;
            puregymWrapText(
                ctx,
                'Mobile redesign case study for Puregym focused on minimizing friction during check-in.',
                54 * s, CARD_BODY.y * s, CARD_BODY.width * s, CARD_BODY.lineHeight * s
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
                const w0 = canvas.width;
                paint(theme);
                if (canvas.width !== w0) texture.dispose();   // new size, new storage
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
        // The bare picture, for the card → page flight (see stashCardHandoff)
        group.userData.handoffPhoto = mockup;
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
// The copy under the title, in design px. There is no date line between the
// two any more, so the description starts where that line used to sit and
// takes the room it left at a size that reads from across the ring.
const CARD_BODY = { y: 1062, size: 56, lineHeight: 70, width: 950 };
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

// The pill row starts at 1354 (design px); the copy's descenders stop this far
// above it, and it never shrinks below CARD_BODY_MIN_SIZE to get there.
const CARD_BODY_BOTTOM = 1354 - 40;
const CARD_BODY_MIN_SIZE = 42;

// How many lines tmplWrapText would draw, without drawing them.
function tmplCountLines(ctx, text, maxWidth) {
    const words = text.split(' ');
    let line = '';
    let count = 1;
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            count++;
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
    }
    return count;
}

// The photo region on every card is rounded-cornered with a "folded corner"
// cutout at top-left — that's where the "#00X" tag sits. This is traced
// directly from Figma's own vector path (node 1060:7, the Puregym card's
// "Subtract" layer — every card's photo box is the same 1016.663×817 size,
// so this exact geometry applies to all of them, not an approximation). It's
// not a simple arc: the notch rises from the left edge, holds briefly flat
// (the "equilibrium" plateau), then rises again into the diagonal and curves
// into the top edge — a compound S-curve, not a single bulge.
function tmplPhotoClipPath(ctx, x, y, s, keepPath) {
    if (!keepPath) ctx.beginPath();
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

// A soft shadow cast inward from the photo well's edge, so the picture reads as
// set down into the stock rather than printed flat on it. The trick is a frame
// that is only ever drawn outside the well - a big rectangle with the well cut
// out of it - while the clip keeps the well: the frame itself never shows, and
// the only thing that lands inside is its shadow.
//
// The frame is drawn well off the canvas and only its shadow is sent back. Drawn
// in place, its inner edge sat exactly on the clip's edge, and the two
// anti-aliased edges never cancel out: a sliver of the black frame always
// survived as a hard dark ring round the picture. At the old 2.75× faces it
// was a hairline nobody could see; drawn at screen size it is a whole pixel.
function tmplPhotoInnerShadow(ctx, x, y, s) {
    const away = ctx.canvas.width + 4000;   // device px; this ctx is never scaled
    ctx.save();
    tmplPhotoClipPath(ctx, x, y, s);
    ctx.clip();
    ctx.translate(away, 0);
    ctx.beginPath();
    ctx.rect(x - 200 * s, y - 200 * s, 1416.66 * s, 1217 * s);
    tmplPhotoClipPath(ctx, x, y, s, true);
    ctx.shadowColor = 'rgba(0, 0, 0, 0.09)';
    ctx.shadowBlur = 32 * s;
    ctx.shadowOffsetX = -away;
    ctx.shadowOffsetY = 4 * s;
    ctx.fillStyle = '#000';
    ctx.fill('evenodd');
    ctx.restore();
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

function buildTemplateCardTexture({ imageSrc, tag, title, accentLine, description, pills, comingSoon }) {
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
        document.fonts.load(`700 ${96 * s}px "DM Sans"`),
        document.fonts.load(`italic 400 ${36 * s}px "DM Sans"`),
        document.fonts.load(`400 ${64 * s}px "DM Sans"`),
        document.fonts.load(`600 ${40 * s}px "DM Sans"`),
        photo ? new Promise((resolve) => { photo.onload = resolve; }) : Promise.resolve(),
    ]).then(() => {
        const r = 36 * s;

        function paint(theme) {
            // Drawn at the current scale, which the window can change
            const s = CARD_TEXTURE_SCALE, r = 36 * s;
            fitFaceCanvas(canvas, TEMPLATE_CARD);
            const { cardBg, accent, ink, inkBody, placeholder } = THEME_COLORS[theme];

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
            tmplPhotoInnerShadow(ctx, 21 * s, 20 * s, s);

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
            ctx.font = `700 ${96 * s}px "DM Sans", sans-serif`;
            ctx.fillText(title, 54 * s, 960 * s, 951 * s);

            // The copy has to clear the pill row. A card with an accent line
            // on top of a long description (The Dial) runs a line or two past
            // the room there is, so step the size down until it all fits with
            // a clear gap above the pills.
            let bodySize = CARD_BODY.size;
            let bodyLH = CARD_BODY.lineHeight;
            while (bodySize > CARD_BODY_MIN_SIZE) {
                ctx.font = `400 ${bodySize * s}px "DM Sans", sans-serif`;
                const lines = (accentLine ? tmplCountLines(ctx, accentLine, CARD_BODY.width * s) : 0)
                    + tmplCountLines(ctx, description, CARD_BODY.width * s);
                const lastBaseline = CARD_BODY.y + (lines - 1) * bodyLH;
                if (lastBaseline + bodySize * 0.25 <= CARD_BODY_BOTTOM) break;
                bodySize -= 2;
                bodyLH = bodySize * (CARD_BODY.lineHeight / CARD_BODY.size);
            }
            ctx.font = `400 ${bodySize * s}px "DM Sans", sans-serif`;
            let y = CARD_BODY.y * s;
            if (accentLine) {
                ctx.fillStyle = accent;
                y = tmplWrapText(ctx, accentLine, 54 * s, y, CARD_BODY.width * s, bodyLH * s);
            }
            ctx.fillStyle = inkBody;
            tmplWrapText(ctx, description, 54 * s, y, CARD_BODY.width * s, bodyLH * s);

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

            // Coming soon: wash the stock back over everything printed so far.
            // Half the stock on top is the same as the ink at half strength,
            // and the card underneath stays fully opaque.
            if (comingSoon) {
                ctx.save();
                ctx.beginPath();
                ctx.roundRect(0, 0, canvas.width, canvas.height, r);
                ctx.clip();
                ctx.globalAlpha = 1 - COMING_SOON_INK;
                ctx.fillStyle = cardBg;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
            }

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
        return { canvas, paint, photo };
    });
}

function loadTemplateCard(index, opts) {
    if (COMING_SOON_INDICES.has(index)) opts = Object.assign({ comingSoon: true }, opts);
    // The copy, so the build-in can lay out this card's wireframe right away
    cbCards[index].spec = { type: 'template', opts };
    buildTemplateCardTexture(opts).then(({ canvas, paint, photo }) => {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        cardFaceRepaints.push({
            index: index,
            repaint: (theme) => {
                const w0 = canvas.width;
                paint(theme);
                if (canvas.width !== w0) texture.dispose();   // new size, new storage
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
        // The bare picture, for the card → page flight (see stashCardHandoff)
        group.userData.handoffPhoto = photo || null;
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
        description: 'Product Design Internship across B2B, consumer, and more at BMW Designworks.',
        pills: ['2026', 'INTERNSHIP', 'UI/UX'],
    });
}

// ── Card 7 — Nenos Inc. ───────────────────────────────────────────────────────
function loadCard7() {
    loadTemplateCard(7, {
        imageSrc: 'https://jhfyj.github.io/New-Website-Code/Cards/nenos-mockups.webp',
        tag: '#007',
        title: 'Nenos Inc.',
        description: 'Design Manager working with 7 designers to design the Places feature in a B2C product, from ideation to handoff.',
        pills: ['2026', 'INTERNSHIP', 'LEADERSHIP'],
    });
}

// ── Card 8 — Playground ──────────────────────────────────────────────────────
// Kept next to card 0 (About Me) — they're adjacent in the ring (8 and 0 sit
// next to each other since the carousel wraps around).

// A read-only window onto the ring, for the drivers in pw-driver/. Where the
// ring has got to is a WebGL fact with no reflection in the DOM, so without
// this there is no way to tell a driver which card is at the front, or how
// evenly the nine of them are spread around it.
// Localhost only: nothing about the internals is exposed on the live site.
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    window.__probe = {
        cardCount: () => cardCount,
        ringX: () => cardgroup.position.x,
        rotationY: () => cardgroup.rotation.y,
        // Each card's own angle around the ring and its resting height, in ring
        // order. Raw numbers rather than a verdict about them: a probe that
        // decided for itself whether the spacing was even would agree with
        // itself no matter where the cards actually were.
        // Built to length rather than mapped over cards, which is filled in
        // whatever order the textures finish loading: a driver that asked
        // early would otherwise get a short array and read it as a short ring.
        ring: () => Array.from({ length: cardCount }, (_, i) => {
            const c = cards[i];
            return c ? {
                index: i,
                angle: c.rotation.y,
                x: c.position.x, y: c.position.y, z: c.position.z,
                visible: c.visible,
            } : null;
        }),
        // The theme as the *carousel* holds it, which is a separate thing from
        // <html data-theme>: the fog and the card stock are painted from
        // currentTheme, and a page whose attribute says dark while the ring is
        // still drawing light stock is only half caught up. Raw values, so the
        // driver does the comparing — a probe that reported its own verdict
        // would agree with itself no matter what was on screen.
        theme: () => ({
            current: currentTheme,
            fog: '#' + scene.fog.color.getHexString(),
            fogLight: '#' + new THREE.Color(THEME_COLORS.light.fog).getHexString(),
            fogDark: '#' + new THREE.Color(THEME_COLORS.dark.fog).getHexString(),
            // A pixel of the painted card back, well inside the accent border,
            // so this is the card stock itself.
            cardBack: (() => {
                if (!cardBackCanvas.width) return null;
                const d = cardBackCtx.getImageData(
                    Math.round(cardBackCanvas.width / 2),
                    Math.round(cardBackCanvas.height * 0.15), 1, 1).data;
                return '#' + [d[0], d[1], d[2]]
                    .map(v => v.toString(16).padStart(2, '0')).join('');
            })(),
            cardBgLight: THEME_COLORS.light.cardBg.toLowerCase(),
            cardBgDark: THEME_COLORS.dark.cardBg.toLowerCase(),
        }),
    };
}

// ── Card 8 — Playground cover ────────────────────────────────────────────────
//
// Frame 4988's layout, drawn with the pieces that actually live on the
// table: the HFYJ back, the accent chips, a stock die. The live cloth
// still lives on playground.html; this is a still so the carousel is
// not keeping a second scene glued to a turning card.
const PLAYGROUND_PILLS = ['PLAYGROUND', 'CONCEPT'];
// Where the pieces sit, in the face's own design px. The cloth texture
// draws what they cast; the pieces themselves are geometry standing on
// top of the face, so turning the carousel shows their sides.
const PLAYGROUND_PROPS = {
    // The lower back sits clear of the pill shelf so the stock lip
    // cannot clip it.
    backs: [
        { x: 340, y: 300, w: 300, rot: -3 },
        { x: 730, y: 1020, w: 300, rot: 2 },
    ],
    chips: [
        { x: 800, y: 330, d: 108, spin: 18 },
        { x: 410, y: 1040, d: 104, spin: -28 },
    ],
    // Square with the card, no roll. A few degrees of lean is how a die
    // comes to rest in dice.js, but there the die is drawn flat against
    // the page; here it is a cube standing on a card you can turn, and
    // its own edges are the only straight lines to read its pose off.
    // Rolled, the top face stops being parallel to anything and the cube
    // reads as tipped over rather than sat down.
    dice: [
        { x: 250, y: 800, size: 100, value: 3 },
        { x: 886, y: 212, size: 92, value: 5 },
    ],
};
// Which cells carry a pip, as [column, row] — the same table dice.js uses.
const PLAYGROUND_PIPS = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [2, 0], [0, 2], [2, 2]],
    5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]],
    6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]],
};

function loadCard8() {
    // Same scale as the rest of the deck. This used to force 2× even when
    // the other eight faces sat at 1×, so the playground was four times
    // the pixels of About Me for a card the same size on screen. The
    // pieces that needed that extra resolution — dice, chips, backs —
    // are geometry now; the cloth is a repeating tile and does not.
    // A let: a resize redraws the face at the new scale (see repaint below).
    let s = ABOUTME_SCALE;
    // The prop slab's printed back keeps the size it was built at. It is
    // geometry on the card, uploaded once, and too small to be worth redoing.
    const sBack = s;
    const canvas = document.createElement('canvas');
    canvas.width = ABOUTME_DESIGN.w * s;
    canvas.height = ABOUTME_DESIGN.h * s;
    const ctx = canvas.getContext('2d');
    const FELT = '#2a4528';
    const aspect = ABOUTME_DESIGN.w / ABOUTME_DESIGN.h;
    const cardH = 1.7, cardW = cardH * aspect;

    let texture = null;
    let group = null;

    // Coming back from the table, this is the card facing the camera.
    // The real face waits on the nap, the mark, four fonts and a pile of
    // prop canvases — long enough to read as an empty ring. A felt-only
    // stand-in sits down now; the detailed face swaps over it once the
    // work below is done.
    function placeNow() {
        if (group) return;
        texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
        const mesh = new THREE.Mesh(geometry, frontMat);
        group = new THREE.Group();
        group.userData.cardIndex = 8;
        group.userData.cardTitle = 'Playground';
        group.add(mesh);
        _placeCard(8, group);
    }

    ctx.fillStyle = FELT;
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 36 * s);
    ctx.fill();
    placeNow();

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => reject(new Error(src));
            im.src = src;
        });
    }

    // WebP is what we ship. The live site still has the older JPEGs from
    // before that swap; a missing WebP used to throw here and leave the
    // green stand-in up forever. Try the new file, then the old one, and
    // if both are gone the face still paints — just on flat felt.
    function loadFeltTile() {
        return loadImage('assets/sketchbook/felt/albedo.webp')
            .catch(function () { return loadImage('assets/sketchbook/felt/albedo.jpg'); })
            .catch(function () { return null; });
    }

    // Kick the nap and the four faces off now, not when we come to paint.
    // Waiting until idle to even start the request was the pause: the
    // stand-in was up, and then nothing happened for up to 800ms while
    // the tile had not been asked for. About Me still wins the pipe —
    // its photo is a high-priority preload; this one is not.
    const detailReady = Promise.all([
        hfyjMarkReady.catch(function () { return null; }),
        loadFeltTile(),
        document.fonts.load(`400 ${144 * s}px "DM Sans"`).catch(function () {}),
        document.fonts.load(`400 ${46 * s}px "Mynerve"`).catch(function () {}),
        document.fonts.load(`italic 400 ${36 * s}px "Inter"`).catch(function () {}),
        document.fonts.load(`600 ${ABOUTME_PILL_FONT_PX}px "DM Sans"`).catch(function () {}),
    ]);

    function paintDetail() {
    return detailReady.then(async ([, albedo]) => {
        // One frame so the stand-in is on the GPU before this thread
        // spends itself tiling. Two was a frame of nothing.
        if (group) {
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        let r = 36 * s;
        // A repeating stamp, not a portrait. 256 covers the nap at the
        // size this card is seen; 520×s was a second megapixel texture
        // uploaded for grass you cannot resolve.
        const tile = document.createElement('canvas');
        tile.width = tile.height = 256;
        const tctx = tile.getContext('2d');
        if (albedo) {
            // The live mat is lit; a raw albedo tile reads a shade too dark.
            tctx.filter = 'brightness(1.32) saturate(0.95)';
            tctx.drawImage(albedo, 0, 0, tile.width, tile.height);
            tctx.filter = 'none';
        } else {
            tctx.fillStyle = FELT;
            tctx.fillRect(0, 0, tile.width, tile.height);
        }

        function drawBoxedText(text, x, y, w, h, align) {
            const m = ctx.measureText(text);
            ctx.textAlign = align;
            ctx.textBaseline = 'alphabetic';
            const inner = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
            const baseline = y + (h - inner) / 2 + m.fontBoundingBoxAscent;
            const tx = align === 'center' ? x + w / 2 : x;
            ctx.fillText(text, tx, baseline);
        }

        // Only what a chip leaves on the cloth. The chip itself is a
        // cylinder standing on the face — see buildProps below.
        function drawChipCast(cx, cy, d) {
            ctx.save();
            ctx.filter = `blur(${Math.max(1, d * 0.03)}px)`;
            ctx.beginPath();
            ctx.arc(cx + d * 0.12, cy + d * 0.16, d / 2, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.50)';
            ctx.fill();
            ctx.restore();
        }

        // Same cube the playground page casts: rotateX(52) rotateY(36),
        // slid 12/17 of a 46px die, faces at --cast. A 2D squash read as
        // an oval; this is the second cube lying on the cloth.
        function projectCast(x, y, z, half) {
            const yaw = 36 * Math.PI / 180, lie = 52 * Math.PI / 180;
            let X = x * Math.cos(yaw) + z * Math.sin(yaw);
            let Z = -x * Math.sin(yaw) + z * Math.cos(yaw);
            let Y = y;
            const Y2 = Y * Math.cos(lie) - Z * Math.sin(lie);
            Z = Y * Math.sin(lie) + Z * Math.cos(lie);
            Y = Y2;
            const persp = (520 / 46) * half * 2;
            const k = persp / (persp - Z);
            return { x: X * k, y: Y * k, z: Z };
        }

        function drawDieCast(size) {
            const h = size / 2;
            const corners = [];
            for (let i = 0; i < 8; i++) {
                corners.push(projectCast(
                    (i & 1) ? h : -h,
                    (i & 2) ? h : -h,
                    (i & 4) ? h : -h,
                    h,
                ));
            }
            const faces = [
                [0, 2, 3, 1], [4, 5, 7, 6],
                [0, 1, 5, 4], [2, 6, 7, 3],
                [0, 4, 6, 2], [1, 3, 7, 5],
            ];
            const drawn = [];
            for (let f = 0; f < faces.length; f++) {
                const id = faces[f];
                const a = corners[id[0]], b = corners[id[1]], c = corners[id[2]];
                const nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
                if (nz <= 0) continue;
                drawn.push({
                    z: (a.z + b.z + c.z + corners[id[3]].z) / 4,
                    id,
                });
            }
            drawn.sort((p, q) => p.z - q.z);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.shadowColor = 'rgba(0,0,0,0.34)';
            ctx.shadowBlur = Math.max(2, size * 0.15);
            for (let i = 0; i < drawn.length; i++) {
                const id = drawn[i].id;
                ctx.beginPath();
                ctx.moveTo(corners[id[0]].x, corners[id[0]].y);
                ctx.lineTo(corners[id[1]].x, corners[id[1]].y);
                ctx.lineTo(corners[id[2]].x, corners[id[2]].y);
                ctx.lineTo(corners[id[3]].x, corners[id[3]].y);
                ctx.closePath();
                ctx.fill();
            }
            ctx.shadowBlur = 0;
        }

        // The die's own shadow, offset the way dice.js rests it (12/17 of
        // a 46px die). The cube above it is geometry, not paint.
        function drawDieCastAt(cx, cy, size) {
            ctx.save();
            ctx.translate(cx + size * (12 / 46), cy + size * (17 / 46));
            drawDieCast(size);
            ctx.restore();
        }

        const coverBack = document.createElement('canvas');
        const coverBackCtx = coverBack.getContext('2d');
        function paintCoverBack(theme) {
            const s = sBack;
            const w = CARD_BACK_DESIGN.w * s, h = CARD_BACK_DESIGN.h * s;
            coverBack.width = w;
            coverBack.height = h;
            const { cardBg, accent } = THEME_COLORS[theme];
            coverBackCtx.setTransform(1, 0, 0, 1, 0, 0);
            coverBackCtx.clearRect(0, 0, w, h);
            coverBackCtx.save();
            coverBackCtx.beginPath();
            coverBackCtx.roundRect(0, 0, w, h, 36 * s);
            coverBackCtx.clip();
            coverBackCtx.fillStyle = cardBg;
            coverBackCtx.fillRect(0, 0, w, h);
            coverBackCtx.restore();
            coverBackCtx.beginPath();
            coverBackCtx.roundRect(0.5 * s, 0.5 * s, w - s, h - s, 36 * s);
            coverBackCtx.lineWidth = s;
            coverBackCtx.strokeStyle = '#000';
            coverBackCtx.stroke();
            const borderW = 25 * s, inset = 23 * s + borderW / 2;
            coverBackCtx.beginPath();
            coverBackCtx.roundRect(inset, inset, w - inset * 2, h - inset * 2, 24 * s);
            coverBackCtx.lineWidth = borderW;
            coverBackCtx.strokeStyle = accent;
            coverBackCtx.stroke();
            const logoSize = 437 * s;
            const logo = tintedImage(hfyjMarkImg, logoSize, logoSize, accent);
            coverBackCtx.drawImage(logo, (w - logoSize) / 2, (h - logoSize) / 2);
        }

        // What a back leaves on the cloth. The card above it is a slab of
        // its own — see buildBack below.
        function drawBackCast(cx, cy, w, rot) {
            const h = w * (CARD_BACK_DESIGN.h / CARD_BACK_DESIGN.w);
            ctx.save();
            ctx.translate(cx + 3 * s, cy + 8 * s);
            // A canvas turns the opposite way to a mesh, and the slab this
            // belongs to is a mesh.
            ctx.rotate(rot * Math.PI / 180);
            ctx.filter = `blur(${6 * s}px)`;
            ctx.fillStyle = 'rgba(0,0,0,0.32)';
            ctx.beginPath();
            ctx.roundRect(-w / 2, -h / 2, w, h, 36 * (w / CARD_BACK_DESIGN.w));
            ctx.fill();
            ctx.restore();
        }

        function paint(theme) {
            paintCoverBack(theme);
            const { cardBg, ink, accent } = THEME_COLORS[theme];

            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(0, 0, canvas.width, canvas.height, r);
            ctx.clip();
            ctx.fillStyle = cardBg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const maskPath = new Path2D();
            maskPath.addPath(new Path2D(ABOUTME_PHOTO_MASK), new DOMMatrix([s, 0, 0, s, 0, 0]));

            // Measure the two pills first so the shelf can sit on them — the
            // same 94px hug About Me uses from NYU to the notch — instead of
            // leaving a two-pill gap on a three-pill shelf.
            const pillY = ABOUTME_PILL_Y * s, pillH = ABOUTME_PILL_H * s;
            const pillK = (40 * s) / ABOUTME_PILL_FONT_PX;
            const pillGap = 12 * s;
            ctx.font = `600 ${ABOUTME_PILL_FONT_PX}px "DM Sans", sans-serif`;
            const pillWidths = PLAYGROUND_PILLS.map(
                (label) => ctx.measureText(label).width * pillK + 80 * s,
            );
            const rowW = pillWidths.reduce((a, b) => a + b, 0)
                + pillGap * (PLAYGROUND_PILLS.length - 1);
            const rowX = canvas.width - 21 * s - rowW;

            const cutPath = new Path2D();
            cutPath.addPath(
                new Path2D(ABOUTME_BOTTOM_CUT),
                playgroundCutMatrix(s, rowX / s),
            );
            const grassPath = new Path2D();
            grassPath.addPath(maskPath);
            grassPath.addPath(cutPath);
            ctx.save();
            ctx.clip(grassPath, 'evenodd');
            ctx.fillStyle = ctx.createPattern(tile, 'repeat');
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Everything the scatter leaves on the grass. The pieces that
            // cast these stand on the face as geometry, at Frame 4988's
            // relative sizes: a back ~28% of the card, a chip or die ~10%.
            PLAYGROUND_PROPS.backs.forEach(
                (b) => drawBackCast(b.x * s, b.y * s, b.w * s, b.rot),
            );
            PLAYGROUND_PROPS.dice.forEach(
                (d) => drawDieCastAt(d.x * s, d.y * s, d.size * s),
            );
            PLAYGROUND_PROPS.chips.forEach(
                (c) => drawChipCast(c.x * s, c.y * s, c.d * s),
            );

            const titlePx = 144 * s, tagPx = 46 * s, gap = 16 * s;
            const block = titlePx + gap + tagPx;
            const midX = canvas.width / 2;
            // Optical middle of the grass, the same band Frame 4988 uses —
            // dead canvas-center would sit the word on the lower props.
            const midY = 640 * s;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            // Same print as the live table: white at half strength, sitting
            // on the grass. Overlay of white on this nap just lightened the
            // green and the word disappeared.
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#ffffff';
            ctx.letterSpacing = '-0.02em';
            ctx.font = `400 ${titlePx}px "DM Sans", sans-serif`;
            ctx.fillText('Playground', midX, midY - block / 2 + titlePx);
            ctx.letterSpacing = '0.01em';
            ctx.font = `400 ${tagPx}px "Mynerve", cursive`;
            ctx.fillText('where you can actually play', midX, midY + block / 2);
            ctx.letterSpacing = '0';
            ctx.globalAlpha = 1;
            ctx.restore();

            ctx.strokeStyle = ink;
            ctx.lineWidth = s;
            ctx.stroke(maskPath);

            ctx.fillStyle = cardBg;
            ctx.fill(cutPath);
            ctx.restore();

            ctx.fillStyle = ink;
            ctx.font = `italic 400 ${36 * s}px "Inter", "DM Sans", sans-serif`;
            drawBoxedText('#0000', 48 * s, 24 * s, 118 * s, 44 * s, 'center');

            function drawPill(label, x, w) {
                const lw = ABOUTME_PILL_STROKE * s, inset = lw / 2;
                ctx.beginPath();
                ctx.roundRect(x + inset, pillY + inset, w - lw, pillH - lw, pillH / 2 - inset);
                ctx.lineWidth = lw;
                ctx.strokeStyle = ink;
                ctx.stroke();
                ctx.fillStyle = ink;
                ctx.save();
                ctx.scale(pillK, pillK);
                ctx.font = `600 ${ABOUTME_PILL_FONT_PX}px "DM Sans", sans-serif`;
                drawBoxedText(label, x / pillK, pillY / pillK, w / pillK, pillH / pillK, 'center');
                ctx.restore();
            }
            let pillX = rowX;
            PLAYGROUND_PILLS.forEach((label, i) => {
                drawPill(label, pillX, pillWidths[i]);
                pillX += pillWidths[i] + pillGap;
            });
        }

        paint(currentTheme);
        const alreadyOut = !!group;
        placeNow();
        if (alreadyOut) texture.needsUpdate = true;
        // The cloth is on the card. The props are a second job — six die
        // faces, two chips, two slabs — and holding the swap for them
        // kept the grass off screen until every canvas was uploaded.
        await new Promise((resolve) => requestAnimationFrame(resolve));

        // ── The chips and the die are real things on the card ────────────
        //
        // Painted, they were a picture of a table; turning the carousel
        // slid a flat sticker past the camera. As geometry standing on
        // the face they keep their own sides, so the swing round to the
        // card shows the die's other numbers and the chip's edge.
        //
        // The scene carries one ambient light, so a lit material would
        // come back evenly bright on all six sides — the whole point
        // being lost. The shading is baked per face instead, which is
        // also what every other card in the deck does: one unlit
        // material, everything in the texture.
        const U = cardW / ABOUTME_DESIGN.w;      // design px → world units
        const designX = (px) => (px - ABOUTME_DESIGN.w / 2) * U;
        const designY = (py) => (ABOUTME_DESIGN.h / 2 - py) * U;
        // Clear of the cloth by a hair, so the piece and the shadow it
        // casts are never the same depth.
        const LIFT = 0.0008;

        function propTexture(px, draw) {
            const c = document.createElement('canvas');
            c.width = c.height = px;
            draw(c.getContext('2d'), px);
            const t = new THREE.CanvasTexture(c);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        }

        // The deck is lit by one ambient light, so a face's brightness has
        // to be in its own pixels.
        function shade(g, w, h, lit) {
            if (lit >= 1) return;
            g.fillStyle = `rgba(0,0,0,${(1 - lit).toFixed(3)})`;
            g.fillRect(0, 0, w, h);
        }

        // One face of the cube: stock, ink pips on the 3×3 grid dice.css
        // lays out (15% padding, 5% gaps), and the stock's own edge line.
        // The corners are rounded the same 22% the live die is, and left
        // clear — the core behind shows through them as the bevel.
        function dieFace(value, lit, stock, ink) {
            return propTexture(128, (g, px) => {
                g.fillStyle = stock;
                g.beginPath();
                g.roundRect(0, 0, px, px, px * 0.22);
                g.fill();
                g.clip();
                const pad = px * 0.15, gap = px * 0.05;
                const cell = (px - pad * 2 - gap * 2) / 3;
                g.fillStyle = ink;
                PLAYGROUND_PIPS[value].forEach(([col, row]) => {
                    g.beginPath();
                    g.arc(
                        pad + col * (cell + gap) + cell / 2,
                        pad + row * (cell + gap) + cell / 2,
                        cell * 0.38, 0, Math.PI * 2,
                    );
                    g.fill();
                });
                g.strokeStyle = 'rgba(0,0,0,0.14)';
                g.lineWidth = 3;
                g.beginPath();
                g.roundRect(0, 0, px, px, px * 0.22);
                g.stroke();
                shade(g, px, px, lit);
            });
        }

        // The chip, drawn off the same four circles as the live SVG.
        function chipFace(lit, accent) {
            return propTexture(128, (g, px) => {
                const k = px / 100;
                // A cap's UVs only ever sample the inscribed circle, but
                // the disc stops a hair inside it — so the stock goes
                // down first and no sliver of it can come back empty.
                g.fillStyle = accent;
                g.fillRect(0, 0, px, px);
                g.translate(px / 2, px / 2);
                function circle(r, fill, stroke, width, dash, alpha) {
                    g.globalAlpha = alpha === undefined ? 1 : alpha;
                    g.beginPath();
                    g.arc(0, 0, r * k, 0, Math.PI * 2);
                    if (fill) { g.fillStyle = fill; g.fill(); }
                    if (stroke) {
                        g.strokeStyle = stroke;
                        g.lineWidth = width * k;
                        g.setLineDash(dash ? dash.map((v) => v * k) : []);
                        g.stroke();
                        g.setLineDash([]);
                    }
                    g.globalAlpha = 1;
                }
                circle(49, accent);
                circle(43, null, FELT, 12, [19, 26.03]);
                circle(33, null, FELT, 2, null, 0.5);
                circle(17, FELT, null, null, null, 0.92);
                g.setTransform(1, 0, 0, 1, 0, 0);
                shade(g, px, px, lit);
            });
        }

        // The rim. Six felt bands, one per dash on the face, so the edge
        // you see when the card turns belongs to the chip on top of it.
        function chipEdge(accent) {
            const w = 384, h = 48;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const g = c.getContext('2d');
            g.fillStyle = accent;
            g.fillRect(0, 0, w, h);
            const band = w / 6;
            g.fillStyle = FELT;
            for (let i = 0; i < 6; i++) {
                g.fillRect(i * band + band * 0.29, 0, band * 0.42, h);
            }
            // A rim is never as bright as the face looking at the light.
            g.fillStyle = 'rgba(0,0,0,0.18)';
            g.fillRect(0, 0, w, h);
            const t = new THREE.CanvasTexture(c);
            t.colorSpace = THREE.SRGBColorSpace;
            return t;
        }

        // The faces in +x, −x, +y, −y, +z, −z order, and a die is only a
        // die if opposite ones come to seven. +z is the number Frame 4988
        // shows; the rest follow from that. The brightnesses are close
        // together on purpose: far apart, a small cube stops reading as
        // one object and starts reading as two flat shapes meeting.
        const DIE_FACES = [
            { value: 1, lit: 0.90 },
            { value: 6, lit: 0.84 },
            { value: 5, lit: 0.96 },
            { value: 2, lit: 0.80 },
            { value: 3, lit: 1.00 },
            { value: 4, lit: 0.86 },
        ];

        const dieMats = DIE_FACES.map(() => new THREE.MeshBasicMaterial({
            transparent: true,
        }));
        // What you see through the rounded corners.
        const dieCoreMat = new THREE.MeshBasicMaterial();
        // Side, top cap, bottom cap — CylinderGeometry's own order. The
        // bottom is face down on the cloth and never seen, so it shares
        // the top's art rather than paying for a second canvas.
        const chipMats = [
            new THREE.MeshBasicMaterial(),
            new THREE.MeshBasicMaterial(),
            new THREE.MeshBasicMaterial(),
        ];
        // The back's printed side, off the same canvas the cover used to
        // blit, and the paper it is printed on.
        const backTex = new THREE.CanvasTexture(coverBack);
        backTex.colorSpace = THREE.SRGBColorSpace;
        backTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const backFaceMat = new THREE.MeshBasicMaterial({
            map: backTex, transparent: true,
        });
        const backEdgeMat = new THREE.MeshBasicMaterial();

        function dressProps(theme) {
            const { cardBg, ink, accent } = THEME_COLORS[theme];
            dieCoreMat.color.set(cardBg).multiplyScalar(0.78);
            // paint() has already redrawn coverBack in this theme.
            backTex.needsUpdate = true;
            backEdgeMat.color.set(cardBg).multiplyScalar(0.86);
            dieMats.forEach((mat, i) => {
                if (mat.map) mat.map.dispose();
                mat.map = dieFace(DIE_FACES[i].value, DIE_FACES[i].lit, cardBg, ink);
                mat.needsUpdate = true;
            });
            const faces = [chipEdge(accent), chipFace(1, accent), chipFace(0.8, accent)];
            chipMats.forEach((mat, i) => {
                if (mat.map) mat.map.dispose();
                mat.map = faces[i];
                mat.needsUpdate = true;
            });
        }

        dressProps(currentTheme);

        // A cube of six faces on a core, which is how dice.css builds one
        // too: six divs with a 22% radius, planted a half-width out. A box
        // geometry cannot round its corners and a rounded box cannot take
        // a different texture per side, so the faces go on as planes and
        // the core fills the gap where they meet — that gap, read at a
        // glance, is the bevel.
        function buildCube(size) {
            const cube = new THREE.Group();
            const core = new THREE.Mesh(
                new THREE.BoxGeometry(size * 0.96, size * 0.96, size * 0.96),
                dieCoreMat,
            );
            cube.add(core);
            const half = size / 2;
            const geo = new THREE.PlaneGeometry(size, size);
            const rx = Math.PI / 2, ry = Math.PI / 2;
            [
                { p: [half, 0, 0], r: [0, ry, 0] },
                { p: [-half, 0, 0], r: [0, -ry, 0] },
                { p: [0, half, 0], r: [-rx, 0, 0] },
                { p: [0, -half, 0], r: [rx, 0, 0] },
                { p: [0, 0, half], r: [0, 0, 0] },
                { p: [0, 0, -half], r: [0, Math.PI, 0] },
            ].forEach((face, i) => {
                const m = new THREE.Mesh(geo, dieMats[i]);
                m.position.set(face.p[0], face.p[1], face.p[2]);
                m.rotation.set(face.r[0], face.r[1], face.r[2]);
                cube.add(m);
            });
            return cube;
        }

        // Which quarter turn brings a number round to the front. Same
        // trick as SIDES in dice.js: the number a die shows is a rotation
        // of one cube, never a second set of faces, so the two dice on the
        // card cannot end up disagreeing about which pips go where.
        const DIE_FORWARD = {
            1: [0, -Math.PI / 2, 0],
            2: [-Math.PI / 2, 0, 0],
            3: [0, 0, 0],
            4: [0, Math.PI, 0],
            5: [Math.PI / 2, 0, 0],
            6: [0, Math.PI / 2, 0],
        };

        PLAYGROUND_PROPS.dice.forEach((spec) => {
            const size = spec.size * U;
            // Two nested turns: the pose on the table outside, the number
            // being shown inside. Keeping them apart is what lets both
            // dice sit the same way up while showing different faces.
            const die = new THREE.Group();
            const cube = buildCube(size);
            cube.rotation.set(...DIE_FORWARD[spec.value]);
            die.add(cube);
            // Flat on its face, and that is the whole pose. Tipping it off
            // the cloth to show a second face stands the cube on one
            // corner, which lifts three quarters of its width clear of the
            // table: it reads as a die hovering over the card rather than
            // lying on it. The sides come round with the carousel anyway.
            die.position.set(designX(spec.x), designY(spec.y), size / 2 + LIFT);
            die.userData.buildProp = true;   // drops in during the build-in
            group.add(die);
        });

        // A card is a slab: the printed side on top, the paper's own edge
        // round it. The edge is the whole point of doing it in geometry —
        // painted, two backs on a table are two rectangles, and a rectangle
        // has no thickness to catch.
        PLAYGROUND_PROPS.backs.forEach((spec) => {
            const w = spec.w * U;
            const h = w * (CARD_BACK_DESIGN.h / CARD_BACK_DESIGN.w);
            // Card stock, exaggerated the way the chip's rim is: a real
            // card is a quarter of a millimetre and would vanish here.
            const thick = w * 0.022;
            const back = new THREE.Group();
            // Inside the printed corners' radius, so no square corner of
            // paper pokes out past the round one on top of it — and a
            // shade thinner than the slab, so the printed side is not
            // sitting in the same plane as the paper's own top face.
            // Coplanar with it, the two take turns winning the depth test
            // and the card flickers as the carousel moves.
            back.add(new THREE.Mesh(
                new THREE.BoxGeometry(w * 0.975, h * 0.982, thick * 0.86),
                backEdgeMat,
            ));
            const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), backFaceMat);
            face.position.z = thick / 2;
            back.add(face);
            back.rotation.z = THREE.MathUtils.degToRad(-spec.rot);
            back.position.set(designX(spec.x), designY(spec.y), thick / 2 + LIFT);
            back.userData.buildProp = true;
            group.add(back);
        });

        PLAYGROUND_PROPS.chips.forEach((spec) => {
            const d = spec.d * U;
            // Thicker than a real chip. At a twelfth of its width the rim
            // is under a pixel here, and a chip whose edge you cannot see
            // is the flat sticker this was meant to stop being.
            const thick = d * 0.17;
            const chip = new THREE.Mesh(
                new THREE.CylinderGeometry(d / 2, d / 2, thick, 24, 1, false),
                chipMats,
            );
            // Cylinders stand up the y axis; the card's face looks down z.
            chip.rotation.set(
                Math.PI / 2,
                THREE.MathUtils.degToRad(spec.spin),
                0,
            );
            chip.position.set(designX(spec.x), designY(spec.y), thick / 2 + LIFT);
            chip.userData.buildProp = true;
            group.add(chip);
        });

        cardFaceRepaints.push({
            index: 8,
            repaint: (theme) => {
                // Pick up the current scale before painting; everything the
                // paint draws reads s and r.
                s = CARD_TEXTURE_SCALE;
                r = 36 * s;
                const resized = fitFaceCanvas(canvas, ABOUTME_DESIGN);
                paint(theme);
                if (resized) texture.dispose();   // new size, new storage
                texture.needsUpdate = true;
                dressProps(theme);
            },
        });
    }).catch((err) => console.error('[playground]', err))
     .finally(() => {
        playgroundFaceReady = true;
        refreshLoaderTarget();
     });
    }
    // Used to wait for an idle gap on a first visit, so the heavy paint
    // landed in the middle of the shuffle. It starts now, and the shuffle
    // stays up until the finally above says the cloth is done.
    paintDetail();
}

// ── Card build-in ────────────────────────────────────────────────────────────
// There is no loading screen. The ring is on screen from the first frame and
// every card draws itself in while its art is still arriving:
//
//   1. it spins in as nothing but an outline, and the outline draws itself
//   2. the card fills in, and dashed guides draw where each piece will go
//   3. the pieces arrive as wireframes (a hatched photo, a bar for the title,
//      a box for the copy, the pill outlines) from off the card, up near the
//      camera, and slap down onto their guides — each one jolts the card
//   4. once the real face is ready, the content comes in over the wireframe:
//      the photo unmasks, the text types itself in, the pills pop
//
// A slow card just waits at step 3 with its hatching drifting, which is what
// gives the art time to load without anybody watching a progress bar.
//
// All of it is drawn in the card's own fragment shader from a handful of
// uniforms, plus one small plane per flying piece. Nothing is repainted or
// re-uploaded while it plays: the per-frame texture upload is exactly the cost
// the About Me reveal above was moved into the shader to avoid.
const CB_ENABLED = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Back from a project page: the same build, quicker, and the ring stays put.
// On localhost, ?buildslow=4 plays it four times slower, for looking at it.
const CB_SLOW = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? (Number(new URLSearchParams(location.search).get('buildslow')) || 1) : 1;
const CB_SPEED = (introSkipped ? 0.55 : 1) * CB_SLOW;
const CB_MAX = 16;
const CB_U = 1.7 / 1449;          // design px → card-local units
const CB_Z0 = 0.42;               // how far off the face a piece starts
const CB = { IMG: 0, BAR: 1, LINE: 2, BOX: 3, PILL: 4 };
// Every duration and offset in the build, in ms, before CB_SPEED.
const CB_T = {
    spin: 1000, outline: 900, fillAt: 350, fill: 600,
    guideAt: 820, guideGap: 60, guide: 420,
    flyAt: 1300, flyGap: 115, fly: 600,
    stagger: 130,                  // per card, by distance round the ring from the front
    ring: 2400,                    // first visit: one turn of the ring as it all starts
    introCap: 7000,                // the nav is never held back longer than this
};

const CB_WIRE = {
    light: { wire: '#9DB0EC', hatch: '#B3C1F1', bar: '#E2E8FB', caret: '#5E81E2' },
    dark:  { wire: '#8A93B8', hatch: '#6E7799', bar: '#4A4E60', caret: '#FFFA50' },
};
const CB_COLORS = {
    uCbBg:    { value: new THREE.Color() },
    uCbWire:  { value: new THREE.Color() },
    uCbHatch: { value: new THREE.Color() },
    uCbBar:   { value: new THREE.Color() },
    uCbCaret: { value: new THREE.Color() },
};
function cbSetTheme(theme) {
    const w = CB_WIRE[theme];
    CB_COLORS.uCbBg.value.set(THEME_COLORS[theme].cardBg);
    CB_COLORS.uCbWire.value.set(w.wire);
    CB_COLORS.uCbHatch.value.set(w.hatch);
    CB_COLORS.uCbBar.value.set(w.bar);
    CB_COLORS.uCbCaret.value.set(w.caret);
}
cbSetTheme(currentTheme);

// A map is what gives a material its UVs, so the stand-ins carry a white one.
const CB_WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
CB_WHITE.needsUpdate = true;

// Shared by the card face and the flying pieces, so a piece looks exactly the
// same in the air as it does once it has landed. Everything is in design px
// (the 1059×1449 Figma frame), measured from an element's top-left.
const CB_GLSL_COMMON = `
uniform vec3 uCbBg;
uniform vec3 uCbWire;
uniform vec3 uCbHatch;
uniform vec3 uCbBar;
uniform vec3 uCbCaret;
uniform vec4 uCbCut;
float cbBox( vec2 p, vec2 b, float r ) {
    r = min( r, min( b.x, b.y ) );
    vec2 q = abs( p ) - b + r;
    return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}
// Distance to an element's outline. The photo keeps the folded corner the
// #00X tag sits in, and on About Me / Playground the shelf the pills sit on.
float cbShape( float kind, vec2 q, vec2 size, vec2 origin ) {
    vec2 h = size * 0.5;
    float r = kind < 0.5 ? 24.0 : ( kind < 1.5 ? min( h.y, 10.0 ) : ( kind < 3.5 ? 14.0 : h.y ) );
    float d = cbBox( q - h, h, r );
    if ( kind < 0.5 ) {
        float ny = q.x < 118.0 ? 58.5 : ( q.x < 210.0 ? 58.5 * ( 1.0 - ( q.x - 118.0 ) / 92.0 ) : -1e4 );
        d = max( d, ( ny - q.y ) * ( q.x < 118.0 ? 1.0 : 0.84 ) );
        if ( uCbCut.z > uCbCut.x ) {
            vec2 ch = ( uCbCut.zw - uCbCut.xy ) * 0.5;
            d = max( d, -cbBox( origin + q - uCbCut.xy - ch, ch, 0.0 ) );
        }
    }
    return d;
}
float cbStroke( float d, float px ) {
    return 1.0 - smoothstep( 0.55 * px, 1.25 * px, abs( d ) );
}
float cbInside( float d, float px ) {
    return 1.0 - smoothstep( -0.5 * px, 0.5 * px, d );
}
// One element's wireframe: rgb plus how much of it there is.
vec4 cbWire( float kind, vec2 q, vec2 size, vec2 origin, float draw, float px, float march ) {
    float d = cbShape( kind, q, size, origin );
    float edge = cbStroke( d, px );
    if ( kind < 0.5 ) {
        float inside = cbInside( d, px );
        float sp = 48.0;
        float s = abs( fract( ( q.x + q.y + march ) / sp ) - 0.5 ) * sp * 0.7071;
        float stripe = 1.0 - smoothstep( 0.5 * px, 1.2 * px, s );
        float sweep = 1.0 - smoothstep( draw - 0.03, draw, ( q.x + q.y ) / ( size.x + size.y ) );
        return vec4( mix( uCbHatch, uCbWire, edge ), max( edge, stripe * inside * sweep * 0.85 ) );
    }
    if ( kind < 1.5 ) {
        return vec4( mix( uCbBar, uCbWire, edge * 0.6 ), max( cbInside( d, px ), edge ) );
    }
    if ( kind < 2.5 ) return vec4( uCbWire, 0.0 );
    return vec4( uCbWire, edge );
}
`;

const CB_GLSL_FACE = `
uniform float uCbOn;
uniform float uCbHasMap;
uniform float uCbHasAlt;
uniform sampler2D uCbAlt;
uniform vec4 uCbCard;   // outline drawn, outline alpha, fill, hatch drift
uniform int uCbCount;
uniform vec4 uCbRect[ ${CB_MAX} ];
uniform vec4 uCbA[ ${CB_MAX} ];   // kind, guide drawn, landed, content revealed
uniform vec4 uCbB[ ${CB_MAX} ];   // in-flight offset x/y, height (-1 = not flying), landing pulse
vec2 cbUv( vec2 p ) { return vec2( p.x / 1059.0, 1.0 - p.y / 1449.0 ); }
float cbBackOut( float t ) { float u = t - 1.0; return 1.0 + 2.70158 * u * u * u + 1.70158 * u * u; }
vec4 cbFace( vec4 inCol, vec2 uv ) {
    if ( uCbOn < 0.5 ) return inCol;
    vec2 p = vec2( uv.x * 1059.0, ( 1.0 - uv.y ) * 1449.0 );
    float px = max( 0.7071 * length( fwidth( p ) ), 0.3 );
    vec2 gx = dFdx( uv ), gy = dFdy( uv );
    vec3 mapCol = uCbHasMap > 0.5 ? inCol.rgb : uCbBg;
    float march = uCbCard.w;

    // Where the art is, and where text has not been typed yet
    bool inEl = false;
    bool hidText = false;
    for ( int i = 0; i < ${CB_MAX}; i++ ) {
        if ( i >= uCbCount ) break;
        vec4 R = uCbRect[ i ];
        vec4 A = uCbA[ i ];
        vec2 q = p - R.xy;
        if ( q.x >= -6.0 && q.y >= -6.0 && q.x <= R.z + ( A.x > 0.5 && A.x < 2.5 ? 14.0 : 6.0 ) && q.y <= R.w + 6.0 ) {
            inEl = true;
            if ( A.x > 0.5 && A.x < 2.5 && A.w < 0.999 && p.x > R.x + A.w * R.z ) hidText = true;
        }
    }
    vec3 c = inEl ? uCbBg : mapCol;
    float lineA = 0.0;

    for ( int i = 0; i < ${CB_MAX}; i++ ) {
        if ( i >= uCbCount ) break;
        vec4 R = uCbRect[ i ];
        vec4 A = uCbA[ i ];
        vec4 B = uCbB[ i ];
        vec2 q = p - R.xy;
        vec2 size = R.zw;
        float kind = A.x;
        if ( A.z > 0.5 ) {
            if ( kind < 0.5 ) {
                // The photo: hatched until it unmasks along a soft diagonal,
                // settling from a slight zoom as it does.
                float d = cbShape( 0.0, q, size, R.xy );
                float inside = cbInside( d, px );
                if ( inside > 0.0 ) {
                    float diag = ( q.x / size.x ) * 0.6 + ( q.y / size.y ) * 0.4;
                    float e = A.w * 1.24 - 0.12;
                    float m = 1.0 - smoothstep( e - 0.12, e, diag );
                    vec3 content = uCbBg;
                    if ( m > 0.0 && uCbHasMap > 0.5 ) {
                        float z = 1.0 + 0.08 * ( 1.0 - A.w ) * ( 1.0 - A.w );
                        vec2 cc = R.xy + size * 0.5;
                        vec2 sp = cc + ( p - cc ) / z;
                        if ( hidText && uCbHasAlt > 0.5 ) content = textureGrad( uCbAlt, cbUv( sp ), gx / z, gy / z ).rgb;
                        else content = textureGrad( map, cbUv( sp ), gx / z, gy / z ).rgb;
                    }
                    vec4 w = cbWire( 0.0, q, size, R.xy, 1.0, px, march );
                    vec3 wired = mix( uCbBg, w.rgb, w.a );
                    c = mix( c, mix( wired, content, m ), inside );
                }
                float ea = cbStroke( d, px ) * ( 1.0 - A.w );
                c = mix( c, uCbWire, ea );
                lineA = max( lineA, ea );
            } else if ( kind < 2.5 ) {
                // Text types in from the left, a caret riding the edge
                if ( q.x >= -4.0 && q.y >= -6.0 && q.x <= size.x + 14.0 && q.y <= size.y + 6.0 ) {
                    float edgeX = R.x + A.w * size.x;
                    if ( A.w >= 0.999 || p.x <= edgeX ) c = mapCol;
                    else if ( kind < 1.5 ) {
                        vec4 w = cbWire( 1.0, q, size, R.xy, 1.0, px, march );
                        c = mix( c, w.rgb, w.a );
                        lineA = max( lineA, w.a );
                    }
                    if ( A.w > 0.001 && A.w < 0.999 ) {
                        float hw = max( 2.5, 0.9 * px );
                        float ca = 1.0 - smoothstep( hw, hw + px, abs( p.x - edgeX - hw ) );
                        ca *= step( -2.0, q.y ) * step( q.y, size.y + 2.0 );
                        c = mix( c, uCbCaret, ca );
                    }
                }
            } else if ( kind < 3.5 ) {
                vec4 w = cbWire( 3.0, q, size, R.xy, 1.0, px, march );
                float a = w.a * ( 1.0 - A.w );
                c = mix( c, w.rgb, a );
                lineA = max( lineA, a );
            } else {
                // Pills pop out of their outline
                if ( A.w > 0.0 && uCbHasMap > 0.5 ) {
                    float sc = max( mix( 0.55, 1.0, cbBackOut( A.w ) ), 0.05 );
                    vec2 cc = R.xy + size * 0.5;
                    vec2 sp = cc + ( p - cc ) / sc;
                    float d2 = cbShape( 4.0, sp - R.xy, size, R.xy );
                    float pin = 1.0 - smoothstep( 1.5, 1.5 + px, d2 );
                    vec3 pc = textureGrad( map, cbUv( sp ), gx / sc, gy / sc ).rgb;
                    c = mix( c, pc, pin * clamp( A.w * 3.0, 0.0, 1.0 ) );
                }
                vec4 w = cbWire( 4.0, q, size, R.xy, 1.0, px, march );
                float a = w.a * ( 1.0 - smoothstep( 0.0, 0.45, A.w ) );
                c = mix( c, w.rgb, a );
                lineA = max( lineA, a );
            }
            if ( B.w > 0.0 ) {
                // The moment it lands: a quick bloom round its edge
                float d = cbBox( q - size * 0.5, size * 0.5, 14.0 );
                float glow = ( 1.0 - smoothstep( 0.0, 8.0 + 34.0 * ( 1.0 - B.w ), abs( d ) ) ) * B.w * 0.4;
                c = mix( c, uCbWire, glow );
                lineA = max( lineA, glow );
            }
        } else if ( A.y > 0.001 && ( kind < 1.5 || kind > 2.5 ) ) {
            // Dashed guide where the piece will land, drawn round clockwise
            float d = cbShape( kind, q, size, R.xy );
            vec2 h = size * 0.5;
            vec2 rel = q - h;
            float dc = abs( rel.x ) / h.x > abs( rel.y ) / h.y ? q.y : q.x;
            float dash = step( fract( dc / 26.0 ), 0.55 );
            float t = fract( atan( rel.y, rel.x ) / 6.28318 + 0.375 );
            float a = cbStroke( d, px ) * dash * step( t, A.y ) * 0.6;
            c = mix( c, uCbWire, a );
            lineA = max( lineA, a );
        }
    }

    // Shadows of the pieces still in the air: wide and faint up high, small
    // and dark just before they land.
    for ( int i = 0; i < ${CB_MAX}; i++ ) {
        if ( i >= uCbCount ) break;
        vec4 B = uCbB[ i ];
        if ( B.z < 0.0 || uCbA[ i ].z > 0.5 ) continue;
        vec4 R = uCbRect[ i ];
        vec2 off = B.xy + vec2( 40.0, 70.0 ) * B.z;
        float blur = 6.0 + 80.0 * B.z;
        float d = cbBox( p - R.xy - off - R.zw * 0.5, R.zw * 0.5, 18.0 );
        float sa = ( 0.05 + 0.15 * ( 1.0 - B.z ) ) * ( 1.0 - smoothstep( -blur, blur, d ) );
        c *= 1.0 - sa;
        lineA = max( lineA, sa );
    }

    // The card's own outline, drawn round from the top left
    {
        vec2 h = vec2( 529.5, 724.5 );
        vec2 rel = p - h;
        float d = cbBox( rel, h - 2.5, 50.0 );
        float t = fract( atan( rel.y, rel.x ) / 6.28318 + 0.375 );
        float a = cbStroke( d, px ) * step( t, uCbCard.x ) * uCbCard.y;
        c = mix( c, uCbWire, a );
        lineA = max( lineA, a );
    }
    return vec4( c, max( uCbCard.z, lineA ) );
}
`;

const CB_GLSL_FLY = `
uniform float uFlyKind;
uniform vec2 uFlySize;
uniform vec2 uFlyOrigin;
uniform float uFlyDraw;
uniform float uFlyAlpha;
uniform float uFlyPad;
vec4 cbFly( vec2 uv ) {
    vec2 full = uFlySize + 2.0 * uFlyPad;
    vec2 q = vec2( uv.x, 1.0 - uv.y ) * full - uFlyPad;
    float px = max( 0.7071 * length( fwidth( q ) ), 0.3 );
    vec4 w = cbWire( uFlyKind, q, uFlySize, uFlyOrigin, uFlyDraw, px, 0.0 );
    // A sheet of the card's own stock under the lines, so it reads as a
    // piece of paper in the air rather than lines floating on nothing.
    float sheet = cbInside( cbShape( uFlyKind, q, uFlySize, uFlyOrigin ), px ) * 0.9;
    return vec4( mix( uCbBg, w.rgb, w.a ), max( sheet, w.a ) * uFlyAlpha );
}
`;

function cbPatchFace(material, U) {
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, r) => {
        prevCompile.call(material, shader, r);
        Object.assign(shader.uniforms, CB_COLORS, U);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <map_pars_fragment>',
                '#include <map_pars_fragment>\n' + CB_GLSL_COMMON + CB_GLSL_FACE)
            .replace('#include <color_fragment>',
                '#ifdef USE_MAP\n\tdiffuseColor = cbFace( diffuseColor, vMapUv );\n#endif\n#include <color_fragment>');
    };
    material.customProgramCacheKey = () => prevKey() + '|cb-face';
    material.needsUpdate = true;
}

function cbClamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function cbEaseInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

// One record per card, made now so the loaders can hand their cards over
// (and the templates their copy) before the build itself starts.
function cbMakeUniforms() {
    const v4 = () => Array.from({ length: CB_MAX }, () => new THREE.Vector4());
    return {
        uCbOn:     { value: 1 },
        uCbHasMap: { value: 0 },
        uCbHasAlt: { value: 0 },
        uCbAlt:    { value: CB_WHITE },
        uCbCard:   { value: new THREE.Vector4(0, 1, 0, 0) },
        uCbCut:    { value: new THREE.Vector4(0, 0, 0, 0) },
        uCbCount:  { value: 0 },
        uCbRect:   { value: v4() },
        uCbA:      { value: v4() },
        uCbB:      { value: v4() },
    };
}
const cbCards = Array.from({ length: cardCount }, (_, i) => ({
    i, U: cbMakeUniforms(), spec: null, real: null, ghost: null, els: [],
    started: false, takenOver: false, ready: false, prepQueued: false,
    content: 0, finished: !CB_ENABLED, hit: 0, props: [],
}));
cbCards[0].spec = { type: 'aboutme' };
cbCards[1].spec = { type: 'puregym' };
cbCards[8].spec = { type: 'playground' };
let cbRunning = false;
let cbIntroDone = false;
let cbStartTime = 0;
let cbFront = 0;
const cbPrepQueue = [];

// Whether the build still has this card. Until it lets go, the card stays
// hidden behind its stand-in and nothing else may show it.
function cbOwns(i) { return !cbCards[i].finished; }

// _placeCard hands every card over here as it finishes loading.
function cbAttach(i, group) {
    const st = cbCards[i];
    if (st.finished) return;
    cbPatchFace(group.children[0].material, st.U);
    group.visible = false;
    st.real = group;
}

// ── Where everything sits on each face, in design px ──
// Read off the same numbers the painters above draw with, so the wireframe
// lands exactly where the art will be.
const cbMeasure = document.createElement('canvas').getContext('2d');
// Measured at the size the faces are actually painted at, not the design
// size: DM Sans is optically sized and canvas picks that axis from the px
// size, so a 96px measurement comes out narrower than the ~40px the card
// really draws, and the wireframe ends a letter short of the title.
let cbScale = 1;
function cbSetFont(font) {
    cbMeasure.font = font.replace(/(\d+(?:\.\d+)?)px/, (m, n) => (Number(n) * cbScale) + 'px');
}
function cbW(text) { return cbMeasure.measureText(text).width / cbScale; }
function cbTextWidth(text, font, spacing) {
    cbSetFont(font);
    if ('letterSpacing' in cbMeasure) cbMeasure.letterSpacing = spacing || '0px';
    return cbW(text);
}
// A line of text drawn from an alphabetic baseline, as a box round its letters.
function cbTextRect(text, font, x, baseline, align, size, maxW, spacing) {
    let w = cbTextWidth(text, font, spacing);
    if (maxW) w = Math.min(w, maxW);
    return { x: align === 'center' ? x - w / 2 : x, y: baseline - size * 0.76, w, h: size * 0.98, chars: text.length };
}
// drawBoxedText's baseline, for the cards that place type by its line box
function cbBoxedBaseline(text, font, y, h) {
    cbSetFont(font);
    const m = cbMeasure.measureText(text);
    const inner = (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / cbScale;
    return y + (h - inner) / 2 + m.fontBoundingBoxAscent / cbScale;
}
function cbWrap(text, maxW) {
    const words = text.split(' ');
    const out = [];
    let line = '';
    for (let n = 0; n < words.length; n++) {
        const test = line + words[n] + ' ';
        if (cbW(test) > maxW && n > 0) {
            out.push(line.trim());
            line = words[n] + ' ';
        } else {
            line = test;
        }
    }
    out.push(line.trim());
    return out;
}
function cbBoxAround(lines) {
    const pad = 16;
    const x0 = Math.min(...lines.map((r) => r.x)) - pad;
    const y0 = Math.min(...lines.map((r) => r.y)) - pad;
    const x1 = Math.max(...lines.map((r) => r.x + r.w)) + pad;
    const y1 = Math.max(...lines.map((r) => r.y + r.h)) + pad;
    return { kind: CB.BOX, role: 'box', x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function cbTag(text, font, x, w) {
    const tw = cbTextWidth(text, font);
    return { kind: CB.BAR, role: 'tag', x: x + w / 2 - tw / 2, y: 28, w: tw, h: 34, chars: text.length };
}

// Template cards and Puregym share one layout: photo well, tag, title, copy, pills.
function cbCardLayout({ tag, title, accentLine, description, pills, fit, pillBoxes }) {
    const els = [{ kind: CB.IMG, role: 'img', x: 21, y: 20, w: 1016.663, h: 817 }];
    if (tag) {
        const w = cbTextWidth(tag, 'italic 400 36px "DM Sans", sans-serif');
        els.push({ kind: CB.BAR, role: 'tag', x: 100.5 - w / 2, y: 28, w, h: 34, chars: tag.length });
    }
    els.push(Object.assign({ kind: CB.BAR, role: 'title' },
        cbTextRect(title, '700 96px "DM Sans", sans-serif', 54, 960, 'left', 96, 951)));

    const W = CARD_BODY.width;
    let size = CARD_BODY.size, lh = CARD_BODY.lineHeight;
    if (fit) {
        while (size > CARD_BODY_MIN_SIZE) {
            cbSetFont(`400 ${size}px "DM Sans", sans-serif`);
            const n = (accentLine ? cbWrap(accentLine, W).length : 0) + cbWrap(description, W).length;
            if (CARD_BODY.y + (n - 1) * lh + size * 0.25 <= CARD_BODY_BOTTOM) break;
            size -= 2;
            lh = size * (CARD_BODY.lineHeight / CARD_BODY.size);
        }
    }
    const font = `400 ${size}px "DM Sans", sans-serif`;
    cbSetFont(font);
    if ('letterSpacing' in cbMeasure) cbMeasure.letterSpacing = '0px';
    const text = [...(accentLine ? cbWrap(accentLine, W) : []), ...cbWrap(description, W)];
    let y = CARD_BODY.y;
    const lines = text.map((line) => {
        const r = Object.assign({ kind: CB.LINE, role: 'line' }, cbTextRect(line, font, 54, y, 'left', size));
        y += lh;
        return r;
    });
    els.push(cbBoxAround(lines), ...lines);

    if (pillBoxes) {
        pillBoxes.forEach((b) => els.push({ kind: CB.PILL, role: 'pill', x: b.x, y: 1354, w: b.w, h: 68 }));
    } else {
        const widths = pills.map((label) => cbTextWidth(label, '600 40px "DM Sans", sans-serif') + 80);
        const total = widths.reduce((a, b) => a + b, 0) + 24 * (pills.length - 1);
        let x = 1059 - 21 - total;
        widths.forEach((w) => { els.push({ kind: CB.PILL, role: 'pill', x, y: 1354, w, h: 68 }); x += w + 24; });
    }
    return { els, cut: null };
}

function cbLayout(spec) {
    if (spec.type === 'template') {
        const o = spec.opts;
        return cbCardLayout({ tag: o.tag, title: o.title, accentLine: o.accentLine,
            description: o.description, pills: o.pills, fit: true });
    }
    if (spec.type === 'puregym') {
        return cbCardLayout({
            tag: '#003', title: 'Puregym Redesign',
            description: 'Mobile redesign case study for Puregym focused on minimizing friction during check-in.',
            fit: false,
            pillBoxes: [{ x: 218, w: 242 }, { x: 472, w: 335 }, { x: 819, w: 219 }],
        });
    }
    const pillK = 40 / ABOUTME_PILL_FONT_PX;
    const tagFont = 'italic 400 36px "Inter", "DM Sans", sans-serif';
    if (spec.type === 'aboutme') {
        const nameFont = '700 80px "DM Sans", sans-serif';
        const base = cbBoxedBaseline('Jennifer Huang', nameFont, 35, 93);
        const els = [
            { kind: CB.IMG, role: 'img', x: 21, y: 20, w: 1017, h: 1404 },
            cbTag('#000', tagFont, 56, 91),
            Object.assign({ kind: CB.BAR, role: 'title' },
                cbTextRect('Jennifer Huang', nameFont, 205, base, 'left', 80)),
        ];
        ABOUTME_PILLS.forEach((pl) => els.push({ kind: CB.PILL, role: 'pill',
            x: pl.x, y: ABOUTME_PILL_Y, w: pl.w, h: ABOUTME_PILL_H }));
        return { els, cut: [250, 1326, 1060, 1450] };
    }
    // Playground
    const widths = PLAYGROUND_PILLS.map((label) =>
        cbTextWidth(label, `600 ${ABOUTME_PILL_FONT_PX}px "DM Sans", sans-serif`) * pillK + 80);
    const rowW = widths.reduce((a, b) => a + b, 0) + 12 * (widths.length - 1);
    const rowX = 1059 - 21 - rowW;
    const hug = ABOUTME_PILLS[0].x - (ABOUTME_CUT_ORIGIN_X - ABOUTME_CUT_FAR_X);
    const farX = ABOUTME_CUT_ORIGIN_X - (rowX - hug);
    const k = Math.max(0.55, Math.min(1, farX / ABOUTME_CUT_FAR_X));
    const cutLeft = ABOUTME_CUT_ORIGIN_X - ABOUTME_CUT_FAR_X * k;
    const titleFont = '400 144px "DM Sans", sans-serif';
    const tagline = 'where you can actually play';
    const tagLine = Object.assign({ kind: CB.LINE, role: 'line' },
        cbTextRect(tagline, '400 46px "Mynerve", cursive', 529.5, 743, 'center', 46, 0, '0.01em'));
    const els = [
        { kind: CB.IMG, role: 'img', x: 21, y: 20, w: 1017, h: 1404 },
        cbTag('#0000', tagFont, 48, 118),
        Object.assign({ kind: CB.BAR, role: 'title' },
            cbTextRect('Playground', titleFont, 529.5, 681, 'center', 144, 0, '-0.02em')),
        cbBoxAround([tagLine]),
        tagLine,
    ];
    let x = rowX;
    widths.forEach((w) => {
        els.push({ kind: CB.PILL, role: 'pill', x, y: ABOUTME_PILL_Y, w, h: ABOUTME_PILL_H });
        x += w + 12;
    });
    return { els, cut: [cutLeft + 30, 1326, 1060, 1450] };
}

// ── Stand-ins and flying pieces ──
function cbMakeGhost(st) {
    const aspect = 1059 / 1449;
    const cardH = 1.7, cardW = cardH * aspect;
    const mat = new THREE.MeshBasicMaterial({
        map: CB_WHITE, transparent: true, side: THREE.DoubleSide, depthWrite: false,
    });
    applyCardStock(mat, { aspect });
    cbPatchFace(mat, st.U);
    const mesh = new THREE.Mesh(makeRoundedCardGeo(cardW, cardH, 0.06), mat);
    mesh.raycast = () => {};
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    g.add(mesh);
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5),
        new THREE.MeshBasicMaterial({ map: cardShadowTex, transparent: true, depthWrite: false, opacity: 0 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.3;
    shadow.renderOrder = -1;
    shadow.raycast = () => {};
    g.add(shadow);
    st.ghostShadow = shadow;
    g.visible = false;
    cardgroup.add(g);
    return g;
}

function cbMakeFlyer(st, el) {
    const pad = 8;
    const FU = {
        uFlyKind:   { value: el.kind },
        uFlySize:   { value: new THREE.Vector2(el.w, el.h) },
        uFlyOrigin: { value: new THREE.Vector2(el.x, el.y) },
        uFlyDraw:   { value: 0 },
        uFlyAlpha:  { value: 0 },
        uFlyPad:    { value: pad },
    };
    const mat = new THREE.MeshBasicMaterial({ map: CB_WHITE, transparent: true, depthWrite: false });
    mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, CB_COLORS, { uCbCut: st.U.uCbCut }, FU);
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <map_pars_fragment>',
                '#include <map_pars_fragment>\n' + CB_GLSL_COMMON + CB_GLSL_FLY)
            .replace('#include <color_fragment>',
                '#ifdef USE_MAP\n\tdiffuseColor = cbFly( vMapUv );\n#endif\n#include <color_fragment>');
    };
    mat.customProgramCacheKey = () => 'cb-fly';
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry((el.w + 2 * pad) * CB_U, (el.h + 2 * pad) * CB_U), mat);
    mesh.raycast = () => {};
    mesh.visible = false;
    mesh.renderOrder = 3;
    el.mesh = mesh;
    el.FU = FU;
    const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
    el.rest = new THREE.Vector3((cx - 529.5) * CB_U, (724.5 - cy) * CB_U, 0.004);
    // Out from the middle of the card, past its edge
    let dx = cx - 529.5, dy = cy - 724.5;
    const len = Math.hypot(dx, dy);
    if (len < 60) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
    const dist = 280 + Math.random() * 140;
    el.off = { x: dx * dist + (Math.random() - 0.5) * 90, y: dy * dist + (Math.random() - 0.5) * 90 };
    el.rot0 = (Math.random() - 0.5) * 0.5;
}

// ── Start ──
async function cbStart() {
    if (!CB_ENABLED) return;
    cbRunning = true;
    if (!introSkipped) introPhase = 'building';
    document.body.classList.add('gradient-visible');
    // The layout is measured, so the faces it measures with have to be in.
    // Capped: a font that never arrives must not hold the ring empty.
    await Promise.race([
        Promise.all([
            '700 96px "DM Sans"', '400 56px "DM Sans"', '600 40px "DM Sans"',
            'italic 400 36px "DM Sans"', 'italic 400 36px "Inter"', '700 80px "DM Sans"',
            '400 144px "DM Sans"', '400 46px "Mynerve"', `600 ${ABOUTME_PILL_FONT_PX}px "DM Sans"`,
        ].map((f) => document.fonts.load(f).catch(() => {}))),
        new Promise((resolve) => setTimeout(resolve, 900)),
    ]);

    const k = CB_SPEED;
    const apc = (Math.PI * 2) / cardCount;
    cbFront = ((Math.round(-cardgroup.rotation.y / apc) % cardCount) + cardCount) % cardCount;
    cbStartTime = performance.now();
    cbScale = CARD_TEXTURE_SCALE;

    // First visit: the ring makes one turn while everything spins in.
    if (!introSkipped) {
        introAnimStartTime = cbStartTime;
        introAnimEndRot = cardgroup.rotation.y;
        introAnimStartRot = introAnimEndRot + Math.PI * 2;
        introAnimDuration = CB_T.ring;
        introAnimActive = true;
        targetRotation = null;
        cardgroup.rotation.y = introAnimStartRot;
    }

    cbCards.forEach((st) => {
        if (st.finished) return;
        const spec = st.spec || { type: 'template', opts: { title: '', description: '', pills: [] } };
        const { els, cut } = cbLayout(spec);
        st.els = els.slice(0, CB_MAX);
        const U = st.U;
        if (cut) U.uCbCut.value.set(cut[0], cut[1], cut[2], cut[3]);
        U.uCbCount.value = st.els.length;
        st.ghost = cbMakeGhost(st);
        let gi = 0, fi = 0;
        st.flightsEnd = 0;
        const box = st.els.find((el) => el.kind === CB.BOX);
        st.els.forEach((el, j) => {
            U.uCbRect.value[j].set(el.x, el.y, el.w, el.h);
            U.uCbA.value[j].set(el.kind, 0, 0, 0);
            U.uCbB.value[j].set(0, 0, -1, 0);
            el.j = j;
            el.placed = false;
            if (el.kind !== CB.LINE) {
                el.g0 = (CB_T.guideAt + gi++ * CB_T.guideGap) * k;
                el.fly = true;
                el.f0 = (CB_T.flyAt + fi++ * CB_T.flyGap) * k;
                el.fdur = CB_T.fly * k;
                st.flightsEnd = Math.max(st.flightsEnd, el.f0 + el.fdur);
                cbMakeFlyer(st, el);
                st.ghost.add(el.mesh);
            } else {
                el.box = box;
            }
        });
        const ring = Math.min((st.i - cbFront + cardCount) % cardCount, (cbFront - st.i + cardCount) % cardCount);
        st.t0 = cbStartTime + ring * CB_T.stagger * k;
        st.started = true;
    });
}

// The face is in. Cards with type over their photo (About Me, Playground)
// also need the photo without the type, so the half that has not been typed
// yet shows the picture rather than letters that are still to come.
function cbPrep(st) {
    if (st.finished) return;
    if (st.i === 0 || st.i === 8) {
        const entry = cardFaceRepaints.find((e) => e.index === st.i);
        const canvas = st.real.children[0].material.map.image;
        if (entry && canvas && canvas.getContext) {
            const ctx = canvas.getContext('2d');
            ctx.fillText = function () {};
            ctx.strokeText = function () {};
            try { entry.repaint(currentTheme); } finally { delete ctx.fillText; delete ctx.strokeText; }
            const alt = document.createElement('canvas');
            alt.width = canvas.width;
            alt.height = canvas.height;
            alt.getContext('2d').drawImage(canvas, 0, 0);
            entry.repaint(currentTheme);
            const tex = new THREE.CanvasTexture(alt);
            tex.colorSpace = THREE.SRGBColorSpace;
            st.U.uCbAlt.value = tex;
            st.U.uCbHasAlt.value = 1;
        }
    }
    if (st.i === 8) {
        st.props = st.real.children.filter((c) => c.userData.buildProp);
        st.props.forEach((p) => {
            p.userData.cbRest = { pos: p.position.clone(), scale: p.scale.clone() };
        });
    }
    st.ready = true;
}

function cbTakeover(st) {
    st.takenOver = true;
    st.real.rotation.order = 'YXZ';
    st.real.visible = true;
    st.els.forEach((el) => { if (el.mesh) st.real.add(el.mesh); });
    const g = st.ghost;
    st.ghost = null;
    if (g) {
        cardgroup.remove(g);
        g.children.forEach((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
    }
}

function cbFinishCard(st) {
    st.finished = true;
    const U = st.U;
    U.uCbOn.value = 0;
    if (U.uCbHasAlt.value) {
        U.uCbAlt.value.dispose();
        U.uCbAlt.value = CB_WHITE;
        U.uCbHasAlt.value = 0;
    }
    st.els.forEach((el) => {
        if (!el.mesh) return;
        if (el.mesh.parent) el.mesh.parent.remove(el.mesh);
        el.mesh.geometry.dispose();
        el.mesh.material.dispose();
        el.mesh = null;
    });
    st.props.forEach((p) => {
        p.visible = true;
        p.position.copy(p.userData.cbRest.pos);
        p.scale.copy(p.userData.cbRest.scale);
    });
    const g = st.real;
    if (g) {
        g.rotation.order = 'XYZ';
        g.rotation.x = 0;
        g.rotation.y = THREE.MathUtils.degToRad((st.i * 360) / cardCount);
        g.scale.setScalar(getCardScale());
        g.visible = true;
    }
}

// The nav, the socials and the view switch, once the front card is built.
function cbFinishIntro() {
    if (cbIntroDone) return;
    cbIntroDone = true;
    if (introSkipped || introPhase === 'done') return;
    introPhase = 'done';
    markIntroPlayed();
    const sl = document.getElementById('social-links');
    if (sl) setTimeout(() => sl.classList.add('ui-intro-visible'), 60);
    const tn = document.getElementById('top-nav');
    if (tn) setTimeout(() => tn.classList.add('visible'), 160);
    revealViewToggle(700);
}

// What the content does once the face is ready, in ms from that moment.
function cbPlanContent(st) {
    const k = CB_SPEED;
    const plan = [];
    let cursor = 0, pill = 0;
    const titleAt = 360 * k;
    st.els.forEach((el) => {
        if (el.role === 'img') plan.push({ el, start: 0, dur: 760 * k, type: false });
        else if (el.role === 'tag') plan.push({ el, start: 120 * k, dur: Math.min(500, Math.max(160, el.chars * 38)) * k, type: true });
        else if (el.role === 'title') plan.push({ el, start: titleAt, dur: Math.min(900, Math.max(300, el.chars * 45)) * k, type: true });
        else if (el.role === 'pill') plan.push({ el, start: (560 + pill++ * 110) * k, dur: 460 * k, type: false });
    });
    cursor = titleAt + 260 * k;
    st.els.forEach((el) => {
        if (el.role !== 'line') return;
        const dur = Math.min(900, Math.max(160, el.chars * 12)) * k;
        plan.push({ el, start: cursor, dur, type: true });
        cursor += dur + 40 * k;
    });
    const box = st.els.find((el) => el.role === 'box');
    if (box) plan.push({ el: box, start: cursor + 60 * k, dur: 320 * k, type: false });
    st.props.forEach((p, n) => plan.push({ prop: p, start: (300 + n * 140) * k, dur: 620 * k }));
    st.plan = plan;
    st.contentEnd = plan.reduce((m, it) => Math.max(m, it.start + it.dur), 0) + 120 * k;
}

function cbStep(st, now) {
    const U = st.U, k = CB_SPEED;
    if (st.real && !st.prepQueued && cardFaceRepaints.some((e) => e.index === st.i)) {
        st.prepQueued = true;
        cbPrepQueue.push(st);
    }
    // Playground's pieces are geometry, added whenever its detail finishes;
    // they stay off the card until it is their turn.
    if (st.real && !st.content) {
        st.real.children.forEach((c) => { if (c.userData.buildProp) c.visible = false; });
    }
    const t = now - st.t0;
    if (t < 0) return;

    // Spin in, outline, fill
    const e = easeOutCubic(cbClamp(t / (CB_T.spin * k)));
    const spin = -Math.PI * 2 * (1 - e);
    const thump = st.hit ? Math.exp(-(now - st.hit) / 120) : 0;
    const sc = getCardScale() * (0.88 + 0.12 * e) * (1 - 0.018 * thump);
    const ang = THREE.MathUtils.degToRad((st.i * 360) / cardCount);
    const tilt = -0.06 * thump;
    const fill = cbClamp((t - CB_T.fillAt * k) / (CB_T.fill * k));
    U.uCbCard.value.x = cbEaseInOut(cbClamp(t / (CB_T.outline * k)));
    U.uCbCard.value.z = fill;
    if (st.ghost) {
        const r = getCarouselRadius();
        const g = st.ghost;
        g.visible = true;
        g.position.set(Math.sin(ang) * r, 0, Math.cos(ang) * r);
        g.rotation.set(tilt, ang + spin, 0);
        g.scale.setScalar(sc);
        st.ghostShadow.material.opacity = fill * THEME_COLORS[currentTheme].shadow;
    }
    if (st.real && !st.takenOver && fill >= 1) cbTakeover(st);
    if (st.takenOver) {
        st.real.rotation.x = tilt;
        st.real.rotation.y = ang + spin;
        st.real.scale.setScalar(sc);
    }

    // Guides, then the pieces fly in and land on them
    st.els.forEach((el) => {
        const A = U.uCbA.value[el.j], B = U.uCbB.value[el.j];
        if (el.kind === CB.LINE) {
            if (el.box && el.box.placed) A.z = 1;
            return;
        }
        A.y = cbClamp((t - el.g0) / (CB_T.guide * k));
        if (!el.placed) {
            if (t < el.f0) { B.z = -1; if (el.mesh) el.mesh.visible = false; return; }
            const u = cbClamp((t - el.f0) / el.fdur);
            if (u >= 1) {
                el.placed = true;
                el.hitAt = now;
                st.hit = now;
                A.z = 1;
                B.set(0, 0, -1, 1);
                if (el.mesh) el.mesh.visible = false;
                return;
            }
            const eo = easeOutCubic(u);
            const zf = 1 - Math.pow(u, 2.4);
            const m = el.mesh;
            m.visible = true;
            m.position.set(el.rest.x + el.off.x * (1 - eo) * CB_U,
                el.rest.y - el.off.y * (1 - eo) * CB_U, el.rest.z + CB_Z0 * zf);
            m.rotation.z = el.rot0 * (1 - eo);
            m.scale.setScalar(1 + 0.18 * zf);
            el.FU.uFlyAlpha.value = cbClamp(u / 0.18);
            el.FU.uFlyDraw.value = cbClamp(u / 0.65);
            B.set(el.off.x * (1 - eo), el.off.y * (1 - eo), zf, 0);
        } else {
            B.w = Math.max(0, Math.exp(-(now - el.hitAt) / 150) - 0.02);
        }
    });

    // Waiting on the art: the hatching drifts so it reads as still working
    if (!st.content) {
        const waitFrom = st.flightsEnd + 300 * k;
        if (t > waitFrom) U.uCbCard.value.w = (t - waitFrom) * 0.035;
        if (st.ready && st.takenOver && t >= st.flightsEnd + 160 * k) {
            st.content = now;
            U.uCbHasMap.value = 1;
            cbPlanContent(st);
        }
        return;
    }

    // The real face comes in
    const tc = now - st.content;
    st.plan.forEach((it) => {
        const u = cbClamp((tc - it.start) / it.dur);
        if (it.prop) {
            const p = it.prop, rest = p.userData.cbRest;
            p.visible = u > 0;
            const zf = 1 - Math.pow(u, 2.4);
            p.position.set(rest.pos.x, rest.pos.y, rest.pos.z + CB_Z0 * 1.2 * zf);
            p.scale.copy(rest.scale).multiplyScalar(1 + 0.35 * zf);
            if (u >= 1 && !it.landed) { it.landed = true; st.hit = now; }
            return;
        }
        const A = U.uCbA.value[it.el.j];
        if (it.type) A.w = it.el.chars ? Math.floor(u * it.el.chars + 1e-6) / it.el.chars : u;
        else A.w = it.el.role === 'img' ? cbEaseInOut(u) : u;
    });
    if (tc >= st.contentEnd) {
        if (st.i === cbFront) cbFinishIntro();
        const of = cbClamp((tc - st.contentEnd) / (380 * k));
        U.uCbCard.value.y = 1 - of;
        if (of >= 1) cbFinishCard(st);
    }
}

function cbUpdate() {
    if (!cbRunning) return;
    const now = performance.now();
    let live = false;
    cbCards.forEach((st) => {
        if (st.finished || !st.started) return;
        live = true;
        cbStep(st, now);
    });
    // One face's prep per frame, so two of them never land in the same one
    if (cbPrepQueue.length) cbPrep(cbPrepQueue.shift());
    if (!cbIntroDone && cbStartTime && now - cbStartTime > CB_T.introCap * CB_SPEED) cbFinishIntro();
    if (!live && cbStartTime) cbRunning = false;
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

scene.add(cardgroup);
cbStart();

// Scroll handling
window.addEventListener("wheel", (e) => {
    if (currentView === 'grid') return; // allow normal scroll in grid view
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
                setCardCursor('about me');
            } else if (alt === 'Playground') {
                setCardCursor('open playground');
            } else if (gridCard.dataset.comingSoon !== undefined) {
                setCardCursor(COMING_SOON_LABEL);
            } else {
                setCardCursor('open project');
            }
            cardCursor.classList.add('visible');
            dotCursor.classList.remove('visible');
        } else {
            cardCursor.classList.remove('visible');
            dotCursor.classList.add('visible');
        }
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

    // The intro panel's logos sit over the ring, and the raycast sees straight
    // through them to the cards behind. Over a logo it is the logo being
    // pointed at, so the plain dot shows rather than the card's label.
    const overLogo = e.target instanceof Element && e.target.closest('.company-slot');
    const hits = overLogo ? [] : raycaster.intersectObjects(cardgroup.children, true);
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
                setCardCursor('scroll down');
            } else {
                const idx = root.userData.cardIndex;
                setCardCursor(idx === 0 ? 'about me'
                    : idx === 8 ? 'open playground'
                    : COMING_SOON_INDICES.has(idx) ? COMING_SOON_LABEL
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
    // On touch, tapping the About Me card during the intro deals the cards,
    // same as a swipe. With a mouse, scrolling stays the only way in.
    if (introPhase === 'waitForScroll') {
        const isTouch = event.pointerType === 'touch' || !hasFinePointer;
        if (!isTouch) return;
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);
        const hit = raycaster.intersectObjects(cardgroup.children, true)[0];
        const root = hit && findCardRoot(hit.object);
        if (root && root.userData.cardIndex === 0) { playWhooshThrottled(); triggerDealing(); }
        return;
    }
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

    // Card-0 tilt is settled before the shadow pass so this frame's lean
    // drives the shadow's size, not last frame's.
    const c0 = cards[0];
    if (c0) {
        const tiltActive = introPhase === 'waitForScroll';
        const targX = tiltActive ? card0TiltTargX : 0;
        const targY = tiltActive ? card0TiltTargY : 0;
        card0TiltCurrX += (targX - card0TiltCurrX) * CARD0_TILT_SPEED;
        card0TiltCurrY += (targY - card0TiltCurrY) * CARD0_TILT_SPEED;
        c0.rotation.x = card0TiltCurrX;
        c0.rotation.y = card0TiltCurrY; // base y = 0 for card 0
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
        card.position.y = cardHoverY[i] + cardIntroY[i];

        // Shadow: stay on the ground. Hover lifts the card, so the shadow
        // shrinks and fades; it does not rise with the card.
        const shadow = cardShadows[i];
        if (shadow) {
            shadow.position.y = shadow.userData.baseY - cardHoverY[i];
            const targetOpacity = (isHovered ? 0.5 : 1.0) * THEME_COLORS[currentTheme].shadow;
            const restScale = isHovered ? 0.7 : 1.0;
            // Intro tilt: the card leans toward the cursor. The shadow stays
            // centered under it and only grows with that lean.
            const lean = i === 0
                ? Math.min(1, Math.hypot(card0TiltCurrX, card0TiltCurrY) / CARD0_TILT_MAX)
                : 0;
            const targetScale = restScale * (1 + lean * CARD0_SHADOW_LEAN_SCALE);
            shadow.material.opacity += (targetOpacity - shadow.material.opacity) * HOVER_ANIM_SPEED;
            shadow.scale.x += (targetScale - shadow.scale.x) * HOVER_ANIM_SPEED;
            shadow.scale.z += (restScale - shadow.scale.z) * HOVER_ANIM_SPEED;
            // Local Y is the ellipse's depth once the mesh is laid flat.
            // Only the intro lean changes it; hover keeps today's width-only shrink.
            if (i === 0) {
                const depthTarget = 1 + lean * CARD0_SHADOW_LEAN_SCALE;
                shadow.scale.y += (depthTarget - shadow.scale.y) * HOVER_ANIM_SPEED;
            }
        }
    });

    // Undo the tilt's swing so card 0's shadow stays on the ground, flat,
    // directly under the card. Size was already eased above.
    if (c0 && cardShadows[0]) {
        pinCardShadow(cardShadows[0], card0TiltCurrX, card0TiltCurrY, cardShadows[0].userData.baseY - cardHoverY[0]);
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

    // Loader progress — the shuffle keeps running until every face is in.
    // The bar crawls with the clock for the minimum beat, then follows the
    // assets if they are still arriving.
    if (loaderEl && !loaderDone) {
        loaderDisplay += (loaderTarget - loaderDisplay) * 0.06;
        const elapsed = performance.now() - loaderStart;
        if (loaderProgressEl) {
            const timePct = Math.min(1, elapsed / LOADER_MIN_MS) * 100;
            const pct = Math.round(Math.min(loaderDisplay, timePct));
            if (pct !== loaderBarPct) {
                loaderBarPct = pct;
                loaderProgressEl.style.width = pct + '%';
            }
        }
        const loaded = loaderTarget >= 100 && loaderDisplay >= 99 && elapsed >= LOADER_MIN_MS;
        if (loaded || elapsed >= LOADER_MAX_MS) {
            loaderDone = true;
            if (loaderProgressEl) loaderProgressEl.style.width = '100%';
            // One upload of everything that just finished, while the loader
            // is still opaque, so the shuffle's frames weren't spent on it
            // and the turn isn't either.
            renderer.render(scene, camera);
            // Don't freeze the deck here. The shuffle runs on to its next
            // landing, and that landing is what starts the turn.
            loaderAwaitShuffle = true;
        }
    }
    if (loaderAwaitShuffle) noteShuffleAndMaybeArrive();

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

    // The cards drawing themselves in. Last, so it has the final say on the
    // transforms it is animating this frame.
    cbUpdate();

    // The cursor light the card stock is shaded by
    updateCardStockLight();

    // Render last — all positions are current, no stale-position flash possible.
    // Not while the loader still covers the canvas: a render there uploads
    // card textures on the same thread the CSS shuffle is running on.
    if (!loaderEl || loaderEl.classList.contains('fade-out')) {
        renderer.render(scene, camera);
    }
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
    'Playground',          // card 8
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
// The strip sits in the view pill, to the left of the switch, and only
// while card view is open. The loop below is also what clicks as the ring
// passes a card.
const ticks = [];
if (scrubberTrack) {
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
}

// Map tick index → card index (distribute ticks evenly across cards)
function tickToCardIndex(tickIdx) {
    return Math.round((tickIdx / (TICK_COUNT - 1)) * (cardCount - 1));
}

// Clicking any tick snaps to the corresponding card
scrubberTrack?.addEventListener('click', (e) => {
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
    // Same sign as dragging the ring itself, so the cards follow the finger.
    cardgroup.rotation.y = scrubberStartRotation + dx * SCRUB_SENSITIVITY;
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
    scrubberWrap?.removeEventListener('touchmove', onScrubMove);
    scrubberWrap?.removeEventListener('touchend', onScrubEnd);
    scrubberWrap?.removeEventListener('touchcancel', onScrubEnd);
    snaptoNearestCard();
}

// Pointer (mouse + stylus + some touch)
scrubberWrap?.addEventListener('pointerdown', (e) => {
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

scrubberWrap?.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') return;
    onScrubEnd();
});

// Touch (mobile) — handled independently so it never conflicts with canvas
scrubberWrap?.addEventListener('touchstart', (e) => {
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
    // Negated so the ticks travel the same way as the cards (and the finger).
    const rawOffset = -(cardgroup.rotation.y / TWO_PI) * stripWidth;
    const loopedOffset = ((rawOffset % stripWidth) + stripWidth) % stripWidth;
    if (scrubberTrack) scrubberTrack.style.transform = `translateX(${-(stripWidth + loopedOffset)}px)`;

    // Label + active tick highlight — only recalculate when snapped card changes
    const raw = Math.round(cardgroup.rotation.y / apc);
    const activeIdx = ((raw % cardCount) + cardCount) % cardCount;
    if (activeIdx !== lastScrubberActiveIdx) {
        // Ratchet click each time the ticker passes a card — only for user-driven
        // rotation (scroll/drag/scrubber), not during the intro deal or idle auto-rotate
        if (lastScrubberActiveIdx !== -1 && introPhase === 'done' && !autoRotating) playTickThrottled();
        lastScrubberActiveIdx = activeIdx;
        if (scrubberLabel) scrubberLabel.textContent = CARD_NAMES[activeIdx] || 'Untitled';
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
// `persist` is false whenever this is only catching up with a choice made
// somewhere else — the OS changing, or a restored page re-reading storage.
// Writing those down would turn a mirror into a decision, and a reader who has
// never pressed the toggle would end up pinned to whatever their OS happened
// to be at the moment they first scrolled past.
function applyTheme(theme, persist = true) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch (err) {} }
    scene.fog.color.set(THEME_COLORS[theme].fog);
    updateCardBackTexture(theme);
    updateCardFaceTextures(theme);
    updateCardStockTheme(theme);
    cbSetTheme(theme);
    const favicon = document.getElementById('favicon');
    if (favicon) favicon.href = theme === 'dark' ? './assets/favicon-dark.svg' : './assets/favicon-light.svg';
}

// Half-turns of the day/night wheel. The count only ever grows, so the wheel
// always spins clockwise — the icon swings off to the right and the other
// comes up from the left — instead of rocking back to where it came from.
const themeWheel = document.querySelector('#theme-toggle .theme-wheel');
let themeTurns = currentTheme === 'dark' ? 1 : 0;

function parkThemeWheel() {
    if (!themeWheel) return;
    themeWheel.classList.remove('is-ready');
    themeWheel.style.transform = `rotate(${themeTurns * 180}deg)`;
    void themeWheel.offsetWidth;
    themeWheel.classList.add('is-ready');
}

parkThemeWheel();

document.getElementById('theme-toggle')?.addEventListener('click', () => {
    themeTurns += 1;
    if (themeWheel) themeWheel.style.transform = `rotate(${themeTurns * 180}deg)`;
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// Restored from the back/forward cache rather than loaded. Nothing above has
// re-run — not the <head> block that stamps data-theme, not this module — so
// <html>, currentTheme, the fog and every card texture are all still the theme
// this page was left in. A reader who pressed the toggle on a case page and
// came back arrives here with a stored choice this page has never seen, which
// is precisely the trip card-transition.js makes on the way home: it calls
// history.back() so the carousel does not have to be rebuilt, and a restore is
// the common way home. Re-read the choice and catch the whole page up.
//
// site.js does the same thing for every other page, for the same reason.
window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
        const theme = getStoredTheme();
        if (theme !== currentTheme) applyTheme(theme, false);
        themeTurns = getStoredTheme() === 'dark' ? 1 : 0;
        parkThemeWheel();
    }
});

// Nothing stored means the page is still mirroring the OS, so it should keep
// mirroring it if the OS changes mid-visit. A stored choice outranks this,
// which is why the guard re-reads storage rather than trusting a local flag.
// The mirror of the same listener in site.js.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) {}
    if (saved === 'dark' || saved === 'light') return;
    applyTheme(e.matches ? 'dark' : 'light', false);
});

// ── View toggle (cards ↔ grid) ───────────────────────────────────────────────
// The grid's project clips carry preload="none", so nothing about them is
// fetched until the grid is actually opened — most visits never open it, and
// the five of them together used to be the bulk of the page's weight. Playing
// them here is also what starts the download; pausing on the way out stops
// five videos decoding behind a hidden panel.
let gridMediaOn = false;
function setGridMediaPlaying(playing) {
    gridMediaOn = playing;
    document.querySelectorAll('#grid-view video.grid-card-media').forEach((v) => {
        if (playing) { const r = v.play(); if (r) r.catch(() => {}); }
        else v.pause();
    });
}

// Pointing at a card holds every other card's clip on its current frame, and
// leaving it lets them all run again. Only where the grid has more than one
// column and a real hover: with one card per row there is nothing to single out.
(function () {
    const focusable = window.matchMedia('(hover: hover) and (min-width: 1161px)');
    document.querySelectorAll('#grid-view .grid-card').forEach((card) => {
        card.addEventListener('mouseenter', () => {
            if (!gridMediaOn || !focusable.matches) return;
            document.querySelectorAll('#grid-view video.grid-card-media').forEach((v) => {
                if (card.contains(v)) { const r = v.play(); if (r) r.catch(() => {}); }
                else v.pause();
            });
        });
        card.addEventListener('mouseleave', () => {
            if (gridMediaOn) setGridMediaPlaying(true);
        });
    });
})();

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
function applyViewChrome(view, animateThumb = true) {
    const socialLinks = document.getElementById('social-links');
    const viewToggle = document.getElementById('view-toggle');
    const topNav = document.getElementById('top-nav');
    if (topNav) {
        topNav.classList.toggle('is-grouped', view === 'grid');
        // Card view has no scroll, so the header must never stay tucked away.
        if (view !== 'grid') topNav.classList.remove('is-scroll-hidden');
    }

    toggleBtns.forEach(b => {
        const on = b.dataset.view === view;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });

    // The plate is one element. Moving data-active slides it. A restore
    // lands it in place, so a returning grid doesn't watch it travel over.
    if (viewToggle) {
        if (!animateThumb) viewToggle.classList.add('no-thumb-move');
        viewToggle.dataset.active = view;
        if (!animateThumb) {
            void viewToggle.offsetWidth;
            viewToggle.classList.remove('no-thumb-move');
        }
    }

    if (view === 'grid') {
        // Show grid, hide carousel
        gridView.classList.add('visible');
        canvasEl.style.opacity = '0';
        canvasEl.style.pointerEvents = 'none';
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

// Header in grid view: hides on the way down, comes back on the way up, and is
// always there near the top. Same rule and deadband as the case pages' topbar
// (site.js), but the grid scrolls its own element rather than the window.
{
    const topNav = document.getElementById('top-nav');
    const TOP = 20;
    const DEADBAND = 6;
    let lastY = 0;
    let ticking = false;
    const sync = () => {
        ticking = false;
        const y = Math.max(0, gridView.scrollTop);
        const delta = y - lastY;
        if (Math.abs(delta) < DEADBAND && y > TOP) return;
        lastY = y;
        topNav.classList.toggle('is-scroll-hidden', currentView === 'grid' && y > TOP && delta > 0);
    };
    if (topNav) gridView.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(sync);
    }, { passive: true });
}

// ── Grid-view footer ─────────────────────────────────────────────────────────

// "Last updated" — pick the most-recent mtime among the files this page loads.
// Falls back to document.lastModified when fetch isn't available (e.g. file:// URLs).
//
// Asked of the document rather than named as './style.css' and './script.js':
// under a build those two are bundled and emitted under hashed names, so naming
// them fetches nothing and logs a 404 on every production load. What the page
// has actually loaded is the same set of files either way.
function _gfSourceFiles() {
    const css = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href);
    const js = [...document.querySelectorAll('script[src]')].map(t => t.src);
    return ['./index.html', ...css, ...js];
}

async function _gfSetLastUpdated() {
    const el = document.querySelector('#grid-footer .gf-updated');
    if (!el) return;
    let latest = 0;
    try {
        const results = await Promise.all(
            _gfSourceFiles().map(async (f) => {
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
if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => { _gfSetLastUpdated(); }, { timeout: 4000 });
} else {
    setTimeout(_gfSetLastUpdated, 1500);
}

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
// PLAYGROUND / ABOUT switch to card view then rotate to that card.
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
            rotateToCard(cardIdx);
        }
    });
});

// Switches to card view if needed, then turns the ring the short way round
// to the card at rotation step cardIdx.
function rotateToCard(cardIdx) {
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

// The nav mark is a home link. We are already home, so it brings the ring
// back round to About Me instead of reloading the page.
document.querySelector('#top-nav .nav-logo')?.addEventListener('click', (e) => {
    e.preventDefault();
    rotateToCard(0);
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
    applyViewChrome('grid', false);
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

// Set once the loader has turned its own card over onto About Me, so the
// carousel card is already sitting where that one was instead of falling in
// on top of a card the visitor just watched land.
let loaderRevealedAbout = false;

// How tall the front card is on screen. Same projection the camera uses:
// an 80° lens at z = 3.6, the card standing at the ring's radius.
function aboutCardScreenHeight() {
    const dist = 3.6 - getCarouselRadius();
    const visible = 2 * dist * Math.tan((80 * Math.PI / 180) / 2);
    return window.innerHeight * ((1.7 * getCardScale()) / visible);
}

// The carousel's own About Me bitmap, drawn at the size the card will
// actually be on screen. The blocky type was a small canvas scaled up
// with a CSS transform: the layer was rasterised at the shuffle card's
// 88px and stretched. The card is given the screen size instead, and
// this copy is one device pixel per screen pixel — never a second
// enlargement, which is what softens the type.
function paintLoaderAboutFace(card) {
    const src = aboutmeSwap.faces[0] && aboutmeSwap.faces[0].canvas;
    const dest = card.querySelector('.shuffle-card-front');
    if (!src || !dest || !src.width) return;
    const cssH = aboutCardScreenHeight();
    const cssW = cssH * (src.width / src.height);
    card.style.setProperty('--reveal-w', cssW.toFixed(2) + 'px');
    card.style.setProperty('--reveal-h', cssH.toFixed(2) + 'px');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const destH = Math.max(1, Math.min(src.height, Math.round(cssH * dpr)));
    const destW = Math.max(1, Math.round(destH * (src.width / src.height)));
    dest.width = destW;
    dest.height = destH;
    const ctx = dest.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, destW, destH);
}

function presentAboutCard() {
    const c = cards[0];
    if (!c) return;
    c.visible = true;
    cardIntroY[0] = 0;
    cardHoverY[0] = 0;
    c.position.y = 0;
    loaderRevealedAbout = true;
}

function dismissLoader(delay) {
    setTimeout(() => {
        presentAboutCard();
        loaderEl.classList.add('fade-out');
        document.body.classList.add('gradient-visible');
        // The intro starts while the loader is still fading rather than after
        // it has gone: the panels sit below it, so the name comes up through
        // the last of the fade instead of after a beat of empty screen. The
        // loader only leaves the DOM once its 0.7s fade is actually over.
        setTimeout(startIntro, 280);
        setTimeout(() => loaderEl.remove(), 700);
    }, delay);
}

// Where the shuffle is in its cycle. One beat is a single card leaving the
// deck and landing back in it — a third of card-shuffle, matching the three
// staggered cards. Null if the animation can't be read.
function shuffleClock() {
    const card = loaderEl.querySelector('.shuffle-card');
    const anim = card && card.getAnimations().find((a) => a.animationName === 'card-shuffle');
    if (!anim || anim.currentTime == null || !anim.effect) return null;
    const dur = anim.effect.getComputedTiming().duration;
    if (typeof dur !== 'number' || !(dur > 0)) return null;
    const t = ((anim.currentTime % dur) + dur) % dur;
    return { t, beat: dur / 3 };
}

// Assets are ready. Keep shuffling until the card that's out has landed,
// then hand off. A landing that just happened (the first few frames of a
// beat) counts — stopping there is the shuffle finishing, not cutting it.
function noteShuffleAndMaybeArrive() {
    if (!loaderEl || !loaderEl.isConnected) { loaderAwaitShuffle = false; return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        loaderAwaitShuffle = false;
        beginLoaderArrival();
        return;
    }
    const clock = shuffleClock();
    if (!clock) {
        loaderAwaitShuffle = false;
        beginLoaderArrival();
        return;
    }
    const beat = Math.floor(clock.t / clock.beat);
    const intoBeat = clock.t - beat * clock.beat;
    // Still on the stack. Wider than this and the next card has already
    // started out — a late wake (the texture upload blocks the thread, and
    // the shuffle keeps time while it does) must not freeze that pull.
    const landed = intoBeat <= 36;
    if (shuffleBeatSeen === null) {
        shuffleBeatSeen = beat;
        if (landed) {
            loaderAwaitShuffle = false;
            beginLoaderArrival();
        }
        return;
    }
    if (beat !== shuffleBeatSeen) {
        shuffleBeatSeen = beat;
        if (landed) {
            loaderAwaitShuffle = false;
            beginLoaderArrival();
        }
    }
}

function revealSize(card) {
    const w = parseFloat(card.style.getPropertyValue('--reveal-w'));
    const h = parseFloat(card.style.getPropertyValue('--reveal-h'));
    if (w > 0 && h > 0) return { w, h };
    const cssH = aboutCardScreenHeight();
    const src = aboutmeSwap.faces[0] && aboutmeSwap.faces[0].canvas;
    const aspect = src && src.height ? src.width / src.height : 1059 / 1449;
    return { w: cssH * aspect, h: cssH };
}

// The shuffle has landed. Square the deck and let the cards underneath
// disappear, so one card is all that's left. The turn waits until that
// has finished — the flip is the next thing, not part of the shuffle.
function beginLoaderArrival() {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const deck = [...loaderEl.querySelectorAll('.shuffle-card')];
    if (!deck.length || reduced) {
        dismissLoader(reduced ? 0 : 200);
        return;
    }
    const pose = deck.map((card) => {
        const cs = getComputedStyle(card);
        return {
            card,
            transform: cs.transform,
            zIndex: cs.zIndex === 'auto' ? '1' : cs.zIndex,
        };
    });
    pose.forEach(({ card, transform, zIndex }) => {
        card.getAnimations().forEach((anim) => anim.cancel());
        card.style.transition = 'none';
        card.style.animation = 'none';
        card.style.transform = transform && transform !== 'none' ? transform : 'none';
        card.style.zIndex = zIndex;
    });
    const hero = pose.reduce((best, item) =>
        ((parseInt(item.zIndex, 10) || 0) >= (parseInt(best.zIndex, 10) || 0) ? item : best)).card;
    hero.classList.add('is-hero');
    paintLoaderAboutFace(hero);
    loaderEl.style.setProperty('--settle', SETTLE_MS + 'ms');

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!loaderEl.isConnected) return;
            const ease = `transform ${SETTLE_MS}ms ${ARRIVE_EASE}, opacity ${SETTLE_MS}ms ease`;
            deck.forEach((card) => {
                card.style.transition = ease;
                card.style.transform = 'none';
                if (card !== hero) card.style.opacity = '0';
            });
            loaderEl.classList.add('is-settled');
            setTimeout(() => flipLoaderHero(hero), SETTLE_MS + SETTLE_HOLD_MS);
        });
    });
}

// One card, sitting still. It turns over onto About Me and grows to that
// card's real size together. The face is already painted at the size it
// will be seen, so the box grows around the bitmap instead of stretching it.
function flipLoaderHero(hero) {
    if (!loaderEl.isConnected || !hero.isConnected) return;
    const vis = hero.getBoundingClientRect();
    const layoutW = hero.offsetWidth;
    const layoutH = hero.offsetHeight;
    const size = revealSize(hero);
    const startLeft = vis.left + vis.width / 2 - layoutW / 2;
    const startTop = vis.top + vis.height / 2 - layoutH / 2;
    const finalLeft = (window.innerWidth - size.w) / 2;
    const finalTop = (window.innerHeight - size.h) / 2;
    const inner = hero.querySelector('.shuffle-card-inner');

    // #loader-cards has perspective, and perspective is a containing block
    // for position:fixed. Left/top are viewport coordinates; applied inside
    // that 88×120 box they land in the bottom-right of the screen. The
    // loader itself is the full screen, so the hero has to move up to it
    // before those coordinates mean anything.
    loaderEl.appendChild(hero);
    hero.style.transition = 'none';
    hero.style.position = 'fixed';
    hero.style.left = startLeft + 'px';
    hero.style.top = startTop + 'px';
    hero.style.width = layoutW + 'px';
    hero.style.height = layoutH + 'px';
    hero.style.right = 'auto';
    hero.style.bottom = 'auto';
    hero.style.margin = '0';
    hero.style.transform = 'none';
    hero.style.zIndex = '6';
    hero.style.perspective = '1400px';
    if (inner) {
        inner.style.transition = 'none';
        inner.style.transform = 'rotateY(0deg)';
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (!loaderEl.isConnected) return;
            hero.style.transition = `left ${ARRIVE_MS}ms ${ARRIVE_EASE}, top ${ARRIVE_MS}ms ${ARRIVE_EASE}, width ${ARRIVE_MS}ms ${ARRIVE_EASE}, height ${ARRIVE_MS}ms ${ARRIVE_EASE}`;
            hero.style.left = finalLeft + 'px';
            hero.style.top = finalTop + 'px';
            hero.style.width = size.w + 'px';
            hero.style.height = size.h + 'px';
            if (inner) {
                inner.style.transition = `transform ${ARRIVE_MS}ms ${ARRIVE_EASE}`;
                inner.style.transform = 'rotateY(180deg)';
            }
            dismissLoader(ARRIVE_MS);
        });
    });
}

function cancelPanelType() {
    if (panelTypeTimer !== null) {
        clearTimeout(panelTypeTimer);
        panelTypeTimer = null;
    }
}

// The name is two lines split by a <br>. Read them before the type-on
// replaces the contents, so the copy stays in the markup.
function readPanelNameLines(el) {
    const lines = [];
    let current = '';
    el.childNodes.forEach((node) => {
        if (node.nodeName === 'BR') {
            lines.push(current.replace(/\s+/g, ' ').trim());
            current = '';
        } else {
            current += node.textContent || '';
        }
    });
    lines.push(current.replace(/\s+/g, ' ').trim());
    return lines.filter((line) => line.length);
}

function panelCaret() {
    const caret = document.createElement('span');
    caret.className = 'panel-caret';
    caret.setAttribute('aria-hidden', 'true');
    return caret;
}

// The whole name is laid out from the first frame, with the untyped part
// held invisible. The panel is right-aligned and shrink-wraps its text, so
// typing into an empty box grew each line out from the right edge; with the
// full width reserved, every letter lands where it will stay and the name
// types left to right. The block's height is fixed from the start too.
function renderPanelName(el, lines, count, caret) {
    const frag = document.createDocumentFragment();
    let consumed = 0;
    let caretPlaced = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const start = consumed;
        if (i > 0) frag.appendChild(document.createElement('br'));
        const take = Math.max(0, Math.min(line.length, count - start));
        const typed = document.createElement('span');
        typed.textContent = line.slice(0, take);
        frag.appendChild(typed);
        consumed += line.length;
        const last = i === lines.length - 1;
        if (caret && !caretPlaced && (count < consumed || last)) {
            frag.appendChild(panelCaret());
            caretPlaced = true;
        }
        if (take < line.length) {
            const ghost = document.createElement('span');
            ghost.className = 'panel-ghost';
            ghost.textContent = line.slice(take);
            frag.appendChild(ghost);
        }
    }
    el.replaceChildren(frag);
}

// Scroll cue: once the intro has settled (bio in), two seconds with no
// activity brings up a bobbing arrow at the bottom. Activity before then
// restarts the wait; once it's up it stays until dealing starts.
const SCROLL_CUE_IDLE_MS = 2000;
let scrollCueTimer = null;

function armScrollCue() {
    const cue = document.getElementById('scroll-cue');
    if (!cue || introPhase !== 'waitForScroll' || cue.classList.contains('visible')) return;
    const panels = document.getElementById('about-panels');
    if (!panels || !panels.classList.contains('bio-in')) return;
    clearTimeout(scrollCueTimer);
    scrollCueTimer = setTimeout(() => {
        scrollCueTimer = null;
        if (introPhase === 'waitForScroll') cue.classList.add('visible');
    }, SCROLL_CUE_IDLE_MS);
}

function hideScrollCue() {
    clearTimeout(scrollCueTimer);
    scrollCueTimer = null;
    const cue = document.getElementById('scroll-cue');
    if (cue) cue.classList.remove('visible');
}

function showPanelBio(panels) {
    panels.classList.add('bio-in');
    armScrollCue();
}

// Types the left (top, on a phone) name, then lets the bio fade in out of
// a blur. Dealing or a skipped intro cancels the chain via cancelPanelType.
function playPanelNameType(panels) {
    cancelPanelType();
    const nameEl = panels.querySelector('.panel-name');
    if (!nameEl) {
        showPanelBio(panels);
        return;
    }
    const lines = readPanelNameLines(nameEl);
    const total = lines.reduce((n, line) => n + line.length, 0);
    if (!total) {
        showPanelBio(panels);
        return;
    }
    nameEl.setAttribute('aria-label', lines.join(' '));

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
        renderPanelName(nameEl, lines, total, false);
        showPanelBio(panels);
        return;
    }

    const CHAR_MS = 46;
    const LINE_GAP = 180;
    renderPanelName(nameEl, lines, 0, true);

    let count = 0;
    function step() {
        if (!panels.classList.contains('visible')) return;
        if (count >= total) {
            panelTypeTimer = setTimeout(() => {
                renderPanelName(nameEl, lines, total, false);
                panelTypeTimer = setTimeout(() => {
                    panelTypeTimer = null;
                    if (panels.classList.contains('visible')) showPanelBio(panels);
                }, 90);
            }, 160);
            return;
        }
        count += 1;
        renderPanelName(nameEl, lines, count, true);
        const atLineBreak = lines.some((_, i) => {
            if (i === lines.length - 1) return false;
            const end = lines.slice(0, i + 1).reduce((n, line) => n + line.length, 0);
            return count === end;
        });
        panelTypeTimer = setTimeout(step, CHAR_MS + (atLineBreak ? LINE_GAP : 0));
    }
    panelTypeTimer = setTimeout(step, 110);
}

function startIntro() {
    if (introAlreadyPlayed()) { skipIntro(); return; }
    // No extra delay needed — loader fade already provides the transition buffer
    const c = cards[0];
    if (!c) return;
    c.visible = true;
    if (!loaderRevealedAbout) cardDropStartTime[0] = performance.now();
    introPhase = 'waitForScroll';
    const panels = document.getElementById('about-panels');
    if (panels) panelRevealTimeout = setTimeout(() => {
        panelRevealTimeout = null;
        panels.classList.add('visible');
        playPanelNameType(panels);
    }, 140);
}

// The view pill is the last piece of chrome. `delay` is how long after the
// caller to start the grow; 0 is a return visit, where the pill is already
// open via data-intro-done and this only keeps the class in step.
function revealViewToggle(delay) {
    const el = document.getElementById('view-toggle');
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => el.classList.add('is-open'), reduce ? 0 : delay);
}

function triggerDealing() {
    if (introPhase !== 'waitForScroll') return;
    introPhase = 'dealing';
    // Cancel any pending reveal so the panels can't pop back in after we start exiting
    if (panelRevealTimeout !== null) {
        clearTimeout(panelRevealTimeout);
        panelRevealTimeout = null;
    }
    cancelPanelType();
    hideScrollCue();
    // Slide panels upward then remove them
    const panels = document.getElementById('about-panels');
    if (panels) {
        panels.classList.remove('visible');
        panels.classList.remove('bio-in');
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

    // Unlock interaction and reveal the top nav
    setTimeout(() => {
        introPhase = 'done';
        markIntroPlayed();
        const sl = document.getElementById('social-links');
        if (sl) setTimeout(() => sl.classList.add('ui-intro-visible'), 100);
        const tn = document.getElementById('top-nav');
        if (tn) setTimeout(() => tn.classList.add('visible'), 200);
        // Last of the chrome. The nav is already settled; the pill then
        // grows out from the middle.
        revealViewToggle(1100);
    }, totalDuration + 200);
}

function skipIntro() {
    // Instantly show all cards and jump straight to interactive state
    cards.forEach((c, i) => {
        if (!c) return;
        // A card still building in shows itself when it is finished
        if (!cbOwns(i)) c.visible = true;
        cardIntroY[i] = 0;
        cardHoverY[i] = 0;
        c.position.y = 0;
    });
    introPhase = 'done';
    markIntroPlayed();
    const sl = document.getElementById('social-links');
    if (sl) sl.classList.add('ui-intro-visible');
    const tn = document.getElementById('top-nav');
    if (tn) tn.classList.add('visible');
    revealViewToggle(0);
    if (panelRevealTimeout !== null) {
        clearTimeout(panelRevealTimeout);
        panelRevealTimeout = null;
    }
    cancelPanelType();
    const panels = document.getElementById('about-panels');
    if (panels) { panels.classList.remove('visible'); panels.classList.remove('bio-in'); panels.classList.remove('exiting'); }
}

// A return visit used to sit in 'idle' until the last card called
// startIntro. Unlock the chrome now so the nav is there for the fade-in,
// not waiting on the same Promise as the faces.
// On a first visit the build-in reveals the chrome once the front card is in
// (cbFinishIntro). Reduced motion gets no build at all, so it lands straight in.
if (introSkipped || !CB_ENABLED) {
    document.body.classList.add('gradient-visible');
    skipIntro();
}

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

// Intro panel logos: hovering one tips it a few degrees to a random side.
// The angle is fresh on every visit, so repeated hovers do not look canned.
document.querySelectorAll('.company-slot').forEach((slot) => {
    const pill = slot.querySelector('.company-pill');
    if (!pill) return;
    const tip = () => {
        const deg = (4 + Math.random() * 4) * (Math.random() < 0.5 ? -1 : 1);
        pill.style.setProperty('--tilt', deg.toFixed(1) + 'deg');
    };
    const settle = () => pill.style.removeProperty('--tilt');
    slot.addEventListener('mouseenter', tip);
    slot.addEventListener('mouseleave', settle);
    slot.addEventListener('focus', tip);
    slot.addEventListener('blur', settle);
});
