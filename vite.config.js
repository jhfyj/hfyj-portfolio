import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { copyFileSync, cpSync, readdirSync, writeFileSync, existsSync } from 'node:fs';

// The About page's "outside of design" photos: drop images into this folder
// and they show up. A static page cannot list a directory, so the list is
// written here - into dist at build, and answered live by the dev server.
const OUTSIDE_DIR = 'assets/about/outside';
const OUTSIDE_LIST = OUTSIDE_DIR + '/photos.json';
function outsidePhotos() {
    const dir = resolve(__dirname, OUTSIDE_DIR);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f) && !f.startsWith('.'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

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
    playground: 'playground.html',
    // The page's old address, kept so existing links still land on the table.
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
    'dice.js',
    'felt.js',
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
const RUNTIME_ASSET_DIRS = ['assets', 'Cards', 'Company logo'];

function copyStaticFiles() {
    return {
        name: 'copy-static-files',
        configureServer(server) {
            server.middlewares.use('/' + OUTSIDE_LIST, (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(outsidePhotos()));
            });
        },
        // After the bundle is written, so nothing here can be overwritten by it.
        closeBundle() {
            for (const f of CLASSIC_SCRIPTS) {
                copyFileSync(resolve(__dirname, f), resolve(__dirname, 'dist', f));
            }
            for (const d of RUNTIME_ASSET_DIRS) {
                cpSync(resolve(__dirname, d), resolve(__dirname, 'dist', d), { recursive: true });
            }
            writeFileSync(resolve(__dirname, 'dist', OUTSIDE_LIST), JSON.stringify(outsidePhotos()));
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
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules/three')) return 'three';
                },
            },
        },
    },
});
