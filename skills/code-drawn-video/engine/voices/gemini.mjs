// Gemini text-to-speech through the Gemini API with an API key from Google AI Studio
// (https://aistudio.google.com/apikey). No Google Cloud project needed.
// UNTESTED REFERENCE ADAPTER: written against the public API documentation, never run by the skill's author.
// Check the request/response shape against the current docs on the first run, and expect to fix small things.
import { pcm16ToFloat, postJson, requireKey } from './wav.mjs';

export const meta = {
  id: 'gemini',
  label: 'Gemini API (GEMINI_API_KEY) — untested reference adapter',
  // Gemini TTS was seen to chop the final syllable of a request; the narrator appends a throwaway sentence.
  needsSacrificeTail: true,
  supportsPrompt: true,
  key: 'GEMINI_API_KEY',
  untested: true,
  defaultVoice: 'Kore',
  shortlist: ['Kore', 'Aoede', 'Leda', 'Sulafat', 'Puck', 'Charon', 'Iapetus', 'Sadachbia'],
};

const MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts';
const VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia',
  'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix',
  'Sadachbia', 'Sadaltager', 'Sulafat'];

export async function listVoices() {
  return VOICES.map(id => ({ id, label: id, language: 'multilingual' }));
}

export async function synthesize({ text, voice, prompt }) {
  const key = requireKey('GEMINI_API_KEY', 'https://aistudio.google.com/apikey');
  // The Gemini API takes the voice direction as natural language in front of the text.
  const input = prompt ? `${prompt}\n\n${text}` : text;
  const res = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    { 'x-goog-api-key': key },
    {
      contents: [{ parts: [{ text: input }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || meta.defaultVoice } } },
      },
    },
    'Gemini TTS',
  );
  const body = await res.json();
  const part = body.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
  if (!part) throw new Error(`Gemini TTS returned no audio: ${JSON.stringify(body).slice(0, 400)}`);
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1] || 24000);
  return { pcm: pcm16ToFloat(Buffer.from(part.inlineData.data, 'base64')), sampleRate: rate };
}
