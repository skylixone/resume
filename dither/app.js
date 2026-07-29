/* ══════════════════════════════════════════════════
   di_ther — landing engine
   real Bayer 4×4 ordered dithering, live in-browser

   PERF NOTES (v2):
   - zero per-frame allocations (ImageData + lum fields
     are preallocated once per resize)
   - zero per-frame canvas readbacks (no getImageData in
     the hot loop — luminance is computed analytically)
   - one shared rAF tick for all stages
   - hero photo is read ONCE at load into a Float32Array
   ══════════════════════════════════════════════════ */

'use strict';

/* ─────────── Bayer 4×4 matrix ─────────── */
const BAYER = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5]
].map(row => row.map(v => v / 16 - 0.5));

/* ─────────── Palettes (lifted from field captures) ─────────── */
const PALETTES = {
  amber:    { name: 'AMBER-4',  colors: ['#000000', '#5a2b00', '#ffae00', '#ffe6a8'] },
  dusk:     { name: 'DUSK-4',   colors: ['#0a0010', '#4a0e5c', '#e033c8', '#ffb3f2'] },
  phosphor: { name: 'PHOSPHOR', colors: ['#000000', '#12331a', '#33ff66', '#d2ffd2'] },
  blood:    { name: 'BLOOD-4',  colors: ['#000000', '#4a0500', '#ff2a1f', '#ffc9b8'] },
  paper:    { name: 'PAPER-W',  colors: ['#000000', '#5a5a5a', '#c8c8c8', '#ffffff'] },
  vga:      { name: 'VGA-16',   colors: ['#000000', '#5c1010', '#e03a2b', '#f5760a', '#f5d90a', '#e8e6e0'] }
};
Object.values(PALETTES).forEach(p => {
  p.rgb = p.colors.map(hex => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ]);
});

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ─────────── shared pointer state ─────────── */
const mouse = { x: 0.5, y: 0.4, tx: 0.5, ty: 0.4 };
const IS_TOUCH = window.matchMedia('(hover: none)').matches;

function pointToMouse(e, el) {
  if (el) {
    const r = el.getBoundingClientRect();
    mouse.tx = (e.clientX - r.left) / r.width;
    mouse.ty = (e.clientY - r.top) / r.height;
  } else {
    mouse.tx = e.clientX / innerWidth;
    mouse.ty = e.clientY / innerHeight;
  }
  if (IS_TOUCH) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
}
window.addEventListener('pointermove', e => pointToMouse(e, null), { passive: true });

