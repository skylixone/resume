/* Selective Color — UI, state, gestures, import/export. ES module.
 * Everything runs client-side. No network except the kit's Google Fonts link.
 */

import { RANGES, createSettings, applyImageData, rangeScales,
         matchingRanges, isIdentity } from './selective.js';
import { createEngine } from './engine.js';

const CHANNELS = ['Cyan', 'Magenta', 'Yellow', 'Black'];
const LABEL = {
  reds: 'Reds', yellows: 'Yellows', greens: 'Greens', cyans: 'Cyans', blues: 'Blues',
  magentas: 'Magentas', whites: 'Whites', neutrals: 'Neutrals', blacks: 'Blacks',
};
const SAMPLES = ['./samples/neon-street.webp', './samples/skyline.webp'];
const PREVIEW_MAX = 2048;   // C12
const EXPORT_MAX = 4096;    // C13
const STORAGE_KEY = 'selective-color:v1';
const LONG_PRESS_MS = 450;

const $ = (id) => document.getElementById(id);

/* DOM handles — declared before any top-level use (TDZ safety). */
const canvasEl = $('preview');
const viewportEl = $('viewport');
const statusEl = $('status');
const rangeNameEl = $('range-name');
const eyedropperBtn = $('act-pick');

const state = {
  settings: createSettings(),
  mode: 'relative',            // Photoshop's default
  active: 'reds',
  source: null,                // { bitmap, w, h, name, stem }
  preview: null,               // { canvas, data, w, h }
  zoom: 1, tx: 0, ty: 0,
  eyedropper: false,
  showingOriginal: false,
  exportCapped: false,
  note: '',
};

let engine = null;
let engineDown = false;        // set after a GPU failure at runtime
let renderQueued = false;

/* ── engine ─────────────────────────────────────────────────────────────── */

function engineLabel() { return engine && !engineDown ? 'GPU' : 'CPU'; }

function initEngine() {
  engine = createEngine();     // null => C11 CPU fallback
  if (!engine) engineDown = true;
}

/* ── state serialisation (C18, C19) ─────────────────────────────────────── */

function serialize() {
  const parts = [`m=${state.mode}`];
  for (const name of RANGES) {
    const a = state.settings[name];
    if (a.some((v) => v)) parts.push(`${name}=${a.map((v) => Math.round(v * 100)).join(',')}`);
  }
  return parts.join('&');
}

function deserialize(text) {
  const next = createSettings();
  let mode = null;
  for (const pair of String(text).replace(/^#/, '').split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const val = pair.slice(eq + 1);
    if (key === 'm') { if (val === 'absolute' || val === 'relative') mode = val; continue; }
    if (!RANGES.includes(key)) continue;
    const nums = val.split(',').map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) continue;
    next[key] = nums.map((n) => Math.max(-100, Math.min(100, Math.round(n))) / 100);
  }
  return { settings: next, mode };
}

function loadState() {
  const hash = location.hash.replace(/^#/, '');
  if (hash) {                                        // hash wins (C19)
    const parsed = deserialize(hash);
    state.settings = parsed.settings;
    if (parsed.mode) state.mode = parsed.mode;
    return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved && saved.settings) {
      const next = createSettings();
      for (const name of RANGES) {
        const a = saved.settings[name];
        if (Array.isArray(a) && a.length === 4) next[name] = a.map((v) => Number(v) || 0);
      }
      state.settings = next;
    }
    if (saved.mode === 'absolute' || saved.mode === 'relative') state.mode = saved.mode;
    if (RANGES.includes(saved.active)) state.active = saved.active;
  } catch (_) { /* corrupt storage: start clean */ }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      settings: state.settings, mode: state.mode, active: state.active,
    }));
  } catch (_) { /* private mode / quota */ }
}

/* ── source image ───────────────────────────────────────────────────────── */

