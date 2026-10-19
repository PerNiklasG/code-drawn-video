// Voices the script with the provider set in video.json, aligns every take to the script with Whisper word
// timestamps, cuts each line in the pause after its last word (never inside a word), and writes the sync
// contract the renderer and mixer read: timeline.json, audio/narration.wav, audio/lines/<id>.wav, captions.srt.
//   node narrate.mjs
// Takes are cached by their exact request (provider, voice, prompt, text), so editing one line re-voices only
// that section. Delete audio/takes/<provider>/<section>_* to force a new take.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { alignTake } from './align.mjs';
import { BUILD as B, resolveStyle, videoConfig } from './lib/config.mjs';
import { decodeAudio } from './lib/platform.mjs';
import { loadVoice } from './voices/index.mjs';
import { writeWav16 } from './voices/wav.mjs';

const SR = 48000;
const SECTION_GAP_TRIM = 0.3;
const MIN_GAP = 0.15;
const MAX_ATTEMPTS = 4;

const cfg = videoConfig();
// Delivery defaults come from the style's preset (an energetic ad read vs a warm explainer); video.json wins.
let styleVoice = {};
try { styleVoice = resolveStyle().voice || {}; } catch (e) { console.log(`note: no style voice defaults (${e.message.split('\n')[0]})`); }
const V = { ...styleVoice, ...Object.fromEntries(Object.entries(cfg.voice || {}).filter(([, v]) => v != null && v !== '')) };
const voice = await loadVoice(V.provider);
const LINES = cfg.lines;
const WORD_CUES = cfg.wordCues || {};
const TEMPO = Number(process.env.TEMPO || V.tempo || 1);
const PAUSE_SCALE = Number(process.env.PAUSE_SCALE || V.pauseScale || 1);
const LEAD_IN = cfg.leadIn ?? 0.8;
const TAIL = cfg.tail ?? 2.5;
const VOICE_NAME = process.env.VOICE || V.voice || voice.meta.defaultVoice;
const useSacrifice = V.sacrificeTail ?? voice.meta.needsSacrificeTail;
const SACRIFICE = useSacrifice ? (V.sacrifice || 'Thank you.') : null;
// TTS-only respellings for words a voice mispronounces, e.g. [["Nguyen", "Win"]]. The script and captions keep
// the real spelling; add a soundalike so the aligner maps what Whisper hears back to it.
const RESPELL = (cfg.ttsRespell || []).map(([re, to]) => [new RegExp(re, 'g'), to]);
const forTts = text => RESPELL.reduce((s, [re, to]) => s.replace(re, to), text);

if (voice.meta.untested) console.log(`note: ${voice.meta.id} is an untested reference adapter (references/voices.md)`);
const takes = path.join(B, 'audio', 'takes', voice.meta.id);
fs.mkdirSync(takes, { recursive: true });
fs.mkdirSync(path.join(B, 'audio', 'lines'), { recursive: true });

const atempo = TEMPO === 1 ? null : `atempo=${TEMPO}`;

async function take(group, attempt) {
  const text = forTts(`${group.lines.map(l => l.text).join(' ')}${SACRIFICE ? ` ${SACRIFICE}` : ''}`);
  const request = { provider: voice.meta.id, voice: VOICE_NAME, prompt: V.prompt || '', language: cfg.language || 'en', text, speed: V.speed || 1, ...(V.sentenceGap != null ? { sentenceGap: V.sentenceGap } : {}) };
  if (voice.meta.id === 'recorded') {
    const r = await voice.synthesize({ ...request, section: group.id });
    return atempo ? decodeAudio(r.source, SR, atempo) : r.pcm;
  }
  const hash = crypto.createHash('sha1').update(JSON.stringify(request)).digest('hex').slice(0, 10);
  const file = path.join(takes, `${group.id}_a${attempt}_${hash}.wav`);
  if (!fs.existsSync(file)) {
    console.log(`${group.id}: voicing take ${attempt} with ${voice.meta.id}/${VOICE_NAME} …`);
    const r = await voice.synthesize({ ...request, section: group.id });
    writeWav16(file, r.pcm, r.sampleRate);
    fs.writeFileSync(`${file}.json`, JSON.stringify(request, null, 1));
  }
  return decodeAudio(file, SR, atempo);
}

