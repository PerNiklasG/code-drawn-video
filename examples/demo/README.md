# Demo: "Pebblesprout" ad, action-comic (fictional)

A 37-second ad for a habit app that does not exist, made only to show the engine. Watch `demo.mp4` (or
`demo-captioned.mp4`, with burnt-in subtitles). `examples/demo-hand-drawn` is the same product as a calm
hand-drawn explainer, for contrast.

- **Style:** `build/style.json` = `action-comic` preset (`style-note.md` records why): hot yellow /
  red / blue halftone fields per section, thick black outlines, Bangers slam titles and kinetic words, Rubik for
  numbers and UI, action bursts, speed lines, sparks, debris, an explosion with screen shake, fire, shockwaves
  and confetti, whip / glitch / punch / iris / flash transitions. Everything is drawn in code
  (`build/scene/scenes.js`, also the engine's template); there are no image files.
- **Sound:** `electronic-drive` at 126 BPM, music muted under "So you quit."; 32 synthesized sound-effect cues
  (whooshes on whips, impacts on slams, a boom on "boom", pops, a click and shimmers) keyed to line and word
  times in `buildCues()`.
- **Voice:** Kokoro `af_bella` at speed 1.1 with tight sentence gaps. Kokoro cannot do a truly energetic read;
  a real ad would use a cloud voice or a recording (`references/voices.md`).
- **Script:** `script/demo-script-v1.md`.

Results on the shipped cut: `verify-words.mjs` 13/14 lines `OK` (one `DIFF`: Whisper base hears the quick
"and" in "…tap your pebble, and a sprout grows" as "in"; the larger model in `verify-mp4.mjs` hears it),
70/70 script words heard in `verify-mp4.mjs`, -14.2 LUFS integrated, true peak -2.6 dBFS, 1108 frames
(36.93 s).

## Re-run it

```
node <skill>/new-video.mjs <some-folder>/pebblesprout-ad --example demo
cd <some-folder>/pebblesprout-ad/build
node render.mjs --times 2,11.1,19.8,33   # preview frames from the shipped timeline, in preview/
node narrate.mjs && node verify-words.mjs  # first run downloads Kokoro + Whisper (~1 GB)
node music.mjs
node render.mjs                            # also writes audio/sfx-cues.json
node mix.mjs                               # sfx + mix -> ../demo.mp4 and ../demo-captioned.mp4
node scripts/sheet.mjs ../demo.mp4
node verify-mp4.mjs ../demo.mp4
```

To see the same scenes under another preset, set `build/style.json` to `{ "preset": "flat-motion" }` (or
`kinetic-type`, `hand-drawn`) and render a few frames: the background, line treatment, captions, transitions,
motion and camera all change. (The scenes were designed for outlines, so a real video in another style would
also redesign its props.)