async function decode(src, name) {
  let bitmap;
  if (typeof createImageBitmap === 'function') {
    bitmap = src instanceof Blob ? await createImageBitmap(src) : await createImageBitmap(await (await fetch(src)).blob());
  } else {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src instanceof Blob ? URL.createObjectURL(src) : src;
    await img.decode();
    bitmap = img;
  }
  const w = bitmap.width || bitmap.naturalWidth;
  const h = bitmap.height || bitmap.naturalHeight;
  return { bitmap, w, h, name, stem: String(name).replace(/\.[^.]+$/, '') || 'image' };
}

function fitDims(w, h, max) {
  const long = Math.max(w, h);
  if (long <= max) return { w, h, capped: false };
  const k = max / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), capped: true };
}

function setSource(info) {
  state.source = info;
  const pv = fitDims(info.w, info.h, PREVIEW_MAX);          // C12
  const canvas = document.createElement('canvas');
  canvas.width = pv.w; canvas.height = pv.h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(info.bitmap, 0, 0, pv.w, pv.h);
  const data = ctx.getImageData(0, 0, pv.w, pv.h);
  state.preview = { canvas, data, w: pv.w, h: pv.h, out: null };
  canvasEl.width = pv.w; canvasEl.height = pv.h;
  state.zoom = 1; state.tx = 0; state.ty = 0;
  layoutCanvas();
  render();
  setStatus();
}

/* ── viewport / gestures (C17) ──────────────────────────────────────────── */

function layoutCanvas() {
  const vp = viewportEl.getBoundingClientRect();
  const pv = state.preview;
  if (!pv) return;
  const base = Math.min(vp.width / pv.w, vp.height / pv.h) || 1;
  const scale = base * state.zoom;
  canvasEl.style.width = `${(pv.w * scale).toFixed(2)}px`;
  canvasEl.style.height = `${(pv.h * scale).toFixed(2)}px`;
  canvasEl.style.left = `${vp.width / 2 - (pv.w * scale) / 2 + state.tx}px`;
  canvasEl.style.top = `${vp.height / 2 - (pv.h * scale) / 2 + state.ty}px`;
}

const pointers = new Map();
let pinchStart = null, pressTimer = null, pressFired = false, moved = false, gestureStart = null;

viewportEl.addEventListener('pointerdown', (e) => {
  if (!state.preview || e.target !== canvasEl) return;
  viewportEl.setPointerCapture?.(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  moved = false; pressFired = false;
  const n = pointers.size;
  if (n === 1) {
    gestureStart = { x: e.clientX, y: e.clientY, tx: state.tx, ty: state.ty };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      pressTimer = null; pressFired = true;
      state.showingOriginal = true; render();
    }, LONG_PRESS_MS);
  } else if (n === 2) {
    clearTimeout(pressTimer); pressTimer = null;
    const pts = [...pointers.values()];
    pinchStart = {
      d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
      zoom: state.zoom, tx: state.tx, ty: state.ty,
      mx: (pts[0].x + pts[1].x) / 2, my: (pts[0].y + pts[1].y) / 2,
    };
  }
});

viewportEl.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 2) {
    moved = true;
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    if (state.showingOriginal) { state.showingOriginal = false; render(); }
  }
  if (pointers.size === 1 && gestureStart) {
    state.tx = gestureStart.tx + (e.clientX - gestureStart.x);
    state.ty = gestureStart.ty + (e.clientY - gestureStart.y);
    clampPan(); layoutCanvas();
  } else if (pointers.size === 2 && pinchStart) {
    const pts = [...pointers.values()];
    const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    state.zoom = Math.max(1, Math.min(8, pinchStart.zoom * (d / (pinchStart.d || 1))));
    state.tx = pinchStart.tx + ((pts[0].x + pts[1].x) / 2 - pinchStart.mx);
    state.ty = pinchStart.ty + ((pts[0].y + pts[1].y) / 2 - pinchStart.my);
    clampPan(); layoutCanvas();
  }
});

