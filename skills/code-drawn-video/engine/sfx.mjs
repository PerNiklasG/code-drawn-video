// Renders the sound-effects layer audio/sfx.wav from audio/sfx-cues.json, which render.mjs writes from the
// scene's buildCues() (cue times come from line and word times, never literals). mix.mjs runs this itself.
//   node sfx.mjs
// Cue types (synthesized): whoosh, impact, boom, riser (ends at its time), pop, click, shimmer, glitch.
// video.json "sfx": { "gain": 0, "files": { "impact": "sfx/my-impact.wav" } } replaces a type with a licensed file.
// Effects are ducked a few dB while someone is speaking, so the words stay on top.
import fs from 'node:fs';
import path from 'node:path';
import { BUILD as B, loadJson } from './lib/config.mjs';
import { decodeAudio } from './lib/platform.mjs';
import * as D from './lib/dsp.mjs';

const { SR } = D;
const CFG = loadJson('video.json', { allowTodo: true }).sfx || {};
const cuesFile = path.join(B, 'audio', 'sfx-cues.json');
const tl = JSON.parse(fs.readFileSync(path.join(B, 'timeline.json'), 'utf8'));
const cues = fs.existsSync(cuesFile) ? JSON.parse(fs.readFileSync(cuesFile, 'utf8')) : [];
const SPEECH_DUCK_DB = -5;

const LEVEL = { whoosh: 0.32, impact: 0.55, boom: 0.6, riser: 0.28, pop: 0.32, click: 0.3, shimmer: 0.22, glitch: 0.22 };
const rnd = D.makeRand(77);
const peakNorm = a => { let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return p > 0 ? D.scale(a, 1 / p) : a; };
const SYNTH = {
  whoosh: c => D.whoosh(rnd, { len: c.len || 0.45 }),
  impact: () => D.add(D.boom(rnd, { len: 1.2, f0: 120, f1: 40 }), D.kick(rnd, { len: 0.3 }), 0.8),
  boom: c => D.boom(rnd, { len: c.len || 2.2 }),
  riser: c => D.riser(rnd, { len: c.len || 1.5 }),
  pop: c => D.popBlip(rnd, { f: c.f || 900 }),
  click: () => D.click(rnd),
  shimmer: () => D.shimmer(rnd),
  glitch: () => D.glitchBurst(rnd),
};

const fileCache = {};
function sound(c) {
  const file = CFG.files?.[c.type];
  if (file) {
    const p = path.resolve(B, file);
    if (!fs.existsSync(p)) throw new Error(`sfx.files.${c.type}: ${p} not found`);
    fileCache[p] ??= peakNorm(decodeAudio(p, SR));
    return fileCache[p];
  }
  if (!SYNTH[c.type]) throw new Error(`unknown sfx type "${c.type}" (known: ${Object.keys(SYNTH).join(', ')})`);
  return peakNorm(SYNTH[c.type](c));
}

const N = Math.ceil(tl.total * SR);
const bus = new D.Bus(N);
for (const c of cues) {
  const s = sound(c);
  const at = c.type === 'riser' ? c.t - s.length / SR : c.t;
  bus.put(s, at, (LEVEL[c.type] ?? 0.3) * (c.gain ?? 1), c.pan ?? 0);
}

const duck = 10 ** (SPEECH_DUCK_DB / 20), ramp = 0.08;
const env = new Float32Array(N).fill(1);
for (const l of tl.lines) {
  const a = Math.round((l.start - ramp) * SR), b = Math.round((l.end + ramp) * SR), r = Math.round(ramp * SR);
  for (let i = Math.max(0, a); i < Math.min(N, b); i++) {
    const k = Math.min(1, (i - a) / r, (b - i) / r);
    env[i] = Math.min(env[i], 1 - (1 - duck) * k);
  }
}
const gain = 10 ** ((CFG.gain || 0) / 20);
for (let i = 0; i < N; i++) {
  bus.L[i] = Math.tanh(bus.L[i] * env[i] * gain * 1.2) / 1.2;
  bus.R[i] = Math.tanh(bus.R[i] * env[i] * gain * 1.2) / 1.2;
}
D.writeWav24(path.join(B, 'audio', 'sfx.wav'), bus.L, bus.R);
const counts = cues.reduce((m, c) => ({ ...m, [c.type]: (m[c.type] || 0) + 1 }), {});
console.log(`sfx.wav: ${cues.length} cues ${JSON.stringify(counts)}`);
