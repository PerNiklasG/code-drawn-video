# How to use code-drawn-video

You talk to Claude Code in plain language. The skill does the rest and stops to ask you whenever a decision is yours.

## 1. Install (once)

1. Install **Node.js 20+** and **Google Chrome**. ffmpeg is fetched automatically if you don't have it.
2. Install the skill, either way:
   - **As a plugin** (needs git): in Claude Code, run
     `/plugin marketplace add PerNiklasG/code-drawn-video` and then
     `/plugin install code-drawn-video@code-drawn-video`.
   - **From the zip**: unzip this folder to
     `~/.claude/skills/code-drawn-video` (Mac / Linux) or
     `%USERPROFILE%\.claude\skills\code-drawn-video` (Windows).
3. Start a new Claude Code session.

## 2. Check it works

> Rebuild the demo example in a folder called `pebblesprout-test`.

Claude sets up the project, installs what it needs (about 1 GB the first time) and renders the example ad. If a
video comes out, you're ready.

## 3. Make a video

Describe it:

> Make a 45-second ad for [product], aimed at [audience]. The goal is for viewers to sign up at [example.com].
> Here's our brand guide and logo: [files]. Put the project in `C:\Videos\launch-ad`.

Claude then works through these steps, pausing for you:

1. **Brief.** It asks for anything missing: length, claims and where they're backed up, reference art, voice.
2. **Style.** It proposes 2–3 looks based on your brand. You pick one, or describe your own.
3. **Script.** It writes the script. Nothing is recorded until you approve it.
4. **Voice.** It plays you sample voices and you choose by ear.
5. **Production.** Art, music, sound effects and animation are built, then the video is rendered.
6. **Check.** It transcribes the finished video, reviews the frames, and hands you `<name>-v1.mp4` plus a
   captioned version.

## 4. Change a video

Say what you want. Each change becomes a new version (v2, v3…), so earlier cuts are kept:

- "Make the opening punchier." / "Cut it to 30 seconds."
- "Try a different voice." / "Change the last line to …"
- "Less confetti, more explosions."
- "Use our own music track: [file]."

## 5. Create your own looks

> Create a new style called "neon-retro": dark purple, glowing pink and cyan, glitch transitions, synthwave music.

The look is saved next to the built-in ones and can be reused for every later video. You can also tweak a look
for one video only: "use action-comic, but calmer and without explosions".

Changes to colours, fonts, backgrounds, lines, captions, transitions, motion, camera or music style are quick.
Something the engine can't do yet (a new kind of effect or sound) means Claude writes new code for it, which
works but is a bigger job, so check the preview frames before the full render.

## 6. Voices

- **Free, no account:** the local voice. Good for drafts, but it sounds a little robotic and can't do an intense
  read.
- **Better quality:** an API key for **Gemini** (Google AI Studio), **OpenAI** or **ElevenLabs**. Tell Claude
  which one and set the key as an environment variable, not in the chat.
- **Your own voice:** record the script and Claude cuts it to fit the animation.

## Good to know

- Claims in the script must match what's on your own website. Claude will ask for the source.
- The cloud voices and Windows haven't been tested yet. If something breaks on the first run, show Claude the
  error and ask it to fix it.
