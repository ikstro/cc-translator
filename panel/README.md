# Language Tutor for Claude Code

Learn a language while you work with Claude Code. This panel shows your conversation in the language you learn (English by default): tap a sentence for its translation into your language, see your own messages translated or corrected, listen to every reply with each word highlighted, and hold Shift over a word for its dictionary meanings.

Claude itself answers exactly as it always does; a small tutor model writes the panel's version on the side.

## You need the Claude Code plugin

The panel shows what the **language-tutor** plugin writes. Install it in Claude Code:

```
/plugin marketplace add ikstro/cc-translator
/plugin install language-tutor@cc-translator
```

## Start

1. Open **Tutor** from the activity bar and drag it next to the Claude Code chat.
2. Turn on the switch in the panel header.
3. Ask Claude Code anything. Your message and the reply show up in the panel while it is on screen.

## Using it

- **Tap a sentence** to show its translation under it; tap again to hide it. The button with your language code in the header shows every translation at once.
- **▶ next to a translation** reads that sentence; **Listen** reads the whole reply. While reading, the button becomes **Stop** and the current word is highlighted. Esc also stops.
- **Your messages** show in the language you learn first (tap for what you wrote), or corrected when you wrote in it already.
- **Hold Shift and point at a word** for its meanings (when you learn English).
- **Plans** Claude presents in plan mode open in their own tab beside the chat; any text in an editor can be sent there with **Tutor: Translate the selection** (right-click).
- **The language chip** in the header ("English → Russian · B1") opens the settings: the language pair, how plain the tutor's text is, the tutor model (Haiku or Sonnet), the voice, its speed and "read each reply aloud".

Everything works with a pen: tap to translate, nothing depends on hovering.

## Voices

Reading aloud uses the voices installed on your computer, free and offline. If the language you learn has none, the panel says so:

- **Windows:** Settings → Time & language → Speech → **Add voices** → the language. Restart VS Code.
- **macOS:** System Settings → Accessibility → Spoken Content → System voice → **Manage Voices…**. Restart VS Code.
- **Linux:** no reading aloud yet.

## Word dictionaries

English → Russian ships with the extension. English → Spanish, German, French, Italian, Portuguese, Polish, Czech, Dutch, Swedish, Norwegian, Danish, Finnish, Greek, Turkish, Bulgarian, Japanese, Chinese and Indonesian download once (under 1 MB) from the project's GitHub releases on the first word you look up. Set `languageTutor.downloadDictionaries` to off to prevent that.

## Settings

- `languageTutor.voice`, `languageTutor.rate`: the voice and speed (also in the panel's settings).
- `languageTutor.wordHint`: `shift` (default), `hover` or `off` for the word card.
- `languageTutor.openPlan`: `auto` opens a plan's tab as soon as it arrives, `manual` waits.
- `languageTutor.downloadDictionaries`: download word dictionaries when needed (default on).
- `languageTutor.allSessions`: show the latest Claude Code session from any folder, not only this workspace.

## Privacy

Messages stay on your computer in `~/.claude/language-tutor/` (deleted after a day) and go only to the tutor model on your own Claude account. The panel loads nothing remote except the one-time dictionary download.

More: [github.com/ikstro/cc-translator](https://github.com/ikstro/cc-translator). Dictionary data: WikDict / Wiktionary, CC BY-SA 4.0 (see NOTICE).
