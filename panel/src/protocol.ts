// Messages between the extension host and the Tutor webviews: the side panel,
// and a document tab that shows one plan or one text the person picked.
import type { Gloss } from './lemma'
import type { BlockState, ExchangeKind } from './session'
import type { TutorSettings } from './render'

export type { TutorSettings, BlockState, ExchangeKind, Gloss }

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
      usage: Usage
      empty: EmptyReason
      config: ViewConfig
    }
  /** A document tab: the one exchange it shows; none while the plugin is still asked for it (`pending`) or once it left the history. */
  | { type: 'document'; exchange: ViewExchange | undefined; pending?: boolean; settings: TutorSettings; config: ViewConfig }
  /** `platform` is Node's name for the system (win32, darwin, linux), for the steps to add a voice. */
  | { type: 'hostVoices'; voices: HostVoice[]; canSpeak: boolean; platform: string }
  | { type: 'progress'; id: number; pos: number; len: number }
  | { type: 'speakDone'; id: number }
  | { type: 'gloss'; word: string; gloss?: Gloss; missing?: GlossMissing }
  /** A dictionary finished downloading: words asked while it ran can be asked again. */
  | { type: 'dictReady' }

export type ToHost =
  | { type: 'lookup'; word: string }
  | { type: 'ready' }
  | { type: 'speak'; id: number; items: string[]; lang: string; separator: string }
  | { type: 'stop' }
  | { type: 'setSettings'; patch: Partial<TutorSettings> }
  | { type: 'setVoiceConfig'; voice?: string; rate?: number }
  | { type: 'openSpeechSettings' }
  | { type: 'translate'; ref: string }
  | { type: 'clear' }
  /** Opens an aside (a plan, a picked text) in its own editor tab. */
  | { type: 'openDocument'; id: string }
