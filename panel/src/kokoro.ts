// Text preparation for the natural voice (Kokoro-82M): the text being read
// is cut at punctuation into pieces, each piece of words becomes phonemes
// (eSpeak NG, in the voice process), the phonemes become the model's token
// ids, and the durations the model returns for its tokens say when each word
// of the original text is spoken. The text rules follow kokoro-js
// (Apache-2.0, github.com/hexgrad/kokoro); pure, so the tests run it too.

export const SAMPLE_RATE = 24_000
/** The model reads at most 512 tokens, two of them the pads at either end. */
export const MAX_TOKENS = 510
/** A run of words without punctuation longer than this is cut at a space, so no piece outgrows the model. */
const MAX_PIECE_CHARS = 250

/** The model's tokens: one per phoneme symbol, punctuation mark or space. */
export const VOCAB: Readonly<Record<string, number>> = {
  ';': 1, ':': 2, ',': 3, '.': 4, '!': 5, '?': 6, '—': 9, '…': 10, '"': 11, '(': 12, ')': 13, '“': 14, '”': 15, ' ': 16,
  '̃': 17, 'ʣ': 18, 'ʥ': 19, 'ʦ': 20, 'ʨ': 21, 'ᵝ': 22, 'ꭧ': 23, A: 24, I: 25, O: 31, Q: 33, S: 35, T: 36, W: 39, Y: 41,
  'ᵊ': 42, a: 43, b: 44, c: 45, d: 46, e: 47, f: 48, h: 50, i: 51, j: 52, k: 53, l: 54, m: 55, n: 56, o: 57, p: 58, q: 59,
  r: 60, s: 61, t: 62, u: 63, v: 64, w: 65, x: 66, y: 67, z: 68, 'ɑ': 69, 'ɐ': 70, 'ɒ': 71, 'æ': 72, 'β': 75, 'ɔ': 76,
  'ɕ': 77, 'ç': 78, 'ɖ': 80, 'ð': 81, 'ʤ': 82, 'ə': 83, 'ɚ': 85, 'ɛ': 86, 'ɜ': 87, 'ɟ': 90, 'ɡ': 92, 'ɥ': 99, 'ɨ': 101,
  'ɪ': 102, 'ʝ': 103, 'ɯ': 110, 'ɰ': 111, 'ŋ': 112, 'ɳ': 113, 'ɲ': 114, 'ɴ': 115, 'ø': 116, 'ɸ': 118, 'θ': 119, 'œ': 120,
  'ɹ': 123, 'ɾ': 125, 'ɻ': 126, 'ʁ': 128, 'ɽ': 129, 'ʂ': 130, 'ʃ': 131, 'ʈ': 132, 'ʧ': 133, 'ʊ': 135, 'ʋ': 136, 'ʌ': 138,
  'ɣ': 139, 'ɤ': 140, 'χ': 142, 'ʎ': 143, 'ʒ': 147, 'ʔ': 148, 'ˈ': 156, 'ˌ': 157, 'ː': 158, 'ʰ': 162, 'ʲ': 164, '↓': 169,
  '→': 171, '↗': 172, '↘': 173, 'ᵻ': 177,
}

const PUNCTUATION = new Set(';:,.!?¡¿—…"«»“”(){}[]')
const WORD_CHAR = /[\p{L}\p{N}]/u

/** A stretch of the text being read: words, or punctuation with the spaces around it. Offsets into that text. */
export type Piece = { start: number; end: number; punct: boolean }

/**
 * Cuts the text into pieces of words and pieces of punctuation. A mark between
 * two letters or digits ("3.5", "e.g", "10:30") stays inside its word.
 */
export function piecesOf(text: string): Piece[] {
  const breaks = (i: number) => {
    const c = text[i] ?? ''
    if (!PUNCTUATION.has(c)) return false
    return !(WORD_CHAR.test(text[i - 1] ?? '') && WORD_CHAR.test(text[i + 1] ?? ''))
  }
  const pieces: Piece[] = []
  let wordsFrom = 0
  let i = 0
  while (i < text.length) {
    const c = text[i] ?? ''
    if (!breaks(i) && !/\s/.test(c)) {
      i++
      continue
    }
    // A run of spaces and marks: punctuation when it holds at least one mark.
    let j = i
    let marks = false
    while (j < text.length && (breaks(j) || /\s/.test(text[j] ?? ''))) {
      if (breaks(j)) marks = true
      j++
    }
    if (marks) {
      if (i > wordsFrom) pieces.push(...cutLong(text, wordsFrom, i))
      pieces.push({ start: i, end: j, punct: true })
      wordsFrom = j
    }
    i = j
  }
  if (text.length > wordsFrom) pieces.push(...cutLong(text, wordsFrom, text.length))
  return pieces.filter(p => p.punct || text.slice(p.start, p.end).trim().length > 0)
}

