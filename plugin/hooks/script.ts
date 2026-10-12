// Which writing system a text is in: lets the plugin check that the tutor
// really answered in English when the user's language has another script.

export type Script = 'Latin' | 'Cyrillic' | 'Greek' | 'Arabic' | 'Hebrew' | 'Devanagari' | 'Han' | 'Japanese' | 'Hangul' | 'Georgian' | 'Armenian' | 'Thai'

const BY_LANGUAGE: Record<string, Script> = {
  russian: 'Cyrillic',
  ukrainian: 'Cyrillic',
  bulgarian: 'Cyrillic',
  serbian: 'Cyrillic',
  kazakh: 'Cyrillic',
  greek: 'Greek',
  arabic: 'Arabic',
  persian: 'Arabic',
  hebrew: 'Hebrew',
  hindi: 'Devanagari',
  chinese: 'Han',
  japanese: 'Japanese',
  korean: 'Hangul',
  georgian: 'Georgian',
  armenian: 'Armenian',
  thai: 'Thai',
}

const LATIN = new Set([
  'english', 'spanish', 'german', 'french', 'italian', 'portuguese', 'polish', 'czech', 'dutch', 'swedish',
  'norwegian', 'danish', 'finnish', 'turkish', 'romanian', 'hungarian', 'croatian', 'vietnamese', 'indonesian',
])

export function scriptForLanguage(name: string): Script | undefined {
  const key = name.trim().toLowerCase()
  return BY_LANGUAGE[key] ?? (LATIN.has(key) ? 'Latin' : undefined)
}

const TESTS: [Script, RegExp][] = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Japanese', /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ['Han', /\p{Script=Han}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Georgian', /\p{Script=Georgian}/u],
  ['Armenian', /\p{Script=Armenian}/u],
  ['Thai', /\p{Script=Thai}/u],
]

/** The script most of the prose is in (60 % of letters or more), ignoring inline code and URLs. */
export function scriptOf(text: string): Script | undefined {
  const prose = text.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ')
  const counts = new Map<Script, number>()
  let letters = 0
  for (const char of prose) {
    if (!/\p{L}/u.test(char)) continue
    const script = TESTS.find(([, test]) => test.test(char))?.[0]
    if (!script) continue
    letters++
    counts.set(script, (counts.get(script) ?? 0) + 1)
  }
  if (letters < 3) return undefined
  if ((counts.get('Japanese') ?? 0) > 0) counts.set('Japanese', (counts.get('Japanese') ?? 0) + (counts.get('Han') ?? 0))
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
  return best && best[1] / letters >= 0.6 ? best[0] : undefined
}

/**
 * Which side of the pair a text is written in, read from its script; only
 * decidable when the learned and the native language use different scripts.
 */
export function sideOf(text: string, target: string, native: string): 'target' | 'native' | undefined {
  const t = scriptForLanguage(target)
  const n = scriptForLanguage(native)
  if (!t || !n || t === n) return undefined
  const s = scriptOf(text)
  return s === t ? 'target' : s === n ? 'native' : undefined
}

/**
 * What the tutor does with a message the person typed: clearly in their own
 * script → the English version; anything else (English, or another language
 * in the learned language's script) → the tutor decides: correction for
 * English, English version otherwise.
 */
export function userRoute(text: string, target: string, native: string): 'to-target' | 'tutor-decides' {
  return sideOf(text, target, native) === 'native' ? 'to-target' : 'tutor-decides'
}

/** True when most translations merely repeat their source sentence. */
export function mostlyCopies(translations: readonly (string | undefined)[], sources: readonly string[]): boolean {
  const norm = (v: string) => v.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const pairs = sources.map((s, i) => [s, translations[i]] as const).filter(([, t]) => t !== undefined && norm(t).length > 3)
  if (pairs.length === 0) return false
  return pairs.filter(([s, t]) => norm(s) === norm(t ?? '')).length / pairs.length > 0.5
}

/**
 * True when the lines that should be in the learned language are mostly in
 * the native script instead; only decidable when the two scripts differ.
 */
export function mostlyInScript(lines: readonly (string | undefined)[], script: Script): boolean {
  const judged = lines.map(l => (l ? scriptOf(l) : undefined)).filter((s): s is Script => s !== undefined)
  if (judged.length === 0) return false
  return judged.filter(s => s === script).length / judged.length > 0.5
}
