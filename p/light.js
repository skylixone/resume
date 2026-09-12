/* Light — photographic exposure and white balance. The algorithm.
 *
 * Pure ES module: no DOM, no globals. Imports cleanly in Node
 * (`node --input-type=module`) so the test harness can drive it directly.
 * SPEC.md §7.2 (L1–L11) freezes this module; scripts/gen_light.py is the
 * float64 reference it is measured against (L8).
 *
 * Pipeline (L2), one 8-bit quantisation between this stage and Selective Color:
 *   srgb_decode -> white balance (3 per-channel gains) -> x 2^EV
 *               -> highlight shoulder (EV > 0 only) -> srgb_encode
 *               -> round-half-even to 8 bits
 *
 * Precision (L6): the gains are computed in float64 and rounded ONCE to
 * float32 with Math.fround. Everything downstream — the multiply, the
 * exposure, the shoulder, the transfer functions — stays in float64, which is
 * what the reference does. The only float32 numbers in the pipeline are the
 * three gains, and the shader gets exactly those three (see engine.js).
 *
 * Direction (L6, Lightroom / Camera Raw): the temperature slider states the
 * light the scene was shot under and the render neutralises it, so a LOW value
 * cools the image and a HIGH value warms it; positive tint reads magenta.
 */

import { LOCUS_UV, LOCUS_T_MIN, LOCUS_T_MAX, LOCUS_T_STEP } from './locus.js';

const f32 = Math.fround;

export const NEUTRAL = { ev: 0, temp: 6500, tint: 0, active: false };

const ANCHOR_T = 6500;        // L6: the reference white is the 6500 K locus point
const TINT_SCALE = 0.05;      // L5: ACR convention, v offset per unit tint
const KNEE = 0.9;             // L4: shoulder knee, in linear light
const GUARD = 0.02;           // L6: gamut guard, floor at 2 % of the largest channel
const LUMA = [0.2126, 0.7152, 0.0722];
const EV_MIN = -5, EV_MAX = 5;
const TEMP_MIN = LOCUS_T_MIN, TEMP_MAX = LOCUS_T_MAX;
const TINT_MIN = -1, TINT_MAX = 1;

/* Published sRGB matrix (IEC 61966-2-1 / Lindbloom, 7 significant digits),
 * exactly as the reference holds it. NOT colour-science's
 * RGB_COLOURSPACE_sRGB matrices: those are stored rounded to 4 decimals, which
 * shifts the assumed illuminant by up to 8e-5 and the gains by 0.02 % (measured
 * at 6000 K, tint +1) — forty times the L8 tolerance. */
const XYZ_TO_RGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252],
];

/* ── transfer functions (L3, IEC 61966-2-1 piecewise) ───────────────────── */

