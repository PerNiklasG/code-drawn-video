#!/usr/bin/env node
// Genre "acoustic-gentle": ukulele, marimba, glockenspiel, pad, bass and soft drums in D major (112 BPM),
// arranged to follow the script's sections in timeline.json. Loaded by music.mjs; renders audio/music.wav
// (48 kHz, stereo, 24-bit, peak -3 dBFS), audio/music-map.json and audio/music-preview.mp3.
// video.json "music": { "bpm": 112, "transpose": 0, "sections": { "<script section id>": "<music section>" } }
// Music sections, in order: intro build full1 breakdown full2 peak outro.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BUILD as B, loadJson } from '../lib/config.mjs';
import { ffmpegPath } from '../lib/platform.mjs';

const AUDIO = path.join(B, 'audio');
const MUSIC = loadJson('video.json', { allowTodo: true }).music || {};

const SR = 48000;
const BPM = Number(MUSIC.bpm || 112);
const TRANSPOSE = Math.round(Number(MUSIC.transpose || 0));
const KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const KEY = `${KEY_NAMES[(((2 + TRANSPOSE) % 12) + 12) % 12]} major`;
const BEAT = 60 / BPM;
const BAR = 4 * BEAT;
const DEFAULT_TOTAL = 135;
const RING_OUT = 4.0;
const PEAK_DBFS = -3;
const TAU = 2 * Math.PI;

// ---------- utilities ----------
let seed = 1120517;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss() {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rand());
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const mtof = (m) => 440 * 2 ** ((m + TRANSPOSE - 69) / 12);
const humanT = (t, ms = 5) => t + clamp((gauss() * ms) / 1000, (-2.5 * ms) / 1000, (2.5 * ms) / 1000);
const humanV = (v, amt = 0.08) => v * clamp(1 + gauss() * amt, 0.75, 1.25);
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));

function onePoleLP(buf, fc) {
  const a = 1 - Math.exp((-TAU * fc) / SR);
  let z = 0;
  for (let i = 0; i < buf.length; i++) {
    z += a * (buf[i] - z);
    buf[i] = z;
  }
  return buf;
}
function onePoleHP(buf, fc) {
  const a = 1 - Math.exp((-TAU * fc) / SR);
  let z = 0;
  for (let i = 0; i < buf.length; i++) {
    z += a * (buf[i] - z);
    buf[i] -= z;
  }
  return buf;
}
function svfBP(buf, fc, q) {
  const g = Math.tan((Math.PI * fc) / SR);
  const k = 1 / q;
  const a1 = 1 / (1 + g * (g + k));
  const a2 = g * a1;
  const a3 = g * a2;
  let ic1 = 0;
  let ic2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const v3 = buf[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    buf[i] = v1;
  }
  return buf;
}
function biquadHP(buf, fc, q = 0.707) {
  const w = (TAU * fc) / SR;
  const al = Math.sin(w) / (2 * q);
  const cw = Math.cos(w);
  const a0 = 1 + al;
  const b0 = (1 + cw) / 2 / a0;
  const b1 = -(1 + cw) / a0;
  const b2 = b0;
  const a1 = (-2 * cw) / a0;
  const a2 = (1 - al) / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
  return buf;
}

const edgeStats = { notes: 0, badStart: 0, badEnd: 0 };
function applyEdges(buf, attackSamples, releaseSamples) {
  const n = buf.length;
  const A = Math.min(attackSamples, n);
  for (let i = 0; i < A; i++) buf[i] *= i / A;
  const R = Math.min(releaseSamples, n);
  for (let i = 0; i < R; i++) buf[n - 1 - i] *= i / R;
  return buf;
}
function checkEdges(buf) {
  edgeStats.notes++;
  if (Math.abs(buf[0]) > 1e-4) edgeStats.badStart++;
  if (Math.abs(buf[buf.length - 1]) > 1e-4) edgeStats.badEnd++;
}

// ---------- plan (length + section bars) ----------
const MUSIC_SECTIONS = ['intro', 'build', 'full1', 'breakdown', 'full2', 'peak', 'outro'];
// Script section id -> music section. The music should build where the story builds, break down at the low
// point, peak on the product and resolve in the call to action.
const NARRATIVE_TO_MUSIC = MUSIC.sections || {};
for (const [k, v] of Object.entries(NARRATIVE_TO_MUSIC)) {
  if (!MUSIC_SECTIONS.includes(v)) throw new Error(`video.json music.sections.${k}: "${v}" is not one of ${MUSIC_SECTIONS.join(', ')}`);
}
const MUSIC_TO_NARRATIVE = Object.fromEntries(MUSIC_SECTIONS.map(m => [m, Object.keys(NARRATIVE_TO_MUSIC).filter(k => NARRATIVE_TO_MUSIC[k] === m).join('+') || null]));
// Where unmapped music sections start, as a fraction of the video's length.
const DEFAULT_SHARE = { intro: 0, build: 0.11, full1: 0.22, breakdown: 0.47, full2: 0.62, peak: 0.76, outro: 0.9 };

