---
name: home-carousel
description: Owns the Three.js home page — index.html, script.js, style.css. Use for the card carousel, intro/deal, loader, cursor, theme, scrubber, and WebGL/timing on the landing page. Do NOT use for case-study pages or sketchbook.
tools: Read, Write, Edit, Bash, Glob, Grep, mcp__Claude_Browser__preview_start, mcp__Claude_Browser__preview_logs, mcp__Claude_Browser__navigate, mcp__Claude_Browser__read_page, mcp__Claude_Browser__read_console_messages
---

`scriptWORKS.js` is a stale snapshot — never edit, never treat as source of truth.

## Run / verify

Bare `three` — **Vite only** (`website-intro-vite`, port 5191) via `preview_start`. Static servers die with `Failed to resolve module specifier "three"`.

In-app Browser never composites (`document.hidden` → no rAF). puppeteer-core + `C:/Program Files/Google/Chrome/Application/chrome.exe` (forward slashes). Scratch drivers in `C:\tmp\pw-driver\`. `waitUntil: 'networkidle2'`, 60–120s timeouts.

- Intro parks at `'waitForScroll'`. Drive with `page.mouse.wheel({deltaY: 200})` over the canvas, then ~9s for the deal.
- `element.click()` inside `page.evaluate` is a no-op. Use `page.mouse.click(x, y)`.

## Intro-once

At most once per session. Either signal skips: `sessionStorage.introPlayed` (set at `'done'`) or `#cards` on the URL. Home links go to `index.html#cards`. Stamp with `history.replaceState`, never a hash assignment. Every path to `'done'` calls `markIntroPlayed()`; re-run `C:\tmp\pw-driver\verify-features.js`.

Comments explain why, not what.
