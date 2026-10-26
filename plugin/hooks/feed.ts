// Pure helpers for the files shared with the Tutor panel. The engine calls
// (`$.env`, `$.fs`) stay in register.ts, which the engine follows statically.
//
// ~/.claude/language-tutor/
//   settings.json               the tutor's settings (plugin and panel)
//   sessions/<session>.jsonl    one session's conversation and tutor results (plugin appends)
//   requests/<session>.json     refs the reader asked to translate, and texts picked in an editor (panel writes)
//   panels/<window>.json        heartbeat of each open Tutor panel (panel writes)
//   learner.json                the project that learns: only its window's panel has the tutor translate
//   usage/<session>.json        tokens the tutor used, per day, for the panel's totals (plugin writes)
// Deleting is the panel's job: the plugin's file access cannot remove files.

import type { Settings } from './settings'

export type Role = 'user' | 'assistant' | 'tutor' | 'paired' | 'status' | 'usage'

export type FeedEntry = {
  id: string
  ts: string
  sessionId: string
  cwd: string
  role: Role
  /** user/assistant: the message; tutor: correction or `English ||| original` lines; paired: `English ||| translation` lines. */
  text?: string
  /** tutor, paired, status, usage: the id of the user or assistant entry it belongs to. */
  ref?: string
  kind?: 'correction' | 'translation'
  state?: 'translating' | 'failed'
  note?: string
  /** user: how the prompt arrived (`composer`, `sdk`, …); assistant: `plan` for a plan Claude presented, `selection` for text the person picked to read. */
  origin?: string
  model?: string
  input?: number
  output?: number
  settings?: Settings
}

const MAX_BYTES = 512 * 1024
const KEEP_LINES = 400

export function tutorDir(home: string | undefined): string | undefined {
  if (!home) return undefined
  return `${home.replace(/\\/g, '/')}/.claude/language-tutor`
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '')
}

export function settingsPathFor(home: string | undefined): string | undefined {
  const dir = tutorDir(home)
  return dir ? `${dir}/settings.json` : undefined
}

export function sessionPathFor(home: string | undefined, sessionId: string): string | undefined {
  const dir = tutorDir(home)
  return dir && safeId(sessionId) ? `${dir}/sessions/${safeId(sessionId)}.jsonl` : undefined
}

export function requestsPathFor(home: string | undefined, sessionId: string): string | undefined {
  const dir = tutorDir(home)
  return dir && safeId(sessionId) ? `${dir}/requests/${safeId(sessionId)}.json` : undefined
}

export function learnerPathFor(home: string | undefined): string | undefined {
  const dir = tutorDir(home)
  return dir ? `${dir}/learner.json` : undefined
}

export function usagePathFor(home: string | undefined, sessionId: string): string | undefined {
  const dir = tutorDir(home)
  return dir && safeId(sessionId) ? `${dir}/usage/${safeId(sessionId)}.json` : undefined
}

export function panelsDirFor(home: string | undefined): string | undefined {
  const dir = tutorDir(home)
  return dir ? `${dir}/panels` : undefined
}

/** The file's new content: the old lines, trimmed when the file grew large, plus one JSON line. */
export function appendLine(existing: string, entry: FeedEntry): string {
  let kept = existing
  if (kept.length > MAX_BYTES) {
    kept = kept.split('\n').filter(Boolean).slice(-KEEP_LINES).join('\n') + '\n'
  }
  return kept + JSON.stringify(entry) + '\n'
}

export function parseEntries(content: string): FeedEntry[] {
  const out: FeedEntry[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as FeedEntry
      if (entry && typeof entry === 'object' && typeof entry.role === 'string') out.push(entry)
    } catch {
      // a half-written line: skipped
    }
  }
  return out
}

// ------------------------------------------------------------ panels

/** `learning: false` is a panel on screen in a window that is not the one learning. */
export type PanelBeat = { folders?: unknown; visible?: unknown; learning?: unknown; ts?: unknown }

