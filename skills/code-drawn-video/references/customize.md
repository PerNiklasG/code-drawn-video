# Per-video edit points

Every per-video setting lives in four JSON files in `build/` (`video.json`, `style.json`, `palette.json`, `fonts.json`) plus `scene/scenes.js`. The engine refuses to run
while any of them still holds a `TODO` placeholder and says which key. Go through this list after bootstrapping.

## `video.json`

| Key | Notes |
|---|---|
| `name` | Output file name: `../<name>.mp4` and `../<name>-captioned.mp4`. **New name per version** (players cache replaced files). Override with `NAME=`. |
| `language` | `en` (default), `en-GB`, `de`, `sv`, … See "Language" below. |
| `voice.provider` | `kokoro`, `gemini`, `openai`, `elevenlabs` or `recorded` (`references/voices.md`). |
| `voice.voice` | The voice id picked by ear with `scripts/audition.mjs`. Override with `VOICE=`. |
| `voice.prompt` | The delivery direction. Empty = the style preset's `voice.prompt` (an energetic ad read for action-comic, a warm storyteller for hand-drawn, …). Write it for this brand ("a calm friend explaining…", "a colleague from the trade, brisk"). Sent to providers that take one (Gemini, OpenAI). Never reuse another brand's tone. |
| `voice.tempo` | Speed-up applied to the voice (1.0 = as voiced; 1.1 = 10 % faster). `null` = the style's. Override with `TEMPO=`. |
| `voice.pauseScale` | Scales every planned pause (`null` = the style's: ~0.55 for punchy ads, 1.0 for calm). Override with `PAUSE_SCALE=`. |
| `voice.speed`, `voice.sentenceGap` | Kokoro only: the model's own speaking rate (default 1) and the silence between sentences inside a line (default 0.32 s; ~0.15 for ads). |
| `voice.sacrificeTail` / `voice.sacrifice` | Force the throwaway end sentence on or off, and its text (default "Thank you."; translate it for other languages). |
| `leadIn`, `tail` | Silence before the first line (0.8 s) and after the last (2.5 s). |
| `lines` | `[id, section, text, pauseAfterSeconds]` per line (`references/script.md`). |
| `wordCues` | `{ "M03": ["tap", "sprout"] }`: lines whose word onsets the scenes need. Lowercase, as Whisper spells them. |
| `numberWords` | How each digit string in the script (or in Whisper's output) is spoken: `{ "2024": ["twenty", "twenty", "four"], "0": ["zero"] }`. Add every number the script contains. |
| `soundalikes` | `[["^(acme|akme|acne)$", "acme"]]`: regexes on single lowercase words that map Whisper's misspellings of names to the script spelling. Find them in the `heard:` text of a failed take or a `DIFF` line. |
| `ttsRespell` | `[["Nguyen", "Win"]]`: text replacements sent to the voice only, for words it mispronounces. Captions and alignment keep the real spelling. |
| `music.genre` | `acoustic-gentle` (ukulele, marimba, glockenspiel; D major, 112 BPM), `electronic-drive` (four-on-the-floor, pumping bass, supersaw pads, stabs, risers; A minor, 126 BPM), `cinematic-action` (taiko-style drums, staccato ostinato, low brass swells and braams, risers, impacts; D minor, 100 BPM), `lo-fi` (dusty swung beat, electric-piano 7th/9th chords, vinyl crackle; 84 BPM). `null` = the style preset's genre. |
| `music.bpm`, `music.transpose` | Tempo (`null` = the genre's default) and key shift in semitones. |
| `music.file` | A licensed track (any format ffmpeg reads, path relative to `build/`) instead of synthesis: it is cut to the video's length, faded out and normalised. Check the licence covers the use (ads usually need a commercial/sync licence). |
| `music.sections` | Script section id → music section, in this order: `intro build full1 breakdown full2 peak outro`. Build where the story builds, break down at the low point, peak on the product, resolve in the CTA. Unmapped music sections are squeezed between their mapped neighbours. |
| `sfx.gain`, `sfx.files` | Level of the sound-effects layer in dB (default 0), and licensed files that replace synthesized types: `{ "impact": "sfx/impact-01.wav", "whoosh": "sfx/whoosh.wav" }` (peak-normalised; a riser file is placed so it ends on its cue). Cues come from `buildCues()` in `scenes.js` (`references/scenes.md`). |
| `mix.mute` | `none` (default) or `FIRST-LAST` line ids: the music is muted from the start of one line to the end of the other, for a stretch that should land dry. Override with `MUTE=`. |
| `mix.duck`, `mix.gap` | Music level under speech (−20 dB) and in pauses (−12 dB). Override with `DUCK=` / `GAP=`. |
| `encode.crf` | x264 quality (18 = near-transparent, 23 = smaller files). Override with `CRF=`. |
| `whisper.align`, `whisper.verify` | Optional model overrides (also `WHISPER_ALIGN_MODEL` / `WHISPER_VERIFY_MODEL`). |

## Language

English is the default. For another language:

1. Set `language` (`de`, `fr`, `sv`, …). The engine then switches Whisper from the English-only `.en` models to
   the multilingual ones (`whisper-base_timestamped` for alignment, `whisper-small` for the final check) and
   tells them the language. The `.en` models are used only when the language is English.
2. Use a voice that speaks it: Kokoro in this engine is English only; Gemini, OpenAI and ElevenLabs are
   multilingual; a recording works in any language.
3. Translate `voice.sacrifice` if the provider needs the throwaway sentence.
4. `numberWords` must spell numbers in that language.
5. The `tokens()` normaliser in `align.mjs` handles any Unicode letters, but its "dot com" rule is English;
   write URLs the way they are spoken and add soundalikes as needed.

Non-English runs are untested: check the first `narrate.mjs` report and `verify-words.mjs` output closely.

## `style.json`, `palette.json`, `fonts.json`

See `references/style.md`. `style.json` is `{ "preset": "<styles/ name>" | "custom", …overrides }` and is
decided with the user in the style-direction step. Required palette keys: `background`, `ink`, `accent`,
`highlight`. `fonts.json` has a `display` font (captions, titles) and a `ui` font.

## Sound

- Narration is normalised to -16 LUFS, the music is level-matched to it and then ducked (`mix.duck` under
  speech, `mix.gap` in pauses), sound effects are ducked 5 dB under speech, and the whole mix is
  loudness-normalised to -14 LUFS with a true peak at or below -1 dBTP.
- To use licensed audio instead of synthesis: `music.file` for the bed, `sfx.files` per effect type.

## `scene/scenes.js`

Rewritten per video (`references/scenes.md`). Line ids used there must exist in `video.json`.

## `scripts/`

| Script | Use |
|---|---|
| `audition.mjs` | Voice samples per provider, to choose by ear. |
| `sample-palette.mjs` | Colours from the reference art. |
| `fontcmp.mjs` | Font candidates next to the art's lettering. |
| `cut-art.mjs` | Line art on white → transparent cells + `cells/cells.json`. |
| `gen-art.mjs` | Optional Gemini image generation (untested reference script). |
| `sheet.mjs` | Contact sheets of a finished video. |
