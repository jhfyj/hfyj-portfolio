



import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
// Scene
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x1d1d1d, 3, 7); // subtle fog — back cards fade toward bg color
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const cardgroup = new THREE.Group();
const cards = [];

let targetRotation = null;
let snapSpeed = 0.1;
const cardCount = 7;
let scrollTimeout = null;
let totalModels = 7;
let loadedModels = 0;

// Loader
const loaderEl    = document.getElementById('loader');
const loaderPctEl = document.getElementById('loader-pct');
let loaderTarget  = 0;   // jumps to each step as models arrive
let loaderDisplay = 0;   // lerps smoothly toward loaderTarget
let loaderDone    = false;
// const URL_CARD_INDEX = 6;
// const URL_CARD_LINK = "https://hfyj-art.com/sketchbook"; // Replace with your URL

let carouselSettled = true;
let lastGroupRotY = 0;
let stillFrames = 0;
const ROT_EPS = 0.00035;
const STILL_FRAMES_NEEDED = 8;

let swipeStartY = 0;
let swipeStartX = 0;
let lastSwipeY = 0;
let swipeMoved = false;

let isDragging = false;
let previousMouseX = 0;

let dragStartX = 0;
let dragStartY = 0;
let hasDragged = false;
const DRAG_THRESHOLD = 5;

// Scrubber drag flag — declared here so canvas handlers can check it
let scrubberDragging = false;

// Hover tracking
let hoveredCard = null;
const HOVER_Y = 0.15;
const HOVER_ANIM_SPEED = 0.17;
const hasFinePointer = window.matchMedia('(pointer: fine)').matches;

// Card-0 mouse-follow tilt — active during waitForScroll phase
let card0TiltTargX = 0, card0TiltTargY = 0; // mouse-driven targets (radians)
let card0TiltCurrX = 0, card0TiltCurrY = 0; // smoothly lerped current values
const CARD0_TILT_MAX = 0.24;  // ~10° max tilt in either axis
const CARD0_TILT_SPEED = 0.07;

// --- Intro animation state ---
// 'idle' → 'waitForScroll' (About Me visible) → 'dealing' → 'done'
let introPhase = 'idle';
const cardIntroY = new Array(cardCount).fill(0); // per-card Y offset above normal (eases → 0)
const cardHoverY = new Array(cardCount).fill(0); // per-card hover lift (separate from intro)

// Per-card drop animation timing (performance.now() when drop started, -Infinity = not started)
const cardDropStartTime = new Array(cardCount+1).fill(-Infinity);
const CARD_DROP_DURATION = 500; // ms — linear drop, matches step interval
const CARD_DROP_START_Y = 12;   // how high above normal each card starts
// Precomputed ms offset from introAnimStartTime at which each card should start dropping.
// Set by triggerDealing(); checked every frame to avoid setTimeout jitter.
const cardDropOffset = new Array(cardCount).fill(Infinity);

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

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Custom card cursor element — styles injected here because index.html doesn't link style.css
const cursorStyle = document.createElement('style');
cursorStyle.textContent = `
  #card-cursor {
    position: fixed;
    left: 0;
    top: 0;
    transform: translate(-50%, -50%);
    padding: 9px 20px;
    background: rgba(30, 30, 30, 0.52);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.28);
    border-radius: 999px;
    color: rgba(255, 255, 255, 0.95);
    font-family: "Play", system-ui, sans-serif;
    font-size: 13px;
    letter-spacing: 0.8px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
    pointer-events: none;
    z-index: 99999;
    opacity: 0;
    transition: opacity 0.25s ease;
    white-space: nowrap;
    user-select: none;
  }
  #card-cursor.visible {
    opacity: 1;
  }
`;
document.head.appendChild(cursorStyle);

const cardCursor = document.createElement('div');
cardCursor.id = 'card-cursor';
cardCursor.textContent = 'open project';
document.body.appendChild(cardCursor);



// Lights
const directionalLight = new THREE.DirectionalLight(0xFFF5A7, 2);
directionalLight.position.set(2, 0.5, 4);
scene.add(directionalLight);

const directionalLight2 = new THREE.DirectionalLight(0xA7D7FF, 2);
directionalLight2.position.set(-2, -0.5, 4);
scene.add(directionalLight2);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enableRotate = false;
controls.enableZoom = false;
controls.enablePan = false;

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Inverse of easeInOutQuad — maps equally-spaced card indices to drop times that
// bunch in the centre (~3:1 edge-to-centre ratio: slow start → fast middle → slow end).
function easeInOutInverse(t) {
    return t < 0.5
        ? Math.sqrt(t / 2.666)
        : 1 - Math.sqrt((1 - t) / 2.666);
}


