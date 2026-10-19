# Style: direction, presets, palette, fonts and images

**There is no default look.** Every brand gets its own visual grammar. The engine can be hand-drawn, flat
motion graphics, type-driven, comic-book or something new, and none of those is "the engine's character". Do
not fall back to the bundled examples' look, or to any preset, unless the user picked it.

## 0. The style-direction step (do this before the script and the art)

1. Collect the inputs: the user's brand material (site, logo, colours, fonts, existing videos, illustrations),
   the video's purpose (scroll-stopping ad, calm explainer, investor story, onboarding…), the audience and the
   channel (feed, landing page, trade-fair screen).
2. Propose **2–3 distinct directions**, each derived from those inputs, never generic. For each, give:
   - a one-line name and mood ("bold kinetic type on the brand's dark navy", "clean flat shapes in the app's own
     UI colours", "comic-book energy for a playful consumer launch");
   - background, line treatment, caption/type style, transitions, motion energy, camera, music genre and voice
     delivery (the axes below);
   - why it fits this brand and purpose, and what it risks.
   If useful, render one style frame per direction (`node render.mjs --times …`) so the user compares pictures,
   not words.
3. The user picks one, or describes their own. Do not choose silently.
4. Write the decision into the project:
   - `build/style.json`: `{ "preset": "<closest preset or custom>", …overrides }`;
   - `<project>/style-note.md`: the direction in a few lines (what, why, colours, type, motion, sound, voice),
     so the next video for this brand — and the next person — starts from it.
5. Consistency within one brand is good: reuse its `style.json` and `style-note.md` for its next video. Vary
   the grammar between one user's videos only if they ask.

## 1. The presets (`engine/styles/`)

Presets are starting points; every key can be overridden per project in `style.json`.

| Preset | Background | Lines | Captions | Transitions | Motion / camera | Music | Voice |
|---|---|---|---|---|---|---|---|
| `flat-motion` | soft radial gradient | none (flat shapes) | lower-thirds | iris, slide, dissolve, punch | smooth, no overshoot / slow push-in | lo-fi | clear product expert |
| `kinetic-type` | dark with vignette | clean | kinetic words landing on the beat | cut, flash, glitch, punch | punchy / still | electronic-drive | confident, fast ad read |
| `action-comic` | halftone dots | thick outline | slam titles with hard shadow | whip, flash, punch, glitch, iris | punchy / shake | electronic-drive | energetic, upbeat |
| `hand-drawn` | paper grain | wobbly, boiling | handwritten write-on | slide, dissolve, zoom, wipe | calm / Ken Burns | acoustic-gentle | warm storyteller |

`examples/demo` is `action-comic`; `examples/demo-hand-drawn` is `hand-drawn`. They show range; they are not
templates for anyone's brand.

## 2. `style.json` keys

| Key | Values |
|---|---|
| `preset` | a file name in `styles/` (without `.json`), or `custom` (then every key below must be set) |
| `background` | `{ type: flat \| gradient \| paper \| halftone \| dark, color, color2, radial, dotColor, dotSize, dotSpacing, grain, vignette }`; colours are palette keys or `#RRGGBB`. Shots can pass their own `bg` to change it per section. |
| `line` | `{ type: none \| clean \| outline \| wobbly, width, wobble, boilFps }`. `wobbly` jitters and boils (`boilFps` re-draws per second); the others are still. `none` draws fills only. |
| `letterJitter` | wobble of handwritten letters (hand-drawn only), 0 = straight |
| `captions` | `{ style: handwritten \| slam \| kinetic \| lowerThird \| none, y, size, caps, color, outline, shadow, box, bar }` |
| `transitions` | list used by shots with `tr: 'auto'`: `cut, dissolve, zoom, slide, wipe, whip, flash, glitch, iris, punch` |
| `transitionDuration` | seconds (0.25 punchy … 0.6 calm) |
| `motion.energy` | `calm` (soft overshoot, 0.42 s), `smooth` (no overshoot, 0.55 s), `punchy` (big overshoot, 0.2 s): drives `pop()`, titles and kinetic type |
| `camera` | `{ type: still \| kenburns \| push \| shake, amount }`; scenes add impulses with `shake()` |
| `flashColor`, `whipColor` | colours for flash/punch and whip streaks |
| `subtitles` | `{ color, halo }` for the captioned export |
| `voice` | `{ prompt, tempo, pauseScale }`: delivery defaults for this style; `video.json` `voice` overrides |
| `music` | `{ genre }`: default genre; `video.json` `music.genre` overrides |

## 3. Designing a new preset

Start from the brand, not from the closest preset:

- **Field**: what does the brand's own surface look like? Flat UI colour → `flat`/`gradient`; print heritage →
  `halftone` or `paper`; premium/tech → `dark` with a vignette.
- **Line**: illustrations with outlines → `outline`; flat icon systems → `none`; diagrams → `clean`; only sketchy,
  hand-made brands → `wobbly`.
- **Type**: the brand's display face drives it. Condensed heavy sans → `kinetic` or `slam`; a friendly rounded
  face → `lowerThird`; a handwriting face only when the brand writes by hand.
- **Energy**: match the channel. Feed ads: `punchy`, 0.25–0.35 s transitions, hard cuts and flashes. Landing
  pages and onboarding: `smooth`/`calm`, 0.5–0.7 s.
- **Sound**: pick the genre that matches the energy (section 4 of `customize.md`), and a voice prompt to match.

Save it in the project as `build/styles/<name>.json` and set `"preset": "<name>"` (or keep everything as
overrides in `style.json`, or use `"preset": "custom"` with every key set). Render style frames and get the
user's yes before building scenes.

## 4. Palette (`palette.json`)

Sample the colours from the brand's material, never guess them:

```
node scripts/sample-palette.mjs ref.png --top 12                       # most common colours, near-white ignored
node scripts/sample-palette.mjs ref.png ink=410,220,12,12 fill=800,560,40,40   # channel medians of small regions
```

Required keys: `background`, `ink` (outlines and default text), `accent` (main brand accent), `highlight` (a
second accent for sparks, bursts and emphasis). Add any others the scenes use (`background2`, `blue`, `stone`…)
and use them as `PAL.<key>` or by name in `style.json`. The engine refuses to render while a value is `TODO`.

## 5. Fonts (`fonts.json`, `fonts/`)

- **Display** (captions, titles, kinetic words): chosen for the direction. Compare candidates rendered under a
  crop of the brand's own lettering or logo type:
  ```
  node scripts/fontcmp.mjs <candidatesDir> lettering.png fontcmp.png "THE SAME WORDS AS THE CROP" "#111111"
  ```
  Set `caps` and `spacing` (em) to match how the brand sets type.
- **UI** (numbers, URLs, cards): the brand's site font, or the nearest free one.
- Put the TTF/OTF files in `fonts/` with their licence files (Google Fonts are OFL and free to embed) and name
  them in `fonts.json` as `display` and `ui`.

## 6. Images: bring your own, or draw in code

Two ways to get pictures on screen; most videos mix them.

**Draw in code** with the primitives in `lib.js` (`wobbly` shapes in the style's line treatment, samplers,
`text`, `titleText`, `kineticText`) and the effects kit in `fx.js`. Anything graphic is better this way: cards,
phones, charts, counters, icons, bursts, explosions. It animates freely and needs no image tool or account. Both
examples are drawn entirely in code.

**Bring your own images** for characters, scenes and anything detailed:
- the user's own illustrations or brand art (best: it *is* the style);
- scans or photos of drawings;
- stock art the user has the rights to;
- images from any image generator, prompted with a style description written **from the user's references**.

Cut line art on a light background into transparent cells:

```
node scripts/cut-art.mjs ../art                               # every PNG/JPG in ../art -> cells/<name>.png + cells.json
node scripts/cut-art.mjs ../art --split icons=cup,book,shoe   # one image with several separated parts
```

The cutter flood-fills the background from the border (enclosed white stays opaque), ramps the edge alpha by
darkness and un-premultiplies edge colours so there is no fringe. Images that already have transparency (PNG
exports from design tools) need no cutting: copy them into `cells/` and add them to `cells.json`. For a figure
that must animate, cut or draw it in parts and rotate a part around a pivot
(`sprite(ctx, name, x, y, scale, rot, alpha, ax, ay)`); `rel(part, base)` re-assembles parts cut from one image.

**Look at every cell** on a dark background: clipped limbs, stray lettering and halos only show up there.

### Generated images

`scripts/gen-art.mjs` is an **untested reference script** for Gemini image generation with a `GEMINI_API_KEY`
from Google AI Studio. Any other image tool works the same way.

- Write the style description from the user's references and the chosen direction.
- **Name forbidden colours.** Generated art drifts toward colours that are not in the palette (wood-brown
  furniture, grey shadows, gradients). Say what is not allowed, and "no text, letters, numbers or logos".
- Ask for one isolated subject, centred, with generous margin on a plain background.
- Check the result against `palette.json` and on a dark background before cutting. Requests are billed.

## 7. Preset-specific guidance

- **hand-drawn**: gentle motion — Ken Burns of 4 % or less, bobbing, small overshoot, soft transitions;
  handwritten captions as short paraphrases; everything missing from the art drawn with `wobbly` in the palette.
- **flat-motion**: geometry and alignment carry it — consistent radii, a grid, no outlines, eases without
  overshoot, one accent colour per scene; lower-thirds name what is on screen.
- **kinetic-type**: the words are the picture. One idea per screen, 1–4 words at a time, `times` from
  `wordTime` so each word lands when it is spoken; hard cuts on the beat; restrained colour (one accent).
- **action-comic**: big flat colour fields per section, thick outlines and hard shadows, a sticker or burst on
  each beat, effects sized to read at 1080p (sparks 5+ px, debris 20+ px, confetti 20+ px) and timed to SFX.
  Keep the text off the effects: an explosion behind a title, never over it.
