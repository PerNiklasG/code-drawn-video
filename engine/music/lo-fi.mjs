// Genre "lo-fi": dusty swung beat, warm electric-piano seventh/ninth chords with tremolo, round sine bass,
// vinyl crackle and hiss, everything low-passed. F major-ish jazz changes, 84 BPM by default.
import { Bus, SR, adsr, expDecay, hat, kick, lp1, makeRand, mtof, mul, noise, osc, reverb, snare, svf } from '../lib/dsp.mjs';

export const DEFAULT_BPM = 84;
const PROG = [[50, 53, 57, 60, 64], [43, 53, 57, 59, 64], [48, 52, 55, 59, 62], [45, 52, 55, 60, 64]]; // Dm9 G13 Cmaj9 Am7
const SWING = 0.1;

function ep(rnd, m, len) {
  const n = Math.ceil(len * SR);
  const f = mtof(m);
  const out = osc(len, f, { type: 'sine' });
  const h2 = osc(len, f * 2, { type: 'sine' });
  const bell = mul(osc(len, f * 4, { type: 'sine' }), expDecay(n, 0.04));
  for (let i = 0; i < n; i++) out[i] = (out[i] + h2[i] * 0.3 * Math.exp(-i / (0.4 * SR)) + bell[i] * 0.2) * (1 + 0.15 * Math.sin(2 * Math.PI * 4.5 * i / SR));
  return mul(out, adsr(n, { a: 0.006, d: 0.8, s: 0.45, r: 0.4 }));
}

export function render(plan, { transpose = 0 } = {}) {
  const { BEAT, BAR, finalBar, sectionAt, intensity } = plan;
  const N = Math.ceil(plan.total * SR);
  const rnd = makeRand(84);
  const drums = new Bus(N), music = new Bus(N), send = new Bus(N);
  const tr = m => m + transpose;
  const K = kick(rnd, { f0: 110, f1: 48, len: 0.35, click: 0.1 });

  for (let bar = 0; bar < finalBar; bar++) {
    const t0 = bar * BAR, sec = sectionAt(bar), I = intensity(bar);
    const chord = PROG[bar % 4].map(tr);
    chord.forEach((m, k) => {
      const v = ep(rnd, m, BAR * 0.95);
      music.put(v, t0 + k * 0.018, 0.13, (k / 4 - 0.5) * 0.6);
      send.put(v, t0 + k * 0.018, 0.1);
    });
    const bass = mul(osc(BEAT * 1.8, mtof(chord[0] - 12), { type: 'sine' }), adsr(Math.ceil(BEAT * 1.8 * SR), { a: 0.01, d: 0.3, s: 0.6, r: 0.2 }));
    if (I >= 0.5) { music.put(bass, t0, 0.45); music.put(bass, t0 + 2.5 * BEAT, 0.35); }
    if (sec === 'breakdown' || I < 0.4 && sec !== 'intro') continue;
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * BEAT;
      if (b === 0 || (b === 2 && I >= 0.5)) drums.put(K, tb, 0.7);
      if (b === 2 && I >= 0.8) drums.put(K, tb + BEAT * (0.5 + SWING), 0.45);
      if (b === 1 || b === 3) drums.put(lp1(snare(rnd, { mix: 0.85 }), 5000), tb, 0.3);
      drums.put(hat(rnd), tb, 0.1, 0.3);
      drums.put(hat(rnd), tb + BEAT * (0.5 + SWING), 0.07, 0.3);
    }
  }
  // Vinyl: hiss plus sparse crackles.
  const hiss = lp1(noise(N, rnd), 4000);
  for (let i = 0; i < N; i++) {
    hiss[i] *= 0.012;
    if (rnd.rand() < 0.00025) hiss[i] += rnd.sym() * 0.25;
  }
  const end = finalBar * BAR;
  PROG[0].map(tr).forEach((m, k) => { const v = ep(rnd, m, 3); music.put(v, end + k * 0.03, 0.14); send.put(v, end, 0.15); });

  const out = new Bus(N);
  out.mix(drums);
  out.mix(music);
  out.mix(reverb(send, { size: 0.9, damp: 0.6, wet: 0.8 }));
  svf(out.L, 5500, 0.7, 'lp'); svf(out.R, 5500, 0.7, 'lp');
  for (let i = 0; i < N; i++) { out.L[i] += hiss[i]; out.R[i] += hiss[(i + 977) % N]; }
  return out;
}