// Load Models
const loader = new GLTFLoader();
const modelURLs = [
  "https://jhfyj.github.io/New-Website-Code/models/About me.glb",
    "https://jhfyj.github.io/New-Website-Code/models/Puregym.glb",
    "https://jhfyj.github.io/New-Website-Code/models/techatnyu.glb",
    "https://jhfyj.github.io/New-Website-Code/models/DFG-ASBA.glb",
    "https://jhfyj.github.io/New-Website-Code/models/Leslie Founders.glb",
    "https://jhfyj.github.io/New-Website-Code/models/Clarusai.glb",
    "https://jhfyj.github.io/New-Website-Code/models/sketchbook.glb",
];

// Page URLs for each card — edit these to match your Framer pages
const CARD_URLS = [
    "https://hfyj-art.com/aboutme",        // 0 — About Me
    "https://hfyj-art.com/puregym",         // 1 — Puregym
    "https://hfyj-art.com/techatnyu",     // 2 — tech@nyu
    "https://hfyj-art.com/asba",        // 3 — DFG-ASBA
    "https://hfyj-art.com/lesliefounders", // 4 — Leslie Founders
    "https://hfyj-art.com/clarusai",       // 5 — Clarus AI
    "https://hfyj-art.com/sketchbook",      // 6 — Sketchbook
];

// Responsive card scale — steps down at medium and narrow screens
function getCardScale() {
    if (window.innerWidth <= 768)  return 0.24;
    if (window.innerWidth <= 1100) return 0.26;
    if (window.innerWidth <= 1400) return 0.28;
    return 0.3;
}

// Carousel ring radius — proportional to card scale so spacing stays consistent
function getCarouselRadius() {
    if (window.innerWidth <= 768)  return 1.7;
    if (window.innerWidth <= 1100) return 1.8;
    if (window.innerWidth <= 1400) return 1.9;
    return 2;
}


function loadCard0() {
    texLoader.load("Cards/driver.png", (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        const aspect = texture.image.naturalWidth / texture.image.naturalHeight || 1.586;
        const cardH = 2.0, cardW = cardH * aspect, cardDepth = 0.02;
        const geometry = new THREE.BoxGeometry(cardW, cardH, cardDepth);
        const frontMat = new THREE.MeshStandardMaterial({ map: texture, metalness: 0.75, roughness: 0.2 });
        const edgeMat  = new THREE.MeshStandardMaterial({ color: 0xF8F5EA, metalness: 0.6, roughness: 0.3 });
        const mesh  = new THREE.Mesh(geometry, [edgeMat, edgeMat, edgeMat, edgeMat, frontMat, edgeMat]);
        const group = new THREE.Group();
        group.userData.cardIndex = 0;
        group.add(mesh);
        _placeCard(0, group);
    });
}

loadCard0();

modelURLs.forEach((url, i) => {
    loader.load(url, (gltf) => {
        const m = gltf.scene;
        cards[i] = m;
        m.userData.cardIndex = i;

        const s = getCardScale();
        m.scale.set(s, s, s);
        const angle = (i * 360) / cardCount;
        const r = getCarouselRadius();
        m.position.set(
            Math.sin(THREE.MathUtils.degToRad(angle)) * r,
            0,
            Math.cos(THREE.MathUtils.degToRad(angle)) * r
        );
        m.rotation.y = THREE.MathUtils.degToRad(angle);
        m.traverse((child) => {
            if (child.isMesh) {
                child.material.envMapIntensity = 0;
            }
        });

        // Cards start hidden so the intro can slide them in one by one
        m.visible = false;
        cardgroup.add(m);
        loadedModels++;
        loaderTarget = (loadedModels / totalModels) * 100;
        // If there's no loader element (e.g. Framer embed), kick off the intro directly
        if (loadedModels === totalModels && !loaderEl) {
            startIntro();
        }
    });
});

scene.add(cardgroup);

// Scroll handling
window.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (introPhase === 'waitForScroll') { triggerDealing(); return; }
    if (introPhase !== 'done') return;
    // deltaY = vertical scroll/swipe, deltaX = horizontal two-finger trackpad swipe
    hoveredCard = null;
    card0TiltTargX = 0; card0TiltTargY = 0;
    cardgroup.rotation.y += (e.deltaY - e.deltaX) * 0.002;
    targetRotation = null;

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => snaptoNearestCard(), 100);
}, { passive: false });

