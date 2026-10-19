# Voices: providers, keys, auditioning, voicing rules

## Find your own voice

The voice carries more of the video than any frame. Never choose one by its name or a description: voice the
same passage with several voices and let the user pick by ear.

```
node scripts/audition.mjs --provider kokoro                      # the provider's shortlist
node scripts/audition.mjs --provider openai --voices coral,sage  # specific voices
node scripts/audition.mjs --provider elevenlabs --list           # every voice on the account
node scripts/audition.mjs --provider gemini --text "Your own passage." --prompt "A calm friend, unhurried."
```

Samples land in `<project>/voice-samples/<provider>-<voice>.wav`. The default passage is the first lines of
`video.json`, so the user hears their own script. Audition the direction prompt too: the same voice reads very
differently as "a founder telling a story to a friend" and as "an announcer". The style preset supplies a default delivery
(`style.json` `voice.prompt`, `tempo`, `pauseScale`): an energetic ad read for `action-comic` and
`kinetic-type`, a clear product expert for `flat-motion`, a warm storyteller for `hand-drawn`. Match the read
to the chosen direction; a calm read under punchy visuals (or the reverse) feels wrong at once. Then set `voice.provider`,
`voice.voice` and `voice.prompt` in `video.json`. Pace is easier to judge in the finished narration: start at
`tempo` 1.0 and `pauseScale` 1.0, and adjust after the first full listen ("stale" usually means 1.05–1.1 and
0.6–0.8).

## Providers

All adapters live in `engine/voices/` and share one interface (`voices/index.mjs`):
`synthesize({ text, voice, prompt, language }) → { pcm: Float32Array, sampleRate }`, `listVoices()` and a
`meta` record (`needsSacrificeTail`, `supportsPrompt`, `key`, `shortlist`, `untested`). To add a provider, copy
`openai.mjs`, keep the interface, and add its id to `PROVIDERS`.

| Provider | Account / key | Status | Notes |
|---|---|---|---|
| `kokoro` | none, runs locally (~90 MB model, downloaded once) | **tested** (macOS) | Free, deterministic, English only (American `af_*`/`am_*`, British `bf_*`/`bm_*`). Sounds noticeably more synthetic than the cloud voices and **cannot do an intense, dramatic or shouted read**: it ignores the prompt, so energy comes only from `speed`, `sentenceGap`, `pauseScale` and the script's punctuation. Fine for drafts and the demos; audition a cloud voice or record your own for a real video, especially an energetic ad. |
| `recorded` | none | **tested** (macOS) | Your own narration (below). |
| `gemini` | `GEMINI_API_KEY` from Google AI Studio (aistudio.google.com/apikey); no Google Cloud project | untested reference adapter | Model `gemini-2.5-flash-preview-tts` (override `GEMINI_TTS_MODEL`). Takes the prompt as natural-language direction. 30 prebuilt voices. Uses the sacrifice tail. |
| `openai` | `OPENAI_API_KEY` | untested reference adapter | `gpt-4o-mini-tts` (override `OPENAI_TTS_MODEL`); the prompt goes in `instructions`. |
| `elevenlabs` | `ELEVENLABS_API_KEY` | untested reference adapter | `voice` is a voice_id (`--list`); model `eleven_multilingual_v2` (override `ELEVENLABS_MODEL`). No prompt; the character comes from the voice. |

"Untested reference adapter" means it was written against the provider's public API documentation and never
run against the live API. Expect to check the request and response against the current docs on the first run.
Each fails with a clear message when its key is missing.

Optional, if the user already has Google Cloud: Gemini voices are also available through the Cloud
Text-to-Speech API with gcloud authentication. That is not needed for anything here, and no adapter ships for it.

**Keys:** set them in the shell (`export GEMINI_API_KEY=...`, PowerShell `$env:GEMINI_API_KEY="..."`) or the
user's own secret manager. Never paste a key into chat, never write it into the project, and ask the user before
the first paid request (an audition of 8 voices × 40 words is a few cents on most providers; a full narration
with retries a little more).

## Recording your own narration

1. Record in a quiet room, close to the microphone, at an even distance. Any format ffmpeg reads works.
2. Read the script **as written**. Either one file per section, named after the section id
   (`recordings/hook.wav`, `recordings/problem.m4a`, …), or one file for the whole script
   (`recordings/narration.wav`).
3. Leave a short breath between lines; you don't need exact pauses, they are rebuilt from `video.json`.
4. Set `voice.provider` to `recorded` and run `node narrate.mjs`. The aligner cuts the recording into lines
   exactly as it does a TTS take. A file that does not match the script (a skipped word, an ad-lib, a false
   start) is reported with what Whisper heard: re-record that file, or edit the line to what was said.

## Voicing rules (how to avoid clipped words)

1. **Voice a whole section in one request**, not one line at a time: the intonation flows across sentences.
   The aligner then cuts the take into lines.
2. **Some models chop the last syllable of a request.** Adapters that do it set `needsSacrificeTail`; the
   narrator then ends every request with a throwaway sentence ("Thank you.", `voice.sacrifice`), and the aligner
   excludes it from the alignment and cuts it off. Force it per video with `voice.sacrificeTail: true`.
3. **Never cut at silences.** Stop consonants (p, t, k, b, d, g) contain silences, so splitting on silence cuts
   words in half and moves their endings into the next line. The aligner places each cut between two
   Whisper-aligned words only, at the quietest point in the 0.25 s before the next word's onset: Whisper ends
   words early, and a final consonant's closure ("…mark-ets") is quieter than the pause after it.
4. **Exclude the throwaway sentence from the alignment.** Otherwise a line ending in the same word ("…for
   you") matches the throwaway "you" and keeps it.
5. **Re-request takes that don't match** the script (`narrate.mjs` retries up to four times with cloud voices).
   Deterministic voices (Kokoro) give the same audio every time: reword or respell instead.
6. **Verify by transcription, never by audio levels.** A "clip ends quietly" check passes while words are
   missing. `node verify-words.mjs` transcribes every line: `DIFF` means the words differ, `SUSPECT` means
   speech runs to within 0.1 s of the clip's end — listen to it. `node verify-mp4.mjs ../<name>.mp4` checks the
   final file against the whole script.
7. **Names get misheard.** Whisper writes "Acme" as "Akme". That is a recognition error, not missing audio: add
   a `soundalikes` entry. If the voice itself mispronounces a name, add a `ttsRespell` entry for the voice only.
8. **Numbers**: write them as spoken in the script, and add `numberWords` for every digit string (Whisper
   returns digits).
9. **Takes are cached by their exact request** (provider, voice, prompt, text) in `audio/takes/<provider>/`.
   Editing a line re-voices only its section. Delete a section's files to force a new take.
