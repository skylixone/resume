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
| Caustic filament web | bounded Lorentzian on the Laplacian: bright lines along nodal contours | `uWebK`, `uWebCol` |
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

Current keys: `freq gamma amp hscale speed disp web expo glow lint lsharp lhalo
specK dropMix dropScale dropDome orbit lightCol[3] lightPos[3] webCol envA envB envK playing`

## URL parameters (debugging & reproducible stills)

```
?preset=honeycomb|flower|psyche|filament   pick preset
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

- **The caustic web term must be baseline-free.** `1/(1+k·x)` equals 1 on flat
  regions — without subtracting the baseline it fills the dish with gray. The current
  bounded Lorentzian (`uWebK·0.5/(1+(uWebK·lapl·0.045)²)`) replaced an explosive
  `1/(1+k·lapl)` singularity; do not reintroduce unbounded forms.
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
