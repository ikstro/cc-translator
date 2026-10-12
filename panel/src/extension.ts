import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'

import { DictionaryStore } from './dictstore'
import { defaultNative, langCode, scriptFor, scriptOf } from './languages'
import { learnsHere, learningState, parseLearner, type Learner, type LearningState } from './learner'
import { lookup } from './lemma'
import type { EmptyReason, ExchangeKind, GlossMissing, HostVoice, ToHost, ToView, ViewBlock, ViewConfig, ViewExchange } from './protocol'
import {
  messageHtml,
  normalizeSettings,
  parseFeed,
  stripMachineBlocks,
  tutorHtml,
  userHtml,
  type FeedEntry,
  type Orientation,
  type TutorSettings,
} from './render'
import { groupExchanges, indexResults, kindLabel, stateOf, titleOf, type Results } from './session'
import { Speaker, listHostVoices } from './speech'
import { EMPTY_SUMMARY, parseLedger, summarize, type Ledger, type UsageSummary } from './usage'

// ~/.claude/language-tutor/
//   settings.json               shared with the Claude Code plugin
//   sessions/<session>.jsonl    written by the plugin while the tutor is on
//   requests/<session>.json     Translate taps, written here
//   panels/<window>.json        this window's heartbeat: the plugin translates only while a
//                               Tutor view (the panel or a document tab) is on screen for the project
// Deleting is done here: old sessions after a day, Clear, and this window's heartbeat.
//
// Two kinds of webview share one script (media/panel.js): the side panel, and
// a document tab that shows one plan or one picked text on its own.

const VIEW_ID = 'languageTutor.panel'
const DOCUMENT_VIEW = 'languageTutor.document'
const SETTINGS_NAME = 'settings.json'
const LEARNER_NAME = 'learner.json'
const MAX_EXCHANGES = 100
const BEAT_MS = 30_000
const RETENTION_MS = 24 * 60 * 60 * 1000
/** A picked text longer than this is cut; the plugin cuts at the same length. */
const MAX_TEXT_CHARS = 40_000
/** How long a document tab waits for the plugin to pick up a picked text. */
const PENDING_MS = 30_000

/** What the plugin reads for a session: Translate taps (`requests`) and texts picked in an editor (`texts`). */
type RequestFile = { requests: { ref: string; ts: number }[]; texts: { id: string; text: string; ts: number }[] }

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

const baseDir = () => path.join(os.homedir(), '.claude', 'language-tutor')
const sessionsDir = () => path.join(baseDir(), 'sessions')
const requestsDir = () => path.join(baseDir(), 'requests')
const panelsDir = () => path.join(baseDir(), 'panels')
const usageDir = () => path.join(baseDir(), 'usage')
/** Token ledgers are kept for the 30-day total. */
const USAGE_RETENTION_MS = 31 * 24 * 60 * 60 * 1000

export function activate(context: vscode.ExtensionContext): void {
  const provider = new TutorViewProvider(context)
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('languageTutor.clear', () => provider.confirmClear()),
    vscode.commands.registerCommand('languageTutor.stopSpeaking', () => provider.stopSpeaking()),
    vscode.commands.registerCommand('languageTutor.openPlan', () => provider.openLatestPlan()),
    vscode.commands.registerCommand('languageTutor.translateSelection', () => provider.translateSelection()),
  )
}

export function deactivate(): void {}

type SessionFile = { id: string; file: string; mtimeMs: number; entries: FeedEntry[] }

class TutorViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined
  /** Document tabs by the id of the exchange each shows. */
  private readonly documents = new Map<string, vscode.WebviewPanel>()
  private watchers: fs.FSWatcher[] = []
  private timer: NodeJS.Timeout | undefined
  private beatTimer: NodeJS.Timeout | undefined
  private cleanupTimer: NodeJS.Timeout | undefined
  private hostVoices: HostVoice[] | undefined
  private readonly windowId = randomUUID()
  private readonly cache = new Map<string, { mtimeMs: number; entries: FeedEntry[] }>()
  private currentSessionId: string | undefined
  private exchanges: ViewExchange[] = []
  /** Document tabs opened for a picked text the plugin has not recorded yet, with when they were asked. */
  private readonly pendingDocuments = new Map<string, number>()
  private readonly autoOpened = new Set<string>()
  private readonly startedAt = Date.now()
  private readonly dictionaries: DictionaryStore
  /** Token ledgers read so far, by file, with the time they were written. */
  private readonly ledgers = new Map<string, { mtimeMs: number; ledger: Ledger | undefined }>()
  /** The webview that asked to speak: word positions go back to it. */
  private speakingTo: vscode.Webview | undefined
  private readonly speaker = new Speaker({
    progress: (id, pos, len) => this.post(this.speakingTo, { type: 'progress', id, pos, len }),
    done: id => this.post(this.speakingTo, { type: 'speakDone', id }),
  })
  private readonly disposables: vscode.Disposable[] = []

  constructor(private readonly context: vscode.ExtensionContext) {
    this.dictionaries = new DictionaryStore({
      bundledDir: vscode.Uri.joinPath(context.extensionUri, 'media', 'dict').fsPath,
      cacheDir: vscode.Uri.joinPath(context.globalStorageUri, 'dict').fsPath,
      fetchGz: async url => {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return new Uint8Array(await res.arrayBuffer())
      },
      onReady: () => {
        this.post(this.view?.webview, { type: 'dictReady' })
        for (const panel of this.documents.values()) this.post(panel.webview, { type: 'dictReady' })
      },
    })
    this.ensureSettings()
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('languageTutor')) this.push()
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.writeBeat()
        this.push()
      }),
    )
    this.cleanup()
    this.cleanupTimer = setInterval(() => this.cleanup(), 60 * 60 * 1000)
    this.beatTimer = setInterval(() => this.writeBeat(), BEAT_MS)
    this.watch()
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    }
    view.webview.html = this.html(view.webview, 'panel')
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: ToHost) => this.onMessage(message, view.webview)),
      view.onDidChangeVisibility(() => {
        this.writeBeat()
        if (view.visible) this.push()
      }),
      view.onDidDispose(() => {
        this.view = undefined
        if (this.speakingTo === view.webview) this.speaker.stop()
        this.writeBeat()
      }),
    )
    this.writeBeat()
    this.push()
  }

  dispose(): void {
    this.speaker.stop()
    for (const panel of this.documents.values()) panel.dispose()
    this.removeBeat()
    for (const w of this.watchers) w.close()
    for (const t of [this.timer, this.beatTimer, this.cleanupTimer]) if (t) clearTimeout(t)
    for (const d of this.disposables) d.dispose()
  }

  stopSpeaking(): void {
    this.speaker.stop()
  }

  async confirmClear(): Promise<void> {
    const answer = await vscode.window.showWarningMessage(
      "Clear this session's history in the Tutor panel?",
      { modal: true, detail: 'The conversation in Claude Code stays as it is.' },
      'Clear',
    )
    if (answer === 'Clear') this.clear()
  }

  /** Opens the newest plan of this session in its tab. */
  openLatestPlan(): void {
    const plan = [...this.exchanges].reverse().find(x => x.kind === 'plan')
    if (plan) this.openDocument(plan.id, { focus: true })
    else void vscode.window.showInformationMessage('Tutor: no plan in this session yet. Ask Claude for a plan and it shows up here.')
  }

  // ------------------------------------------------------------ files

  private beatPath(): string {
    return path.join(panelsDir(), `${this.windowId}.json`)
  }

  /** Tells the plugin this window has a Tutor view for these folders, and whether one is on screen. */
  private writeBeat(): void {
    if (!this.view && this.documents.size === 0) {
      this.removeBeat()
      return
    }
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
    const visible = this.view?.visible === true || [...this.documents.values()].some(p => p.visible)
    try {
      fs.mkdirSync(panelsDir(), { recursive: true })
      // `learning`: only the window of the learning project has the tutor translate.
      const learning = learnsHere(this.readLearner(), folders)
      fs.writeFileSync(this.beatPath(), JSON.stringify({ folders, visible, learning, ts: Date.now() }))
    } catch {
      // the plugin then treats the panel as closed
    }
  }

  private removeBeat(): void {
    try {
      fs.unlinkSync(this.beatPath())
    } catch {
      // already gone
    }
  }

  /** Deletes sessions untouched for a day, their requests, stale heartbeats and the v0.3 single feed. */
  private cleanup(): void {
    const now = Date.now()
    const sweep = (dir: string, maxAge: number) => {
      try {
        for (const name of fs.readdirSync(dir)) {
          const file = path.join(dir, name)
          try {
            if (now - fs.statSync(file).mtimeMs > maxAge) fs.unlinkSync(file)
          } catch {
            // in use or gone
          }
        }
      } catch {
        // no such folder yet
      }
    }
    sweep(sessionsDir(), RETENTION_MS)
    sweep(requestsDir(), RETENTION_MS)
    sweep(panelsDir(), 10 * 60 * 1000)
    sweep(usageDir(), USAGE_RETENTION_MS)
    try {
      fs.unlinkSync(path.join(baseDir(), 'feed.jsonl'))
    } catch {
      // already gone
    }
  }

  private watch(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
    // usage/ holds `<session>.json` ledgers: a new one updates the token totals.
    for (const dir of [baseDir(), sessionsDir(), usageDir()]) {
      try {
        fs.mkdirSync(dir, { recursive: true })
        const w = fs.watch(dir, { persistent: false }, (_event, name) => {
          if (name === LEARNER_NAME) {
            // Learning moved to or from this window: tell the plugin at once, not at the next beat.
            this.writeBeat()
            this.schedule()
          } else if (!name || name.endsWith('.json') || name.endsWith('.jsonl')) this.schedule()
        })
        w.on('error', () => undefined)
        this.watchers.push(w)
      } catch {
        // no watcher: the views still show what they read on open
      }
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.push(), 120)
  }

  private readLearner(): Learner | undefined {
    try {
      return parseLearner(fs.readFileSync(path.join(baseDir(), LEARNER_NAME), 'utf8'))
    } catch {
      return undefined
    }
  }

  private windowFolders(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)
  }

  /**
   * Turns learning on in this window (and so off in any other) or off
   * everywhere. On a tutor switched on before learning windows existed, the
   * first window to show its panel takes it.
   */
  private setLearning(on: boolean): void {
    if (on && !this.claimLearning()) return
    this.writeSettings({ enabled: on })
  }

  /** Makes this window's project the one that learns. */
  private claimLearning(): boolean {
    const folders = this.windowFolders()
    if (folders.length === 0) {
      void vscode.window.showInformationMessage('Tutor: open a folder first; learning follows the project.')
      return false
    }
    try {
      fs.mkdirSync(baseDir(), { recursive: true })
      fs.writeFileSync(path.join(baseDir(), LEARNER_NAME), JSON.stringify({ folders, ts: Date.now() }) + '\n', 'utf8')
    } catch (error) {
      void vscode.window.showErrorMessage(`Tutor: could not save where learning is. ${String(error)}`)
      return false
    }
    this.writeBeat()
    return true
  }

  private learning(settings: TutorSettings): LearningState {
    const learner = this.readLearner()
    if (settings.enabled && !learner && this.windowFolders().length > 0 && this.claimLearning()) return { where: 'here' }
    return learningState(settings.enabled, learner, this.windowFolders())
  }

  /** Tokens the tutor used, from the plugin's ledgers in usage/. */
  private usageSummary(): UsageSummary {
    const ledgers: Ledger[] = []
    try {
      for (const name of fs.readdirSync(usageDir())) {
        if (!name.endsWith('.json')) continue
        const file = path.join(usageDir(), name)
        try {
          const mtimeMs = fs.statSync(file).mtimeMs
          const cached = this.ledgers.get(file)
          if (cached && cached.mtimeMs === mtimeMs) {
            if (cached.ledger) ledgers.push(cached.ledger)
            continue
          }
          const ledger = parseLedger(fs.readFileSync(file, 'utf8'))
          this.ledgers.set(file, { mtimeMs, ledger })
          if (ledger) ledgers.push(ledger)
        } catch {
          // being written: the next push reads it
        }
      }
    } catch {
      return EMPTY_SUMMARY
    }
    return summarize(ledgers, Date.now())
  }

  private readSettings(): TutorSettings {
    try {
      return normalizeSettings(JSON.parse(fs.readFileSync(path.join(baseDir(), SETTINGS_NAME), 'utf8')))
    } catch {
      return this.firstSettings()
    }
  }

  /** Before anything is saved: the person's language is the one VS Code speaks (or the system's), Russian otherwise. */
  private firstSettings(): TutorSettings {
    const base = normalizeSettings(undefined)
    return { ...base, native: defaultNative([vscode.env.language, Intl.DateTimeFormat().resolvedOptions().locale], base.target) }
  }

  /** Writes the first settings on the first start, so `/tutor` in Claude Code starts from the same language pair. */
  private ensureSettings(): void {
    const file = path.join(baseDir(), SETTINGS_NAME)
    if (fs.existsSync(file)) return
    try {
      fs.mkdirSync(baseDir(), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(this.firstSettings(), null, 2) + '\n', { encoding: 'utf8', flag: 'wx' })
    } catch {
      // Another window wrote it first, or the folder is read-only: the defaults still apply.
    }
  }

  private writeSettings(patch: Partial<TutorSettings>): void {
    const next = normalizeSettings({ ...this.readSettings(), ...patch })
    try {
      fs.mkdirSync(baseDir(), { recursive: true })
      fs.writeFileSync(path.join(baseDir(), SETTINGS_NAME), JSON.stringify(next, null, 2) + '\n', 'utf8')
    } catch (error) {
      void vscode.window.showErrorMessage(`Tutor: could not save the settings. ${String(error)}`)
    }
    this.push()
  }

  /** The session this window shows: the most recently written one started in one of its folders. */
  private currentSession(): SessionFile | undefined {
    const allSessions = vscode.workspace.getConfiguration('languageTutor').get<boolean>('allSessions', false)
    const folders = (vscode.workspace.workspaceFolders ?? []).map(f => normalizePath(f.uri.fsPath))
    const covers = (cwd: string) => {
      if (allSessions || folders.length === 0) return true
      const c = normalizePath(cwd)
      return folders.some(f => c === f || c.startsWith(f + '/'))
    }
    let names: string[] = []
    try {
      names = fs.readdirSync(sessionsDir()).filter(n => n.endsWith('.jsonl'))
    } catch {
      return undefined
    }
    let best: SessionFile | undefined
    for (const name of names) {
      const file = path.join(sessionsDir(), name)
      let mtimeMs = 0
      try {
        mtimeMs = fs.statSync(file).mtimeMs
      } catch {
        continue
      }
      let cached = this.cache.get(file)
      if (!cached || cached.mtimeMs !== mtimeMs) {
        try {
          cached = { mtimeMs, entries: parseFeed(fs.readFileSync(file, 'utf8')) }
          this.cache.set(file, cached)
        } catch {
          continue
        }
      }
      const first = cached.entries.find(e => e.role === 'user' || e.role === 'assistant')
      if (!first || !covers(first.cwd ?? '')) continue
      if (!best || mtimeMs > best.mtimeMs) best = { id: name.replace(/\.jsonl$/, ''), file, mtimeMs, entries: cached.entries }
    }
    return best
  }

  private readRequests(file: string): RequestFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RequestFile>
      return { requests: Array.isArray(parsed.requests) ? parsed.requests : [], texts: Array.isArray(parsed.texts) ? parsed.texts : [] }
    } catch {
      return { requests: [], texts: [] }
    }
  }

  /** Rewrites this session's request file through `change`; false when there is no session or the write failed. */
  private updateRequests(change: (data: RequestFile) => RequestFile): boolean {
    if (!this.currentSessionId) return false
    const file = path.join(requestsDir(), `${this.currentSessionId}.json`)
    try {
      fs.mkdirSync(requestsDir(), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(change(this.readRequests(file))))
      return true
    } catch (error) {
      void vscode.window.showErrorMessage(`Tutor: could not ask for a translation. ${String(error)}`)
      return false
    }
  }

  private writeRequest(ref: string): void {
    this.updateRequests(data => ({ ...data, requests: [...data.requests.filter(r => r.ref !== ref), { ref, ts: Date.now() }].slice(-50) }))
  }

  /** Sends the editor's selection (or its whole file) to the plugin, which records and translates it; its tab opens at once. */
  translateSelection(): void {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      void vscode.window.showInformationMessage('Tutor: open a file and select the text to read.')
      return
    }
    const selected = editor.selections.map(s => editor.document.getText(s)).join('\n\n').trim()
    const text = (selected || editor.document.getText()).trim()
    if (!text) return
    if (!this.currentSessionId) {
      void vscode.window.showInformationMessage('Tutor: open Claude Code in this folder and send one message first; its plugin does the translating.')
      return
    }
    const id = `t-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const written = this.updateRequests(data => ({ ...data, texts: [...data.texts, { id, text: text.slice(0, MAX_TEXT_CHARS), ts: Date.now() }].slice(-5) }))
    if (!written) return
    this.pendingDocuments.set(id, Date.now())
    this.openDocument(id, { focus: true, kind: 'selection' })
    setTimeout(() => this.push(), PENDING_MS + 500)
  }

  private clear(): void {
    const id = this.currentSessionId
    if (id) {
      for (const file of [path.join(sessionsDir(), `${id}.jsonl`), path.join(requestsDir(), `${id}.json`)]) {
        try {
          fs.unlinkSync(file)
        } catch {
          // already gone
        }
        this.cache.delete(file)
      }
    }
    this.push()
  }

  // ------------------------------------------------------------ document tabs

  /** Shows an aside (a plan, a picked text) in an editor tab beside the chat, one tab per aside; `kind` opens one still being asked for. */
  private openDocument(id: string, options: { focus?: boolean; kind?: ExchangeKind } = {}): void {
    const existing = this.documents.get(id)
    if (existing) {
      existing.reveal(undefined, !options.focus)
      return
    }
    const exchange = this.exchanges.find(x => x.id === id)
    const kind = exchange?.kind ?? options.kind
    if (!exchange && !kind) return
    const panel = vscode.window.createWebviewPanel(
      DOCUMENT_VIEW,
      `Tutor · ${kindLabel(kind ?? 'selection')}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: !options.focus },
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        retainContextWhenHidden: true,
      },
    )
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.svg')
    panel.webview.html = this.html(panel.webview, 'document')
    panel.webview.onDidReceiveMessage((message: ToHost) => this.onMessage(message, panel.webview))
    panel.onDidChangeViewState(() => this.writeBeat())
    panel.onDidDispose(() => {
      if (this.documents.get(id) === panel) this.documents.delete(id)
      this.pendingDocuments.delete(id)
      if (this.speakingTo === panel.webview) this.speaker.stop()
      this.writeBeat()
    })
    this.documents.set(id, panel)
    this.writeBeat()
  }

  /** A plan that arrived while this window runs opens its tab by itself, once. */
  private autoOpen(exchanges: readonly ViewExchange[]): void {
    if (vscode.workspace.getConfiguration('languageTutor').get<string>('openPlan', 'auto') !== 'auto') return
    const plan = [...exchanges].reverse().find(x => x.kind === 'plan')
    if (!plan || this.autoOpened.has(plan.id) || Date.parse(plan.ts) < this.startedAt) return
    this.autoOpened.add(plan.id)
    this.openDocument(plan.id)
  }

  // ------------------------------------------------------------ messages

  private onMessage(message: ToHost, from: vscode.Webview): void {
    switch (message.type) {
      case 'ready':
        this.push()
        void this.sendHostVoices(from)
        return
      case 'speak': {
        const { voice, rate } = this.config()
        this.speakingTo = from
        this.speaker.speak(message.id, message.items.join(message.separator), message.lang, voice, rate)
        return
      }
      case 'stop':
        this.speaker.stop()
        return
      case 'setSettings':
        this.writeSettings(message.patch)
        return
      case 'setLearning':
        this.setLearning(message.on)
        return
      case 'setVoiceConfig': {
        const c = vscode.workspace.getConfiguration('languageTutor')
        if (message.voice !== undefined) void c.update('voice', message.voice, vscode.ConfigurationTarget.Global)
        if (message.rate !== undefined) void c.update('rate', message.rate, vscode.ConfigurationTarget.Global)
        return
      }
      case 'openSpeechSettings':
        if (process.platform === 'win32') void vscode.env.openExternal(vscode.Uri.parse('ms-settings:speech'))
        else if (process.platform === 'darwin')
          void vscode.env.openExternal(vscode.Uri.parse('x-apple.systempreferences:com.apple.preference.universalaccess?SpeakableItems'))
        return
      case 'translate':
        this.writeRequest(message.ref)
        return
      case 'clear':
        this.clear()
        return
      case 'lookup':
        this.lookupWord(message.word, from)
        return
      case 'openDocument':
        this.openDocument(message.id, { focus: true })
        return
    }
  }

  /** Looks a word up in the English → native dictionary; the first word of a language not on this computer starts its download. */
  private lookupWord(word: string, to: vscode.Webview): void {
    const s = this.readSettings()
    const miss = (missing: GlossMissing) => this.post(to, { type: 'gloss', word, missing })
    if (langCode(s.target) !== 'en') return miss('not-english')
    const allow = vscode.workspace.getConfiguration('languageTutor').get<boolean>('downloadDictionaries', true)
    const state = this.dictionaries.get(langCode(s.native), allow)
    if (state.status === 'none') return miss('no-dictionary')
    if (state.status === 'downloading') return miss('downloading')
    if (state.status === 'failed') return miss('download-failed')
    if (state.status === 'off') return miss('download-off')
    const gloss = lookup(state.dict, word)
    this.post(to, gloss ? { type: 'gloss', word, gloss } : { type: 'gloss', word, missing: 'not-found' })
  }

  private post(to: vscode.Webview | undefined, message: ToView): void {
    void to?.postMessage(message)
  }

  private config(): ViewConfig {
    const c = vscode.workspace.getConfiguration('languageTutor')
    const hint = c.get<string>('wordHint', 'shift')
    return { voice: c.get<string>('voice', ''), rate: c.get<number>('rate', 1), wordHint: hint === 'hover' || hint === 'off' ? hint : 'shift' }
  }

  private async sendHostVoices(to: vscode.Webview): Promise<void> {
    if (!this.hostVoices) this.hostVoices = await listHostVoices()
    this.post(to, { type: 'hostVoices', voices: this.hostVoices, canSpeak: Speaker.canSpeak(), platform: process.platform })
  }

  /** Reads this window's session and sends it: the exchanges to the panel, its own exchange to each document tab. */
  private push(): void {
    const settings = this.readSettings()
    const session = this.currentSession()
    this.currentSessionId = session?.id
    const entries = session?.entries ?? []
    const results = indexResults(entries)
    const targetScript = scriptFor(settings.target)
    const nativeScript = scriptFor(settings.native)
    const orientation: Orientation | undefined =
      targetScript && nativeScript && targetScript !== nativeScript ? { target: targetScript, native: nativeScript } : undefined
    const now = Date.now()

    const all: ViewExchange[] = groupExchanges(entries).map(x => {
      const blocks: ViewBlock[] = []
      let title = ''
      if (x.user) {
        const block = userBlock(x.user, results, orientation, now)
        blocks.push(block)
        const tutor = results.tutor.get(x.user.id ?? '')
        title = titleOf(tutor && tutor.kind !== 'correction' && tutor.text ? tutor.text : stripMachineBlocks(x.user.text ?? ''))
      }
      for (const reply of x.replies) {
        const id = reply.id ?? reply.ts
        const paired = results.paired.get(id)
        const { state, note } = stateOf(id, results, now)
        blocks.push({
          id,
          role: 'assistant',
          html: messageHtml(paired?.text ?? reply.text ?? '', orientation),
          state,
          ...(paired?.note ? { note: paired.note } : note ? { note } : {}),
        })
      }
      if (!title) {
        const first = x.replies[0]
        const paired = first ? results.paired.get(first.id ?? first.ts) : undefined
        title = titleOf(paired?.text ?? first?.text ?? '')
      }
      if (x.kind) title = `${kindLabel(x.kind)} · ${title}`
      return { id: x.id, ts: x.ts, title, blocks, ...(x.kind ? { kind: x.kind } : {}) }
    })
    this.exchanges = all

    const config = this.config()
    if (this.view) {
      const exchanges = all.slice(-MAX_EXCHANGES)
      const empty: EmptyReason = exchanges.length === 0 ? 'no-session' : undefined
      this.post(this.view.webview, {
        type: 'session',
        exchanges,
        settings,
        usage: results.usage,
        totals: this.usageSummary(),
        learning: this.learning(settings),
        project: this.windowFolders()[0] ?? '',
        empty,
        config,
      })
    }
    for (const [id, panel] of this.documents) {
      const exchange = all.find(x => x.id === id)
      if (exchange) this.pendingDocuments.delete(id)
      const pending = !exchange && Date.now() - (this.pendingDocuments.get(id) ?? 0) < PENDING_MS
      this.post(panel.webview, { type: 'document', exchange, ...(pending ? { pending: true } : {}), settings, config })
    }
    this.autoOpen(all)
  }

  private html(webview: vscode.Webview, mode: 'panel' | 'document'): string {
    const nonce = [...Array(24)].map(() => Math.floor(Math.random() * 36).toString(36)).join('')
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', file))
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource};">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('codicon.css')}">
<link rel="stylesheet" href="${media('panel.css')}">
<title>Tutor</title>
</head>
<body data-mode="${mode}">
<div id="root"></div>
<script nonce="${nonce}" src="${media('panel.js')}"></script>
</body>
</html>`
  }
}

/** The person's message: English first when the tutor translated it, the correction when they wrote English. */
function userBlock(user: FeedEntry, results: Results, orientation: Orientation | undefined, now: number): ViewBlock {
  const id = user.id ?? user.ts
  const found = results.tutor.get(id)
  // A correction attached to a message in the person's own script was a misjudgement
  // (plugin < 0.4.2 counted the IDE's note as their words): offer Translate instead.
  const misjudged = found?.kind === 'correction' && !!orientation && scriptOf(stripMachineBlocks(user.text ?? '')) === orientation.native
  const tutor = misjudged ? undefined : found
  const stated = stateOf(id, results, now)
  const { state, note } = misjudged ? { state: 'untranslated' as const, note: undefined } : stated
  const base = { id, role: 'user' as const, state, ...(tutor?.note ? { note: tutor.note } : note ? { note } : {}) }
  if (tutor?.text && tutor.kind === 'correction') {
    if (tutor.text.trim() === '✓') return { ...base, html: userHtml(user.text ?? ''), tutor: 'correct' }
    return { ...base, html: tutorHtml('correction', tutor.text), tutor: 'correction' }
  }
  if (tutor?.text) return { ...base, html: messageHtml(tutor.text, orientation), tutor: 'translation' }
  return { ...base, html: userHtml(user.text ?? '') }
}