function loadPlan() {
  const tp = path.join(B, 'timeline.json');
  let total = DEFAULT_TOTAL;
  let source = `default (${DEFAULT_TOTAL} s)`;
  let tl = null;
  if (fs.existsSync(tp)) {
    tl = JSON.parse(fs.readFileSync(tp, 'utf8'));
    if (Number(tl.total) > 10) total = Number(tl.total);
    source = 'timeline.json';
  }
  const totalBars = Math.floor((total - RING_OUT) / BAR);
  const bars = Object.fromEntries(MUSIC_SECTIONS.map(k => [k, Math.round(DEFAULT_SHARE[k] * totalBars)]));
  const mapped = new Set();
  for (const s of tl?.sections || []) {
    const m = NARRATIVE_TO_MUSIC[s.id];
    if (m && !mapped.has(m)) { bars[m] = Math.round(s.start / BAR); mapped.add(m); }
  }
  const finalBar = totalBars;
  // An unmapped section stays between its mapped neighbours; a short video simply skips some sections.
  MUSIC_SECTIONS.forEach((k, i) => {
    if (mapped.has(k)) return;
    const lo = Math.max(0, ...MUSIC_SECTIONS.slice(0, i).filter(x => mapped.has(x)).map(x => bars[x]));
    const hi = Math.min(finalBar - 2, ...MUSIC_SECTIONS.slice(i + 1).filter(x => mapped.has(x)).map(x => bars[x]));
    bars[k] = clamp(bars[k], lo, Math.max(lo, hi));
  });
  for (let i = 1; i < MUSIC_SECTIONS.length; i++) {
    const cur = MUSIC_SECTIONS[i];
    bars[cur] = Math.max(bars[cur], bars[MUSIC_SECTIONS[i - 1]]);
  }
  bars.outro = Math.min(bars.outro, finalBar - 2);
  for (const k of MUSIC_SECTIONS) bars[k] = Math.min(bars[k], bars.outro);
  return { total, bars, finalBar, source };
}

const plan = loadPlan();
const N = Math.ceil(plan.total * SR);
const sectionAt = (bar) => {
  let s = 'intro';
  for (const k of MUSIC_SECTIONS) if (bar >= plan.bars[k]) s = k;
  return s;
};

// ---------- harmony ----------
const CHORDS = {
  D: { uke: [62, 66, 69, 74], pad: [57, 62, 66], bass: [38, 45, 50] },
  A: { uke: [61, 64, 69, 73], pad: [57, 61, 64], bass: [45, 40, 57] },
  'A/C#': { uke: [61, 64, 69, 73], pad: [57, 61, 64], bass: [37, 40, 49] },
  Bm: { uke: [62, 66, 71, 74], pad: [59, 62, 66], bass: [47, 42, 59] },
  G: { uke: [62, 67, 71, 74], pad: [59, 62, 67], bass: [43, 38, 55] },
  Em: { uke: [64, 67, 71, 76], pad: [59, 64, 67], bass: [40, 47, 52] },
  'F#m': { uke: [61, 66, 69, 73], pad: [57, 61, 66], bass: [42, 37, 54] },
};
const PROG = {
  main: ['D', 'A', 'Bm', 'G'],
  alt: ['D', 'A/C#', 'Bm', 'G'],
  brk: ['Bm', 'G', 'D', 'A'],
};
const SECTION_PHRASES = {
  intro: ['main'],
  build: ['main', 'alt'],
  full1: ['main', 'alt'],
  breakdown: ['brk'],
  full2: ['main', 'alt'],
  peak: ['main', 'alt'],
};

function sectionChords(sec, n) {
  if (sec === 'outro') {
    if (n >= 6) {
      const body = [];
      for (let i = 0; i < n - 2; i++) body.push(PROG.main[i % 4]);
      const cad = body[body.length - 1] === 'G' ? ['Em', 'A'] : ['G', 'A'];
      return [...body, ...cad];
    }
    const out = [];
    for (let i = 0; i < n; i++) out.push(PROG.main[i % 4]);
    out[n - 1] = 'A';
    return out;
  }
  const phrases = SECTION_PHRASES[sec];
  const flat = phrases.flatMap((p) => PROG[p]);
  const out = [];
  for (let i = 0; i < n; i++) out.push(flat[i % flat.length]);
  if (n >= 2) out[n - 1] = 'A';
  if (sec === 'build' && n >= 6) out[n - 2] = 'Em';
  return out;
}

const chordByBar = [];
for (let i = 0; i < MUSIC_SECTIONS.length; i++) {
  const sec = MUSIC_SECTIONS[i];
  const start = plan.bars[sec];
  const end = i + 1 < MUSIC_SECTIONS.length ? plan.bars[MUSIC_SECTIONS[i + 1]] : plan.finalBar;
  chordByBar.push(...sectionChords(sec, end - start));
}
chordByBar.push('D');