/** A piece of words longer than the limit, cut at spaces; the space between becomes a piece of its own. */
function cutLong(text: string, start: number, end: number): Piece[] {
  const out: Piece[] = []
  let from = start
  while (end - from > MAX_PIECE_CHARS) {
    const space = text.lastIndexOf(' ', from + MAX_PIECE_CHARS)
    const at = space > from ? space : from + MAX_PIECE_CHARS
    out.push({ start: from, end: at, punct: false })
    if (space > from) out.push({ start: at, end: at + 1, punct: true })
    from = space > from ? at + 1 : at
  }
  out.push({ start: from, end, punct: false })
  return out
}

function spellYear(token: string): string {
  if (token.includes('.')) return token
  if (token.includes(':')) {
    const [h, m] = token.split(':').map(Number)
    return m === 0 ? `${h} o'clock` : (m ?? 0) < 10 ? `${h} oh ${m}` : `${h} ${m}`
  }
  const year = parseInt(token.slice(0, 4), 10)
  if (year < 1100 || year % 1000 < 10) return token
  const left = token.slice(0, 2)
  const right = parseInt(token.slice(2, 4), 10)
  const s = token.endsWith('s') ? 's' : ''
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${s}`
    if (right < 10) return `${left} oh ${right}${s}`
  }
  return `${left} ${right}${s}`
}

function spellMoney(token: string): string {
  const unit = token[0] === '$' ? 'dollar' : 'pound'
  const amount = token.slice(1)
  if (Number.isNaN(Number(amount))) return `${amount} ${unit}s`
  if (!amount.includes('.')) return `${amount} ${unit}${amount === '1' ? '' : 's'}`
  const [whole, fraction = ''] = amount.split('.')
  const cents = parseInt(fraction.padEnd(2, '0'), 10)
  const small = token[0] === '$' ? (cents === 1 ? 'cent' : 'cents') : cents === 1 ? 'penny' : 'pence'
  return `${whole} ${unit}${whole === '1' ? '' : 's'} and ${cents} ${small}`
}

function spellDecimal(token: string): string {
  const [whole = '', fraction = ''] = token.split('.')
  return `${whole} point ${fraction.split('').join(' ')}`
}

/** Words as eSpeak should hear them: years, times, money, decimals and titles spelled out. */
export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/[^\S \n]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\bD[Rr]\.(?= [A-Z])/g, 'Doctor')
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, 'Mister')
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, 'Miss')
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, 'Mrs')
    .replace(/\betc\.(?! [A-Z])/gi, 'etc')
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, spellYear)
    .replace(/(?<=\d),(?=\d)/g, '')
    .replace(/[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi, spellMoney)
    .replace(/\d*\.\d+/g, spellDecimal)
    .replace(/(?<=\d)-(?=\d)/g, ' to ')
    .replace(/(?<=\d)S/g, ' S')
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, 's')
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, m => m.replace(/\./g, '-'))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, '-')
    .trim()
}

/** A piece of punctuation as the model reads it: quotes straightened, brackets dropped (as kokoro-js does), spaces kept as one. */
export function normalizePunct(text: string): string {
  return text
    .replace(/[“”«»]/g, '"')
    .replace(/[()[\]{}]/g, '')
    .replace(/\s+/g, ' ')
}

/** eSpeak's phonemes adjusted to the ones Kokoro was trained on. */
export function postPhonemes(phonemes: string, american: boolean): string {
  const out = phonemes
    .replace(/kəkˈoːɹoʊ/g, 'kˈoʊkəɹoʊ')
    .replace(/kəkˈɔːɹəʊ/g, 'kˈəʊkəɹəʊ')
    .replace(/ʲ/g, 'j')
    .replace(/r/g, 'ɹ')
    .replace(/x/g, 'k')
    .replace(/ɬ/g, 'l')
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, ' ')
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, 'z')
  return (american ? out.replace(/(?<=nˈaɪn)ti(?!ː)/g, 'di') : out).trim()
}

/** A piece with the phonemes the model reads for it. */
export type Spoken = { piece: Piece; phonemes: string }

/** One token, the piece it came from and which of that piece's phoneme words it is part of (-1: a space or a mark). */
export type Token = { id: number; piece: number; word: number }

export function tokensOf(spoken: readonly Spoken[]): Token[] {
  const tokens: Token[] = []
  spoken.forEach(({ piece, phonemes }, p) => {
    let word = -1
    let inWord = false
    for (const c of phonemes) {
      const id = VOCAB[c]
      const space = c === ' '
      if (!piece.punct && !space && !inWord) word++
      inWord = !piece.punct && !space
      if (id === undefined) continue
      tokens.push({ id, piece: p, word: inWord ? word : -1 })
    }
  })
  return tokens
}

/** Splits the tokens into runs the model can read in one call, cutting between pieces where it can. */
export function groupsOf(tokens: readonly Token[], max = MAX_TOKENS): Token[][] {
  const groups: Token[][] = []
  let current: Token[] = []
  let i = 0
  while (i < tokens.length) {
    const piece = tokens[i]?.piece
    let j = i
    while (j < tokens.length && tokens[j]?.piece === piece) j++
    const run = tokens.slice(i, j)
    if (current.length + run.length > max && current.length > 0) {
      groups.push(current)
      current = []
    }
    // A piece longer than the model can read on its own is cut wherever it fills up.
    for (let k = 0; k < run.length; k += max) {
      const part = run.slice(k, k + max)
      if (current.length + part.length > max) {
        groups.push(current)
        current = []
      }
      current.push(...part)
    }
    i = j
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * When each token of one model call is spoken, in seconds from the start of
 * its audio. `durations` has one value per token plus the two pads; the audio
 * is stretched over their sum.
 */
export function tokenSpans(durations: ArrayLike<number>, samples: number): [number, number][] {
  let total = 0
  for (let i = 0; i < durations.length; i++) total += Number(durations[i]) || 0
  const scale = total > 0 ? samples / SAMPLE_RATE / total : 0
  const spans: [number, number][] = []
  let at = Number(durations[0]) || 0
  for (let i = 1; i < durations.length - 1; i++) {
    const d = Number(durations[i]) || 0
    spans.push([at * scale, (at + d) * scale])
    at += d
  }
  return spans
}

/** A word of the text being read, and when it is spoken, in seconds from the start of that text's audio. */
export type WordTime = { start: number; length: number; at: number; until: number }

/**
 * When each word of `text` is spoken. Within a piece, words map one to one
 * onto eSpeak's words; where eSpeak ran two together ("in the" → ɪnðə), the
 * piece's time is shared out by the letters of its words.
 */
export function wordTimes(text: string, spoken: readonly Spoken[], tokens: readonly Token[], spans: readonly [number, number][]): WordTime[] {
  const out: WordTime[] = []
  spoken.forEach(({ piece }, p) => {
    if (piece.punct) return
    const words = [...text.slice(piece.start, piece.end).matchAll(/[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu)].map(m => ({
      start: piece.start + (m.index ?? 0),
      length: m[0].length,
    }))
    if (words.length === 0) return
    const said = new Map<number, [number, number]>()
    tokens.forEach((t, k) => {
      const span = spans[k]
      if (t.piece !== p || t.word < 0 || !span) return
      const was = said.get(t.word)
      said.set(t.word, was ? [Math.min(was[0], span[0]), Math.max(was[1], span[1])] : [span[0], span[1]])
    })
    const phonemeWords = [...said.entries()].sort((a, b) => a[0] - b[0]).map(([, span]) => span)
    if (phonemeWords.length === 0) return
    if (phonemeWords.length === words.length) {
      words.forEach((w, i) => {
        const [at, until] = phonemeWords[i] ?? [0, 0]
        out.push({ ...w, at, until })
      })
      return
    }
    const from = phonemeWords[0]?.[0] ?? 0
    const to = phonemeWords[phonemeWords.length - 1]?.[1] ?? from
    const letters = words.reduce((n, w) => n + w.length, 0)
    let done = 0
    for (const w of words) {
      const at = from + ((to - from) * done) / letters
      done += w.length
      out.push({ ...w, at, until: from + ((to - from) * done) / letters })
    }
  })
  return out
}

/** Where the 256 numbers of a voice's style for a text of `tokens` tokens start in its .bin file. */
export function styleOffset(tokens: number): number {
  return Math.min(Math.max(tokens, 0), 509) * 256
}
