// Aligns a voiced take to its script lines with Whisper word timestamps and cuts it into one clip per line.
// Cuts are only ever placed between two aligned words, never at a silence inside a word: a stop consonant
// ("p", "t", "k") is a silence too, and splitting on silences alone cuts words in half.
import { pipeline } from '@huggingface/transformers';
import { loadJson, videoConfig, whisperModels, whisperOptions } from './lib/config.mjs';

const ASR_SR = 16000;
const SEARCH_MARGIN = 0.12;
const LEAD_PAD = 0.04;
const TAIL_PAD = 0.1;
const MIN_MATCH_RATIO = 0.8;
// Whisper ends words early, and the closure of a final stop consonant is quieter than the pause after it,
// so the cut is searched for only in the stretch just before the next word's onset.
const CUT_BEFORE_ONSET = 0.25;

const CFG = loadJson('video.json', { allowTodo: true });
// How each digit string in the script is spoken, e.g. { "2024": ["twenty", "twenty", "four"] }.
const NUMBER_WORDS = CFG.numberWords || {};
// Whisper's misspellings of names, as [regex, script spelling] on single lowercase tokens.
const SOUNDALIKES = (CFG.soundalikes || []).map(([re, to]) => [new RegExp(re), to]);

let asr;
async function recognizer() {
  asr ??= await pipeline('automatic-speech-recognition', whisperModels(videoConfig()).align, { dtype: 'fp32' });
  return asr;
}

export function tokens(text) {
  return text
    .toLowerCase()
    .replace(/[—–-]/g, ' ')
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/\bdot (com|org|net|io|app|co)\b/g, '$1')
    .replace(/\.(com|org|net|io|app|co)\b/g, ' $1')
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}']/gu, ''))
    .filter(Boolean)
    .flatMap(w => NUMBER_WORDS[w] ?? [w])
    .map(w => SOUNDALIKES.reduce((acc, [re, to]) => (re.test(acc) ? to : acc), w));
}

function similar(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || a[0] !== b[0]) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] <= 2;
}

// Needleman–Wunsch over script tokens vs heard tokens; returns, per script token, the heard index or -1.
export function alignTokens(script, heard) {
  const n = script.length, m = heard.length;
  const cost = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 0; i <= n; i++) cost[i][0] = i;
  for (let j = 0; j <= m; j++) cost[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      cost[i][j] = Math.min(
        cost[i - 1][j - 1] + (similar(script[i - 1], heard[j - 1].norm) ? 0 : 1),
        cost[i - 1][j] + 1,
        cost[i][j - 1] + 1,
      );
  const map = new Array(n).fill(-1);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const diag = cost[i - 1][j - 1] + (similar(script[i - 1], heard[j - 1].norm) ? 0 : 1);
    if (cost[i][j] === diag) {
      if (similar(script[i - 1], heard[j - 1].norm)) map[i - 1] = j - 1;
      i--; j--;
    } else if (cost[i][j] === cost[i - 1][j] + 1) i--;
    else j--;
  }
  return map;
}

// Whisper and the script often disagree only on word boundaries ("play time" vs "playtime"). Merge or split
// heard words so they follow the script's segmentation.
export function reconcileCompounds(script, heard) {
  const vocab = new Set(script);
  const pairs = new Map();
  for (let i = 0; i + 1 < script.length; i++) pairs.set(script[i] + script[i + 1], [script[i], script[i + 1]]);
  const out = [];
  for (let i = 0; i < heard.length; i++) {
    const w = heard[i], nx = heard[i + 1];
    if (nx && vocab.has(w.norm + nx.norm)) {
      out.push({ ...w, norm: w.norm + nx.norm, raw: `${w.raw} ${nx.raw}`, e: nx.e });
      i++;
    } else if (!vocab.has(w.norm) && pairs.has(w.norm)) {
      const [a, b] = pairs.get(w.norm), mid = w.s + (w.e - w.s) * (a.length / w.norm.length);
      out.push({ ...w, norm: a, e: mid }, { ...w, norm: b, s: mid });
    } else out.push(w);
  }
  return out;
}

function downsample(pcm, sr) {
  const k = sr / ASR_SR;
  const n = Math.floor(pcm.length / k);
  const out = new Float32Array(n + ASR_SR);
  const span = Math.max(1, Math.round(k));
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * k);
    let s = 0;
    for (let j = 0; j < span; j++) s += pcm[a + j] || 0;
    out[i] = s / span;
  }
  return out;
}

// Whisper sees 30 s at a time, and the library's own chunking of longer audio was seen to drop whole sentences
// when word timestamps are on. Longer audio is therefore split here, at the quietest point between 18 and 28 s.
// These splits only bound the recognizer's input; line cuts are still placed between aligned words.
const WINDOW_MIN = 18, WINDOW_MAX = 28;
export function asrWindows(pcm, sr) {
  const out = [];
  let a = 0;
  while (pcm.length - a > WINDOW_MAX * sr) {
    const cut = quietestPoint(pcm, sr, a / sr + WINDOW_MIN, a / sr + WINDOW_MAX);
    out.push([a, cut]);
    a = cut;
  }
  out.push([a, pcm.length]);
  return out;
}