// ---------- instruments ----------
function pluck(freq, dur, vel, { t60 = 1.3, bright = 0.45, pickPos = 0.2, bodyHz = 3600 } = {}) {
  const n = Math.max(64, Math.ceil(dur * SR));
  const y = new Float32Array(n);
  const D = SR / freq - 0.5;
  let Ni = Math.floor(D);
  let frac = D - Ni;
  if (frac < 0.15) { Ni -= 1; frac += 1; }
  const c = (1 - frac) / (1 + frac);
  const g = 0.001 ** (1 / (t60 * freq));
  const L = Ni + 1;
  const raw = new Float32Array(L);
  let lp = 0;
  for (let i = 0; i < L; i++) {
    lp += bright * (rand() * 2 - 1 - lp);
    raw[i] = lp;
  }
  const pd = Math.max(1, Math.round(pickPos * L));
  const exc = new Float32Array(L);
  let mean = 0;
  for (let i = 0; i < L; i++) {
    exc[i] = raw[i] - (i >= pd ? raw[i - pd] : 0);
    mean += exc[i];
  }
  mean /= L;
  let pk = 1e-9;
  for (let i = 0; i < L; i++) { exc[i] -= mean; pk = Math.max(pk, Math.abs(exc[i])); }
  const scale = vel / pk;
  let apX1 = 0, apY1 = 0;
  for (let i = 0; i < n; i++) {
    const d1 = i - Ni >= 0 ? y[i - Ni] : 0;
    const d2 = i - Ni - 1 >= 0 ? y[i - Ni - 1] : 0;
    const avg = 0.5 * (d1 + d2);
    const ap = c * avg + apX1 - c * apY1;
    apX1 = avg; apY1 = ap;
    y[i] = (i < L ? exc[i] * scale : 0) + g * ap;
  }
  onePoleLP(y, bodyHz);
  onePoleHP(y, 90);
  return applyEdges(y, 72, Math.min(n >> 1, Math.round(0.035 * SR)));
}

function marimba(freq, dur, vel) {
  const n = Math.ceil(dur * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const idx = 1.6 * Math.exp(-t / 0.016);
    const m = Math.sin(TAU * 4 * freq * t);
    y[i] = vel * (Math.sin(TAU * freq * t + idx * m) * Math.exp(-t / 0.45)
      + 0.16 * Math.sin(TAU * 3.93 * freq * t) * Math.exp(-t / 0.06));
  }
  onePoleLP(y, 4500);
  return applyEdges(y, 96, Math.round(0.04 * SR));
}

const GLOCK_PARTIALS = [[1, 1, 1.7], [2.756, 0.3, 0.6], [5.404, 0.12, 0.3], [8.933, 0.04, 0.15]];
function glock(freq, dur, vel) {
  const n = Math.ceil(dur * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let s = 0;
    for (const [r, a, d] of GLOCK_PARTIALS) if (freq * r < SR * 0.45) s += a * Math.sin(TAU * freq * r * t) * Math.exp(-t / d);
    y[i] = vel * s;
  }
  onePoleLP(y, 6500);
  return applyEdges(y, 48, Math.round(0.06 * SR));
}

function bass(freq, dur, vel) {
  const rel = 0.09;
  const n = Math.ceil((dur + rel) * SR);
  const y = new Float32Array(n);
  let ph = 0;
  const dph = (TAU * freq) / SR;
  const drive = 1.6;
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const att = Math.min(1, t / 0.008);
    const body = 0.62 + 0.38 * Math.exp(-t / 0.22);
    const release = t > dur ? Math.max(0, 1 - (t - dur) / rel) : 1;
    const env = att * body * release;
    const s = Math.sin(ph) + 0.3 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph);
    y[i] = (vel * Math.tanh(drive * s * env * 0.8)) / norm;
    ph += dph;
  }
  onePoleLP(y, 1000);
  return applyEdges(y, 48, 96);
}

