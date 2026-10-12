// Builds the panel's offline word dictionary from WikDict (Wiktionary via
// DBnary, CC BY-SA). Usage: node scripts/build-dict.mjs [native-code] [--release],
// e.g. ru. Without --release it writes media/dict/en-<code>.json, the copy
// shipped inside the extension; with it, .cache/release/en-<code>.json.gz, the
// file the panel downloads from the GitHub release when a person needs it.
//
// For every single English word it keeps up to two parts of speech with up
// to three translations each. WikDict's own scores do not rank meanings well
// ("go" would start with the board game), so candidates are ranked by
// back-translation: a Russian word counts as a good translation of "go" when
// the Russian→English dictionary in turn lists "go" for it. How often the
// Russian word serves as a translation at all breaks ties.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { gzipSync } from 'node:zlib'

const args = process.argv.slice(2)
const release = args.includes('--release')
const code = args.find(a => !a.startsWith('--')) ?? 'ru'
/** WikDict's name for a language where it differs from the panel's code. */
const WIKDICT = { nb: 'no' }
const wikdict = WIKDICT[code] ?? code
/** Translations in these languages carry stress marks to drop; elsewhere the same marks are real letters (é, ά). */
const STRESS_MARKED = new Set(['ru', 'uk', 'bg'])
/** Natives not written in Latin letters: a Latin-letter "translation" there is untranslated English. */
const NON_LATIN = new Set(['ru', 'uk', 'bg', 'el', 'ja', 'zh'])
const BASE = 'https://download.wikdict.com/dictionaries/sqlite/2'
const CACHE = '.cache'
const OUT_DIR = release ? `${CACHE}/release` : 'media/dict'

async function fetchOnce(name) {
  const file = `${CACHE}/${name}`
  if (existsSync(file)) return file
  mkdirSync(CACHE, { recursive: true })
  const res = await fetch(`${BASE}/${name}`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}

const forward = new DatabaseSync(await fetchOnce(`en-${wikdict}.sqlite3`), { readOnly: true })
const backFile = await fetchOnce(`${wikdict}-en.sqlite3`).catch(() => undefined)
const backward = backFile ? new DatabaseSync(backFile, { readOnly: true }) : undefined

/** Drops wiki markup and, in Cyrillic, stress marks; keeps ё and й. */
function clean(raw) {
  let s = String(raw).replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
  if (STRESS_MARKED.has(code)) s = s.normalize('NFD').replace(/[̀́]/g, '').normalize('NFC')
  s = s.trim()
  if (!s || s.length > 32 || /[+…[\](){}=]|\bcomp\b/.test(s) || (NON_LATIN.has(code) && /[A-Za-z]/.test(s))) return undefined
  s = s.replace(/\s+/g, ' ')
  return s
}

// Russian word → the English words its own entry translates into. Kept
// twice: by the exact spelling, so German "gehen" (go) is not mixed up with
// "Gehen" (walking), and lowercased for spellings the forward side writes
// otherwise.
const back = new Map()
const backExact = new Map()
const mergeInto = (map, key, english) => {
  const merged = map.get(key) ?? []
  for (const e of english) if (!merged.includes(e)) merged.push(e)
  map.set(key, merged)
}
if (backward) {
  for (const row of backward.prepare('SELECT written_rep, trans_list FROM simple_translation').iterate()) {
    const spelled = clean(row.written_rep)
    if (!spelled) continue
    const english = String(row.trans_list)
      .split(' | ')
      .map(e => e.trim().toLowerCase().replace(/^to /, ''))
      .filter(Boolean)
    // Spellings that clean to the same key (with and without stress marks) are merged, first row first.
    mergeInto(back, spelled.toLowerCase(), english)
    mergeInto(backExact, spelled, english)
  }
}

// How many English entries use a translation: a rough measure of how common it is.
const common = new Map()
const rows = forward.prepare('SELECT written_rep, lexentry, sense, trans_list FROM translation WHERE lexentry IS NOT NULL').all()
for (const row of rows) {
  for (const t of String(row.trans_list).split(' | ')) {
    const c = clean(t)?.toLowerCase()
    if (c) common.set(c, (common.get(c) ?? 0) + 1)
  }
}

const POS = {
  Verb: 'verb',
  Noun: 'noun',
  Adjective: 'adj',
  Adverb: 'adv',
  Pronoun: 'pron',
  Preposition: 'prep',
  Conjunction: 'conj',
  Determiner: 'det',
  Interjection: 'interj',
  Numeral: 'num',
  Particle: 'part',
}

// word → pos → translation → best score
const words = new Map()
for (const row of rows) {
  const english = String(row.written_rep)
  if (!/^[A-Za-z][A-Za-z'’-]*$/.test(english)) continue
  const [, posRaw, etym] = String(row.lexentry).split('__')
  const pos = POS[posRaw]
  if (!pos) continue
  const word = english.toLowerCase()
  const byPos = words.get(word) ?? new Map()
  words.set(word, byPos)
  const candidates = byPos.get(pos) ?? new Map()
  byPos.set(pos, candidates)
  for (const t of String(row.trans_list).split(' | ')) {
    const translation = clean(t)
    if (!translation) continue
    const key = translation.toLowerCase()
    const backList = backExact.get(translation) ?? back.get(key) ?? []
    const at = backList.indexOf(word)
    let score = at === 0 ? 5 : at === 1 ? 4.5 : at === 2 ? 4.2 : at > 2 ? 4 : 0
    score += Math.min(common.get(key) ?? 0, 45) / 30
    // A second etymology is a different, usually rarer word (go, the board game).
    if (etym === '1') score += 0.5
    else score -= 3
    if (!row.sense) score += 0.3
    if (english !== word) score -= 0.5 // a capitalized headword (a name) ranks below the common word
    const seen = candidates.get(translation)
    // Kept: the best score, and in how many senses of the word it serves.
    candidates.set(translation, { score: Math.max(seen?.score ?? -Infinity, score), senses: (seen?.senses ?? 0) + 1 })
  }
}

const dict = {}
let kept = 0
for (const [word, byPos] of words) {
  const groups = [...byPos.entries()]
    .map(([pos, candidates]) => {
      // A translation that serves several senses of the word is the general one ("gehen" for go).
      const ranked = [...candidates.entries()]
        .map(([t, c]) => [t, c.score + 0.3 * Math.min(c.senses - 1, 3)])
        .sort((a, b) => b[1] - a[1])
      const seen = new Set()
      const top = []
      for (const [t] of ranked) {
        const k = t.toLowerCase()
        if (seen.has(k)) continue
        seen.add(k)
        top.push(t)
        if (top.length === 3) break
      }
      return { pos, best: ranked[0]?.[1] ?? 0, top }
    })
    .filter(g => g.top.length > 0)
    .sort((a, b) => b.best - a.best)
    .slice(0, 2)
  if (groups.length === 0) continue
  dict[word] = groups.map(g => [g.pos, g.top.join(', ')])
  kept++
}

mkdirSync(OUT_DIR, { recursive: true })
const json = JSON.stringify(dict)
const out = `${OUT_DIR}/en-${code}.json${release ? '.gz' : ''}`
const bytes = release ? gzipSync(json, { level: 9 }) : Buffer.from(json)
writeFileSync(out, bytes)
console.log(`${out}: ${kept} words, ${(bytes.length / 1024 / 1024).toFixed(1)} MB`)
for (const w of ['go', 'start', 'run', 'clear', 'make', 'issue', 'set', 'check', 'panel', 'administrator', 'translate', 'the']) {
  console.log(w.padEnd(14), JSON.stringify(dict[w]))
}
