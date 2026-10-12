export type Level = 'off' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'
export const LEVELS: readonly Level[] = ['off', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2']

export type TutorModel = 'haiku' | 'sonnet'
export const MODELS: readonly TutorModel[] = ['haiku', 'sonnet']

export type Settings = {
  enabled: boolean
  level: Level
  target: string
  native: string
  tutorModel: TutorModel
  autoRead: boolean
}

export const DEFAULTS: Settings = {
  enabled: false,
  level: 'B1',
  target: 'English',
  native: 'Russian',
  tutorModel: 'haiku',
  autoRead: false,
}

export const USAGE = [
  '/tutor on | off',
  '/tutor level A1..C2 | off   (how plain the tutor\'s text in the language you learn is; off = natural)',
  '/tutor lang <language you learn>',
  '/tutor native <your language>',
  '/tutor model haiku | sonnet  (the model that translates and corrects)',
  '/tutor read on | off         (the panel reads each reply aloud)',
  '/tutor status',
].join('\n')

export function normalize(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULTS.enabled,
    level: isLevel(r.level) ? r.level : DEFAULTS.level,
    target: isLanguage(r.target) ? r.target : DEFAULTS.target,
    native: isLanguage(r.native) ? r.native : DEFAULTS.native,
    tutorModel: isModel(r.tutorModel) ? r.tutorModel : DEFAULTS.tutorModel,
    autoRead: typeof r.autoRead === 'boolean' ? r.autoRead : DEFAULTS.autoRead,
  }
}

function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v)
}

function isModel(v: unknown): v is TutorModel {
  return typeof v === 'string' && (MODELS as readonly string[]).includes(v)
}

function isLanguage(v: unknown): v is string {
  return typeof v === 'string' && /^[\p{L}][\p{L} -]{0,29}$/u.test(v)
}

function titleCase(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1)
}

export function describe(s: Settings): string {
  return [
    `Tutor: ${s.enabled ? 'on' : 'off'}`,
    `Learning ${s.target}, translations and explanations in ${s.native}`,
    `The tutor's ${s.target}: ${s.level === 'off' ? 'natural' : `plain, level ${s.level}`}`,
    'Claude answers as usual; translations live in the Tutor panel (VS Code extension "Language Tutor for Claude Code")',
    `Tutor model: ${s.tutorModel}; read aloud: ${s.autoRead ? 'on' : 'off'} (uses a system voice for ${s.target}; the panel shows how to add one)`,
  ].join('\n')
}

export type Change =
  | { ok: true; settings: Settings; changed: boolean; note: string }
  | { ok: false; error: string }

export function applyCommand(current: Settings, rawArgs: string): Change {
  const [verb = '', ...rest] = rawArgs.trim().split(/\s+/).filter(Boolean)
  const arg = rest.join(' ').trim()
  const done = (settings: Settings, changed = true): Change => ({
    ok: true,
    settings,
    changed,
    note: describe(settings),
  })

  switch (verb.toLowerCase()) {
    case '':
    case 'status':
      return done(current, false)
    case 'help':
      return { ok: true, settings: current, changed: false, note: USAGE }
    case 'on':
      return done({ ...current, enabled: true })
    case 'off':
      return done({ ...current, enabled: false })
    case 'level': {
      const level = arg.toLowerCase() === 'off' ? 'off' : arg.toUpperCase()
      if (!isLevel(level)) return { ok: false, error: `Level must be one of ${LEVELS.join(', ')}.` }
      return done({ ...current, level })
    }
    case 'lang':
    case 'language':
    case 'target': {
      if (!isLanguage(arg)) return { ok: false, error: 'Name the language, e.g. /tutor lang German' }
      return done({ ...current, target: titleCase(arg) })
    }
    case 'native': {
      if (!isLanguage(arg)) return { ok: false, error: 'Name your language, e.g. /tutor native Russian' }
      return done({ ...current, native: titleCase(arg) })
    }
    case 'model': {
      const model = arg.toLowerCase()
      if (!isModel(model)) return { ok: false, error: `Model must be one of ${MODELS.join(', ')}.` }
      return done({ ...current, tutorModel: model })
    }
    case 'read':
    case 'voice': {
      const v = arg.toLowerCase()
      if (v !== 'on' && v !== 'off') return { ok: false, error: 'Use /tutor read on or /tutor read off' }
      return done({ ...current, autoRead: v === 'on' })
    }
    default:
      return { ok: false, error: `Unknown option "${verb}".\n${USAGE}` }
  }
}
