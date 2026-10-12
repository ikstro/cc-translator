// Same line format as the Claude Code plugin (plugin/hooks/parse.ts):
//   <sentence in the target language> ||| <translation in the native language>
// Code fences are passed through untouched, whatever they contain.

export const MARK = ' ||| '
const FENCE = /^\s*(```|~~~)/

export type Segment = { en: string; ru?: string; code: boolean }
export type FenceState = { inFence: boolean }

export function splitLine(raw: string): { en: string; ru?: string } {
  const at = raw.indexOf(MARK)
  if (at < 0) return { en: raw }
  return { en: raw.slice(0, at).trimEnd(), ru: raw.slice(at + MARK.length).trim() }
}

export function parseLines(
  text: string,
  state: FenceState = { inFence: false },
): { segments: Segment[]; state: FenceState } {
  const segments: Segment[] = []
  let inFence = state.inFence
  for (const raw of text.split('\n')) {
    if (FENCE.test(raw)) {
      inFence = !inFence
      segments.push({ en: raw, code: true })
      continue
    }
    if (inFence) {
      segments.push({ en: raw, code: true })
      continue
    }
    const { en, ru } = splitLine(raw)
    segments.push(ru === undefined ? { en, code: false } : { en, ru, code: false })
  }
  return { segments, state: { inFence } }
}
