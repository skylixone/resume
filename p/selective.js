/* Selective Color — the algorithm.
 *
 * Pure ES module: no DOM, no globals, no dependencies. Imports cleanly in Node
 * (`node --input-type=module`) so the test harness can drive it directly.
 *
 * Bit-exact with FFmpeg 6.1.1 (libavfilter/vf_selectivecolor.c) and with
 * scripts/model_reference.py. SPEC.md §7.1 freezes this module's API.
 *
 * All arithmetic is 32-bit float (Math.fround) in exactly the order written in
 * SPEC.md C5. Double precision anywhere in the chain breaks parity.
 */

export const RANGES = ['reds', 'yellows', 'greens', 'cyans', 'blues', 'magentas',
                       'whites', 'neutrals', 'blacks'];

const f32 = Math.fround;
const INV255 = f32(1 / 255);   // f32(1/255): NOT 1/255 and NOT a division
const N = 255;
const MID = 128;

/** fresh settings object: 9 ranges × [C, M, Y, K] as fractions in [-1, 1] */
export function createSettings() {
  const s = {};
  for (let i = 0; i < RANGES.length; i++) s[RANGES[i]] = [0, 0, 0, 0];
  return s;
}

/** C lrintf semantics: round to nearest, ties to EVEN (Math.round is wrong). */
function roundEven(x) {
  const fl = Math.floor(x);
  const d = x - fl;
  if (d > 0.5) return fl + 1;
  if (d < 0.5) return fl;
  return fl % 2 === 0 ? fl : fl + 1;
}

/** SPEC C4 — integer range scale Ω. */
function scaleFor(name, mn, md, mx) {
  switch (name) {
    case 'reds': case 'greens': case 'blues':      return mx - md;
    case 'cyans': case 'magentas': case 'yellows': return md - mn;
    case 'whites':   return 2 * mn - N;
    case 'blacks':   return N - 2 * mx;
    case 'neutrals': return ((2 * N - (Math.abs(2 * mx - N) + Math.abs(2 * mn - N))) + 1) >> 1;
    default: return 0;
  }
}

/** SPEC C3 — every range this pixel belongs to, in RANGES order. */
function matches(name, r, g, b, mn, mx) {
  switch (name) {
    case 'reds':     return r === mx;
    case 'greens':   return g === mx;
    case 'blues':    return b === mx;
    case 'cyans':    return r === mn;
    case 'magentas': return g === mn;
    case 'yellows':  return b === mn;
    case 'whites':   return r > MID && g > MID && b > MID;
    case 'neutrals': return (r | g | b) !== 0 && !(r === N && g === N && b === N);
    case 'blacks':   return r < MID && g < MID && b < MID;
    default: return false;
  }
}

/** SPEC C5 — one channel, one range. Returns an integer delta. */
function compAdjust(scale, valueNorm, adjust, k, relative) {
  const lo = f32(-valueNorm);
  const hi = f32(1 - valueNorm);
  let res = f32(f32(f32(-1 - adjust) * k) - adjust);
  if (relative) res = f32(res * hi);
  res = res < lo ? lo : (res > hi ? hi : res);   // clip in the f32 domain
  return roundEven(f32(res * scale));
}

export function rangeScales(r, g, b) {
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  const md = r + g + b - mn - mx;                // exact median, no sorting
  return {
    reds: mx - md,
    yellows: md - mn,
    greens: mx - md,
    cyans: md - mn,
    blues: mx - md,
    magentas: md - mn,
    whites: 2 * mn - N,
    neutrals: ((2 * N - (Math.abs(2 * mx - N) + Math.abs(2 * mn - N))) + 1) >> 1,
    blacks: N - 2 * mx,
  };
}

export function matchingRanges(r, g, b) {
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  const out = [];
  for (let i = 0; i < RANGES.length; i++) {
    if (matches(RANGES[i], r, g, b, mn, mx)) out.push(RANGES[i]);
  }
  return out;
}

/** SPEC C5/C6 — returns [r, g, b] integers, 0…255. */
export function applyPixel(r, g, b, settings, mode) {
  const relative = mode === 'relative';
  const mn = Math.min(r, g, b);
  const mx = Math.max(r, g, b);
  const md = r + g + b - mn - mx;
  const rn = f32(r * INV255);
  const gn = f32(g * INV255);
  const bn = f32(b * INV255);
  let dr = 0, dg = 0, db = 0;

  for (let i = 0; i < RANGES.length; i++) {       // cumulation order = RANGES
    const name = RANGES[i];
    const adj = settings ? settings[name] : null;
    if (!adj) continue;                           // unknown/missing keys ignored
    const c = adj[0] || 0, m = adj[1] || 0, y = adj[2] || 0, k = adj[3] || 0;
    if (c === 0 && m === 0 && y === 0 && k === 0) continue;   // C8
    if (!matches(name, r, g, b, mn, mx)) continue;
    const scale = scaleFor(name, mn, md, mx);
    if (scale <= 0) continue;                     // C4
    dr += compAdjust(scale, rn, c, k, relative);
    dg += compAdjust(scale, gn, m, k, relative);
    db += compAdjust(scale, bn, y, k, relative);
  }

  return [
    dr + r < 0 ? 0 : (dr + r > N ? N : dr + r),
    dg + g < 0 ? 0 : (dg + g > N ? N : dg + g),
    db + b < 0 ? 0 : (db + b > N ? N : db + b),
  ];
}

/** SPEC C5 — accepts an ImageData or a raw Uint8ClampedArray/Uint8Array.
 *  Mutates in place, alpha untouched. Returns whatever it was handed. */
export function applyImageData(imageData, settings, mode) {
  const data = imageData && imageData.data ? imageData.data : imageData;
  const n = data.length;
  for (let i = 0; i + 3 < n; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const out = applyPixel(r, g, b, settings, mode);
    data[i] = out[0];
    data[i + 1] = out[1];
    data[i + 2] = out[2];
  }
  return imageData;
}

/** True when the settings are all-zero (SPEC C8 identity fast path). */
export function isIdentity(settings) {
  for (let i = 0; i < RANGES.length; i++) {
    const a = settings ? settings[RANGES[i]] : null;
    if (!a) continue;
    if ((a[0] || 0) || (a[1] || 0) || (a[2] || 0) || (a[3] || 0)) return false;
  }
  return true;
}
