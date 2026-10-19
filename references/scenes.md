# Writing scenes

`scene/index.html` loads, in order: `lib.js` (maths, shapes, text, sprites), `look.js` (backgrounds, motion,
camera, captions and type, transitions — all driven by `style.json`), `fx.js` (the effects kit) and
`scenes.js` (this video). `render.mjs` calls `renderFrame(t)` for every frame at 1920×1080 and 30 fps.

The engine's `scenes.js` is the action-comic example. Use its structure, not its look: replace the `draw*`
functions, `buildShots()` and `buildCues()`; keep the timing helpers at the top (`wordTime`, `S`, `E`, `gapMid`,
`until`, `rel`) and everything from `renderShot()` down (`renderFrame`, `renderPair`, `init`).

## The rules that keep it working

1. **`renderFrame(t)` is a pure function of `t`.** No state between frames and no `Math.random`: every
   "random" value comes from the seeded hashes `h32(a,b,c)` (0..1) or `hs(a,b,c)` (-1..1), and every effect in
   `fx.js` is computed analytically from `t - t0`. That allows parallel workers, any range, any single frame.
2. **All timing comes from the timeline. Never hard-code seconds** — in draw code or in sound cues. Use
   `S('M03')`, `E('M03')`, `wordTime('M03', 'sprout')`, `gapMid('M05', 'M06')`, `until('M04')` plus small offsets.
3. **Cuts sit in pauses.** Every shot ends at `cut(a, b)` (= `gapMid`) or a word time.
4. **Nothing is frozen.** The style's camera runs on every shot; add idle motion (bobbing, swaying, boiling).
5. **Scenes share one global scope with lib/look/fx.** Don't redeclare their names (`pop`, `caption`, `burst`…)
   with `const`/`let`; that throws and the page never becomes ready.
6. **Handle "no next event" explicitly.** `prog(t, Infinity, …)` is `NaN`, and a `NaN` transform draws nothing.

## Shot list (`buildShots()`)

```js
const list = [
  { id: 'days',   draw: drawDays,   bg: BG.yellow, next: cut('H03', 'P01'), tr: 'whip' },
  { id: 'streak', draw: drawStreak, bg: BG.red,    next: cut('P03', 'M01'), tr: 'auto' },   // from style.transitions
  { id: 'cta',    draw: drawCta,    bg: BG.blue,   next: TL.total + 10,     tr: null },
];
```

- `bg` (optional) overrides `style.json` `background` for this shot, e.g. `{ color: 'red', dotColor: 'redDots' }`.
- `tr`: `cut`, `dissolve`, `zoom`, `slide`, `wipe` (hand-drawn edge), `whip`, `flash`, `glitch`, `iris`,
  `punch`, or `auto`. `d` defaults to `style.json` `transitionDuration`.

## Sound cues (`buildCues()`)

Return `[{ t, type, gain?, pan?, len?, f? }]`. `render.mjs` writes them to `audio/sfx-cues.json`; `mix.mjs`
renders them with `sfx.mjs`. Types: `whoosh`, `impact`, `boom`, `riser` (ends at `t`), `pop` (`f` = pitch),
`click`, `shimmer`, `glitch`. Put a whoosh just before each whip/slide, an impact on slams and punches, a boom on
explosions, pops on pop-ins, a riser into a reveal. Keep them sparse: one effect per beat, not per frame. To use
licensed files instead, map a type to a file in `video.json` `sfx.files`. A calm video may have no cues at all.

## lib.js

| Helper | Use |
|---|---|
| `prog(t, t0, t1)` | 0→1 clamped progress. Eases: `ease.out/inOut/in/sine/back/backBig/elastic/expo`. |
| `lerp`, `clamp`, `mixHex(a, b, p)`, `col(keyOrHex)` | Maths, colour mixing, palette lookup. |
| `sampleLine/Poly/RoundRect/Ellipse/Quad(...)` | Point lists for shapes. |
| `wobbly(ctx, pts, {seed, t, width, color, fill, closed, progress, amp, alpha, force})` | Draws a shape in the style's line treatment: jittered and boiling for `wobbly`, still for `clean`/`outline`, fill-only for `none` (`force: true` strokes anyway). `progress` draws the stroke on. |
| `tracePath(ctx, pts, closed)` | A smooth path for clipping. |
| `text(ctx, str, x, y, {family, size, weight, color, align, alpha, spacing})` | Plain text (UI font by default). |
| `handText(...)` | Handwritten write-on (hand-drawn styles). |
| `sprite(ctx, name, x, y, scale, rot, alpha, ax, ay)`, `rel(part, base)` | Image cells and split parts. |

