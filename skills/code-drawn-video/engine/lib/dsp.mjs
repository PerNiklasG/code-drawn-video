// Small deterministic DSP kit shared by the music genres (music/*.mjs) and the sound effects (sfx.mjs).
// Everything is plain Float32Array maths at 48 kHz; randomness comes from a seeded generator.
import fs from 'node:fs';

export const SR = 48000;
export const TAU = 2 * Math.PI;
export const mtof = m => 440 * 2 ** ((m - 69) / 12);
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const db = x => 20 * Math.log10(Math.max(x, 1e-12));

export function makeRand(seed = 1) {
  let s = seed | 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { rand, sym: () => rand() * 2 - 1 };
}

// ---------- filters (in place) ----------
export function lp1(buf, fc) {
  const a = 1 - Math.exp((-TAU * fc) / SR);
  let z = 0;
  for (let i = 0; i < buf.length; i++) { z += a * (buf[i] - z); buf[i] = z; }
  return buf;
}
export function hp1(buf, fc) {
  const a = 1 - Math.exp((-TAU * fc) / SR);
  let z = 0;
  for (let i = 0; i < buf.length; i++) { z += a * (buf[i] - z); buf[i] -= z; }
  return buf;
}
// State-variable filter; fc may be a number or a function of the sample index (for sweeps).
export function svf(buf, fc, q = 0.8, mode = 'lp') {
  let ic1 = 0, ic2 = 0;
  const k = 1 / q;
  const fixed = typeof fc === 'number';
  let g = fixed ? Math.tan((Math.PI * Math.min(fc, SR * 0.45)) / SR) : 0;
  for (let i = 0; i < buf.length; i++) {
    if (!fixed) g = Math.tan((Math.PI * clamp(fc(i), 20, SR * 0.45)) / SR);
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
    const v3 = buf[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[i] = mode === 'lp' ? v2 : mode === 'bp' ? v1 : buf[i] - k * v1 - v2;
  }
  return buf;
}

// ---------- envelopes and sources ----------
export function adsr(n, { a = 0.005, d = 0.1, s = 0.7, r = 0.1, hold = null } = {}) {
  const e = new Float32Array(n);
  const A = Math.max(1, Math.round(a * SR)), D = Math.max(1, Math.round(d * SR)), R = Math.max(1, Math.round(r * SR));
  const H = hold == null ? n - R : Math.min(n - R, Math.round(hold * SR));
  for (let i = 0; i < n; i++) {
    let v;
    if (i < A) v = i / A;
    else if (i < A + D) v = 1 - (1 - s) * ((i - A) / D);
    else v = s;
    if (i >= H) v *= Math.max(0, 1 - (i - H) / R);
    e[i] = v;
  }
  return e;
}
export const expDecay = (n, tau) => Float32Array.from({ length: n }, (_, i) => Math.exp(-i / (tau * SR)));

export function noise(n, rnd) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rnd.sym();
  return out;
}

// Detuned oscillator stack. type: saw | square | sine | tri. freq may be a function of time in seconds.
export function osc(dur, freq, { type = 'saw', voices = 1, detune = 0.12, rnd = null, gain = 1 } = {}) {
  const n = Math.max(1, Math.ceil(dur * SR));
  const out = new Float32Array(n);
  for (let v = 0; v < voices; v++) {
    const cents = voices > 1 ? (v / (voices - 1) - 0.5) * 2 * detune * 100 : 0;
    const k = 2 ** (cents / 1200);
    let ph = rnd ? rnd.rand() : 0;
    for (let i = 0; i < n; i++) {
      const f = (typeof freq === 'function' ? freq(i / SR) : freq) * k;
      ph += f / SR;
      ph -= Math.floor(ph);
      let s;
      if (type === 'saw') s = 2 * ph - 1;
      else if (type === 'square') s = ph < 0.5 ? 1 : -1;
      else if (type === 'tri') s = 1 - 4 * Math.abs(ph - 0.5);
      else s = Math.sin(TAU * ph);
      out[i] += (s * gain) / voices;
    }
  }
  return out;
}
export function mul(a, b) { for (let i = 0; i < a.length; i++) a[i] *= b[i] ?? 0; return a; }
export function scale(a, g) { for (let i = 0; i < a.length; i++) a[i] *= g; return a; }
export function add(a, b, g = 1) { for (let i = 0; i < Math.min(a.length, b.length); i++) a[i] += b[i] * g; return a; }

