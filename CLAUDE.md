# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A language tutor on top of Claude Code: the user works with Claude as usual (in Russian or English) and learns English from a side panel in VS Code. Two independently built packages share files on disk:

- `plugin/`: Claude Code plugin `language-tutor` (a "mod": function hooks in TypeScript, run by the Claude Code engine, not Node).
- `panel/`: VS Code extension `language-tutor-panel` (extension host in Node + a webview).
- `.claude-plugin/marketplace.json` makes the repo root a local plugin marketplace named `cc-translator`.
- `design-lab/2026-10-08-tutor-panel/`: design record and a browser preview harness for the panel (not shipped).

## Commands

Panel (run in `panel/`):

```
npm install
npm run build            # esbuild: dist/extension.js (host) + media/panel.js (webview); copies codicons into media/
npm run typecheck
npm test                 # vitest, all tests
npx vitest run src/lemma.test.ts        # one file
npx vitest run -t "base forms"          # by test name
npm run dict             # downloads WikDict en-ru + ru-en into .cache/, writes media/dict/en-ru.json
npm run package          # build + .vsix
code --install-extension language-tutor-panel-<version>.vsix --force   # then Developer: Reload Window
```

Plugin (run in repo root):

```
claude plugin validate ./plugin
claude plugin test ./plugin
panel/node_modules/.bin/tsc -p plugin      # type-check; plugin/tsconfig.json extends .claude-plugin/types/tsconfig.json,
                                           # which the engine writes beside the plugin the first time it loads it
claude --plugin-dir ./plugin               # run a session with the working copy
claude plugin update language-tutor@cc-translator   # installed copy; only picks up a changed "version" in plugin.json
```

First-time install from the repo: `claude plugin marketplace add <repo path>` then `claude plugin install language-tutor@cc-translator`.

## Architecture

### Data flow (files under `~/.claude/language-tutor/`)

- `settings.json`: `{ enabled, level, target, native, tutorModel, autoRead }`. Written by `/tutor` and by the panel; both validate with their own `normalize`.
- `panels/<window>.json`: heartbeat `{ folders, visible, learning, ts }` the panel writes every 30 s and whenever `learner.json` changes (`visible` when the side panel or a document tab is on screen; `learning` when this window's folders are the learner's). The plugin records every session while the tutor is on, and calls the tutor model only when a fresh beat covering the session's cwd is visible and not `learning: false`.
- `learner.json`: `{ folders, ts }`, the project that learns (one window at a time, identified by folders so it survives a restart). Written by the panel's switch / "Learn here" (`setLearning`) and by `/tutor on` (the session's start folder); `learner.ts` decides `here | elsewhere | nowhere`.
- `usage/<sessionId>.json`: `{ project, days: { 'YYYY-MM-DD': { input, output, calls } } }`, written by the plugin after every tutor call (`countUsage`); the panel sums today / 7 / 30 days and per project (`usage.ts`) and deletes ledgers after 31 days.
- `sessions/<sessionId>.jsonl`: written only by the plugin (read-modify-write, serialized). Entry roles: `user`, `assistant`, `tutor` (correction or translation of a user message), `paired` (translation of a reply), `status` (`translating`/`failed`), `usage` (tokens per tutor call). Results point at their message with `ref`. An `assistant` entry with `origin: 'plan'` is the plan Claude presented (read from `~/.claude/plans/*.md` in the `ExitPlanMode` hook, before the person decides); `origin: 'selection'` is a text the person picked in an editor.
- `requests/<sessionId>.json`: written by the panel, polled by the plugin worker: `{ requests: [{ ref, ts }], texts: [{ id, text, ts }] }`, Translate taps and picked texts (the plugin records a picked text under its `id` and translates it).
- Deletion is the panel's job (24 h retention, Clear, own heartbeat): the plugin's `$.fs` has no delete.

### Plugin (`plugin/hooks/`)

