// The settings sheet: slides over the list from the top. Its main view holds
// the language pair, plain-language level, tutor model and voice; the two
// language rows open a searchable list inside the same sheet.

import { LANGUAGES, findLanguage, langCode, searchLanguages, type Language } from '../languages'
import type { TutorSettings, Usage, UsageSummary, ViewConfig, ViewExchange } from '../protocol'
import { el, icon } from './dom'
import { canOpenSpeechSettings, voiceSteps } from './voices'

export type SheetView = 'main' | 'target' | 'native' | 'history'

export type SheetContext = {
  settings: TutorSettings
  config: ViewConfig
  usage: Usage
  /** Tutor tokens today, 7 and 30 days, and per project; undefined until the host says. */
  totals: UsageSummary | undefined
  /** This window's first folder, marked among the projects. */
  project: string
  voicesFor: (code: string) => string[]
  hasVoice: (code: string) => boolean
  /** The host's system (win32, darwin, linux): which steps add a voice. */
  platform: string
  exchanges: readonly ViewExchange[]
  currentId: string | undefined
  timeOf: (ts: string) => string
  set: (patch: Partial<TutorSettings>) => void
  setVoice: (patch: { voice?: string; rate?: number }) => void
  openSpeechSettings: () => void
  pick: (exchangeId: string) => void
  /** Opens an aside (a plan, a picked text) in its editor tab. */
  openDocument: (exchangeId: string) => void
  clear: () => void
  go: (view: SheetView) => void
  close: () => void
}

function tokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
}

