import { existsSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'vitest'

import { DOWNLOADABLE, parseDictionary } from './dictstore'
import { lookup } from './lemma'

// Checks the dictionaries built for the `dict-1` release
// (node scripts/build-dict.mjs <code> --release), when they are on this
// computer: every language the panel may download loads, and the words a
// learner meets in a coding chat come back in that language's script.

const DIR = new URL('../.cache/release/', import.meta.url)
const built = existsSync(new URL('en-de.json.gz', DIR))

const SCRIPT: Record<string, RegExp> = {
  el: /\p{Script=Greek}/u,
  bg: /\p{Script=Cyrillic}/u,
  ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  zh: /\p{Script=Han}/u,
}
const WORDS = ['go', 'went', 'files', 'writing', 'better', 'open', 'change', 'check', 'run', 'build']

describe.skipIf(!built)('release dictionaries', () => {
  test.each([...DOWNLOADABLE])('en-%s loads and knows common words', code => {
    const dict = parseDictionary(gunzipSync(readFileSync(new URL(`en-${code}.json.gz`, DIR))).toString('utf8'))
    expect(dict).toBeDefined()
    if (!dict) return
    expect(Object.keys(dict).length).toBeGreaterThan(15_000)
    const found = WORDS.map(w => lookup(dict, w)).filter(g => g !== undefined)
    // Smaller WikDict pairs (Norwegian, Indonesian, Chinese) miss a word or two.
    expect(found.length).toBeGreaterThanOrEqual(8)
    const script = SCRIPT[code] ?? /\p{Script=Latin}/u
    const translations = found.flatMap(g => g.entries.flatMap(e => e.senses.map(([, t]) => t)))
    expect(translations.filter(t => script.test(t)).length / translations.length).toBeGreaterThan(0.9)
  })
})
