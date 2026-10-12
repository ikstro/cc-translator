// The Tutor webview, in two modes. The side panel: the latest exchange (your
// message and Claude's replies), this session's history, tap-to-translate
// sentences, the player and the settings sheet. A document tab: one plan or
// one picked text on its own, with the same sentences, player and word card.
// Markdown arrives rendered from the extension host.

import { labelCode, langCode, scriptFor, scriptOf, voiceMatches } from '../languages'
import type {
  EmptyReason,
  HostVoice,
  LearningState,
  ToHost,
  ToView,
  TutorSettings,
  Usage,
  UsageSummary,
  ViewBlock,
  ViewConfig,
  ViewExchange,
} from '../protocol'
import { el, html, icon, setIcon } from './dom'
import { WordHover } from './hover'
import { Player } from './player'
import { sheetHeader, sheetHistory, sheetLanguages, sheetMain, type SheetContext, type SheetView } from './sheet'
import { canOpenSpeechSettings, voiceSteps } from './voices'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): { showAll?: boolean } | undefined
  setState(state: { showAll?: boolean }): void
}

const vscode = acquireVsCodeApi()
const post = (message: ToHost) => vscode.postMessage(message)

const LOCAL_PENDING_MS = 15_000

/** Which webview this is: the side panel, or a document tab showing one exchange. */
const mode: 'panel' | 'document' = document.body.dataset.mode === 'document' ? 'document' : 'panel'

const state = {
  received: false,
  exchanges: [] as ViewExchange[],
  settings: undefined as TutorSettings | undefined,
  config: { voice: '', rate: 1, wordHint: 'shift' } as ViewConfig,
  usage: { input: 0, output: 0, calls: 0 } as Usage,
  totals: undefined as UsageSummary | undefined,
  /** Whether this window learns; another window may, while this one only records. */
  learning: { where: 'nowhere' } as LearningState,
  /** This window's first folder. */
  project: '',
  empty: undefined as EmptyReason,
  showAll: vscode.getState()?.showAll ?? false,
  hostVoices: undefined as HostVoice[] | undefined,
  hostCanSpeak: false,
  /** The host's system, for the steps to add a voice; empty until the host says. */
  platform: '',
  webVoices: [] as SpeechSynthesisVoice[],
  sheet: null as null | { view: SheetView; query: string },
  /** The exchange on screen; null follows the latest turn of the conversation. */
  viewing: null as string | null,
  /** A document tab still waiting for the plugin to record its text, and whether it ever did. */
  pending: false,
  wasPending: false,
  latestKey: '',
  lastNewest: undefined as string | undefined,
  /** Translate taps not yet confirmed by the plugin, with when they were made. */
  asked: new Map<string, number>(),
}

// ---------------------------------------------------------------- voices

function targetCode(): string {
  return langCode(state.settings?.target)
}

function webVoice(): SpeechSynthesisVoice | undefined {
  const code = targetCode()
  const named = state.config.voice ? state.webVoices.find(v => v.name === state.config.voice) : undefined
  if (named) return named
  if (state.config.voice && state.hostVoices?.some(v => v.name === state.config.voice)) return undefined
  const matching = state.webVoices.filter(v => voiceMatches(v.lang, code))
  return matching.find(v => v.localService) ?? matching[0]
}

function voicesFor(code: string): string[] {
  const names = new Set<string>()
  for (const v of state.webVoices) if (voiceMatches(v.lang, code)) names.add(v.name)
  if (state.hostCanSpeak) for (const v of state.hostVoices ?? []) if (voiceMatches(v.lang, code)) names.add(v.name)
  return [...names]
}

function hasVoice(code: string): boolean {
  if (state.webVoices.some(v => voiceMatches(v.lang, code))) return true
  if (state.hostVoices === undefined) return true
  return state.hostCanSpeak && state.hostVoices.some(v => voiceMatches(v.lang, code))
}

