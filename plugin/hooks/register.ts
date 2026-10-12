import type { EngineInterface, Register } from 'claude-code'

import {
  addUsage,
  appendLine,
  dayOf,
  isHumanPrompt,
  isPlanPath,
  learnerPathFor,
  panelCoverage,
  panelsDirFor,
  parseEntries,
  parseLedger,
  parseRequests,
  parseTextRequests,
  parseTutorReply,
  requestsPathFor,
  sessionPathFor,
  settingsPathFor,
  stripMachineBlocks,
  usagePathFor,
  type FeedEntry,
  type Ledger,
  type PanelBeat,
} from './feed'
import { isThirdLanguage, mostlyCopies, mostlyInScript, scriptForLanguage, scriptOf, sideOf, userRoute } from './script'
import { assembleBoth, assemblePaired, batches, parseNumbered, parseTranslateReply, sentencesOf, sidesOf, splitUnits } from './sentences'
import { applyCommand, normalize, type Settings } from './settings'
import {
  BOTH_SYSTEM,
  RETRY_NOTE,
  TO_NATIVE_SYSTEM,
  TO_TARGET_SYSTEM,
  TRANSLATE_SYSTEM,
  USER_SYSTEM,
  numbered,
} from './tutor-prompt'

// Read-only by design: the plugin never instructs the main model and never
// rewrites a stored row. It reads the conversation in `session.append` and
// the plan the model presents in `tool.call`, returns every row and result
// exactly as given, and does its own work on the side. While the tutor is on
// every message is copied for the panel; the tutor model runs only for a
// project whose Tutor panel is on screen in VS Code.

const STORE_KEY = 'settings'
const MAX_TEXT_CHARS = 40_000
const BATCH_CHARS = 5_000
const MAX_USER_CHARS = 1500
const TICK_MS = 400
const REQUEST_SCAN_TICKS = 5

type Job = { kind: 'user' | 'assistant'; id: string; text: string; sessionId: string; cwd: string }

// Module state: lost on a hot reload, which only drops work still queued.
let writeQueue: Promise<void> = Promise.resolve()
const jobs: Job[] = []
const attempted = new Map<string, number>()
let working = false
let ticks = 0
let seq = 0
/** Each session's tutor tokens by day, kept here and written whole after every call. */
const ledgers = new Map<string, Ledger>()
/** The plan file the model last wrote in this process: read when it presents the plan. */
let lastPlanPath: string | undefined

function nextId(): string {
  seq += 1
  return `${Date.now().toString(36)}-${seq.toString(36)}`
}