function endPointer(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  clearTimeout(pressTimer); pressTimer = null;
  if (state.showingOriginal) { state.showingOriginal = false; render(); }
  if (pointers.size === 0) {
    if (!moved && !pressFired && state.eyedropper) sampleAt(e.clientX, e.clientY);
    gestureStart = null; pinchStart = null;
  }
}

viewportEl.addEventListener('pointerup', endPointer);
viewportEl.addEventListener('pointercancel', endPointer);
viewportEl.addEventListener('pointerleave', endPointer);

function clampPan() {
  const pv = state.preview; if (!pv) return;
  const vp = viewportEl.getBoundingClientRect();
  const base = Math.min(vp.width / pv.w, vp.height / pv.h) || 1;
  const maxX = Math.max(0, (pv.w * base * state.zoom - vp.width) / 2);
  const maxY = Math.max(0, (pv.h * base * state.zoom - vp.height) / 2);
  state.tx = Math.max(-maxX, Math.min(maxX, state.tx));
  state.ty = Math.max(-maxY, Math.min(maxY, state.ty));
}

/** C17 — tap samples the pixel in ORIGINAL image coordinates. */
function sampleAt(clientX, clientY) {
  const pv = state.preview;
  const rect = canvasEl.getBoundingClientRect();
  const fx = (clientX - rect.left) / rect.width;
  const fy = (clientY - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return;
  const px = Math.min(pv.w - 1, Math.max(0, Math.floor(fx * pv.w)));
  const py = Math.min(pv.h - 1, Math.max(0, Math.floor(fy * pv.h)));
  const i = (py * pv.w + px) * 4;
  const d = pv.data.data;
  const r = d[i], g = d[i + 1], b = d[i + 2];

  const scales = rangeScales(r, g, b);
  const ms = matchingRanges(r, g, b);
  let pick = null, best = -1;
  for (const name of ms) {
    if (scales[name] > best && (!state.settings[name].some((v) => v) || true)) {
      best = scales[name]; pick = name;
    }
  }
  document.querySelectorAll('.sc-chip').forEach((el) => {
    el.classList.toggle('active', el.dataset.range === pick);
    el.setAttribute('aria-pressed', String(el.dataset.range === pick));
  });
  if (pick) { state.active = pick; syncSliders(true); }

  state.note = `sampled rgb(${r}, ${g}, ${b}) \u00b7 ${pick ? LABEL[pick] : 'no range'}`;
  setStatus();
  eyedropperBtn.setAttribute('aria-pressed', String((state.eyedropper = false)));
  eyedropperBtn.classList.remove('btn-pseudo-active');
  saveState();
}

/* ── rendering (GPU preview, CPU export — SPEC C10/C11) ─────────────────── */

function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; renderNow(); });
}

function renderNow() {
  const pv = state.preview;
  if (!pv) return;
  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });

  if (state.showingOriginal || isIdentity(state.settings)) {
    ctx.drawImage(pv.canvas, 0, 0);
    return;
  }
  if (engine && !engineDown) {
    try {
      const gl = engine.render(pv.canvas, state.settings, state.mode);
      ctx.drawImage(gl, 0, 0);
      return;
    } catch (err) {
      engineDown = true;
      setStatus();
      if (typeof console !== 'undefined') console.warn('[selective-color] GPU render failed, CPU fallback', err);
    }
  }
  if (!pv.out) {
    pv.out = new ImageData(new Uint8ClampedArray(pv.data.data.length), pv.data.width, pv.data.height);
  }
  pv.out.data.set(pv.data.data);
  applyImageData(pv.out, state.settings, state.mode);
  ctx.putImageData(pv.out, 0, 0);
}

/* ── chrome ─────────────────────────────────────────────────────────────── */

