// Languages the tutor offers. `name` is the English name, the value stored in
// settings.json and sent to the tutor model; `native` is how the language
// calls itself; `ru` is the Russian name, so a Russian speaker can search
// "нем" and find German. `code` is the BCP-47 primary tag voices are matched on.

export type Language = {
  name: string
  native: string
  ru: string
  code: string
}

export const LANGUAGES: readonly Language[] = [
  { name: 'English', native: 'English', ru: 'английский', code: 'en' },
  { name: 'Spanish', native: 'Español', ru: 'испанский', code: 'es' },
  { name: 'German', native: 'Deutsch', ru: 'немецкий', code: 'de' },
  { name: 'French', native: 'Français', ru: 'французский', code: 'fr' },
  { name: 'Italian', native: 'Italiano', ru: 'итальянский', code: 'it' },
  { name: 'Portuguese', native: 'Português', ru: 'португальский', code: 'pt' },
  { name: 'Russian', native: 'Русский', ru: 'русский', code: 'ru' },
  { name: 'Ukrainian', native: 'Українська', ru: 'украинский', code: 'uk' },
  { name: 'Polish', native: 'Polski', ru: 'польский', code: 'pl' },
  { name: 'Czech', native: 'Čeština', ru: 'чешский', code: 'cs' },
  { name: 'Dutch', native: 'Nederlands', ru: 'нидерландский', code: 'nl' },
  { name: 'Swedish', native: 'Svenska', ru: 'шведский', code: 'sv' },
  { name: 'Norwegian', native: 'Norsk', ru: 'норвежский', code: 'nb' },
  { name: 'Danish', native: 'Dansk', ru: 'датский', code: 'da' },
  { name: 'Finnish', native: 'Suomi', ru: 'финский', code: 'fi' },
  { name: 'Greek', native: 'Ελληνικά', ru: 'греческий', code: 'el' },
  { name: 'Turkish', native: 'Türkçe', ru: 'турецкий', code: 'tr' },
  { name: 'Romanian', native: 'Română', ru: 'румынский', code: 'ro' },
  { name: 'Hungarian', native: 'Magyar', ru: 'венгерский', code: 'hu' },
  { name: 'Bulgarian', native: 'Български', ru: 'болгарский', code: 'bg' },
  { name: 'Serbian', native: 'Српски', ru: 'сербский', code: 'sr' },
  { name: 'Croatian', native: 'Hrvatski', ru: 'хорватский', code: 'hr' },
  { name: 'Georgian', native: 'ქართული', ru: 'грузинский', code: 'ka' },
  { name: 'Armenian', native: 'Հայերեն', ru: 'армянский', code: 'hy' },
  { name: 'Kazakh', native: 'Қазақ тілі', ru: 'казахский', code: 'kk' },
  { name: 'Arabic', native: 'العربية', ru: 'арабский', code: 'ar' },
  { name: 'Hebrew', native: 'עברית', ru: 'иврит', code: 'he' },
  { name: 'Persian', native: 'فارسی', ru: 'персидский', code: 'fa' },
  { name: 'Hindi', native: 'हिन्दी', ru: 'хинди', code: 'hi' },
  { name: 'Chinese', native: '中文', ru: 'китайский', code: 'zh' },
  { name: 'Japanese', native: '日本語', ru: 'японский', code: 'ja' },
  { name: 'Korean', native: '한국어', ru: 'корейский', code: 'ko' },
  { name: 'Vietnamese', native: 'Tiếng Việt', ru: 'вьетнамский', code: 'vi' },
  { name: 'Thai', native: 'ไทย', ru: 'тайский', code: 'th' },
  { name: 'Indonesian', native: 'Bahasa Indonesia', ru: 'индонезийский', code: 'id' },
]

export function findLanguage(name: string | undefined): Language | undefined {
  if (!name) return undefined
  const key = name.trim().toLowerCase()
  return LANGUAGES.find(l => l.name.toLowerCase() === key || l.native.toLowerCase() === key || l.code === key)
}

/** The BCP-47 primary tag for a language name; empty for a name the list lacks, so no voice is matched by guess. */
export function langCode(name: string | undefined): string {
  if (!name) return 'en'
  return findLanguage(name)?.code ?? ''
}