// Touch handling
canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    swipeStartX = e.touches[0].clientX;
    swipeStartY = e.touches[0].clientY;
    lastSwipeY = swipeStartY;
    swipeMoved = false;
}, { passive: true });

canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;

    const x = e.touches[0].clientX;
    const y = e.touches[0].clientY;
    const dx = x - swipeStartX;
    const dyFromStart = y - swipeStartY;

    if (!swipeMoved && Math.abs(dyFromStart) > 8) swipeMoved = true;
    if (Math.abs(dx) > Math.abs(dyFromStart) * 1.2) return;

    if (swipeMoved) {
        e.preventDefault();
        if (introPhase === 'waitForScroll') { triggerDealing(); return; }
        if (introPhase !== 'done') return;
        const dy = lastSwipeY - y;
        lastSwipeY = y;
        hoveredCard = null;
        card0TiltTargX = 0; card0TiltTargY = 0;
        cardgroup.rotation.y += dy * 0.002 * 1.3;
        targetRotation = null;

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => snaptoNearestCard(), 100);
    }
}, { passive: false });

canvas.addEventListener("touchend", () => {
    swipeMoved = false;
}, { passive: true });

// Hover detection via mousemove
window.addEventListener('mousemove', (e) => {
    if (!hasFinePointer) return; // touch devices — no cursor label

    cardCursor.style.left = e.clientX + 'px';
    cardCursor.style.top = e.clientY + 'px';

    if (isDragging) {
        hoveredCard = null;
        cardCursor.classList.remove('visible');
        canvas.style.cursor = '';
        return;
    }

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const hits = raycaster.intersectObjects(cardgroup.children, true);
    if (hits.length > 0) {
        const root = findCardRoot(hits[0].object);
        if (root) {
            hoveredCard = root;
            // Only tilt card 0 when the mouse is directly over it
            if (introPhase === 'waitForScroll' ) {
                card0TiltTargY = ((e.clientX / window.innerWidth)  - 0.5) * 2 * CARD0_TILT_MAX;
                card0TiltTargX =  ((e.clientY / window.innerHeight) - 0.5) * 2 * CARD0_TILT_MAX;
            }
            cardCursor.classList.add('visible');
            canvas.style.cursor = 'none';
            if (introPhase === 'waitForScroll') {
                cardCursor.textContent = 'scroll down';
            } else {
                const idx = root.userData.cardIndex;
                cardCursor.textContent = idx === 0 ? 'about me' : idx === 6 ? 'view sketchbook' : 'open project';
            }
        } else {
            hoveredCard = null;
            card0TiltTargX = 0;
            card0TiltTargY = 0;
            cardCursor.classList.remove('visible');
            canvas.style.cursor = '';
        }
    } else {
        hoveredCard = null;
        card0TiltTargX = 0;
        card0TiltTargY = 0;
        cardCursor.classList.remove('visible');
        canvas.style.cursor = '';
    }
});

canvas.addEventListener('mouseleave', () => {
    hoveredCard = null;
    card0TiltTargX = 0;
    card0TiltTargY = 0;
    cardCursor.classList.remove('visible');
    canvas.style.cursor = '';
});

