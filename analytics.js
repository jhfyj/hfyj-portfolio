/* Anonymous product analytics (PostHog), shared by both halves of the site.

   Why a plain classic script rather than an import: index.html is bundled by
   Vite and can read import.meta.env, but the case pages have no build step at
   all and never could. Putting the key in an env var would therefore mean two
   sources of truth — one baked into the bundle, one hand-copied into six static
   pages, free to drift. This file is loaded verbatim by every page instead, so
   the key below is the single place it exists.

   The whole thing is off unless POSTHOG_KEY is filled in. Off means off: no
   script tag, no network request, no console output, and window.Analytics still
   exists with the same shape so callers never need a guard beyond checking that
   the file loaded at all. */

(function () {
    'use strict';

    // ── The one line to fill in ──────────────────────────────────────────────
    // PostHog → Settings → Project → "Project API Key". It is the public
    // phc_… key, safe to commit; it can only write events, never read them.
    // Leave it empty and the site ships with analytics dormant.
    var POSTHOG_KEY = '';

    // Region hosts. US cloud by default — swap both for the eu.i / eu-assets
    // pair if the project lives in the EU region, or for a self-hosted origin.
    var POSTHOG_API_HOST = 'https://us.i.posthog.com';
    var POSTHOG_ASSET_HOST = 'https://us-assets.i.posthog.com';

    // ── When this is allowed to run at all ───────────────────────────────────

    // Dev servers and the headless drivers in pw-driver/ all come through
    // localhost, and none of their traffic is a real visit. Excluding them here
    // rather than in the PostHog UI means test runs make no request in the
    // first place, so nothing to filter out later and nothing to slow them down.
    function isLocal() {
        var h = location.hostname;
        return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' ||
               h === '::1' || h === '' || /\.local$/.test(h);
    }

    // Honoured before loading rather than via respect_dnt, so a reader with the
    // header set never fetches the bundle either.
    function dntSet() {
        return navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
               navigator.msDoNotTrack === '1' || navigator.globalPrivacyControl === true;
    }

    var enabled = !!POSTHOG_KEY && location.protocol !== 'file:' &&
                  !isLocal() && !dntSet();

    // Events asked for before array.js finishes downloading. Bounded, because
    // an unbounded queue behind a CDN that never answers is a leak.
    var queue = enabled ? [] : null;
    var MAX_QUEUED = 20;

    function capture(event, props) {
        if (!enabled) return;
        try {
            if (queue) {
                if (queue.length < MAX_QUEUED) queue.push([event, props]);
            } else if (window.posthog) {
                window.posthog.capture(event, props);
            }
        } catch (err) { /* analytics must never take a page down */ }
    }

    // ── Public surface ───────────────────────────────────────────────────────
    //
    // script.js calls Analytics.projectOpen from openCard. Everything else on
    // the page is reached by delegation below, so no other file needs a hook.

    // "puregym.html" → "puregym", "https://hfyj-art.com/sketchbook" →
    // "sketchbook". A slug, never the full URL: the page path is all the report
    // needs, and it keeps any future query string out of the event.
    function slugFor(url) {
        try {
            var path = new URL(url, location.href).pathname;
            var last = path.split('/').filter(Boolean).pop() || 'index';
            return last.replace(/\.html$/i, '');
        } catch (err) { return 'unknown'; }
    }

    window.Analytics = {
        track: capture,
        projectOpen: function (url, source) {
            if (!url || url === '#') return;
            capture('project_open', { project: slugFor(url), source: source || 'unknown' });
        },
    };

    if (!enabled) return;

    // ── Delegated listeners ──────────────────────────────────────────────────
    //
    // These are attached on both halves of the site; each simply finds nothing
    // to match on pages that lack the control. Attaching them here rather than
    // editing site.js and script.js keeps the toggles' own handlers untouched.

    document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        // Grid cards are ordinary links in index.html. The coming-soon two go
        // nowhere, so a click on them is not a project open.
        var card = t.closest('a.grid-card');
        if (card && !card.hasAttribute('data-coming-soon')) {
            window.Analytics.projectOpen(card.getAttribute('href'), 'grid');
            return;
        }

        // Cards ↔ grid. The button already carrying .active is the view we are
        // on; script.js returns early on those, so they are not toggles.
        var viewBtn = t.closest('.toggle-btn[data-view]');
        if (viewBtn) {
            if (!viewBtn.classList.contains('active')) {
                capture('view_toggle', { view: viewBtn.dataset.view });
            }
            return;
        }

        // Light ↔ dark. Read on the next tick rather than inverting the current
        // value: index.html and the case pages each own their own toggle
        // handler, and this way it does not matter which of the two ran first,
        // or whether either is even present.
        if (t.closest('#theme-toggle')) {
            setTimeout(function () {
                capture('theme_toggle', {
                    theme: document.documentElement.getAttribute('data-theme') || 'light',
                });
            }, 0);
        }
    }, true);

    // ── Load the library ─────────────────────────────────────────────────────
    //
    // async, appended after parse, and nothing above it waits on it — the
    // pre-paint blocks in each <head> have long since run by the time this
    // executes, and a failed or blocked download costs the page nothing.

    var script = document.createElement('script');
    script.src = POSTHOG_ASSET_HOST + '/static/array.js';
    script.async = true;

    // A blocked CDN (ad blocker, offline, outage) is an expected outcome, not an
    // error worth printing. Drop the queue and stop.
    script.onerror = function () { enabled = false; queue = null; };

    script.onload = function () {
        try {
            window.posthog.init(POSTHOG_KEY, {
                api_host: POSTHOG_API_HOST,

                // Anonymous events only. 'never' means PostHog stores no person
                // profile and no person properties for this site at all, so
                // there is nothing for an identity to later attach to. Nothing
                // here calls posthog.identify(), and nothing should: the only
                // email associated with this site is the owner's.
                person_profiles: 'never',

                // Off deliberately: autocapture records every click, input and
                // change on the page, including the contents of form fields.
                // The four events below are the entire question being asked,
                // and they are all sent explicitly.
                autocapture: false,

                // Session replay records the screen. Off.
                disable_session_recording: true,
                disable_surveys: true,

                // Sent by hand in the line below so it carries the same
                // deliberate shape as the rest, and fires exactly once.
                capture_pageview: false,

                // Time-on-page pings. Not part of the question, and they fire
                // on unload where they are least reliable anyway.
                capture_pageleave: false,

                // No feature flags are used, so skip the flag-evaluation
                // round trip on every page load. (Renamed advanced_disable_flags
                // in newer posthog-js; the old name is still read.)
                advanced_disable_decide: true,

                // Web-vitals / resource timing. The load budget is watched by
                // hand here, and this would send a timing profile of every
                // asset on the page.
                capture_performance: false,

                // Belt and braces — dntSet() above already prevented the load.
                respect_dnt: true,
            });

            var pending = queue;
            queue = null;
            window.posthog.capture('$pageview');
            if (pending) {
                for (var i = 0; i < pending.length; i++) {
                    window.posthog.capture(pending[i][0], pending[i][1]);
                }
            }
        } catch (err) {
            enabled = false;
            queue = null;
        }
    };

    document.head.appendChild(script);
})();
