// Mixes narration + music into audio/mix.wav (-14 LUFS, true peak <= -1 dBTP), muxes ../<name>.mp4 with
// video.mp4, then writes ../<name>-captioned.mp4 with the subtitles burnt in.
//   node mix.mjs                          needs video.mp4 (node render.mjs) and audio/music.wav (node music.mjs)
//   NAME=My-Video-v2 node mix.mjs         output name (default: video.json "name"); use a new name per version
//   DUCK=-22 GAP=-10 node mix.mjs         music level under speech / in pauses, dB relative to the narration
//   MUTE=Q01-Q04 node mix.mjs             mute the music from one line to another (default: video.json mix.mute, else none)
// Sound effects: when render.mjs wrote audio/sfx-cues.json, sfx.mjs renders audio/sfx.wav first and it is mixed
// in (ducked under speech, not under the music envelope) before loudness normalisation.
// Subtitles are PNGs rendered in Chrome and overlaid, because many ffmpeg builds lack drawtext and libass.
import fs from 'node:fs';
import path from 'node:path';
import { BUILD as B, loadJson } from './lib/config.mjs';
import { capture, ffmpegPath, run, streamStats } from './lib/platform.mjs';

const cfg = loadJson('video.json');
const mix = cfg.mix || {};
const NAME = process.env.NAME || cfg.name;
if (!NAME || /[\\/]/.test(NAME)) throw new Error('set a plain output name in video.json "name" (or NAME=...)');
const DUCK = Number(process.env.DUCK ?? mix.duck ?? -20);
const GAP = Number(process.env.GAP ?? mix.gap ?? -12);
const CRF = String(process.env.CRF ?? cfg.encode?.crf ?? 18);
const VOICE_LUFS = -16;
const SR = 48000;
const FPS = 30;
const OUT = path.join(B, '..', `${NAME}.mp4`);
const OUTC = path.join(B, '..', `${NAME}-captioned.mp4`);
const A = f => path.join(B, 'audio', f);
const FF = ffmpegPath();

for (const f of [path.join(B, 'video.mp4'), A('narration.wav'), A('music.wav')]) {
  if (!fs.existsSync(f)) throw new Error(`missing ${path.relative(B, f)}: run narrate.mjs, music.mjs and render.mjs first`);
}
const total = JSON.parse(fs.readFileSync(path.join(B, 'timeline.json'), 'utf8')).total;
const nsamp = Math.round(total * SR);

function lufs(file) {
  const { stderr } = capture(FF, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128', '-f', 'null', '-']);
  const m = [...stderr.matchAll(/^\s*I:\s*(-?[\d.]+|-inf)\s*LUFS/gm)].at(-1);
  if (!m || m[1] === '-inf') throw new Error(`could not measure loudness of ${file}`);
  return Number(m[1]);
}

const nl = lufs(A('narration.wav')), ml = lufs(A('music.wav'));
const ng = (VOICE_LUFS - nl).toFixed(2), mg = (VOICE_LUFS - ml).toFixed(2);
console.log(`narration ${nl} LUFS -> gain ${ng} dB; music ${ml} LUFS -> matched gain ${mg} dB, then duck ${DUCK} / gap ${GAP} dB`);

await run(process.execPath, [path.join(B, 'mix-env.mjs'), String(DUCK), String(GAP)]);
const hasSfx = fs.existsSync(A('sfx-cues.json'));
if (hasSfx) await run(process.execPath, [path.join(B, 'sfx.mjs')]);

const pre = A('mix-pre.wav');
const inputs = ['-i', A('narration.wav'), '-i', A('music.wav'), '-i', A('music-env.wav')];
if (hasSfx) inputs.push('-i', A('sfx.wav'));
await run(FF, ['-y', '-hide_banner', '-loglevel', 'error', ...inputs,
  '-filter_complex',
  `[0:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=mono,volume=${ng}dB,pan=stereo|c0=c0|c1=c0[n];` +
  `[1:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${mg}dB[m];` +
  `[2:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=mono,pan=stereo|c0=c0|c1=c0[e];` +
  '[m][e]amultiply[mb];' +
  (hasSfx ? `[3:a]aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo[x];[n][mb][x]amix=inputs=3` : '[n][mb]amix=inputs=2') +
  `:normalize=0:duration=longest,apad=whole_len=${nsamp},atrim=end_sample=${nsamp}[out]`,
  '-map', '[out]', '-c:a', 'pcm_f32le', pre]);

const { stderr: measure } = capture(FF, ['-hide_banner', '-nostats', '-i', pre, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']);
const j = JSON.parse(measure.slice(measure.lastIndexOf('{'), measure.lastIndexOf('}') + 1));
const ln = `measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}`;
await run(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-i', pre,
  '-af', `loudnorm=I=-14:TP=-1.5:LRA=11:${ln}:linear=true,aresample=${SR},aformat=sample_fmts=fltp:channel_layouts=stereo,alimiter=limit=0.72:attack=1:release=50:level=false,` +
    `apad=whole_len=${nsamp},atrim=end_sample=${nsamp},asetpts=N/SR/TB`,
  '-ar', String(SR), '-ac', '2', '-c:a', 'pcm_s24le', A('mix.wav')]);
fs.rmSync(pre);

const { stderr: final } = capture(FF, ['-hide_banner', '-nostats', '-i', A('mix.wav'), '-af', 'ebur128=peak=true', '-f', 'null', '-']);
const summary = final.slice(final.lastIndexOf('Summary:'));
const pick = re => (summary.match(re) || [])[1];
console.log(`mix.wav: integrated ${pick(/I:\s*(-?[\d.]+) LUFS/)} LUFS, LRA ${pick(/LRA:\s*([\d.]+) LU/)} LU, true peak ${pick(/Peak:\s*(-?[\d.]+) dBFS/)} dBFS`);

await run(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(B, 'video.mp4'), '-i', A('mix.wav'),
  '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(SR), '-movflags', '+faststart', OUT]);

await run(process.execPath, [path.join(B, 'render.mjs'), '--subs']);
await run(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-i', OUT, '-f', 'concat', '-safe', '0', '-i', path.join(B, 'subs', 'subs.ffconcat'),
  '-filter_complex', '[1:v]format=rgba,fps=30[s];[0:v][s]overlay=0:0:eof_action=pass:format=auto,format=yuv420p[v]',
  '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-crf', CRF, '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', OUTC]);

for (const f of [OUT, OUTC]) {
  const v = streamStats(f, 'v'), a = streamStats(f, 'a');
  console.log(`${path.basename(f)}: video ${v.frames} frames (${(v.frames / FPS).toFixed(3)} s), audio ${a.seconds.toFixed(3)} s, timeline ${total} s`);
}
