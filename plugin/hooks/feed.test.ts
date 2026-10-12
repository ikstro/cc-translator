import { describe, expect, test } from 'claude-code/testing'

import { isHumanPrompt, isPlanPath, panelCoverage, parseRequests, parseTextRequests, parseTutorReply, sessionPathFor, stripMachineBlocks } from './feed'
import { mostlyCopies, mostlyInScript, scriptForLanguage, scriptOf, sideOf, userRoute } from './script'

describe('panel coverage', () => {
  const now = 1_000_000
  test('an open panel covers its folder and subfolders, case and slashes aside', async () => {
    const beats = [{ folders: ['E:\\Work\\My-Project'], visible: true, ts: now - 1000 }]
    expect(panelCoverage(beats, 'e:/work/my-project/panel', now)).toEqual({ open: true, visible: true })
    expect(panelCoverage(beats, 'E:/Work/Other', now)).toEqual({ open: false, visible: false })
  })

  test('a hidden panel records but does not translate; a stale beat counts for nothing', async () => {
    expect(panelCoverage([{ folders: ['C:/p'], visible: false, ts: now }], 'C:/p', now)).toEqual({ open: true, visible: false })
    expect(panelCoverage([{ folders: ['C:/p'], visible: true, ts: now - 120_000 }], 'C:/p', now)).toEqual({ open: false, visible: false })
    expect(panelCoverage([{ folders: 'C:/p', ts: now }], 'C:/p', now).open).toBe(false)
  })
})

describe('prompts', () => {
  test('only what the person typed counts', async () => {
    expect(isHumanPrompt('composer', 'Как очистить панель?')).toBe(true)
    expect(isHumanPrompt('sdk', 'Fix the build')).toBe(true)
    expect(isHumanPrompt('task-notification', 'done')).toBe(false)
    expect(isHumanPrompt('scheduled-trigger', 'check')).toBe(false)
    expect(isHumanPrompt('unclassified', '<task-notification>\n<task-id>x</task-id>')).toBe(false)
  })

  test('requests keep only well-formed taps', async () => {
    expect(parseRequests('{"requests":[{"ref":"a","ts":5},{"ref":7},{"ts":1}]}')).toEqual([{ ref: 'a', ts: 5 }])
    expect(parseRequests('not json')).toEqual([])
  })

  test('picked texts keep a safe id and a bounded text', async () => {
    const texts = parseTextRequests('{"texts":[{"id":"a b/..c","text":" Hello. ","ts":5},{"id":"x","text":"  ","ts":1},{"id":"y","text":"t"}]}')
    expect(texts).toEqual([{ id: 'abc', text: ' Hello. ', ts: 5 }])
    expect(parseTextRequests('{"requests":[]}')).toEqual([])
    expect(parseTextRequests('{"texts":[{"id":"z","text":"' + 'x'.repeat(50_000) + '","ts":1}]}')[0]?.text).toHaveLength(40_000)
  })

  test('the tutor reply names its kind', async () => {
    expect(parseTutorReply('KIND: translation\n1. How do I clear the panel?')).toEqual({ kind: 'translation', body: '1. How do I clear the panel?' })
    expect(parseTutorReply('KIND: correction\n✓')).toEqual({ kind: 'correction', body: '✓' })
    expect(parseTutorReply('KIND: howToSay\n1. Hi.').kind).toBe('translation')
  })

  test('session ids cannot leave the sessions folder', async () => {
    expect(sessionPathFor('C:\\Users\\me', '../../evil')).toBe('C:/Users/me/.claude/language-tutor/sessions/evil.jsonl')
  })
})

describe('plans', () => {
  test('a plan is a markdown file right under ~/.claude/plans, whatever the slashes and case', async () => {
    const home = 'C:\\Users\\me'
    expect(isPlanPath('C:\\Users\\me\\.claude\\plans\\quirky-kazoo.md', home)).toBe(true)
    expect(isPlanPath('c:/users/ME/.claude/plans/quirky-kazoo.md', home)).toBe(true)
    expect(isPlanPath('C:/Users/me/.claude/plans/sub/notes.md', home)).toBe(false)
    expect(isPlanPath('C:/Users/me/.claude/plans/notes.txt', home)).toBe(false)
    expect(isPlanPath('C:/Users/me/project/plans/x.md', home)).toBe(false)
    expect(isPlanPath(undefined, home)).toBe(false)
    expect(isPlanPath('C:/Users/me/.claude/plans/x.md', undefined)).toBe(false)
  })
})

describe('the person\'s own words', () => {
  test('IDE and engine notes are stripped from a prompt', async () => {
    const raw =
      '<ide_opened_file>The user opened the file e:\\work\\my-project\\README.md in the IDE. This may or may not be related to the current task.</ide_opened_file>\nДавай проверим как будет отображаться кириллический текст.'
    expect(stripMachineBlocks(raw)).toBe('Давай проверим как будет отображаться кириллический текст.')
    expect(stripMachineBlocks('<ide_selection>const x = 1</ide_selection>\n\n\n\nFix it')).toBe('Fix it')
    expect(stripMachineBlocks('<system-reminder>be brief</system-reminder>')).toBe('')
    expect(stripMachineBlocks('Use a <div> here')).toBe('Use a <div> here')
  })

  test('Russian goes to English; English and German go to the tutor', async () => {
    expect(userRoute('Давай проверим как будет отображаться текст.', 'English', 'Russian')).toBe('to-target')
    expect(userRoute('I wants to see how the tutor work', 'English', 'Russian')).toBe('tutor-decides')
    expect(userRoute('Ich möchte sehen, wie es funktioniert', 'English', 'Russian')).toBe('tutor-decides')
    expect(userRoute('Хочу перевірити, як це працює', 'English', 'Ukrainian')).toBe('to-target')
  })
})

describe('direction', () => {
  test('the side is read from the script when the two languages differ', async () => {
    expect(sideOf('Checking what the plugin wrote.', 'English', 'Russian')).toBe('target')
    expect(sideOf('Давай проверим, как работает Tutor.', 'English', 'Russian')).toBe('native')
    expect(sideOf('Vamos a ver.', 'English', 'Spanish')).toBeUndefined()
  })

  test('a translation that repeats its source is caught', async () => {
    const sources = ['Your message is a test.', 'Checking the files.']
    expect(mostlyCopies(['Your message is a test.', 'Checking the files!'], sources)).toBe(true)
    expect(mostlyCopies(['Твоё сообщение — тест.', 'Проверяю файлы.'], sources)).toBe(false)
    expect(mostlyCopies(['`npm`', undefined], ['`npm`', 'x'])).toBe(false)
  })
})

describe('scripts', () => {
  test('tells Cyrillic from Latin, ignoring code', async () => {
    expect(scriptOf('Как очистить панель `npm run build`')).toBe('Cyrillic')
    expect(scriptOf('How do I clear the panel?')).toBe('Latin')
    expect(scriptForLanguage('Ukrainian')).toBe('Cyrillic')
    expect(scriptForLanguage('English')).toBe('Latin')
    expect(mostlyInScript(['Как очистить панель?', 'Давай подумаем.', 'Clear it.'], 'Cyrillic')).toBe(true)
    expect(mostlyInScript(['How do I clear it?', 'Let us think.'], 'Cyrillic')).toBe(false)
  })
})
