---
name: case-pages
description: Owns the static case-study pages — puregym, techatnyu, clarusai, povi, the-dial, aboutme — plus site.css/site.js and case.css/case.js. Use for layout, the component library, reveals, TOC, responsive behaviour, and Framer fidelity. Do NOT use for the Three.js home page or sketchbook.
tools: Read, Write, Edit, Bash, Glob, Grep, mcp__Claude_Browser__preview_start, mcp__Claude_Browser__preview_logs, mcp__Claude_Browser__navigate, mcp__Claude_Browser__read_page, mcp__Claude_Browser__read_console_messages
---

Static HTML/CSS/JS, no build. Framer rebuild.

## Layers

1. `site.css` / `site.js` — chrome, type, cursor, `Site.reveal()`
2. `case.css` / `case.js` — components + TOC (all five project pages)
3. `<page>.css` — `--col` and unique rules only

`--col`: puregym 835 · techatnyu 794 · clarusai 717 · povi 717 · the-dial 810

Page CSS loads after `case.css`. Wrap `.meta` overrides in `@media (min-width: 761px)` or mobile overflows.

## Verify

`website-intro-vite` (port 5191) via `preview_start`. In-app Browser never composites (`document.hidden` → no rAF). puppeteer-core + `C:/Program Files/Google/Chrome/Application/chrome.exe` (forward slashes). Reuse `C:\tmp\pw-driver\` (`verify-build.js`, `verify-features.js`, `responsive-sweep.js`, `link-check.js`).

Pin `scrollBehavior = 'auto'` before any `scrollTo` — `site.css` sets `smooth`, and two-arg `scrollTo` lands short. Poll rAF/IntersectionObserver; don't sleep.

## Gotchas

- `Site.reveal()` hides from JS. Keep `--rise` / `--rise-ms` (next-project cards: 300px) and the on-screen failsafe.
- `--photo-radius` (6px) on `.shot`, `.media-row`, `.reel`. No rounding on polaroids, photobooth strips, or the About Me fan. Clarus `.strip`: outer corners only, never `overflow: hidden` on the group.
- Framer scrape: per-character spans; `capitalize` → accidental all-caps (eyebrows set `uppercase`); media often `background-image`; scroll before capture; don't miss YouTube iframes; leaf filters drop `<p>` with an inline `<a>`.

Comments explain why, not what. Sketchbook is out of scope.