function polyBlep(p, dt) {
  if (p < dt) { const t = p / dt; return t + t - t * t - 1; }
  if (p > 1 - dt) { const t = (p - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function padNote(freq, dur, rel, vel) {
  const n = Math.ceil((dur + rel) * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const voices = [[-9, -0.7], [0, 0], [9, 0.7]].map(([cents, pan]) => ({
    dt: (freq * 2 ** (cents / 1200)) / SR, p: rand(), gl: Math.cos(((pan + 1) * Math.PI) / 4), gr: Math.sin(((pan + 1) * Math.PI) / 4),
  }));
  const lfoPh = rand() * TAU;
  let z1L = 0, z2L = 0, z1R = 0, z2R = 0;
  const attack = 0.45;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let sl = 0, sr = 0;
    for (const v of voices) {
      const s = 2 * v.p - 1 - polyBlep(v.p, v.dt);
      v.p += v.dt;
      if (v.p >= 1) v.p -= 1;
      sl += s * v.gl;
      sr += s * v.gr;
    }
    const fc = 1100 + 350 * Math.sin(TAU * 0.13 * t + lfoPh);
    const a = 1 - Math.exp((-TAU * fc) / SR);
    z1L += a * (sl - z1L); z2L += a * (z1L - z2L);
    z1R += a * (sr - z1R); z2R += a * (z1R - z2R);
    const att = t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : 1;
    const relEnv = t > dur ? Math.max(0, 0.5 + 0.5 * Math.cos((Math.PI * (t - dur)) / rel)) : 1;
    const env = att * relEnv * vel * 0.33;
    L[i] = z2L * env;
    R[i] = z2R * env;
  }
  applyEdges(L, 96, 96);
  applyEdges(R, 96, 96);
  return { L, R };
}

function shaker(vel, dur = 0.11) {
  const n = Math.ceil(dur * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = rand() * 2 - 1;
  onePoleHP(y, 4500); onePoleHP(y, 4500); onePoleLP(y, 11000);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = t < 0.006 ? (t / 0.006) ** 2 : Math.exp(-(t - 0.006) / 0.028);
    y[i] *= env * vel;
  }
  return applyEdges(y, 24, Math.round(0.01 * SR));
}

function swell(vel, dur) {
  const n = Math.ceil(dur * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = rand() * 2 - 1;
  onePoleHP(y, 2500); onePoleLP(y, 9000);
  for (let i = 0; i < n; i++) y[i] *= vel * (i / n) ** 2.5;
  return applyEdges(y, 48, Math.round(0.03 * SR));
}

function clap(vel) {
  const dur = 0.32;
  const n = Math.ceil(dur * SR);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = rand() * 2 - 1;
  svfBP(y, 1350, 0.9);
  const bursts = [0, 0.0105, 0.0215];
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let env = 0;
    for (const tk of bursts) if (t >= tk) env += Math.min(1, (t - tk) / 0.0004) * Math.exp(-(t - tk) / 0.0045);
    if (t >= 0.024) env += 0.55 * Math.min(1, (t - 0.024) / 0.001) * Math.exp(-(t - 0.024) / 0.075);
    y[i] *= env * vel;
  }
  onePoleHP(y, 300);
  return applyEdges(y, 12, Math.round(0.03 * SR));
}

// ---------- stems ----------
const STEM_NAMES = ['uke', 'pad', 'bass', 'glock', 'mar', 'shaker', 'clap'];
const stems = Object.fromEntries(STEM_NAMES.map((k) => [k, { L: new Float32Array(N), R: new Float32Array(N) }]));
function addMono(stemName, t0, mono, gain, pan) {
  checkEdges(mono);
  const st = stems[stemName];
  const s0 = Math.round(t0 * SR);
  const a = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  const gl = Math.cos(a) * gain;
  const gr = Math.sin(a) * gain;
  for (let i = 0; i < mono.length; i++) {
    const j = s0 + i;
    if (j < 0) continue;
    if (j >= N) break;
    st.L[j] += mono[i] * gl;
    st.R[j] += mono[i] * gr;
  }
}
function addStereo(stemName, t0, { L, R }, gain) {
  checkEdges(L); checkEdges(R);
  const st = stems[stemName];
  const s0 = Math.round(t0 * SR);
  for (let i = 0; i < L.length; i++) {
    const j = s0 + i;
    if (j < 0) continue;
    if (j >= N) break;
    st.L[j] += L[i] * gain;
    st.R[j] += R[i] * gain;
  }
}

// ---------- arrangement ----------
const CFG = {
  intro: { uke: 'sparse', ukeV: 0.75, pad: 0.8, bass: null, shaker: null, clap: false, glock: 'motif', mar: null, pump: 0 },
  build: { uke: 'island', ukeV: 0.85, pad: 0.85, bass: 'half', bassV: 0.8, shaker: '8', shakerV: 0.55, clap: false, glock: 'bells', mar: 'arpLate', marV: 0.55, pump: 0.2 },
  full1: { uke: 'island', ukeV: 1, pad: 0.85, bass: 'groove', bassV: 1, shaker: '8', shakerV: 0.85, clap: true, glock: 'motif', mar: 'arp', marV: 0.55, pump: 0.35 },
  breakdown: { uke: 'ring', ukeV: 0.7, pad: 1, bass: 'whole', bassV: 0.65, shaker: null, clap: false, glock: 'bells', mar: 'arp', marV: 0.75, pump: 0 },
  full2: { uke: 'island', ukeV: 1, pad: 0.9, bass: 'groove', bassV: 1, shaker: '8', shakerV: 0.9, clap: true, glock: 'motif', mar: 'arp', marV: 0.6, pump: 0.35 },
  peak: { uke: 'island', ukeV: 1, pad: 1, bass: 'groove', bassV: 1, shaker: '16', shakerV: 1, clap: true, glock: 'motifAll', mar: 'arp', marV: 0.75, pump: 0.4 },
  outro: { uke: 'island', ukeV: 0.85, pad: 0.9, bass: 'half', bassV: 0.85, shaker: '8', shakerV: 0.5, clap: false, glock: 'motifOutro', mar: null, pump: 0.2 },
};
const STRUMS = {
  sparse: [[0, 'D', 1], [2, 'D', 0.75], [3.5, 'U', 0.45]],
  island: [[0, 'D', 1], [1, 'D', 0.7], [1.5, 'U', 0.55], [2.5, 'U', 0.6], [3, 'D', 0.8], [3.5, 'U', 0.5]],
  ring: [[0, 'D', 0.9], [2.5, 'U', 0.5]],
};
const BASS_PATTERNS = {
  half: [[0, 0, 1.8, 1], [2, 0, 1.8, 0.85]],
  groove: [[0, 0, 1.3, 1], [1.5, 0, 0.4, 0.7], [2, 1, 0.9, 0.85], [3, 2, 0.4, 0.75], [3.5, 0, 0.4, 0.7]],
  whole: [[0, 0, 3.8, 1]],
};
// [beat within phrase, midi, beats]
const MOTIF = [
  [0, 81, 1], [1, 78, 0.5], [1.5, 81, 0.5], [2, 83, 1], [3, 81, 1],
  [4, 76, 1.5], [5.5, 73, 0.5], [6, 76, 2],
  [8, 78, 1], [9, 74, 0.5], [9.5, 78, 0.5], [10, 81, 1], [11, 83, 1],
  [12, 83, 1], [13, 81, 1], [14, 79, 0.5], [14.5, 78, 0.5], [15, 76, 1],
];
const CADENCE_MELODY = [[0, 83, 1], [1, 81, 1], [2, 79, 1], [3, 78, 1], [4, 76, 1.5], [5.5, 73, 0.5], [6, 76, 1], [7, 79, 1]];
const isMotifPhrase = (b) => ['D'].includes(chordByBar[b]) && ['A', 'A/C#'].includes(chordByBar[b + 1])
  && chordByBar[b + 2] === 'Bm' && chordByBar[b + 3] === 'G';

const strumEvents = [];
const pumpDepthByBar = [];
const glockNotes = [];

function playMelody(t0, notes, vel, octaveDouble = false) {
  for (const [bt, m, beats] of notes) {
    const t = humanT(t0 + bt * BEAT, 4);
    const v = humanV(vel, 0.07) * (bt % 1 === 0 ? 1 : 0.85);
    glockNotes.push({ t, m, dur: Math.max(1.2, beats * BEAT + 0.8), v });
    if (octaveDouble) addMono('mar', t, marimba(mtof(m - 12), 1.1, humanV(0.4 * vel, 0.06)), 1, -0.35);
  }
}

const motifStarts = [];
for (let b = 0; b < plan.finalBar; b++) {
  const sec = sectionAt(b);
  const cfg = CFG[sec];
  const secStart = plan.bars[sec];
  const nextIdx = MUSIC_SECTIONS.indexOf(sec) + 1;
  const secEnd = nextIdx < MUSIC_SECTIONS.length ? plan.bars[MUSIC_SECTIONS[nextIdx]] : plan.finalBar;
  const chord = CHORDS[chordByBar[b]];
  const t0 = b * BAR;
  const rel = b - secStart;
  pumpDepthByBar[b] = cfg.pump;

  for (const [bt, dir, v] of STRUMS[cfg.uke]) strumEvents.push({ t: humanT(t0 + bt * BEAT, 6), chord, dir, v: humanV(v * cfg.ukeV, 0.08) });

  const padV = cfg.pad * (sec === 'intro' ? Math.min(1, 0.55 + 0.15 * rel) : 1);
  for (const m of chord.pad) addStereo('pad', t0, padNote(mtof(m), BAR, 0.7, humanV(padV, 0.04)), 1);

  if (cfg.bass) {
    for (const [bt, deg, beats, v] of BASS_PATTERNS[cfg.bass]) {
      addMono('bass', humanT(t0 + bt * BEAT, 4), bass(mtof(chord.bass[deg]), beats * BEAT, humanV(v * cfg.bassV, 0.06)), 1, 0);
    }
  }

  if (cfg.shaker) {
    const step = cfg.shaker === '16' ? 0.25 : 0.5;
    for (let bt = 0; bt < 4; bt += step) {
      const off = bt % 1;
      const accent = off === 0.5 ? 1 : off === 0 ? 0.55 : 0.4;
      addMono('shaker', humanT(t0 + bt * BEAT, 4), shaker(humanV(accent * cfg.shakerV, 0.12)), 1, 0.45);
    }
  }
  if (sec === 'breakdown' && b === secEnd - 1) {
    for (let bt = 0; bt < 4; bt += 0.25) addMono('shaker', humanT(t0 + bt * BEAT, 3), shaker(humanV(0.2 + 0.2 * bt, 0.08)), 1, 0.45);
  }
  const nextSec = sectionAt(b + 1);
  if (b === secEnd - 1 && ['full1', 'full2', 'peak'].includes(nextSec)) {
    addMono('shaker', t0, swell(0.5, BAR), 1, -0.2);
  }

  if (cfg.clap) {
    for (const bt of [1, 3]) addMono('clap', humanT(t0 + bt * BEAT, 5), clap(humanV(0.9, 0.08)), 1, bt === 1 ? -0.08 : 0.08);
    if (b === secEnd - 1) for (const bt of [3.5, 3.75]) addMono('clap', humanT(t0 + bt * BEAT, 3), clap(humanV(0.4, 0.1)), 1, 0.12);
  }

  const marOn = cfg.mar === 'arp' || (cfg.mar === 'arpLate' && rel >= (secEnd - secStart) / 2);
  if (marOn) {
    const order = [0, 1, 2, 3, 2, 1, 2, 3];
    order.forEach((k, i) => {
      const v = (i % 2 === 0 ? 1 : 0.7) * cfg.marV;
      addMono('mar', humanT(t0 + i * 0.5 * BEAT, 5), marimba(mtof(chord.uke[k]), 1.1, humanV(v, 0.08)), 1, -0.4);
    });
  }

  const phraseStart = rel % 4 === 0 && b + 3 < secEnd && isMotifPhrase(b);
  const motifHere = (cfg.glock === 'motif' && phraseStart && !motifStarts.some((s) => s >= secStart))
    || (cfg.glock === 'motifAll' && phraseStart);
  if (motifHere) {
    const phraseIdx = motifStarts.filter((s) => s >= secStart).length;
    motifStarts.push(b);
    playMelody(t0, MOTIF, sec === 'intro' ? 0.7 : 0.9, sec === 'peak' && phraseIdx % 2 === 1);
  }
  const inMotif = motifStarts.some((s) => b >= s && b < s + 4);
  if (!inMotif && cfg.glock === 'motifOutro' && rel === 0) {
    motifStarts.push(b);
    const n = secEnd - secStart;
    if (n >= 6) {
      playMelody(t0, MOTIF, 0.9);
      playMelody(t0 + (n - 2) * BAR, CADENCE_MELODY, 0.85);
    } else {
      playMelody(t0, MOTIF.filter(([bt]) => bt < 4 * n), 0.9);
    }
  }
  const inMotifNow = motifStarts.some((s) => b >= s && b < s + (cfg.glock === 'motifOutro' ? 99 : 4));
  if (!inMotifNow && ['bells', 'motif', 'motifAll'].includes(cfg.glock)) {
    const top = chord.uke[3] + 12;
    const beats = cfg.glock === 'bells' && sec === 'breakdown' ? [0, 2] : [0];
    for (const bt of beats) glockNotes.push({ t: humanT(t0 + bt * BEAT, 4), m: bt === 0 ? top : chord.uke[2] + 12, dur: 1.8, v: humanV(0.45, 0.08) });
  }
}

// final chord ring-out
const tFinal = plan.finalBar * BAR;
const ringDur = plan.total - tFinal;
strumEvents.push({ t: tFinal, chord: CHORDS.D, dir: 'D', v: 0.95, slow: true, final: true });
for (const m of CHORDS.D.pad) addStereo('pad', tFinal, padNote(mtof(m), 0.6, ringDur - 0.7, 0.9), 1);
addMono('bass', tFinal, bass(mtof(38), Math.max(0.5, ringDur - 1.2), 0.85), 1, 0);
[74, 78, 81, 86].forEach((m, i) => glockNotes.push({ t: tFinal + i * 0.11, m, dur: Math.min(3.5, ringDur - 0.2), v: 0.7 - i * 0.06 + (i === 3 ? 0.15 : 0) }));
pumpDepthByBar[plan.finalBar] = 0;

strumEvents.sort((a, b) => a.t - b.t);
strumEvents.forEach((ev, i) => {
  const next = strumEvents[i + 1];
  const dur = ev.final ? Math.max(0.5, plan.total - ev.t - 0.05) : Math.min(2.5, next.t - ev.t + 0.06);
  const notes = ev.dir === 'D' ? ev.chord.uke : [...ev.chord.uke].reverse();
  const gap = ev.slow ? 0.045 : ev.dir === 'D' ? 0.013 : 0.009;
  notes.forEach((m, k) => {
    const v = ev.v * (ev.dir === 'U' ? 0.75 : 1) * (1 - 0.06 * k);
    const s = pluck(mtof(m), dur - k * gap, v, { t60: ev.final ? 3.2 : 1.3, bright: ev.dir === 'U' ? 0.55 : 0.42 });
    addMono('uke', ev.t + k * gap, s, 1, -0.3 + 0.2 * (notes === ev.chord.uke ? k : 3 - k) / 3);
  });
});
for (const g of glockNotes) addMono('glock', g.t, glock(mtof(g.m), g.dur, g.v), 1, 0.3);

// sidechain-like pump on pads
{
  const { L, R } = stems.pad;
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const bar = Math.floor(t / BAR);
    const depth = pumpDepthByBar[Math.min(bar, pumpDepthByBar.length - 1)] || 0;
    if (!depth) continue;
    const p = t % BEAT;
    const g = 1 - depth * (p < 0.012 ? p / 0.012 : Math.exp(-(p - 0.012) / 0.11));
    L[i] *= g; R[i] *= g;
  }
}

// ---------- auto-balance stems ----------
const TARGET_RMS_DB = { uke: -20, pad: -26, bass: -20, glock: -24, mar: -28, shaker: -32, clap: -30 };
function rmsDb(st, a, b) {
  let s = 0;
  for (let i = a; i < b; i++) s += st.L[i] * st.L[i] + st.R[i] * st.R[i];
  return db(Math.sqrt(s / (2 * Math.max(1, b - a))));
}
// Stem levels are matched over the peak section, or over the whole track when the peak is too short to measure.
const peakTooShort = plan.bars.outro - plan.bars.peak < 2;
const measA = peakTooShort ? 0 : Math.round(plan.bars.peak * BAR * SR);
const measB = peakTooShort ? N : Math.min(N, Math.round(plan.bars.outro * BAR * SR));
const stemReport = {};
for (const k of STEM_NAMES) {
  const r = rmsDb(stems[k], measA, measB);
  const gain = 10 ** ((TARGET_RMS_DB[k] - r) / 20);
  stemReport[k] = { measuredDb: +r.toFixed(1), gainDb: +db(gain).toFixed(1) };
  const { L, R } = stems[k];
  for (let i = 0; i < N; i++) { L[i] *= gain; R[i] *= gain; }
}

// ---------- effects ----------
const REVERB_SEND = { uke: 0.2, pad: 0.3, bass: 0, glock: 0.4, mar: 0.25, shaker: 0.12, clap: 0.35 };
const DELAY_SEND = { uke: 0.06, glock: 0.3, mar: 0.12 };
const revIn = new Float32Array(N);
const dlyIn = new Float32Array(N);
const dryL = new Float32Array(N);
const dryR = new Float32Array(N);
for (const k of STEM_NAMES) {
  const { L, R } = stems[k];
  const rs = REVERB_SEND[k] || 0;
  const ds = DELAY_SEND[k] || 0;
  for (let i = 0; i < N; i++) {
    const m = 0.5 * (L[i] + R[i]);
    dryL[i] += L[i]; dryR[i] += R[i];
    if (rs) revIn[i] += m * rs;
    if (ds) dlyIn[i] += m * ds;
  }
}
for (const k of STEM_NAMES) delete stems[k];

function freeverb(input) {
  const scale = SR / 44100;
  const combLens = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apLens = [556, 441, 341, 225];
  const room = 0.84;
  const damp = 0.3;
  const pre = Math.round(0.022 * SR);
  const mk = (spread) => ({
    combs: combLens.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0, fs: 0 })),
    aps: apLens.map((l) => ({ buf: new Float32Array(Math.round((l + spread) * scale)), i: 0 })),
  });
  const chans = [mk(0), mk(23)];
  const out = [new Float32Array(N), new Float32Array(N)];
  for (let n = 0; n < N; n++) {
    const x = (n >= pre ? input[n - pre] : 0) * 0.03;
    for (let c = 0; c < 2; c++) {
      const ch = chans[c];
      let s = 0;
      for (const cb of ch.combs) {
        const o = cb.buf[cb.i];
        cb.fs = o * (1 - damp) + cb.fs * damp;
        cb.buf[cb.i] = x + cb.fs * room;
        if (++cb.i >= cb.buf.length) cb.i = 0;
        s += o;
      }
      for (const ap of ch.aps) {
        const bo = ap.buf[ap.i];
        const o = bo - s;
        ap.buf[ap.i] = s + bo * 0.5;
        if (++ap.i >= ap.buf.length) ap.i = 0;
        s = o;
      }
      out[c][n] = s;
    }
  }
  return out;
}
function pingPong(input) {
  const D = Math.round(0.75 * BEAT * SR);
  const fb = 0.38;
  const a = 1 - Math.exp((-TAU * 3200) / SR);
  const xL = new Float32Array(N);
  const xR = new Float32Array(N);
  const oL = new Float32Array(N);
  const oR = new Float32Array(N);
  let lpL = 0, lpR = 0;
  for (let i = 0; i < N; i++) {
    const tl = i >= D ? xL[i - D] : 0;
    const tr = i >= D ? xR[i - D] : 0;
    lpL += a * (tl - lpL);
    lpR += a * (tr - lpR);
    xL[i] = input[i] + fb * lpR;
    xR[i] = fb * lpL;
    oL[i] = lpL; oR[i] = lpR;
  }
  onePoleHP(oL, 350); onePoleHP(oR, 350);
  return [oL, oR];
}
const [revL, revR] = freeverb(revIn);
const [dlyL, dlyR] = pingPong(dlyIn);
function rmsPair(L, R) {
  let s = 0;
  for (let i = 0; i < N; i++) s += L[i] * L[i] + R[i] * R[i];
  return Math.sqrt(s / (2 * N));
}
const dryRms = rmsPair(dryL, dryR);
const revGain = (dryRms * 10 ** (-12 / 20)) / Math.max(1e-9, rmsPair(revL, revR));
const dlyGain = (dryRms * 10 ** (-19 / 20)) / Math.max(1e-9, rmsPair(dlyL, dlyR));

