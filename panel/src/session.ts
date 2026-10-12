// Turns one session's file into exchanges: a prompt the person typed and
// Claude's replies until the next prompt, each with its tutor result state.
// A plan Claude presented or a text the person picked is an exchange of its
// own (`kind`), shown in a document tab rather than in the panel's flow.

import type { FeedEntry } from './render'

export type BlockState = 'done' | 'translating' | 'untranslated' | 'failed'

export type ExchangeKind = 'plan' | 'selection'

export type Exchange = {
  id: string
  ts: string
  user?: FeedEntry
  replies: FeedEntry[]
  kind?: ExchangeKind
}

export type Results = {
  tutor: Map<string, FeedEntry>
  paired: Map<string, FeedEntry>
  status: Map<string, FeedEntry>
  usage: { input: number; output: number; calls: number }
}

function kindOf(origin: string | undefined): ExchangeKind | undefined {
  return origin === 'plan' || origin === 'selection' ? origin : undefined
}

export function groupExchanges(entries: readonly FeedEntry[]): Exchange[] {
  const exchanges: Exchange[] = []
  let current: Exchange | undefined
  for (const e of entries) {
    if (e.role === 'user' && typeof e.text === 'string') {
      current = { id: e.id ?? e.ts, ts: e.ts, user: e, replies: [] }
      exchanges.push(current)
    } else if (e.role === 'assistant' && typeof e.text === 'string') {
      const kind = kindOf(e.origin)
      if (kind) {
        // An aside: its own exchange, while the replies that follow still belong to the prompt.
        exchanges.push({ id: e.id ?? e.ts, ts: e.ts, replies: [e], kind })
        continue
      }
      if (!current) {
        current = { id: e.id ?? e.ts, ts: e.ts, replies: [] }
        exchanges.push(current)
      }
      current.replies.push(e)
    }
  }
  return exchanges
}

export function indexResults(entries: readonly FeedEntry[]): Results {
  const results: Results = { tutor: new Map(), paired: new Map(), status: new Map(), usage: { input: 0, output: 0, calls: 0 } }
  for (const e of entries) {
    if (e.role === 'tutor' && e.ref) results.tutor.set(e.ref, e)
    else if (e.role === 'paired' && e.ref) results.paired.set(e.ref, e)
    else if (e.role === 'status' && e.ref) results.status.set(e.ref, e)
    else if (e.role === 'usage') {
      results.usage.input += e.input ?? 0
      results.usage.output += e.output ?? 0
      results.usage.calls += 1
    }
  }
  return results
}

const STUCK_MS = 3 * 60 * 1000

/** Where an entry's translation stands: in, running, failed, or not asked for yet. */
export function stateOf(id: string, results: Results, now: number): { state: BlockState; note?: string } {
  if (results.tutor.has(id) || results.paired.has(id)) return { state: 'done' }
  const status = results.status.get(id)
  if (status?.state === 'translating' && now - Date.parse(status.ts) < STUCK_MS) return { state: 'translating' }
  if (status?.state === 'failed') return { state: 'failed', note: status.note }
  return { state: 'untranslated' }
}

/** A one-line title for the history list: the first sentence, without markdown, at most 90 characters. */
export function titleOf(text: string): string {
  let inFence = false
  let firstLine = ''
  for (const raw of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      continue
    }
    const line = raw.split(' ||| ')[0]?.trim() ?? ''
    if (!inFence && line.length > 0) {
      firstLine = line
      break
    }
  }
  const plain = firstLine.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '').replace(/[*_`~]/g, '').trim()
  return plain.length > 90 ? plain.slice(0, 89).trimEnd() + '…' : plain
}

/** How an aside is labelled: in the history list and on its tab. */
export function kindLabel(kind: ExchangeKind): string {
  return kind === 'plan' ? 'Plan' : 'Text'
}
