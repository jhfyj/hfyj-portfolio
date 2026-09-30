/* Polaroid photo viewer, shared by About Me and the BMW case study.
   Any .polaroid or .strip on the page opens a larger print over a blurred
   page. The markup it needs is the #photo-modal block at the end of <body>.
   Photos added after load (About Me's outside photos) call PhotoViewer.bind. */

(function () {
    'use strict';

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---------------------------------------------------------- photo viewer

    // The photobooth strips and the Sundays polaroids open over a blurred page.
    // The print in there is built fresh on every open and thrown away on close:
    // there is then never a second copy of a photo sitting in the document, and
    // the rise always has a new element to play on.
    const photoModal = document.getElementById('photo-modal');
    const photoStage = document.getElementById('photo-modal-stage');
    const photoPanel = photoModal && photoModal.querySelector('[role="dialog"]');
    let photoOpener = null;
    let photoCard = null;
    let photoTiltTimer = null;
    let photoPointer = { x: 0, y: 0 };

    function photoName(source) {
        return source.getAttribute('aria-label') || source.alt || 'Photo';
    }

    function tiltFromPointer(card) {
        const r = card.getBoundingClientRect();
        if (!r.width || !r.height) return;
        let px = (photoPointer.x - r.left) / r.width - 0.5;
        let py = (photoPointer.y - r.top) / r.height - 0.5;
        px = Math.max(-0.65, Math.min(0.65, px));
        py = Math.max(-0.65, Math.min(0.65, py));
        card.style.setProperty('--tilt-x', (-py * 7).toFixed(2) + 'deg');
        card.style.setProperty('--tilt-y', (px * 9).toFixed(2) + 'deg');
    }

    function openPhoto(source, pointer) {
        if (!photoModal || !photoStage || !source) return;
        if (photoTiltTimer) {
            window.clearTimeout(photoTiltTimer);
            photoTiltTimer = null;
        }
        photoStage.innerHTML = '';
        photoCard = null;
        photoOpener = source;
        if (pointer) {
            photoPointer.x = pointer.clientX;
            photoPointer.y = pointer.clientY;
        }

        const isStrip = source.classList.contains('strip');
        const srcImg = source.tagName === 'IMG' ? source : source.querySelector('img');
        if (!srcImg) return;

        const rise = document.createElement('div');
        rise.className = 'photo-modal-rise';

        const card = document.createElement('div');
        card.className = 'photo-modal-card ' + (isStrip ? 'is-strip' : 'is-polaroid');

        const img = document.createElement('img');
        img.src = srcImg.currentSrc || srcImg.src;
        img.alt = srcImg.alt || photoName(source);
        card.appendChild(img);
        rise.appendChild(card);
        photoStage.appendChild(rise);
        photoCard = card;

        if (photoPanel) photoPanel.setAttribute('aria-label', photoName(source));
        photoModal.removeAttribute('hidden');
        document.body.classList.add('modal-open');
        if (photoPanel) photoPanel.focus();

        if (reduceMotion) return;

        let started = false;
        const beginTilt = function () {
            if (started || photoCard !== card || !document.contains(card)) return;
            started = true;
            card.classList.add('is-tilting');
            tiltFromPointer(card);
        };
        rise.addEventListener('animationend', function (e) {
            if (e.target === rise) beginTilt();
        });
        // animationend is easy to miss if the node is hidden mid-flight, and
        // a print that never leans looks broken rather than reduced. 700ms is
        // a hair past the 620ms rise.
        photoTiltTimer = window.setTimeout(beginTilt, 700);
    }

    function closePhoto() {
        if (!photoModal || photoModal.hasAttribute('hidden')) return;
        if (photoTiltTimer) {
            window.clearTimeout(photoTiltTimer);
            photoTiltTimer = null;
        }
        photoCard = null;
        photoModal.setAttribute('hidden', '');
        document.body.classList.remove('modal-open');
        photoStage.innerHTML = '';
        if (photoOpener && document.contains(photoOpener)) photoOpener.focus();
        photoOpener = null;
    }

    function bindPhoto(el) {
        if (!photoModal) return;
        el.addEventListener('click', function (e) { openPhoto(el, e); });
        el.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            openPhoto(el, null);
        });
    }

    if (photoModal) {
        document.querySelectorAll('.polaroid, .strip').forEach(bindPhoto);

        // Keep the pointer current during the rise so the first lean is toward
        // where the mouse is now, not where the click was 600ms ago.
        photoModal.addEventListener('pointermove', function (e) {
            if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
            photoPointer.x = e.clientX;
            photoPointer.y = e.clientY;
            if (photoCard && photoCard.classList.contains('is-tilting')) tiltFromPointer(photoCard);
        });

        photoModal.addEventListener('click', function (e) {
            if (!photoStage.contains(e.target)) closePhoto();
        });

        document.addEventListener('keydown', function (e) {
            if (photoModal.hasAttribute('hidden')) return;
            if (e.key === 'Escape') { closePhoto(); return; }
            if (e.key !== 'Tab') return;
            // The dialog itself is the only focusable thing in here, so Tab
            // has nowhere to go without walking onto the blurred page.
            e.preventDefault();
            if (photoPanel) photoPanel.focus();
        });
    }

    window.PhotoViewer = { bind: bindPhoto };
})();