// ---------- master ----------
const outL = new Float32Array(N);
const outR = new Float32Array(N);
for (let i = 0; i < N; i++) {
  const l = dryL[i] + revL[i] * revGain + dlyL[i] * dlyGain;
  const r = dryR[i] + revR[i] * revGain + dlyR[i] * dlyGain;
  const mid = 0.5 * (l + r);
  const side = 0.5 * (l - r) * 1.15;
  outL[i] = mid + side;
  outR[i] = mid - side;
}
biquadHP(outL, 28); biquadHP(outR, 28);
let pk = 1e-9;
for (let i = 0; i < N; i++) pk = Math.max(pk, Math.abs(outL[i]), Math.abs(outR[i]));
const DRIVE = 1.3;
const satNorm = Math.tanh(DRIVE);
for (let i = 0; i < N; i++) {
  outL[i] = Math.tanh((DRIVE * outL[i]) / pk) / satNorm;
  outR[i] = Math.tanh((DRIVE * outR[i]) / pk) / satNorm;
}
const fadeIn = Math.round(0.01 * SR);
const fadeOut = Math.round(0.6 * SR);
for (let i = 0; i < fadeIn; i++) { const g = i / fadeIn; outL[i] *= g; outR[i] *= g; }
for (let i = 0; i < fadeOut; i++) {
  const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeOut);
  outL[N - 1 - i] *= g; outR[N - 1 - i] *= g;
}
let peak = 0, nan = 0, sumL = 0, sumR = 0;
for (let i = 0; i < N; i++) {
  if (!Number.isFinite(outL[i]) || !Number.isFinite(outR[i])) { nan++; outL[i] = 0; outR[i] = 0; }
  peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  sumL += outL[i]; sumR += outR[i];
}
const target = 10 ** (PEAK_DBFS / 20);
const norm = target / peak;
for (let i = 0; i < N; i++) { outL[i] *= norm; outR[i] *= norm; }