const STALE_MS = 90_000

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// ------------------------------------------------------------ usage

export type DayUsage = { input: number; output: number; calls: number }
/** One session's tutor tokens by local day, and the project it ran in. */
export type Ledger = { project: string; days: Record<string, DayUsage> }

/** The local calendar day of a moment, YYYY-MM-DD: how the panel groups usage. */
export function dayOf(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A ledger read back from its file; anything malformed starts it afresh. */
export function parseLedger(text: string, project: string): Ledger {
  try {
    const raw = JSON.parse(text) as { project?: unknown; days?: unknown }
    const days: Record<string, DayUsage> = {}
    if (raw.days && typeof raw.days === 'object') {
      for (const [day, u] of Object.entries(raw.days as Record<string, Partial<DayUsage>>)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !u || typeof u !== 'object') continue
        days[day] = { input: Number(u.input) || 0, output: Number(u.output) || 0, calls: Number(u.calls) || 0 }
      }
    }
    return { project: typeof raw.project === 'string' ? raw.project : project, days }
  } catch {
    return { project, days: {} }
  }
}

export function addUsage(ledger: Ledger, day: string, input: number, output: number): Ledger {
  const was = ledger.days[day] ?? { input: 0, output: 0, calls: 0 }
  return { ...ledger, days: { ...ledger.days, [day]: { input: was.input + input, output: was.output + output, calls: was.calls + 1 } } }
}

// ------------------------------------------------------------ plans

/** Where Claude Code keeps the plans of plan mode. */
export function plansDirFor(home: string | undefined): string | undefined {
  if (!home) return undefined
  return `${home.replace(/\\/g, '/')}/.claude/plans`
}

/** Whether `path` is a plan file: a markdown file right under ~/.claude/plans. */
export function isPlanPath(path: unknown, home: string | undefined): boolean {
  const dir = plansDirFor(home)
  if (!dir || typeof path !== 'string') return false
  const p = normalizePath(path)
  const d = normalizePath(dir)
  return p.startsWith(d + '/') && p.endsWith('.md') && !p.slice(d.length + 1).includes('/')
}

/** The fresh beats of panels whose window has `cwd` among its folders. Beats older than 90 s are ignored. */
function coveringBeats(beats: readonly PanelBeat[], cwd: string, now: number): PanelBeat[] {
  const target = normalizePath(cwd)
  return beats.filter(beat => {
    if (typeof beat.ts !== 'number' || now - beat.ts > STALE_MS) return false
    const folders = Array.isArray(beat.folders) ? beat.folders.filter((f): f is string => typeof f === 'string') : []
    return folders.some(f => {
      const root = normalizePath(f)
      return target === root || target.startsWith(root + '/')
    })
  })
}

/** Whether an open Tutor panel covers `cwd`, and whether it is on screen. */
export function panelCoverage(beats: readonly PanelBeat[], cwd: string, now: number): { open: boolean; visible: boolean } {
  const covering = coveringBeats(beats, cwd, now)
  return { open: covering.length > 0, visible: covering.some(beat => beat.visible === true && beat.learning !== false) }
}

/** The folders `learner.json` names; empty when there is no file or it is malformed. */
export function parseLearnerFolders(text: string): string[] {
  try {
    const raw = JSON.parse(text) as { folders?: unknown }
    return Array.isArray(raw.folders) ? raw.folders.filter((f): f is string => typeof f === 'string' && f.length > 0) : []
  } catch {
    return []
  }
}

/**
 * Whether the session in `cwd` belongs to the window that learns, as its
 * panel's switch shows it. The panel's beat says so when one is open; with
 * none (closed, or Claude Code outside VS Code) `learner.json` decides, and
 * no learner at all means nothing has moved learning away.
 */
export function learnsAt(beats: readonly PanelBeat[], learnerFolders: readonly string[], cwd: string, now: number): boolean {
  const covering = coveringBeats(beats, cwd, now)
  if (covering.length > 0) return covering.some(beat => beat.learning !== false)
  if (learnerFolders.length === 0) return true
  const target = normalizePath(cwd)
  return learnerFolders.map(normalizePath).some(l => target === l || target.startsWith(l + '/') || l.startsWith(target + '/'))
}

