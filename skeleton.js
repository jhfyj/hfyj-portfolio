/* Ends the loading shimmer on each image as it arrives.
   ---------------------------------------------------------------------------
   Classic script, no imports, no dependencies — the same shape as site.js and
   card-transition.js, so it works on the static case pages and on the bundled
   home page alike.

   The shimmer is on by default: skeleton.css paints it for any img[data-skel],
   and the attribute is written into the markup. That ordering matters. Doing it
   the other way round — JavaScript adding the attribute once it runs — means
   every image is a blank box for as long as it takes this file to be fetched
   and executed, which is the exact window the shimmer exists to cover.

   So this file has one job: take the attribute off. */
(function () {
    'use strict';

    function settle(img) {
        img.removeAttribute('data-skel');
    }

    function track(img) {
        // Already decoded — served from cache, or simply quick. There was never
        // a gap to fill, and leaving the attribute on would shimmer underneath
        // an image that is already on screen.
        if (img.complete && img.naturalWidth > 0) { settle(img); return; }
        // 'error' as well as 'load': a broken image never fires 'load', and a
        // box shimmering forever reads as a page that is still working rather
        // than one that has finished with a hole in it. The alt text takes
        // over, which is the honest outcome.
        img.addEventListener('load', function () { settle(img); }, { once: true });
        img.addEventListener('error', function () { settle(img); }, { once: true });
    }

    function scan(root) {
        var imgs = (root || document).querySelectorAll('img[data-skel]');
        for (var i = 0; i < imgs.length; i++) track(imgs[i]);
    }

    scan(document);

    // Anything parsed after this script runs — it sits in <head> on the case
    // pages, so on a slow connection most of the document is still to come.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { scan(document); });
    }

    // The About Me page builds its photo fan at runtime, and the home page's
    // grid view is assembled by script.js, so images appear in the DOM well
    // after DOMContentLoaded. Watching costs nothing next to that.
    if (typeof MutationObserver === 'function') {
        new MutationObserver(function (records) {
            for (var i = 0; i < records.length; i++) {
                var added = records[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    var n = added[j];
                    if (n.nodeType !== 1) continue;
                    if (n.tagName === 'IMG' && n.hasAttribute('data-skel')) track(n);
                    else if (n.querySelectorAll) scan(n);
                }
            }
        }).observe(document.documentElement, { childList: true, subtree: true });
    }
})();
