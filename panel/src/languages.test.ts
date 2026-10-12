import { describe, expect, test } from 'vitest'

import { defaultNative, labelCode, langCode, scriptFor, scriptOf, searchLanguages, voiceMatches } from './languages'
import { itemAt, locate, wordAt } from './textmap'

describe('languages', () => {
  test('search finds a language by Russian, native or English name', () => {
    expect(searchLanguages('нем')[0]?.name).toBe('German')
    expect(searchLanguages('ger')[0]?.name).toBe('German')
    expect(searchLanguages('deu')[0]?.name).toBe('German')
    expect(searchLanguages('Esp')[0]?.name).toBe('Spanish')
    expect(searchLanguages('')).toHaveLength(searchLanguages('').length)
    expect(searchLanguages('zzz')).toEqual([])
  })

  test('the first language comes from VS Code, then the system, else Russian', () => {
    expect(defaultNative(['de', 'en-US'], 'English')).toBe('German')
    expect(defaultNative(['en', 'pl-PL'], 'English')).toBe('Polish')
    expect(defaultNative(['en', 'en-US'], 'English')).toBe('Russian')
    expect(defaultNative(['nb-NO'], 'English')).toBe('Norwegian')
    expect(defaultNative(['zh-cn'], 'English')).toBe('Chinese')
    expect(defaultNative([undefined, 'xx'], 'English')).toBe('Russian')
    expect(defaultNative(['en'], 'Polish')).toBe('English')
  })

  test('codes and voice tags', () => {
    expect(langCode('English')).toBe('en')
    expect(langCode('Deutsch')).toBe('de')
    expect(langCode('Esperanto')).toBe('')
    expect(labelCode('Esperanto')).toBe('ES')
    expect(labelCode('Russian')).toBe('RU')
    expect(voiceMatches('en-US', 'en')).toBe(true)
    expect(voiceMatches('en_GB', 'en')).toBe(true)
    expect(voiceMatches('ru-RU', 'en')).toBe(false)
  })
})

describe('scripts', () => {
  test('scriptOf reads the prose, not code or URLs', () => {
    expect(scriptOf('Открой меню `Get-Content` https://example.com')).toBe('Cyrillic')
    expect(scriptOf('Open the menu.')).toBe('Latin')
    expect(scriptOf('Ок')).toBeUndefined()
    expect(scriptOf('こんにちは、世界')).toBe('Japanese')
    expect(scriptFor('Ukrainian')).toBe('Cyrillic')
    expect(scriptFor('German')).toBe('Latin')
    expect(scriptFor('Esperanto')).toBeUndefined()
  })
})

describe('textmap', () => {
  test('wordAt finds the whole word from a boundary, with or without a length', () => {
    const text = "Open the menu, don't wait."
    expect(wordAt(text, 9)).toEqual({ start: 9, end: 13 })
    expect(wordAt(text, 15, 5)).toEqual({ start: 15, end: 20 })
    expect(wordAt(text, 99)).toBeUndefined()
  })

  test('locate splits a range across text nodes', () => {
    // "Open the " + "menu" + "."
    expect(locate([9, 4, 1], 5, 13)).toEqual([
      { node: 0, start: 5, end: 9 },
      { node: 1, start: 0, end: 4 },
    ])
  })

  test('itemAt maps a position in the joined host text to an item', () => {
    // "Open the menu." + "\n\n" + "Pick the disk."
    expect(itemAt([14, 14], 2, 9)).toEqual({ item: 0, offset: 9 })
    expect(itemAt([14, 14], 2, 16)).toEqual({ item: 1, offset: 0 })
    expect(itemAt([14, 14], 2, 14)).toBeUndefined()
  })
})
