import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULTS, applyCommand, normalize } from './settings'
import { TRANSLATE_SYSTEM, USER_SYSTEM, numbered } from './tutor-prompt'

describe('settings', () => {
  test('normalize fills defaults and drops junk', async () => {
    expect(normalize(undefined)).toEqual(DEFAULTS)
    expect(normalize({ enabled: true, level: 'Z9', target: 'German', native: 42, tutorModel: 'opus' })).toEqual({
      ...DEFAULTS,
      enabled: true,
      target: 'German',
    })
  })

  test('command verbs change the right field', async () => {
    const on = applyCommand(DEFAULTS, 'on')
    expect(on.ok && on.settings.enabled).toBe(true)
    const level = applyCommand(DEFAULTS, 'level a2')
    expect(level.ok && level.settings.level).toBe('A2')
    const off = applyCommand(DEFAULTS, 'level off')
    expect(off.ok && off.settings.level).toBe('off')
    const lang = applyCommand(DEFAULTS, 'lang german')
    expect(lang.ok && lang.settings.target).toBe('German')
    const model = applyCommand(DEFAULTS, 'model sonnet')
    expect(model.ok && model.settings.tutorModel).toBe('sonnet')
    const read = applyCommand(DEFAULTS, 'read on')
    expect(read.ok && read.settings.autoRead).toBe(true)
    expect(applyCommand(DEFAULTS, 'level Z9').ok).toBe(false)
    const status = applyCommand(DEFAULTS, '')
    expect(status.ok && status.changed).toBe(false)
  })

  test('tutor prompts name the language pair and the level of the tutor\'s own writing', async () => {
    const s = { ...DEFAULTS, enabled: true, target: 'German', native: 'Ukrainian', level: 'A2' as const }
    expect(TRANSLATE_SYSTEM(s)).toContain('LANG: native')
    expect(TRANSLATE_SYSTEM(s)).toContain('plain German a A2 learner')
    expect(TRANSLATE_SYSTEM(s)).toContain('into Ukrainian')
    expect(TRANSLATE_SYSTEM({ ...s, level: 'off' })).toContain('natural German')
    expect(USER_SYSTEM(s)).toContain('KIND: translation')
    expect(USER_SYSTEM(s)).toContain('never answer the message')
    expect(numbered(['One.', 'Two.'])).toBe('1. One.\n2. Two.')
  })
})

