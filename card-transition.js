/* Card → page transition, the receiving half.

   The home page's carousel is WebGL, so the card that was just clicked is not
   an element: it cannot carry a view-transition-name and the View Transitions
   API has nothing to hold on to. And the home page cannot compute the flight
   itself either — each case page sets its own column width and its own hero
   aspect, so where the hero lands is only knowable here.

   So the hand-off is in two phases, through sessionStorage. script.js writes
   down what only it knows (the card's box on screen, its photo well as pixels,
   where its title's baseline sat); this file, running in <head> before the
   first paint, reads that back, measures where *this* page's hero and <h1>
   actually are, and flies a stand-in between the two.

   Nothing here is per-page geometry. Add a case page and it works, as long as
   the hero is the column's first child and the title is `.case-head h1`.

   Load it in <head>, before site.js and case.js. It has to beat the first
   paint: the class it sets is what holds the real hero and title back, and
   anything later than <head> lets them flash on screen before the overlay is
   there to cover them. */

(function () {
    'use strict';

    // script.js's key and shape. See the "Card → page hand-off" section there;
    // if the two ever drift apart, everything below simply declines to run.
    const KEY = 'hfyj:card-transition';

    // A stash is "a moment ago" or it is nothing. Without this bound, an entry
    // left behind by a click that never completed could hijack a plain visit
    // minutes later — a page suddenly animating for no reason the reader can
    // account for. Two and a half seconds is far longer than a navigation and
    // far shorter than anyone's idea of "still the same gesture".
    const FRESH_MS = 2500;

    const DURATION = 620;
    const TITLE_DELAY = 40;     // the artwork leads, the title follows it in

    // Leaving again. script.js keeps this one; unlike the arrival stash it is
    // not consumed, because it describes where the card is rather than a
    // gesture that has already happened.
    const ORIGIN_KEY = 'hfyj:card-origin';
    // Read once, by the pre-paint block in index.html, and dropped there.
    const RETURN_KEY = 'hfyj:card-return';
    const EXIT_DURATION = 520;
    // Longer than the arrival's 40ms. Going in, the two want to read as one
    // thing opening; coming out, the graphic going first and the title
    // following is the point, so the gap has to be visible.
    const EXIT_TITLE_DELAY = 110;
    // The mirror of EASE. Reflecting a cubic-bezier through the diagonal —
    // (x1,y1,x2,y2) becomes (1-x2,1-y2,1-x1,1-y1) — turns the arrival's
    // ease-out into the ease-in that undoes it, so the two directions are the
    // same motion run each way rather than two curves that merely rhyme.
    const EXIT_EASE = 'cubic-bezier(.64, 0, .78, .39)';
    const CROSSFADE = 200;
    const HERO_WAIT = 1200;     // longest we will hold out for the hero's media
    // The same curve the scroll-reveal in site.js uses, so the flight and the
    // page assembling around it read as one motion rather than two.
    const EASE = 'cubic-bezier(.22, .61, .36, 1)';

    // The two elements the overlay stands in for, and so the two the reveal in
    // site.js has to keep its hands off. Written as a selector because this
    // runs in <head>, when neither of them exists yet. The hero is identified
    // by position rather than by class: it is the column's first child on every
    // page, which is the whole point of the hero-first order.
    const OWNED = '.case-head h1, .case > :first-child';

    // Both halves have to name this page the same way, and all they share is a
    // URL. Last path segment, minus any .html.
    function slugOf(pathname) {
        const last = pathname.split('/').pop() || '';
        return last.replace(/\.html$/, '');
    }

    // Read and consume in one motion. A stash is good for exactly one arrival:
    // left in place it would replay the flight on a reload or a Back, neither
    // of which is the gesture it was written for.
    function takeStash() {
        let raw = null;
        try {
            raw = sessionStorage.getItem(KEY);
            sessionStorage.removeItem(KEY);
        } catch (err) {
            return null;   // storage throws outright in some privacy modes
        }
        if (!raw) return null;
        let s = null;
        try { s = JSON.parse(raw); } catch (err) { return null; }
        if (!s || typeof s !== 'object') return null;
        const age = Date.now() - s.t;
        if (!(age >= 0 && age < FRESH_MS)) return null;
        if (s.slug !== slugOf(location.pathname)) return null;
        if (!s.image || !s.photo || !s.title) return null;
        return s;
    }

    // Reduced motion gets today's page, exactly. Clearing the stash rather than
    // leaving it is deliberate: it has already served its purpose and a stale
    // one is only ever a liability.
    // Declared up here rather than beside its first use: the exit flight reads
    // it too, and it runs long after the guards below have returned on a page
    // that arrived without a stash — by which point a const declared past them
    // would never have been initialised at all.
    const root = document.documentElement;

    const reduced = !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const canAnimate = !!document.documentElement.animate && !reduced;

    // Set up the way out before any of the arrival guards below, because the
    // two directions are independent: a page reached by typing its URL has no
    // arrival stash to fly from, and still has to be able to fly home.
    if (canAnimate) setupExit();

    if (reduced) {
        try { sessionStorage.removeItem(KEY); } catch (err) {}
        return;
    }
    if (!canAnimate) return;

    const stash = takeStash();
    if (!stash) return;

    // case.css holds the hero and the <h1> at opacity 0 while this class is on.
    root.classList.add('card-transition');

    // site.js consults this before hiding anything for its scroll-reveal. Those
    // two elements are handed over by the flight instead, so the reveal must
    // not also be fading them in underneath the overlay.
    window.CardTransition = {
        active: true,
        owns: function (el) { return !!(el && el.matches && el.matches(OWNED)); },
    };

    let layer = null;
    let failsafe = 0;

    // Whatever else happens, the page has to end up in the state it would have
    // been in anyway. This is the one thing worth spending a timer on: a thrown
    // error, or a hero that never reports a size, would otherwise leave the
    // page permanently missing its two most important elements.
    //
    // It is re-armed as the flight becomes more predictable — once the document
    // is parsed, and again once the hero has been measured — so the window it
    // guards shrinks as there is less left to go wrong. And while the parser is
    // still working it refuses to fire at all: this page's stylesheets are
    // still arriving over the network, a slow one pushes DOMContentLoaded past
    // any deadline set from <head>, and a page that is merely slow has not gone
    // wrong. Otherwise the guard would be the thing most likely to break the
    // flight, which is precisely backwards.
    function arm(ms) {
        clearTimeout(failsafe);
        failsafe = setTimeout(function () {
            if (document.readyState === 'loading') return arm(ms);
            finish();
        }, ms);
    }
    arm(2000);

    function finish() {
        clearTimeout(failsafe);
        window.CardTransition.active = false;
        root.classList.remove('card-transition');
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        layer = null;
    }

    // A zero-sized inline-block aligned to the baseline reports the baseline's
    // own y, which script cannot get at any other way. It is the line the two
    // titles have to share: the card's is drawn *on* its baseline, and matching
    // box tops instead would leave them a few pixels apart at every font size.
    function baselineOf(el) {
        const probe = document.createElement('span');
        probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
        el.appendChild(probe);
        const y = probe.getBoundingClientRect().top;
        el.removeChild(probe);
        return y;
    }

    function place(el, r) {
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.width = r.width + 'px';
        el.style.height = r.height + 'px';
    }

    // The hero's height is not knowable until its media reports an intrinsic
    // size, and flying to the wrong height is worse than not flying: an <img>
    // at height:auto measures zero until it loads, and a <video> is worse still
    // — it reports the 300×150 default box, which is plausible enough to fool
    // any "does it have a box yet" test while being nothing like the real
    // thing. So ask the media itself. (The YouTube wells size themselves from a
    // padding ratio and are the right shape from the first frame.)
    //
    // Polling rather than listening, because three hero kinds means three
    // different events and what is actually being waited on is the box.
    function heroIsMeasurable(hero) {
        const media = hero.querySelector('img, video');
        if (!media) return true;
        // width/height attributes hand the browser the aspect ratio before a
        // single byte of the media arrives, so the box is already the right
        // shape and there is nothing to wait for. The five hero elements all
        // carry them; without them, the intrinsic size has to be asked for.
        if (media.getAttribute('width') && media.getAttribute('height')) return true;
        return media.tagName === 'IMG' ? media.naturalWidth > 0 : media.videoWidth > 0;
    }

    function whenHeroHasABox(hero, done) {
        const t0 = Date.now();
        (function tick() {
            const r = hero.getBoundingClientRect();
            if (heroIsMeasurable(hero) && r.height > 40 && r.width > 40) return done(true);
            if (Date.now() - t0 > HERO_WAIT) return done(false);
            requestAnimationFrame(tick);
        })();
    }

    function play(hero, h1) {
        const heroRect = hero.getBoundingClientRect();
        const h1Rect = h1.getBoundingClientRect();
        const h1Style = getComputedStyle(h1);
        const h1Size = parseFloat(h1Style.fontSize) || 42;
        const h1Baseline = baselineOf(h1);

        layer = document.createElement('div');
        layer.id = 'card-transition';
        layer.setAttribute('aria-hidden', 'true');

        // ---- the artwork -------------------------------------------------
        // A plain div wearing the captured pixels, never the real hero. The
        // three hero kinds behave nothing alike under a transform: an <img> is
        // fine, a <video> may have no first frame yet, and a YouTube <iframe>
        // re-lays-out its player if you scale it mid-load. A div behaves
        // identically for all three, and cross-fades to any of them.
        const media = document.createElement('div');
        media.className = 'ct-media';
        media.style.backgroundImage = 'url("' + stash.image + '")';
        // Borrowed rather than hard-coded: the video and embed wells are
        // rounded and the plain image heroes are not.
        media.style.borderRadius = getComputedStyle(hero).borderRadius;
        place(media, heroRect);

        // FLIP. The div already sits at its final box, so the animation only
        // has to undo the difference and play it out — transform and opacity
        // only, never the box itself, which would relayout on every frame.
        //
        // The scale is uniform, and that is the whole reason for the fitting
        // below. The card crops its artwork to roughly 5:4 and the heroes are
        // anything from 4:3 to 16:9, so scaling the card's photo rect straight
        // onto the hero's box would stretch the picture through the entire
        // flight — which does not read as a card opening, it reads as a bug.
        // Instead the flight starts from the largest piece of the card's photo
        // that is already the hero's shape, and grows that. The card itself is
        // gone by the time any of this is on screen, so a band of it going
        // unused costs nothing, while a stretch would have been unmissable.
        const start = photoStartBox(stash.photo, heroRect);
        const mediaFrom = 'translate(' +
            (start.x - heroRect.left) + 'px,' + (start.y - heroRect.top) + 'px) ' +
            'scale(' + (start.w / heroRect.width) + ')';

        // ---- the title ---------------------------------------------------
        // The <h1>'s own text in the <h1>'s own type, so that the far end of
        // the flight *is* the <h1>, pixel for pixel, and the swap has nothing
        // to give away. (The card draws its title in Play rather than DM Sans,
        // but by the time this is on screen the card is gone and there is
        // nothing left to compare it against — whereas a mismatch at the
        // landing would be visible against the real thing.)
        const title = document.createElement('div');
        title.className = 'ct-title';
        title.textContent = h1.textContent;
        ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
         'letterSpacing', 'textAlign', 'color'].forEach(function (p) {
            title.style[p] = h1Style[p];
        });
        place(title, h1Rect);
        // Scaling about the baseline, not the box top, for the reason in
        // baselineOf: it is the line the card and the page agree on.
        title.style.transformOrigin = '0 ' + (h1Baseline - h1Rect.top) + 'px';
        const titleFrom = 'translate(' +
            (stash.title.x - h1Rect.left) + 'px,' +
            (stash.title.baseline - h1Baseline) + 'px) ' +
            'scale(' + (stash.title.size / h1Size) + ')';

        layer.appendChild(media);
        layer.appendChild(title);
        document.body.appendChild(layer);

        // fill: backwards so the start state is in force through the title's
        // delay; nothing needs holding at the end, because the end *is* the
        // element's natural state.
        const opts = { duration: DURATION, easing: EASE, fill: 'backwards' };
        const flights = [
            media.animate([{ transform: mediaFrom }, { transform: 'none' }], opts),
            title.animate([{ transform: titleFrom }, { transform: 'none' }],
                Object.assign({ delay: TITLE_DELAY }, opts)),
        ];

        // The wait is over the moment the box is measured, so the failsafe can
        // come in from "did this page even start" to "did the flight land".
        arm(DURATION + TITLE_DELAY + CROSSFADE + 600);

        Promise.all(flights.map(function (a) { return a.finished; })).then(handOver, handOver);

        function handOver() {
            if (!layer) return;   // the failsafe got there first
            // The real hero and title come back on underneath the stand-ins.
            root.classList.remove('card-transition');
            window.CardTransition.active = false;
            // The title stand-in is now indistinguishable from the <h1> behind
            // it, so it just goes; only the artwork has a difference to hide,
            // and a couple of frames of overlap is all it takes.
            if (title.parentNode) title.parentNode.removeChild(title);
            media.animate([{ opacity: 1 }, { opacity: 0 }],
                { duration: CROSSFADE, easing: 'linear', fill: 'forwards' })
                .finished.then(finish, finish);
        }
    }

    // The card's photo is cropped to roughly 5:4 and the heroes run anything
    // from 4:3 to 16:9, so the two boxes never match. Scaling one onto the
    // other directly would stretch the picture across the whole flight, which
    // does not read as a card opening — it reads as a bug. So the flight uses
    // the largest piece of the card's photo that is *already* the hero's
    // shape, and the scale stays uniform end to end.
    //
    // Shared by both directions on purpose: the way out has to retrace the way
    // in exactly, and two copies of this arithmetic would drift apart.
    function photoStartBox(photo, heroRect) {
        const heroAspect = heroRect.width / heroRect.height;
        const photoAspect = photo.w / photo.h;
        const w = heroAspect > photoAspect ? photo.w : photo.h * heroAspect;
        const h = w / heroAspect;
        return { x: photo.x + (photo.w - w) / 2, y: photo.y + (photo.h - h) / 2, w: w, h: h };
    }

    // ---------------------------------------------------------------- exit
    //
    // Going home is the arrival run backwards: the hero shrinks back into the
    // card's photo well and the title follows it down into the card's title.
    // Both animate to the very transforms the arrival flight starts *from*,
    // which is what makes the two readings of the same motion agree.
    //
    // Nothing is stashed on the way out and the home page is not told anything.
    // It does not need to be: the shrink lands on the card's real box, and the
    // carousel restores the rotation that put the card there, so the cut at the
    // end of the flight arrives on the card the hero just became.

    function readOrigin() {
        let raw = null;
        try { raw = sessionStorage.getItem(ORIGIN_KEY); } catch (err) { return null; }
        if (!raw) return null;
        let o = null;
        try { o = JSON.parse(raw); } catch (err) { return null; }
        if (!o || !o.photo || !o.title) return null;
        // Written for one card. Arriving here by some other route — a
        // next-project card, a typed URL — means the carousel is not showing
        // this project and there is nothing to shrink towards.
        if (o.slug !== slugOf(location.pathname)) return null;
        // Screen coordinates belong to the window they were measured in.
        if (Math.abs(o.vw - window.innerWidth) > 2) return null;
        if (Math.abs(o.vh - window.innerHeight) > 2) return null;
        return o;
    }

    function flyHome(hero, h1, origin, href) {
        const heroRect = hero.getBoundingClientRect();
        const h1Rect = h1.getBoundingClientRect();
        const h1Style = getComputedStyle(h1);
        const h1Size = parseFloat(h1Style.fontSize) || 42;
        const h1Baseline = baselineOf(h1);

        const end = photoStartBox(origin.photo, heroRect);
        const heroTo = 'translate(' +
            (end.x - heroRect.left) + 'px,' + (end.y - heroRect.top) + 'px) ' +
            'scale(' + (end.w / heroRect.width) + ')';
        const titleTo = 'translate(' +
            (origin.title.x - h1Rect.left) + 'px,' +
            (origin.title.baseline - h1Baseline) + 'px) ' +
            'scale(' + (origin.title.size / h1Size) + ')';

        // Everything that is not flying gets out of the way, so the page reads
        // as collapsing back into the card rather than as two elements leaving
        // a page that stayed put.
        root.classList.add('card-exit');
        // Transforms do not affect layout, so the two can shrink straight
        // through whatever they pass over; a stacking context keeps them on top
        // of it while they do.
        hero.style.transformOrigin = '0 0';
        hero.style.position = 'relative';
        hero.style.zIndex = '3';
        // The same baseline the arrival scales about — see baselineOf.
        h1.style.transformOrigin = '0 ' + (h1Baseline - h1Rect.top) + 'px';
        h1.style.position = 'relative';
        h1.style.zIndex = '3';

        const opts = { duration: EXIT_DURATION, easing: EXIT_EASE, fill: 'forwards' };
        // Held at full opacity almost to the end: the flight lands on the
        // card's own box, so the last thing on screen should still be the
        // artwork sitting exactly where the card is about to be. The fade is
        // only there to take the hard edge off the navigation.
        const flights = [
            hero.animate([{ transform: 'none', opacity: 1 },
                          { transform: heroTo, opacity: 1, offset: 0.82 },
                          { transform: heroTo, opacity: 0 }], opts),
            h1.animate([{ transform: 'none', opacity: 1 },
                        { transform: titleTo, opacity: 1, offset: 0.82 },
                        { transform: titleTo, opacity: 0 }],
                       Object.assign({ delay: EXIT_TITLE_DELAY }, opts)),
        ];

        let left = false;
        function go() {
            if (left) return;
            left = true;
            // Tell the home page it is being arrived at rather than opened, so
            // it can fade itself up as the card it is about to show finishes
            // shrinking into place. Without this the flight ends on a cut: the
            // page collapses to the card's box and then the whole carousel
            // appears in one frame, which undoes the continuity the shrink just
            // spent half a second building.
            try { sessionStorage.setItem(RETURN_KEY, String(Date.now())); } catch (err) {}
            window.location.href = href;
        }
        // The navigation is what ends this, so it cannot be allowed to depend
        // on two promises resolving. A page stuck mid-shrink because an
        // animation never finished would be a dead end with no way out of it.
        setTimeout(go, EXIT_DURATION + EXIT_TITLE_DELAY + 260);
        Promise.all(flights.map(function (a) { return a.finished; })).then(go, go);
    }

    function setupExit() {
        document.addEventListener('click', function (e) {
            // Leave every gesture that means "somewhere else" alone: a new tab,
            // a download, a middle click, anything already handled.
            if (e.defaultPrevented || e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const a = e.target && e.target.closest && e.target.closest('a[href]');
            if (!a || (a.target && a.target !== '_self')) return;
            if (!/^index\.html(?:[#?]|$)/.test(a.getAttribute('href') || '')) return;

            const origin = readOrigin();
            if (!origin) return;

            const hero = document.querySelector('.case > :first-child');
            const h1 = document.querySelector('.case-head h1');
            if (!hero || !h1 || hero === document.querySelector('.case-head')) return;

            // The topbar is fixed, so this link is reachable from the foot of a
            // very long page — by which point the hero is thousands of pixels
            // above the fold. Shrinking something nobody can see is just a
            // delay in front of a link, so let it behave like a link.
            const r = hero.getBoundingClientRect();
            if (r.bottom < 40 || r.top > window.innerHeight - 40) return;

            e.preventDefault();
            try {
                flyHome(hero, h1, origin, a.getAttribute('href'));
            } catch (err) {
                window.location.href = a.getAttribute('href');
            }
        }, true);
    }

    document.addEventListener('DOMContentLoaded', function () {
        try {
            const hero = document.querySelector('.case > :first-child');
            const h1 = document.querySelector('.case-head h1');
            // A page whose column opens on the header has no hero to fly to.
            if (!hero || !h1 || hero === document.querySelector('.case-head')) return finish();
            // Everything slow is behind us; from here only the hero's own media
            // is still outstanding.
            arm(HERO_WAIT + DURATION + TITLE_DELAY + CROSSFADE + 600);
            whenHeroHasABox(hero, function (ok) {
                if (!ok) return finish();
                try { play(hero, h1); } catch (err) { finish(); }
            });
        } catch (err) {
            // Anything unforeseen here has to leave a whole page behind, not a
            // half-hidden one. The failsafe would get there eventually; this
            // gets there now.
            finish();
        }
    });
})();
