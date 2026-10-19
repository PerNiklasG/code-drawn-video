# Windows, macOS and Linux

The engine is plain Node (ES modules) plus three external programs it finds by itself. There are no shell
scripts and no hard-coded install paths; the project folder is always the one the user passes to
`new-video.mjs`.

## Setup

1. **Node 20 or newer** (nodejs.org, or a version manager). Check: `node -v`.
2. **Google Chrome**, Chromium or Microsoft Edge (all Chromium; the renderer drives it headless).
3. **ffmpeg**: optional to install yourself. If it is not on PATH, `npm install` provides one through the
   `ffmpeg-static` package.
4. Bootstrap a project anywhere:
   ```
   node <skill>/new-video.mjs <project-dir>
   ```
   It copies the engine to `<project-dir>/build`, runs `npm install` there and prints which ffmpeg and Chrome
   it found.

## How tools are found

| Tool | Order |
|---|---|
| ffmpeg | `FFMPEG_PATH` → `ffmpeg` on PATH → `ffmpeg-static` npm package |
| Chrome | `CHROME_PATH` → Windows: `%PROGRAMFILES%`, `%PROGRAMFILES(X86)%`, `%LOCALAPPDATA%` (Chrome, Chromium, Edge); macOS: `/Applications` and `~/Applications` (Chrome, Chromium, Edge); Linux: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge` on PATH |

Set the variables in the shell before running:

```
# macOS / Linux
export CHROME_PATH="/path/to/chrome"
export FFMPEG_PATH="/path/to/ffmpeg"

# Windows PowerShell
$env:CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:FFMPEG_PATH="C:\ffmpeg\bin\ffmpeg.exe"
```

ffprobe is not needed: stream lengths are measured with ffmpeg itself (the `ffprobe-static` package ships an
x86-only binary for Apple Silicon, which fails without Rosetta).

## Other environment variables

| Variable | Effect |
|---|---|
| `NAME`, `VOICE`, `TEMPO`, `PAUSE_SCALE`, `MUTE`, `DUCK`, `GAP`, `CRF` | Override the matching `video.json` value for one run. |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` | Cloud voices (and `gen-art.mjs` for Gemini). |
| `GEMINI_TTS_MODEL`, `OPENAI_TTS_MODEL`, `ELEVENLABS_MODEL`, `GEMINI_IMAGE_MODEL`, `KOKORO_MODEL` | Model overrides. |
| `WHISPER_ALIGN_MODEL`, `WHISPER_VERIFY_MODEL` | Whisper model overrides. |
| `DEBUG=1` | Print full stack traces instead of one-line errors. |

Setting an environment variable for one command: `NAME=v2 node mix.mjs` (macOS/Linux), or in PowerShell
`$env:NAME="v2"; node mix.mjs` (it then stays set for that window).

## What has and has not been tested

| Part | macOS (Apple Silicon) | Windows | Linux |
|---|---|---|---|
| Full pipeline with both examples (Kokoro, music, SFX, render, mix, sheets, verify) | tested | untested | untested |
| Fresh `npm install` + ffmpeg from `ffmpeg-static` only | tested | untested | untested |
| `recorded` voice (whole file and per section) | tested | untested | untested |
| Presets: action-comic and hand-drawn full videos; flat-motion and kinetic-type style frames | tested | untested | untested |
| Music genres electronic-drive and acoustic-gentle in full videos; cinematic-action and lo-fi rendered and checked for levels only | tested | untested | untested |
| Synthesized SFX layer | tested | untested | untested |
| Licensed `music.file` / `sfx.files` | untested everywhere | | |
| Gemini / OpenAI / ElevenLabs voices, `gen-art.mjs` | untested everywhere (no keys were used) | | |
| Non-English languages | untested everywhere | | |

The code is written to be portable: `path.join` everywhere, `fileURLToPath`/`pathToFileURL` instead of URL
pathnames (which break on drive letters), child processes spawned with argument arrays and no shell (the one
exception is `npm` itself on Windows, which is a `.cmd` file Node can only start through a shell), and a WAV
writer in Node instead of shell tools.

Things to watch for on the first Windows or Linux run:
- **npm install scripts.** npm 11 may warn that install scripts for `sharp`, `onnxruntime-node`, `protobufjs`
  and `ffmpeg-static` were not approved. On macOS arm64 everything worked without them. If a package then fails
  to load, run `npm approve-scripts` (or `npm rebuild <package>`).
- **Linux Chrome sandbox.** Headless Chrome as root, or in some containers, needs `--no-sandbox`; add it to the
  `args` of `puppeteer.launch` in `render.mjs` and `scripts/fontcmp.mjs` only if launching fails.
- **Fonts.** The scene loads its fonts from `fonts/` itself, so system fonts don't matter. `sheet.mjs` labels use
  a generic sans-serif.
- **Long paths on Windows.** Keep the project folder short (for example `C:\videos\acme`): `node_modules` paths
  are deep.
- **Agent harnesses** may kill commands that print nothing for minutes. `render.mjs` prints progress every 150
  frames; run long steps in the background and poll.