describe('hooks', () => {
  test('/tutor on writes the settings file and reports it', async ($, on) => {
    mock.store(on)
    mock.env(on, { USERPROFILE: 'C:/tmp/tutor-test' })
    on('ui.status', () => ({ value: undefined }))
    on('session.id', () => ({ value: 'test-session' }))
    on('session.cwd', () => ({ value: 'C:/tmp/project' }))
    const files = new Map<string, string>()
    on('fs.write', ($, e) => {
      files.set(e.path, e.text)
      return { value: undefined }
    })
    on('fs.read', ($, e, next) => {
      const text = files.get(e.path)
      return text === undefined ? next(e) : { value: text }
    })
    const typed = (args: string) => ({
      command: 'tutor',
      args,
      origin: { kind: 'composer' as const },
      presentation: { isFullscreen: false, columns: 80 },
    })
    const { text } = await $.command.run(typed('on'))
    expect(text).toContain('Tutor: on')
    // The engine hands the hook the path in the platform's own spelling.
    const written = [...files.keys()].map(k => k.replace(/\\/g, '/'))
    expect(written).toEqual([
      'C:/tmp/tutor-test/.claude/language-tutor/settings.json',
      'C:/tmp/tutor-test/.claude/language-tutor/learner.json',
    ])
    // Turned on from a session: its project is the one that learns.
    const learner = JSON.parse([...files.entries()].find(([k]) => k.endsWith('learner.json'))?.[1] ?? '{}') as { folders?: string[] }
    expect(learner.folders).toEqual(['C:/tmp/project'])
    const { text: status } = await $.command.run(typed('status'))
    expect(status).toContain('Tutor: on')
  })

  test('the status line follows the switch in the panel without a new session', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    mock.env(on, { USERPROFILE: 'C:/tmp/tutor-test' })
    on('session.id', () => ({ value: 'status-session' }))
    on('session.cwd', () => ({ value: 'C:/tmp/project' }))
    on('command.register', ($, e) => ({ value: { command: e.name } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    const shown: (string | undefined)[] = []
    on('ui.status', ($, e) => {
      shown.push(e.text)
      return { value: undefined }
    })
    const slash = (p: string) => p.replace(/\\/g, '/')
    const settings = 'C:/tmp/tutor-test/.claude/language-tutor/settings.json'
    const files = new Map<string, string>([[settings, JSON.stringify({ enabled: true, level: 'B1', target: 'English' })]])
    on('fs.write', ($, e) => {
      files.set(slash(e.path), e.text)
      return { value: undefined }
    })
    on('fs.read', ($, e, next) => {
      const text = files.get(slash(e.path))
      return text === undefined ? next(e) : { value: text }
    })
    await $.session.start({ cwd: 'C:/tmp/project', surface: null, isInteractive: true })
    expect(shown[shown.length - 1]).toBe('tutor: English B1')
    // The panel writes settings.json; the session keeps running.
    files.set(settings, JSON.stringify({ enabled: false, level: 'B1', target: 'English' }))
    await clock.advance(4_000)
    expect(shown[shown.length - 1]).toBeUndefined()
    files.set(settings, JSON.stringify({ enabled: true, level: 'B1', target: 'English' }))
    await clock.advance(4_000)
    expect(shown[shown.length - 1]).toBe('tutor: English B1')
  })

  test('the plan Claude presents is copied for the panel, even while no panel is open', async ($, on) => {
    mock.store(on)
    mock.env(on, { USERPROFILE: 'C:/tmp/tutor-test' })
    on('ui.status', () => ({ value: undefined }))
    on('session.id', () => ({ value: 'plan-session' }))
    on('session.cwd', () => ({ value: 'C:/tmp/project' }))
    on('fs.list', () => ({ value: [] }))
    const slash = (p: string) => p.replace(/\\/g, '/')
    const files = new Map<string, string>([['C:/tmp/tutor-test/.claude/language-tutor/settings.json', JSON.stringify({ enabled: true })]])
    on('fs.write', ($, e) => {
      files.set(slash(e.path), e.text)
      return { value: undefined }
    })
    on('fs.read', ($, e, next) => {
      const text = files.get(slash(e.path))
      return text === undefined ? next(e) : { value: text }
    })
    // The test stands for the tools: Write keeps the file, ExitPlanMode answers as the engine would.
    on('tool.call', ($, e) => {
      if (e.tool === 'Write') {
        files.set(slash(e.file_path), e.content)
        return { result: { type: 'create' as const, filePath: e.file_path, content: e.content } }
      }
      return { result: { plan: null, isAgent: false } }
    })
    const planPath = 'C:/tmp/tutor-test/.claude/plans/majestic-pearl.md'
    await $.tool.call({ tool: 'Write', file_path: planPath, content: '# Plan\n\nAdd the hook. Test it.\n' })
    await $.tool.call({ tool: 'Write', file_path: 'C:/tmp/project/src/index.ts', content: 'export {}\n' })
    await $.tool.call({ tool: 'ExitPlanMode' })
    const session = files.get('C:/tmp/tutor-test/.claude/language-tutor/sessions/plan-session.jsonl') ?? ''
    const rows = session.split('\n').filter(Boolean).map(line => JSON.parse(line) as { role: string; origin?: string; text?: string })
    expect(rows.map(r => [r.role, r.origin])).toEqual([['assistant', 'plan']])
    expect(rows[0]?.text).toContain('Add the hook.')
  })
})
