// Generates illustrations in YOUR art style with Gemini image generation, through the Gemini API and an API key
// from Google AI Studio (GEMINI_API_KEY; no Google Cloud project). Optional: any image tool, scanned drawings or
// licensed line art work just as well (references/art.md, "Bring your own images").
// UNTESTED REFERENCE SCRIPT: written against the public API documentation, never run by the skill's author.
//   node scripts/gen-art.mjs                 every image in ../art/prompts.json that has no PNG yet
//   node scripts/gen-art.mjs hero laptop     these images (regenerates them)
// ../art/prompts.json:
//   { "style": "the style description, written from YOUR reference images",
//     "refs": ["ref-1.png", "ref-2.png"],                 reference images in ../art/, sent with every request
//     "images": { "hero": "A person at a desk, ...", "laptop": "An open laptop, ..." } }
// Writes ../art/<name>.png, ready for scripts/cut-art.mjs. Every request is billed: say so before a batch.
import fs from 'node:fs';
import path from 'node:path';
import { BUILD } from '../lib/config.mjs';
import { requireKey } from '../voices/wav.mjs';

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const ART = path.join(BUILD, '..', 'art');
const spec = path.join(ART, 'prompts.json');
if (!fs.existsSync(spec)) throw new Error(`write ${spec} first (format at the top of this script)`);
const { style, refs = [], images = {} } = JSON.parse(fs.readFileSync(spec, 'utf8'));
if (!style || /\bTODO\b/.test(style)) throw new Error('prompts.json "style" must describe your own reference art (references/art.md)');
const key = requireKey('GEMINI_API_KEY', 'https://aistudio.google.com/apikey');

const mime = f => (/\.jpe?g$/i.test(f) ? 'image/jpeg' : 'image/png');
const refParts = refs.map(f => {
  const p = path.join(ART, f);
  if (!fs.existsSync(p)) throw new Error(`reference image ${p} not found`);
  return { inlineData: { mimeType: mime(f), data: fs.readFileSync(p).toString('base64') } };
});

const asked = process.argv.slice(2);
const names = asked.length ? asked : Object.keys(images).filter(n => !fs.existsSync(path.join(ART, `${n}.png`)));
for (const name of names) {
  if (!images[name]) { console.error(`unknown image: ${name}`); process.exitCode = 1; continue; }
  const body = {
    contents: [{ parts: [...refParts, { text: `${images[name]}\n\n${style}` }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  const img = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData;
  if (!res.ok || !img) { console.error(`${name}: FAILED ${res.status} ${JSON.stringify(json).slice(0, 400)}`); process.exitCode = 1; continue; }
  fs.writeFileSync(path.join(ART, `${name}.png`), Buffer.from(img.data, 'base64'));
  console.log(`${name}: ok`);
}
