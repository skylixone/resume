/* Selective Color — WebGL2 preview renderer. ES module, no dependencies.
 *
 * The fragment shader mirrors selective.js exactly: integer Ω (SPEC C4),
 * float32 arithmetic in the SPEC C5 order, roundEven() (C lrintf semantics),
 * cumulation across the 9 ranges in RANGES order (C6).
 *
 * The exported CPU-verified path for files is selective.js; this module is the
 * interactive preview (SPEC C10: export goes through the CPU path so the
 * exported bytes are bit-exact regardless of driver float behaviour).
 */

import { RANGES } from './selective.js';

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_image;
uniform vec4 u_adj[9];      // reds, yellows, greens, cyans, blues, magentas, whites, neutrals, blacks
uniform int u_mode;         // 0 = absolute, 1 = relative

in vec2 v_uv;
out vec4 fragColor;

const float INV255 = 1.0 / 255.0;

float compAdjust(int scale, float valueNorm, float adjust, float k, float rel) {
  // NOTE: the GPU may contract this expression into an FMA, which shifts the last
  // bit and can flip a round-half-to-even tie. Measured effect (Chrome/ANGLE, all
  // 19 golden cases on a 256x256 random image): 270 of 262144 bytes differ, max 1
  // level. Export uses the CPU path (selective.js) and stays bit-exact.
  float lo = -valueNorm;
  float hi = 1.0 - valueNorm;
  float res = (-1.0 - adjust) * k - adjust;
  if (rel > 0.5) res = res * hi;
  res = clamp(res, lo, hi);
  return roundEven(res * float(scale));
}

void addRange(vec4 adj, int scale, float rn, float gn, float bn, float rel,
              inout float dr, inout float dg, inout float db) {
  if (scale <= 0) return;
  if (adj.x == 0.0 && adj.y == 0.0 && adj.z == 0.0 && adj.w == 0.0) return;
  dr += compAdjust(scale, rn, adj.x, adj.w, rel);
  dg += compAdjust(scale, gn, adj.y, adj.w, rel);
  db += compAdjust(scale, bn, adj.z, adj.w, rel);
}

void main() {
  vec4 tex = texture(u_image, v_uv);
  ivec3 c = ivec3(tex.rgb * 255.0 + 0.5);
  int r = c.r, g = c.g, b = c.b;

  int mn = min(r, min(g, b));
  int mx = max(r, max(g, b));
  int md = r + g + b - mn - mx;

  float rn = float(r) * INV255;
  float gn = float(g) * INV255;
  float bn = float(b) * INV255;

  float rel = float(u_mode);
  float dr = 0.0, dg = 0.0, db = 0.0;

  if (r == mx)              addRange(u_adj[0], mx - md, rn, gn, bn, rel, dr, dg, db);
  if (b == mn)              addRange(u_adj[1], md - mn, rn, gn, bn, rel, dr, dg, db);
  if (g == mx)              addRange(u_adj[2], mx - md, rn, gn, bn, rel, dr, dg, db);
  if (r == mn)              addRange(u_adj[3], md - mn, rn, gn, bn, rel, dr, dg, db);
  if (b == mx)              addRange(u_adj[4], mx - md, rn, gn, bn, rel, dr, dg, db);
  if (g == mn)              addRange(u_adj[5], md - mn, rn, gn, bn, rel, dr, dg, db);
  if (r > 128 && g > 128 && b > 128)
                            addRange(u_adj[6], 2 * mn - 255, rn, gn, bn, rel, dr, dg, db);
  if ((r | g | b) != 0 && !(r == 255 && g == 255 && b == 255))
                            addRange(u_adj[7], ((510 - (abs(2 * mx - 255) + abs(2 * mn - 255))) + 1) >> 1,
                                     rn, gn, bn, rel, dr, dg, db);
  if (r < 128 && g < 128 && b < 128)
                            addRange(u_adj[8], 255 - 2 * mx, rn, gn, bn, rel, dr, dg, db);

  float ro = clamp(float(r) + dr, 0.0, 255.0);
  float go = clamp(float(g) + dg, 0.0, 255.0);
  float bo = clamp(float(b) + db, 0.0, 255.0);
  fragColor = vec4(vec3(float(int(ro + 0.5)), float(int(go + 0.5)), float(int(bo + 0.5))) * INV255, tex.a);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader compile failed: ' + log);
  }
  return sh;
}

/** @returns {object|null} null when WebGL2 or the shader is unavailable. */
export function createEngine() {
  let gl = null;
  try {
    const canvas = document.createElement('canvas');
    const opts = { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true,
                   alpha: true, depth: false, stencil: false };
    gl = canvas.getContext('webgl2', opts);
    if (!gl) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('link failed: ' + gl.getProgramInfoLog(prog));
    }
    gl.useProgram(prog);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    const uImage = gl.getUniformLocation(prog, 'u_image');
    const uAdj = gl.getUniformLocation(prog, 'u_adj[0]');
    const uMode = gl.getUniformLocation(prog, 'u_mode');
    const flat = new Float32Array(RANGES.length * 4);
    gl.uniform1i(uImage, 0);

    const engine = {
      canvas,
      get maxTextureSize() { return gl.getParameter(gl.MAX_TEXTURE_SIZE); },
      label: 'GPU',

      /** Draw `src` (canvas/bitmap/image) through the adjustment.
       *  @returns the WebGL canvas, display-ready (drawImage it). */
      render(src, settings, mode) {
        const w = src.width, h = src.height;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        for (let i = 0; i < RANGES.length; i++) {
          const a = (settings && settings[RANGES[i]]) || [0, 0, 0, 0];
          flat[i * 4] = a[0] || 0; flat[i * 4 + 1] = a[1] || 0;
          flat[i * 4 + 2] = a[2] || 0; flat[i * 4 + 3] = a[3] || 0;
        }
        gl.viewport(0, 0, w, h);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.uniform4fv(uAdj, flat);
        gl.uniform1i(uMode, mode === 'relative' ? 1 : 0);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.flush();
        return canvas;
      },

      /** GPU render read back as a top-down RGBA byte array (parity harness). */
      renderPixels(src, settings, mode) {
        const w = src.width, h = src.height;
        const out = this.render(src, settings, mode);
        const buf = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);  // row 0 = bottom
        const flipped = new Uint8ClampedArray(w * h * 4);
        const stride = w * 4;
        for (let y = 0; y < h; y++) {
          const src0 = (h - 1 - y) * stride, dst0 = y * stride;
          for (let x = 0; x < stride; x++) flipped[dst0 + x] = buf[src0 + x];
        }
        return { data: flipped, width: w, height: h, canvas: out };
      },

      dispose() {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      },
    };
    return engine;
  } catch (err) {
    try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch (_) {}
    if (typeof console !== 'undefined') console.warn('[selective-color] GPU path unavailable:', err);
    return null;
  }
}
