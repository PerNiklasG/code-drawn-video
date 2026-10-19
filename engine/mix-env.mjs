// Writes audio/music-env.wav: a mono float32 gain envelope for the music bed, built from timeline.json.
//   node mix-env.mjs <duckDb> <gapDb>
// duck = level under narration, gap = level in pauses >= 1 s, intro and outro. Music fades out to silence exactly at
// timeline.total. Optionally it is muted from the start of one line to the end of another (0.4 s fades), for a
// stretch that should land dry: MUTE=Q01-Q04 or video.json "mix": { "mute": "Q01-Q04" }. The default is none.
import fs from 'node:fs';
import path from 'node:path';
import { BUILD as B, loadJson } from './lib/config.mjs';

const SR = 48000;
const DUCK = parseFloat(process.argv[2] ?? '-18');
const GAP = parseFloat(process.argv[3] ?? '-11');
const PRE = 0.1, POST = 0.2, MIN_GAP = 0.85, ATTACK = 0.3, RELEASE = 0.3, MUTE_FADE = 0.4, TAIL_FADE = 2.5;

const MUTE_SPEC = String(process.env.MUTE ?? loadJson('video.json', { allowTodo: true }).mix?.mute ?? 'none');
const MUTE = MUTE_SPEC === 'none' || MUTE_SPEC === '' ? null : MUTE_SPEC.split('-');
const tl = JSON.parse(fs.readFileSync(path.join(B, 'timeline.json'), 'utf8'));
const L = Object.fromEntries(tl.lines.map(l => [l.id, l]));

const regions = [];
let prevEnd = -1e9;
for (const l of tl.lines) {
  const a = l.start - PRE, b = l.end + POST;
  const last = regions[regions.length - 1];
  if (last && l.start - prevEnd < MIN_GAP) last[1] = b; else regions.push([a, b]);
  prevEnd = l.end;
}
const keys = [[0, GAP]];
for (const [a, b] of regions) keys.push([Math.max(0, a - ATTACK), GAP], [Math.max(0, a), DUCK], [b, DUCK], [b + RELEASE, GAP]);
keys.push([tl.total, GAP]);

const dbAt = t => {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, d0] = keys[i - 1], [t1, d1] = keys[i];
      const p = t1 > t0 ? (t - t0) / (t1 - t0) : 1;
      return d0 + (d1 - d0) * (0.5 - 0.5 * Math.cos(Math.PI * p));
    }
  }
  return GAP;
};
const ramp = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
if (MUTE && !(MUTE.length === 2 && L[MUTE[0]] && L[MUTE[1]])) throw new Error(`MUTE "${MUTE_SPEC}" must be two line ids from timeline.json (FIRST-LAST) or none`);
const muteAt = t => {
  if (!MUTE) return 1;
  const s = L[MUTE[0]].start, e = L[MUTE[1]].end;
  if (t < s - MUTE_FADE || t > e + MUTE_FADE) return 1;
  if (t < s) return 1 - ramp(t, s - MUTE_FADE, s);
  if (t <= e) return 0;
  return ramp(t, e, e + MUTE_FADE);
};
const tailAt = t => {
  const p = ramp(t, tl.total - TAIL_FADE, tl.total);
  return 0.5 + 0.5 * Math.cos(Math.PI * p);
};

const n = Math.round(tl.total * SR);
const data = Buffer.alloc(44 + n * 4);
data.write('RIFF', 0); data.writeUInt32LE(36 + n * 4, 4); data.write('WAVE', 8);
data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(3, 20); data.writeUInt16LE(1, 22);
data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(32, 34);
data.write('data', 36); data.writeUInt32LE(n * 4, 40);
for (let i = 0; i < n; i++) {
  const t = i / SR;
  data.writeFloatLE(Math.pow(10, dbAt(t) / 20) * muteAt(t) * tailAt(t), 44 + i * 4);
}
fs.writeFileSync(path.join(B, 'audio', 'music-env.wav'), data);
console.log(`music-env.wav: ${n} samples, duck ${DUCK} dB, gap ${GAP} dB, ${regions.length} speech regions, mute ${MUTE ? `${L[MUTE[0]].start}-${L[MUTE[1]].end}` : 'none'}`);