/* ══════════════ DitherStage — allocation-free core ══════════════ */
class DitherStage {
  constructor(canvas, resW) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resW = resW;
    this.palette = PALETTES.amber;
    this.running = false;
    this.ready = false;
    this.resize();
    window.addEventListener('resize', () => { this.resize(); this.onResize && this.onResize(); });
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width) return;
    const aspect = rect.height / rect.width;
    this.w = this.resW;
    this.h = Math.max(2, Math.round(this.resW * aspect));

    /* low-res backing store — CSS + GPU do the upscale.
       per-frame raster stays tiny at ANY viewport size. */
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.img = this.ctx.createImageData(this.w, this.h);
    this.work = new Float32Array(this.w * this.h);
    if (this.resEl) this.resEl.textContent = `${this.w}×${this.h}`;
  }

  setPalette(key) { this.palette = PALETTES[key]; }

  /* scene hook — fills this.work with luminance 0..1 */
  fill() {}

  step(t) {
    if (!this.ready || !this.w) return;
    this.fill(t);
    const { w, h, work } = this;
    const o = this.img.data;
    const rgb = this.palette.rgb;
    const n = rgb.length - 1;
    const step = 1 / n;
    let i4 = 0, idx = 0;
    for (let y = 0; y < h; y++) {
      const brow = BAYER[y & 3];
      for (let x = 0; x < w; x++) {
        let lum = work[idx++] + brow[x & 3] * step;
        if (lum < 0) lum = 0; else if (lum > 1) lum = 1;
        const c = rgb[(lum * n + 0.5) | 0];
        o[i4] = c[0]; o[i4 + 1] = c[1]; o[i4 + 2] = c[2]; o[i4 + 3] = 255;
        i4 += 4;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }
}

/* ══════════════════════════════════════════════════════
   HERO FX — PLAY WITH THESE
   Everything that controls the sun, rays, snow and how
   they react to your mouse/touch.

   The sun is BAYER-DITHERED itself: a luminance field is
   computed per pixel-cell, then quantized through a 4×4
   Bayer matrix into SUN_RAMP — same treatment the camera
   gives the world. Tune and reload.
   ══════════════════════════════════════════════════════ */
const HERO_FX_CONFIG = {

  /* ── SUN POSITION ──
     where the sun sits in the SOURCE PHOTO (0..1).
     mapped through the cover-crop, so it stays glued
     to the photo's bright spot on any screen. */
  SUN_HOME_X: 0.72,
  SUN_HOME_Y: 0.30,

  /* ── MOUSE / TOUCH REACTIVITY ──
     drift toward the pointer, fraction of screen size.
     0 = sun glued to the photo. */
  PARALLAX_X: 0.10,
  PARALLAX_Y: 0.10,
  BOB_AMP: 4,             /* idle vertical drift, px */
  BOB_SPEED: 0.4,         /* idle drift speed */

  /* ── SUN SHAPE ── */
  SUN_RADIUS: 0.36,       /* glow reach, fraction of max(screen W, H) */
  CORE_RADIUS: 0.38,      /* hot core, fraction of SUN_RADIUS */
  GLOW_STRENGTH: 0.50,    /* bloom luminance at center (0..1) */
  CORE_STRENGTH: 0.80,    /* extra luminance in the core (0..1) */

  /* ── SUN COLORS ──
     dither output ramp, darkest → brightest.
     each entry [R, G, B, alpha 0..1]. first entries are
     the outer halo, last is the core. add/remove steps
     freely — the dither adapts. */
  SUN_RAMP: [
    [255, 140,  20, 0.30],
    [255, 175,  45, 0.55],
    [255, 205,  85, 0.75],
    [255, 232, 150, 0.92],
    [255, 248, 215, 1.00]
  ],

  /* ── BREATHING ── */
  PULSE_AMP: 0.12,        /* 0 = static sun */
  PULSE_SPEED: 0.9,

  /* ── RAYS ──
     they dissolve into dither noise with distance —
     higher STRENGTH = longer visible reach. */
  RAY_COUNT: 7,
  RAY_LENGTH: 1.15,       /* × SUN_RADIUS — how far rays reach */
  RAY_STRENGTH: 0.50,     /* ray luminance at the sun's edge (0..1) */
  RAY_SHARPNESS: 2,       /* higher = thinner rays */
  RAY_SPIN: 0.05,         /* rotation speed. 0 = static */

  /* ── PIXELATION ──
     overlay grid cell size in screen px. this IS the
     chunkiness of the sun — 3 fine, 5 chunky, 8 brutal */
  PIXEL_SIZE: 5,

  /* ── SNOW ── */
  SNOW_ON: false,
  SNOW_DENSITY: 14,       /* screen px per flake (lower = more) */
  SNOW_COLOR: [235, 238, 245],
  SNOW_ALPHA: 0.85,
  SNOW_SPEED: [0.3, 1.4]
};

/* ══════════════ HERO FX — overlay only ══════════════
   The hero image is shown as-is (object-fit: cover).
   NOTHING is baked into it — the dithered sun and the
   snow live on a transparent overlay canvas above it. */
const C = HERO_FX_CONFIG;

class HeroFX {
  constructor(canvas, imgSrc) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.running = false;
    this.ready = false;
    this.snow = [];
    this.img = new Image();
    this.img.src = imgSrc;
    const done = () => { this.ready = true; this.onReady(); };
    this.img.decode ? this.img.decode().then(done).catch(() => { this.img.onload = done; })
                    : this.img.onload = done;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  onReady() {
    /* preallocate the low-res field + output, once */
    this.lum = new Float32Array(this.fw * this.fh);
    this.out = this.ctx.createImageData(this.fw, this.fh);
    this.seedSnow();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width) return;
    this.W = r.width; this.H = r.height;
    this.fw = Math.max(2, Math.round(r.width / C.PIXEL_SIZE));
    this.fh = Math.max(2, Math.round(r.height / C.PIXEL_SIZE));
    /* backing store IS the low-res buffer — GPU upscales */
    this.canvas.width = this.fw;
    this.canvas.height = this.fh;
    if (this.ready) this.onReady();
  }

  seedSnow() {
    const rng = mulberry(3442);
    const n = C.SNOW_ON ? Math.round(this.W / C.SNOW_DENSITY) : 0;
    this.snow = Array.from({ length: n }, () => ({
      x: rng() * this.fw, y: rng() * this.fh,
      s: (C.SNOW_SPEED[0] + rng() * (C.SNOW_SPEED[1] - C.SNOW_SPEED[0])) / C.PIXEL_SIZE,
      d: rng() * 9
    }));
  }

  /* where the photo's sun lands after object-fit: cover */
  sunScreen() {
    const iw = this.img.naturalWidth, ih = this.img.naturalHeight;
    const s = Math.max(this.W / iw, this.H / ih);
    const x = (this.W - iw * s) / 2 + C.SUN_HOME_X * iw * s;
    const y = (this.H - ih * s) / 2 + C.SUN_HOME_Y * ih * s;
    const m = Math.min(this.W, this.H) * 0.12;
    return {
      x: Math.min(this.W - m, Math.max(m, x)),
      y: Math.min(this.H - m, Math.max(m, y))
    };
  }

  step(t) {
    if (!this.ready || !this.W) return;
    const { ctx, W, H, fw, fh, lum, out } = this;
    const k = 1 / C.PIXEL_SIZE;

    const home = this.sunScreen();
    const sx = (home.x + (mouse.x - 0.5) * W * C.PARALLAX_X) * k;
    const sy = (home.y + (mouse.y - 0.5) * H * C.PARALLAX_Y + Math.sin(t * C.BOB_SPEED) * C.BOB_AMP) * k;
    const pulse = 1 - C.PULSE_AMP + C.PULSE_AMP * Math.sin(t * C.PULSE_SPEED);

    /* ── analytic luminance field: glow + core + rays ── */
    lum.fill(0);
    const R = Math.max(W, H) * C.SUN_RADIUS * k;
    const reach = R * C.RAY_LENGTH;
    const sigG = 2 * (R * 0.42) * (R * 0.42);
    const sigC = 2 * (R * C.CORE_RADIUS * 0.8) * (R * C.CORE_RADIUS * 0.8);
    const sigR = 2 * (reach * 0.55) * (reach * 0.55);
    const x0 = Math.max(0, sx - reach | 0), x1 = Math.min(fw - 1, sx + reach | 0);
    const y0 = Math.max(0, sy - reach | 0), y1 = Math.min(fh - 1, sy + reach | 0);
    const spin = t * C.RAY_SPIN;
    for (let y = y0; y <= y1; y++) {
      const dy = y - sy;
      for (let x = x0; x <= x1; x++) {
        const dx = x - sx;
        const d2 = dx * dx + dy * dy;
        let v = C.GLOW_STRENGTH * Math.exp(-d2 / sigG)
              + C.CORE_STRENGTH * Math.exp(-d2 / sigC);
        const ang = Math.atan2(dy, dx);
        const ray = Math.pow(0.5 + 0.5 * Math.cos(ang * C.RAY_COUNT + spin), C.RAY_SHARPNESS);
        v += C.RAY_STRENGTH * ray * Math.exp(-d2 / sigR);
        lum[y * fw + x] = v * pulse;
      }
    }

    /* ── Bayer-dither the field into SUN_RAMP ── */
    const o = out.data;
    const ramp = C.SUN_RAMP;
    const n = ramp.length;           /* levels 0..n : 0 = transparent */
    const step = 1 / n;
    let i4 = 0, idx = 0;
    for (let y = 0; y < fh; y++) {
      const brow = BAYER[y & 3];
      for (let x = 0; x < fw; x++) {
        let v = lum[idx++] + brow[x & 3] * step;
        if (v < 0) v = 0; else if (v > 1) v = 1;
        const lvl = (v * n + 0.5) | 0;
        if (lvl === 0) { o[i4 + 3] = 0; }
        else {
          const c = ramp[lvl - 1];
          o[i4] = c[0]; o[i4 + 1] = c[1]; o[i4 + 2] = c[2];
          o[i4 + 3] = c[3] * 255;
        }
        i4 += 4;
      }
    }
    ctx.putImageData(out, 0, 0);

    /* ── snow — chunky cells, drawn over the dither ── */
    const [sr, sg, sb] = C.SNOW_COLOR;
    ctx.fillStyle = `rgba(${sr},${sg},${sb},${C.SNOW_ALPHA})`;
    for (const p of this.snow) {
      p.y += p.s; p.x += Math.sin(t * 0.8 + p.d) * 0.06;
      if (p.y > fh) { p.y = -1; p.x = Math.random() * fw; }
      if (p.x < 0) p.x += fw; else if (p.x >= fw) p.x -= fw;
      ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
    }
  }
}

