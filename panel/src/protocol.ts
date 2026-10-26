// Messages between the extension host and the Tutor webviews: the side panel,
// and a document tab that shows one plan or one text the person picked.
import type { WordTime } from './kokoro'
import type { Gloss } from './lemma'
import type { NaturalState } from './natural'
import type { BlockState, ExchangeKind } from './session'
import type { TutorSettings } from './render'
import type { LearningState } from './learner'
import type { UsageSummary } from './usage'

export type { TutorSettings, BlockState, ExchangeKind, Gloss, LearningState, NaturalState, UsageSummary, WordTime }

export type ViewBlock = {
  id: string
  role: 'user' | 'assistant'
  html: string
  state: BlockState
  note?: string
  /** For the person's message: what the tutor made of it. */
  tutor?: 'translation' | 'correction' | 'correct'
}

export type ViewExchange = {
  id: string
  ts: string
  title: string
  blocks: ViewBlock[]
  /** An aside rather than a turn of the conversation: a plan Claude presented, a text the person picked. */
  kind?: ExchangeKind
}

/** When the word card shows: while Shift is held over a word, on any hover, or never. */
export type WordHintMode = 'shift' | 'hover' | 'off'

export type ViewConfig = { voice: string; rate: number; wordHint: WordHintMode }

export type HostVoice = { name: string; lang: string }

/**
 * Why a word has no meanings: the learned language is not English (only
 * English has dictionaries), no dictionary exists for the person's language,
 * it is being downloaded, the download failed or is turned off, or the word
 * is not in it.
 */
export type GlossMissing = 'not-english' | 'no-dictionary' | 'downloading' | 'download-failed' | 'download-off' | 'not-found'

export type Usage = { input: number; output: number; calls: number }

/** Why the list is empty while the tutor is on. */
export type EmptyReason = 'no-session' | undefined

export type ToView =
  | {
      type: 'session'
      exchanges: ViewExchange[]
      settings: TutorSettings
      /** This session's tutor calls. */
      usage: Usage
      /** Tutor tokens today, 7 and 30 days, and per project. */
      totals: UsageSummary
      /** Whether this window learns, another one does, or none (the tutor is off). */
      learning: LearningState
      /** This window's first folder, to mark its row among the projects. */
      project: string
      empty: EmptyReason
      config: ViewConfig
    }
  /** A document tab: the one exchange it shows; none while the plugin is still asked for it (`pending`) or once it left the history. */
  | { type: 'document'; exchange: ViewExchange | undefined; pending?: boolean; settings: TutorSettings; config: ViewConfig }
  /** `platform` is Node's name for the system (win32, darwin, linux), for the steps to add a voice. */
  | { type: 'hostVoices'; voices: HostVoice[]; canSpeak: boolean; platform: string }
  | { type: 'progress'; id: number; pos: number; len: number }
  | { type: 'speakDone'; id: number }
  /** The "Stop speaking" command. */
  | { type: 'stop' }
  | { type: 'gloss'; word: string; gloss?: Gloss; missing?: GlossMissing }
  /** A dictionary finished downloading: words asked while it ran can be asked again. */
  | { type: 'dictReady' }
  | { type: 'natural'; state: NaturalState }
  /** One sentence of reading `id` in the natural voice: 24 kHz audio and when each of its words is spoken. */
  | { type: 'naturalAudio'; id: number; index: number; samples: Float32Array; words: WordTime[] }
  | { type: 'naturalFailed'; id: number; message: string }

export type ToHost =
  | { type: 'lookup'; word: string }
  | { type: 'ready' }
  | { type: 'speak'; id: number; items: string[]; lang: string; separator: string }
  /** Reads `items` in a natural voice; `naturalAt` says which of them started playing, so the next ones get made. */
  | { type: 'speakNatural'; id: number; items: string[]; voice: string; rate: number }
  | { type: 'naturalAt'; id: number; index: number }
  | { type: 'downloadNatural' }
  /** The person closed the offer of the natural voice. */
  | { type: 'dismissNatural' }
  | { type: 'stop' }
  | { type: 'setSettings'; patch: Partial<TutorSettings> }
  /** On: this window's project learns (any other window stops). Off: the tutor is off everywhere. */
  | { type: 'setLearning'; on: boolean }
  | { type: 'setVoiceConfig'; voice?: string; rate?: number }
  | { type: 'openSpeechSettings' }
  | { type: 'translate'; ref: string }
  | { type: 'clear' }
  /** Opens an aside (a plan, a picked text) in its own editor tab. */
  | { type: 'openDocument'; id: string }
