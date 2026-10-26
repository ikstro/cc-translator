// The natural voices: Kokoro-82M, run on this computer once downloaded. They
// read English only; the setting `languageTutor.voice` names one as
// "natural:<id>", and "Automatic" (empty) means Heart once the voice is here
// (owner, 2026-10-26: a female voice by default).

export const NATURAL_PREFIX = 'natural:'

export type NaturalVoice = { id: string; name: string; accent: 'US' | 'UK'; gender: 'female' | 'male' }

/** The voices shipped in the download, best first (Kokoro's own grades). */
export const NATURAL_VOICES: readonly NaturalVoice[] = [
  { id: 'af_heart', name: 'Heart', accent: 'US', gender: 'female' },
  { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'female' },
  { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'female' },
  { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'male' },
  { id: 'bm_george', name: 'George', accent: 'UK', gender: 'male' },
]

export const DEFAULT_NATURAL = 'af_heart'

/** What the natural voice is doing on this computer; `size` is the download in MB. */
export type NaturalState = {
  status: 'unsupported' | 'absent' | 'downloading' | 'ready' | 'failed'
  /** 0..1 while downloading. */
  progress: number
  size: number
  /** The person closed the offer above the list. */
  dismissed: boolean
}

export function naturalLabel(v: NaturalVoice): string {
  return `${v.name} · ${v.accent} · ${v.gender}`
}

/** The natural voice the setting asks for: Heart for "Automatic", none for a system voice's name. */
export function chosenNatural(setting: string): NaturalVoice | undefined {
  if (!setting) return NATURAL_VOICES.find(v => v.id === DEFAULT_NATURAL)
  if (!setting.startsWith(NATURAL_PREFIX)) return undefined
  const id = setting.slice(NATURAL_PREFIX.length)
  return NATURAL_VOICES.find(v => v.id === id) ?? NATURAL_VOICES.find(v => v.id === DEFAULT_NATURAL)
}

/** The system voice the setting names, or '' when it names a natural voice or none. */
export function systemVoiceName(setting: string): string {
  return setting.startsWith(NATURAL_PREFIX) ? '' : setting
}

/** eSpeak's accent for a voice: American for "a…" voices, British for "b…". */
export function espeakLanguage(voiceId: string): 'en-us' | 'en' {
  return voiceId.startsWith('b') ? 'en' : 'en-us'
}
