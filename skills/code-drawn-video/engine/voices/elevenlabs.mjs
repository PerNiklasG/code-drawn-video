// ElevenLabs text-to-speech with ELEVENLABS_API_KEY (https://elevenlabs.io/app/settings/api-keys).
// `voice` is an ElevenLabs voice_id; `node scripts/audition.mjs --list` prints the ones on the account.
// The voice-direction prompt is not sent: ElevenLabs takes its character from the chosen voice.
// UNTESTED REFERENCE ADAPTER: written against the public API documentation, never run by the skill's author.
import { pcm16ToFloat, postJson, requireKey } from './wav.mjs';

export const meta = {
  id: 'elevenlabs',
  label: 'ElevenLabs (ELEVENLABS_API_KEY) — untested reference adapter',
  needsSacrificeTail: false,
  supportsPrompt: false,
  key: 'ELEVENLABS_API_KEY',
  untested: true,
  defaultVoice: null,
  shortlist: [],
};

const MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const SR = 44100;

export async function listVoices() {
  const key = requireKey('ELEVENLABS_API_KEY', 'https://elevenlabs.io/app/settings/api-keys');
  const res = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': key } });
  if (!res.ok) throw new Error(`ElevenLabs voices failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const { voices = [] } = await res.json();
  return voices.map(v => ({ id: v.voice_id, label: v.name, gender: v.labels?.gender, language: v.labels?.language || v.labels?.accent }));
}

export async function synthesize({ text, voice }) {
  const key = requireKey('ELEVENLABS_API_KEY', 'https://elevenlabs.io/app/settings/api-keys');
  if (!voice) throw new Error('ElevenLabs needs a voice_id in video.json voice.voice (list them: node scripts/audition.mjs --list)');
  const res = await postJson(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_${SR}`,
    { 'xi-api-key': key },
    { text, model_id: MODEL },
    'ElevenLabs TTS',
  );
  return { pcm: pcm16ToFloat(Buffer.from(await res.arrayBuffer())), sampleRate: SR };
}