/** The short label for the "show all translations" button: the code, or the name's first letters. */
export function labelCode(name: string | undefined): string {
  if (!name) return 'RU'
  return (findLanguage(name)?.code ?? name.trim().slice(0, 2)).toUpperCase()
}

/** Norwegian is listed as Bokmål (`nb`); locales may say `no` or `nn`. */
const LOCALE_ALIASES: Record<string, string> = { no: 'nb', nn: 'nb' }

/**
 * The person's language before they pick one: the first locale (VS Code's
 * display language, then the system's) that is on the list and is not the
 * language they learn; Russian otherwise.
 */
export function defaultNative(locales: readonly (string | undefined)[], target: string): string {
  for (const locale of locales) {
    const primary = (locale ?? '').toLowerCase().replace('_', '-').split('-')[0] ?? ''
    const language = LANGUAGES.find(l => l.code === (LOCALE_ALIASES[primary] ?? primary))
    if (language && language.name !== target) return language.name
  }
  return 'Russian'
}

/** Languages matching a query by English, native or Russian name, or code; word starts rank first. */
export function searchLanguages(query: string): Language[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...LANGUAGES]
  const fields = (l: Language) => [l.name, l.native, l.ru, l.code].map(f => f.toLowerCase())
  const starts = LANGUAGES.filter(l => fields(l).some(f => f.startsWith(q) || f.split(/[\s-]+/).some(w => w.startsWith(q))))
  const contains = LANGUAGES.filter(l => !starts.includes(l) && fields(l).some(f => f.includes(q)))
  return [...starts, ...contains]
}

export type Script =
  | 'Latin'
  | 'Cyrillic'
  | 'Greek'
  | 'Arabic'
  | 'Hebrew'
  | 'Devanagari'
  | 'Han'
  | 'Japanese'
  | 'Hangul'
  | 'Georgian'
  | 'Armenian'
  | 'Thai'

const SCRIPT_BY_CODE: Record<string, Script> = {
  ru: 'Cyrillic',
  uk: 'Cyrillic',
  bg: 'Cyrillic',
  sr: 'Cyrillic',
  kk: 'Cyrillic',
  el: 'Greek',
  ar: 'Arabic',
  fa: 'Arabic',
  he: 'Hebrew',
  hi: 'Devanagari',
  zh: 'Han',
  ja: 'Japanese',
  ko: 'Hangul',
  ka: 'Georgian',
  hy: 'Armenian',
  th: 'Thai',
}

/** The script a listed language is written in; Latin for the rest of the list, undefined for an unknown name. */
export function scriptFor(name: string | undefined): Script | undefined {
  const language = findLanguage(name)
  if (!language) return undefined
  return SCRIPT_BY_CODE[language.code] ?? 'Latin'
}

const SCRIPT_TESTS: [Script, RegExp][] = [
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

/**
 * The script most of the prose is written in, ignoring inline code and URLs;
 * undefined when there are too few letters to tell or no script dominates.
 */
export function scriptOf(text: string): Script | undefined {
  const prose = text.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ')
  const counts = new Map<Script, number>()
  let letters = 0
  for (const char of prose) {
    if (!/\p{L}/u.test(char)) continue
    const script = SCRIPT_TESTS.find(([, test]) => test.test(char))?.[0]
    if (!script) continue
    letters++
    counts.set(script, (counts.get(script) ?? 0) + 1)
  }
  if (letters < 3) return undefined
  // Japanese mixes kana with Han characters: any kana makes it Japanese.
  if ((counts.get('Japanese') ?? 0) > 0) counts.set('Japanese', (counts.get('Japanese') ?? 0) + (counts.get('Han') ?? 0))
  const [best, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  return best && count !== undefined && count / letters >= 0.6 ? best : undefined
}

/** Whether a voice's language tag (`en-US`, `en_GB`, `ru`) belongs to a language code. */
export function voiceMatches(voiceLang: string, code: string): boolean {
  return voiceLang.toLowerCase().replace('_', '-').split('-')[0] === code.toLowerCase()
}
