---
name: case-pages
description: Owns the static case-study pages — puregym, techatnyu, clarusai, povi, the-dial, aboutme — plus the shared layers site.css/site.js and case.css/case.js. Use for page layout, the component library, scroll reveals, the pinned TOC, responsive behaviour, and fidelity to the Framer originals. Do NOT use for the Three.js landing page (index.html / script.js) or for sketchbook.
tools: Read, Write, Edit, Bash, Glob, Grep, mcp__Claude_Browser__preview_start, mcp__Claude_Browser__preview_logs, mcp__Claude_Browser__navigate, mcp__Claude_Browser__read_page, mcp__Claude_Browser__read_console_messages
---

Static HTML/CSS/JS, no build step. Rebuilt from the Framer originals.

## Layers — respect them

1. `site.css` / `site.js` — chrome, type, cursor, `Site.reveal()`
2. `case.css` / `case.js` — component library + TOC scroll-spy (all five project pages)
3. `<page>.css` — `--col` and genuinely unique rules only

`--col`: puregym 835 · techatnyu 794 · clarusai 717 · povi 717 · the-dial 810

Page CSS loads after `case.css`, so equal-specificity rules beat `case.css` media queries. Wrap `.meta` overrides in `@media (min-width: 761px)` or mobile overflows.

## Verify

Serve via `website-intro-vite` (port 5191) with `preview_start`. The in-app Browser never composites (`document.hidden` → no rAF); use puppeteer-core:

    const puppeteer = require('puppeteer-core');
    const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

Forward slashes. Reuse `C:\tmp\pw-driver\` (`verify-build.js`, `verify-features.js`, `responsive-sweep.js`, `link-check.js`).

Pin scroll before any `scrollTo`: `document.documentElement.style.scrollBehavior = 'auto'`. Unpinned two-arg `scrollTo` animates (`html { scroll-behavior: smooth }`) and lands short. Poll rAF/IntersectionObserver; don't sleep.

## Reveals

`Site.reveal()` hides from JS — missed elements stay invisible. Reads `--rise` / `--rise-ms` (next-project cards: 300px). Keep the on-screen failsafe.

## Photo corners

`--photo-radius` (6px) on `.shot`, `.media-row`, `.reel`. Do not round polaroids, photobooth strips, or the About Me fan. Clarus `.strip`: outer corners only; never `overflow: hidden` on the group.

## Framer scrape traps

Per-character spans; `capitalize` + that split → accidental all-caps (eyebrows set `uppercase` directly). Media often `background-image`. Lazy-mount — scroll before capture. Don't miss YouTube iframes. Leaf-node filters drop paragraphs that contain an inline `<a>`.

Comments explain why (measured offset, cascade, Framer quirk), not what. Sketchbook is out of scope; notes in `C:\tmp\pw-driver\SCRAPE-NOTES.md`.
