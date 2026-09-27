# Cymatics Lab — Standing Wave Convection

Real-time web renderer that recreates the look of Gabriel Kelemen's "Standing Wave
Convection" photographs: standing waves in a shallow liquid dish, lit from below by
small colored lights, shot in a darkroom. All markup + JS live in a single
dependency-free `index.html` (vanilla JS + WebGL2, no build step, no frameworks);
styles are split across `css/` (see "UI theming" below).

**Run it:** open `index.html` in any modern browser, or serve the folder statically.

---

## Physics model (what the shader computes)

The dish is a circular membrane/liquid surface. Its standing-wave eigenmodes are

```
z(r,θ,t) = Σ_i A_i · J_m(α_mn · r) · cos(m·θ + φ_i(t))
```

- `J_m` = Bessel function of the first kind, order m
- `α_mn` = n-th root of J_m (hardcoded table `ROOTS` in the JS, 40 modes: m = 0–9)
- Eigenfrequency of a mode is modeled as `f_i = α_mn · FSCALE` (FSCALE = 28 Hz)
- Driving frequency `state.freq` excites modes through a Lorentzian resonance:
  `A_i ∝ 1 / (1 + ((freq − f_i) / gamma)²)` — so `freq` snaps between modal patterns
  and `gamma` (resonance width) controls how many modes blend together
- Per-mode phase drift `φ_i(t)` (hashed direction/speed) makes patterns slowly morph

Two field regimes share this carrier wave:

1. **Smooth liquid** (`dropMix = 0`): the field itself is the surface.
2. **Droplet field** (`dropMix = 1`): a hex lattice of spherical-cap domes whose radius
   is modulated by |field| at each cell center — emulates the droplet/oscillon states in
   Kelemen's honeycomb photos. Blends via `dropMix ∈ [0,1]`, density via `dropScale`.

## Rendering pipeline (single fragment-shader pass, fullscreen triangle)

`field(p)` returns `(height, gradient, laplacian)` analytically — the Laplacian is free
because each mode satisfies Helmholtz: `∇²mode = −α²·mode`.

Shading in `shade(p)`:

| Term | Mechanism | Uniforms |
|---|---|---|
| Point lights below dish | `refract()` view ray through surface normal, align with light dir; per-channel η → chromatic dispersion fringes | `uLPos/uLCol[4]`, `uLSharp`, `uLHalo`, `uDisp` |
| Caustic filament web | Gaussian on scale-invariant contour distance `d = \|h\|/\|grad h\|`: thin bright filaments on nodal lines; weight = strand width, opacity = layer opacity | `uWebK`, `uWebOp`, `uWebCol` |
| Droplet rims | Gaussian ring at cell edge | (derived) |
| Crest glints | Blinn-style specular from a fixed key light above | `uSpecK` |
| Ambient color wash | refracted gradient between two env colors | `uEnvA/uEnvB/uEnvK` |
| Post | dish vignette + rim ring, fake bloom (`uGlow`), exp tonemap (`uExpo`), gamma, grain | |

Radial mode profiles `(J_m(αr), d/dr)` are precomputed in JS (series expansion —
verified against known roots) and uploaded as an RG16F texture (`TEXW = 512` samples).
Per-frame, JS only recomputes 40 amplitudes/phases → `uModeA` uniform array.

## State & presets

All parameters live in the flat `state` object; `PRESETS` deep-copy over it. When you
add a state key, add it to **every preset** (missing keys leak from the previous
preset — `Object.assign` doesn't clear).

Persistence (localStorage, per file:// origin):

- Every control write is debounced (150ms) into `cymatics.state` — a plain refresh
  restores the last working state. URL `?preset=`/`?reading=` win over the saved state.
- "save" overwrites the currently selected preset with the live values; modified
  presets live in `cymatics.presets` and are merged over built-ins on boot.
- "default" resets the currently selected state to its factory values and stays
  on that selection (preset: factory preset from presets.json/built-ins; reading:
  re-derived; nothing selected: factory state). The reset is recorded as the
  saved session, so a refresh keeps it.

Current keys: `freq gamma amp hscale speed disp web webOp expo glow lint lsharp lhalo
specK dropMix dropScale dropDome orbit lightCol[3] lightPos[3] webCol envA envB envK playing`

## Readings — one string, six reads

Six string-derived states, computed from the same hidden 2^20 alphanumeric seed
that drives the lcdeath poster project (`seed.js`, generated from lcdeath's
`seed.txt` — one score, two instruments). Each reading is deterministic: same
string + same window = same state. Sliders stay live after applying, so a
reading is a starting point, not a lock.

Two listeners exist so far, each read through three windows of the string:

- **The Spectral Read** — FFT over 32768 symbols. The dominant period sets the
  drive frequency, spectral flatness sets exposure/relief/sharpness, and the
  three strongest peaks become the three lights (hue + position from peak phase).
- **The Morphic Read** — gaps between letters fold toward the golden ratio
  (measured 0.61803489 vs φ⁻¹ = 0.61803399). Golden stats set the resonance
  character; a 2048-symbol FFT phase anchor at the window start sets the palette
  and light placement, with light hues spaced 137.5° apart (golden angle).

The string's statistics are stationary (the Fibonacci word is uniformly
recurrent — every window has the same dominant period and gap ratio), so only
FFT phases vary with window position. Hence the design rule: **listener
character comes from the statistics, the window's moment (palette, lights,
drift, small frequency detune) comes from the phase.** The three windows of one
listener therefore share a geometry family and differ in mood.