// ---------- drums and hits ----------
export function kick(rnd, { f0 = 150, f1 = 45, len = 0.45, click = 0.4 } = {}) {
  const n = Math.round(len * SR);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    ph += (f1 + (f0 - f1) * Math.exp(-t / 0.035)) / SR;
    out[i] = Math.sin(TAU * ph) * Math.exp(-t / (len * 0.35));
  }
  const c = svf(noise(Math.round(0.006 * SR), rnd), 4000, 0.7, 'bp');
  add(out, c, click);
  return out;
}
export function snare(rnd, { len = 0.22, tone = 190, mix = 0.75 } = {}) {
  const n = Math.round(len * SR);
  const nz = mul(svf(noise(n, rnd), 3500, 0.6, 'bp'), expDecay(n, len * 0.28));
  const tn = mul(osc(len, t => tone * (1 + 0.5 * Math.exp(-t / 0.01)), { type: 'sine' }), expDecay(n, 0.04));
  return add(scale(nz, mix * 2), tn, 1 - mix);
}
export function hat(rnd, { len = 0.05, open = false } = {}) {
  const L = open ? 0.28 : len, n = Math.round(L * SR);
  return mul(hp1(svf(noise(n, rnd), 9000, 0.9, 'bp'), 6000), expDecay(n, open ? 0.09 : 0.015));
}
export function clap(rnd) {
  const n = Math.round(0.25 * SR), out = new Float32Array(n), nz = svf(noise(n, rnd), 1500, 0.9, 'bp');
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const burst = [0, 0.011, 0.022].reduce((a, o) => a + (t >= o ? Math.exp(-(t - o) / 0.006) : 0), 0);
    out[i] = nz[i] * (burst * 0.6 + Math.exp(-t / 0.07) * 0.5);
  }
  return out;
}
export function taiko(rnd, { f = 72, len = 1.1 } = {}) {
  const n = Math.round(len * SR);
  const body = mul(osc(len, t => f * (1 + 0.6 * Math.exp(-t / 0.03)), { type: 'sine' }), expDecay(n, len * 0.22));
  const skin = mul(lp1(noise(n, rnd), 900), expDecay(n, 0.05));
  return add(body, skin, 0.9);
}
// A low boom: sub drop, noise burst and a long rumble.
export function boom(rnd, { len = 2.2, f0 = 90, f1 = 32 } = {}) {
  const n = Math.round(len * SR);
  const sub = mul(osc(len, t => f1 + (f0 - f1) * Math.exp(-t / 0.15), { type: 'sine' }), expDecay(n, len * 0.3));
  const nz = mul(lp1(lp1(noise(n, rnd), 1800), 1800), expDecay(n, 0.25));
  return add(sub, nz, 1.4);
}
// A rising sweep that ends exactly at its end sample (place it so it ends on the downbeat or the cut).
export function riser(rnd, { len = 2, from = 300, to = 6000 } = {}) {
  const n = Math.round(len * SR);
  const nz = svf(noise(n, rnd), i => from * (to / from) ** (i / n), 2.5, 'bp');
  const tone = osc(len, t => 110 * 2 ** ((t / len) * 2), { type: 'saw', voices: 3, rnd });
  svf(tone, i => 400 + 5000 * (i / n) ** 2, 1, 'lp');
  const out = add(scale(nz, 1.4), tone, 0.25);
  for (let i = 0; i < n; i++) out[i] *= (i / n) ** 2;
  return out;
}
// A whoosh: a band of noise sweeping up then down, with a soft swell.
export function whoosh(rnd, { len = 0.5, peak = 2600 } = {}) {
  const n = Math.round(len * SR);
  const out = svf(noise(n, rnd), i => 300 + peak * Math.sin(Math.PI * i / n), 1.2, 'bp');
  for (let i = 0; i < n; i++) out[i] *= Math.sin(Math.PI * i / n) ** 1.5 * 1.6;
  return out;
}
export function popBlip(rnd, { f = 900, len = 0.09 } = {}) {
  const n = Math.round(len * SR);
  return mul(osc(len, t => f * (1 + 1.2 * Math.exp(-t / 0.01)), { type: 'sine' }), expDecay(n, 0.025));
}
export function click(rnd) {
  const n = Math.round(0.02 * SR);
  return mul(hp1(noise(n, rnd), 2000), expDecay(n, 0.003));
}
export function shimmer(rnd, { len = 0.9, base = 84 } = {}) {
  const n = Math.round(len * SR), out = new Float32Array(n);
  [0, 4, 7, 12, 16].forEach((st, k) => {
    const t0 = Math.round(k * 0.05 * SR);
    const tone = mul(osc(len, mtof(base + st), { type: 'sine' }), expDecay(n, 0.25));
    for (let i = 0; i + t0 < n; i++) out[i + t0] += tone[i] * 0.3;
  });
  return out;
}
export function glitchBurst(rnd, { len = 0.25 } = {}) {
  const n = Math.round(len * SR), out = new Float32Array(n);
  let hold = 0, v = 0;
  for (let i = 0; i < n; i++) {
    if (i % 400 === 0) hold = 20 + Math.floor(rnd.rand() * 200);
    if (i % hold === 0) v = rnd.sym();
    out[i] = (v > 0 ? 0.6 : -0.6) * (rnd.rand() < 0.7 ? 1 : 0) * (1 - i / n);
  }
  return svf(out, 3000, 0.7, 'lp');
}

