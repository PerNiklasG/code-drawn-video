# code-drawn-video

A Claude Code skill that makes promo, explainer, ad and sales videos entirely from code. The full guide is in
[skills/code-drawn-video/README.md](skills/code-drawn-video/README.md); start with
[HOWTO.md](skills/code-drawn-video/HOWTO.md).

## Install as a plugin (Claude Code)

```
/plugin marketplace add PerNiklasG/code-drawn-video
/plugin install code-drawn-video@code-drawn-video
```

The repository is private: you need read access, and your git must be signed in to GitHub
(`gh auth login`). For background auto-updates, set `GITHUB_TOKEN` in your shell.

## Install as a plain skill

```
git clone https://github.com/PerNiklasG/code-drawn-video ~/code-drawn-video
ln -s ~/code-drawn-video/skills/code-drawn-video ~/.claude/skills/code-drawn-video
```
