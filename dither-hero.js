(() => {
  'use strict';

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (REDUCED) return;

  const C = {
    SUN_HOME_X: 0.72,
    SUN_HOME_Y: 0.30,
    PARALLAX_X: 0.10,
    PARALLAX_Y: 0.10,
    BOB_AMP: 4,
    BOB_SPEED: 0.4,
    SUN_RADIUS: 0.36,
    CORE_RADIUS: 0.38,
    GLOW_STRENGTH: 0.50,
    CORE_STRENGTH: 0.80,
    PULSE_AMP: 0.12,
    PULSE_SPEED: 0.9,
    RAY_COUNT: 7,
    RAY_LENGTH: 1.15,
    RAY_STRENGTH: 0.50,
    RAY_SHARPNESS: 2,
    RAY_SPIN: 0.05,
    PIXEL_SIZE: 5,
    SUN_RAMP: [
      [255, 140, 20, 0.30],
      [255, 175, 45, 0.55],
      [255, 205, 85, 0.75],
      [255, 232, 150, 0.92],
      [255, 248, 215, 1.00]
    ],
    SNOW_ON: false
  };

  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ].map(row => row.map(v => v / 16 - 0.5));

  const mouse = { x: 0.5, y: 0.4, tx: 0.5, ty: 0.4 };

  window.addEventListener('pointermove', e => {
    mouse.tx = e.clientX / window.innerWidth;
    mouse.ty = e.clientY / window.innerHeight;
  }, { passive: true });

  function mulberry(a) {
    return function () {
      a |= 0;
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

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
      if (this.img.decode) {
        this.img.decode().then(done).catch(() => { this.img.onload = done; });
      } else {
        this.img.onload = done;
      }
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }

    onReady() {
      const r = this.canvas.getBoundingClientRect();
      if (!r.width) return;
      this.W = r.width;
      this.H = r.height;
      this.fw = Math.max(2, Math.round(r.width / C.PIXEL_SIZE));
      this.fh = Math.max(2, Math.round(r.height / C.PIXEL_SIZE));
      this.canvas.width = this.fw;
      this.canvas.height = this.fh;
      this.lum = new Float32Array(this.fw * this.fh);
      this.out = this.ctx.createImageData(this.fw, this.fh);
      this.seedSnow();
    }

    resize() {
      const r = this.canvas.getBoundingClientRect();
      if (!r.width) return;
      this.W = r.width;
      this.H = r.height;
      this.fw = Math.max(2, Math.round(r.width / C.PIXEL_SIZE));
      this.fh = Math.max(2, Math.round(r.height / C.PIXEL_SIZE));
      this.canvas.width = this.fw;
      this.canvas.height = this.fh;
      if (this.ready) this.onReady();
    }

    seedSnow() {
      if (!C.SNOW_ON) { this.snow = []; return; }
      const rng = mulberry(3442);
      const n = Math.round(this.W / C.SNOW_DENSITY);
      this.snow = Array.from({ length: n }, () => ({
        x: rng() * this.fw,
        y: rng() * this.fh,
        s: (C.SNOW_SPEED[0] + rng() * (C.SNOW_SPEED[1] - C.SNOW_SPEED[0])) / C.PIXEL_SIZE,
        d: rng() * 9
      }));
    }

    sunScreen() {
      const iw = this.img.naturalWidth;
      const ih = this.img.naturalHeight;
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

      lum.fill(0);
      const R = Math.max(W, H) * C.SUN_RADIUS * k;
      const reach = R * C.RAY_LENGTH;
      const sigG = 2 * (R * 0.42) * (R * 0.42);
      const sigC = 2 * (R * C.CORE_RADIUS * 0.8) * (R * C.CORE_RADIUS * 0.8);
      const sigR = 2 * (reach * 0.55) * (reach * 0.55);
      const x0 = Math.max(0, sx - reach | 0);
      const x1 = Math.min(fw - 1, sx + reach | 0);
      const y0 = Math.max(0, sy - reach | 0);
      const y1 = Math.min(fh - 1, sy + reach | 0);
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

      const o = out.data;
      const ramp = C.SUN_RAMP;
      const n = ramp.length;
      const step = 1 / n;
      let i4 = 0, idx = 0;
      for (let y = 0; y < fh; y++) {
        const brow = BAYER[y & 3];
        for (let x = 0; x < fw; x++) {
          let v = lum[idx++] + brow[x & 3] * step;
          if (v < 0) v = 0; else if (v > 1) v = 1;
          const lvl = (v * n + 0.5) | 0;
          if (lvl === 0) {
            o[i4 + 3] = 0;
          } else {
            const c = ramp[lvl - 1];
            o[i4] = c[0]; o[i4 + 1] = c[1]; o[i4 + 2] = c[2];
            o[i4 + 3] = c[3] * 255;
          }
          i4 += 4;
        }
      }
      ctx.putImageData(out, 0, 0);

      if (C.SNOW_ON) {
        const [sr, sg, sb] = C.SNOW_COLOR;
        ctx.fillStyle = `rgba(${sr},${sg},${sb},${C.SNOW_ALPHA})`;
        for (const p of this.snow) {
          p.y += p.s;
          p.x += Math.sin(t * 0.8 + p.d) * 0.06;
          if (p.y > fh) { p.y = -1; p.x = Math.random() * fw; }
          if (p.x < 0) p.x += fw; else if (p.x >= fw) p.x -= fw;
          ctx.fillRect(p.x | 0, p.y | 0, 1, 1);
        }
      }
    }
  }

  function init() {
    const canvas = document.getElementById('dither-hero-canvas');
    if (!canvas) return;
    const hero = new HeroFX(canvas, 'dither/assets/shot-skyline.jpg');
    const card = document.querySelector('.work-card.dither');
    let visible = true;
    if (card && 'IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
      }, { threshold: 0.05 }).observe(card);
    }

    let t = 0, prev = performance.now();
    (function tick(now) {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      t += dt;
      mouse.x += (mouse.tx - mouse.x) * 0.06;
      mouse.y += (mouse.ty - mouse.y) * 0.06;
      if (visible && hero.ready) hero.step(t);
      requestAnimationFrame(tick);
    })(performance.now());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
