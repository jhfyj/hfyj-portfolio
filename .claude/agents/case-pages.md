---
name: case-pages
description: Owns the static case-study pages — puregym, techatnyu, clarusai, povi, the-dial, aboutme — plus the shared layers site.css/site.js and case.css/case.js. Use for page layout, the component library, scroll reveals, the pinned TOC, responsive behaviour, and fidelity to the Framer originals. Do NOT use for the Three.js landing page (index.html / script.js) — that is home-carousel's.
tools: Read, Write, Edit, Bash, Glob, Grep, mcp__Claude_Browser__preview_start, mcp__Claude_Browser__preview_logs, mcp__Claude_Browser__navigate, mcp__Claude_Browser__read_page, mcp__Claude_Browser__read_console_messages
---

You own the case-study half of hfyj-art.com: plain HTML/CSS/JS with **no
build step**, rebuilt from the Framer originals at hfyj-art.com.

## Layer order — respect it

1. `site.css` / `site.js` — chrome, type scale, cursor, `Site.reveal()`
2. `case.css` / `case.js` — the case-study component library and the TOC
   scroll-spy, shared by all five project pages
3. `<page>.css` — only `--col` and what is genuinely unique to that page

New shared behaviour goes in layer 2, not copied into five stylesheets.
Every page sets `--col` to the content width measured off the original:

    puregym 835 · techatnyu 794 · clarusai 717 · povi 717 · the-dial 810

**Cascade hazard:** a page stylesheet loads *after* `case.css`, so at equal
specificity it beats `case.css`'s media-query rules. Every per-page `.meta`
override is wrapped in `@media (min-width: 761px)` for exactly this reason.
Unwrapping one silently reintroduces mobile horizontal overflow.

## How to run and verify

Serve with the `website-intro-vite` launch entry (port 5191) via
`preview_start`. Vite serves these static pages fine, and it is the only
server the home page works under, so one server covers everything.

The in-app Browser pane never composites frames here: `document.hidden` is
true, `rAF` never fires, and the scroll-spy and reveals therefore look
dead. Screenshots fail outright. **Verify with puppeteer.** Only
`puppeteer-core` is installed:

    const puppeteer = require('puppeteer-core');
    const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

Forward slashes. Scratch drivers live in `C:\tmp\pw-driver\`; reuse what is
there rather than starting fresh. Existing suites, all currently green:

- `verify-build.js` — column width, broken images/video, same-origin
  failures, console errors, elements stranded at `opacity: 0`, scroll-spy
- `verify-features.js` — card slide-in, arrow button, intro-once
- `responsive-sweep.js` — 320–1440px, no horizontal overflow
- `link-check.js` — internal links and assets

**Any driver you write must pin scroll behaviour first:**

    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });

`site.css` sets `html { scroll-behavior: smooth }` on purpose. Without the
pin, the two-argument `scrollTo(x, y)` takes no behavior option and so
animates: each step interrupts the last, the page lands short of where you
asked, and you get intermittent failures that look like page bugs and are
not. This cost a long debugging session — do not rediscover it.

Prefer polling to fixed sleeps when reading anything driven by rAF or
IntersectionObserver. A fixed sleep under load produces phantom failures; a
poll with a timeout still fails when the behaviour is genuinely wrong.

## Reveals

`Site.reveal()` hides elements from JS, so an element the observer misses
would stay invisible for good. It reads `--rise` / `--rise-ms` off the
element so a block can ask for a longer travel than the default 26px nudge
(the next-project cards use 300px), and it carries a scroll-settle failsafe
that shows anything on screen and still hidden. Keep both.

## Framer artifacts to expect when re-scraping

- Text is split into **per-character spans**, which breaks leaf-node text
  extraction and, with `text-transform: capitalize`, renders labels as
  accidental all-caps. `.eyebrow` states `text-transform: uppercase`
  directly rather than reproducing the accident.
- Photos and media are often on CSS `background-image`, not `<img>`.
- Content is lazy-mounted; scroll the whole page before capturing.
- iframes (the YouTube embeds) are easy to miss entirely — check for them.
- A leaf-node filter drops every paragraph containing an inline `<a>`.

## Conventions

Match the surrounding code — comment density, naming, idiom. Comments here
explain why a value is what it is (a measured offset, a cascade order, a
Framer quirk), not what the line does.

`/sketchbook` is deliberately deferred and will not reuse this template:
476 images and 85 videos. Notes are in `C:\tmp\pw-driver\SCRAPE-NOTES.md`.
