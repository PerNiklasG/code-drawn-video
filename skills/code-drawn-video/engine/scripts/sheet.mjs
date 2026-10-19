// Contact sheets for reviewing a finished video: 3x3 grids of labelled frames -> review/sheet_NN.jpg.
//   node scripts/sheet.mjs ../My-Video-v1.mp4                 every 2 s, plus each section start and each line start + 0.25 s
//   node scripts/sheet.mjs ../My-Video-v1.mp4 11.6,11.8,12.0  exact timestamps (e.g. dense around one transition)
// Uses sharp for tiling and labels, because many ffmpeg builds have no drawtext.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { BUILD as B } from '../lib/config.mjs';
import { capture, ffmpegPath } from '../lib/platform.mjs';

const FF = ffmpegPath();
const TW = 640, TH = 360, PER = 9;
const [mp4, list] = process.argv.slice(2);
if (!mp4) throw new Error('usage: node scripts/sheet.mjs <video.mp4> [t1,t2,...]');

let times;
if (list) times = list.split(',').map(Number);
else {
  const tl = JSON.parse(fs.readFileSync(path.join(B, 'timeline.json'), 'utf8'));
  const ts = new Set();
  for (let t = 0; t < tl.total - 0.1; t += 2) ts.add(+t.toFixed(2));
  for (const s of tl.sections) ts.add(+(s.start + 0.3).toFixed(2));
  for (const l of tl.lines) ts.add(+(l.start + 0.25).toFixed(2));
  times = [...ts].filter(t => t < tl.total - 0.1).sort((a, b) => a - b);
}

const dir = path.join(B, 'review');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir);
const label = t => Buffer.from(`<svg width="${TW}" height="${TH}"><rect x="6" y="6" width="96" height="30" fill="white"/>` +
  `<text x="12" y="29" font-family="sans-serif" font-size="22" fill="red">${t.toFixed(2)}</text></svg>`);

for (let s = 0; s * PER < times.length; s++) {
  const chunk = times.slice(s * PER, (s + 1) * PER);
  const tiles = await Promise.all(chunk.map(async (t, i) => {
    const jpg = capture(FF, ['-v', 'error', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', `scale=${TW}:${TH}`, '-f', 'image2', '-c:v', 'mjpeg', '-']).stdout;
    const input = await sharp(jpg).composite([{ input: label(t) }]).toBuffer();
    return { input, left: (i % 3) * TW, top: Math.floor(i / 3) * TH };
  }));
  const out = path.join(dir, `sheet_${String(s).padStart(2, '0')}.jpg`);
  await sharp({ create: { width: TW * 3, height: TH * Math.ceil(chunk.length / 3), channels: 3, background: '#ffffff' } })
    .composite(tiles).jpeg({ quality: 80 }).toFile(out);
  console.log(`${path.basename(out)}: ${chunk.join(' ')}`);
}