function fadeEdges(pcm) {
  const out = Float32Array.from(pcm);
  const n = Math.min(out.length >> 1, Math.round(0.01 * SR));
  for (let i = 0; i < n; i++) {
    out[i] *= i / n;
    out[out.length - 1 - i] *= i / n;
  }
  return out;
}

const sections = [...new Set(LINES.map(l => l.section))];
const groups = voice.groups ? voice.groups(LINES) : sections.map(id => ({ id, lines: LINES.filter(l => l.section === id) }));
const attempts = voice.meta.retries === false ? 1 : MAX_ATTEMPTS;
const clips = {};
const wordOffsets = {};
for (const group of groups) {
  let aligned = null;
  for (let attempt = 0; attempt < attempts && !aligned; attempt++) {
    const result = await alignTake(await take(group, attempt), SR, group.lines.map(l => l.text), { sacrifice: SACRIFICE });
    console.log(`${group.id} take ${attempt}: ${result.report}`);
    if (result.ok) aligned = result;
  }
  if (!aligned) {
    throw new Error(voice.meta.id === 'recorded'
      ? `${group.id}: the recording does not match the script. Re-record it as written, or reword the script to what was said.`
      : `${group.id}: no take aligned cleanly after ${attempts} attempts. Read the "heard:" text above: add a soundalike or ` +
        'number word to video.json if Whisper only misspelled a word, otherwise reword the line.');
  }
  group.lines.forEach((l, i) => {
    clips[l.id] = fadeEdges(aligned.pieces[i].pcm);
    wordOffsets[l.id] = aligned.pieces[i].words;
  });
}

function wordCues(id, startSec) {
  const words = wordOffsets[id];
  return WORD_CUES[id].map(w => {
    const hit = [...words].reverse().find(x => x.norm === w);
    if (!hit) throw new Error(`${id}: cue word "${w}" was not heard as spelled. Cue on a word Whisper spells like the script and interpolate the rest.`);
    return { w, t: +(startSec + hit.s).toFixed(3) };
  });
}

const placed = [];
let t = LEAD_IN;
const timeline = { lines: [], sections: [] };
for (const [i, l] of LINES.entries()) {
  const pcm = clips[l.id];
  const entry = { id: l.id, section: l.section, text: l.text, start: +t.toFixed(3), end: +(t + pcm.length / SR).toFixed(3) };
  if (WORD_CUES[l.id]) entry.words = wordCues(l.id, t);
  timeline.lines.push(entry);
  placed.push({ at: t, pcm });
  if (LINES[i + 1]) t = entry.end + Math.max(MIN_GAP, l.pause * PAUSE_SCALE);
}
timeline.total = +(timeline.lines.at(-1).end + TAIL).toFixed(3);
for (const [i, sec] of sections.entries()) {
  const nextSec = sections[i + 1];
  const nextFirst = nextSec && timeline.lines.find(l => l.section === nextSec);
  timeline.sections.push({
    id: sec,
    start: i === 0 ? 0 : timeline.sections[i - 1].end,
    end: nextFirst ? +(nextFirst.start - SECTION_GAP_TRIM).toFixed(3) : timeline.total,
  });
}

const out = new Float32Array(Math.ceil(timeline.total * SR));
for (const { at, pcm } of placed) out.set(pcm, Math.round(at * SR));
let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
const gain = 10 ** (-3 / 20) / peak;
for (let i = 0; i < out.length; i++) out[i] *= gain;

writeWav16(path.join(B, 'audio', 'narration.wav'), out, SR);
for (const l of timeline.lines) {
  writeWav16(path.join(B, 'audio', 'lines', `${l.id}.wav`), out.subarray(Math.round(l.start * SR), Math.round(l.end * SR)), SR);
}
fs.writeFileSync(path.join(B, 'timeline.json'), JSON.stringify(timeline, null, 2));

const stamp = s => {
  const ms = Math.round(s * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
fs.writeFileSync(
  path.join(B, 'captions.srt'),
  timeline.lines.map((l, i) => `${i + 1}\n${stamp(l.start)} --> ${stamp(l.end)}\n${l.text}\n`).join('\n'),
);
console.log(`voice ${voice.meta.id}/${VOICE_NAME}, total ${timeline.total}s, ${timeline.lines.length} lines`);
for (const l of timeline.lines.filter(x => x.words)) console.log(`${l.id} words ${JSON.stringify(l.words)}`);
