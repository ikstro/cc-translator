import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { lookup, type Dictionary } from './lemma'

// Checks the built dictionary (npm run dict), not a fixture: the common
// words a learner meets in a coding chat must come out right.
const dict = JSON.parse(readFileSync(new URL('../media/dict/en-ru.json', import.meta.url), 'utf8')) as Dictionary

const first = (word: string) =>
  lookup(dict, word)
    ?.entries.flatMap(e => e.senses.map(([pos, t]) => `${pos}: ${t}`))
    .join(' / ') ?? ''

describe('en-ru dictionary', () => {
  test('is large enough and shaped as [pos, translations]', () => {
    expect(Object.keys(dict).length).toBeGreaterThan(30_000)
    const entry = dict.go
    expect(Array.isArray(entry) && entry.every(s => Array.isArray(s) && s.length === 2)).toBe(true)
  })

  test.each([
    ['went', 'идти'],
    ['started', 'начин'],
    ['translate', 'переводить'],
    ['checking', 'проверять'],
    ['files', 'файл'],
    ['understood', 'понимать'],
  ])('%s → contains %s', (word, expected) => {
    expect(first(word)).toContain(expected)
  })

  test('no stress marks or wiki markup in translations', () => {
    const translations = Object.values(dict).flatMap(senses => senses.map(([, t]) => t))
    expect(translations.filter(t => /[̀́]|\[\[|\]\]/.test(t))).toEqual([])
  })
})
