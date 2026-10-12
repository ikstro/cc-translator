// The word card: hold Shift and hover (mouse or pen) any English word in the
// conversation and its dictionary meanings appear at once; the `wordHint`
// setting makes it plain hover instead, or turns it off. The word under the
// pointer is found from the text position, so nothing in the message is
// re-rendered; it is highlighted with the CSS Highlight API and looked up in
// the extension host's offline dictionary, once per word. Only English has
// dictionaries; another learned language gets a short note instead.

import type { Gloss, GlossMissing, ToHost, ToView, WordHintMode } from '../protocol'
import { el } from './dom'

const HIGHLIGHT = 'tutor-hover'
const HIDE_DELAY_MS = 180
const WORD = /[A-Za-z'’]/

type Answer = Extract<ToView, { type: 'gloss' }>
/** Answers that change by themselves: asked again on the next hover rather than kept. */
const PASSING: ReadonlySet<GlossMissing> = new Set(['downloading', 'download-failed'])
type Hit = { word: string; range: Range; rect: DOMRect }
/** Where the pointer last was, and whether Shift was held then. */
type Point = { x: number; y: number; shift: boolean }

type HighlightRegistryLike = { set(name: string, value: unknown): void; delete(name: string): void }

function highlights(): HighlightRegistryLike | undefined {
  return (globalThis as unknown as { CSS?: { highlights?: HighlightRegistryLike } }).CSS?.highlights
}

function caretAt(x: number, y: number): { node: Node; offset: number } | undefined {
  const doc = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const p = doc.caretPositionFromPoint?.(x, y)
  if (p) return { node: p.offsetNode, offset: p.offset }
  const r = doc.caretRangeFromPoint?.(x, y)
  return r ? { node: r.startContainer, offset: r.startOffset } : undefined
}

/** The English word under a point, inside a message's own text (not translations, code or buttons). */
function wordAtPoint(x: number, y: number): Hit | undefined {
  const caret = caretAt(x, y)
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return undefined
  const parent = caret.node.parentElement
  if (!parent?.closest('.body, .user-text') || parent.closest('.tr, pre, code, button, .word-card')) return undefined
  const text = (caret.node as Text).data
  let start = caret.offset
  if (!WORD.test(text[start] ?? '') && WORD.test(text[start - 1] ?? '')) start -= 1
  if (!WORD.test(text[start] ?? '')) return undefined
  let end = start
  while (start > 0 && WORD.test(text[start - 1] ?? '')) start--
  while (end < text.length && WORD.test(text[end] ?? '')) end++
  while (start < end && /['’]/.test(text[start] ?? '')) start++
  while (end > start && /['’]/.test(text[end - 1] ?? '')) end--
  if (end - start < 2) return undefined
  const range = document.createRange()
  range.setStart(caret.node, start)
  range.setEnd(caret.node, end)
  const rect = range.getBoundingClientRect()
  const slack = 2
  if (x < rect.left - slack || x > rect.right + slack || y < rect.top - slack || y > rect.bottom + slack) return undefined
  return { word: text.slice(start, end), range, rect }
}

export type WordHoverOptions = {
  host: HTMLElement
  area: HTMLElement
  post: (message: ToHost) => void
  blocked: () => boolean
  nativeName: () => string
  /** When the card shows: while Shift is held, on any hover, or never. */
  mode: () => WordHintMode
}

export class WordHover {
  private readonly card: HTMLElement
  private current: Hit | undefined
  private readonly answers = new Map<string, Answer | 'pending'>()
  private hideTimer: number | undefined
  private frame = 0
  private lastPoint: Point | undefined

  constructor(private readonly options: WordHoverOptions) {
    // A pure tooltip: the pointer passes through it to the text underneath,
    // so it never blocks the next word.
    this.card = el('div', { class: 'word-card', role: 'tooltip', hidden: true })
    options.host.append(this.card)
    options.area.addEventListener('pointermove', event => this.onMove(event), { passive: true })
    options.area.addEventListener('pointerleave', () => this.scheduleHide())
    window.addEventListener('scroll', () => this.hide(), { passive: true })
    window.addEventListener('blur', () => this.hide())
    // Shift pressed while the pointer rests on a word shows the card at once; released, the card goes.
    window.addEventListener('keydown', event => {
      if (event.key !== 'Shift' || event.repeat || !this.lastPoint) return
      this.lastPoint = { ...this.lastPoint, shift: true }
      this.probe(this.lastPoint)
    })
    window.addEventListener('keyup', event => {
      if (event.key !== 'Shift') return
      if (this.lastPoint) this.lastPoint = { ...this.lastPoint, shift: false }
      if (this.options.mode() === 'shift') this.hide()
    })
  }

  /** An answer from the dictionary; shown when it is for the word under the pointer. */
  onGloss(answer: Answer): void {
    const key = answer.word.toLowerCase()
    this.answers.set(key, answer)
    if (this.current && this.current.word.toLowerCase() === key) this.render()
    if (answer.missing && PASSING.has(answer.missing)) this.answers.delete(key)
  }

  /** The language pair changed, or a dictionary arrived: earlier answers no longer hold. */
  forget(): void {
    this.answers.clear()
    const word = this.current?.word
    if (!word) return
    this.answers.set(word.toLowerCase(), 'pending')
    this.options.post({ type: 'lookup', word })
    this.render()
  }

  /** Drops the card when the text it points at was redrawn. */
  refresh(): void {
    if (this.current && !this.current.range.startContainer.isConnected) this.hide()
  }

  hide(): void {
    this.cancelHide()
    this.current = undefined
    this.card.hidden = true
    highlights()?.delete(HIGHLIGHT)
  }

  private onMove(event: PointerEvent): void {
    if (event.pointerType === 'touch') return
    this.lastPoint = { x: event.clientX, y: event.clientY, shift: event.shiftKey }
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (this.lastPoint) this.probe(this.lastPoint)
    })
  }

  private probe(point: Point): void {
    const mode = this.options.mode()
    if (this.options.blocked() || mode === 'off' || (mode === 'shift' && !point.shift)) {
      this.hide()
      return
    }
    const hit = wordAtPoint(point.x, point.y)
    if (!hit) {
      this.scheduleHide()
      return
    }
    this.cancelHide()
    const same =
      this.current &&
      this.current.range.startContainer === hit.range.startContainer &&
      this.current.range.startOffset === hit.range.startOffset
    if (same) return
    this.current = hit
    const registry = highlights()
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (registry && HighlightCtor) registry.set(HIGHLIGHT, new HighlightCtor(hit.range))
    const key = hit.word.toLowerCase()
    if (!this.answers.has(key)) {
      this.answers.set(key, 'pending')
      this.options.post({ type: 'lookup', word: hit.word })
    }
    this.render()
  }

  private render(): void {
    const hit = this.current
    if (!hit) return
    const answer = this.answers.get(hit.word.toLowerCase())
    const gloss: Gloss | undefined = answer && answer !== 'pending' ? answer.gloss : undefined
    const lower = hit.word.toLowerCase()
    const leadsWithBase = gloss && gloss.base !== lower
    const head = el(
      'div',
      { class: 'wc-head' },
      el('span', { class: 'wc-word' }, leadsWithBase ? gloss.base : hit.word),
      leadsWithBase ? el('span', { class: 'wc-form' }, `from ${hit.word}`) : null,
    )
    const sense = ([pos, translations]: [string, string]) =>
      el('div', { class: 'wc-sense' }, el('span', { class: 'wc-pos' }, pos), ` ${translations}`)
    let body: HTMLElement[]
    if (!answer || answer === 'pending') body = [el('div', { class: 'wc-note' }, '…')]
    else if (answer.missing && answer.missing !== 'not-found') body = [el('div', { class: 'wc-note' }, this.note(answer.missing))]
    else if (!gloss) body = [el('div', { class: 'wc-note' }, 'Not in the dictionary.')]
    else
      body = gloss.entries.flatMap((entry, i) =>
        i === 0
          ? entry.senses.map(sense)
          : [el('div', { class: 'wc-also' }, entry.form), ...entry.senses.map(sense)],
      )
    this.card.replaceChildren(head, ...body)
    this.card.hidden = false
    this.place(hit.rect)
  }

  private note(missing: GlossMissing): string {
    const pair = `English → ${this.options.nativeName()}`
    switch (missing) {
      case 'not-english':
        return `Word meanings are for English only, for now; tap the sentence for its ${this.options.nativeName()} translation.`
      case 'no-dictionary':
        return `No ${pair} dictionary yet; tap the sentence for its translation.`
      case 'downloading':
        return `Downloading the ${pair} dictionary, once…`
      case 'download-failed':
        return `Couldn't download the ${pair} dictionary. Check the internet connection; it tries again in a minute.`
      case 'download-off':
        return `The ${pair} dictionary isn't downloaded: languageTutor.downloadDictionaries is off.`
      default:
        return ''
    }
  }

  /**
   * Above the word, over lines already read, so the next words stay free to
   * hover; below it only when there is no room above (under the header).
   */
  private place(rect: DOMRect): void {
    const card = this.card
    const width = Math.min(300, window.innerWidth - 16)
    card.style.width = `${width}px`
    const left = Math.max(8, Math.min(rect.left - 8, window.innerWidth - width - 8))
    card.style.left = `${left}px`
    const height = card.offsetHeight
    const headerBottom = document.querySelector('.bar')?.getBoundingClientRect().bottom ?? 0
    const above = rect.top - height - 6
    card.style.top = `${above >= headerBottom + 4 ? above : rect.bottom + 6}px`
  }

  private scheduleHide(): void {
    if (this.hideTimer !== undefined || !this.current) return
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = undefined
      this.hide()
    }, HIDE_DELAY_MS)
  }

  private cancelHide(): void {
    if (this.hideTimer !== undefined) window.clearTimeout(this.hideTimer)
    this.hideTimer = undefined
  }
}
