// Reads sentences aloud, one element at a time, and highlights the sentence
// being read and the word being spoken. Three routes: the natural voice
// (audio made in the extension host's voice process, played here, words timed
// by the model), the webview's own voices (word boundaries come from the
// speech events) or the platform synthesizer in the extension host (word
// positions come back as progress messages).

import { SAMPLE_RATE } from '../kokoro'
import type { ToHost, WordTime } from '../protocol'
import { itemAt, locate, wordAt } from '../textmap'

const SEPARATOR = '\n\n'
const WORD_HIGHLIGHT = 'tutor-word'
/** How often the natural voice's highlight follows the audio; a timer, so it keeps going while the view is hidden. */
const FOLLOW_MS = 40

type Item = { el: HTMLElement; text: string; nodes: Text[]; lengths: number[] }

/** A sentence of the natural voice queued in the audio output, from `at` to `end` on its clock. */
type Scheduled = { index: number; at: number; end: number; words: WordTime[]; source: AudioBufferSourceNode }

export type PlayerEnv = {
  /** BCP-47 tag of the language being read. */
  lang: () => string
  /** The webview voice to use, or undefined to use the host's synthesizer. */
  voice: () => SpeechSynthesisVoice | undefined
  rate: () => number
  hostCanSpeak: () => boolean
  /** The natural voice to read with, by id, or undefined for a system voice. */
  natural: () => string | undefined
  /** The view's audio output; undefined until the person has touched the view (browsers start audio on a gesture). */
  audio: () => AudioContext | undefined
  /** The natural voice failed; the rest is read by a system voice. */
  naturalFailed: (message: string) => void
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
  private route: 'natural' | 'web' | 'host' | null = null
  private hostId = 0
  private utterance: SpeechSynthesisUtterance | undefined
  // The natural voice: sentences that arrived and wait their turn, those queued in the audio output.
  private audio: AudioContext | undefined
  private arrived = new Map<number, { samples: Float32Array; words: WordTime[] }>()
  private scheduled: Scheduled[] = []
  private nextIndex = 0
  private endAt = 0
  private follower: number | undefined
  private lastWord = ''

  constructor(
    private readonly post: (message: ToHost) => void,
    private readonly env: PlayerEnv,
    private readonly onChange: () => void,
  ) {}

  /**
   * Starts reading `els`; returns false when there is nothing to read or no
   * voice to read it with. `system` skips the natural voice.
   */
  play(key: string, els: readonly HTMLElement[], options: { follow?: boolean; system?: boolean } = {}): boolean {
    this.stop()
    const items = els.map(textItem).filter(item => item.text.trim().length > 0)
    if (items.length === 0) return false
    const natural = options.system ? undefined : this.env.natural()
    const audio = natural ? this.env.audio() : undefined
    const voice = this.env.voice()
    if (natural && audio) this.route = 'natural'
    else if (voice) this.route = 'web'
    else if (this.env.hostCanSpeak()) this.route = 'host'
    else return false
    this.key = key
    this.items = items
    this.follow = options.follow ?? false
    if (this.route === 'natural' && natural && audio) this.speakNatural(natural, audio)
    else if (this.route === 'web' && voice) this.speakWeb(0, voice)
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
    if (route === 'host' || route === 'natural') this.post({ type: 'stop' })
    this.onChange()
  }

  onNaturalAudio(id: number, index: number, samples: Float32Array, words: WordTime[]): void {
    if (this.route !== 'natural' || id !== this.hostId) return
    this.arrived.set(index, { samples, words })
    this.queueArrived()
  }

  /** The natural voice failed: a system voice reads on from the sentence it had reached. */
  onNaturalFailed(id: number, message: string): void {
    if (this.route !== 'natural' || id !== this.hostId) return
    const from = Math.max(0, this.index)
    const key = this.key
    const els = this.items.slice(from).map(item => item.el)
    const follow = this.follow
    this.reset()
    this.env.naturalFailed(message)
    if (!key || !this.play(key, els, { follow, system: true })) this.onChange()
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
    for (const s of this.scheduled) {
      try {
        s.source.stop()
      } catch {
        // not started yet, or already over
      }
    }
    this.scheduled = []
    this.arrived.clear()
    window.clearInterval(this.follower)
    this.follower = undefined
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

  private speakNatural(voice: string, audio: AudioContext): void {
    this.hostId += 1
    this.audio = audio
    this.nextIndex = 0
    this.endAt = 0
    this.lastWord = ''
    if (audio.state === 'suspended') void audio.resume()
    this.enter(0)
    this.post({ type: 'speakNatural', id: this.hostId, items: this.items.map(item => item.text), voice, rate: this.env.rate() })
    this.follower = window.setInterval(() => this.followAudio(), FOLLOW_MS)
  }

  /** Queues the sentences that arrived, in order, each starting where the one before ends. */
  private queueArrived(): void {
    const audio = this.audio
    if (!audio) return
    for (let next = this.arrived.get(this.nextIndex); next; next = this.arrived.get(this.nextIndex)) {
      this.arrived.delete(this.nextIndex)
      const buffer = audio.createBuffer(1, Math.max(1, next.samples.length), SAMPLE_RATE)
      buffer.copyToChannel(next.samples as Float32Array<ArrayBuffer>, 0)
      const source = audio.createBufferSource()
      source.buffer = buffer
      source.connect(audio.destination)
      const at = Math.max(audio.currentTime + 0.05, this.endAt)
      source.start(at)
      this.scheduled.push({ index: this.nextIndex, at, end: at + buffer.duration, words: next.words, source })
      this.endAt = at + buffer.duration
      this.nextIndex += 1
    }
  }

  /** Moves the highlight with the audio, tells the host which sentence plays, and ends after the last one. */
  private followAudio(): void {
    const audio = this.audio
    if (this.route !== 'natural' || !audio) return
    const t = audio.currentTime
    const current = this.scheduled.find(s => t >= s.at && t < s.end)
    if (current) {
      if (current.index !== this.index) {
        this.enter(current.index)
        this.post({ type: 'naturalAt', id: this.hostId, index: current.index })
      }
      const item = this.items[current.index]
      const word = current.words.find(w => t - current.at >= w.at && t - current.at < w.until)
      const mark = word ? `${current.index}:${word.start}` : ''
      if (word && item && mark !== this.lastWord) {
        this.lastWord = mark
        this.highlight(item, word.start, word.length)
      }
    } else if (this.nextIndex >= this.items.length && t >= this.endAt) {
      this.finish()
    }
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