/* ══════════════ ENGINE — analytic plasma ══════════════
   Same visual as before, but luminance is computed
   mathematically per pixel — no gradients, no readback. */
class PlasmaStage extends DitherStage {
  constructor(canvas, resW) {
    super(canvas, resW);
    this.ready = true;
  }

  fill(t) {
    const { w, h, work } = this;
    work.fill(0);
    const blobs = PlasmaStage.blobs(t, w, h, mouse.x, mouse.y);
    for (const [bx, by, r, amp] of blobs) {
      const sig2 = 2 * (r * 0.42) * (r * 0.42);
      const reach = r * 1.15;
      const x0 = Math.max(0, bx - reach | 0), x1 = Math.min(w - 1, bx + reach | 0);
      const y0 = Math.max(0, by - reach | 0), y1 = Math.min(h - 1, by + reach | 0);
      for (let y = y0; y <= y1; y++) {
        const dy = y - by;
        for (let x = x0; x <= x1; x++) {
          const dx = x - bx;
          work[y * w + x] += amp * Math.exp(-(dx * dx + dy * dy) / sig2);
        }
      }
    }
    /* scanning band */
    const sy = (t * 26) % (h * 1.4) - h * 0.2;
    const y0 = Math.max(0, sy - 16 | 0), y1 = Math.min(h - 1, sy + 16 | 0);
    for (let y = y0; y <= y1; y++) {
      const g = 0.22 * Math.exp(-((y - sy) * (y - sy)) / 110);
      for (let x = 0; x < w; x++) work[y * w + x] += g;
    }
  }

