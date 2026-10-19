// Voices one passage with several voices of one provider, so the voice is chosen by ear, not by name.
//   node scripts/audition.mjs --provider kokoro                         the provider's shortlist, sample text
//   node scripts/audition.mjs --provider openai --voices coral,sage     these voices
//   node scripts/audition.mjs --provider kokoro --list                  print every voice the provider offers
//   ... --text "Your own passage."                                      default: the first lines of video.json
// Writes <project>/voice-samples/<provider>-<voice>.wav. Uses the prompt from video.json voice.prompt
// (or --prompt "..."). Cloud providers bill per character: say so before a large audition.
import fs from 'node:fs';
import path from 'node:path';
import { BUILD as B, loadJson } from '../lib/config.mjs';
import { loadVoice } from '../voices/index.mjs';
import { writeWav16 } from '../voices/wav.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const cfg = loadJson('video.json', { allowTodo: true });
const isTodo = v => typeof v !== 'string' || /\bTODO\b/.test(v);

const provider = opt('provider') || (!isTodo(cfg.voice?.provider) ? cfg.voice.provider : null);
if (!provider) throw new Error('pass --provider kokoro|gemini|openai|elevenlabs (or set voice.provider in video.json)');
const voice = await loadVoice(provider);
if (provider === 'recorded') throw new Error('"recorded" has nothing to audition: record a short passage and listen to it.');
if (voice.meta.untested) console.log(`note: ${provider} is an untested reference adapter (references/voices.md)`);

if (args.includes('--list')) {
  for (const v of await voice.listVoices()) console.log([v.id, v.label, v.gender, v.language, v.note].filter(Boolean).join('  ·  '));
  process.exit(0);
}

const scriptLines = (cfg.lines || []).map(l => l[2]).filter(t => !isTodo(t));
const TEXT = opt('text') || (scriptLines.length ? scriptLines.slice(0, 4).join(' ') :
  'Most mornings start the same way. Coffee, a long list, and not enough time. ' +
  'So we built something small that does one job well. Here is how it works.');
const prompt = opt('prompt') || (!isTodo(cfg.voice?.prompt) ? cfg.voice.prompt : '');
const voices = (opt('voices') || voice.meta.shortlist.join(',')).split(',').map(s => s.trim()).filter(Boolean);
if (!voices.length) throw new Error(`${provider} has no default shortlist: list voices with --list and pass --voices id1,id2`);
const sacrifice = voice.meta.needsSacrificeTail ? ` ${cfg.voice?.sacrifice || 'Thank you.'}` : '';

const OUT = path.join(B, '..', 'voice-samples');
fs.mkdirSync(OUT, { recursive: true });
for (const name of voices) {
  try {
    const r = await voice.synthesize({ text: TEXT + sacrifice, voice: name, prompt, language: cfg.language || 'en' });
    const file = path.join(OUT, `${provider}-${name}.wav`);
    writeWav16(file, r.pcm, r.sampleRate);
    console.log(`${path.basename(file)}  ${(r.pcm.length / r.sampleRate).toFixed(1)} s`);
  } catch (e) {
    console.error(`${name}: ${e.message}`);
    if (/is not set/.test(e.message)) process.exit(1);
  }
}
console.log(`samples in ${OUT}${sacrifice ? ` (each ends with the throwaway "${sacrifice.trim()}")` : ''}`);
