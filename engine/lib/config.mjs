// Loads the per-video config files from the build folder and refuses to run while any value is still "TODO".
//   video.json   script lines, voice, language, word lists, music and mix settings
//   palette.json colours sampled from the reference art
//   fonts.json   handwriting + UI font files and families
//   style.json   the chosen look: a preset from styles/ plus this video's overrides
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILD = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Every engine script imports this module: print a failure as one readable line (DEBUG=1 for the stack).
process.on('uncaughtException', e => {
  console.error(process.env.DEBUG ? e : `error: ${e && e.message ? e.message : e}`);
  process.exit(1);
});

const HINT = {
  'video.json': 'Fill in the lines, voice provider, voice and prompt (references/customize.md).',
  'palette.json': 'Sample the colours from the reference art: node scripts/sample-palette.mjs (references/style.md).',
  'fonts.json': 'Pick the display and UI fonts with scripts/fontcmp.mjs, put the TTFs in fonts/ (references/style.md).',
  'style.json': 'Choose a style direction with the user first, then set "preset" and overrides (references/style.md).',
};

function todoPaths(v, at = '') {
  if (typeof v === 'string') return /\bTODO\b/.test(v) ? [at || '(root)'] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => todoPaths(x, `${at}[${i}]`));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => todoPaths(x, at ? `${at}.${k}` : k));
  return [];
}

export function loadJson(name, { allowTodo = false } = {}) {
  const file = path.join(BUILD, name);
  if (!fs.existsSync(file)) throw new Error(`${name} is missing in ${BUILD}. ${HINT[name] || ''}`);
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${name} is not valid JSON: ${e.message}`); }
  const todo = allowTodo ? [] : todoPaths(data);
  if (todo.length) {
    throw new Error(`${name} still has placeholder values (TODO) at: ${todo.slice(0, 8).join(', ')}${todo.length > 8 ? ', …' : ''}\n  ${HINT[name] || ''}`);
  }
  return data;
}

const REQUIRED_PALETTE = ['background', 'ink', 'accent', 'highlight'];

// Everything the scene needs before Chrome starts, so a half-configured project fails here with a readable message.
export function checkSceneConfig() {
  const pal = loadJson('palette.json');
  const missing = REQUIRED_PALETTE.filter(k => !/^#[0-9a-f]{6}$/i.test(pal[k] || ''));
  if (missing.length) throw new Error(`palette.json needs #RRGGBB values for: ${missing.join(', ')}`);
  const fonts = loadJson('fonts.json');
  for (const role of ['display', 'ui']) {
    const f = fonts[role];
    if (!f || !f.file || !f.family) throw new Error(`fonts.json needs "${role}": { "file": "fonts/X.ttf", "family": "Name" }`);
    if (!fs.existsSync(path.join(BUILD, f.file))) throw new Error(`fonts.json ${role}.file "${f.file}" does not exist in ${BUILD}`);
  }
  const style = resolveStyle();
  for (const k of [style.background?.color, style.background?.color2, style.background?.dotColor].filter(Boolean)) {
    if (!/^#/.test(k) && !pal[k]) throw new Error(`style.json background uses palette key "${k}", which palette.json does not define`);
  }
  if (!fs.existsSync(path.join(BUILD, 'timeline.json'))) throw new Error('timeline.json is missing: run node narrate.mjs first.');
}

export function videoConfig() {
  const v = loadJson('video.json');
  if (!Array.isArray(v.lines) || !v.lines.length) throw new Error('video.json "lines" must list [id, section, text, pauseSeconds] entries.');
  const ids = new Set();
  const lines = v.lines.map((l, i) => {
    if (!Array.isArray(l) || l.length < 3) throw new Error(`video.json lines[${i}] must be [id, section, text, pauseSeconds]`);
    const [id, section, text, pause = 0.4] = l;
    if (ids.has(id)) throw new Error(`video.json: duplicate line id ${id}`);
    ids.add(id);
    return { id, section, text, pause: Number(pause) };
  });
  return { ...v, lines };
}

// English uses the smaller, more accurate .en Whisper models; any other language needs the multilingual ones.
export function whisperModels(cfg) {
  const lang = String(cfg.language || 'en').toLowerCase();
  const english = lang === 'en' || lang.startsWith('en-');
  const w = cfg.whisper || {};
  return {
    english,
    language: lang.split('-')[0],
    align: process.env.WHISPER_ALIGN_MODEL || w.align || (english ? 'onnx-community/whisper-base.en_timestamped' : 'onnx-community/whisper-base_timestamped'),
    verify: process.env.WHISPER_VERIFY_MODEL || w.verify || (english ? 'onnx-community/whisper-small.en' : 'onnx-community/whisper-small'),
  };
}

// Options for a Whisper pipeline call: multilingual models must be told the language.
export function whisperOptions(models, extra = {}) {
  return models.english ? extra : { ...extra, language: models.language, task: 'transcribe' };
}

function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = deepMerge(out[k], v);
  return out;
}

export const STYLES = path.join(BUILD, 'styles');

// style.json = { "preset": "<name in styles/>", ...overrides }. There is no default preset on purpose: the look
// is chosen with the user for every brand.
export function resolveStyle() {
  const own = loadJson('style.json');
  if (!own.preset) throw new Error('style.json needs "preset" (one of styles/*.json, or "custom" with every key set). ' + HINT['style.json']);
  if (own.preset === 'custom') return own;
  const file = path.join(STYLES, `${own.preset}.json`);
  if (!fs.existsSync(file)) {
    const names = fs.readdirSync(STYLES).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
    throw new Error(`style.json preset "${own.preset}" not found; presets: ${names.join(', ')}`);
  }
  return deepMerge(JSON.parse(fs.readFileSync(file, 'utf8')), own);
}
