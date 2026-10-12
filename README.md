# CC-translator: a language tutor inside Claude Code

Learn a language while you work. Claude Code keeps doing the real job and talks to you exactly as it always does. The plugin only reads the conversation; a small tutor model turns it into the language you learn (English by default) with a translation into your own, and the **Tutor** panel in VS Code shows it: tap a sentence to see the translation, press play to hear it with each word highlighted, and see your own messages in the language you learn (or corrected, when you already wrote in it).

Two parts, both in this repository:

| Part | Folder | What it does |
| --- | --- | --- |
| Claude Code plugin `language-tutor` | `plugin/` | The `/tutor` command, a read-only copy of the conversation for the panel, and a background tutor that translates and corrects with a small model |
| VS Code extension **Language Tutor for Claude Code** | `panel/` | The Tutor view: the latest exchange, this session's history, tap-to-translate sentences, corrections, read-aloud with word highlighting, word meanings, settings |

## Requirements

- Claude Code with plugin support, signed in (the tutor runs on your own account, no API key).
- VS Code 1.98 or later, or Cursor / VSCodium (the panel is on Open VSX too).
- Windows or macOS for reading aloud (see [Voices](#voices)). Everything else works on Linux too.

## Install

**1. The plugin**, in Claude Code:

```
/plugin marketplace add ikstro/cc-translator
/plugin install language-tutor@cc-translator
```

**2. The panel**, in VS Code: search **Language Tutor for Claude Code** in Extensions, or

```
code --install-extension ikstro.language-tutor-panel
```

Cursor and VSCodium find it on Open VSX under the same name. Without a marketplace: download the `.vsix` from [Releases](https://github.com/ikstro/cc-translator/releases) and use *Extensions → … → Install from VSIX*.

**3.** Open **Tutor** from the activity bar, drag it next to the Claude Code chat, and turn on the switch in its header (or run `/tutor on`).

## Use

Work as usual. While the Tutor panel is on screen, every message shows up in it.

**One window learns at a time.** Turning the tutor on in a window makes its project the one that learns; any other VS Code window stops translating by itself and shows *Learning is on in <project> · Learn here*. There, messages are still collected and each gets a **Translate** button, so nothing is spent unless you tap. `/tutor on` in Claude Code makes that session's project the learning one.

- **The panel shows the latest exchange**

- The latest exchange is your message and Claude's replies until your next message. The clock icon opens this session's **History**; tap an earlier exchange to see it, **← Latest** returns.
- **Your message comes first in the language you learn.** Written in your language, it shows as the tutor's version, sentence by sentence; tap a sentence to see what you wrote. Written in the language you learn, it shows corrected (`~~wrong~~ **right**` and one line why), or **✓ No mistakes**.
- **Claude's replies are in the language you learn**, whatever language the chat used: also a third one (Claude answered in English while you learn Polish from Russian), which the tutor writes in both of your languages at once. Tap a sentence for its translation; the button with your language code shows every translation. ▶ next to a translation reads that sentence, **Listen** reads the whole message; while it reads, the button becomes **Stop** and the spoken word is highlighted.
- **Hold Shift and point at a word** (mouse or pen) for its dictionary meanings: the base form ("show, from showing") and up to three translations per part of speech. These are dictionary meanings, not the meaning in that exact sentence; the sentence translation gives that. Works when you learn English (see [Word dictionaries](#word-dictionaries)). The setting `languageTutor.wordHint` makes it plain hover (`hover`) or turns it off.
- **A plan opens in its own tab.** When Claude presents a plan in plan mode, a **Tutor · Plan** tab opens beside the chat with the plan sentence by sentence, the same translations on tap, Listen and word meanings. Open it again from the History sheet or with **Tutor: Open the latest plan**; `languageTutor.openPlan` set to `manual` keeps plans from opening by themselves.
- **Any text from an editor.** Select text in any file (or nothing, for the whole file), right-click and choose **Tutor: Translate the selection**. Claude Code must be open in this folder, since its plugin does the translating.
- **Clear history** is at the bottom of the History sheet (and in the panel's title bar). It deletes this session's copy only; the conversation in Claude Code stays.
- **The language chip** in the header opens the settings: the language pair (a searchable list), the level of the tutor's text (B1 = plain everyday words, Natural = no simplification), the tutor model, the voice and its speed, and "read each reply aloud". On first start your language is the one VS Code is set to (or your system's), Russian otherwise.

The same settings as commands in Claude Code:

```
/tutor on | off
/tutor level B1          A1 … C2 for the tutor's text, or off for natural
/tutor lang Polish       the language you learn (default English)
/tutor native German     your language
/tutor model haiku       haiku | sonnet, the tutor model
/tutor read on           read each reply aloud
/tutor status
```

## Voices

Reading aloud uses the voices installed on your computer: no tokens, nothing sent anywhere. The language list in the settings marks languages that have a voice. When the language you learn has none, the panel says so and shows how to add one:

- **Windows 10/11:** Settings → Time & language → Speech → **Add voices** → pick the language → Add. Then restart VS Code. (The panel's **Open speech settings** button goes straight there.)
- **macOS:** System Settings → Accessibility → Spoken Content → System voice → **Manage Voices…** → tick the language. Then restart VS Code. (Untested so far; reports welcome.)
- **Linux:** no reading aloud yet.

The voice and speed are saved per computer in VS Code settings (`languageTutor.voice`, `languageTutor.rate`), since voices differ between machines.

## Word dictionaries

Word meanings come from offline dictionaries built from [WikDict](https://www.wikdict.com) (Wiktionary). They exist for **English → your language**, so they work while you learn English:

- English → Russian ships with the panel.
- English → Spanish, German, French, Italian, Portuguese, Polish, Czech, Dutch, Swedish, Norwegian, Danish, Finnish, Greek, Turkish, Bulgarian, Japanese, Chinese and Indonesian are downloaded once (0.2–0.7 MB) from this repository's [releases](https://github.com/ikstro/cc-translator/releases/tag/dict-1) the first time you look up a word, then work offline. Turn `languageTutor.downloadDictionaries` off to stop that.
- Other pairs, and other languages you learn (Polish, German…), have no word card yet; tap the sentence for its translation.

## What it costs

- **Your main conversation is untouched.** The plugin adds nothing to the prompt and changes no message: it only reads each message after it is stored. Claude answers in whatever language its own settings say.
- **The tutor model runs only in the learning window, while its Tutor view is on screen.** While the tutor is on, every session's messages are copied to a small file (deleted after a day), so nothing is lost when you open the panel later; they are translated only while the learning project's panel or one of its tabs is visible. Messages that arrived otherwise, or in other windows, get a **Translate** button. Other projects and background sessions cost no tokens.
- **One call per message** (a long reply or a plan goes in batches of about 5,000 characters): about the text's length in and out, on Haiku by default (Sonnet for better explanations).
- **The settings sheet counts the tutor's tokens**: today, the last 7 and 30 days, and per project over 30 days (kept in `~/.claude/language-tutor/usage/`, one small file per session, deleted after 31 days).
- **Voices and word meanings** cost no tokens.

## Privacy

- Files live in `~/.claude/language-tutor/`: `settings.json`, `learner.json` (the learning project), one file per session in `sessions/`, token counts in `usage/`, Translate taps in `requests/`, and a small heartbeat per open panel in `panels/`. Session files untouched for a day are deleted; Clear deletes one at once.
- Only what you typed, Claude's text replies, the plans it presents and the texts you pick are copied: no tool output, no other file contents. Background notices, scheduled runs and messages from other sessions are skipped.
- The text goes to the tutor model on your own Claude account; no other service sees it. The only other network request is the one-time dictionary download from GitHub, which sends nothing but the file name.
- The panel never runs code from a message: everything is escaped, the webview allows only its own script, and remote images and pages do not load.

## Develop

- Plugin: `claude --plugin-dir ./plugin` loads it for one session; `claude plugin validate ./plugin` and `claude plugin test ./plugin` check it.
- Panel: `cd panel && npm install && npm run build`; `npm test`, `npm run typecheck`; `npm run package` makes the `.vsix`.
- Dictionaries: `npm run dict` rebuilds the shipped `media/dict/en-ru.json`; `node scripts/build-dict.mjs de --release` writes `.cache/release/en-de.json.gz` for the `dict-1` release. Translations are ranked by back-translation through the reverse dictionary.

## Credits

Word dictionaries: [WikDict](https://www.wikdict.com) by Karl Bartel, data from [Wiktionary](https://www.wiktionary.org) via DBnary, licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). The dictionary files are shared under the same license; see `panel/NOTICE`. Icons: [Codicons](https://github.com/microsoft/vscode-codicons).

## License

Code: MIT. Dictionary data: CC BY-SA 4.0.
