// Renders scene/index.html frame by frame in headless Chrome and encodes with ffmpeg.
//   node render.mjs                      full video -> video.mp4
//   node render.mjs --from 20 --to 32    partial range -> video.mp4 (range only)
//   node render.mjs --preview 15         every 15th frame (in range) -> preview/f_<t>.png
//   node render.mjs --times 3,12.5,40    exact timestamps -> preview/f_<t>.png
//   node render.mjs --subs               caption overlays for the captioned export -> subs/*.png + subs/subs.json
// Every run also writes audio/sfx-cues.json from the scene's buildCues() for sfx.mjs.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { BUILD as B, checkSceneConfig, loadJson } from './lib/config.mjs';
import { chromePath, ffmpegPath, run } from './lib/platform.mjs';

const FPS = 30;
const WORKERS = Math.max(1, Math.min(4, os.cpus().length - 1));
const CRF = String(process.env.CRF ?? loadJson('video.json', { allowTodo: true }).encode?.crf ?? 18);

const args = process.argv.slice(2);
const flag = n => args.includes('--' + n);
const opt = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' };
function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.resolve(B, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(B + path.sep) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    fs.createReadStream(p).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

async function openPage(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('pageerror:', e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.READY || window.INIT_ERROR', { timeout: 60000 });
  const err = await page.evaluate('window.INIT_ERROR');
  if (err) throw new Error(err);
  return page;
}

const grab = (page, t, type) => page.evaluate((t, type) => {
  renderFrame(t);
  return document.getElementById('c').toDataURL(type, 0.95).split(',')[1];
}, t, type);

function ffmpegChunk(out) {
  const ff = spawn(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-vf', 'scale=in_range=full:out_range=limited,format=yuv420p', '-c:v', 'libx264', '-crf', CRF, '-preset', 'medium', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-r', String(FPS), '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exit ' + c)))));
  const write = buf => new Promise(r => (ff.stdin.write(buf) ? r() : ff.stdin.once('drain', r)));
  return { write, end: () => { ff.stdin.end(); return done; } };
}

async function main() {
  checkSceneConfig();
  const srv = await serve();
  const url = `http://127.0.0.1:${srv.address().port}/scene/index.html`;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--disable-gpu-vsync', '--force-color-profile=srgb', '--font-render-hinting=none'] });
  try {
    const probe = await openPage(browser, url);
    const total = await probe.evaluate('window.VIDEO.total');
    const cues = await probe.evaluate('window.VIDEO.cues || []');
    fs.mkdirSync(path.join(B, 'audio'), { recursive: true });
    fs.writeFileSync(path.join(B, 'audio', 'sfx-cues.json'), JSON.stringify(cues, null, 1));
    const nFrames = Math.ceil(total * FPS - 1e-6);
    const from = opt('from') ? Math.max(0, Math.floor(parseFloat(opt('from')) * FPS)) : 0;
    const to = opt('to') ? Math.min(nFrames, Math.ceil(parseFloat(opt('to')) * FPS)) : nFrames;

    if (flag('subs')) {
      const dir = path.join(B, 'subs');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir);
      const cues = parseSrt(fs.readFileSync(path.join(B, 'captions.srt'), 'utf8'));
      for (const [i, c] of cues.entries()) {
        const b64 = await probe.evaluate(s => { renderSubtitle(s); return document.getElementById('c').toDataURL('image/png').split(',')[1]; }, c.text);
        c.file = `sub_${String(i).padStart(2, '0')}.png`;
        fs.writeFileSync(path.join(dir, c.file), Buffer.from(b64, 'base64'));
      }
      fs.writeFileSync(path.join(dir, 'subs.json'), JSON.stringify(cues, null, 1));
      const blank = await probe.evaluate(() => { renderSubtitle(''); return document.getElementById('c').toDataURL('image/png').split(',')[1]; });
      fs.writeFileSync(path.join(dir, 'blank.png'), Buffer.from(blank, 'base64'));
      const seq = [];
      let at = 0;
      for (const c of cues) {
        if (c.start > at) seq.push(['blank.png', c.start - at]);
        seq.push([c.file, c.end - c.start]);
        at = c.end;
      }
      seq.push(['blank.png', Math.max(0.1, total - at)]);
      const lines = ['ffconcat version 1.0'];
      for (const [f, d] of seq) lines.push(`file '${f}'`, `duration ${d.toFixed(3)}`);
      lines.push(`file 'blank.png'`);
      fs.writeFileSync(path.join(dir, 'subs.ffconcat'), lines.join('\n') + '\n');
      console.log(`wrote ${cues.length} caption overlays to ${dir}`);
      return;
    }

    if (flag('preview') || opt('times')) {
      const dir = path.join(B, 'preview');
      fs.mkdirSync(dir, { recursive: true });
      const times = opt('times')
        ? opt('times').split(',').map(Number)
        : Array.from({ length: Math.ceil((to - from) / parseInt(opt('preview') || '30', 10)) }, (_, k) => (from + k * parseInt(opt('preview') || '30', 10)) / FPS);
      for (const t of times) {
        const b64 = await grab(probe, t, 'image/png');
        fs.writeFileSync(path.join(dir, `f_${t.toFixed(2).padStart(6, '0')}.png`), Buffer.from(b64, 'base64'));
      }
      console.log(`wrote ${times.length} preview frames to ${dir}`);
      return;
    }

    await probe.close();
    const tmp = path.join(B, 'chunks');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp);
    const per = Math.ceil((to - from) / WORKERS);
    const started = Date.now();
    let doneFrames = 0;
    const jobs = Array.from({ length: WORKERS }, (_, w) => ({ w, a: from + w * per, b: Math.min(to, from + (w + 1) * per) })).filter(j => j.b > j.a);
    await Promise.all(jobs.map(async j => {
      const page = await openPage(browser, url);
      const enc = ffmpegChunk(path.join(tmp, `chunk_${j.w}.mp4`));
      for (let f = j.a; f < j.b; f++) {
        const b64 = await grab(page, f / FPS, 'image/jpeg');
        await enc.write(Buffer.from(b64, 'base64'));
        doneFrames++;
        if (doneFrames % 150 === 0) {
          const el = (Date.now() - started) / 1000;
          console.log(`${doneFrames}/${to - from} frames, ${(doneFrames / el).toFixed(1)} fps, eta ${((to - from - doneFrames) / (doneFrames / el)).toFixed(0)} s`);
        }
      }
      await enc.end();
      await page.close();
    }));
    const list = path.join(tmp, 'list.txt');
    fs.writeFileSync(list, jobs.map(j => `file 'chunk_${j.w}.mp4'`).join('\n') + '\n');
    await run(ffmpegPath(), ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', path.join(B, 'video.mp4')]);
    console.log(`video.mp4: frames ${from}-${to} (${((to - from) / FPS).toFixed(3)} s) in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  } finally {
    await browser.close();
    srv.close();
  }
}

function parseSrt(s) {
  const ts = x => { const m = x.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000; };
  return s.replace(/\r/g, '').split(/\n\n+/).map(b => b.trim().split('\n')).filter(b => b.length >= 3)
    .map(b => { const [a, c] = b[1].split('-->'); return { start: ts(a), end: ts(c), text: b.slice(2).join(' ') }; });
}

main().catch(e => { console.error(e); process.exit(1); });
