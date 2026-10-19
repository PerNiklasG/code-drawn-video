// Genre "cinematic-action": taiko-style drums, a staccato string-synth ostinato, low brass-like swells and
// "braam" hits on section changes, risers and impacts. D minor, 100 BPM by default.
import { Bus, SR, adsr, boom, makeRand, mtof, mul, osc, reverb, riser, svf, taiko } from '../lib/dsp.mjs';

export const DEFAULT_BPM = 100;
const PROG = [[50, 57, 62], [46, 53, 58], [48, 55, 60], [45, 52, 57]]; // Dm Bb C A(5)
const ARP = [0, 2, 1, 2, 0, 2, 1, 3];

function brass(rnd, notes, len, cutoffTo = 1600) {
  const n = Math.ceil(len * SR), out = new Float32Array(n);
  for (const m of notes) { const o = osc(len, mtof(m), { type: 'saw', voices: 4, detune: 0.1, rnd }); for (let i = 0; i < n; i++) out[i] += o[i] / notes.length; }
  svf(out, i => 200 + cutoffTo * Math.min(1, i / (0.35 * SR)) * (1 - 0.5 * i / n), 1.2, 'lp');
  return mul(out, adsr(n, { a: 0.05, d: 0.4, s: 0.7, r: Math.min(0.8, len * 0.4) }));
}

export function render(plan, { transpose = 0 } = {}) {
  const { BEAT, BAR, finalBar, sectionAt, intensity, changes } = plan;
  const N = Math.ceil(plan.total * SR);
  const rnd = makeRand(100);
  const drums = new Bus(N), music = new Bus(N), send = new Bus(N);
  const tr = m => m + transpose;
  const PATTERN = [[0, 1], [1.5, 0.6], [2, 0.9], [3, 0.5], [3.5, 0.7]];

  for (let bar = 0; bar < finalBar; bar++) {
    const t0 = bar * BAR, sec = sectionAt(bar), I = intensity(bar);
    const chord = PROG[bar % 4].map(tr);
    if (sec !== 'breakdown') {
      for (const [b, v] of PATTERN) {
        if (I < 0.5 && b !== 0) continue;
        drums.put(taiko(rnd, { f: 62 + (b % 1 ? 18 : 0) }), t0 + b * BEAT, 0.7 * v * (0.6 + 0.4 * I), (b % 2 ? 0.25 : -0.25));
      }
      if (I >= 0.85) for (let s = 0; s < 16; s++) drums.put(taiko(rnd, { f: 180, len: 0.25 }), t0 + s * BEAT / 4, 0.12 + 0.08 * (s % 4 === 0), s % 2 ? 0.5 : -0.5);
    }
    // Staccato ostinato (8ths), from build onwards.
    if (I >= 0.55 || sec === 'breakdown') {
      for (let s = 0; s < 8; s++) {
        const m = chord[ARP[s] % 3] + (ARP[s] === 3 ? 12 : 12);
        const note = svf(osc(BEAT * 0.4, mtof(m), { type: 'saw', voices: 3, detune: 0.08, rnd }), 2600, 0.8, 'lp');
        mul(note, adsr(note.length, { a: 0.004, d: 0.12, s: 0.25, r: 0.05 }));
        music.put(note, t0 + s * BEAT / 2, sec === 'breakdown' ? 0.16 : 0.12 + 0.06 * I, s % 2 ? 0.3 : -0.3);
        send.put(note, t0 + s * BEAT / 2, 0.2);
      }
    }
    // Low brass swell on every second bar.
    if (bar % 2 === 0) {
      const b = brass(rnd, [chord[0] - 12, chord[1] - 12], 2 * BAR, 900 + 900 * I);
      music.put(b, t0, 0.3 * (0.5 + 0.5 * I));
      send.put(b, t0, 0.2);
    }
  }
  for (const b of changes) {
    const at = b * BAR, chord = PROG[b % 4].map(tr);
    const r = riser(rnd, { len: Math.min(2 * BAR, 3.5), from: 150, to: 4000 });
    music.put(r, at - r.length / SR, 0.2);
    drums.put(boom(rnd, { len: 2.4, f0: 70, f1: 28 }), at, 0.45);
    const braam = brass(rnd, [chord[0] - 24, chord[0] - 12, chord[1] - 12], 1.8, 2400);
    music.put(braam, at, 0.5);
    send.put(braam, at, 0.4);
  }
  const end = finalBar * BAR;
  drums.put(boom(rnd, { len: 3, f0: 70, f1: 26 }), end, 0.55);
  drums.put(taiko(rnd, { f: 55, len: 2 }), end, 1);
  const fin = brass(rnd, PROG[0].map(m => tr(m) - 12), 3, 1800);
  music.put(fin, end, 0.45);
  send.put(fin, end, 0.5);

  const out = new Bus(N);
  out.mix(drums);
  out.mix(music);
  out.mix(reverb(send, { size: 1.4, damp: 0.3, wet: 1.1 }));
  return out;
}
