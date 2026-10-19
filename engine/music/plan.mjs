// Turns timeline.json sections into a bar-level arrangement plan shared by the synthesized genres.
// Music sections, in order: intro build full1 breakdown full2 peak outro. video.json music.sections maps the
// script's section ids onto them; unmapped ones are squeezed between their mapped neighbours.
import fs from 'node:fs';
import path from 'node:path';
import { BUILD } from '../lib/config.mjs';

export const MUSIC_SECTIONS = ['intro', 'build', 'full1', 'breakdown', 'full2', 'peak', 'outro'];
const DEFAULT_SHARE = { intro: 0, build: 0.11, full1: 0.22, breakdown: 0.47, full2: 0.62, peak: 0.76, outro: 0.9 };
export const INTENSITY = { intro: 0.35, build: 0.55, full1: 0.8, breakdown: 0.3, full2: 0.85, peak: 1, outro: 0.45 };
const RING_OUT = 3;

export function makePlan(bpm, mapping = {}) {
  for (const [k, v] of Object.entries(mapping)) {
    if (!MUSIC_SECTIONS.includes(v)) throw new Error(`video.json music.sections.${k}: "${v}" is not one of ${MUSIC_SECTIONS.join(', ')}`);
  }
  const tl = JSON.parse(fs.readFileSync(path.join(BUILD, 'timeline.json'), 'utf8'));
  const total = Number(tl.total);
  const BEAT = 60 / bpm, BAR = 4 * BEAT;
  const finalBar = Math.max(4, Math.floor((total - RING_OUT) / BAR));
  const bars = Object.fromEntries(MUSIC_SECTIONS.map(k => [k, Math.round(DEFAULT_SHARE[k] * finalBar)]));
  const mapped = new Set();
  for (const s of tl.sections) {
    const m = mapping[s.id];
    if (m && !mapped.has(m)) { bars[m] = Math.round(s.start / BAR); mapped.add(m); }
  }
  MUSIC_SECTIONS.forEach((k, i) => {
    if (mapped.has(k)) return;
    const lo = Math.max(0, ...MUSIC_SECTIONS.slice(0, i).filter(x => mapped.has(x)).map(x => bars[x]));
    const hi = Math.min(finalBar - 1, ...MUSIC_SECTIONS.slice(i + 1).filter(x => mapped.has(x)).map(x => bars[x]));
    bars[k] = Math.min(Math.max(bars[k], lo), Math.max(lo, hi));
  });
  for (let i = 1; i < MUSIC_SECTIONS.length; i++) bars[MUSIC_SECTIONS[i]] = Math.max(bars[MUSIC_SECTIONS[i]], bars[MUSIC_SECTIONS[i - 1]]);
  bars.outro = Math.min(bars.outro, finalBar - 1);
  for (const k of MUSIC_SECTIONS) bars[k] = Math.min(bars[k], bars.outro);
  const sectionAt = bar => MUSIC_SECTIONS.reduce((s, k) => (bar >= bars[k] ? k : s), 'intro');
  // A section change at bar b (used for risers before it and impacts on it).
  const changes = MUSIC_SECTIONS.slice(1).map(k => bars[k]).filter((b, i, a) => b > 0 && a.indexOf(b) === i && b < finalBar);
  return { total, bpm, BEAT, BAR, bars, finalBar, sectionAt, intensity: bar => INTENSITY[sectionAt(bar)], changes, timeline: tl };
}
