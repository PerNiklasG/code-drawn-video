// Renders every font in a folder under a crop of the reference art's own lettering, to pick the closest match.
//   node scripts/fontcmp.mjs <fontsDir> <lettering.png> <out.png> ["SAMPLE TEXT"] [#color]
// Put candidate TTF/OTF files (e.g. a dozen handwriting fonts from Google Fonts) in <fontsDir>, crop one line of
// lettering from the reference art, and compare letter shapes, weight, slant and caps in the output.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';
import { chromePath } from '../lib/platform.mjs';

const [dir, capImg, out, text = 'THE QUICK BROWN FOX JUMPS', color = '#333333'] = process.argv.slice(2);
if (!dir || !capImg || !out) throw new Error('usage: node scripts/fontcmp.mjs <fontsDir> <lettering.png> <out.png> ["TEXT"] [#color]');
const files = fs.readdirSync(dir).filter(f => /\.(ttf|otf)$/i.test(f)).sort();
if (!files.length) throw new Error(`no .ttf/.otf files in ${dir}`);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cap = fs.readFileSync(capImg).toString('base64');
const css = files.map((f, i) => `@font-face{font-family:F${i};src:url("${pathToFileURL(path.resolve(dir, f)).href}");}`).join('');
const rows = files.map((f, i) => `<div class=r><span class=n>${esc(f.replace(/\.(ttf|otf)$/i, ''))}</span><span style="font-family:F${i}">${esc(text)}</span></div>`).join('');
const html = `<html><style>${css}body{margin:10px;background:#fff;width:1800px}.r{display:flex;align-items:center;height:100px;color:${esc(color)};font-size:74px}` +
  `.n{font:13px sans-serif;width:210px;flex:none;color:#333}</style><body><img src="data:image/png;base64,${cap}" style="max-width:1520px;margin-left:210px">${rows}</body></html>`;
const hp = path.resolve(out.replace(/\.png$/i, '') + '.html');
fs.writeFileSync(hp, html);
const b = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--allow-file-access-from-files'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1820, height: 400 });
  await p.goto(pathToFileURL(hp).href);
  await p.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 500));
  await p.screenshot({ path: out, fullPage: true });
} finally {
  await b.close();
}
console.log(`${files.length} fonts -> ${out}`);