async function homeOf($: Pick<EngineInterface, 'env'>): Promise<string | undefined> {
  return (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
}

async function readSettings($: EngineInterface): Promise<Settings> {
  const path = settingsPathFor(await homeOf($))
  if (path) {
    try {
      return normalize(JSON.parse((await $.fs.read(path)) as string))
    } catch {
      // no file yet: fall through to the store
    }
  }
  return normalize(await $.store.get(STORE_KEY))
}

async function writeSettings($: EngineInterface, s: Settings): Promise<void> {
  const path = settingsPathFor(await homeOf($))
  if (path) await $.fs.write(path, JSON.stringify(s, null, 2) + '\n')
  await $.store.set(STORE_KEY, s)
}

function statusText(s: Settings): string | undefined {
  return s.enabled ? `tutor: ${s.target}${s.level === 'off' ? '' : ' ' + s.level}` : undefined
}

function textOf(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/** Whether a Tutor panel is open for `cwd`, and whether it is on screen. */
async function panelState($: EngineInterface, cwd: string): Promise<{ open: boolean; visible: boolean }> {
  const dir = panelsDirFor(await homeOf($))
  if (!dir) return { open: false, visible: false }
  let names: string[] = []
  try {
    names = (await $.fs.list(dir)).filter(f => f.kind === 'file' && f.name.endsWith('.json')).map(f => f.name)
  } catch {
    return { open: false, visible: false }
  }
  const beats: PanelBeat[] = []
  for (const name of names) {
    try {
      beats.push(JSON.parse((await $.fs.read(`${dir}/${name}`)) as string) as PanelBeat)
    } catch {
      // a beat being rewritten: the next one counts
    }
  }
  return panelCoverage(beats, cwd, Date.now())
}

async function readSession($: EngineInterface, sessionId: string): Promise<FeedEntry[]> {
  const path = sessionPathFor(await homeOf($), sessionId)
  if (!path) return []
  try {
    return parseEntries((await $.fs.read(path)) as string)
  } catch {
    return []
  }
}

/** Appends one entry to its session's file; appends are serialized so two never race. */
async function record($: EngineInterface, entry: Omit<FeedEntry, 'ts'>): Promise<void> {
  const run = async () => {
    const path = sessionPathFor(await homeOf($), entry.sessionId)
    if (!path) return
    let existing = ''
    try {
      existing = (await $.fs.read(path)) as string
    } catch {
      existing = ''
    }
    await $.fs.write(path, appendLine(existing, { ts: new Date().toISOString(), ...entry }))
  }
  writeQueue = writeQueue.then(run, run)
  try {
    await writeQueue
  } catch (error) {
    $.ui.log(`language-tutor: write failed: ${String(error)}`, { to: 'debug' })
  }
}

/**
 * A prompt, a reply or a plan was stored: copy it for the panel, and queue
 * the tutor while the panel is on screen. A message that arrives while the
 * panel is hidden or closed waits for its Translate button.
 */
/**
 * The folder the session started in. `$.session.cwd()` follows every `cd`
 * Claude runs, which would move the session out of the project the panel
 * watches and leave its messages untranslated.
 */
const startCwd = new Map<string, string>()
async function sessionCwd($: EngineInterface, sessionId: string): Promise<string> {
  const known = startCwd.get(sessionId)
  if (known) return known
  const cwd = await $.session.cwd()
  startCwd.set(sessionId, cwd)
  return cwd
}

async function observe($: EngineInterface, role: 'user' | 'assistant', text: string, origin?: string): Promise<void> {
  const s = await readSettings($)
  if (!s.enabled) return
  const sessionId = await $.session.id()
  const cwd = await sessionCwd($, sessionId)
  const id = nextId()
  await record($, { id, sessionId, cwd, role, text, ...(origin ? { origin } : {}) })
  if ((await panelState($, cwd)).visible) enqueue({ kind: role, id, text, sessionId, cwd })
}

/** Queues a job; the person's own message is short and read first, so it goes ahead of the replies waiting. */
function enqueue(job: Job): void {
  attempted.set(job.id, Date.now())
  const at = job.kind === 'user' ? jobs.findIndex(j => j.kind !== 'user') : -1
  if (at < 0) jobs.push(job)
  else jobs.splice(at, 0, job)
}

async function tick($: EngineInterface): Promise<void> {
  ticks += 1
  if (ticks % REQUEST_SCAN_TICKS === 0) await scanRequests($)
  await drain($)
}

/** Picks up what the panel wrote for this session: Translate taps, and texts the person picked in an editor. */
async function scanRequests($: EngineInterface): Promise<void> {
  const sessionId = await $.session.id()
  const path = requestsPathFor(await homeOf($), sessionId)
  if (!path) return
  let content: string
  try {
    content = (await $.fs.read(path)) as string
  } catch {
    return
  }
  const taps = parseRequests(content).filter(r => r.ts > (attempted.get(r.ref) ?? 0))
  const texts = parseTextRequests(content).filter(t => t.ts > (attempted.get(t.id) ?? 0))
  if (taps.length === 0 && texts.length === 0) return
  const entries = await readSession($, sessionId)
  for (const request of taps) {
    attempted.set(request.ref, Date.now())
    const entry = entries.find(e => e.id === request.ref && (e.role === 'user' || e.role === 'assistant'))
    if (!entry?.text || (entry.role !== 'user' && entry.role !== 'assistant')) continue
    // Entries recorded before 0.4.2 may still hold the IDE's notes.
    const text = entry.role === 'user' ? stripMachineBlocks(entry.text) : entry.text
    if (text) jobs.push({ kind: entry.role, id: entry.id, text, sessionId, cwd: entry.cwd })
  }
  for (const request of texts) {
    attempted.set(request.id, Date.now())
    // Recorded before a reload of this module: its Translate tap, if any, is handled above.
    if (entries.some(e => e.id === request.id)) continue
    const cwd = await sessionCwd($, sessionId)
    await record($, { id: request.id, sessionId, cwd, role: 'assistant', origin: 'selection', text: request.text })
    jobs.push({ kind: 'assistant', id: request.id, text: request.text, sessionId, cwd })
  }
}

async function drain($: EngineInterface): Promise<void> {
  if (working) return
  const job = jobs.shift()
  if (!job) return
  working = true
  try {
    await runJob($, job)
  } catch (error) {
    $.ui.log(`language-tutor: ${job.kind} job failed: ${String(error)}`, { to: 'debug' })
  } finally {
    working = false
  }
}

/** One tutor call, with its token use written to the session file. */
async function complete($: EngineInterface, s: Settings, job: Job, system: string, prompt: string, maxTokens: number): Promise<string | undefined> {
  const r = await $.model.complete({ model: s.tutorModel, system, prompt, maxTokens, effort: 'low', timeoutMs: 90_000 })
  const u = r.usage
  await record($, {
    id: nextId(),
    sessionId: job.sessionId,
    cwd: job.cwd,
    role: 'usage',
    ref: job.id,
    model: s.tutorModel,
    input: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    output: u.output_tokens,
  })
  await countUsage($, job.sessionId, u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens, u.output_tokens)
  return r.isAnswered ? r.text : undefined
}

/**
 * Adds one call to the session's ledger in `usage/`, which outlives the
 * session file so the panel can show today, 7 and 30 days per project.
 */
async function countUsage($: EngineInterface, sessionId: string, input: number, output: number): Promise<void> {
  const path = usagePathFor(await homeOf($), sessionId)
  if (!path) return
  const run = async () => {
    let ledger = ledgers.get(sessionId)
    if (!ledger) {
      const project = await sessionCwd($, sessionId)
      let existing = ''
      try {
        existing = (await $.fs.read(path)) as string
      } catch {
        existing = ''
      }
      ledger = parseLedger(existing, project)
    }
    ledger = addUsage(ledger, dayOf(Date.now()), input, output)
    ledgers.set(sessionId, ledger)
    await $.fs.write(path, JSON.stringify(ledger) + '\n')
  }
  writeQueue = writeQueue.then(run, run)
  try {
    await writeQueue
  } catch (error) {
    $.ui.log(`language-tutor: usage write failed: ${String(error)}`, { to: 'debug' })
  }
}

type Lines = (string | undefined)[]

/**
 * Asks for numbered translations; a result in the wrong language or one that
 * copies its sources gets one retry. Undefined: no answer; 'wrong': still wrong.
 */
async function translateLines(
  $: EngineInterface,
  s: Settings,
  job: Job,
  system: string,
  into: string,
  sentences: readonly string[],
  isWrong: (lines: Lines) => boolean,
  /** Output tokens allowed per character of source: 2 for one translation, 4 when both sides are written. */
  perChar = 2,
): Promise<Lines | 'wrong' | undefined> {
  const maxTokens = Math.min(16_000, 500 + perChar * sentences.join(' ').length)
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await complete($, s, job, attempt === 0 ? system : system + RETRY_NOTE(into), numbered(sentences), maxTokens)
    if (reply === undefined) return undefined
    const lines = parseNumbered(reply, sentences.length)
    if (!isWrong(lines) && !mostlyCopies(lines, sentences)) return lines
  }
  return 'wrong'
}

async function runJob($: EngineInterface, job: Job): Promise<void> {
  const s = await readSettings($)
  if (!s.enabled) return
  const base = { sessionId: job.sessionId, cwd: job.cwd, ref: job.id }
  const fail = (note: string) => record($, { ...base, id: nextId(), role: 'status', state: 'failed', note })
  const done = (entry: Pick<FeedEntry, 'role' | 'kind' | 'text' | 'note'>) => record($, { ...base, id: nextId(), ...entry })
  const inScript = (lines: Lines, language: string) => {
    const script = scriptForLanguage(language)
    const other = scriptForLanguage(language === s.target ? s.native : s.target)
    return !!script && !!other && script !== other && mostlyInScript(lines, other)
  }
  await record($, { ...base, id: nextId(), role: 'status', state: 'translating' })
  $.ui.status('tutor: translating…')
  try {
    if (job.kind === 'user') {
      const long = job.text.length > MAX_USER_CHARS
      const text = job.text.slice(0, MAX_USER_CHARS)
      const units = splitUnits(text)
      const sentences = sentencesOf(units)
      if (sentences.length === 0) return
      const note = long ? 'long message: only the beginning is translated' : undefined
      const english = (lines: Lines) => ({ role: 'tutor' as const, kind: 'translation' as const, text: assemblePaired(units, lines, true), ...(note ? { note } : {}) })

      if (userRoute(text, s.target, s.native) === 'to-target') {
        // Written in the person's own script: show how it sounds in English.
        const lines = await translateLines($, s, job, TO_TARGET_SYSTEM(s), s.target, sentences, l => inScript(l, s.target))
        if (lines === undefined) return void (await fail('the tutor did not answer'))
        if (lines === 'wrong') return void (await fail(`the tutor did not answer in ${s.target}`))
        return void (await done(english(lines)))
      }

      // English, or another language in the same script: the tutor corrects English and translates the rest.
      const maxTokens = Math.min(8_000, 400 + 2 * text.length)
      for (let attempt = 0; attempt < 2; attempt++) {
        const system = attempt === 0 ? USER_SYSTEM(s) : USER_SYSTEM(s) + RETRY_NOTE(s.target)
        const reply = await complete($, s, job, system, numbered(sentences), maxTokens)
        if (reply === undefined) return void (await fail('the tutor did not answer'))
        const parsed = parseTutorReply(reply)
        if (parsed.kind === 'correction') return void (await done({ role: 'tutor', kind: 'correction', text: parsed.body }))
        const lines = parseNumbered(parsed.body, sentences.length)
        if (!inScript(lines, s.target) && !mostlyCopies(lines, sentences)) return void (await done(english(lines)))
      }
      return void (await fail(`the tutor did not answer in ${s.target}`))
    }

    // A reply, a plan or a text the person picked: translated in batches of sentences, one call each.
    const units = splitUnits(job.text)
    const sentences = sentencesOf(units)
    if (sentences.length === 0) return
    let budget = MAX_TEXT_CHARS
    const limited = sentences.filter(sentence => (budget -= sentence.length) >= 0)
    const note = limited.length < sentences.length ? 'long text: only the first part is translated' : undefined
    const groups = batches(limited, BATCH_CHARS)
    if (isThirdLanguage(limited.join(' '), s.target, s.native)) {
      // Neither side of the pair (English while learning Polish from Russian): the tutor writes both.
      const source = scriptOf(limited.join(' '))
      const sidesWrong = (lines: Lines, sentences: readonly string[]) => {
        const { targets, natives } = sidesOf(lines)
        const leftInSource = (side: Lines, language: string) =>
          !!source && scriptForLanguage(language) !== source && mostlyInScript(side, source)
        return (
          mostlyCopies(targets, sentences) ||
          mostlyCopies(natives, sentences) ||
          leftInSource(targets, s.target) ||
          leftInSource(natives, s.native)
        )
      }
      const pairs: Lines = []
      for (const group of groups) {
        const got = await translateLines($, s, job, BOTH_SYSTEM(s), `${s.target} and ${s.native}`, group, l => sidesWrong(l, group), 4)
        if (got === undefined) return void (await fail('the tutor did not answer'))
        if (got === 'wrong') return void (await fail(`the tutor did not translate into ${s.target} and ${s.native}`))
        pairs.push(...got)
      }
      return void (await done({ role: 'paired', text: assembleBoth(units, pairs), ...(note ? { note } : {}) }))
    }
    const side = sideOf(limited.join(' '), s.target, s.native)
    if (side) {
      // Known direction: English replies go into the person's language, theirs into English.
      const toNative = side === 'target'
      const into = toNative ? s.native : s.target
      const lines: Lines = []
      for (const group of groups) {
        const got = await translateLines($, s, job, toNative ? TO_NATIVE_SYSTEM(s) : TO_TARGET_SYSTEM(s), into, group, l => inScript(l, into))
        if (got === undefined) return void (await fail('the tutor did not answer'))
        if (got === 'wrong') return void (await fail(`the tutor did not translate into ${into}`))
        lines.push(...got)
      }
      return void (await done({ role: 'paired', text: assemblePaired(units, lines, !toNative), ...(note ? { note } : {}) }))
    }
    // Same script on both sides: the tutor names the text's language on its first line.
    let lang: 'target' | 'native' | undefined
    const translations: Lines = []
    for (const group of groups) {
      const reply = await complete($, s, job, TRANSLATE_SYSTEM(s), numbered(group), Math.min(16_000, 500 + 2 * group.join(' ').length))
      if (reply === undefined) return void (await fail('the tutor did not answer'))
      const parsed = parseTranslateReply(reply, group.length)
      if (mostlyCopies(parsed.translations, group)) return void (await fail('the tutor copied instead of translating'))
      lang ??= parsed.lang
      translations.push(...parsed.translations)
    }
    await done({ role: 'paired', text: assemblePaired(units, translations, lang === 'native'), ...(note ? { note } : {}) })
  } finally {
    $.ui.status(statusText(s))
  }
}

/** Makes `folder` the project that learns; the panel of the window showing it takes over. */
async function claimLearner($: EngineInterface, folder: string): Promise<void> {
  const path = learnerPathFor(await homeOf($))
  if (path) await $.fs.write(path, JSON.stringify({ folders: [folder], ts: Date.now() }) + '\n')
}

/** The plan file the model wrote, when it is there and has text. */
async function readPlanFile($: EngineInterface): Promise<string | undefined> {
  if (!lastPlanPath) return undefined
  try {
    const text = (await $.fs.read(lastPlanPath)) as string
    return text.trim() ? text : undefined
  } catch {
    return undefined
  }
}

/** The plan as ExitPlanMode's result carries it, once the person has decided. */
function planOf(result: unknown): string | undefined {
  const plan = result && typeof result === 'object' ? (result as { plan?: unknown }).plan : undefined
  return typeof plan === 'string' && plan.trim() ? plan : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'tutor',
      description: 'Language tutor: on/off, level, languages, tutor model, read aloud',
      argumentHint: 'on | off | level B1 | lang English | native Russian | model haiku | read on | status',
    })
    const s = await readSettings($)
    $.ui.status(statusText(s))
    $.clock.every(TICK_MS, () => {
      void tick($)
    })
    return next(e)
  })

  on('command.run', { command: 'tutor' }, async ($, e) => {
    const change = applyCommand(await readSettings($), e.args)
    if (!change.ok) return { text: change.error }
    if (change.changed) await writeSettings($, change.settings)
    // Turned on from a session: its project is the one that learns, in whichever window shows it.
    if (/^\s*on\b/i.test(e.args)) await claimLearner($, await sessionCwd($, await $.session.id()))
    $.ui.status(statusText(change.settings))
    return { text: change.note }
  })

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId || e.message.role !== 'user' || e.message.isMeta) return stored
    const raw = textOf(e.message.content)
    if (!isHumanPrompt(e.origin.kind, raw)) return stored
    const text = stripMachineBlocks(raw)
    if (!text) return stored
    await observe($, 'user', text, e.origin.kind)
    return stored
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId || e.message.role !== 'assistant') return stored
    const text = textOf(e.message.content)
    if (!text.trim()) return stored
    await observe($, 'assistant', text)
    return stored
  })

  // Plan mode: the model writes its plan to a file under ~/.claude/plans and
  // then presents it with ExitPlanMode. The file is read at that moment, before
  // the person decides, so the panel has the English while they read.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (!e.agentId && e.tool === 'Write' && isPlanPath(e.file_path, await homeOf($))) lastPlanPath = e.file_path
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (!e.agentId && e.tool === 'Edit' && isPlanPath(e.file_path, await homeOf($))) lastPlanPath = e.file_path
    return next(e)
  })

  on('tool.call', { tool: 'ExitPlanMode' }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const text = await readPlanFile($)
    if (text) {
      await observe($, 'assistant', text, 'plan')
      return next(e)
    }
    // No file seen in this process (a reload): the result names the plan once the person has decided.
    const answered = await next(e)
    const plan = planOf(answered.result)
    if (plan) await observe($, 'assistant', plan, 'plan')
    return answered
  })
}
