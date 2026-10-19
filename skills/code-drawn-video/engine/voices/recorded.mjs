// Your own recorded narration. Put the files in <project>/recordings/ (next to build/):
//   one file per script section, named after the section id:  hook.wav, problem.m4a, …
//   or one file for the whole script:                          narration.wav
// Any format ffmpeg reads works. The aligner cuts the recording into lines exactly as it does a TTS take,
// so read the script as written; a take that does not match it is reported, and you re-record that file.
import fs from 'node:fs';
import path from 'node:path';
import { BUILD } from '../lib/config.mjs';
import { decodeAudio } from '../lib/platform.mjs';

export const meta = {
  id: 'recorded',
  label: 'Your own recording',
  needsSacrificeTail: false,
  supportsPrompt: false,
  key: null,
  retries: false,
  defaultVoice: 'me',
  shortlist: [],
};

const SR = 48000;
const EXTS = ['.wav', '.flac', '.m4a', '.mp3', '.aiff', '.aif', '.ogg', '.webm'];
export const RECORDINGS = path.join(BUILD, '..', 'recordings');

function find(base) {
  for (const ext of EXTS) {
    const p = path.join(RECORDINGS, base + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export async function listVoices() {
  return [{ id: 'me', label: `files in ${RECORDINGS}` }];
}

// With one whole-script file, every line is aligned as one take; otherwise one take per section.
export function groups(lines) {
  const sections = [...new Set(lines.map(l => l.section))];
  if (find('narration') && !sections.some(s => find(s))) return [{ id: 'narration', lines }];
  return sections.map(id => ({ id, lines: lines.filter(l => l.section === id) }));
}

export async function synthesize({ section }) {
  const file = find(section);
  if (!file) {
    throw new Error(`no recording for "${section}": expected ${path.join(RECORDINGS, section)}.wav ` +
      `(or one ${path.join(RECORDINGS, 'narration')}.wav for the whole script)`);
  }
  return { pcm: decodeAudio(file, SR), sampleRate: SR, source: file };
}
