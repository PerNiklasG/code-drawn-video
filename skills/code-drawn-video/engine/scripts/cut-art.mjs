// Cuts line art on a white (or light) background into transparent PNG cells for the scenes.
//   node scripts/cut-art.mjs <artDir>                                every <artDir>/*.png|jpg -> cells/<name>.png
//   node scripts/cut-art.mjs <artDir> --split icons=cup,book,shoe    split one image into parts along empty columns
//   node scripts/cut-art.mjs <artDir> --only hero,logo --thr 40      only these images; ink threshold (default 40)
// Background = a flood fill from the image border through near-white pixels, so enclosed white areas (the
// white of an eye, a white shirt) stay opaque. Edge pixels get alpha by darkness and are un-premultiplied, so
// there is no white fringe on coloured paper. Entries in cells/cells.json for other images are kept.
// View every cell afterwards on a dark background: clipped limbs, stray lettering and halos show up there.
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { BUILD } from '../lib/config.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };
const ART = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : null;
if (!ART || !fs.existsSync(ART)) throw new Error('usage: node scripts/cut-art.mjs <artDir> [--split name=part1,part2] [--only a,b] [--thr 40]');
const THR = Number(opt('thr') || 40), RAMP = 110, MARGIN = 24;
const SPLIT = {};
args.forEach((a, i) => { if (a === '--split') { const [n, parts] = args[i + 1].split('='); SPLIT[n] = parts.split(','); } });
const ONLY = opt('only') ? new Set(opt('only').split(',')) : null;
const CELLS = path.join(BUILD, 'cells');

async function cutOne(file) {
  const { data, info } = await sharp(path.join(ART, file)).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const ink = new Int16Array(W * H);
  for (let k = 0; k < W * H; k++) ink[k] = 765 - data[k * 3] - data[k * 3 + 1] - data[k * 3 + 2];
  const bg = new Uint8Array(W * H), st = [];
  const seed = k => { if (!bg[k] && ink[k] <= THR) { bg[k] = 1; st.push(k); } };
  for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
  while (st.length) { const q = st.pop(), x = q % W, y = (q / W) | 0;
    if (x > 0) seed(q - 1); if (x < W - 1) seed(q + 1); if (y > 0) seed(q - W); if (y < H - 1) seed(q + W); }
  const nearBg = k => { const x = k % W, y = (k / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H && bg[Y * W + X]) return true; } return false; };
  const out = Buffer.alloc(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    let a = bg[k] ? 0 : (nearBg(k) ? Math.min(1, ink[k] / RAMP) : 1);
    let r = data[k * 3], g = data[k * 3 + 1], b = data[k * 3 + 2];
    if (a > 0 && a < 1) { r = 255 - (255 - r) / a; g = 255 - (255 - g) / a; b = 255 - (255 - b) / a; }
    const o = k * 4; out[o] = clamp(r); out[o + 1] = clamp(g); out[o + 2] = clamp(b); out[o + 3] = Math.round(a * 255);
  }
  return { out, W, H };
}
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));

function bounds(out, W, H, x0 = 0, x1 = W - 1) {
  let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
  for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) if (out[(y * W + x) * 4 + 3] > 8) {
    bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
  return { bx0, by0, bx1, by1 };
}

async function write(name, src, out, W, H, b) {
  const x = Math.max(0, b.bx0 - MARGIN), y = Math.max(0, b.by0 - MARGIN);
  const w = Math.min(W - 1, b.bx1 + MARGIN) - x + 1, h = Math.min(H - 1, b.by1 + MARGIN) - y + 1;
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).extract({ left: x, top: y, width: w, height: h }).png({ compressionLevel: 9 }).toFile(path.join(CELLS, `${name}.png`));
  return { file: `${name}.png`, width: w, height: h, bbox: { x, y, w, h }, source: src };
}

function columnRuns(out, W, H, minGap = 12) {
  const used = Array.from({ length: W }, (_, x) => { for (let y = 0; y < H; y++) if (out[(y * W + x) * 4 + 3] > 8) return true; return false; });
  const runs = []; let start = -1, gap = 0;
  for (let x = 0; x < W; x++) {
    if (used[x]) { if (start < 0) start = x; gap = 0; }
    else if (start >= 0 && ++gap >= minGap) { runs.push([start, x - gap]); start = -1; gap = 0; }
  }
  if (start >= 0) runs.push([start, W - 1]);
  return runs;
}

fs.mkdirSync(CELLS, { recursive: true });
const manifest = path.join(CELLS, 'cells.json');
const prev = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : { cells: {} };
const cells = { ...prev.cells };
const files = fs.readdirSync(ART).filter(f => /\.(png|jpe?g)$/i.test(f)).sort();
for (const file of files) {
  const name = file.replace(/\.(png|jpe?g)$/i, '');
  if (ONLY && !ONLY.has(name)) continue;
  const { out, W, H } = await cutOne(file);
  if (SPLIT[name]) {
    const runs = columnRuns(out, W, H);
    if (runs.length !== SPLIT[name].length) throw new Error(`${name}: expected ${SPLIT[name].length} parts, found ${runs.length} (spread the parts further apart)`);
    for (const [i, [a, b]] of runs.entries()) cells[SPLIT[name][i]] = await write(SPLIT[name][i], file, out, W, H, bounds(out, W, H, a, b));
  } else cells[name] = await write(name, file, out, W, H, bounds(out, W, H));
  console.log(`${name}: ${SPLIT[name] ? SPLIT[name].join(', ') : `${cells[name].width}x${cells[name].height}`}`);
}
fs.writeFileSync(manifest, JSON.stringify({ source: prev.source || path.basename(ART), cells }, null, 1));
console.log(`${Object.keys(cells).length} cells in ${manifest}`);