// ---------- stereo bus ----------
export class Bus {
  constructor(n) { this.L = new Float32Array(n); this.R = new Float32Array(n); this.n = n; }
  // Adds a mono sound at time t (seconds) with equal-power pan (-1..1).
  put(mono, t, gain = 1, pan = 0) {
    const o = Math.round(t * SR);
    const gl = Math.cos((pan + 1) * Math.PI / 4) * gain * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * gain * Math.SQRT2;
    for (let i = 0; i < mono.length; i++) {
      const j = o + i;
      if (j < 0) continue;
      if (j >= this.n) break;
      this.L[j] += mono[i] * gl;
      this.R[j] += mono[i] * gr;
    }
  }
  mix(other, g = 1) { add(this.L, other.L, g); add(this.R, other.R, g); }
}

// A small stereo reverb (Schroeder: parallel combs into series allpasses), returned as a new Bus.
export function reverb(bus, { size = 1, damp = 0.4, wet = 0.3 } = {}) {
  const out = new Bus(bus.n);
  const combs = [1116, 1188, 1277, 1356].map(c => Math.round(c * size));
  const aps = [556, 441];
  for (const [src, dst, spread] of [[bus.L, out.L, 0], [bus.R, out.R, 23]]) {
    const acc = new Float32Array(bus.n);
    for (const c0 of combs) {
      const c = c0 + spread, buf = new Float32Array(c);
      let idx = 0, lp = 0;
      for (let i = 0; i < bus.n; i++) {
        const y = buf[idx];
        lp = y * (1 - damp) + lp * damp;
        buf[idx] = src[i] + lp * 0.84;
        acc[i] += y;
        idx = (idx + 1) % c;
      }
    }
    for (const a0 of aps) {
      const a = a0 + spread, buf = new Float32Array(a);
      let idx = 0;
      for (let i = 0; i < bus.n; i++) {
        const b = buf[idx], x = acc[i];
        buf[idx] = x + b * 0.5;
        acc[i] = b - x;
        idx = (idx + 1) % a;
      }
    }
    for (let i = 0; i < bus.n; i++) dst[i] = acc[i] * wet * 0.25;
  }
  return out;
}

export function normalize(bus, peakDb = -3) {
  let peak = 0;
  for (let i = 0; i < bus.n; i++) peak = Math.max(peak, Math.abs(bus.L[i]), Math.abs(bus.R[i]));
  const g = peak > 0 ? 10 ** (peakDb / 20) / peak : 1;
  scale(bus.L, g); scale(bus.R, g);
  return g;
}

export function writeWav24(file, L, R) {
  const n = L.length, data = Buffer.alloc(n * 6);
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (const v of [L[i], R[i]]) { data.writeIntLE(Math.round(clamp(v, -1, 1) * 8388607), o, 3); o += 3; }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 6, 28); h.writeUInt16LE(6, 32); h.writeUInt16LE(24, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
