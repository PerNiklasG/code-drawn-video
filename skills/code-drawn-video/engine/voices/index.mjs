// Voice providers. Every adapter exports the same interface:
//   meta                       { id, label, needsSacrificeTail, supportsPrompt, key, defaultVoice, shortlist, untested? }
//   listVoices()            -> [{ id, label, gender?, language?, note? }]
//   synthesize({ text, voice, prompt, language, section }) -> { pcm: Float32Array (mono), sampleRate }
// and optionally groups(lines) -> [{ id, lines }] to voice the script in other units than sections.
// To add a provider, copy openai.mjs, keep the interface, and add it to PROVIDERS.
const PROVIDERS = ['kokoro', 'gemini', 'openai', 'elevenlabs', 'recorded'];

export async function loadVoice(provider) {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`unknown voice provider "${provider}". Use one of: ${PROVIDERS.join(', ')} (references/voices.md)`);
  }
  return import(`./${provider}.mjs`);
}

export { PROVIDERS };