function setStatus() {
  const s = state.source;
  const dims = s ? `${s.w}\u00d7${s.h}` : 'no image';
  const mode = state.mode === 'absolute' ? 'Absolute' : 'Relative';
  const parts = [dims, engineLabel(), mode];
  if (state.note) parts.push(state.note);
  if (state.exportCapped) parts.push('exported at 4096 px');
  statusEl.textContent = parts.join(' \u00b7 ');
  statusEl.dataset.engine = engineLabel();
}

function syncChips() {
  document.querySelectorAll('.sc-chip').forEach((el) => {
    const name = el.dataset.range;
    const on = name === state.active;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
    const has = state.settings[name].some((v) => v);
    el.classList.toggle('sc-has-value', has);
    el.querySelector('.sc-dot').toggleAttribute('hidden', !has);
  });
}

function syncSliders(full) {
  const vals = state.settings[state.active];
  CHANNELS.forEach((_, i) => {
    const v = Math.round(vals[i] * 100);
    const input = $(`sl-${i}`);
    input.value = String(v);
    input.style.setProperty('--slider-fill', `${((v + 100) / 200) * 100}%`);
    input.setAttribute('aria-valuetext', `${v} percent`);
    const out = $(`val-${i}`);
    out.textContent = v > 0 ? `+${v}` : String(v);
    out.setAttribute('aria-label', `Reset ${CHANNELS[i]} to 0 percent (currently ${v})`);
  });
  rangeNameEl.textContent = LABEL[state.active];
  if (full) syncChips();
}

function syncMode() {
  document.querySelectorAll('.sc-mode .tab').forEach((el) => {
    const on = el.dataset.mode === state.mode;
    el.classList.toggle('active', on);
    el.setAttribute('aria-selected', String(on));
  });
}

/* ── boot: build controls ──────────────────────────────────────────────── */