function refreshWebVoices(): void {
  if (!('speechSynthesis' in window)) return
  state.webVoices = window.speechSynthesis.getVoices()
  renderChrome()
}

// ---------------------------------------------------------------- player

const player = new Player(
  post,
  {
    lang: () => targetCode(),
    voice: webVoice,
    rate: () => state.config.rate,
    hostCanSpeak: () => state.hostCanSpeak,
  },
  () => updatePlayButtons(),
)

// ---------------------------------------------------------------- skeleton

const root = document.getElementById('root') as HTMLDivElement

const powerSwitch = el(
  'button',
  { class: 'power', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Tutor', onclick: () => post({ type: 'setLearning', on: !learningHere() }) },
  el('span', { class: 'switch', 'aria-hidden': 'true' }, el('span', { class: 'switch-thumb' })),
)
const chipLabel = el('span', { class: 'chip-label' }, '…')
const chip = el('button', { class: 'chip', 'aria-haspopup': 'dialog', title: 'Tutor settings', onclick: () => openSheet('main') }, chipLabel, icon('chevron-down', 'chip-chevron'))
const historyButton = el('button', { class: 'icon-btn history-btn', 'aria-haspopup': 'dialog', title: 'History of this session', 'aria-label': 'History', onclick: () => openSheet('history') }, icon('history'))
const showAllButton = el('button', { class: 'toggle', 'aria-pressed': 'false', title: 'Show every translation', onclick: () => toggleShowAll() }, 'RU')
const docTitle = el('h1', { class: 'doc-title' }, 'Tutor')
const header =
  mode === 'document'
    ? el('header', { class: 'bar' }, docTitle, el('span', { class: 'grow' }), showAllButton)
    : el('header', { class: 'bar' }, powerSwitch, chip, el('span', { class: 'grow' }), historyButton, showAllButton)

const offText = el('span', { class: 'banner-text' })
const offButton = el('button', { class: 'primary-btn', onclick: () => post({ type: 'setLearning', on: true }) }, 'Turn on')
const offBanner = el('div', { class: 'banner', hidden: true }, offText, offButton)

/** The tutor translates in this window: it is on, and this window's project is the one learning. */
function learningHere(): boolean {
  return (state.settings?.enabled ?? false) && state.learning.where === 'here'
}
const crumb = el(
  'div',
  { class: 'crumb', hidden: true },
  el('button', { class: 'text-btn crumb-back', onclick: () => showExchange(null) }, icon('arrow-left'), ' Latest'),
  el('span', { class: 'crumb-time' }),
)
const emptyState = el('div', { class: 'empty', hidden: true })
const list = el('main', { class: 'list' })
const newReply = el('button', { class: 'pill', hidden: true, onclick: () => showExchange(null, true) }, icon('arrow-down'), 'New reply')
const hint = el('div', { class: 'toast', role: 'status', hidden: true })
const layer = el('div', { class: 'layer', hidden: true })

root.append(header, offBanner, crumb, emptyState, list, newReply, hint, layer)

const hover = new WordHover({
  host: root,
  area: list,
  post,
  blocked: () => state.sheet !== null,
  nativeName: () => state.settings?.native ?? 'your language',
  mode: () => state.config.wordHint ?? 'shift',
})

// ---------------------------------------------------------------- header & states

function timeOf(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** The newest turn of the conversation: a plan or a picked text lives in its own tab, not here. */
function latestConversation(): ViewExchange | undefined {
  for (let i = state.exchanges.length - 1; i >= 0; i--) {
    const x = state.exchanges[i]
    if (x && !x.kind) return x
  }
  return undefined
}

function renderChrome(): void {
  const s = state.settings
  const on = learningHere()
  showAllButton.textContent = labelCode(s?.native)
  showAllButton.setAttribute('aria-pressed', String(state.showAll))
  showAllButton.title = state.showAll ? `Hide the ${s?.native ?? ''} lines` : `Show every ${s?.native ?? ''} line`
  document.body.classList.toggle('show-all', state.showAll)
  document.body.classList.toggle('no-voice', !hasVoice(targetCode()))

  if (mode === 'document') {
    const shown = state.exchanges[0]
    docTitle.textContent = shown?.title ?? 'Tutor'
    const gone = state.received && !shown
    emptyState.hidden = !gone
    if (gone && state.pending) {
      emptyState.replaceChildren(el('p', { class: 'empty-text status-line' }, icon('loading', 'codicon-modifier-spin'), 'Asking Claude Code to translate…'))
    } else if (gone && state.wasPending) {
      emptyState.replaceChildren(
        el('p', { class: 'empty-title' }, 'Nothing translated it'),
        el('p', { class: 'empty-text' }, 'Translations run only while Claude Code is open in this folder and the tutor is on. Try again then.'),
      )
    } else if (gone) {
      emptyState.replaceChildren(
        el('p', { class: 'empty-title' }, 'Nothing to show'),
        el('p', { class: 'empty-text' }, 'This text is no longer in the history: it was cleared, or it is older than a day.'),
      )
    }
    updatePlayButtons()
    return
  }

  powerSwitch.setAttribute('aria-checked', String(on))
  powerSwitch.title = on ? 'Turn the tutor off' : 'Turn the tutor on'
  chipLabel.textContent = s ? `${s.target} → ${s.native}${s.level === 'off' ? '' : ' · ' + s.level}` : '…'
  historyButton.toggleAttribute('disabled', state.exchanges.length < 2)
  // Learning in another window: this one still records, and a message here is translated on a tap.
  const elsewhere = (s?.enabled ?? false) && state.learning.where === 'elsewhere'
  document.body.classList.toggle('is-off', state.received && !on && !elsewhere)
  offBanner.hidden = !state.received || on
  if (elsewhere) {
    const where = state.learning.project ? `in ${state.learning.project}` : 'in another window'
    offText.textContent = `Learning is on ${where}. Here, tap Translate under a message to translate it.`
    offButton.textContent = 'Learn here'
  } else {
    offText.textContent = 'The tutor is off. Claude answers as usual and nothing is translated.'
    offButton.textContent = 'Turn on'
  }

  const isEmpty = state.received && on && state.exchanges.length === 0
  emptyState.hidden = !isEmpty
  if (isEmpty && s) {
    emptyState.replaceChildren(
      el('p', { class: 'empty-title' }, 'Ask Claude anything'),
      el(
        'p',
        { class: 'empty-text' },
        `While this panel is open, your messages and Claude's replies show up here in ${s.target}. Tap a sentence to see it in ${s.native}; press play to hear it; hold Shift over a word for its meaning.`,
      ),
    )
  }
  if (state.sheet && state.sheet.view !== 'target' && state.sheet.view !== 'native') renderSheet()
  updatePlayButtons()
}

// ---------------------------------------------------------------- the exchange on screen

const built = new Map<string, { el: HTMLElement; sig: string }>()

function blockState(b: ViewBlock): ViewBlock['state'] {
  const asked = state.asked.get(b.id)
  if (b.state === 'done' || b.state === 'translating') {
    state.asked.delete(b.id)
    return b.state
  }
  if (asked !== undefined && Date.now() - asked < LOCAL_PENDING_MS) return 'translating'
  return b.state
}

function signature(b: ViewBlock): string {
  return `${b.html.length}:${blockState(b)}:${b.note ?? ''}:${b.tutor ?? ''}:${state.settings?.enabled ? 1 : 0}`
}

function statusFor(b: ViewBlock): HTMLElement[] {
  const s = blockState(b)
  const parts: HTMLElement[] = []
  if (s === 'translating') parts.push(el('span', { class: 'status-line' }, icon('loading', 'codicon-modifier-spin'), 'Translating…'))
  if ((s === 'untranslated' || s === 'failed') && state.settings?.enabled) {
    parts.push(el('button', { class: 'listen translate', 'data-translate': b.id }, icon('globe'), el('span', {}, 'Translate')))
  }
  if (b.note) parts.push(el('span', { class: 'status-line' }, b.note))
  return parts
}

function listenButton(key: string, kind: 'message' | 'user'): HTMLElement {
  return el('button', { class: 'listen', 'data-play': kind, 'data-key': key }, icon('play'), el('span', { class: 'listen-label' }, 'Listen'))
}

function numberSentences(container: HTMLElement, id: string): void {
  container.querySelectorAll<HTMLElement>('span.s').forEach((span, i) => {
    const play = span.nextElementSibling?.classList.contains('tr') ? span.nextElementSibling.querySelector<HTMLElement>('[data-play]') : null
    if (play) play.dataset.key = `s:${id}:${i}`
  })
}

function buildBlock(b: ViewBlock): HTMLElement {
  if (b.role === 'user') {
    const text = el('div', { class: 'user-text' }, html(b.html))
    numberSentences(text, b.id)
    const label =
      b.tutor === 'translation'
        ? `In ${state.settings?.target ?? 'English'}`
        : b.tutor === 'correction'
          ? 'Corrected'
          : b.tutor === 'correct'
            ? '✓ No mistakes'
            : ''
    const foot = el(
      'footer',
      { class: 'msg-foot' },
      b.tutor === 'translation' ? listenButton(`u:${b.id}`, 'user') : null,
      ...statusFor(b),
      el('span', { class: 'grow' }),
      label ? el('span', { class: `tutor-label tutor-${b.tutor}` }, label) : null,
    )
    return el('article', { class: 'msg user', 'data-id': b.id }, el('div', { class: 'bubble' }, text, foot))
  }
  const body = el('div', { class: 'body' }, html(b.html))
  numberSentences(body, b.id)
  // A reply still only in the person's own language has nothing to read in the learned one.
  const prose = [...body.querySelectorAll('span.s')].map(s => s.textContent ?? '').join(' ')
  const readable = b.state === 'done' || scriptOf(prose) === undefined || scriptOf(prose) === scriptFor(state.settings?.target)
  const foot = el('footer', { class: 'msg-foot' }, readable ? listenButton(`m:${b.id}`, 'message') : null, ...statusFor(b))
  return el('article', { class: 'msg assistant', 'data-id': b.id }, body, foot)
}

function displayed(): ViewExchange | undefined {
  if (mode === 'document') return state.exchanges[0]
  if (state.viewing) {
    const found = state.exchanges.find(x => x.id === state.viewing)
    if (found) return found
    state.viewing = null
  }
  return latestConversation()
}

function isAtBottom(): boolean {
  const doc = document.scrollingElement ?? document.documentElement
  return doc.scrollHeight - doc.scrollTop - doc.clientHeight < 48
}

function scrollToBottom(smooth = false): void {
  const doc = document.scrollingElement ?? document.documentElement
  window.scrollTo({ top: doc.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  newReply.hidden = true
}

function renderList(options: { jumped?: boolean } = {}): void {
  const exchange = displayed()
  const wasAtBottom = isAtBottom()
  const blocks = exchange?.blocks ?? []
  let added = false
  const seen = new Set<string>()
  let previous: Element | null = null
  for (const block of blocks) {
    seen.add(block.id)
    const sig = signature(block)
    let record = built.get(block.id)
    if (!record || record.sig !== sig) {
      const node = buildBlock(block)
      if (record) {
        if (player.reads(record.el)) player.stop()
        record.el.replaceWith(node)
      } else {
        added = true
      }
      record = { el: node, sig }
      built.set(block.id, record)
    }
    const expected: Element | null = previous ? previous.nextElementSibling : list.firstElementChild
    if (expected !== record.el) list.insertBefore(record.el, expected)
    previous = record.el
  }
  for (const [id, record] of built) {
    if (!seen.has(id)) {
      if (player.reads(record.el)) player.stop()
      record.el.remove()
      built.delete(id)
    }
  }

  if (mode === 'document') {
    // A document is read from the top; nothing scrolls by itself.
    updatePlayButtons()
    return
  }

  const latest = latestConversation()
  const onLatest = !state.viewing || state.viewing === latest?.id
  crumb.hidden = onLatest || !exchange
  const crumbTime = crumb.querySelector('.crumb-time')
  if (crumbTime && exchange) {
    const index = state.exchanges.indexOf(exchange) + 1
    crumbTime.textContent = `${timeOf(exchange.ts)} · ${index} of ${state.exchanges.length}`
  }

  const latestKey = latest ? `${latest.id}:${latest.blocks.length}` : ''
  const latestChanged = latestKey !== state.latestKey
  state.latestKey = latestKey
  if (options.jumped) window.scrollTo({ top: 0 })
  else if (onLatest && (wasAtBottom || added)) scrollToBottom()
  if (!onLatest && latestChanged && state.received) newReply.hidden = false
  if (onLatest && isAtBottom()) newReply.hidden = true
  updatePlayButtons()
}

function showExchange(id: string | null, toBottom = false): void {
  const latest = latestConversation()
  state.viewing = id && id !== latest?.id ? id : null
  newReply.hidden = true
  renderList({ jumped: !toBottom })
  if (toBottom) scrollToBottom(true)
}

/** With "read each reply aloud" on, a new reply is read once its translation is in. */
function autoRead(): void {
  const latest = latestConversation()
  const newest = [...(latest?.blocks ?? [])].reverse().find(b => b.role === 'assistant' && b.state === 'done')
  const first = state.lastNewest === undefined
  if (!newest) {
    if (first) state.lastNewest = ''
    return
  }
  if (newest.id === state.lastNewest) return
  state.lastNewest = newest.id
  if (first || !state.settings?.autoRead || !learningHere() || state.viewing) return
  const article = list.querySelector<HTMLElement>(`article[data-id="${CSS.escape(newest.id)}"]`)
  if (article) player.play(`m:${newest.id}`, [...article.querySelectorAll<HTMLElement>('.body span.s')], { follow: true })
}

function updatePlayButtons(): void {
  for (const button of root.querySelectorAll<HTMLElement>('[data-play]')) {
    const playing = player.key !== null && button.dataset.key === player.key
    button.classList.toggle('is-playing', playing)
    setIcon(button.querySelector('.codicon'), playing ? 'debug-stop' : 'play')
    const label = button.querySelector('.listen-label')
    if (label) label.textContent = playing ? 'Stop' : 'Listen'
    button.setAttribute('aria-label', playing ? 'Stop' : 'Listen')
    button.title = playing ? 'Stop' : 'Listen'
  }
}

// ---------------------------------------------------------------- interaction

function setSettings(patch: Partial<TutorSettings>): void {
  if (state.settings) state.settings = { ...state.settings, ...patch }
  renderChrome()
  renderList()
  post({ type: 'setSettings', patch })
}

function toggleShowAll(): void {
  state.showAll = !state.showAll
  vscode.setState({ showAll: state.showAll })
  renderChrome()
}

let hintTimer: number | undefined
function showHint(content: (Node | string)[], ms = 6000): void {
  hint.replaceChildren(...content)
  hint.hidden = false
  window.clearTimeout(hintTimer)
  hintTimer = window.setTimeout(() => (hint.hidden = true), ms)
}

function noVoiceHint(): void {
  const target = state.settings?.target ?? 'this language'
  showHint(
    [
      `No ${target} voice on this computer. ${voiceSteps(target, state.platform)} `,
      canOpenSpeechSettings(state.platform)
        ? el('button', { class: 'link', onclick: () => post({ type: 'openSpeechSettings' }) }, 'Open speech settings')
        : '',
    ],
    15_000,
  )
}

function elementsFor(button: HTMLElement): HTMLElement[] {
  const article = button.closest('article')
  switch (button.dataset.play) {
    case 'sentence': {
      const span = button.closest('.tr')?.previousElementSibling
      return span instanceof HTMLElement ? [span] : []
    }
    case 'message':
      return article ? [...article.querySelectorAll<HTMLElement>('.body span.s')] : []
    case 'user':
      return article ? [...article.querySelectorAll<HTMLElement>('.user-text span.s')] : []
    case 'test': {
      const sample = button.parentElement?.querySelector<HTMLElement>('.sample-text')
      return sample ? [sample] : []
    }
    default:
      return []
  }
}

function askTranslation(ref: string): void {
  state.asked.set(ref, Date.now())
  post({ type: 'translate', ref })
  renderList()
  window.setTimeout(() => {
    if (!state.asked.has(ref)) return
    state.asked.delete(ref)
    renderList()
    showHint(['Nothing translated it. Translations run only while Claude Code is open in this folder.'])
  }, LOCAL_PENDING_MS + 200)
}

root.addEventListener('click', event => {
  const target = event.target as HTMLElement
  const translate = target.closest<HTMLElement>('[data-translate]')
  if (translate) {
    askTranslation(translate.dataset.translate ?? '')
    return
  }
  const playButton = target.closest<HTMLElement>('[data-play]')
  if (playButton) {
    event.stopPropagation()
    const key = playButton.dataset.key ?? ''
    if (player.key === key) {
      player.stop()
      return
    }
    if (!hasVoice(targetCode())) {
      noVoiceHint()
      return
    }
    const started = player.play(key, elementsFor(playButton), { follow: playButton.dataset.play === 'message' })
    if (!started) noVoiceHint()
    return
  }
  const translation = target.closest<HTMLElement>('.tr')
  if (translation && list.contains(translation)) {
    translation.previousElementSibling?.classList.toggle('open')
    return
  }
  const sentence = target.closest<HTMLElement>('span.s')
  if (sentence && list.contains(sentence) && !target.closest('a')) {
    if (sentence.nextElementSibling?.classList.contains('tr')) sentence.classList.toggle('open')
  }
})

root.addEventListener('keydown', event => {
  const target = event.target as HTMLElement
  if ((event.key === 'Enter' || event.key === ' ') && target.matches('span.s')) {
    event.preventDefault()
    target.click()
  }
})

window.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return
  if (state.sheet) closeSheet(true)
  else if (player.key) player.stop()
})

window.addEventListener('scroll', () => {
  if (mode === 'panel' && isAtBottom() && !state.viewing) newReply.hidden = true
}, { passive: true })
for (const kind of ['wheel', 'touchmove']) window.addEventListener(kind, () => player.userScrolled(), { passive: true })

// ---------------------------------------------------------------- sheet

let sheetEl: HTMLElement | null = null

function sheetContext(): SheetContext | undefined {
  const settings = state.settings
  if (!settings) return undefined
  const current = displayed()
  return {
    settings,
    config: state.config,
    usage: state.usage,
    totals: state.totals,
    project: state.project,
    voicesFor,
    hasVoice,
    platform: state.platform,
    exchanges: state.exchanges,
    currentId: current?.id,
    timeOf,
    set: patch => setSettings(patch),
    setVoice: patch => {
      state.config = {
        ...state.config,
        ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
        ...(patch.rate !== undefined ? { rate: patch.rate } : {}),
      }
      post({ type: 'setVoiceConfig', ...patch })
      renderSheet()
    },
    openSpeechSettings: () => post({ type: 'openSpeechSettings' }),
    pick: id => {
      closeSheet()
      showExchange(id)
    },
    openDocument: id => {
      closeSheet()
      post({ type: 'openDocument', id })
    },
    clear: () => {
      closeSheet()
      player.stop()
      state.viewing = null
      post({ type: 'clear' })
    },
    go: view => {
      if (!state.sheet) return
      state.sheet = { view, query: '' }
      renderSheet()
    },
    close: () => closeSheet(),
  }
}

function openSheet(view: SheetView): void {
  hover.hide()
  state.sheet = { view, query: '' }
  layer.hidden = false
  renderSheet()
  requestAnimationFrame(() => layer.classList.add('open'))
}

function closeSheet(fromKeyboard = false): void {
  if (!state.sheet) return
  const was = state.sheet.view
  state.sheet = null
  if (player.key === 'test') player.stop()
  layer.classList.remove('open')
  window.setTimeout(() => {
    if (!state.sheet) {
      layer.hidden = true
      layer.replaceChildren()
      sheetEl = null
    }
  }, 160)
  if (fromKeyboard) (was === 'history' ? historyButton : chip).focus()
}

function renderSheet(): void {
  const ctx = sheetContext()
  if (!state.sheet || !ctx) return
  const { view } = state.sheet
  const body =
    view === 'main'
      ? sheetMain(ctx, sample =>
          el(
            'div',
            { class: 'sample' },
            el('button', { class: 'icon-btn play', 'data-play': 'test', 'data-key': 'test', 'aria-label': 'Listen', title: 'Listen' }, icon('play')),
            sample,
          ),
        )
      : view === 'history'
        ? sheetHistory(ctx)
        : sheetLanguages(view, ctx, state.sheet.query, q => {
            if (state.sheet) state.sheet.query = q
          })
  const scrollTop = sheetEl?.querySelector('.sheet-body')?.scrollTop ?? 0
  const next = el('section', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' }, sheetHeader(view, ctx), body)
  if (sheetEl && layer.contains(sheetEl)) sheetEl.replaceWith(next)
  else layer.replaceChildren(el('div', { class: 'backdrop', onclick: () => closeSheet() }), next)
  sheetEl = next
  if (view === 'main' || view === 'history') next.querySelector('.sheet-body')?.scrollTo({ top: scrollTop })
  updatePlayButtons()
}

// ---------------------------------------------------------------- messages

/** Takes new settings; word meanings looked up for another language pair are dropped. */
function applySettings(next: TutorSettings): void {
  const pair = (x: TutorSettings | undefined) => (x ? `${x.target}|${x.native}` : '')
  const changed = state.settings !== undefined && pair(state.settings) !== pair(next)
  state.settings = next
  if (changed) hover.forget()
}

window.addEventListener('message', (event: MessageEvent<ToView>) => {
  const m = event.data
  switch (m.type) {
    case 'session':
      if (mode !== 'panel') return
      state.received = true
      state.exchanges = m.exchanges
      applySettings(m.settings)
      state.config = m.config
      state.usage = m.usage
      state.totals = m.totals
      state.learning = m.learning
      state.project = m.project
      state.empty = m.empty
      renderChrome()
      renderList()
      hover.refresh()
      autoRead()
      return
    case 'document':
      if (mode !== 'document') return
      state.received = true
      state.pending = m.pending === true
      state.wasPending = state.wasPending || state.pending
      state.exchanges = m.exchange ? [m.exchange] : []
      applySettings(m.settings)
      state.config = m.config
      renderChrome()
      renderList()
      hover.refresh()
      return
    case 'gloss':
      hover.onGloss(m)
      return
    case 'dictReady':
      hover.forget()
      return
    case 'hostVoices':
      state.hostVoices = m.voices
      state.hostCanSpeak = m.canSpeak
      state.platform = m.platform
      renderChrome()
      return
    case 'progress':
      player.onHostProgress(m.id, m.pos, m.len)
      return
    case 'speakDone':
      player.onHostDone(m.id)
      return
  }
})

if ('speechSynthesis' in window) {
  refreshWebVoices()
  window.speechSynthesis.addEventListener('voiceschanged', refreshWebVoices)
}

post({ type: 'ready' })