## look.js

| Helper | Use |
|---|---|
| `pop(t, t0, d?)` | Pop-in scale 0→1 in the style's motion energy (calm / smooth / punchy). |
| `caption(ctx, str, t, t0, t1, {y, size, color, seed})` | The style's emphasis caption: handwritten, slam, kinetic, lower-third or none. |
| `titleText(ctx, str, x, y, t, {t0, t1, size, color, outline, shadow, rot, from})` | A bold title that slams in. |
| `kineticText(ctx, str, x, y, t, {t0, t1, times, hot, accent, size, outline, dur})` | Words landing one by one; `times` from `wordTime` makes each land when spoken; `hot` words get the accent. |
| `lowerThird(ctx, str, t, t0, t1, {y, size, box})` | A bar that slides in with text. |
| `drawBackground(ctx, bg)`, `camera(ctx, t, t0, t1, seed)` | Used by `renderShot`. |
| `shake(ctx, t, t0, amp, dur)` | A decaying screen shake from `t0` (call before drawing what shakes). |
| `composite(ctx, tr, p, A, B, t)` | The transitions. |

## fx.js — the effects kit

All take absolute times (`t0` from the timeline) and a `seed`; all return immediately outside their lifetime.

| Effect | Use |
|---|---|
| `burst(ctx, x, y, r, t, seed, {points, jag, fill, stroke, width, rot, alpha})` | Comic action-burst star (stickers, impacts, logo backdrops). |
| `sparks(ctx, x, y, t, t0, {n, speed, life, gravity, size, colors, spread, dir})` | Streaking sparks with trails, additive. |
| `debris(ctx, x, y, t, t0, {n, speed, life, gravity, size, colors})` | Tumbling shards with gravity. |
| `smoke(ctx, x, y, t, t0, {n, life, size, color})` | Puffs that grow, rise and fade. |
| `shockwave(ctx, x, y, t, t0, {r, life, width, color})` | An expanding ring. |
| `explosion(ctx, x, y, t, t0, {scale, seed, colors})` | Flash + fireball bursts + shockwave + sparks + debris + smoke. |
| `fire(ctx, x, y, w, h, t, seed, {colors, alpha})` | Stylised flickering flames (base centre at x, y). |
| `speedLines(ctx, t, {cx, cy, inner, n, color, alpha, mode: 'radial' \| 'horizontal'})` | Focus or motion lines. |
| `confetti(ctx, t, t0, {n, colors, size, life, x0, x1})` | Falling, tumbling confetti. |
| `glow(ctx, () => { … }, {blur, color, alpha})` | Draws anything with additive 'lighter' compositing and bloom. |

Make effects readable at 1080p: sparks 5 px or wider, debris and confetti 20 px or more, bursts behind text,
explosions short (under a second of full intensity). Time each one to a word and give it a sound cue.

## Patterns that work

- **Pop-in:** `const p = pop(t, t0); if (p > 0.02) { ctx.translate(x, y); ctx.scale(p, p); … }` — stagger groups
  by 0.08–0.25 s depending on energy. Guard small stroked shapes (`if (r < 6) return;`).
- **Palette at draw time:** keep palette *key names* in top-level tables and resolve with `col(key)` or
  `PAL[key]` inside draw functions (PAL loads in `init()`).
- **Sticker on a beat:** `burst` + `titleText` popping on `wordTime`, with an exit before the next beat.
- **Counters:** `Math.round(target * ease.out(prog(...)))`, finishing on the spoken number.
- **Kinetic lines:** pass `times: [S(id), wordTime(id, 'two'), …]`, one entry per word.
- **Section colour:** give each section its own `bg` so the structure reads at a glance.

## Previewing — always look

- `node render.mjs --times 3,12.5,40` writes exact frames to `preview/`. Read the PNGs.
- `node render.mjs --from 20 --to 32 --preview 6` writes every 6th frame in a range.
- Scrub by hand: serve the build folder with any static server and open `scene/index.html?t=42.3`.
- Dense around each cut: `node scripts/sheet.mjs ../<name>.mp4 11.6,11.8,12.0,12.2,12.4`.
- Look for: text over art or effects, clipped captions, empty or frozen moments, captions out of sync, a caption
  still exiting while the next enters, dots from pop-ins, effects that read as noise, cuts landing mid-word.
