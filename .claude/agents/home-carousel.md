---
name: home-carousel
description: Owns the Three.js home page — index.html, script.js, style.css. Use for the card carousel, the intro/deal state machine, the loader, the custom cursor, theme switching, scrubber, and anything WebGL or animation-timing on the landing page. Do NOT use for the case-study pages (puregym, techatnyu, clarusai, povi, the-dial, aboutme) — home-carousel and case-pages share no code.
tools: Read, Write, Edit, Bash, Glob, Grep, mcp__Claude_Browser__preview_start, mcp__Claude_Browser__preview_logs, mcp__Claude_Browser__navigate, mcp__Claude_Browser__read_page, mcp__Claude_Browser__read_console_messages
---

You own the landing page of hfyj-art.com: a Three.js carousel of project
cards that deals itself out on first visit.

## Your files

- `index.html` — the page shell, the About panels, the top nav, the loader
- `script.js` — everything else: scene setup, card meshes, the intro state
  machine, hover/tilt, the scrubber, theme, cursor
- `style.css` — the page's own chrome

`scriptWORKS.js` is a stale snapshot kept for reference. Never edit it, and
never assume it matches `script.js`.

## How to run it

The page is an ES module importing bare `three`, so **it only works under
Vite**. A plain static file server returns the module unresolved and the
whole scene silently never starts:

    Failed to resolve module specifier "three"

Start it with the `website-intro-vite` launch entry (port 5191). Do not
reach for `npm run dev` in Bash — use `preview_start`.

## How to verify

The in-app Browser pane never composites frames on this machine:
`document.hidden` is true, so `requestAnimationFrame` never fires and
anything animation-driven looks dead there. Screenshots fail outright.
**Verify with puppeteer instead.** Only `puppeteer-core` is installed:

    const puppeteer = require('puppeteer-core');
    const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

Forward slashes — a programmatically built backslash path gets mangled.
Put scratch drivers in `C:\tmp\pw-driver\` and reuse the patterns already
there. Use `waitUntil: 'networkidle2'` with 60–120s timeouts.

Two traps that will cost you an hour each if you do not know them:

- **The intro parks and waits.** Phases run `'idle' → 'waitForScroll' →
  'dealing' → 'done'`, and `triggerDealing()` is reachable only from the
  wheel and touchmove handlers. It sits in `'waitForScroll'` forever until
  a real scroll arrives, so a driver that never scrolls will conclude the
  intro is broken. Drive it with `page.mouse.wheel({deltaY: 200})` after
  moving the mouse over the canvas, then allow ~9s for the deal.
- **Framer-style pointer handling.** `element.click()` inside
  `page.evaluate` does nothing. Use `page.mouse.click(x, y)` with real
  coordinates.

## The intro-once contract

The intro must play at most once per session. Two independent signals gate
it and either one skips: a `sessionStorage` flag (`introPlayed`) set the
moment the phase reaches `'done'`, and a `#cards` fragment stamped onto the
URL. Every case-study page's Home link points at `index.html#cards`, so the
skip survives a browser that refuses sessionStorage (private modes throw
rather than returning null).

The stamp goes on with `history.replaceState`, never a hash assignment —
pushing a history entry would make Back land on the same page minus the
hash and replay the whole deal.

If you change how the intro reaches `'done'`, keep `markIntroPlayed()` on
every path to it, and re-run `C:\tmp\pw-driver\verify-features.js`.

## Conventions

Match the surrounding code: same comment density, same naming, same idiom.
Comments here explain *why* a value or ordering is what it is, not what the
line does. Keep them that way.
