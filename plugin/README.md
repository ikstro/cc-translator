# language-tutor (Claude Code plugin)

Learn a language while you work. The plugin copies each message of the conversation for the **Tutor** panel in VS Code and, while the panel is on screen, has a small tutor model (Haiku or Sonnet, on your own account) translate it into the language you learn and correct what you write. It never changes Claude's own answers or prompt.

Install the panel too: **Language Tutor for Claude Code**, the `.vsix` from [the latest release](https://github.com/ikstro/cc-translator/releases/latest). Full guide, voices and privacy: [github.com/ikstro/cc-translator](https://github.com/ikstro/cc-translator).

```
/tutor on | off
/tutor level B1          A1 … C2, or off for natural text
/tutor lang Polish       the language you learn (default English)
/tutor native German     your language
/tutor model haiku       haiku | sonnet
/tutor read on           read each reply aloud (needs a system voice; the panel shows how to add one)
/tutor status
```