function buildControls() {
  const chipRow = $('chips');
  for (const name of RANGES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tag sc-chip';
    b.dataset.range = name;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span>${LABEL[name]}</span><span class="sc-dot" hidden aria-hidden="true"></span>`;
    let t = null;
    b.addEventListener('pointerdown', () => {
      clearTimeout(t); t = setTimeout(() => { t = null; resetRange(name); }, LONG_PRESS_MS);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      b.addEventListener(ev, () => { clearTimeout(t); t = null; }));
    b.addEventListener('click', () => {
      state.active = name; syncSliders(true); setStatus(); saveState();
    });
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); resetRange(name); }
    });
    chipRow.appendChild(b);
  }

  const sliderBox = $('sliders');
  CHANNELS.forEach((label, i) => {
    const row = document.createElement('div');
    row.className = 'sc-slider-row';
    row.innerHTML = `
      <div class="sc-slider-head">
        <span class="sc-slider-label" id="lbl-${i}">${label}</span>
        <button type="button" class="sc-slider-value" id="val-${i}">0</button>
      </div>
      <input class="slider sc-slider" type="range" id="sl-${i}" min="-100" max="100" step="1"
             value="0" aria-labelledby="lbl-${i}" aria-valuetext="0 percent">`;
    sliderBox.appendChild(row);
    const input = row.querySelector('input');
    input.addEventListener('input', () => {
      state.settings[state.active][i] = Number(input.value) / 100;
      syncSliders(false); syncChips(); render(); saveState();
    });
    input.addEventListener('dblclick', () => resetSlider(i));
    row.querySelector('button').addEventListener('click', () => resetSlider(i));
  });

  document.querySelectorAll('.sc-mode .tab').forEach((el) => {
    el.addEventListener('click', () => {
      state.mode = el.dataset.mode;
      syncMode(); render(); setStatus(); saveState();
    });
  });
}

function resetSlider(i) {
  state.settings[state.active][i] = 0;
  syncSliders(false); syncChips(); render(); saveState();
}

function resetRange(name) {
  state.settings[name] = [0, 0, 0, 0];
  syncSliders(false); syncChips(); render(); saveState();
  state.note = `${LABEL[name]} reset`;
  setStatus();
}

function resetAll() {
  state.settings = createSettings();
  state.note = 'all ranges reset';
  syncSliders(true); render(); setStatus(); saveState();
  history.replaceState(null, '', location.pathname + location.search);
}

/* ── actions ────────────────────────────────────────────────────────────── */

let sampleIndex = 0;
async function loadSample() {
  const url = SAMPLES[sampleIndex % SAMPLES.length];
  sampleIndex++;
  state.note = 'loading sample\u2026';
  setStatus();
  const info = await decode(url, url.split('/').pop());
  state.note = '';
  setSource(info);
}

function loadFile(file) {
  if (!file) return;
  decode(file, file.name).then((info) => {
    state.note = '';
    setSource(info);
  }).catch((err) => {
    state.note = 'import failed';
    setStatus();
    if (typeof console !== 'undefined') console.warn(err);
  });
}

function exportDims() {
  const s = state.source;
  const d = fitDims(s.w, s.h, EXPORT_MAX);      // C13: never upscale, cap 4096
  return d;
}

async function doExport() {
  const s = state.source;
  if (!s) return;
  const fmt = $('format').value;
  const d = exportDims();
  state.exportCapped = d.capped;
  const c = document.createElement('canvas');
  c.width = d.w; c.height = d.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(s.bitmap, 0, 0, d.w, d.h);

  const id = ctx.getImageData(0, 0, d.w, d.h);
  applyImageData(id, state.settings, state.mode);   // CPU path: exact (C10)
  ctx.putImageData(id, 0, 0);

  const blob = await new Promise((res) => c.toBlob(res, fmt, fmt === 'image/jpeg' ? 0.92 : undefined));
  if (!blob) { state.note = 'export failed'; setStatus(); return; }
  const ext = fmt === 'image/jpeg' ? 'jpg' : 'png';
  const name = `${s.stem}-selective.${ext}`;
  const file = new File([blob], name, { type: fmt });

  state.note = `exported ${name}`;
  setStatus();
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {   // C15
      await navigator.share({ files: [file], title: name });
      return;
    }
  } catch (_) { /* user cancelled the sheet: fall through to download */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function copyLink() {
  const url = `${location.origin}${location.pathname}#${serialize()}`;
  history.replaceState(null, '', `#${serialize()}`);
  try {
    await navigator.clipboard.writeText(url);
    state.note = 'link copied';
  } catch (_) {
    state.note = 'copy failed \u2014 link is in the address bar';
  }
  setStatus();
}

/* ── init ───────────────────────────────────────────────────────────────── */

function init() {
  loadState();
  buildControls();
  initEngine();
  syncMode();
  syncSliders(true);
  setStatus();

  $('file').addEventListener('change', (e) => loadFile(e.target.files && e.target.files[0]));
  $('act-sample').addEventListener('click', loadSample);
  $('act-export').addEventListener('click', doExport);
  $('act-reset').addEventListener('click', resetAll);
  $('act-copy').addEventListener('click', copyLink);
  eyedropperBtn.addEventListener('click', () => {
    state.eyedropper = !state.eyedropper;
    eyedropperBtn.setAttribute('aria-pressed', String(state.eyedropper));
    state.note = state.eyedropper ? 'tap the image to sample a pixel' : '';
    setStatus();
  });

  window.addEventListener('resize', () => { layoutCanvas(); });
  window.addEventListener('orientationchange', () => setTimeout(layoutCanvas, 120));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { state.zoom = 1; state.tx = 0; state.ty = 0; layoutCanvas(); }
    if (e.key === ' ' && !/input|button|select|textarea/i.test(e.target.tagName)) {
      e.preventDefault(); state.showingOriginal = !state.showingOriginal; render();
    }
  });
  window.addEventListener('blur', () => {
    if (state.showingOriginal) { state.showingOriginal = false; render(); }
  });

  loadSample().catch(() => { state.note = 'sample unavailable'; setStatus(); });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
