// Transcribes a finished video and checks it against the script. Only call a video done after this passes.
//   node verify-mp4.mjs ../My-Video-v1.mp4               whole file, then a word-by-word check against timeline.json
//   node verify-mp4.mjs ../My-Video-v1.mp4 0-15 40-55    only these ranges (seconds), transcript only
// Audio is read with a large output buffer, so long ranges no longer fail with ENOBUFS (the old limit was ~15 s).
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from '@huggingface/transformers';
import { alignTokens, asrWindows, reconcileCompounds, tokens } from './align.mjs';
import { BUILD as B, videoConfig, whisperModels, whisperOptions } from './lib/config.mjs';
import { capture, ffmpegPath } from './lib/platform.mjs';

const SR = 16000;
const [mp4, ...ranges] = process.argv.slice(2);
if (!mp4 || !fs.existsSync(mp4)) throw new Error('usage: node verify-mp4.mjs <video.mp4> [from-to ...]');
const models = whisperModels(videoConfig());
const asr = await pipeline('automatic-speech-recognition', models.verify, { dtype: 'fp32' });

function audio(from, to) {
  const args = ['-v', 'error'];
  if (from != null) args.push('-ss', String(from), '-to', String(to));
  args.push('-i', mp4, '-vn', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-');
  const { stdout } = capture(ffmpegPath(), args);
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

// Whisper needs a little trailing silence to finish the last word.
function padded(a) {
  const p = new Float32Array(a.length + SR);
  p.set(a);
  return p;
}

if (ranges.length) {
  for (const r of ranges) {
    const [from, to] = r.split('-').map(Number);
    const a = audio(from, to);
    const parts = [];
    for (const [x, y] of asrWindows(a, SR)) parts.push((await asr(padded(a.subarray(x, y)), whisperOptions(models))).text.trim());
    console.log(`${from}-${to}s:`, parts.join(' '));
  }
} else {
  const all = audio();
  let text = '';
  for (const [a, b] of asrWindows(all, SR)) {
    const piece = (await asr(padded(all.subarray(a, b)), whisperOptions(models))).text.trim();
    console.log(`[${(a / SR).toFixed(1)}–${(b / SR).toFixed(1)}] ${piece}`);
    text += ` ${piece}`;
  }
  const tl = JSON.parse(fs.readFileSync(path.join(B, 'timeline.json'), 'utf8'));
  const script = tl.lines.flatMap(l => tokens(l.text));
  const heard = reconcileCompounds(script, tokens(text).map(norm => ({ norm, raw: norm, s: 0, e: 0 })));
  const map = alignTokens(script, heard);
  const missing = script.map((w, i) => (map[i] < 0 ? `${i}:${w}` : null)).filter(Boolean);
  console.log(`\nscript words heard: ${script.length - missing.length}/${script.length}`);
  console.log(missing.length ? `not heard (index:word): ${missing.join(' ')}` : 'every script word was heard');
}
