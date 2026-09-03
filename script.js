import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ── Theme (light ↔ dark) ──────────────────────────────────────────────────────
const THEME_KEY = 'theme';
function getStoredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    return (saved === 'dark' || saved === 'light') ? saved : 'light';
}
let currentTheme = getStoredTheme();
document.documentElement.setAttribute('data-theme', currentTheme);

// Paper stock for every card drawn in code — faces and backs alike. Card 8
// (the sketchbook scan) is a flat image, so it carries its own background.
const CARD_BG = '#F7F5F5';

const THEME_COLORS = {
    light: { fog: 0xFCFCFE, accent: '#5E81E2', cardBg: CARD_BG },
    dark:  { fog: 0x121212, accent: '#FFFA50', cardBg: '#373737' },
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
let totalModels = 9;
let loadedModels = 0;

// Loader
const loaderEl        = document.getElementById('loader');
const loaderProgressEl = document.getElementById('loader-progress-bar');
const loaderStart = performance.now();
const LOADER_MIN_MS = 3000; // keep the shuffle on screen even on fast loads
let loaderTarget  = 0;   // jumps to each step as models arrive
let loaderDisplay = 0;   // lerps smoothly toward loaderTarget
let loaderDone    = false;

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
`;
document.head.appendChild(cursorStyle);

const cardCursor = document.createElement('div');
cardCursor.id = 'card-cursor';
cardCursor.textContent = 'open project';
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
const CARD_BACK_SCALE = 2;

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

function makeCardBackTexture(theme) {
    const s = CARD_BACK_SCALE;
    const w = CARD_BACK_DESIGN.w * s, h = CARD_BACK_DESIGN.h * s;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
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

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

// Every back-face material currently in the scene, so toggling the theme can
// swap their texture live instead of only affecting cards created afterward.
const cardBackMaterials = [];

function updateCardBackTexture(theme) {
    if (!hfyjMarkImg.complete) return; // not loaded yet — the initial texture below already awaits it
    const tex = makeCardBackTexture(theme);
    cardBackMaterials.forEach((mat) => {
        mat.map = tex;
        mat.needsUpdate = true;
    });
}

// Pre-load shared card back texture — resolves as a promise so card loaders can await it
const backTexturePromise = hfyjMarkReady.then(() => makeCardBackTexture(currentTheme));

// Page URLs for each card — edit these to match your Framer pages
const CARD_URLS = [
    "aboutme.html",                        // 0 — About Me
    "puregym.html",                        // 1 — Puregym
    "https://hfyj-art.com/techatnyu",       // 2 — tech@nyu
    "https://hfyj-art.com/clarusai",        // 3 — Clarus AI
    "https://hfyj-art.com/povi",            // 4 — POVI
    "https://hfyj-art.com/the-dial",        // 5 — The Dial
    "#",                                    // 6 — BMW Designworks (Coming Soon)
    "#",                                    // 7 — Nenos Inc. (Coming Soon)
    "https://hfyj-art.com/sketchbook",      // 8 — Sketchbook
];

// Cards with no real destination page yet — hovering shows "coming soon" and
// clicking the front card is a no-op instead of navigating. Keep in sync with
// the "#" placeholders above.
const COMING_SOON_INDICES = new Set([6, 7]);


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
        cardBackMaterials.push(mat);
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
// (vector text/shapes) onto a canvas and only load real raster assets for the
// photo and the three fact-row icons.
const ABOUTME_DESIGN = { w: 1059, h: 1449 }; // matches the Figma frame 1:1
const ABOUTME_SCALE = 3;
// The photo's folded-corner silhouette, straight off the Figma node. Kept as a
// path (rather than baked into the image's alpha) so the mask edge stays
// resolution-independent — the blur below would otherwise soften it.
const ABOUTME_PHOTO_MASK = 'M1014 20C1027.25 20 1038 30.7452 1038 44V1400C1038 1413.25 1027.25 1424 1014 1424H45C31.7452 1424 21 1413.25 21 1400V131C21 98 40.9 78.5 72.5 78.5H138.932C150.052 78.5 160.578 73.4981 167.604 64.8789L188.294 39.5C188.294 39.5 203 20 231 20H1014Z';
// The Figma node carries a layer blur, but Figma's own render ignores it — its
// PNG export is sharp. Matching the render, not the filter. Raise to soften.
const ABOUTME_PHOTO_BLUR = 0;
const ABOUTME_PILL_FONT_PX = 14; // matches the design's DM Sans optical size
// Fun-fact rows, in design px. Scaled up from the Figma frame's 46px/48px.
const ABOUTME_FACT = {
    left: 77,
    top: 945,
    fontPx: 58,
    iconH: 60,
    iconGap: 19,
    rowH: 69,
    rowGap: 42,
};

function loadCard0() {
    const s = ABOUTME_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = ABOUTME_DESIGN.w * s;
    canvas.height = ABOUTME_DESIGN.h * s;
    const ctx = canvas.getContext('2d');

    const photo = new Image();
    photo.src = './Cards/aboutme-photo.webp';
    // Setting width/height before the src decodes tells the browser to
    // rasterize these vector icons at the scaled-up size we'll actually draw
    // them at, instead of their small native 48px box then upscaling that
    // bitmap — which is what was making the icons (and, by extension, the
    // whole card) read as soft/blurry.
    const iconH = ABOUTME_FACT.iconH * s;
    const iconDance = new Image();
    iconDance.width = iconH;          // 48x48 native
    iconDance.height = iconH;
    iconDance.src = './assets/icon-dance.svg';
    const iconGuitar = new Image();
    iconGuitar.width = iconH * (102 / 48); // 102x48 native
    iconGuitar.height = iconH;
    iconGuitar.src = './assets/icon-guitar.svg';
    const iconMatcha = new Image();
    iconMatcha.width = iconH * (156 / 48); // 156x48 native
    iconMatcha.height = iconH;
    iconMatcha.src = './assets/icon-matcha.svg';

    Promise.all([
        document.fonts.ready,
        new Promise((resolve) => { photo.onload = resolve; }),
        new Promise((resolve) => { iconDance.onload = resolve; }),
        new Promise((resolve) => { iconGuitar.onload = resolve; }),
        new Promise((resolve) => { iconMatcha.onload = resolve; }),
    ]).then(() => {
        const r = 36 * s;
        // Set once, up front — save()/restore() below would otherwise
        // revert this back to the canvas default partway through drawing,
        // leaving the icons (drawn after the restore) soft.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Background + photo, clipped to the card's rounded corners
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(0, 0, canvas.width, canvas.height, r);
        ctx.clip();
        ctx.fillStyle = CARD_BG;
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
        ctx.drawImage(
            photo,
            (-25.888 - (pw * k - pw) / 2) * s,
            (20 - (ph * k - ph) / 2) * s,
            pw * k * s,
            ph * k * s,
        );
        ctx.filter = 'none';
        // Dark scrim over the lower half, so the white text below reads
        const scrim = ctx.createLinearGradient(0, 637 * s, 0, 1424 * s);
        scrim.addColorStop(0, 'rgba(0,0,0,0)');
        scrim.addColorStop(1, 'rgba(0,0,0,1)');
        ctx.fillStyle = scrim;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        // Hairline around the photo silhouette
        ctx.strokeStyle = '#000';
        ctx.lineWidth = s;
        ctx.stroke(maskPath);
        ctx.restore();

        // Figma positions text by its line box; canvas draws from a baseline.
        // Deriving the baseline from the font's own metrics is what keeps these
        // landing where the design says, instead of a hand-tuned offset.
        function drawBoxedText(text, x, y, w, h, align) {
            const m = ctx.measureText(text);
            ctx.textAlign = align;
            ctx.textBaseline = 'alphabetic';
            const inner = m.fontBoundingBoxAscent + m.fontBoundingBoxDescent;
            const baseline = y + (h - inner) / 2 + m.fontBoundingBoxAscent;
            ctx.fillText(text, align === 'center' ? x + w / 2 : x, baseline);
        }

        // "#000" tag, sitting over the folded corner
        ctx.fillStyle = '#000';
        ctx.font = `italic 400 ${36 * s}px "Inter", "DM Sans", sans-serif`;
        drawBoxedText('#000', 56 * s, 24 * s, 91 * s, 44 * s, 'center');

        // Name
        ctx.fillStyle = '#000';
        ctx.font = `700 ${80 * s}px "Play", sans-serif`;
        drawBoxedText('Jennifer Huang', 205 * s, 35 * s, 572 * s, 93 * s, 'left');

        // Fun-fact rows — icon + white label, over the lower half of the photo
        const F = ABOUTME_FACT;
        function drawFactRow(icon, text, index) {
            const rowY = F.top + index * (F.rowH + F.rowGap);
            const iconW = F.iconH * (icon.naturalWidth / icon.naturalHeight);
            // Icon sits centred against the text's line box
            ctx.drawImage(icon, F.left * s, (rowY + (F.rowH - F.iconH) / 2) * s, iconW * s, F.iconH * s);
            ctx.font = `400 ${F.fontPx * s}px "Figtree", "DM Sans", sans-serif`;
            ctx.fillStyle = '#fff';
            drawBoxedText(text, (F.left + iconW + F.iconGap) * s, rowY * s, 0, F.rowH * s, 'left');
        }
        drawFactRow(iconDance,  'hip hop dance', 0);
        drawFactRow(iconGuitar, 'classical guitar (love tarrega)', 1);
        drawFactRow(iconMatcha, 'matcha fein', 2);

        // Tag pills — white outline, no fill, so the photo shows through.
        // Widths come from the design rather than text measurement, so a font
        // that metrics slightly differently can't drift the row out of place.
        function drawPill(label, x, w) {
            const y = 1327 * s, h = 68 * s;
            ctx.beginPath();
            ctx.roundRect(x * s, y, w * s, h, h / 2);
            ctx.lineWidth = 3 * s;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
            ctx.fillStyle = '#fff';
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
        drawPill('NYU', 282, 153);
        drawPill('TINKERER', 282 + 165, 280);
        drawPill('DESIGNER', 282 + 457, 266);

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

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        const aspect = ABOUTME_DESIGN.w / ABOUTME_DESIGN.h;
        const cardH = 1.7, cardW = cardH * aspect;
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
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
const PUREGYM_SCALE = 2;

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

function puregymDrawPill(ctx, x, y, w, h, label, s) {
    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = '#232323';
    ctx.stroke();
    ctx.fillStyle = '#000000';
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

        // Background + phone-mockup photo, clipped to the card's rounded corners
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(0, 0, canvas.width, canvas.height, r);
        ctx.clip();
        ctx.fillStyle = CARD_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(mockup, 21 * s, 20 * s, 1016.663 * s, 817 * s);
        ctx.restore();

        // "#003" — this card's position in the site's numbering (not Figma's placeholder number)
        ctx.fillStyle = '#000';
        ctx.font = `italic 400 ${36 * s}px "DM Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('#003', 100.5 * s, 24 * s);

        // Title + date
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#000';
        ctx.font = `700 ${96 * s}px "Play", sans-serif`;
        ctx.fillText('Puregym Redesign', 54 * s, 960 * s);
        ctx.fillStyle = '#585858';
        ctx.font = `400 ${64 * s}px "DM Sans", sans-serif`;
        ctx.fillText('Winter 2025', 54 * s, 1050 * s);

        // Description (wrapped to match the Figma column width)
        ctx.fillStyle = '#626875';
        ctx.font = `400 ${46 * s}px "DM Sans", sans-serif`;
        puregymWrapText(
            ctx,
            'Mobile redesign case study for Puregym focused on minimizing friction during check-in.',
            54 * s, 1150 * s, 901 * s, 58 * s
        );

        // Tag pills
        puregymDrawPill(ctx, 218 * s, 1354 * s, 242 * s, 68 * s, '2025-26', s);
        puregymDrawPill(ctx, 472 * s, 1354 * s, 335 * s, 68 * s, 'CASE STUDY', s);
        puregymDrawPill(ctx, 819 * s, 1354 * s, 219 * s, 68 * s, 'MOBILE', s);

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

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        const aspect = PUREGYM_DESIGN.w / PUREGYM_DESIGN.h;
        const cardH = 1.7, cardW = cardH * aspect;
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
        const mesh  = new THREE.Mesh(geometry, frontMat);
        const group = new THREE.Group();
        group.userData.cardIndex = 1;
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
const TEMPLATE_CARD_SCALE = 2;

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
function tmplDrawPill(ctx, x, y, h, label, s) {
    ctx.font = `600 ${40 * s}px "DM Sans", sans-serif`;
    const w = ctx.measureText(label).width + 80 * s;
    const r = h / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = '#232323';
    ctx.stroke();
    ctx.fillStyle = '#000000';
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

        ctx.save();
        ctx.beginPath();
        ctx.roundRect(0, 0, canvas.width, canvas.height, r);
        ctx.clip();
        ctx.fillStyle = CARD_BG;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();

        ctx.save();
        tmplPhotoClipPath(ctx, 21 * s, 20 * s, s);
        ctx.clip();
        if (photo) {
            tmplDrawImageCover(ctx, photo, 21 * s, 20 * s, 1016.663 * s, 817 * s);
        } else {
            ctx.fillStyle = '#d9d9d9';
            ctx.fillRect(21 * s, 20 * s, 1016.663 * s, 817 * s);
        }
        ctx.restore();

        // Only draw the "#00X" tag ourselves when it isn't already baked
        // into the photo (see loadCard1 for the baked-in case).
        // Same position/size Figma uses for the real tag (node 1060:10) —
        // the exact notch shape above comfortably fits it as-is.
        if (tag) {
            ctx.fillStyle = '#000';
            ctx.font = `italic 400 ${36 * s}px "DM Sans", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(tag, 100.5 * s, 24 * s);
        }

        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#000';
        ctx.font = `700 ${96 * s}px "Play", sans-serif`;
        ctx.fillText(title, 54 * s, 960 * s);
        ctx.fillStyle = '#585858';
        ctx.font = `400 ${64 * s}px "DM Sans", sans-serif`;
        ctx.fillText(subtitle, 54 * s, 1050 * s);

        ctx.font = `400 ${46 * s}px "DM Sans", sans-serif`;
        let y = 1150 * s;
        if (accentLine) {
            ctx.fillStyle = '#5E81E2';
            y = tmplWrapText(ctx, accentLine, 54 * s, y, 901 * s, 58 * s);
        }
        ctx.fillStyle = '#626875';
        tmplWrapText(ctx, description, 54 * s, y, 901 * s, 58 * s);

        const pillH = 68 * s, gap = 24 * s;
        const widths = pills.map((label) => {
            ctx.font = `600 ${40 * s}px "DM Sans", sans-serif`;
            return ctx.measureText(label).width + 80 * s;
        });
        const totalW = widths.reduce((a, b) => a + b, 0) + gap * (pills.length - 1);
        let px = canvas.width - 21 * s - totalW; // right-align to the same inset the photo uses
        pills.forEach((label, i) => {
            px += tmplDrawPill(ctx, px, 1354 * s, pillH, label, s) + gap;
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

        return canvas;
    });
}

function loadTemplateCard(index, opts) {
    buildTemplateCardTexture(opts).then((canvas) => {
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

        const aspect = TEMPLATE_CARD.w / TEMPLATE_CARD.h;
        const cardH = 1.7, cardW = cardH * aspect;
        const geometry = makeRoundedCardGeo(cardW, cardH, 0.06);
        const frontMat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
        const mesh = new THREE.Mesh(geometry, frontMat);
        const group = new THREE.Group();
        group.userData.cardIndex = index;
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

scene.add(cardgroup);

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
                cardCursor.textContent = idx === 0 ? 'about me'
                    : idx === 8 ? 'view sketchbook'
                    : COMING_SOON_INDICES.has(idx) ? 'coming soon'
                    : 'open project';
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
        const idx = front.userData.cardIndex;
        if (!COMING_SOON_INDICES.has(idx)) window.open(CARD_URLS[idx], '_top');
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
function snaptoNearestCard() {
    const anglePerCard = (Math.PI * 2) / cardCount;
    const rawRotation = cardgroup.rotation.y;
    const nearestIndex = Math.round(rawRotation / anglePerCard);
    targetRotation = nearestIndex * anglePerCard;
}


// --- Scrubber ---
// NOTE: this is NOT indexed by card index — it's indexed by rotation "step"
// distance from About Me (card 0), same scheme the nav-link data-card-index
// attributes use. Card i's slot here is at position (cardCount - i) % cardCount.
const CARD_NAMES = [
    'About Me',            // card 0
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
        const idx = front.userData.cardIndex;
        if (!COMING_SOON_INDICES.has(idx)) window.open(CARD_URLS[idx], '_top');
    }
});

// ── Theme toggle (light ↔ dark) ───────────────────────────────────────────────
function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    scene.fog.color.set(THEME_COLORS[theme].fog);
    updateCardBackTexture(theme);
    const favicon = document.getElementById('favicon');
    if (favicon) favicon.href = theme === 'dark' ? './assets/favicon-dark.svg' : './assets/favicon-light.svg';
}

document.getElementById('theme-toggle')?.addEventListener('click', () => {
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// ── View toggle (cards ↔ grid) ───────────────────────────────────────────────
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

toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === currentView) return;
        sfx.click();
        currentView = view;

        toggleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const scrubber = document.getElementById('scrubber');
        const socialLinks = document.getElementById('social-links');

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
            gridView.scrollTo({ top: 0, behavior: 'auto' });
            replayGridHeroReveal();
            replayGridCardReveal();
        } else {
            // Show carousel, hide grid
            gridView.classList.remove('visible');
            canvasEl.style.opacity = '1';
            canvasEl.style.pointerEvents = 'auto';
            if (scrubber) scrubber.classList.remove('slide-down');
            if (socialLinks) { socialLinks.style.opacity = ''; socialLinks.style.pointerEvents = ''; }
        }
    });
});

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

// --- Intro animation functions ---
function startIntro() {
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