Mapping lives in `index.html` → the READINGS script block; add future listeners
there (`ngram`, `ratio`, `positional`, `runlength` from lcdeath are the
candidates). Saved PNGs carry an uncompressed iTXt chunk with `{project,
reading, state, seed: first 64 chars, seedLen, generated}` — full provenance
without the string ever appearing in the image.

## URL parameters (debugging & reproducible stills)

```
?preset=honeycomb|flower|psyche|filament   pick preset
?reading=spec-1|spec-2|spec-3|morph-1|morph-2|morph-3   string-derived state
?freeze=2.0                                render a deterministic frozen frame
?freq=300&web=1.2&...                      override any numeric state key
?debug=1|2                                 visualize droplet mask / light term only
?nospec=1                                  disable crest specular
```

## Dev & testing workflow

Headless screenshots (how this project was tuned — WebGL works via SwiftShader):

```bash
chromium --headless --no-sandbox --use-angle=swiftshader \
  --window-size=900,900 --hide-scrollbars --virtual-time-budget=5000 \
  --screenshot=/tmp/shot.png \
  "file:///path/to/index.html?preset=honeycomb&freeze=2.0"
```

- Page errors surface in the on-screen `#err` overlay (`window.onerror` + shader
  compile/link failures); in headless, grep stderr for `INFO:CONSOLE`.
- **Always screenshot all four presets after touching the shader** — a term change
  that fixes one look routinely blows out another.

## Gotchas (learned the hard way)

- **The caustic web term must be baseline-free.** Any profile whose band edge
  covers the dish (e.g. `1/(1+k·x)` or a Lorentzian in the raw Laplacian) fills
  the render with gray at low slider values, because the α²-weighted Laplacian
  is near zero over broad regions. The current term is a Gaussian in the
  scale-invariant contour distance `d = |h|/(|grad h| + ε)` — 0 exactly on nodal
  lines, no wash at any `web` value. `web` = strand width (weight),
  `webOp` = layer opacity. Do not reintroduce Laplacian-based forms.
- **Uniform arrays are capped at 40 modes.** `MODES.splice(40)` keeps JS, the RG16F
  texture rows, and `uModeA[40]` in sync. If you raise this, change all three plus the
  `(i+0.5)/40.0` row mapping in the shader.
- Half-float upload goes through `floatToHalfArray()` — keep it if you change the
  texture format.
- `preserveDrawingBuffer: true` exists for PNG export; don't remove it.

## Roadmap (known gaps, in priority order)

1. **Audio-reactive drive** — WebAudio FFT → `state.freq`/`state.amp` (mic + file).
   The excitation model already accepts external writes; add an analyser loop and a
   peak-tracking or manual frequency mapper. UI note placeholder exists in the panel.
2. **RGB Flower sharpness** — current look is softer than Kelemen's crisp ribbons;
   needs per-light caustic structure (consider Jacobian-based ray-convergence term).
3. **Droplet lattice jitter** — hex grid is perfectly regular; hash-offset cell
   centers for organic packing.
4. **Mobile performance** — droplet mode evaluates `field()` twice per pixel
   (80 mode evaluations). Consider a lower mode count or precomputed height texture
   pass when `devicePixelRatio` is high or GPU is weak.
5. **GIF/video export** — currently PNG stills only.

## UI theming

Styles are split across `css/`, loaded in this order from `index.html`:

- `css/fonts.css` — `@font-face` for Geist + Geist Mono (self-hosted in `fonts/`,
  latin + cyrillic subsets each, `font-weight: 100 900`)
- `css/theme.css` — the `:root` custom-property block (palette, typography, layout,
  controls). Restyle the whole UI from this file only. Accent tints use `color-mix()`
  (evergreen browsers 2023+); swap to literal `rgba()` if older support is needed.

`theme.css` is two-tier: PRIMITIVES at the top (spacing scale `--space-1…4`, type
scale `--fs-base/sm/md/lg`, radius `--radius-sm/md`) feed the SEMANTIC tokens below
(`--sidebar-font-size` = base sidebar font size, `--cell-padding` = base cell padding,
plus button sizing, gaps, margins/paddings, and control/motion tokens). Component
stylesheets only reference tokens — no raw values — so a single base change
propagates everywhere.
- `css/base.css` — reset, `html`/`body`, `#gl` canvas, `#err` overlay
- `css/sidebar.css` — `#panel` control panel + `#tab` toggle (layout, headers, rows)
- `css/controls.css` — sliders, color wells, preset/action buttons, note text

`--font` = Geist (body/UI text), `--font-mono` = Geist Mono (numeric readouts in
`.row output`). The cyrillic subset is deferred and only fetches if Cyrillic text
appears.
