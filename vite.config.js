import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync } from 'node:fs';

// Every page the site actually serves, listed by hand.
//
// Vite builds index.html and nothing else unless told otherwise, which is
// invisible in dev — the dev server serves whatever is asked for — and silently
// wrong in a build: the six case pages would simply not be emitted, and every
// project on the deployed site would 404.
const PAGES = {
    index: 'index.html',
    aboutme: 'aboutme.html',
    clarusai: 'clarusai.html',
    povi: 'povi.html',
    puregym: 'puregym.html',
    techatnyu: 'techatnyu.html',
    thedial: 'the-dial.html',
    sketchbook: 'sketchbook.html',
};

// The case pages load their JavaScript as classic scripts — no type="module",
// no imports, nothing to bundle — and that is on purpose: they are plain HTML
// that works from any static server, and the day they need a build to run is
// the day they stop being that. Vite honours it by leaving the tags alone, but
// it also means it never emits the files, so the built pages would come up with
// their <script src> pointing at nothing.
//
// So they are copied through verbatim, which is exactly what the pages expect.
// Not `public/`: that would mean a second copy of each file living in the repo
// beside the real one, and the two drifting is a matter of time.
const CLASSIC_SCRIPTS = [
    'aboutme.js',
    'analytics.js',
    'card-transition.js',
    'case.js',
    'footer-deck.js',
    'site.js',
    'sketchbook.js',
    'skeleton.js',
];

// Asset trees whose URLs are built at runtime rather than written in the HTML:
// the card photos script.js walks through on hover, the fan of photos on the
// About Me page, the carousel's mark, both favicons — which the pre-paint theme
// block in every <head> assigns by hand, overwriting whatever the build put
// there — and the sketchbook, which is a manifest fetched at runtime and a
// directory of works whose paths only ever exist inside it. A bundler can only
// rewrite the references it can see, so none of these survive on their own;
// they are copied through at their real paths so the strings in the JavaScript
// keep meaning what they say.
const RUNTIME_ASSET_DIRS = ['assets', 'Cards'];

function copyStaticFiles() {
    return {
        name: 'copy-static-files',
        // After the bundle is written, so nothing here can be overwritten by it.
        closeBundle() {
            for (const f of CLASSIC_SCRIPTS) {
                copyFileSync(resolve(__dirname, f), resolve(__dirname, 'dist', f));
            }
            for (const d of RUNTIME_ASSET_DIRS) {
                cpSync(resolve(__dirname, d), resolve(__dirname, 'dist', d), { recursive: true });
            }
        },
    };
}

export default defineConfig({
    appType: 'mpa',
    plugins: [copyStaticFiles()],
    build: {
        rollupOptions: {
            input: Object.fromEntries(
                Object.entries(PAGES).map(([name, file]) => [name, resolve(__dirname, file)]),
            ),
        },
    },
});