  static blobs(t, w, h, mx, my) {
    return [
      [w * (0.5 + 0.32 * Math.sin(t * 0.7)),      h * (0.5 + 0.30 * Math.cos(t * 0.5)),  w * 0.30, 0.85],
      [w * (0.5 + 0.35 * Math.cos(t * 0.4 + 2)),  h * (0.5 + 0.28 * Math.sin(t * 0.6)),  w * 0.24, 0.65],
      [w * mx,                                     h * my,                                w * 0.22, 0.95],
      [w * (0.5 + 0.40 * Math.sin(t * 0.23 + 4)), h * (0.5 + 0.35 * Math.sin(t * 0.31)), w * 0.35, 0.40]
    ];
  }
}

/* ─────────── tiny seeded rng ─────────── */
function mulberry(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ══════════════ BOOT SEQUENCE ══════════════ */
const BOOT_LINES = [
  ['DI_THER(R) VGA BIOS — v1.0\n', 'sys'],
  ['CHECKING MEMORY .......... 640K ', 'sys'], ['OK\n', 'ok'],
  ['BAYER MATRIX 4×4 ......... ', 'sys'], ['LOADED\n', 'ok'],
  ['PALETTES ................ ', 'sys'], ['06 FOUND\n', 'ok'],
  ['CAMERA MODULE ........... ', 'sys'], ['STANDBY\n', 'ok'],
  ['UPLOAD MODULE ........... ', 'sys'], ['NOT FOUND (GOOD)\n', 'ok'],
  ['EDITING SUITE ........... ', 'sys'], ['REFUSED\n', 'ok'],
  ['\nBOOTING INTERFACE_', 'sys']
];

function runBoot(done) {
  const boot = document.getElementById('boot');
  const pre = document.getElementById('boot-text');
  let li = 0, ci = 0, killed = false;

  const finish = () => {
    if (killed) return; killed = true;
    gsap.to(boot, {
      opacity: 0, duration: 0.5, ease: 'power2.in',
      onComplete: () => { boot.remove(); done(); }
    });
  };
  boot.addEventListener('click', finish);

  const type = () => {
    if (killed) return;
    if (li >= BOOT_LINES.length) { setTimeout(finish, 550); return; }
    const [text, cls] = BOOT_LINES[li];
    if (ci === 0 && cls !== 'sys') pre.insertAdjacentHTML('beforeend', `<span class="${cls}"></span>`);
    let target = cls === 'sys' ? pre : pre.lastElementChild;
    if (ci < text.length) {
      target.textContent += text[ci++];
      setTimeout(type, ci % 3 ? 4 : 14);
    } else { li++; ci = 0; setTimeout(type, 90); }
  };
  setTimeout(type, 350);
}

/* ══════════════ CURSOR (fine pointers only) ══════════════ */
function initCursor() {
  if (IS_TOUCH) return;
  const cur = document.getElementById('cursor');
  if (!cur) return;
  const label = cur.querySelector('.cursor-label');
  if (!label) return;
  let x = -100, y = -100, cx = -100, cy = -100;
  window.addEventListener('pointermove', e => { x = e.clientX; y = e.clientY; }, { passive: true });
  (function loop() {
    cx += (x - cx) * 0.22; cy += (y - cy) * 0.22;
    cur.style.transform = `translate(${cx}px,${cy}px) translate(-50%,-50%)`;
    requestAnimationFrame(loop);
  })();
  document.querySelectorAll('a, button, [data-cursor]').forEach(el => {
    el.addEventListener('pointerenter', () => {
      cur.classList.add('is-hover');
      label.textContent = el.dataset.cursor || 'OPEN';
    });
    el.addEventListener('pointerleave', () => cur.classList.remove('is-hover'));
  });
}

/* ══════════════ SCROLL CHOREOGRAPHY ══════════════ */
function initScrollFX() {
  gsap.registerPlugin(ScrollTrigger);

  gsap.timeline()
    .from('.hero-kicker', { y: 30, opacity: 0, duration: 0.9, ease: 'power3.out' })
    .from('.hero-examples', { y: 18, opacity: 0, duration: 0.7, ease: 'power3.out' }, '-=0.45')
    .from('.marquee', { yPercent: 100, duration: 0.7, ease: 'power3.out' }, '-=0.4');

  gsap.to('.hero-content', {
    yPercent: -18, opacity: 0.05, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
  });

  document.querySelectorAll('.section-title').forEach(el => {
    gsap.from(el, {
      y: 70, opacity: 0, duration: 1, ease: 'power4.out',
      scrollTrigger: { trigger: el, start: 'top 85%' }
    });
  });
  document.querySelectorAll('.section-sub, .section-tag').forEach(el => {
    gsap.from(el, {
      y: 30, opacity: 0, duration: 0.8, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 90%' }
    });
  });

  document.querySelectorAll('.m-line').forEach((el, i) => {
    gsap.from(el, {
      yPercent: 110, duration: 1, delay: i * 0.08, ease: 'power4.out',
      scrollTrigger: { trigger: '.manifesto-text', start: 'top 82%' }
    });
  });
  gsap.from('.manifesto-p', {
    y: 40, opacity: 0, stagger: 0.12, duration: 0.9, ease: 'power3.out',
    scrollTrigger: { trigger: '.manifesto-grid', start: 'top 85%' }
  });

  document.querySelectorAll('.stat-num').forEach(el => {
    const target = +el.dataset.count;
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.6, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 88%' },
      onUpdate: () => el.textContent = Math.round(obj.v)
    });
  });

  gsap.utils.toArray('.g-item').forEach((el, i) => {
    gsap.from(el, {
      y: 90, opacity: 0, duration: 0.9, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 92%' },
      delay: (i % 3) * 0.07
    });
  });

  gsap.from('.spec-table tr', {
    x: -40, opacity: 0, stagger: 0.06, duration: 0.6, ease: 'power2.out',
    scrollTrigger: { trigger: '.spec-table', start: 'top 85%' }
  });

  gsap.from('.engine-frame', {
    clipPath: 'inset(0 0 100% 0)', duration: 1.2, ease: 'power4.inOut',
    scrollTrigger: { trigger: '.engine-stage', start: 'top 80%' }
  });

  document.querySelectorAll('.ft-line').forEach((el, i) => {
    gsap.from(el, {
      yPercent: 115, duration: 1, delay: i * 0.09, ease: 'power4.out',
      scrollTrigger: { trigger: '.final-title', start: 'top 80%' }
    });
  });
  gsap.from('.btn-mega', {
    scale: 0.85, opacity: 0, duration: 0.8, ease: 'back.out(1.6)',
    scrollTrigger: { trigger: '.btn-mega', start: 'top 90%' }
  });

  /* marquee drifts horizontally as the user scrolls the first screen */
  gsap.to('.marquee-track', {
    xPercent: -50, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
  });
}


