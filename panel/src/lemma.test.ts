import { describe, expect, test } from 'vitest'

import { baseForms, lookup, type Dictionary } from './lemma'

const dict: Dictionary = {
  go: [['verb', 'идти, ходить']],
  run: [['verb', 'бегать, бежать']],
  study: [['verb', 'учиться']],
  stop: [['verb', 'остановить']],
  child: [['noun', 'ребёнок']],
  good: [['adj', 'хороший']],
  use: [['verb', 'использовать']],
  box: [['noun', 'коробка']],
  start: [['verb', 'начинать']],
  quick: [['adj', 'быстрый']],
  translation: [['noun', 'перевод']],
}

describe('base forms', () => {
  test.each([
    ['went', 'go'],
    ['running', 'run'],
    ['studies', 'study'],
    ['stopped', 'stop'],
    ['children', 'child'],
    ['better', 'good'],
    ['used', 'use'],
    ['using', 'use'],
    ['boxes', 'box'],
    ['started', 'start'],
    ['Quickly', 'quick'],
    ["start's", 'start'],
    ['translation', 'translation'],
  ])('%s → %s', (word, base) => {
    expect(lookup(dict, word)?.base).toBe(base)
  })

  test('the word itself is tried first, and unknown words give nothing', () => {
    expect(baseForms('running')[0]).toBe('running')
    expect(lookup(dict, 'zzzz')).toBeUndefined()
  })

  test('a form that is also a headword shows both entries, base first for irregular forms', () => {
    const d: Dictionary = {
      understood: [['interj', 'понятно']],
      understand: [['verb', 'понимать']],
      used: [['adj', 'подержанный']],
      use: [['verb', 'использовать']],
    }
    expect(lookup(d, 'understood')?.entries.map(e => e.form)).toEqual(['understand', 'understood'])
    expect(lookup(d, 'used')?.entries.map(e => e.form)).toEqual(['use', 'used'])
    const n: Dictionary = { news: [['noun', 'новости']], new: [['adj', 'новый']] }
    expect(lookup(n, 'news')?.entries.map(e => e.form)).toEqual(['news', 'new'])
  })
})
