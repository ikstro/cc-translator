// Maps a character offset in the text a voice is reading back to the word it
// falls in, so the panel can highlight that word. Pure, so it is testable
// without a DOM: the webview hands it the lengths of the text nodes.

export type Span = { node: number; start: number; end: number }

/** The word around `index` in `text`: from the last word start at or before it to the end of the word. */
export function wordAt(text: string, index: number, length = 0): { start: number; end: number } | undefined {
  if (index < 0 || index >= text.length) return undefined
  let start = index
  while (start > 0 && isWordChar(text[start - 1] ?? '')) start--
  let end = length > 0 ? index + length : index
  while (end < text.length && isWordChar(text[end] ?? '')) end++
  if (end <= start) return undefined
  return { start, end }
}

function isWordChar(c: string): boolean {
  return /[\p{L}\p{N}'’_-]/u.test(c)
}

/**
 * Splits a [start, end) range of the concatenated text into per-node pieces,
 * given each text node's length in order.
 */
export function locate(lengths: readonly number[], start: number, end: number): Span[] {
  const spans: Span[] = []
  let offset = 0
  lengths.forEach((len, node) => {
    const nodeStart = offset
    const nodeEnd = offset + len
    offset = nodeEnd
    const s = Math.max(start, nodeStart)
    const e = Math.min(end, nodeEnd)
    if (e > s) spans.push({ node, start: s - nodeStart, end: e - nodeStart })
  })
  return spans
}

/** For the host voice: which item a position in the joined text falls in, and the offset inside it. */
export function itemAt(itemLengths: readonly number[], separator: number, pos: number): { item: number; offset: number } | undefined {
  let start = 0
  for (let i = 0; i < itemLengths.length; i++) {
    const len = itemLengths[i] ?? 0
    if (pos >= start && pos < start + len) return { item: i, offset: pos - start }
    start += len + separator
  }
  return undefined
}
