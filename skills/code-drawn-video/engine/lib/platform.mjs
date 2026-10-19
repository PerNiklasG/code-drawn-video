// Finds ffmpeg and Chrome on Windows, macOS and Linux, and runs child processes without a shell.
//   ffmpeg: FFMPEG_PATH, else PATH, else the ffmpeg-static npm package.
//   Chrome: CHROME_PATH, else the usual install locations for this platform.
// ffprobe is deliberately not needed: stream durations are read with ffmpeg itself (streamDuration).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const IS_WIN = process.platform === 'win32';

const isFile = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };

export function which(name) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').concat('') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (isFile(p)) return p;
    }
  }
  return null;
}

function fromPackage(pkg, pick) {
  try {
    const p = pick(require(pkg));
    return isFile(p) ? p : null;
  } catch { return null; }
}

const cache = {};
function resolveTool(name, envVar, pkg, pick) {
  if (cache[name]) return cache[name];
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    if (!isFile(fromEnv)) throw new Error(`${envVar} is set to "${fromEnv}", but no file exists there.`);
    return (cache[name] = fromEnv);
  }
  const found = which(name) || fromPackage(pkg, pick);
  if (!found) {
    throw new Error(
      `${name} not found. Either install it and put it on PATH, set ${envVar} to the executable, ` +
      `or run "npm install" in the build folder so the ${pkg} package can provide it ` +
      `(if npm skipped its install script, run "npm rebuild ${pkg}").`);
  }
  return (cache[name] = found);
}

export const ffmpegPath = () => resolveTool('ffmpeg', 'FFMPEG_PATH', 'ffmpeg-static', m => m.default || m);

function chromeCandidates() {
  const home = os.homedir();
  if (IS_WIN) {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap(r => [
      path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(r, 'Chromium', 'Application', 'chrome.exe'),
      path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]);
  }
  if (process.platform === 'darwin') {
    const apps = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Chromium.app/Contents/MacOS/Chromium',
      'Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
    return ['/Applications', path.join(home, 'Applications')].flatMap(d => apps.map(a => path.join(d, a)));
  }
  return ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .map(n => which(n)).filter(Boolean)
    .concat(['/usr/bin/google-chrome', '/snap/bin/chromium']);
}

export function chromePath() {
  if (cache.chrome) return cache.chrome;
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) {
    if (!isFile(fromEnv)) throw new Error(`CHROME_PATH is set to "${fromEnv}", but no file exists there.`);
    return (cache.chrome = fromEnv);
  }
  const found = chromeCandidates().find(isFile);
  if (!found) {
    throw new Error(
      'Google Chrome (or Chromium / Edge) not found. Install Chrome, or set CHROME_PATH to the browser executable, e.g.\n' +
      '  Windows (PowerShell): $env:CHROME_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\n' +
      '  macOS / Linux:        export CHROME_PATH=/path/to/chrome');
  }
  return (cache.chrome = found);
}

// Runs a command to completion with inherited output. Rejects on a non-zero exit.
export function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('close', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

// Runs a command and returns { stdout: Buffer, stderr: string }. maxBuffer is large so long audio never hits ENOBUFS.
export function capture(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { maxBuffer: 2 ** 31 - 1 });
  if (r.error) throw r.error;
  const stderr = r.stderr ? r.stderr.toString() : '';
  if (r.status !== 0 && !allowFail) throw new Error(`${path.basename(cmd)} exited with ${r.status}: ${stderr.slice(-800)}`);
  return { stdout: r.stdout, stderr, status: r.status };
}

// Decodes any audio file ffmpeg can read to mono float32 at `sr`, optionally through an ffmpeg -af chain.
export function decodeAudio(file, sr, filter = null) {
  const args = ['-v', 'error', '-i', file];
  if (filter) args.push('-af', filter);
  args.push('-ac', '1', '-ar', String(sr), '-f', 'f32le', '-');
  const { stdout } = capture(ffmpegPath(), args);
  return new Float32Array(stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.length));
}

// Duration (seconds, from the last packet's timestamp) and frame count of the first video ('v') or audio ('a')
// stream, measured by remuxing it to nowhere.
export function streamStats(file, stream) {
  const { stdout } = capture(ffmpegPath(), ['-v', 'error', '-i', file, '-map', `0:${stream}:0`, '-c', 'copy', '-f', 'null', '-progress', 'pipe:1', '-']);
  const last = re => Number([...stdout.toString().matchAll(re)].at(-1)?.[1] ?? NaN);
  return { seconds: last(/out_time_us=(\d+)/g) / 1e6, frames: last(/frame=(\d+)/g) };
}