/** sRGB -> linear light. `c` is 0…1. */
export function srgbDecode(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** linear light -> sRGB. `l` is 0…1 (clamp at the call site). */
export function srgbEncode(l) {
  return l <= 0.0031308 ? 12.92 * l : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
}

/** Highlight shoulder (L4): identity at or below the knee, asymptotic to 1. */
export function shoulder(x) {
  return x <= KNEE ? x : 1 - (1 - KNEE) * Math.exp(-(x - KNEE) / (1 - KNEE));
}

/* ── white balance: locus -> xy -> XYZ -> linear sRGB (L5, L6) ──────────── */

/** Locate `temp` in the generated table; linear interpolation in K (L5). */
export function locusUv(temp) {
  const t = Math.min(TEMP_MAX, Math.max(TEMP_MIN, Number(temp) || ANCHOR_T));
  const x = (t - LOCUS_T_MIN) / LOCUS_T_STEP;
  const i0 = Math.min(LOCUS_UV.length - 1, Math.max(0, Math.floor(x)));
  const i1 = Math.min(LOCUS_UV.length - 1, i0 + 1);
  const f = x - i0;
  const a = LOCUS_UV[i0], b = LOCUS_UV[i1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** CIE 1960 uv -> CIE XYZ (Y = 1). Straight from the UCS definitions. */
function uvToXyz(u, v) {
  const d = 2 * u - 8 * v + 4;
  const x = (3 * u) / d;
  const y = (2 * v) / d;
  return [x / y, 1, (1 - x - y) / y];
}

/** The assumed illuminant at (temp, tint), expressed in linear sRGB. */
function whiteRgb(temp, tint) {
  const uv = locusUv(temp);
  const XYZ = uvToXyz(uv[0], uv[1] + (Number(tint) || 0) * TINT_SCALE);
  const W = new Array(3);
  for (let i = 0; i < 3; i++) {
    W[i] = XYZ_TO_RGB[i][0] * XYZ[0] + XYZ_TO_RGB[i][1] * XYZ[1] + XYZ_TO_RGB[i][2] * XYZ[2];
  }
  return W;
}

/**
 * SPEC L6 — three per-channel gains in linear sRGB, adapting FROM the assumed
 * illuminant at (temp, tint) TO the 6500 K anchor, luminance normalised.
 * Computed in float64, rounded once to float32 (the vec3 uniform as well).
 */
export function wbGains(temp, tint) {
  const W = whiteRgb(temp, tint);
  const Wref = whiteRgb(ANCHOR_T, 0);
  const top = Math.max(W[0], W[1], W[2]);
  const gains = new Array(3);
  for (let i = 0; i < 3; i++) gains[i] = Wref[i] / (W[i] > top * GUARD ? W[i] : top * GUARD);
  const lum = LUMA[0] * gains[0] + LUMA[1] * gains[1] + LUMA[2] * gains[2];
  const out = new Float32Array(3);
  for (let i = 0; i < 3; i++) out[i] = f32(gains[i] / lum);      // round ONCE
  return out;
}

/** The gains the pipeline uses for `settings` (L7: unity when neutral). */
export function lightGains(settings) {
  if (isNeutral(settings)) return new Float32Array([1, 1, 1]);
  return wbGains(settings.temp, settings.tint);
}

/* ── settings ───────────────────────────────────────────────────────────── */

/** Fresh light state (L1). Neutral = 0 EV / 6500 K / tint 0. */
export function createLightSettings() {
  return { ev: NEUTRAL.ev, temp: NEUTRAL.temp, tint: NEUTRAL.tint };
}

/**
 * SPEC L7 — true when the stage must be skipped entirely. Identity is defined
 * by the three values (`ev`, `temp`, `tint`); `active` is a UI hint and does
 * not change the maths, so a NEUTRAL object is always neutral.
 */
export function isNeutral(settings) {
  if (!settings) return true;
  const ev = Number(settings.ev) || 0;
  const temp = Number(settings.temp);
  const tint = Number(settings.tint) || 0;
  return ev === 0 && (temp === ANCHOR_T || Number.isNaN(temp)) && tint === 0;
}

/** Clamp an arbitrary object into a valid light state (L1 ranges). */
export function sanitizeLight(settings) {
  const s = settings || {};
  const ev = Math.min(EV_MAX, Math.max(EV_MIN, Number(s.ev) || 0));
  const temp = Math.min(TEMP_MAX, Math.max(TEMP_MIN, Number(s.temp) || ANCHOR_T));
  const tint = Math.min(TINT_MAX, Math.max(TINT_MIN, Number(s.tint) || 0));
  return {
    ev: Math.round(ev * 10) / 10,
    temp: Math.round(temp / LOCUS_T_STEP) * LOCUS_T_STEP,
    tint: Math.round(tint * 100) / 100,
  };
}

/* ── the stage itself ───────────────────────────────────────────────────── */

/** C lrintf semantics: round to nearest, ties to EVEN (Math.round is wrong). */
function roundEven(x) {
  const fl = Math.floor(x);
  const d = x - fl;
  if (d > 0.5) return fl + 1;
  if (d < 0.5) return fl;
  return fl % 2 === 0 ? fl : fl + 1;
}

/** SPEC L2 — returns [r, g, b] integers, 0…255. */
export function applyPixelLight(r, g, b, settings) {
  if (isNeutral(settings)) return [r, g, b];            // L7: byte-exact no-op

  const w = wbGains(settings.temp, settings.tint);
  const gain = Math.pow(2, Number(settings.ev) || 0);

  let x = srgbDecode(r / 255) * w[0] * gain;
  let y = srgbDecode(g / 255) * w[1] * gain;
  let z = srgbDecode(b / 255) * w[2] * gain;

  if (gain > 1) { x = shoulder(x); y = shoulder(y); z = shoulder(z); }   // L4

  const e = (v) => roundEven(srgbEncode(v <= 0 ? 0 : (v >= 1 ? 1 : v)) * 255);
  return [e(x), e(y), e(z)];
}

/** In-place over an ImageData or a raw Uint8ClampedArray/Uint8Array; alpha
 *  untouched. Returns whatever it was handed. Mirrors selective.js's shape. */
export function applyImageDataLight(imageData, settings) {
  if (isNeutral(settings)) return imageData;            // L7: skip the pass
  const data = imageData && imageData.data ? imageData.data : imageData;
  const n = data.length;
  for (let i = 0; i + 3 < n; i += 4) {
    const out = applyPixelLight(data[i], data[i + 1], data[i + 2], settings);
    data[i] = out[0];
    data[i + 1] = out[1];
    data[i + 2] = out[2];
  }
  return imageData;
}