const LEVELS: TutorSettings['level'][] = ['off', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']

// The level shapes the English the tutor writes in this panel; Claude's own
// replies never change.
const LEVEL_HINTS: Record<TutorSettings['level'], string> = {
  off: 'Natural, the way a native speaker writes.',
  A1: 'Very short sentences and the most common words.',
  A2: 'Short sentences, everyday words, no idioms.',
  B1: 'Plain everyday words and short sentences.',
  B2: 'Natural language at a relaxed pace.',
  C1: 'Native-level language, nothing simplified.',
  C2: 'Precise, idiomatic native-level language.',
}

const SAMPLES: Record<string, string> = {
  en: 'Hello! This is how I sound.',
  de: 'Hallo! So klinge ich.',
  es: '¡Hola! Así es como sueno.',
  fr: 'Bonjour ! Voici comment je parle.',
  it: 'Ciao! Ecco come suono.',
  pt: 'Olá! É assim que eu soo.',
  ru: 'Привет! Вот так я звучу.',
  uk: 'Привіт! Ось так я звучу.',
  pl: 'Cześć! Tak brzmię.',
  nl: 'Hallo! Zo klink ik.',
  tr: 'Merhaba! Sesim böyle.',
  ja: 'こんにちは。私の声はこんな感じです。',
  zh: '你好！这就是我的声音。',
  ko: '안녕하세요! 제 목소리는 이렇습니다.',
}

const RATES = [0.75, 1, 1.25]

function displayName(name: string): string {
  return findLanguage(name)?.native ?? name
}

function segmented(
  label: string,
  options: { value: string; label: string; sub?: string }[],
  current: string,
  onPick: (value: string) => void,
  extraClass = '',
): HTMLElement {
  return el(
    'div',
    { class: `segmented ${extraClass}`.trim(), role: 'radiogroup', 'aria-label': label },
    ...options.map(o =>
      el(
        'button',
        {
          class: 'segment',
          role: 'radio',
          'aria-checked': String(o.value === current),
          onclick: () => onPick(o.value),
        },
        el('span', { class: 'segment-label' }, o.label),
        o.sub ? el('span', { class: 'segment-sub' }, o.sub) : null,
      ),
    ),
  )
}

function switchButton(label: string, on: boolean, onToggle: () => void, disabled = false): HTMLElement {
  return el(
    'button',
    { class: 'switch-row', role: 'switch', 'aria-checked': String(on), disabled, onclick: onToggle },
    el('span', { class: 'switch-label' }, label),
    el('span', { class: 'switch', 'aria-hidden': 'true' }, el('span', { class: 'switch-thumb' })),
  )
}

export function sheetHeader(view: SheetView, ctx: SheetContext): HTMLElement {
  const title = view === 'main' ? 'Settings' : view === 'target' ? 'Learning' : view === 'native' ? 'My language' : 'History'
  return el(
    'header',
    { class: 'sheet-head' },
    view === 'main' || view === 'history'
      ? null
      : el('button', { class: 'icon-btn back', 'aria-label': 'Back', title: 'Back', onclick: () => ctx.go('main') }, icon('chevron-left')),
    el('h2', { class: 'sheet-title', id: 'sheet-title' }, title),
    el('span', { class: 'grow' }),
    el('button', { class: 'text-btn done', onclick: () => ctx.close() }, 'Done'),
  )
}

export function sheetMain(ctx: SheetContext, sampleSlot: (sample: HTMLElement) => HTMLElement): HTMLElement {
  const s = ctx.settings
  const targetCode = langCode(s.target)
  const voiced = ctx.hasVoice(targetCode)

  const languages = el(
    'div',
    { class: 'group' },
    el(
      'button',
      { class: 'row', onclick: () => ctx.go('target') },
      el('span', { class: 'row-label' }, 'Learning'),
      el('span', { class: 'row-value' }, displayName(s.target)),
      icon('chevron-right', 'row-chevron'),
    ),
    el(
      'button',
      { class: 'row', onclick: () => ctx.go('native') },
      el('span', { class: 'row-label' }, 'My language'),
      el('span', { class: 'row-value' }, displayName(s.native)),
      icon('chevron-right', 'row-chevron'),
    ),
  )

  const level = el(
    'div',
    { class: 'group' },
    el('div', { class: 'group-label' }, `${s.target} in this panel`),
    segmented(
      'Plain-language level',
      LEVELS.map(l => ({ value: l, label: l === 'off' ? 'Natural' : l })),
      s.level,
      value => ctx.set({ level: value as TutorSettings['level'] }),
      'levels',
    ),
    el('p', { class: 'hint' }, `${LEVEL_HINTS[s.level]} Claude's own replies stay as they are.`),
  )

  const model = el(
    'div',
    { class: 'group' },
    el('div', { class: 'group-label' }, 'Tutor model'),
    segmented(
      'Tutor model',
      [
        { value: 'haiku', label: 'Haiku', sub: 'Fast, cheap' },
        { value: 'sonnet', label: 'Sonnet', sub: 'Better explanations' },
      ],
      s.tutorModel,
      value => ctx.set({ tutorModel: value as TutorSettings['tutorModel'] }),
      'two-line',
    ),
    el('p', { class: 'hint' }, `Writes the ${s.target}, translates it and corrects your messages, on the side.`),
    el(
      'p',
      { class: 'hint usage' },
      ctx.usage.calls === 0
        ? 'No tutor calls in this session yet.'
        : `This session: ${tokens(ctx.usage.input + ctx.usage.output)} tokens in ${ctx.usage.calls} ${ctx.usage.calls === 1 ? 'call' : 'calls'}.`,
    ),
  )

  const totals = ctx.totals
  const sameFolder = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
  const spending = el(
    'div',
    { class: 'group' },
    el('div', { class: 'group-label' }, 'Tutor tokens'),
    totals
      ? el(
          'div',
          { class: 'spend' },
          ...(
            [
              ['Today', totals.today],
              ['7 days', totals.week],
              ['30 days', totals.month],
            ] as const
          ).map(([label, t]) =>
            el('div', { class: 'spend-cell', title: `${t.calls} ${t.calls === 1 ? 'call' : 'calls'}` }, el('span', { class: 'spend-value' }, tokens(t.tokens)), el('span', { class: 'spend-label' }, label)),
          ),
        )
      : el('p', { class: 'hint' }, '…'),
    totals && totals.projects.length > 0
      ? el(
          'div',
          { class: 'spend-projects' },
          el('div', { class: 'hint' }, 'By project, 30 days'),
          ...totals.projects.slice(0, 6).map(p =>
            el(
              'div',
              { class: `spend-project${sameFolder(p.path, ctx.project) ? ' current' : ''}`, title: p.path },
              el('span', { class: 'spend-name' }, p.name),
              el('span', { class: 'spend-num' }, `${tokens(p.tokens)} · ${p.calls} ${p.calls === 1 ? 'call' : 'calls'}`),
            ),
          ),
        )
      : null,
  )

  const voices = ctx.voicesFor(targetCode)
  const voiceGroup = el('div', { class: 'group' }, el('div', { class: 'group-label' }, 'Reading aloud'))
  if (voiced) {
    const select = el(
      'select',
      {
        class: 'select',
        'aria-label': 'Voice',
        onchange: event => ctx.setVoice({ voice: (event.target as HTMLSelectElement).value }),
      },
      el('option', { value: '' }, 'Automatic'),
      ...voices.map(name => el('option', { value: name, selected: name === ctx.config.voice }, name.replace(/^Microsoft /, ''))),
    )
    const sample = el('span', { class: 's sample-text' }, SAMPLES[targetCode] ?? SAMPLES.en ?? '')
    voiceGroup.append(
      el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Voice'), select),
      el(
        'div',
        { class: 'field' },
        el('span', { class: 'field-label' }, 'Speed'),
        segmented(
          'Speed',
          RATES.map(r => ({ value: String(r), label: `${r}×` })),
          String(RATES.reduce((a, b) => (Math.abs(b - ctx.config.rate) < Math.abs(a - ctx.config.rate) ? b : a))),
          value => ctx.setVoice({ rate: Number(value) }),
          'compact',
        ),
      ),
      sampleSlot(sample),
    )
  } else {
    voiceGroup.append(
      el(
        'p',
        { class: 'hint warn' },
        `No ${s.target} voice on this computer, so replies can't be read aloud. ${voiceSteps(s.target, ctx.platform)} `,
        canOpenSpeechSettings(ctx.platform) ? el('button', { class: 'link', onclick: () => ctx.openSpeechSettings() }, 'Open speech settings') : null,
      ),
    )
  }
  voiceGroup.append(switchButton('Read each reply aloud', s.autoRead && voiced, () => ctx.set({ autoRead: !s.autoRead }), !voiced))

  const credit = el(
    'div',
    { class: 'group' },
    el('p', { class: 'credit' }, 'Word meanings on hover: WikDict, from Wiktionary (CC BY-SA). Offline, no tokens.'),
  )
  return el('div', { class: 'sheet-body' }, languages, level, model, spending, voiceGroup, credit)
}

/** The language list for one side of the pair; `renderList` redraws only the rows as the query changes. */
export function sheetLanguages(which: 'target' | 'native', ctx: SheetContext, query: string, onQuery: (q: string) => void): HTMLElement {
  const list = el('div', { class: 'lang-list', role: 'listbox', 'aria-labelledby': 'sheet-title' })
  const input = el('input', {
    class: 'search-input',
    type: 'search',
    placeholder: 'Search languages',
    'aria-label': 'Search languages',
    value: query,
    spellcheck: 'false',
    autocomplete: 'off',
  }) as HTMLInputElement
  input.addEventListener('input', () => {
    onQuery(input.value)
    renderList(input.value)
  })
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const first = list.querySelector<HTMLButtonElement>('.lang-row')
      first?.click()
    }
  })

  const current = which === 'target' ? ctx.settings.target : ctx.settings.native
  const pick = (name: string) => {
    const s = ctx.settings
    const other = which === 'target' ? s.native : s.target
    // Picking the other side's language swaps the pair instead of refusing.
    const patch: Partial<TutorSettings> =
      name.toLowerCase() === other.toLowerCase()
        ? which === 'target'
          ? { target: name, native: s.target }
          : { native: name, target: s.native }
        : which === 'target'
          ? { target: name }
          : { native: name }
    ctx.set(patch)
    ctx.go('main')
  }

  const row = (l: Language) =>
    el(
      'button',
      {
        class: 'lang-row',
        role: 'option',
        'aria-selected': String(l.name.toLowerCase() === current.toLowerCase()),
        onclick: () => pick(l.name),
      },
      el('span', { class: 'lang-native' }, l.native),
      l.native !== l.name ? el('span', { class: 'lang-en' }, l.name) : null,
      el('span', { class: 'grow' }),
      which === 'target' && ctx.hasVoice(l.code) ? icon('unmute', 'lang-voice') : null,
      l.name.toLowerCase() === current.toLowerCase() ? icon('check', 'lang-check') : null,
    )

  function renderList(q: string): void {
    const found = searchLanguages(q)
    const custom = q.trim()
    const rows: HTMLElement[] = found.map(row)
    if (found.length === 0 && /^[\p{L}][\p{L} -]{0,29}$/u.test(custom)) {
      const name = custom.charAt(0).toUpperCase() + custom.slice(1)
      rows.push(
        el('button', { class: 'lang-row custom', role: 'option', onclick: () => pick(name) }, el('span', { class: 'lang-native' }, `Use “${name}”`)),
      )
    }
    if (rows.length === 0) rows.push(el('p', { class: 'hint' }, 'No match.'))
    list.replaceChildren(...rows)
  }
  renderList(query)

  const footnote =
    which === 'target'
      ? el('p', { class: 'footnote' }, icon('unmute'), ' Has a voice on this computer')
      : el('p', { class: 'footnote' }, 'Translations and explanations come in this language.')

  setTimeout(() => input.focus(), 30)
  return el(
    'div',
    { class: 'sheet-body lang-view' },
    el('div', { class: 'search' }, icon('search', 'search-icon'), input),
    footnote,
    list,
  )
}