export async function hear(pcm, sr) {
  const models = whisperModels(videoConfig());
  const asr = await recognizer();
  const words = [];
  for (const [a, b] of asrWindows(pcm, sr)) {
    const r = await asr(downsample(pcm.subarray(a, b), sr), whisperOptions(models, { return_timestamps: 'word' }));
    const off = a / sr;
    for (const c of r.chunks) {
      for (const norm of tokens(c.text)) {
        words.push({ norm, raw: c.text.trim(), s: off + c.timestamp[0], e: off + (c.timestamp[1] ?? c.timestamp[0]) });
      }
    }
  }
  return words;
}

// Quietest 20 ms window in [from, to] seconds, returned as a sample index at its centre.
function quietestPoint(pcm, sr, from, to) {
  const win = Math.round(0.02 * sr), hop = Math.round(0.005 * sr);
  const a = Math.max(0, Math.round(from * sr)), b = Math.min(pcm.length - win, Math.round(to * sr));
  let best = a, bestE = Infinity;
  for (let i = a; i <= b; i += hop) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += pcm[j] * pcm[j];
    if (e < bestE) { bestE = e; best = i; }
  }
  return best + (win >> 1);
}

function trimToSpeech(pcm, sr) {
  const thr = 10 ** (-45 / 20);
  let a = 0, b = pcm.length;
  while (a < b && Math.abs(pcm[a]) < thr) a++;
  while (b > a && Math.abs(pcm[b - 1]) < thr) b--;
  return [Math.max(0, a - Math.round(LEAD_PAD * sr)), Math.min(pcm.length, b + Math.round(TAIL_PAD * sr))];
}

// sacrifice: the throwaway sentence appended to the request, or null. It is excluded from the alignment,
// otherwise a line ending in the same word ("…with you") matches the throwaway instead of its own word.
export async function alignTake(pcm, sr, lineTexts, { sacrifice = null } = {}) {
  const lineTokens = lineTexts.map(tokens);
  const script = lineTokens.flat();
  const heardAll = reconcileCompounds(script, await hear(pcm, sr));
  const tail = sacrifice ? tokens(sacrifice) : [];
  const endsWithTail = tail.length > 0 && heardAll.length >= tail.length &&
    tail.every((w, i) => similar(w, heardAll[heardAll.length - tail.length + i].norm));
  const sacrificeAt = endsWithTail ? heardAll.length - tail.length : heardAll.length;
  const heard = heardAll.slice(0, sacrificeAt);
  const map = alignTokens(script, heard);
  const matched = map.filter(x => x >= 0).length;
  const ratio = matched / script.length;

  const spans = [];
  let k = 0;
  for (const toks of lineTokens) {
    const idx = map.slice(k, k + toks.length).filter(x => x >= 0);
    spans.push(idx.length ? { first: idx[0], last: idx.at(-1) } : null);
    k += toks.length;
  }
  const lastEndsLine = lineTokens.every((_, i) => map[lineTokens.slice(0, i + 1).flat().length - 1] >= 0);
  const firstMatched = map.find(x => x >= 0) ?? 0;
  const lastMatched = map.filter(x => x >= 0).at(-1) ?? -1;
  const extraLeading = firstMatched;
  const extraTrailing = heard.length - 1 - lastMatched;

  const report = `matched ${matched}/${script.length} words, line ends heard: ${lastEndsLine}, ` +
    `unexpected words before: ${extraLeading}, after: ${extraTrailing}`;
  if (ratio < MIN_MATCH_RATIO || spans.includes(null) || !lastEndsLine || extraLeading > 0 || extraTrailing > 0) {
    return { ok: false, report: `${report} | heard: ${heardAll.map(w => w.raw).join(' ').slice(0, 240)}` };
  }

  const cuts = [0];
  for (let i = 0; i < spans.length; i++) {
    const endT = heard[spans[i].last].e;
    const nextT = i + 1 < spans.length ? heard[spans[i + 1].first].s : heardAll[sacrificeAt]?.s;
    if (nextT == null) { cuts.push(pcm.length); continue; }
    const from = Math.max(endT - SEARCH_MARGIN / 2, nextT - CUT_BEFORE_ONSET);
    cuts.push(quietestPoint(pcm, sr, Math.min(from, nextT), Math.max(endT + 0.02, nextT + SEARCH_MARGIN / 2)));
  }

  const pieces = spans.map((span, i) => {
    const seg = pcm.subarray(cuts[i], cuts[i + 1]);
    const [a, b] = trimToSpeech(seg, sr);
    const startSec = (cuts[i] + a) / sr;
    const words = heard.slice(span.first, span.last + 1).map(w => ({ norm: w.norm, s: Math.max(0, w.s - startSec) }));
    return { pcm: seg.slice(a, b), words };
  });
  return { ok: true, report, pieces };
}
