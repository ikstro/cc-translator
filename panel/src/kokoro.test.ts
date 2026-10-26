import { describe, expect, test } from 'vitest'

import { groupsOf, normalizePunct, normalizeText, piecesOf, postPhonemes, styleOffset, tokenSpans, tokensOf, wordTimes, type Spoken } from './kokoro'

const textOf = (text: string) => piecesOf(text).map(p => [text.slice(p.start, p.end), p.punct])

describe('pieces', () => {
  test('punctuation with its spaces is a piece of its own; marks inside a word stay', () => {
    expect(textOf('Hello there, my friend.')).toEqual([
      ['Hello there', false],
      [', ', true],
      ['my friend', false],
      ['.', true],
    ])
    expect(textOf('It costs 3.5, e.g. at 10:30')).toEqual([
      ['It costs 3.5', false],
      [', ', true],
      ['e.g', false],
      ['. ', true],
      ['at 10:30', false],
    ])
  })

  test('a long run of words is cut at a space', () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ')
    const pieces = piecesOf(text)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.every(p => p.end - p.start <= 250)).toBe(true)
    expect(pieces.map(p => text.slice(p.start, p.end)).join('')).toBe(text)
  })
})

describe('text rules', () => {
  test('years, money, decimals and titles are spelled out', () => {
    expect(normalizeText('In 1984 Mr. Smith paid $3.50')).toBe('In 19 84 Mister Smith paid 3 dollars and 50 cents')
    expect(normalizeText('about 2.5 cups')).toBe('about 2 point 5 cups')
    expect(normalizePunct('” (')).toBe('" ')
  })

  test('eSpeak phonemes are adjusted to the ones Kokoro knows', () => {
    expect(postPhonemes('ɡˈʊd mɔːnɪŋ r', true)).toBe('ɡˈʊd mɔːnɪŋ ɹ')
    expect(postPhonemes('nˈaɪnti', true)).toBe('nˈaɪndi')
    expect(postPhonemes('nˈaɪnti', false)).toBe('nˈaɪnti')
  })
})

describe('tokens and timing', () => {
  const text = 'Hello there, in the end.'
  const spoken: Spoken[] = [
    { piece: { start: 0, end: 11, punct: false }, phonemes: 'həlˈoʊ ðˈɛɹ' },
    { piece: { start: 11, end: 13, punct: true }, phonemes: ', ' },
    { piece: { start: 13, end: 23, punct: false }, phonemes: 'ɪnðɪ ˈɛnd' },
    { piece: { start: 23, end: 24, punct: true }, phonemes: '.' },
  ]

  test('each phoneme becomes a token that knows its word; spaces and marks belong to none', () => {
    const tokens = tokensOf(spoken)
    expect(tokens.map(t => t.id).slice(0, 3)).toEqual([50, 83, 54])
    expect(new Set(tokens.filter(t => t.piece === 0 && t.word >= 0).map(t => t.word))).toEqual(new Set([0, 1]))
    expect(tokens.filter(t => t.piece === 1).every(t => t.word === -1)).toBe(true)
  })

  test('a long text is split between pieces into runs the model can read', () => {
    const tokens = tokensOf(spoken)
    const groups = groupsOf(tokens, 14)
    expect(groups.every(g => g.length <= 14)).toBe(true)
    expect(groups.flat()).toEqual(tokens)
    expect(groups[0]?.at(-1)?.piece).not.toBe(groups[1]?.[0]?.piece)
  })

  test('durations become seconds, pads excluded, stretched over the audio', () => {
    // Pads of 2, then tokens of 1 and 3: 8 units over 0.8 s.
    expect(tokenSpans([2, 1, 3, 2], 19_200)).toEqual([
      [0.2, 0.30000000000000004],
      [0.30000000000000004, 0.6000000000000001],
    ])
    expect(styleOffset(3)).toBe(768)
    expect(styleOffset(900)).toBe(509 * 256)
  })

  test('words map one to one, and share a piece\'s time where eSpeak joined them', () => {
    const tokens = tokensOf(spoken)
    const spans = tokens.map((_, k) => [k * 0.1, k * 0.1 + 0.1] as [number, number])
    const words = wordTimes(text, spoken, tokens, spans)
    expect(words.map(w => text.slice(w.start, w.start + w.length))).toEqual(['Hello', 'there', 'in', 'the', 'end'])
    const [hello, there, inWord, the, end] = words
    expect(hello?.at).toBeCloseTo(0)
    expect(there?.at).toBeGreaterThan(hello?.until ?? 0)
    // "in the end" came back as two eSpeak words: three words share that piece by their letters.
    expect(inWord?.at).toBeLessThan(the?.at ?? 0)
    expect(the?.until).toBeCloseTo(end?.at ?? -1)
  })
})
