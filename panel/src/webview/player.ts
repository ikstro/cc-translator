// Reads sentences aloud, one element at a time, and highlights the sentence
// being read and the word being spoken. Two routes: the webview's own voices
// (word boundaries come from the speech events) or the platform synthesizer
// in the extension host (word positions come back as progress messages).

import type { ToHost } from '../protocol'
import { itemAt, locate, wordAt } from '../textmap'

const SEPARATOR = '\n\n'
const WORD_HIGHLIGHT = 'tutor-word'

type Item = { el: HTMLElement; text: string; nodes: Text[]; lengths: number[] }

export type PlayerEnv = {
  /** BCP-47 tag of the language being read. */
  lang: () => string
  /** The webview voice to use, or undefined to use the host's synthesizer. */
  voice: () => SpeechSynthesisVoice | undefined
  rate: () => number
  hostCanSpeak: () => boolean
}

function textItem(el: HTMLElement): Item {
  const nodes: Text[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: node =>
      node.parentElement?.closest('.tr, button, .codicon') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  })
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  const lengths = nodes.map(n => n.data.length)
  return { el, text: nodes.map(n => n.data).join(''), nodes, lengths }
}

type HighlightRegistryLike = { set(name: string, value: unknown): void; delete(name: string): void }

function registry(): HighlightRegistryLike | undefined {
  const css = (globalThis as unknown as { CSS?: { highlights?: HighlightRegistryLike } }).CSS
  return css?.highlights
}

function clearWord(): void {
  registry()?.delete(WORD_HIGHLIGHT)
}

export class Player {
  key: string | null = null
  private items: Item[] = []
  private index = -1
  private follow = false
  private route: 'web' | 'host' | null = null
  private hostId = 0
  private utterance: SpeechSynthesisUtterance | undefined

  constructor(
    private readonly post: (message: ToHost) => void,
    private readonly env: PlayerEnv,
    private readonly onChange: () => void,
  ) {}

  /** Starts reading `els`; returns false when there is nothing to read or no voice to read it with. */
  play(key: string, els: readonly HTMLElement[], options: { follow?: boolean } = {}): boolean {
    this.stop()
    const items = els.map(textItem).filter(item => item.text.trim().length > 0)
    if (items.length === 0) return false
    const voice = this.env.voice()
    if (voice) this.route = 'web'
    else if (this.env.hostCanSpeak()) this.route = 'host'
    else return false
    this.key = key
    this.items = items
    this.follow = options.follow ?? false
    if (this.route === 'web' && voice) this.speakWeb(0, voice)
    else this.speakHost()
    this.onChange()
    return true
  }

  stop(): void {
    if (!this.key) return
    const route = this.route
    this.reset()
    if (route === 'web') {
      this.utterance = undefined
      window.speechSynthesis.cancel()
    }
    if (route === 'host') this.post({ type: 'stop' })
    this.onChange()
  }

  /** The reader scrolled by hand: stop keeping the spoken sentence in view. */
  userScrolled(): void {
    this.follow = false
  }

  /** Whether `container` holds an element being read (its DOM is about to be replaced). */
  reads(container: Element): boolean {
    return this.items.some(item => container.contains(item.el))
  }

  onHostProgress(id: number, pos: number, len: number): void {
    if (this.route !== 'host' || id !== this.hostId) return
    const at = itemAt(
      this.items.map(item => item.text.length),
      SEPARATOR.length,
      pos,
    )
    if (!at) return
    if (at.item !== this.index) this.enter(at.item)
    const item = this.items[at.item]
    if (item) this.highlight(item, at.offset, len)
  }

  onHostDone(id: number): void {
    if (this.route === 'host' && id === this.hostId) this.finish()
  }

  private reset(): void {
    const current = this.items[this.index]
    current?.el.classList.remove('speaking')
    clearWord()
    this.key = null
    this.items = []
    this.index = -1
    this.route = null
  }

  private finish(): void {
    this.reset()
    this.utterance = undefined
    this.onChange()
  }

  private enter(index: number): void {
    this.items[this.index]?.el.classList.remove('speaking')
    clearWord()
    this.index = index
    const item = this.items[index]
    if (!item) return
    item.el.classList.add('speaking')
    if (this.follow) {
      const rect = item.el.getBoundingClientRect()
      if (rect.top < 48 || rect.bottom > window.innerHeight - 24) item.el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  private speakWeb(index: number, voice: SpeechSynthesisVoice): void {
    const item = this.items[index]
    if (!item) {
      this.finish()
      return
    }
    this.enter(index)
    const u = new SpeechSynthesisUtterance(item.text)
    u.voice = voice
    u.lang = voice.lang
    u.rate = this.env.rate()
    u.onboundary = event => {
      if (this.utterance !== u) return
      if (event.name && event.name !== 'word') return
      this.highlight(item, event.charIndex, event.charLength ?? 0)
    }
    u.onend = () => {
      if (this.utterance === u) this.speakWeb(index + 1, voice)
    }
    u.onerror = () => {
      if (this.utterance === u) this.finish()
    }
    this.utterance = u
    window.speechSynthesis.speak(u)
  }

  private speakHost(): void {
    this.hostId += 1
    this.enter(0)
    this.post({
      type: 'speak',
      id: this.hostId,
      items: this.items.map(item => item.text),
      lang: this.env.lang(),
      separator: SEPARATOR,
    })
  }

  private highlight(item: Item, index: number, length: number): void {
    const reg = registry()
    const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
    if (!reg || !HighlightCtor) return
    const word = wordAt(item.text, index, length)
    if (!word) return
    const pieces = locate(item.lengths, word.start, word.end)
    const first = pieces[0]
    const last = pieces[pieces.length - 1]
    if (!first || !last) return
    const startNode = item.nodes[first.node]
    const endNode = item.nodes[last.node]
    if (!startNode || !endNode || !startNode.isConnected) return
    const range = document.createRange()
    range.setStart(startNode, first.start)
    range.setEnd(endNode, last.end)
    reg.set(WORD_HIGHLIGHT, new HighlightCtor(range))
  }
}
