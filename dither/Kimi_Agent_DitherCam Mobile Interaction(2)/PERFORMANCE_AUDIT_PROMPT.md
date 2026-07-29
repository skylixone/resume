# Standalone Performance Audit — di_ther Landing Page

You are a senior web-performance engineer. Audit the landing page at `/mnt/agents/output/app`
(serve it locally, e.g. `python3 -m http.server`) for **frame-rate and scroll-jank issues**.
Do not redesign anything visually — the look is final. Your job is to find, prove, and fix
the remaining performance problems, and to report with measured evidence.

---

## 1. Context

Static site, no build step: `index.html`, `styles.css`, `app.js`, `assets/` (13 WebP gallery
images + 1 JPG hero). External deps: GSAP 3.12 + ScrollTrigger (cdnjs), Google Fonts
(Archivo Black, VT323).

Runtime architecture (relevant for the audit):

- **Hero**: full-viewport `<img>` (object-fit: cover) + full-viewport FX canvas on top.
  The FX canvas backing store is **low-res** (`viewport / PIXEL_SIZE`, currently 5) and is
  written once per frame via `putImageData` (analytic sun + Bayer dither, `HeroFX` class);
  CSS `image-rendering: pixelated` upscales it. One shared `requestAnimationFrame` tick.
- **Playground** (`PlasmaStage` + `DitherStage`): same pattern — analytic luminance →
  Bayer dither → `putImageData` into a 300×169 backing store, CSS-upscaled. Runs only when
  in viewport (IntersectionObserver, threshold 0.05).
- **Fixed layers**: `.scanlines` (repeating-linear-gradient, full viewport, `will-change: transform`),
  `.vignette` (radial-gradient, same), `.hud` header, `#cursor` (rAF-driven custom cursor, desktop only).
- **GSAP**: boot-sequence intro timeline, scroll-triggered reveals on most sections,
  a scrubbed parallax on `.hero-content`, a velocity-reactive marquee (`timeScale`),
  counters, and a repeating transform "glitch" on the hero title.
- **Gallery**: 13 images in CSS multi-column masonry, `content-visibility: auto` +
  `contain-intrinsic-size` per item, `loading="lazy" decoding="async"`, no transforms on hover.

## 2. Known symptoms (user-reported, treat as the backlog)

| # | Symptom | Browser | Where |
|---|---------|---------|-------|
| S1 | ~13–17 FPS while scrolling | Chromium | gallery section |
| S2 | "Slow as ass" scrolling overall | Safari (macOS) | everything below the hero |
| S3 | ~17 FPS fullscreen (15" MBP, Retina DPR 2) | Firefox | hero (historical; re-verify) |
| S4 | Hero is fine | Safari | hero (control case — good) |

Historical context (already fixed, don't re-flag): per-frame `getImageData` readbacks,
per-frame `createImageData` allocations, animated `text-shadow`, full-screen
`mix-blend-mode` layers, CPU-upscaled `drawImage` per frame, hover `scale()` on gallery
images, `will-change` on all reveal targets, snow particle loop (now off via `SNOW_ON: false`).

## 3. Test matrix

- Browsers: **Safari** (current macOS), **Firefox**, **Chromium** — all three, since symptoms differ.
- Viewports: 1440×900 @ DPR 2 (15" MBP fullscreen), 1920×1080 @ DPR 1, 390×844 mobile.
- Throttling: none (native M-class Mac) + 4× CPU throttle to approximate weaker hardware.
- Tools: Chrome DevTools Performance trace + Layers panel + Paint Flashing + FPS meter,
  Safari Web Inspector Timelines & compositing borders, Firefox Profiler, and in-page
  `PerformanceObserver` for `longtask` entries. Automate reproduction with Playwright
  (steady scroll at fixed velocity through every section, 10 s per section, 3 runs).

## 4. Method — in this order

1. **Baseline**: record per-section FPS, long tasks (>50 ms), and a full performance trace
   for every browser × viewport cell. No guessing before this step is complete.
2. **Ablation pass** (toggle one at a time, re-measure S1/S2 after each):
   a. hide `.scanlines` and `.vignette`
   b. disable GSAP entirely (guard `initScrollFX`, skip boot tween)
   c. stop the marquee animation
   d. pause both canvas stages
   e. remove the fixed `.hud` blend/shadow styling
   f. replace gallery images with 1×1 placeholders (same count)
   g. disable `content-visibility` (to check it's actually helping)
3. **Hypotheses to confirm or kill** (ranked by prior belief):
   - H1. Fixed full-viewport gradient layers + `will-change: transform` force expensive
     compositing/repaint at DPR 2, especially in Safari over animated canvas.
   - H2. Continuous marquee transform on very wide text layers keeps a huge layer dirty.
   - H3. GSAP scrubbed parallax + stacked text-shadow on 200–300 px display type repaints
     large areas during scroll.
   - H4. Masonry (`columns`) + `content-visibility` causes layout work / raster storms as
     items pop in; missing explicit image dimensions amplify it (no aspect-ratio reserved).
   - H5. `putImageData` per frame on a full-viewport element (even low-res) plus
     `pixelated` upscale is costly in Safari/Firefox compositing; consider rendering the
     FX canvas at fractional CSS size anchored to a corner, or dropping to 30 FPS.
   - H6. VT323 at small sizes triggers slow glyph raster in some engines (measure before acting).
4. **Fix, then prove**: implement fixes behind the smallest possible diffs; re-run the exact
   baseline protocol; report before/after numbers per fix, not per batch.

## 5. Fix palette (allowed moves — pick what the evidence supports)

- Replace gradient overlays with pre-rendered PNG tiles or `transform: translateZ(0)` layers;
  drop `will-change` where not needed.
- Pause the marquee off-screen; convert it to a Web Animation with `composite: transform`.
- Reserve gallery item boxes (explicit `aspect-ratio` from real image dimensions) to kill
  layout shifts; consider `contain: layout paint style` on sections.
- Throttle dither stages to 30 FPS under `prefers-reduced-motion` OR when frame budget is
  exceeded (adaptive quality: raise `PIXEL_SIZE`, skip alternate frames).
- Move dither math to a Worker + OffscreenCanvas if main-thread long tasks persist.
- Lazy-initialize ScrollTriggers below the fold; use `ScrollTrigger.batch` for gallery items.

## 6. Deliverable

A single report containing:

1. **Baseline table** — browser × viewport × section: median FPS, p95 frame time, long-task count.
2. **Findings** — ranked by measured impact; each with: symptom ID, root cause, the trace
   evidence (attach screenshots/timings), the fix applied, before/after numbers, confidence.
3. **Patches** — minimal diffs per fix, each independently revertable.
4. **Residuals** — anything you could not fix without visual change, with options and trade-offs.

**Acceptance criteria**: sustained ≥55 FPS while scrolling every section on Safari + Firefox +
Chromium at 1440×900 @ DPR 2; zero long tasks >100 ms after boot; no visual regressions
(side-by-side screenshots of every section before/after).
