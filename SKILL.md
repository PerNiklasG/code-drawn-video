---
name: code-drawn-video
description: Make a promo, explainer, ad or sales video entirely from code, in a visual style chosen with the user for their brand (flat motion graphics, kinetic typography, comic-book action, hand-drawn, or a custom preset). Frames are drawn on a canvas in headless Chrome with a deterministic effects kit (bursts, sparks, explosions, fire, speed lines, confetti, glow), narration comes from a pluggable voice (local Kokoro, Gemini API, OpenAI, ElevenLabs or the user's own recording) aligned to the script with Whisper, music (several genres) and sound effects are synthesized in Node, and ffmpeg mixes and encodes. Use when the user wants an animated video made without a video editor, or wants to re-voice, re-cut or restyle a video built this way.
---

# Code-drawn video

The engine produces a 1920×1080, 30 fps H.264 video at -14 LUFS, plus a captioned copy. There is no stock
footage, no video model and no editing app. Each frame is a pure function of time drawn on a canvas, and
everything is driven by one sync contract, `timeline.json`.

```
video.json → narrate.mjs → timeline.json → music.mjs → render.mjs ──────────→ mix.mjs → <name>.mp4 + -captioned.mp4
 (script,     (voice +      (sync contract)  (genre,     (scene/*.js, style;    (sfx.mjs, duck,
  voice)       align.mjs)                     sections)   writes sfx cues)       loudness, subtitles)
```

**There is no default look.** The style is decided with the user for every brand (step 2). The engine has
presets — `flat-motion`, `kinetic-type`, `action-comic`, `hand-drawn` — and none of them is its character.
Never fall back to a bundled example's look, or to any preset, unless the user picked it.

Bundled here:
- `engine/`: the engine. Its config files are placeholders (`TODO`) and it refuses to run until they are filled,
  including the style.
- `engine/styles/`: the presets. `engine/scene/`: `lib.js` (shapes, text), `look.js` (backgrounds, captions,
  camera, transitions), `fx.js` (effects kit), `scenes.js` (the action-comic example, as a template).
- `new-video.mjs`: bootstraps a project in a folder the user chooses.
- `examples/demo/`: a 37 s ad for a fictional app ("Pebblesprout") in `action-comic`, with SFX and
  electronic music. `examples/demo-hand-drawn/`: the same product as a calm 50 s `hand-drawn` explainer.
  They show range; they are not anyone's template.
- `references/`: the details, each loaded when its step needs it.

## Requirements

- Node 20+, Google Chrome (or Chromium/Edge) and ffmpeg. ffmpeg comes from `FFMPEG_PATH`, else PATH, else the
  `ffmpeg-static` npm package; Chrome from `CHROME_PATH`, else the usual install locations. Windows, macOS and
  Linux: `references/platforms.md` (only macOS has been run end to end).
- **No cloud account is required.** The local voice (Kokoro) needs none. Cloud voices need the user's own API
  key in an environment variable (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`). Never ask for a
  key in chat, never write one into a file, and ask before the first paid request.
- First runs download models into `node_modules` (about 1 GB: Whisper base for alignment, Whisper small for the
  final check, Kokoro if used).

## Workflow

### 1. Brief
Ask for, or confirm: the product, audience and the one action the viewer should take (CTA, URL as spoken);
**target length** and structure (`references/script.md`); the claims and the public page that backs each one;
**the brand's material** (site, logo, colours, fonts, existing videos or illustrations); the channel (feed ad,
landing page, trade-fair screen); the voice provider (`references/voices.md`); the language.

### 2. Style direction (required, before script and art)
Propose **2–3 distinct directions** derived from the brand material and the video's purpose — each with
background, line treatment, caption/type style, transitions, motion energy, camera, music genre and voice
delivery, and why it fits. Render a style frame per direction if that helps. The user picks one or describes
their own; never choose silently. Write it into `build/style.json` (`preset` + overrides) and a short
`<project>/style-note.md`. Keep one brand consistent across its videos; vary the grammar between a user's
videos only if they ask. Details and the preset table: `references/style.md`.

### 3. Script
Write `script/script-v1.md` (`references/script.md`) in the register of the chosen style (an ad read is not an
explainer), and get the user's approval before voicing it. Never edit an old version; copy it to vN+1.

### 4. Bootstrap
```
node <skill>/new-video.mjs <project-dir>                 # the user picks <project-dir>; runs npm install
node <skill>/new-video.mjs <project-dir> --example demo  # same, starting from the action-comic example
```
All later commands run in `<project-dir>/build`.

### 5. Look: palette, fonts, art
Sample `palette.json` from the brand (`scripts/sample-palette.mjs`), choose display and UI fonts for the
direction (`scripts/fontcmp.mjs`), and get pictures by drawing in code or bringing images
(`scripts/cut-art.mjs`). **View every cell and preview frame before using it.** (`references/style.md`)

### 6. Voice
- **Find the voice by ear**: `node scripts/audition.mjs --provider <p>` writes samples to `../voice-samples/`.
  The delivery prompt defaults to the style's (`style.json` `voice.prompt`); `video.json` `voice.prompt` wins.
  Kokoro cannot do an intense or dramatic read: for energetic styles, audition a cloud voice or record one.
- Put the lines in `video.json` `lines`, plus `wordCues`, `numberWords` and `soundalikes`
  (`references/customize.md`).
- `node narrate.mjs`, then `node verify-words.mjs`. Read every `DIFF` and `SUSPECT`: a misspelled name is fine
  (add a soundalike), a missing or chopped word is not (`references/voices.md`).

### 7. Music
Pick the genre (`acoustic-gentle`, `electronic-drive`, `cinematic-action`, `lo-fi`, or a licensed `music.file`),
map the script's section ids in `video.json` `music.sections`, then `node music.mjs`. Listen to
`audio/music-preview.mp3` if the mood matters.

### 8. Scenes and sound effects
Rewrite the `draw*` functions, `buildShots()` and `buildCues()` in `scene/scenes.js` from the script's `VISUAL:`
lines; keep the infrastructure. Use the style's caption, pop and camera helpers and the effects kit
(`references/scenes.md`). Sound-effect cues are keyed to line and word times in `buildCues()`. Preview while
building: `node render.mjs --times 3,12.5` and **look at the PNGs**.

### 9. Render, mix, review
```
node render.mjs                        # prints progress; also writes audio/sfx-cues.json
node mix.mjs                           # sfx → mix → ../<name>.mp4 and ../<name>-captioned.mp4
node scripts/sheet.mjs ../<name>.mp4   # contact sheets -> review/, then read them
node verify-mp4.mjs ../<name>.mp4      # transcribe the final file and check every script word
```
Review the sheets for text over art or effects, clipped captions, empty or frozen moments, captions out of sync,
effects that read as noise at 1080p, and transitions that land mid-word (dense sheets around each cut). Fix,
re-render. Only call it done after `verify-mp4.mjs` hears every script word.

### 10. Version
Give each delivered cut a new `name` in `video.json` (`-v1`, `-v2`, …). Copy `video.json`, `style.json`,
`scene/scenes.js`, `timeline.json`, `captions.srt` and `audio/narration.wav` into `build/versions/vN/`. Keep a
project `README.md`: what exists, the decisions (style, voice, pace, music) and the traps hit.

## Changing an existing video

| Change | Re-run |
|---|---|
| Reword or add lines | narrate → verify-words → music → render → mix (only edited sections are re-voiced) |
| Voice, prompt or pace | the same chain (a new voice or prompt is a new cache key) |
| Visuals, style overrides, palette, fonts | render → mix |
| Sound effects | edit `buildCues()` → render → mix (or swap a type for a file in `video.json` `sfx.files`) |
| Music genre or levels | music → mix, or `DUCK=-22 GAP=-10 node mix.mjs` |
| Swap one image | replace `cells/<name>.png`, update its size in `cells.json`, preview, render → mix |

## Traps already paid for (do not relearn these)

1. **Some TTS models chop the last syllable of a request.** Adapters that do set `needsSacrificeTail`: requests
   end with a throwaway sentence that the aligner excludes and cuts off.
2. **Never split speech at silences.** Stop consonants are silences. Cut only between Whisper-aligned words, in
   the 0.25 s before the next word's onset. Re-request takes that don't match.
3. **Verify by transcription, never by audio levels**, per line and on the final MP4. Speech within 0.1 s of a
   clip's end is suspect.
4. **Word cues must survive Whisper's spelling**: numbers come back as digits, compounds get joined or split.
   Cue on words Whisper spells like the script; interpolate the rest.
5. **Names get misheard**: add `soundalikes`; digits need `numberWords`.
6. **Long audio confuses Whisper's own chunking** (it dropped whole sentences): the engine splits it into ≤28 s
   windows at quiet points itself.
7. **Don't rely on ffmpeg `drawtext` or libass**: subtitles are PNGs rendered in Chrome.
8. **Media players cache replaced files**: a new file name per version.
9. **Agent harnesses kill long silent commands**: run renders in the background and poll.
10. **Never hard-code seconds** in scenes or sound cues: use line and word times.
11. **A pop-in with overshoot is not exactly 0 at its start**: guard small stroked shapes with a threshold.
12. **`prog(t, Infinity, …)` is NaN**, and a NaN transform silently draws nothing: handle "no next event"
    explicitly instead of passing `Infinity`.
13. **Top-level constants in scenes.js can't read the palette** (it loads in `init()`): store key names.
14. **Scene globals share one scope with lib/look/fx**: a `const pop = …` in scenes.js breaks the page because
    `look.js` already defines `pop`.
15. **Generated art drifts in colour**: name forbidden colours and view every cell on a dark background.
16. **Music mute is keyed to line ids**: the default is `none`; never copy ids from another video.
17. **Claims must match a public source of the client's**, word for word where it matters.
18. **Captions overlap their successor** unless one ends (`until(id)`) before the next one enters.
19. **Effects drawn at full-screen alpha hide the words**: keep explosions and bursts behind titles, size
    particles to read at 1080p, and keep them short.
