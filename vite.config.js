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
    // PureGym: the redesign (puregym-test.html) IS the PureGym page now. It is
    // built under its own name and served as puregym.html (PUREGYM_LIVE below);
    // the old puregym.html stays in the repo, unbuilt.
    puregymtest: 'puregym-test.html',
    techatnyu: 'techatnyu.html',
    thedial: 'the-dial.html',
    bmw: 'bmw.html',
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
    'grid-table.js',
    'photo-viewer.js',
    'puregym-test.js',
    'site.js',
    'sketchbook.js',
    'skeleton.js',
];

// The same, and for the same reason, for the stylesheets of those pages. Each
// <link> is marked vite-ignore so the build leaves it exactly as written, and
// the files are copied through beside the scripts.
//
// Letting Vite bundle them cost the one thing a stylesheet's place in <head> is
// for: the cascade. It hoisted each page's own file (aboutme.css, case.css's
// per-page partners) above the shared ones it had split into chunks of their
// own, so every page override of site.css or photo-viewer.css lost on the live
// site and won in dev. About Me's hover print, for one, fell back to
// .polaroid's position: relative and stood in the grid as an invisible row.
const CLASSIC_STYLES = [
    'aboutme.css',
    'bmw.css',
    'case.css',
    'clarusai.css',
    'dice.css',
    'photo-viewer.css',
    'povi.css',
    'puregym.css',
    'puregym-test.css',
    'site.css',
    'skeleton.css',
    'sketchbook.css',
    'techatnyu.css',
    'the-dial.css',
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
// fonts/ joins them now that site.css is copied rather than bundled: its
// @font-face urls are plain relative paths again.
const RUNTIME_ASSET_DIRS = ['assets', 'Cards', 'Company logo', 'fonts'];

// The PureGym redesign is the real PureGym page: every link on the site points
// at puregym.html, so that address serves the redesign, in dev and in the build.
const PUREGYM_LIVE = { from: 'puregym-test.html', to: 'puregym.html' };

function copyStaticFiles() {
    return {
        name: 'copy-static-files',
        configureServer(server) {
            server.middlewares.use((req, res, next) => {
                if (/^\/puregym(\.html)?(?=[?#]|$)/.test(req.url)) {
                    req.url = req.url.replace(/^\/puregym(\.html)?/, '/' + PUREGYM_LIVE.from);
                }
                next();
            });
            server.middlewares.use('/' + OUTSIDE_LIST, (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(outsidePhotos()));
            });
        },
        // After the bundle is written, so nothing here can be overwritten by it.
        closeBundle() {
            for (const f of [...CLASSIC_SCRIPTS, ...CLASSIC_STYLES]) {
                copyFileSync(resolve(__dirname, f), resolve(__dirname, 'dist', f));
            }
            for (const d of RUNTIME_ASSET_DIRS) {
                cpSync(resolve(__dirname, d), resolve(__dirname, 'dist', d), { recursive: true });
            }
            writeFileSync(resolve(__dirname, 'dist', OUTSIDE_LIST), JSON.stringify(outsidePhotos()));
            copyFileSync(resolve(__dirname, 'dist', PUREGYM_LIVE.from), resolve(__dirname, 'dist', PUREGYM_LIVE.to));
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
