// Kokoro: a local text-to-speech model (kokoro-js, ~90 MB, downloaded once on first use). Free, no account.
// English only (American "a*" and British "b*" voices). It sounds less natural than the cloud voices:
// fine for drafts and for the bundled example, but audition a cloud voice before a real video.
// Tested on macOS.
export const meta = {
  id: 'kokoro',
  label: 'Kokoro (local, free)',
  needsSacrificeTail: false,
  // The same text always gives the same audio, so re-requesting a take that failed to align cannot help.
  retries: false,
  supportsPrompt: false,
  key: null,
  defaultVoice: 'af_heart',
  shortlist: ['af_heart', 'af_bella', 'af_nicole', 'bf_emma', 'am_michael', 'am_fenrir', 'am_puck', 'bm_george'],
};

const MODEL = process.env.KOKORO_MODEL || 'onnx-community/Kokoro-82M-v1.0-ONNX';
// Kokoro truncates input beyond ~510 phonemes, so a take is voiced sentence by sentence and joined with a gap
// (video.json voice.sentenceGap, seconds).
const SENTENCE_GAP = 0.32;

let tts;
async function engine() {
  if (!tts) {
    let KokoroTTS;
    try { ({ KokoroTTS } = await import('kokoro-js')); } catch {
      throw new Error('kokoro-js is not installed. Run "npm install" in the build folder.');
    }
    tts = await KokoroTTS.from_pretrained(MODEL, { dtype: process.env.KOKORO_DTYPE || 'q8', device: 'cpu' });
  }
  return tts;
}

export async function listVoices() {
  return Object.entries((await engine()).voices).map(([id, v]) => ({
    id, label: v.name, gender: v.gender, language: v.language, note: `grade ${v.overallGrade}`,
  }));
}

const sentences = text => text.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);

export async function synthesize({ text, voice, speed = 1, sentenceGap = SENTENCE_GAP }) {
  const t = await engine();
  const parts = [];
  let sampleRate = 24000;
  for (const s of sentences(text)) {
    const audio = await t.generate(s, { voice: voice || meta.defaultVoice, speed });
    sampleRate = audio.sampling_rate;
    parts.push(audio.audio, new Float32Array(Math.round(sentenceGap * sampleRate)));
  }
  const pcm = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { pcm.set(p, o); o += p.length; }
  return { pcm, sampleRate };
}