/* ══════════════ MISC UI ══════════════ */
function initHUD() {
  const clock = document.getElementById('footer-clock');
  setInterval(() => {
    clock.textContent = new Date().toTimeString().slice(0, 8);
  }, 1000);

  const flash = document.getElementById('flash');
  document.querySelectorAll('.btn-primary, .btn-mega, .hud-link').forEach(a => {
    a.addEventListener('click', () => {
      gsap.fromTo(flash, { opacity: 0.9 }, { opacity: 0, duration: 0.45, ease: 'power2.out' });
    });
  });
}

/* ══════════════ INIT ══════════════ */
window.addEventListener('DOMContentLoaded', () => {
  const heroStage = new HeroFX(
    document.getElementById('hero-canvas'),
    'assets/shot-skyline.jpg'
  );
  const engineStage = new PlasmaStage(document.getElementById('engine-canvas'), 300);
  engineStage.resEl = document.getElementById('engine-res');
  engineStage.resize();

  /* ── one shared tick for both stages ── */
  let t = 0, prev = performance.now();
  (function tick(now) {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    t += dt;
    mouse.x += (mouse.tx - mouse.x) * 0.06;
    mouse.y += (mouse.ty - mouse.y) * 0.06;
    if (heroStage.running) heroStage.step(t);
    if (engineStage.running) engineStage.step(t);
    requestAnimationFrame(tick);
  })(performance.now());

  /* palette buttons */
  const palName = document.getElementById('engine-pal-name');
  document.querySelectorAll('.pal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelector('.pal-btn.is-active')?.classList.remove('is-active');
      btn.classList.add('is-active');
      engineStage.setPalette(btn.dataset.pal);
      palName.textContent = PALETTES[btn.dataset.pal].name;
      gsap.fromTo('#engine-canvas', { filter: 'brightness(2.2)' }, { filter: 'brightness(1)', duration: 0.35 });
    });
  });

  /* touch + drag steering for the playground */
  const engineFrame = document.querySelector('.engine-frame');
  const engineHint = document.getElementById('engine-hint');
  const killHint = () => engineHint && engineHint.classList.add('is-gone');
  engineFrame.addEventListener('pointerdown', e => {
    pointToMouse(e, engineFrame);
    try { engineFrame.setPointerCapture(e.pointerId); } catch (_) {}
    killHint();
  });
  engineFrame.addEventListener('pointermove', e => {
    if (e.buttons || IS_TOUCH) pointToMouse(e, engineFrame);
  });
  engineFrame.addEventListener('touchstart', e => e.preventDefault(), { passive: false });

  if (IS_TOUCH) {
    const sub = document.querySelector('.engine .section-sub');
    if (sub) sub.innerHTML = sub.innerHTML.replace('Move your cursor over the frame.', 'Tap or drag across the frame.');
  }


  /* run stages only while visible */
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.target.id === 'hero') heroStage.running = e.isIntersecting;
      if (e.target.id === 'engine') engineStage.running = e.isIntersecting;
    });
  }, { threshold: 0.05 });
  io.observe(document.getElementById('hero'));
  io.observe(document.getElementById('engine'));

  initCursor();
  initHUD();
  runBoot(() => initScrollFX());
});
