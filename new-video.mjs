#!/usr/bin/env node
// Sets up a new video project from the bundled engine. The location is always yours to choose.
//   node new-video.mjs <project-dir>                    engine -> <project-dir>/build, plus script/ and recordings/
//   node new-video.mjs <project-dir> --example demo     same, with the bundled example's config, scenes and script
//   node new-video.mjs <project-dir> --no-install       skip "npm install" (e.g. to link an existing node_modules)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const dirArg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--example');
if (!dirArg) {
  console.error('usage: node new-video.mjs <project-dir> [--example demo] [--no-install]');
  process.exit(1);
}
const DIR = path.resolve(dirArg);
const BUILD = path.join(DIR, 'build');
if (fs.existsSync(BUILD)) {
  console.error(`refusing: ${BUILD} already exists`);
  process.exit(1);
}

const skip = new Set(['node_modules', 'audio', 'chunks', 'preview', 'subs', 'review', 'versions']);
fs.mkdirSync(DIR, { recursive: true });
fs.cpSync(path.join(SKILL, 'engine'), BUILD, { recursive: true, filter: src => !skip.has(path.basename(src)) });
for (const d of ['script', 'recordings', 'art']) fs.mkdirSync(path.join(DIR, d), { recursive: true });
for (const d of ['versions', 'fonts']) fs.mkdirSync(path.join(BUILD, d), { recursive: true });

const example = opt('example');
if (example) {
  const ex = path.join(SKILL, 'examples', example);
  if (!fs.existsSync(ex)) {
    console.error(`no example "${example}" in ${path.join(SKILL, 'examples')}`);
    process.exit(1);
  }
  fs.cpSync(path.join(ex, 'build'), BUILD, { recursive: true });
  if (fs.existsSync(path.join(ex, 'script'))) fs.cpSync(path.join(ex, 'script'), path.join(DIR, 'script'), { recursive: true });
  if (fs.existsSync(path.join(ex, 'style-note.md'))) fs.copyFileSync(path.join(ex, 'style-note.md'), path.join(DIR, 'style-note.md'));
}

if (!args.includes('--no-install')) {
  // npm is a .cmd script on Windows, which Node only spawns through a shell; the arguments are fixed strings.
  const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: BUILD, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error('npm install failed; fix the error above and run "npm install" in the build folder.');
    process.exit(1);
  }
}
const { chromePath, ffmpegPath } = await import(pathToFileURL(path.join(BUILD, 'lib', 'platform.mjs')).href);
for (const [what, find] of [['ffmpeg', ffmpegPath], ['Chrome', chromePath]]) {
  try { console.log(`${what}: ${find()}`); } catch (e) { console.warn(`${what}: NOT FOUND. ${e.message}`); }
}
console.log(`\nready: ${BUILD}`);
console.log(example
  ? `next: cd "${BUILD}" and follow examples/${example}/README in the skill (narrate, music, render, mix).`
  : `next: agree the style direction (style.json + ${path.join(DIR, 'style-note.md')}), write ${path.join(DIR, 'script', 'script-v1.md')}, then follow the skill's workflow.`);
