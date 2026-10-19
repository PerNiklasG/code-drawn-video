// OpenAI text-to-speech with OPENAI_API_KEY (https://platform.openai.com/api-keys).
// UNTESTED REFERENCE ADAPTER: written against the public API documentation, never run by the skill's author.
import { parseWav, postJson, requireKey } from './wav.mjs';

export const meta = {
  id: 'openai',
  label: 'OpenAI (OPENAI_API_KEY) — untested reference adapter',
  needsSacrificeTail: false,
  supportsPrompt: true,
  key: 'OPENAI_API_KEY',
  untested: true,
  defaultVoice: 'coral',
  shortlist: ['coral', 'sage', 'nova', 'shimmer', 'ash', 'ballad', 'onyx', 'verse'],
};

const MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

export async function listVoices() {
  return VOICES.map(id => ({ id, label: id, language: 'multilingual' }));
}

export async function synthesize({ text, voice, prompt }) {
  const key = requireKey('OPENAI_API_KEY', 'https://platform.openai.com/api-keys');
  const body = { model: MODEL, voice: voice || meta.defaultVoice, input: text, response_format: 'wav' };
  if (prompt) body.instructions = prompt;
  const res = await postJson('https://api.openai.com/v1/audio/speech', { Authorization: `Bearer ${key}` }, body, 'OpenAI TTS');
  return parseWav(Buffer.from(await res.arrayBuffer()));
}