- `register.ts` holds every engine call. The engine follows `$` statically and refuses a module that passes `$` into a function imported from another file, so other files stay pure helpers.
- Hooks: `session.start` (registers `/tutor`, starts a `$.clock.every` worker), `command.run` for `/tutor`, two `session.append` hooks (doors `prompt` and `response`) that call `next(e)` and return the stored row unchanged, then copy text to the session file, and three `tool.call` hooks: `Write`/`Edit` only remember a path under `~/.claude/plans/`, `ExitPlanMode` reads that file and records it before `next(e)` (falls back to the result's `plan` after `next` when no path was seen).
- Tutor work runs on the worker, not inside hooks: `$.model.complete` with Haiku or Sonnet (`tutorModel`). Replies, plans and picked texts are translated in batches of ~5000 characters (`batches` in `sentences.ts`), up to 40 000; a person's own messages go ahead in the queue.
- Direction is decided by script, not by the model (`script.ts`): text in the native script → translate into English (`TO_TARGET_SYSTEM`); English → into the native language (`TO_NATIVE_SYSTEM`); same-script pairs fall back to prompts that name the language themselves. A reply in a third language (`isThirdLanguage`: a third script, or English by `looksEnglish` when neither side is English) gets both sides from one call (`BOTH_SYSTEM`, `assembleBoth`; owner, 2026-10-12). Answers in the wrong script or copying the source get one retry, then a `failed` status.
- User prompts: only human-typed ones (`isHumanPrompt` filters task notifications, scheduled runs, other sessions), and IDE/engine blocks such as `<ide_opened_file>…</ide_opened_file>` are stripped first (`stripMachineBlocks`); the VS Code extension prepends those to every prompt.

### Line format shared by both packages

A translated message is stored line by line as `English sentence ||| translation`; the left side is always the learned language. `plugin/hooks/sentences.ts` splits replies into units (sentences of paragraphs, whole list items/headings, code fences passed through) and assembles pairs (`flip` when the reply was in the native language). `panel/src/parse.ts` reads the same format; keep them in sync.

### Panel (`panel/src/`)

- Host (`extension.ts`): picks the newest session file whose cwd is in the workspace, groups it into exchanges (`session.ts`; a plan or a picked text is an exchange of its own with `kind`, and the replies after it still belong to the prompt), renders markdown to HTML (`render.ts`, `marked`, prose HTML-escaped first), and posts `{ type: 'session', exchanges, ... }` to the side panel and `{ type: 'document', exchange }` to each document tab. Document tabs are `WebviewPanel`s (`languageTutor.document`, opened beside the chat) that load the same `media/panel.js` with `<body data-mode="document">`; a plan opens its tab by itself when it arrives (`languageTutor.openPlan`), a picked text through `languageTutor.translateSelection`. Message types are in `protocol.ts`. Also: heartbeat, Translate requests, Clear, word lookup in the offline dictionary (`lemma.ts` base forms; `dictstore.ts`: `en-ru` ships in `media/dict/`, other natives download once from the GitHub release `dict-1` into `globalStorage`, `languageTutor.downloadDictionaries`), first-run settings with the native language from VS Code's display language (`defaultNative`), system speech fallback (`speech.ts`: PowerShell System.Speech, streams word positions; progress goes back to the webview that asked).
- Webview (`webview/`): no markdown parsing; keyed re-render of the shown exchange only (`main.ts`; in document mode one exchange, no sheets, no auto-scroll), settings and history sheet (`sheet.ts`; a plan row opens its tab), player with sentence/word highlighting via the CSS Custom Highlight API (`player.ts`, offsets mapped by `textmap.ts`), word tooltip from the caret position under the pointer (`hover.ts`, pointer-transparent on purpose; shown only while Shift is held unless `languageTutor.wordHint` says `hover`).
- Styling uses only VS Code theme tokens (`--vscode-*`) in `media/panel.css`; icons are codicons. CSP: nonce script, no remote loads.
- Dictionaries are built by `scripts/build-dict.mjs` from WikDict SQLite (Node's built-in `node:sqlite`), ranking translations by back-translation through the reverse dictionary (exact spelling first) and by how many senses use them. `--release` writes `.cache/release/en-<code>.json.gz` for the `dict-1` release; the codes must match `DOWNLOADABLE` in `dictstore.ts`. Data is CC BY-SA (`panel/NOTICE`); code is MIT.
- Labels name the learned language from settings (never a hard-coded "English"); steps to add a system voice per OS are in `webview/voices.ts`.

### Preview harness

`design-lab/2026-10-08-tutor-panel/harness.html` loads the built `media/panel.js` with VS Code theme variables and a stub host. `node make-fixture.mjs` regenerates `fixture.js` with the real renderer; `node make-readme-fixture.mjs` writes `fixture-readme.js`, the session in the README screenshots (`docs/images/`; open `?fixture=readme`, add `&mode=document` for the plan tab, `&learning=elsewhere` for a window that does not learn); bundle `src/lemma.ts` to `lemma.js` (esbuild, `--format=iife --global-name=Lemma`) for hover lookups. Serve the repo over http (Playwright MCP blocks `file://`) and open `#light` for the light theme.

## Product rules (owner decisions)

- The plugin never steers the main model: no `prompt.compose` section, no rewriting of stored rows. Claude answers per its own settings (often Russian); all English comes from the tutor model in the panel.
- Russian (or any non-English) prompt → English version first, original on tap; English prompt → correction (`~~wrong~~ **right**` + one line why, or ✓).
- Messages are recorded whenever the tutor is on (owner, 2026-10-09); translation runs only while a Tutor view (panel or tab) is visible for that project; messages that arrived otherwise get a Translate button.
- Only one window learns at a time: switching on in a window moves learning there, other windows show "Learning is on in … · Learn here" and translate on a tap only (owner, 2026-10-12). Token totals: today / 7 / 30 days and per project (owner, 2026-10-12).
- A plan from plan mode and a text picked in an editor open in an editor tab beside the chat, not in the side panel (owner, 2026-10-09); the English side with translations on tap, as everywhere else.
- Interaction is pen-friendly: tap a sentence for its translation (no hover reveal for sentences), Shift + hover a word for the dictionary tooltip (owner, 2026-10-09: plain hover flickered), ▶/Listen turns into Stop while reading, settings and history open as a sheet over the list.
- Word dictionaries: English and Russian ship inside the extension, other languages download on demand (owner, 2026-10-12). The native language on first start follows VS Code's display language (owner, 2026-10-12).
- Published as: GitHub `ikstro/cc-translator` (plugin marketplace + releases), the panel on VS Code Marketplace and Open VSX (owner, 2026-10-12).
- The VS Code chat panel cannot render mod UI (`ui.render` never fires there) and escapes HTML, so all learning UI lives in the panel extension.