/** This session's exchanges, newest first; a plan or a picked text opens its tab; Clear asks for a second tap. */
export function sheetHistory(ctx: SheetContext): HTMLElement {
  const rows = [...ctx.exchanges].reverse().map((x, i) =>
    el(
      'button',
      {
        class: x.kind ? 'history-row history-aside' : 'history-row',
        'aria-current': String(x.id === ctx.currentId),
        title: x.kind ? 'Opens in its own tab' : undefined,
        onclick: () => (x.kind ? ctx.openDocument(x.id) : ctx.pick(x.id)),
      },
      el('span', { class: 'history-title' }, x.kind ? icon(x.kind === 'plan' ? 'list-tree' : 'selection', 'history-icon') : null, x.title || '(no text)'),
      el('span', { class: 'history-time' }, i === 0 ? `Latest · ${ctx.timeOf(x.ts)}` : ctx.timeOf(x.ts)),
    ),
  )
  let armed = false
  const clear = el('button', { class: 'text-btn danger' }, 'Clear history') as HTMLButtonElement
  clear.addEventListener('click', () => {
    if (armed) {
      ctx.clear()
      return
    }
    armed = true
    clear.textContent = 'Tap again to clear'
    setTimeout(() => {
      armed = false
      clear.textContent = 'Clear history'
    }, 4000)
  })
  return el(
    'div',
    { class: 'sheet-body history-view' },
    rows.length > 0 ? el('div', { class: 'history-list' }, ...rows) : el('p', { class: 'hint' }, 'Nothing in this session yet.'),
    el(
      'div',
      { class: 'history-foot' },
      el('p', { class: 'footnote' }, 'History lives for this session only and is deleted after a day.'),
      rows.length > 0 ? clear : null,
    ),
  )
}

export const LANGUAGE_COUNT = LANGUAGES.length
