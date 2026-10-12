// Cuts an assistant reply into translation units and puts the translations
// back as `sentence ||| translation` lines, the format the Tutor panel reads.
// Code fences and table rows pass through untouched. A list item, heading or
// quote line is one unit; a plain paragraph line is split into sentences, one
// per line, which markdown still renders as the same paragraph.

export const MARK = ' ||| '
const FENCE = /^\s*(```|~~~)/
const TABLE = /^\s*\|/
const PREFIX = /^(\s*(?:(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+|>\s*)+)?(.*)$/s
// A sentence ends at . ! ? … before a space and a capital (any script), a
// digit, an opening quote or bracket, or a letter of a script without case
// (Chinese, Arabic, Hebrew, Thai…); or right after a full-width 。！？.
const SENTENCE_BREAK = /(?<=[.!?…])\s+(?=[\p{Lu}\p{Lo}\p{N}"'«„“(\[*_`])|(?<=[。！？])\s*(?=\S)/u
// Abbreviations whose dot ends no sentence; protected before the split.
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|cf|approx|Mr|Mrs|Ms|Dr|No|St)\./g
const DOT = '\u0001'

function splitSentences(body: string): string[] {
  const protectedBody = body.replace(ABBREVIATIONS, m => m.replace(/\./g, DOT))
  return protectedBody
    .split(SENTENCE_BREAK)
    .map(s => s.replace(new RegExp(DOT, 'g'), '.').trim())
    .filter(Boolean)
}

export type Unit =
  | { kind: 'raw'; text: string }
  | { kind: 'unit'; prefix: string; body: string }

export function splitPrefix(raw: string): { prefix: string; body: string } {
  const m = PREFIX.exec(raw)
  return { prefix: m?.[1] ?? '', body: m?.[2] ?? raw }
}

export function splitUnits(text: string): Unit[] {
  const units: Unit[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence
      units.push({ kind: 'raw', text: line })
      continue
    }
    if (inFence || line.trim().length === 0 || line.includes(MARK) || TABLE.test(line)) {
      units.push({ kind: 'raw', text: line })
      continue
    }
    const { prefix, body } = splitPrefix(line)
    const sentences = prefix ? [body] : splitSentences(body)
    if (sentences.length <= 1) {
      units.push({ kind: 'unit', prefix, body })
      continue
    }
    for (const sentence of sentences) units.push({ kind: 'unit', prefix: '', body: sentence })
  }
  return units
}

/** The translatable sentences, in order; the index is the number sent to the model. */
export function sentencesOf(units: Unit[]): string[] {
  return units.filter((u): u is Extract<Unit, { kind: 'unit' }> => u.kind === 'unit').map(u => u.body)
}

/**
 * Consecutive groups of sentences, each at most `maxChars` long together
 * (a longer sentence is a group of its own): one model call per group, the
 * results joined back in order.
 */
export function batches(sentences: readonly string[], maxChars: number): string[][] {
  const out: string[][] = []
  let group: string[] = []
  let size = 0
  for (const sentence of sentences) {
    if (group.length > 0 && size + sentence.length > maxChars) {
      out.push(group)
      group = []
      size = 0
    }
    group.push(sentence)
    size += sentence.length
  }
  if (group.length > 0) out.push(group)
  return out
}

/** Reads `N. translation` lines back into an array by number (1-based). */
export function parseNumbered(reply: string, count: number): (string | undefined)[] {
  const out: (string | undefined)[] = new Array(count).fill(undefined)
  for (const line of reply.split('\n')) {
    const m = /^\s*(\d+)[.)]\s+(.*\S)\s*$/.exec(line)
    if (!m) continue
    const index = Number(m[1]) - 1
    if (index >= 0 && index < count && out[index] === undefined) out[index] = m[2]
  }
  return out
}

/**
 * Reads the tutor's reply: the `LANG:` line says which language the reply
 * was written in, the numbered lines are the other side of each sentence.
 */
export function parseTranslateReply(reply: string, count: number): { lang: 'target' | 'native'; translations: (string | undefined)[] } {
  const head = /^\s*LANG:\s*(target|native)\b/im.exec(reply)
  const lang = head?.[1]?.toLowerCase() === 'native' ? 'native' : 'target'
  return { lang, translations: parseNumbered(reply, count) }
}

/**
 * Builds `learned ||| native` lines. When the reply was written in the
 * learner's native language (`flip`), the tutor's sentence in the learned
 * language goes on the left and the original on the right, so the left side
 * is always the language being learned.
 */
/**
 * A text in a third language (neither learned nor native): the tutor gave
 * each sentence as `learned ||| native`, which replaces the sentence. A
 * missing line keeps the original sentence, untranslated.
 */
export function assembleBoth(units: Unit[], pairs: readonly (string | undefined)[]): string {
  let i = 0
  const lines = units.map(u => {
    if (u.kind === 'raw') return u.text
    const [target = '', native = ''] = (pairs[i++] ?? '').split(/\s*\|\|\|\s*/).map(side => side.trim())
    if (!target) return `${u.prefix}${u.body}`
    return native ? `${u.prefix}${target}${MARK}${native}` : `${u.prefix}${target}`
  })
  return lines.join('\n')
}

/** The two sides of `learned ||| native` lines, for checking each language. */
export function sidesOf(pairs: readonly (string | undefined)[]): { targets: (string | undefined)[]; natives: (string | undefined)[] } {
  const split = pairs.map(p => (p ?? '').split(/\s*\|\|\|\s*/))
  return { targets: split.map(s => s[0] || undefined), natives: split.map(s => s[1] || undefined) }
}

export function assemblePaired(units: Unit[], translations: readonly (string | undefined)[], flip = false): string {
  let i = 0
  const lines = units.map(u => {
    if (u.kind === 'raw') return u.text
    const other = translations[i++]
    const clean = other?.replace(/\s*\|\|\|\s*/g, ' ').trim()
    if (!clean) return `${u.prefix}${u.body}`
    return flip ? `${u.prefix}${clean}${MARK}${u.body}` : `${u.prefix}${u.body}${MARK}${clean}`
  })
  return lines.join('\n')
}
