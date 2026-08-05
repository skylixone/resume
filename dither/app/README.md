# di_ther

Real-time DOS-era dithered camera for web. Applies Bayer ordered dithering and palette reduction to live camera feed.

**Live**: [skylixone.github.io/doscamera](https://skylixone.github.io/doscamera)

## How it works

```
Camera → Canvas 2D → Exposure adjustment → Bayer 4×4 dithering → Palette reduction → Display
```

**Pipeline** (per frame, 30fps target):
1. WebRTC captures camera frame
2. Frame drawn to canvas at selected resolution
3. Exposure compensation applied (±2 EV, pre-dither)
4. Bayer 4×4 ordered dithering adds threshold noise
5. Each pixel matched to closest color in active palette (Euclidean RGB distance)
6. Temperature shift applied to palette if set

**Resolution**: Long edge fixed (960/640/480/320), short edge calculated from viewport aspect ratio. No 16:9 lock - adapts to any screen.

## File structure

```
index.html    UI structure, drop-ups, overlays
camera.js     WebRTC capture, frame loop, gesture handling, gallery, UI state
dither.js     Bayer matrix, exposure compensation, dithering algorithm
palette.js    Palette definitions, color matching, temperature adjustment
styles.css    Layout, drop-ups, overlays, responsive rules
```

## Key functions

| File | Function | Purpose |
|------|----------|---------|
| `dither.js` | `applyDithering(imageData, w, h)` | Main processing - exposure, dither, palette match |
| `palette.js` | `findClosestColor(r, g, b)` | Euclidean distance to nearest palette color |
| `palette.js` | `applyTemperature(palette, temp)` | Shifts palette warm/cool (-1 to +1) |
| `camera.js` | `getCanvasDimensions()` | Calculates resolution from viewport ratio |
| `camera.js` | `processFrame()` | RAF loop - capture, process, display |

## Palettes

Defined in `PALETTES` object. Each palette is an array of `[r, g, b]` arrays, ordered dark to bright.

Current: VGA (16), Amber (2), Another World (8), BR Neon (8), Blade Runner (8), Cyberpunk (8), Noir (8)

Adding a palette:
```js
PALETTES.MY_PALETTE = [
    [0, 0, 0],        // darkest
    [128, 64, 32],    // mid
    [255, 200, 150]   // brightest
];
```
Then add button in `index.html` `#paletteDropup`.

## Controls

- **Vertical swipe**: Exposure compensation (±2 EV)
- **Horizontal swipe**: Temperature shift (cool ↔ warm)
- **Shutter**: Saves to localStorage gallery + downloads PNG
- **Gallery** (top-right): View saved, tap to download, long-press to delete

## Storage

Gallery uses localStorage key `dither_gallery`. Array of `{id: timestamp, dataUrl: base64}`. Capped at 50 items.

## Commit protocol

> Always update `CHANGELOG.md` and timestamp in `index.html` (line 38) before pushing. Format: `Mon DD, HHMM`

## Roadmap

### Near-term
- **Proper gallery**: Full-screen preview, swipe navigation, share functionality
- **UI refinement**: Polish drop-ups, better landscape layout, accessibility
- **2× camera**: Toggle telephoto lens on supported devices
- **High-res export**: Option to render at higher resolution than preview

### Mid-term
- **Advanced palette adjustment**: Per-channel curves, contrast, saturation controls
- **Post-capture palette swap**: Change palette on saved photos
- **Video recording**: MediaRecorder with dithered canvas stream
- **HDR**: Bracket exposure for extended dynamic range

### Long-term
- **ASCII-art mode**: Character-based output palette
- **Native iOS app**: Metal shaders, proper camera controls, photo library integration
- **Native Mac app**: Menu bar camera, screen capture dithering

## Browser support

Requires HTTPS (GitHub Pages provides). Tested on iOS Safari 14+, Chrome, Firefox.

Critical CSS: `image-rendering: pixelated` for sharp pixels.

## Performance

320px long edge: 30fps sustained, minimal heat
640px: 25-30fps
960px: 15-20fps, noticeable thermal throttling on mobile

Bottleneck: `findClosestColor()` - runs per-pixel per-frame. Optimization path: WebGL shaders or WASM.
