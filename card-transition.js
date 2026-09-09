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
    // The trip back to the top is driven here rather than handed to the browser's
    // own smooth scrolling, because that scales its duration with the distance:
    // eight thousand pixels of clarusai took 1.3s, and with the flight behind it
    // that is two seconds between pressing Home and anything happening. Which
    // reads as a page that did not respond. A fixed budget with a gentle floor
    // keeps a short trip from feeling abrupt and a long one from feeling broken;
    // the far end of the page costs about half a second either way.
    const SCROLL_HOME_MIN_MS = 260;
    const SCROLL_HOME_MAX_MS = 620;
    // This was the mirror of EASE, on the reasoning that reflecting the
    // arrival's curve through the diagonal makes the two directions the same
    // motion run each way. Mathematically true, and wrong to watch: mirroring
    // an ease-out gives an ease-in, so the artwork was travelling at its
    // fastest at the instant it reached the card and then vanishing — which
    // reads as shrinking away to nothing rather than settling into place.
    // Both directions decelerate into their destination now, because in both
    // of them the end is an arrival.
    const EXIT_EASE = 'cubic-bezier(.22, .61, .36, 1)';
    const CROSSFADE = 200;
    // The card's photo well is drawn with 24px corners inside a 1016.663px
    // well (tmplPhotoClipPath in script.js), so the radius the flight has to
    // arrive at is that fraction of however wide the well is on screen.
    const WELL_RADIUS = 24 / 1016.663;
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

    function place(el, b) {
        el.style.left = b.x + 'px';
        el.style.top = b.y + 'px';
        el.style.width = b.w + 'px';
        el.style.height = b.h + 'px';
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

        // The stand-in is laid out at the *well's* shape, blown up until it
        // covers the hero. That way its background is never cropped by its own
        // box — only ever by the window, which is the thing that moves.
        const well = stash.photo;
        const box = coverBoxOfAspect(boxOf(heroRect), well.w / well.h);
        place(media, box);

        // FLIP, with a window. The div already sits at its final box, so the
        // animation only has to undo the difference and play it out —
        // transform, clip and opacity, never the box itself, which would
        // relayout on every frame.
        //
        // Two ends, both exact. `shut` is the card: the whole well image at
        // the well's size and position, to the pixel. `open` is this page: the
        // hero's box, showing the part of the picture the hero shows. In
        // between, one uniform scale and a window widening from one shape to
        // the other — so nothing is ever stretched, and nothing undershoots.
        const shut = coverFlight(box, well);
        const open = coverFlight(box, boxOf(heroRect));
        const mediaFrom = {
            transform: 'translate(' + shut.tx + 'px,' + shut.ty + 'px) scale(' + shut.s + ')',
            clipPath: insetOf(shut, WELL_RADIUS * well.w / shut.s),
        };
        const mediaTo = {
            transform: 'translate(' + open.tx + 'px,' + open.ty + 'px) scale(' + open.s + ')',
            clipPath: insetOf(open, cornerOf(hero) / open.s),
        };
        // The animation does not fill forwards, so the resting state has to be
        // the landing: the window stays where the flight left it.
        media.style.clipPath = mediaTo.clipPath;

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
            media.animate([mediaFrom, mediaTo], opts),
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

    // The card's photo well is cropped to roughly 5:4 and the heroes run
    // anything from 1:1 to 16:9, so the two boxes are never the same shape.
    // Two ways of dealing with that are wrong. Scaling one box onto the other
    // stretches the picture through the whole flight. Shrinking to the biggest
    // piece of the well that is already the hero's shape — which is what this
    // used to do — keeps the picture honest but lands *inside* the well: a
    // 16:9 hero came to rest 358×193 where the card's photo is 358×287, so
    // the artwork visibly undershot the card it was returning to.
    //
    // What actually happens on a card is that the photo is a crop of the
    // picture. So the flight is one picture, scaled uniformly end to end, seen
    // through a window that opens from the card's crop to the hero's full box.
    // The scale never distorts and both ends land exactly.
    //
    // Given a box and the window it has to fill, this is the uniform scale
    // that makes the box cover the window, the offset that centres it there,
    // and the inset that trims off what spills out — the clip, in the box's
    // own untransformed coordinates, which is where clip-path is applied.
    //
    // Shared by both directions on purpose: the way out has to retrace the way
    // in exactly, and two copies of this arithmetic would drift apart.
    function coverFlight(box, win) {
        const s = Math.max(win.w / box.w, win.h / box.h);
        return {
            s: s,
            tx: win.x + win.w / 2 - box.w * s / 2 - box.x,
            ty: win.y + win.h / 2 - box.h * s / 2 - box.y,
            insetX: Math.max(0, (box.w - win.w / s) / 2),
            insetY: Math.max(0, (box.h - win.h / s) / 2),
        };
    }

    // The smallest box of the given shape that covers `rect`, centred on it.
    function coverBoxOfAspect(rect, aspect) {
        const w = Math.max(rect.w, rect.h * aspect);
        const h = w / aspect;
        return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w: w, h: h };
    }

    function insetOf(fit, radius) {
        return 'inset(' + fit.insetY + 'px ' + fit.insetX + 'px round ' + radius + 'px)';
    }

    function boxOf(r) { return { x: r.left, y: r.top, w: r.width, h: r.height }; }

    function cornerOf(el) {
        return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
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

    // Is the previous history entry the home page? There is no API that
    // answers this, so it is triangulated from two things that together leave
    // no room for doubt:
    //
    //   - this page was *navigated* to, not reached with back or forward. That
    //     rules out home → A → B → back → A, where the entry behind A is B and
    //     going back would land on the wrong page entirely.
    //   - and the page that linked here was home.
    //
    // Both true, and the entry behind this one is the home page. Either false
    // and we simply navigate, which is what used to happen anyway.
    function homeIsBack() {
        try {
            if (history.length < 2) return false;
            const nav = performance.getEntriesByType('navigation')[0];
            if (!nav || nav.type !== 'navigate') return false;
            if (!document.referrer) return false;
            const r = new URL(document.referrer);
            if (r.origin !== location.origin) return false;
            return /(^|\/)index\.html$/.test(r.pathname) || /\/$/.test(r.pathname);
        } catch (err) {
            return false;
        }
    }

    function flyHome(hero, h1, origin, href) {
        const heroRect = hero.getBoundingClientRect();
        const h1Rect = h1.getBoundingClientRect();
        const h1Style = getComputedStyle(h1);
        const h1Size = parseFloat(h1Style.fontSize) || 42;
        const h1Baseline = baselineOf(h1);

        // The mirror of the arrival. The hero is the whole picture and the
        // card's photo well is a crop of it, so the hero scales down uniformly
        // until it covers the well and the window closes onto the well's exact
        // box — same size, same place, same crop as the card that is about to
        // be underneath it. Fitting the hero *inside* the well instead, as
        // this used to, left a 16:9 hero at 358×193 against a 358×287 photo:
        // recognisably the right picture arriving at the wrong size.
        const well = origin.photo;
        const land = coverFlight(boxOf(heroRect), well);
        const heroTo = 'translate(' + land.tx + 'px,' + land.ty + 'px) scale(' + land.s + ')';
        const heroClipFrom = insetOf({ insetX: 0, insetY: 0 }, cornerOf(hero));
        const heroClipTo = insetOf(land, WELL_RADIUS * well.w / land.s);
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
        // Fully opaque the whole way, and still opaque when the navigation
        // happens. These two used to fade out over the last fifth of the
        // flight, which put the fade on top of the fastest part of the old
        // ease-in: the artwork reached the card and disappeared in the same
        // few frames. It lands on the card's own box, so there is nothing to
        // hide — the picture is already exactly where the card is about to
        // draw it, and the home page fading up behind covers the swap.
        const flights = [
            hero.animate([{ transform: 'none', clipPath: heroClipFrom },
                          { transform: heroTo, clipPath: heroClipTo }], opts),
            h1.animate([{ transform: 'none' }, { transform: titleTo }],
                       Object.assign({ delay: EXIT_TITLE_DELAY }, opts)),
        ];

        let left = false;
        function go() {
            if (left) return;
            left = true;
            // Going back rather than forward, when back is genuinely where home
            // is. A fresh navigation rebuilds the whole carousel — nine card
            // faces drawn to canvas, their textures uploaded, the scene set up
            // again — which is a second of work to arrive at a page the browser
            // may still be holding intact. history.back() lets it restore that
            // page instead, and the shrink runs straight into a carousel that
            // never went away.
            //
            // Falls through to an ordinary navigation whenever the page is not
            // eligible, so this costs nothing when it does not apply.
            //
            // The note goes down first either way. It tells the home page it
            // is being arrived at rather than opened, so it can bring itself
            // in around the card the artwork has just landed on instead of
            // appearing in one frame. A restored page reads it from its
            // pageshow handler and a freshly loaded one from its <head>; it
            // used to be written only on the second path, so the restore — the
            // common case, and the one that looks most like a reload without
            // it — arrived as a hard cut.
            try { sessionStorage.setItem(RETURN_KEY, String(Date.now())); } catch (err) {}
            if (homeIsBack()) {
                history.back();
                return;
            }
            window.location.href = href;
        }
        // The navigation is what ends this, so it cannot be allowed to depend
        // on two promises resolving. A page stuck mid-shrink because an
        // animation never finished would be a dead end with no way out of it.
        setTimeout(go, EXIT_DURATION + EXIT_TITLE_DELAY + 260);
        Promise.all(flights.map(function (a) { return a.finished; })).then(go, go);
    }

    // Back to the top, then hand over. flyHome measures where the hero is at
    // the moment it runs, so it cannot start until the scrolling has actually
    // stopped — starting early would fly from a position the page is no longer
    // in. Hence waiting on the scroll position itself rather than on a fixed
    // delay: a smooth scroll's duration is the browser's to decide and varies
    // with the distance.
    function scrollHomeThen(done) {
        const y0 = window.scrollY || window.pageYOffset || 0;
        const reduce = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (y0 <= 1 || reduce) { window.scrollTo(0, 0); return requestAnimationFrame(done); }

        // site.css sets scroll-behavior: smooth on <html>, which would make the
        // browser animate towards every position this sets — an animation
        // chasing an animation, and far slower than either. Off for the trip,
        // back on at the end.
        const root = document.documentElement;
        const prior = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';

        const ms = Math.min(SCROLL_HOME_MAX_MS,
                            Math.max(SCROLL_HOME_MIN_MS, SCROLL_HOME_MIN_MS + y0 * 0.03));
        const t0 = (window.performance && performance.now()) ? performance.now() : Date.now();

        (function step() {
            const now = (window.performance && performance.now()) ? performance.now() : Date.now();
            const k = Math.min(1, (now - t0) / ms);
            // Decelerating, so it arrives rather than stops — the same shape the
            // flight that follows it uses, which is what lets the two read as
            // one movement instead of a scroll and then an animation.
            const e = 1 - Math.pow(1 - k, 3);
            window.scrollTo(0, Math.round(y0 * (1 - e)));
            if (k < 1) return requestAnimationFrame(step);
            root.style.scrollBehavior = prior;
            requestAnimationFrame(done);
        })();
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

            const href = a.getAttribute('href');
            e.preventDefault();

            // The topbar is fixed, so this link is reachable from the foot of a
            // very long page — by which point the hero is thousands of pixels
            // above the fold. Rather than skip the flight, go and get it: the
            // page returns to the top and *then* the hero folds into the card,
            // so leaving reads as one gesture wherever it was started from.
            const r = hero.getBoundingClientRect();
            const visible = r.bottom > 40 && r.top < window.innerHeight - 40;

            function fly() {
                try {
                    flyHome(hero, h1, origin, href);
                } catch (err) {
                    window.location.href = href;
                }
            }

            if (visible) { fly(); return; }
            scrollHomeThen(fly);
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
