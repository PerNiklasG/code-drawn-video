// Writes audio/music.wav (48 kHz stereo, peak -3 dBFS) for the video, following timeline.json's sections.
//   node music.mjs
// video.json "music": { "genre": "...", "bpm": null, "transpose": 0, "sections": { "<section id>": "<music section>" },
//                       "file": null }
// Genres (synthesized in Node): acoustic-gentle, electronic-drive, cinematic-action, lo-fi. With no genre the
// style preset's music.genre is used. "file": "music/track.wav" uses a licensed track instead of synthesis.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { BUILD as B, loadJson, resolveStyle } from './lib/config.mjs';
import { capture, ffmpegPath } from './lib/platform.mjs';
import { SR, Bus, normalize, writeWav24 } from './lib/dsp.mjs';
import { makePlan } from './music/plan.mjs';

const GENRES = ['acoustic-gentle', 'electronic-drive', 'cinematic-action', 'lo-fi'];
const AUDIO = path.join(B, 'audio');
fs.mkdirSync(AUDIO, { recursive: true });
const M = loadJson('video.json', { allowTodo: true }).music || {};
const wavPath = path.join(AUDIO, 'music.wav');
const tl = JSON.parse(fs.readFileSync(path.join(B, 'timeline.json'), 'utf8'));
const TAIL_FADE = 2.5;

function preview(fromSec) {
  const start = Math.max(0, Math.min(fromSec, tl.total - 20));
  const r = spawnSync(ffmpegPath(), ['-y', '-v', 'error', '-ss', start.toFixed(3), '-t', '20', '-i', wavPath,
    '-af', 'afade=t=in:d=0.5,afade=t=out:st=18.5:d=1.5', '-c:a', 'libmp3lame', '-b:a', '192k', path.join(AUDIO, 'music-preview.mp3')]);
  console.log(`preview audio/music-preview.mp3 from ${start.toFixed(1)} s: ${r.status === 0 ? 'ok' : r.stderr.toString()}`);
}

if (M.file) {
  // A licensed track: decoded, cut to the video's length and faded out at the end.
  const src = path.resolve(B, M.file);
  if (!fs.existsSync(src)) throw new Error(`music.file ${src} not found`);
  const { stdout } = capture(ffmpegPath(), ['-v', 'error', '-i', src, '-t', String(tl.total), '-af',
    `afade=t=out:st=${Math.max(0, tl.total - TAIL_FADE)}:d=${TAIL_FADE},apad=whole_dur=${tl.total}`, '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-']);
  const f = new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
  const bus = new Bus(f.length / 2);
  for (let i = 0; i < bus.n; i++) { bus.L[i] = f[2 * i]; bus.R[i] = f[2 * i + 1]; }
  normalize(bus, -3);
  writeWav24(wavPath, bus.L, bus.R);
  console.log(`music.wav from ${src} (${(bus.n / SR).toFixed(2)} s)`);
  preview(tl.total * 0.4);
} else {
  let genre = M.genre;
  if (!genre) {
    try { genre = resolveStyle().music?.genre; } catch { /* style not chosen yet */ }
  }
  if (!GENRES.includes(genre)) throw new Error(`video.json music.genre must be one of ${GENRES.join(', ')} (or set music.file); got "${genre}"`);
  if (genre === 'acoustic-gentle') {
    await import(pathToFileURL(path.join(B, 'music', 'acoustic-gentle.mjs')).href);
  } else {
    const mod = await import(pathToFileURL(path.join(B, 'music', `${genre}.mjs`)).href);
    const plan = makePlan(Number(M.bpm || mod.DEFAULT_BPM), M.sections || {});
    const bus = mod.render(plan, { transpose: Math.round(Number(M.transpose || 0)) });
    // Fade to silence exactly at the end of the timeline.
    const n = bus.n, f0 = Math.round((tl.total - TAIL_FADE) * SR);
    for (let i = Math.max(0, f0); i < n; i++) { const g = 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, (i - f0) / (TAIL_FADE * SR))); bus.L[i] *= g; bus.R[i] *= g; }
    const g = normalize(bus, -3);
    writeWav24(wavPath, bus.L, bus.R);
    const sections = Object.entries(plan.bars).map(([k, b]) => `${k}@${(b * plan.BAR).toFixed(1)}s`).join(' ');
    fs.writeFileSync(path.join(AUDIO, 'music-map.json'), JSON.stringify({ genre, bpm: plan.bpm, bar: plan.BAR, bars: plan.bars, finalBar: plan.finalBar }, null, 1));
    console.log(`music.wav: ${genre}, ${plan.bpm} BPM, ${(n / SR).toFixed(2)} s, gain ${(20 * Math.log10(g)).toFixed(1)} dB; ${sections}`);
    preview(plan.bars.peak * plan.BAR - plan.BAR);
  }
}
