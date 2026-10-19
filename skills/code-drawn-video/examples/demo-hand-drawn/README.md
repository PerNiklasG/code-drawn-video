# Second example: "Pebblesprout", hand-drawn (fictional)

The same made-up habit app as `examples/demo`, told as a calm 50-second explainer in the `hand-drawn` preset —
to show how differently the engine can look and sound for the same product. Watch `demo-hand-drawn.mp4`
(the captioned copy is left out of the package to keep it small; `node mix.mjs` writes it).

- **Style:** `build/style.json` = `hand-drawn` preset, slightly lighter (5 px strokes boiling at 6 fps): warm
  paper, charcoal ink, coral / teal / mustard fills, handwritten captions (Patrick Hand), Nunito for UI text,
  soft slide/wipe/zoom/dissolve transitions, slow Ken Burns. Everything is drawn in code.
- **Voice:** Kokoro `af_heart`, calm pace. **Music:** `acoustic-gentle` at 104 BPM, transposed to C, muted under
  "So you quit." No sound effects.
- **Script:** `script/demo-script-v1.md`.

Results on the shipped cut: 16/16 lines `OK` in `verify-words.mjs`, 112/112 script words heard in
`verify-mp4.mjs`, -14.1 LUFS, true peak -1.8 dBFS, 1520 frames (50.67 s).

Re-run: `node <skill>/new-video.mjs <folder> --example demo-hand-drawn`, then in `build/`:
`node narrate.mjs && node music.mjs && node render.mjs && node mix.mjs`.