// Click handling
canvas.addEventListener("click", (event) => {
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

    const front = getFrontCard();
    if (!front) return;

    const idx = front.userData.cardIndex;
    window.parent.location.href = CARD_URLS[idx];
}





// Drag rotation
canvas.addEventListener("pointerdown", (e) => {
    if (scrubberDragging) return;   // ignore if scrubber is active

    if (introPhase !== 'done') return; // no dragging during intro
isDragging = true;
    previousMouseX = e.clientX;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    hasDragged = false;
});

window.addEventListener("pointerup", (e) => {
    if (scrubberDragging) return;   // scrubber handles its own release
    if (!isDragging) return;
    isDragging = false;
    snaptoNearestCard();
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
        const hoverTarget = (card === hoveredCard && introPhase === 'done') ? HOVER_Y : 0;
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
            if (t >= 1) { cardIntroY[i] = 0; cardDropStartTime[i] = -Infinity; cardDropOffset[i] = Infinity; }
        }
        card.position.y = cardHoverY[i] + cardIntroY[i];
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

    // Snap animation (only when intro rotation is not active)
    if (!introAnimActive && !isDragging && targetRotation !== null) {
        const diff = targetRotation - cardgroup.rotation.y;
        if (Math.abs(diff) < 0.001) {
            cardgroup.rotation.y = targetRotation;
            targetRotation = null;
        } else {
            cardgroup.rotation.y += diff * (snapSpeed);
        }
    }

    // Settle detection
    const dy = Math.abs(cardgroup.rotation.y - lastGroupRotY);
    lastGroupRotY = cardgroup.rotation.y;

    if (dy < ROT_EPS) {
        stillFrames++;
    } else {
        stillFrames = 0;
    }

    carouselSettled = !isDragging && targetRotation === null && stillFrames >= STILL_FRAMES_NEEDED;

    // Loader percentage — lerps smoothly toward the loaded target
    if (loaderEl && !loaderDone) {
        loaderDisplay += (loaderTarget - loaderDisplay) * 0.06;
        const pct = Math.min(100, Math.floor(loaderDisplay));
        loaderPctEl.textContent = pct + '%';
        if (loaderTarget >= 100 && pct >= 99) {
            loaderDone = true;
            loaderPctEl.textContent = '100%';
            setTimeout(() => {
                loaderEl.classList.add('fade-out');
                setTimeout(() => {
                    loaderEl.remove();
                    startIntro(); // card drop plays after loader is fully gone
                }, 700);
            }, 200);
        }
    }

    // Update scrubber UI
    updateScrubber();

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
const CARD_NAMES = [
    'About Me',
    'Sketchbook',
    'Clarus AI',
    'DFG-ASBA',
    'Leslie Founders',
    'tech@nyu Rebrand',
    'Puregym Redesign',
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
    const tick = e.target.closest('.scrubber-tick');
    if (!tick) return;
    const cardIdx = tickToCardIndex(parseInt(tick.dataset.tickIndex));
    const apc = (Math.PI * 2) / cardCount;
    const current = Math.round(cardgroup.rotation.y / apc);
    const currentMod = ((current % cardCount) + cardCount) % cardCount;
    let diff = cardIdx - currentMod;
    if (diff > cardCount / 2) diff -= cardCount;
    if (diff < -cardCount / 2) diff += cardCount;
    targetRotation = (current + diff) * apc;
});

// Drag-to-scrub on the track
let scrubberStartX = 0;
let scrubberStartRotation = 0;
const SCRUB_SENSITIVITY = 0.035;
const scrubberWrap = document.getElementById('scrubber-track-wrap');

function onScrubMove(e) {
    if (!scrubberDragging) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const dx = clientX - scrubberStartX;
    // Negative dx (drag left) → rotation increases → carousel moves forward
    cardgroup.rotation.y = scrubberStartRotation - dx * SCRUB_SENSITIVITY;
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
        targetRotation = (current + step) * apc;
    }

    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!carouselSettled) return;
        const front = getFrontCard();
        if (!front) return;
        const idx = front.userData.cardIndex;
        window.parent.location.href = CARD_URLS[idx];
    }
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
    if (panels) setTimeout(() => panels.classList.add('visible'), 350);
}

function triggerDealing() {
    if (introPhase !== 'waitForScroll') return;
    introPhase = 'dealing';
    // Slide panels upward then remove them
    const panels = document.getElementById('about-panels');
    if (panels) {
        panels.classList.remove('visible');
        panels.classList.add('exiting');
        setTimeout(() => panels.classList.remove('exiting'), 600);
    }

    const STEP_MS = 500; // ms per card slot
    const totalDuration = STEP_MS * cardCount; // one full circle over 7 steps

    // One continuous linear rotation: current → current - 2π (full circle, lands on About Me)
    introAnimStartTime = performance.now();
    introAnimStartRot = cardgroup.rotation.y;
    introAnimEndRot = cardgroup.rotation.y - (Math.PI * 2);
    introAnimDuration = totalDuration;
    introAnimActive = true;
    targetRotation = null;

    // Precompute each card's drop offset from introAnimStartTime so the render loop
    // can trigger drops frame-accurately without setTimeout jitter.
    const totalSpread = STEP_MS * (cardCount - 2);
    for (let i = 1; i < cardCount; i++) {
        const norm = (i - 1) / (cardCount);
        cardDropOffset[i] = Math.round(easeInOutInverse(norm) * totalSpread) - 540;
        cardDropStartTime[i] = -Infinity; // reset in case of re-deal
    }

    // Unlock interaction and reveal social links + scrubber
    setTimeout(() => {
        introPhase = 'done';
        const sl = document.getElementById('social-links');
        if (sl) setTimeout(() => sl.classList.add('ui-intro-visible'), 100);
        if (scrubberEl) setTimeout(() => scrubberEl.classList.add('ui-intro-visible'), 350);
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