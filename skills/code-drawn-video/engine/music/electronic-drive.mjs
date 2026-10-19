// Genre "electronic-drive": four-on-the-floor kick, offbeat bass pumping against the kick (sidechain feel),
// supersaw pads, syncopated synth stabs, claps and hats; risers into and impacts on each section change.
// A minor, 126 BPM by default.
import { Bus, SR, adsr, boom, clap, hat, kick, makeRand, mtof, mul, osc, reverb, riser, svf } from '../lib/dsp.mjs';

export const DEFAULT_BPM = 126;
const PROG = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const ROOTS = [33, 29, 36, 31];

export function render(plan, { transpose = 0 } = {}) {
  const { BEAT, BAR, finalBar, sectionAt, intensity, changes } = plan;
  const N = Math.ceil(plan.total * SR);
  const rnd = makeRand(126);
  const drums = new Bus(N), music = new Bus(N), send = new Bus(N);
  const tr = m => m + transpose;
  const kickOn = bar => intensity(bar) >= 0.5 && sectionAt(bar) !== 'outro';
  const K = kick(rnd, { f0: 160, f1: 46, len: 0.4 });

  for (let bar = 0; bar < finalBar; bar++) {
    const t0 = bar * BAR, sec = sectionAt(bar), I = intensity(bar);
    const chord = PROG[bar % 4].map(tr), root = tr(ROOTS[bar % 4]);
    const kicks = kickOn(bar) || (sec === 'intro' && bar % 2 === 1);
    for (let b = 0; b < 4; b++) {
      const tb = t0 + b * BEAT;
      if (kicks) drums.put(K, tb, 0.95);
      if (I >= 0.75 && (b === 1 || b === 3)) drums.put(clap(rnd), tb, 0.45, 0.1);
      if (I >= 0.5) drums.put(hat(rnd, { open: true }), tb + BEAT / 2, 0.16 * I, 0.3);
      if (I >= 0.95) for (const s of [0.25, 0.75]) drums.put(hat(rnd), tb + s * BEAT, 0.12, -0.3);
      // Offbeat bass: saw + sub, ducked by the kick because it only sounds between kicks.
      if (I >= 0.5 && sec !== 'breakdown') {
        const bass = svf(osc(BEAT * 0.45, mtof(root), { type: 'saw', voices: 2, rnd }), 500 + 600 * I, 0.9, 'lp');
        mul(bass, adsr(bass.length, { a: 0.004, d: 0.12, s: 0.6, r: 0.05 }));
        music.put(bass, tb + BEAT / 2, 0.42);
        const sub = mul(osc(BEAT * 0.45, mtof(root), { type: 'sine' }), adsr(Math.ceil(BEAT * 0.45 * SR), { a: 0.004, d: 0.05, s: 0.9, r: 0.05 }));
        music.put(sub, tb + BEAT / 2, 0.5);
      }
    }
    // Supersaw pad, pumping: quiet on each kick, swelling between them.
    const padLen = BAR;
    const pad = new Float32Array(Math.ceil(padLen * SR));
    for (const m of chord) {
      const o = osc(padLen, mtof(m), { type: 'saw', voices: 5, detune: 0.18, rnd });
      for (let i = 0; i < pad.length; i++) pad[i] += o[i] / 3;
    }
    svf(pad, sec === 'breakdown' ? i => 500 + 2500 * (((bar * BAR * SR + i) / SR) % (BAR * 4)) / (BAR * 4) : 1400 + 1800 * I, 0.7, 'lp');
    const pump = new Float32Array(pad.length);
    for (let i = 0; i < pad.length; i++) {
      const inBeat = (i / SR) % BEAT;
      pump[i] = kicks ? 1 - 0.75 * Math.exp(-inBeat / 0.09) : 1;
    }
    mul(pad, pump);
    mul(pad, adsr(pad.length, { a: 0.02, d: 0.1, s: 1, r: 0.05 }));
    music.put(pad, t0, sec === 'breakdown' ? 0.32 : 0.16 + 0.08 * I, 0);
    send.put(pad, t0, 0.15);
    // Syncopated stabs in the full sections.
    if (I >= 0.8) {
      for (const s of [0.75, 1.5, 2.75, 3.5]) {
        const st = new Float32Array(Math.ceil(0.18 * SR));
        for (const m of chord) { const o = osc(0.18, mtof(m + 12), { type: 'saw', voices: 3, rnd }); for (let i = 0; i < st.length; i++) st[i] += o[i] / 3; }
        svf(st, 3200, 0.8, 'lp');
        mul(st, adsr(st.length, { a: 0.002, d: 0.09, s: 0.2, r: 0.04 }));
        music.put(st, t0 + s * BEAT, 0.28, s % 1 ? 0.35 : -0.35);
        send.put(st, t0 + s * BEAT, 0.25);
      }
    }
  }
  for (const b of changes) {
    const at = b * BAR;
    const r = riser(rnd, { len: Math.min(2 * BAR, 3.5) });
    music.put(r, at - r.length / SR, 0.22);
    drums.put(boom(rnd, { len: 1.6 }), at, 0.55);
  }
  // Final chord and hit.
  const end = finalBar * BAR;
  drums.put(K, end, 1);
  drums.put(boom(rnd, { len: 2.5 }), end, 0.6);
  const fin = new Float32Array(Math.ceil(2.6 * SR));
  for (const m of PROG[0].map(tr)) { const o = osc(2.6, mtof(m), { type: 'saw', voices: 5, detune: 0.2, rnd }); for (let i = 0; i < fin.length; i++) fin[i] += o[i] / 3; }
  svf(fin, 1800, 0.7, 'lp');
  mul(fin, adsr(fin.length, { a: 0.01, d: 0.3, s: 0.5, r: 1.8 }));
  music.put(fin, end, 0.3);
  send.put(fin, end, 0.4);

  const out = new Bus(N);
  out.mix(drums);
  out.mix(music);
  out.mix(reverb(send, { size: 1.1, wet: 0.9 }));
  return out;
}
