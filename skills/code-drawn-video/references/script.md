# The script

## Length: the user chooses, the words follow

Spoken English runs at about **150 words per minute** in this format, including short pauses. Budget the words
before writing, and leave a few seconds of tail for the logo and the music to resolve:

| Target length | Words (about) | Lines (about) |
|---|---|---|
| 15 s | 30 | 3–4 |
| 30 s | 70 | 6–8 |
| 45 s | 105 | 10–12 |
| 60 s | 140 | 13–16 |
| 90 s | 210 | 20–24 |
| 2 min | 290 | 28–32 |

Pace changes it: `voice.tempo` speeds the voice up (1.1 = 10 % faster) and `voice.pauseScale` shortens every
planned pause. Narrate once, read `timeline.total`, and trim words rather than speeding past 1.15.

## Structures

Pick one with the user; the section ids become the music arrangement and the shot list. Reuse these ids.

**Story-led sales video** (90 s – 2 min)
| Section | Job |
|---|---|
| `hook` | A person and a surprising fact, in under 8 s |
| `problem` | The viewer's pain, in their own words |
| `turn` | The reversal, then the one-sentence thesis |
| `mechanism` | What the product does, in concrete nouns and steps |
| `cta` | One line per audience, then the URL |

**Product explainer** (45–90 s)
| Section | Job |
|---|---|
| `hook` | The situation the viewer recognises |
| `problem` | Why the usual way fails |
| `mechanism` | How it works, in three steps |
| `proof` | Why it works: a mechanism, a number or a customer, all checkable |
| `cta` | What to do now, and where |

**Short ad** (15–30 s)
| Section | Job |
|---|---|
| `hook` | One line that stops the scroll |
| `benefit` | One benefit, shown, not listed |
| `cta` | Name + where |

The bundled examples: `examples/demo` is a 37 s short ad (hook → problem → product in three beats → CTA,
`script/demo-script-v1.md`); `examples/demo-hand-drawn` is a 50 s product explainer.

## Writing for this format

- **Short spoken sentences, one idea each.** A line becomes one subtitle and usually one visual beat.
- Write in the register of the chosen style: a punchy ad is short fragments and hard beats ("Day nine. Gone."),
  an explainer is plain, warm sentences, as if telling a friend. Read it aloud before voicing it.
- Concrete numbers and nouns give the visuals something to animate (a counter, a year, a card).
- **Write numbers as they are spoken** ("about four thousand", "nineteen ninety"), or add every digit string to
  `numberWords` in `video.json`. Whisper writes numbers as digits, so both sides must normalise the same way.
- **Write the URL as it is spoken**: "acme dot com", not "acme.com".
- **Every claim must be checkable against the client's own public source.** Quote the source's wording and pin
  years ("In 2024, …" rather than "last year"). Flag claims to the user rather than inventing them; never invent
  numbers, customers or awards.
- **Plan the pauses**: short between lines in a section, longer at section ends and after a reveal. They become
  the `pause` values.
- **Version scripts**: never edit an old version. Copy `script-vN.md` to `script-vN+1.md`, edit the copy, and
  keep a diff (`git diff --no-index script-v1.md script-v2.md > v1-to-v2.diff`, or any diff tool).

## File layout: `script/script-v1.md`

```
<Title> — "<working name>"
Runtime ~0:50 · ~110 words · <audience> · <structure>

0:00 — HOOK
VISUAL: What is on screen, what animates, which art.
Narration for this section.

0:07 — PROBLEM
VISUAL: …
```

## From script to `video.json` `lines`

Each sentence (or short pair) becomes one entry: `[id, section, text, pauseAfterSeconds]`.

```json
["M03", "mechanism", "Each day you do it, tap your pebble, and a little sprout grows.", 0.4]
```

- **Ids are the API between the narration and the scenes.** Reworded line: keep its id. New line: a new id.
  Removed line: search `scenes.js` for `'<id>'` and fix every `S(`, `E(`, `until(`, `cut(` and `wordTime(`
  (unknown ids fail loudly at render time). Ids must not contain `-` (the music mute uses `FIRST-LAST`).
- Pauses: 0.3–0.4 s between lines in a section, 0.9–1.2 s at section ends and after big reveals, scaled by
  `pauseScale`. The last line's pause is ignored; `tail` holds the end.
- One request voices one section, so keep sections to roughly 10–40 s of speech.