// click scan: second-difference spikes far above their local neighbourhood
function clickScan(buf) {
  const blk = Math.round(0.002 * SR);
  const vals = [];
  for (let s = 2; s + blk < N; s += blk) {
    let m = 0;
    for (let i = s; i < s + blk; i++) m = Math.max(m, Math.abs(buf[i] - 2 * buf[i - 1] + buf[i - 2]));
    vals.push(m);
  }
  let clicks = 0;
  const W = 25;
  for (let k = W; k < vals.length - W; k++) {
    let s = 0;
    for (let j = k - W; j <= k + W; j++) if (j !== k) s += vals[j];
    const avg = s / (2 * W);
    if (vals[k] > 12 * avg && vals[k] > 0.02) clicks++;
  }
  return clicks;
}

// ---------- write ----------
function writeWav24(file, L, R) {
  const n = L.length;
  const data = Buffer.alloc(n * 6);
  let o = 0;
  for (let i = 0; i < n; i++) {
    for (const v of [L[i], R[i]]) {
      const s = Math.round(clamp(v, -1, 1) * 8388607);
      data.writeIntLE(s, o, 3);
      o += 3;
    }
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 6, 28); h.writeUInt16LE(6, 32); h.writeUInt16LE(24, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
fs.mkdirSync(AUDIO, { recursive: true });
const wavPath = path.join(AUDIO, 'music.wav');
writeWav24(wavPath, outL, outR);

const sections = MUSIC_SECTIONS.map((id) => ({
  id, narrative: MUSIC_TO_NARRATIVE[id], bar: plan.bars[id], start: +(plan.bars[id] * BAR).toFixed(3),
}));
const map = {
  bpm: BPM, beat: +BEAT.toFixed(6), bar: +BAR.toFixed(6), key: KEY, sampleRate: SR,
  total: +plan.total.toFixed(3), lengthSource: plan.source,
  sections: [...sections, { id: 'finalChord', narrative: MUSIC_TO_NARRATIVE.outro, bar: plan.finalBar, start: +tFinal.toFixed(3) }],
  chords: chordByBar.map((c, b) => ({ bar: b, start: +(b * BAR).toFixed(3), chord: c })),
  motifStarts: motifStarts.map((b) => +(b * BAR).toFixed(3)),
};
fs.writeFileSync(path.join(AUDIO, 'music-map.json'), JSON.stringify(map, null, 2));

const report = {
  file: wavPath, seconds: +(N / SR).toFixed(3), samplePeakDbfs: +db(peak * norm).toFixed(2), nanSamples: nan,
  dcMeanL: +(sumL / N * norm).toExponential(2), dcMeanR: +(sumR / N * norm).toExponential(2),
  noteEdges: edgeStats, clickCandidatesL: clickScan(outL), clickCandidatesR: clickScan(outR),
  stems: stemReport, reverbGainDb: +db(revGain).toFixed(1), delayGainDb: +db(dlyGain).toFixed(1),
  sections: map.sections.map((s) => `${s.id}@${s.start}s(bar ${s.bar})`).join(' '),
  motifStarts: map.motifStarts,
};
console.log(JSON.stringify(report, null, 2));

{
  const pvStart = Math.max(0, Math.min(plan.bars.peak * BAR - BAR, N / SR - 20));
  const r = spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-ss', pvStart.toFixed(3), '-t', '20', '-i', wavPath,
    '-af', 'afade=t=in:d=0.5,afade=t=out:st=18.5:d=1.5', '-c:a', 'libmp3lame', '-b:a', '192k',
    path.join(AUDIO, 'music-preview.mp3')]);
  console.log(`preview from ${pvStart.toFixed(2)} s: ${r.status === 0 ? 'ok' : r.stderr.toString()}`);
}
