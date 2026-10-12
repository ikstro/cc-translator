import { marked } from 'marked'

import { scriptOf, type Script } from './languages'
import { parseLines, type Segment } from './parse'

/** The scripts of the learned and the native language, when they differ. */
export type Orientation = { target: Script; native: Script }

/**
 * Puts the learned language on the left of a pair. Older feed entries could
 * hold `native ||| learned` when Claude answered in the user's language;
 * where the two scripts differ that is visible, and the pair is turned round.
 */
export function orient(segment: Segment, o: Orientation | undefined): Segment {
  if (!o || segment.code || segment.ru === undefined) return segment
  if (scriptOf(segment.en) === o.native && scriptOf(segment.ru) === o.target) {
    const { prefix, body } = splitPrefix(segment.en)
    return { en: prefix + segment.ru, ru: body, code: false }
  }
  return segment
}

export type TutorSettings = {
  enabled: boolean
  level: 'off' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
  target: string
  native: string
  tutorModel: 'haiku' | 'sonnet'
  autoRead: boolean
}

export const DEFAULT_SETTINGS: TutorSettings = {
  enabled: false,
  level: 'B1',
  target: 'English',
  native: 'Russian',
  tutorModel: 'haiku',
  autoRead: false,
}

export type FeedEntry = {
  id?: string
  ts: string
  sessionId: string
  cwd: string
  role: 'user' | 'assistant' | 'tutor' | 'paired' | 'status' | 'usage' | 'meta'
  text?: string
  ref?: string
  kind?: 'correction' | 'translation' | 'howToSay'
  state?: 'translating' | 'failed'
  note?: string
  /** user: how the prompt arrived; assistant: `plan` for a plan Claude presented, `selection` for a text the person picked. */
  origin?: string
  input?: number
  output?: number
  settings?: Partial<TutorSettings>
}

export function normalizeSettings(raw: unknown): TutorSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof TutorSettings, unknown>>
  const levels = ['off', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']
  const isLang = (v: unknown): v is string => typeof v === 'string' && /^[\p{L}][\p{L} -]{0,29}$/u.test(v)
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SETTINGS.enabled,
    level:
      typeof r.level === 'string' && levels.includes(r.level) ? (r.level as TutorSettings['level']) : DEFAULT_SETTINGS.level,
    target: isLang(r.target) ? r.target : DEFAULT_SETTINGS.target,
    native: isLang(r.native) ? r.native : DEFAULT_SETTINGS.native,
    tutorModel: r.tutorModel === 'sonnet' ? 'sonnet' : 'haiku',
    autoRead: typeof r.autoRead === 'boolean' ? r.autoRead : DEFAULT_SETTINGS.autoRead,
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

// Markdown syntax that must stay outside the sentence span: list markers,
// heading hashes, blockquote arrows, task boxes.
const PREFIX = /^(\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s*)+)?(.*)$/s

function splitPrefix(raw: string): { prefix: string; body: string } {
  const m = PREFIX.exec(raw)
  return { prefix: m?.[1] ?? '', body: m?.[2] ?? raw }
}

const PLAY_BUTTON =
  '<button class="icon-btn play" data-play="sentence" aria-label="Listen" title="Listen"><i class="codicon codicon-play"></i></button>'

/**
 * The HTML for one message: markdown rendered as usual, every prose line
 * wrapped in a `span.s` the reader can tap. A translated line is followed by
 * its `span.tr`: the translation and a play button, hidden until the
 * sentence is tapped or every translation is shown. Prose is escaped first,
 * so the model's text never injects markup; fenced code is left to the
 * markdown renderer and is never read aloud.
 */
export function messageHtml(text: string, orientation?: Orientation): string {
  const { segments } = parseLines(text)
  const lines = segments.map(raw => {
    const segment = orient(raw, orientation)
    if (segment.code) return segment.en
    const { prefix, body } = splitPrefix(segment.en)
    if (body.trim().length === 0) return segment.en
    const sentence = `<span class="s" tabindex="0">${escapeHtml(body)}</span>`
    if (segment.ru === undefined || segment.ru.length === 0) return prefix + sentence
    const tr = `<span class="tr"><span class="tr-text">${escapeHtml(segment.ru)}</span>${PLAY_BUTTON}</span>`
    return prefix + sentence + tr
  })
  return marked.parse(lines.join('\n'), { gfm: true, breaks: false, async: false }) as string
}

/** A correction is shown as written (strikethrough and bold); "how to say it" lines become sentences to hear. */
export function tutorHtml(kind: 'correction' | 'howToSay', text: string): string {
  if (kind === 'correction') return marked.parse(escapeHtml(text), { gfm: true, breaks: true, async: false }) as string
  return messageHtml(text)
}

// Notes the IDE or the engine adds to a prompt (`<ide_opened_file>`,
// `<system-reminder>`, …); entries recorded before plugin 0.4.2 may hold them.
const MACHINE_BLOCKS =
  /<(ide_[a-z_]+|system-reminder|local-command-[a-z-]+|command-[a-z-]+|task-notification|user-prompt-submit-hook)\b[^>]*>[\s\S]*?<\/\1>/g

export function stripMachineBlocks(text: string): string {
  return text.replace(MACHINE_BLOCKS, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function userHtml(text: string): string {
  return `<p>${escapeHtml(stripMachineBlocks(text)).replace(/\n/g, '<br>')}</p>`
}

export function parseFeed(content: string): FeedEntry[] {
  const entries: FeedEntry[] = []
  for (const line of content.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as FeedEntry
      if (parsed && typeof parsed === 'object' && typeof parsed.role === 'string') entries.push(parsed)
    } catch {
      // a half-written last line: skipped until the next change
    }
  }
  return entries
}