// ------------------------------------------------------------ prompts

// Turns the engine starts on its own or that come from elsewhere: never "the user wrote".
const AUTOMATIC_ORIGINS = new Set([
  'task-notification',
  'scheduled-trigger',
  'peer',
  'peer-send-message',
  'projects-relay',
  'channel',
  'coordinator',
  'observer',
  'observer-activity',
  'auto-continuation',
  'plugin',
])

// Notes the IDE or the engine puts into a prompt's text: `<ide_opened_file>`,
// `<ide_selection>`, `<system-reminder>`, a slash command's record. They are
// not the person's words and must not decide which language the message is in.
const MACHINE_BLOCKS =
  /<(ide_[a-z_]+|system-reminder|local-command-[a-z-]+|command-[a-z-]+|task-notification|user-prompt-submit-hook)\b[^>]*>[\s\S]*?<\/\1>/g

/** What the person typed, without the notes the IDE and the engine add to a prompt. */
export function stripMachineBlocks(text: string): string {
  return text.replace(MACHINE_BLOCKS, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Whether a stored user row is something the person typed. */
export function isHumanPrompt(originKind: string | undefined, text: string): boolean {
  if (originKind && AUTOMATIC_ORIGINS.has(originKind)) return false
  const head = text.trimStart()
  return !/^<(task-notification|local-command|command-name|command-message|system-reminder)\b/.test(head)
}

// ------------------------------------------------------------ requests

/**
 * The Translate taps the panel wrote: `{ "requests": [{ "ref": "...", "ts": 1712... }] }`.
 * A ref is run again only when its tap is newer than the last attempt.
 */
export function parseRequests(content: string): { ref: string; ts: number }[] {
  try {
    const parsed = JSON.parse(content) as { requests?: unknown }
    if (!Array.isArray(parsed.requests)) return []
    return parsed.requests.filter(
      (r): r is { ref: string; ts: number } =>
        !!r && typeof r === 'object' && typeof (r as { ref?: unknown }).ref === 'string' && typeof (r as { ts?: unknown }).ts === 'number',
    )
  } catch {
    return []
  }
}

/** A text the person picked in an editor to read in the learned language: `{ "texts": [{ "id", "text", "ts" }] }` in the same file. */
export type TextRequest = { id: string; text: string; ts: number }

const MAX_REQUEST_TEXT = 40_000

export function parseTextRequests(content: string): TextRequest[] {
  try {
    const parsed = JSON.parse(content) as { texts?: unknown }
    if (!Array.isArray(parsed.texts)) return []
    const out: TextRequest[] = []
    for (const t of parsed.texts) {
      if (!t || typeof t !== 'object') continue
      const { id, text, ts } = t as { id?: unknown; text?: unknown; ts?: unknown }
      if (typeof id !== 'string' || typeof text !== 'string' || typeof ts !== 'number') continue
      const clean = safeId(id)
      if (!clean || !text.trim()) continue
      out.push({ id: clean, text: text.slice(0, MAX_REQUEST_TEXT), ts })
    }
    return out
  } catch {
    return []
  }
}

// ------------------------------------------------------------ tutor replies

/** Splits the tutor's reply to a user message into its kind and body. */
export function parseTutorReply(reply: string): { kind: 'correction' | 'translation'; body: string } {
  const lines = reply.trim().split('\n')
  const head = /^\s*KIND:\s*(correction|translation|howToSay)\s*$/i.exec(lines[0] ?? '')
  if (head) {
    const kind = head[1]?.toLowerCase() === 'correction' ? 'correction' : 'translation'
    return { kind, body: lines.slice(1).join('\n').trim() }
  }
  const body = reply.trim()
  return { kind: body.startsWith('✓') || body.includes('~~') ? 'correction' : 'translation', body }
}
