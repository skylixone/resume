# di_ther changelog

> **Commit protocol**: Always update this changelog and the timestamp in `index.html` (line 38) before pushing. Format: `Mon DD, HHMM`

## Jul 18, 1800
- Rewrote lens switching: uses zoom constraint on the video track where available (iOS, Samsung)
- Fallback: tracks can switch lenses instantly via `track.applyConstraints({ advanced: [{ zoom }] })` without restarting stream
- Zoom-derived lens detection: when `enumerateDevices` reports <2 back cams but track supports zoom, populates lenses from capabilities
- Each lens now stores a `zoom` value (0.5, 1.0, 2.0) for direct track-level optical switching

## Jul 18, 1500
- Landscape layout polish: drop-ups repositioned above toolbar, safe-area inset support added, exposure overlay avoids shutter in landscape
- Added `env(safe-area-inset-bottom)` fallback padding on toolbar

## Jul 18, 1430
- Added back-lens switching (0.5× / 1× / 2×) for multi-camera phones
- Lens button appears only when multiple back cameras are detected
- Falls back to default camera if selected lens is unavailable

## Feb 09, 0230
- All sections left-aligned with consistent 6vw left margin
- Palette grid: full viewport width (removed max-width constraint)
- Divider, footer left-aligned to match

## Feb 09, 0200
- Hero: left-aligned layout, content pushed to bottom-left
- Tagline: 1.618× vertical spacing between items
- Gallery captions: moved below images, two-line format (palette name + bit depth details)
- Frame restructure: image wrapped in border container, caption outside

## Feb 09, 0130
- Palette cards: swatches-first layout, bit depth labels (replaces color count)
- Pipeline: equal-width boxes on mobile
- Hero tagline: one item per line with sequential type-in animation
- Gallery labels: bit depth + color count factoids per image
- Palettes: 2× size on desktop (40px swatches), full-width on mobile

## Feb 09, 0100
- Landing page v2: Geist Mono, 2× font sizes, boosted contrast, type-reveal section labels
- Palette cards: grid layout with names, descriptions, color counts, and swatches
- Massive terminal CTA at page bottom, fixed top-right CTA on scroll
- Hero reduced to 55vh so gallery peeks below fold

## Feb 08, 1400
- VGA hue-select: horizontal swipe sweeps a color spotlight across the spectrum, desaturating out-of-range colors
- Tap-to-pick: tap viewfinder to sample scene color as hue center, then fine-tune ±90° with swipe
- Visual feedback: colored ring at tap point with fade-out animation
- Switching away from VGA resets picked hue

## Feb 07, 1915
- Gallery preview: tap opens full-screen view instead of downloading
- Share button: invokes iOS system share sheet (Web Share API)
- Save button-dropdown: tap saves, dropdown offers 1×/2×/4× nearest-neighbor scaling
- X button to close preview
- Fix: shutter no longer auto-downloads (was causing iOS save dialog + button disappearing)

## Feb 07, 1854
- Added README.md with LLM-friendly documentation, architecture overview, and roadmap

## Feb 03, 1833
- Resolution selector shows full calculated dimensions (e.g., 640×360), updates dynamically on viewport change
- Drop-up item text aligned with button text edge

## Feb 03, 2026
- Gallery: localStorage-based snapshot storage, upper-right button, tap to download, long-press to delete
- Aspect ratio: dynamic calculation from viewport, no more 16:9 lock - works on any screen ratio
- Resolution selector now shows long edge only (960/640/480/320), short edge derived from screen

## Jan 30, 2026 (earlier)
- Drop-up menus for resolution and palette selection
- Drop-up styling: no background, white text with shadow, edge-aligned
- Another World palette added
- Default resolution 640
- Removed 2× zoom button
- Replaced version marker with "last updated" timestamp

## Jan 30, 2026 (initial)
- Replaced original repo with Kimi build
- Gesture controls: vertical swipe for EV, horizontal for temperature
- Blade Runner palettes (classic + neon), Cyberpunk, Noir
- Cleaner skeletal UI with Geist Mono
- Title changed to "di_ther"

## Jul 18, 1500
- Landscape layout polish: drop-ups repositioned above toolbar, safe-area inset support added, exposure overlay avoids shutter in landscape
- Added `env(safe-area-inset-bottom)` fallback padding on toolbar
