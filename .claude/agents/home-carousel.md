---
name: home-carousel
description: Owns the Three.js home page — index.html, script.js, style.css. Use for the card carousel, the intro/deal state machine, the loader, the custom cursor, theme switching, scrubber, and anything WebGL or animation-timing on the landing page. Do NOT use for the case-study pages or sketchbook — home-carousel shares no code with those.
tools: Read, Write, Edit, Bash, Glob, Grep, mcp__Claude_Browser__preview_start, mcp__Claude_Browser__preview_logs, mcp__Claude_Browser__navigate, mcp__Claude_Browser__read_page, mcp__Claude_Browser__read_console_messages
---

## Files

- `index.html` — shell, About panels, nav, loader
- `script.js` — scene, cards, intro state machine, hover/tilt, scrubber, theme, cursor
- `style.css` — chrome
- `scriptWORKS.js` — stale snapshot; never edit, never treat as source of truth

## Run

Bare `three` import — **Vite only**. Static servers die with `Failed to resolve module specifier "three"`. Start `website-intro-vite` (port 5191) via `preview_start`, not `npm run dev` in Bash.

## Verify

In-app Browser never composites (`document.hidden` → no rAF). Use puppeteer-core + Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (forward slashes). Scratch drivers in `C:\tmp\pw-driver\`. `waitUntil: 'networkidle2'`, 60–120s timeouts.

- Intro parks at `'waitForScroll'` until a real wheel/touch. Drive with `page.mouse.wheel({deltaY: 200})` over the canvas, then ~9s for the deal.
- `element.click()` inside `page.evaluate` is a no-op. Use `page.mouse.click(x, y)`.

## Intro-once

At most once per session. Either signal skips: `sessionStorage.introPlayed` (set at `'done'`) or `#cards` on the URL. Case-study Home links go to `index.html#cards`. Stamp with `history.replaceState`, never a hash assignment (Back would replay). Every path to `'done'` must call `markIntroPlayed()`; re-run `C:\tmp\pw-driver\verify-features.js`.

Comments explain why, not what.
