// Transcribes every audio/lines/<id>.wav with Whisper and compares it with the script text in timeline.json.
//   node verify-words.mjs
// OK = same words. DIFF = read it: a misheard name is fine (add a soundalike), a missing or chopped word is not.
// SUSPECT = speech runs to within 0.1 s of the clip's end, which is how a cut-off word looks.
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from '@huggingface/transformers';
import { tokens } from './align.mjs';
import { BUILD as B, videoConfig, whisperModels, whisperOptions } from './lib/config.mjs';
import { decodeAudio } from './lib/platform.mjs';

const SR = 16000;
const END_MARGIN = 0.1;
const models = whisperModels(videoConfig());
const asr = await pipeline('automatic-speech-recognition', models.align, { dtype: 'fp32' });
// Word boundaries and apostrophes are ignored ("play time" = "playtime", "app's" = "apps"); the words must match.
const norm = s => tokens(s).join('').replace(/'/g, '');

export async function transcribe(file) {
  const audio = decodeAudio(file, SR);
  const padded = new Float32Array(audio.length + SR);
  padded.set(audio);
  const r = await asr(padded, whisperOptions(models, { return_timestamps: 'word' }));
  return { text: r.text.trim(), words: r.chunks.map(c => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] })), dur: audio.length / SR };
}

const tl = JSON.parse(fs.readFileSync(path.join(B, 'timeline.json'), 'utf8'));
let ok = 0, diff = 0, suspect = 0;
for (const l of tl.lines) {
  const r = await transcribe(path.join(B, 'audio', 'lines', `${l.id}.wav`));
  const lastEnd = r.words.at(-1)?.e;
  const same = norm(r.text) === norm(l.text);
  const tight = lastEnd != null && lastEnd > r.dur - END_MARGIN;
  if (same) ok++; else diff++;
  if (tight) suspect++;
  console.log(`${l.id} ${same ? 'OK  ' : 'DIFF'}${tight ? ' SUSPECT' : ''} dur ${r.dur.toFixed(2)} lastWordEnd ${lastEnd?.toFixed(2)} | ${r.text}`);
}
console.log(`\n${tl.lines.length} lines: ${ok} OK, ${diff} DIFF, ${suspect} SUSPECT`);
