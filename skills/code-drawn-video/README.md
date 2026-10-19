# code-drawn-video — a Claude Code skill

**New here? Start with [HOWTO.md](HOWTO.md)** — install, a first test run, and how to ask Claude for a video.

Makes promo, explainer, ad and sales videos entirely from code, in a style worked out with you for your brand:

- every frame is drawn on a canvas in headless Chrome. There is no house style: Claude proposes 2–3 directions
  from your brand material and the video's purpose, and you pick. Presets cover flat motion graphics, kinetic
  typography, comic-book action and hand-drawn, and every setting (backgrounds, line treatment, caption style,
  transitions, motion energy, camera) can be changed or combined into your own;
- a deterministic effects kit drawn in code: action bursts, sparks, debris, smoke, explosions, fire, speed
  lines, shockwaves, confetti, glow, screen shake;
- narration from a voice you choose by ear — a free local voice (Kokoro), a cloud voice with your own API key
  (Gemini API, OpenAI, ElevenLabs), or your own recording — aligned to the script word by word with Whisper, so
  no word gets clipped;
- music synthesized in Node in several genres (gentle acoustic, electronic drive, cinematic action, lo-fi) that
  follow the script's sections, plus synthesized sound effects (whooshes, impacts, booms, risers, pops) placed on
  spoken words — or your own licensed music and SFX files;
- ffmpeg mixes to -14 LUFS and writes the video plus a captioned copy.

No cloud account, video editor or stock footage is needed.

## Install

Unzip so that `SKILL.md` sits directly in the skill folder:

- macOS / Linux: `~/.claude/skills/code-drawn-video/`
- Windows: `%USERPROFILE%\.claude\skills\code-drawn-video\`

Then ask Claude Code for a video ("make a 30-second ad for our app"). It will ask for your product, length,
brand material and voice, propose style directions, and build the project in a folder you choose.

You need Node 20+, Google Chrome (or Chromium / Edge), and about 1.5 GB of disk per project for the speech
models. ffmpeg is optional: `npm install` provides one if it is not on PATH. Details and what has been tested on
which OS: `references/platforms.md`.

## Watch the examples

Both are for a made-up habit app, "Pebblesprout", to show range — not a look to copy:

- `examples/demo/demo.mp4` — a 37-second punchy ad in the `action-comic` preset with electronic music and SFX.
- `examples/demo-hand-drawn/demo-hand-drawn.mp4` — a calm 50-second explainer in the `hand-drawn` preset.

Everything in them — drawings, effects, voice (Kokoro), music, sound — was produced by this skill on one laptop
with no accounts. To rebuild one:

```
node new-video.mjs <some-folder>/pebblesprout-ad --example demo
cd <some-folder>/pebblesprout-ad/build
node narrate.mjs && node music.mjs && node render.mjs && node mix.mjs
```

## What's inside

| Path | |
|---|---|
| `SKILL.md` | The workflow Claude follows (brief → style direction → script → …), and the traps already paid for. |
| `references/` | Style and presets, script, scenes and effects API, voices, per-video settings, platforms. |
| `engine/` | The code copied into each project (`build/`), with `styles/` presets and `music/` genres. |
| `new-video.mjs` | Creates a project: `node new-video.mjs <project-dir>`. |
| `examples/` | The two examples' config, scenes, scripts and finished videos. |

The cloud voice adapters (Gemini, OpenAI, ElevenLabs) and the image generator are untested reference code: they
follow the providers' public API docs but were never run against the live APIs. Windows and Linux are untested;
the code is written to be portable.

Bundled fonts (Bangers, Rubik, Patrick Hand, Nunito) are under the SIL Open Font License; see each example's
`build/fonts/`.
