// Samples colours from reference art, so palette.json holds the art's real colours, not guesses.
//   node scripts/sample-palette.mjs <image> name=x,y,w,h [name=x,y,w,h ...]   channel medians of small regions
//   node scripts/sample-palette.mjs <image> --top 12                         the most common colours (ignores near-white)
// Pick each region where one colour is pure (inside a flat fill, along a thick stroke) and copy the hex values into
// palette.json under the key names your scenes use.
import sharp from 'sharp';

const [img, ...rest] = process.argv.slice(2);
if (!img) throw new Error('usage: node scripts/sample-palette.mjs <image> name=x,y,w,h ... | --top N');
const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
const median = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

if (rest[0] === '--top') {
  const n = Number(rest[1] || 12), bins = new Map();
  for (let k = 0; k < W * H; k++) {
    const r = data[k * 3], g = data[k * 3 + 1], b = data[k * 3 + 2];
    if (r > 240 && g > 240 && b > 240) continue;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = bins.get(key) || { n: 0, r: [], g: [], b: [] };
    e.n++;
    if (e.r.length < 4000) { e.r.push(r); e.g.push(g); e.b.push(b); }
    bins.set(key, e);
  }
  const total = [...bins.values()].reduce((s, e) => s + e.n, 0);
  for (const e of [...bins.values()].sort((a, b) => b.n - a.n).slice(0, n)) {
    console.log(`${hex([median(e.r), median(e.g), median(e.b)])}  ${(100 * e.n / total).toFixed(1)} %`);
  }
} else {
  const out = {};
  for (const spec of rest) {
    const [name, box] = spec.split('=');
    const [x, y, w, h] = box.split(',').map(Number);
    if ([x, y, w, h].some(v => !Number.isFinite(v)) || x < 0 || y < 0 || x + w > W || y + h > H) throw new Error(`bad region ${spec} for a ${W}x${H} image`);
    const ch = [[], [], []];
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) for (let c = 0; c < 3; c++) ch[c].push(data[(yy * W + xx) * 3 + c]);
    out[name] = hex(ch.map(median));
  }
  console.log(JSON.stringify(out, null, 1));
}
